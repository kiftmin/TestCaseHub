import express from "express";
import { eq, asc, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";
import { logAudit } from "../utils/project.js";

const router = express.Router();

/**
 * Recalculate a single use case's `status` based on the executions of its
 * test cases and their step results. Called automatically after any execution
 * or step result is recorded so the dashboard KPIs and per-run counts stay
 * accurate.
 *
 * Logic:
 *  1. If any execution has overall_result="failed"                    → "failed"
 *  2. If all executions have terminal overall_results (passed/pba)    → "passed"/"passed_by_agreement"
 *  3. If any execution has step results (pass/fail recorded)          → "in_progress"
 *  4. If any execution exists (status = "in_progress")                → "in_progress"
 *  5. Otherwise                                                       → "pending"
 */
export async function syncUseCaseStatus(testRunId: number, useCaseId: number): Promise<void> {
  const testRunUseCase = await db.query.testRunUseCases.findFirst({
    where: and(
      eq(schema.testRunUseCases.test_run_id, testRunId),
      eq(schema.testRunUseCases.use_case_id, useCaseId),
    ),
  });
  if (!testRunUseCase) return;

  const useCase = await db.query.useCases.findFirst({
    where: eq(schema.useCases.id, useCaseId),
    with: { testCases: true },
  });
  if (!useCase) return;

  const testCaseIds = useCase.testCases.map((tc) => tc.id);
  const executions = await db.query.executions.findMany({
    where: and(
      eq(schema.executions.test_run_id, testRunId),
      testCaseIds.length > 0
        ? sql`${schema.executions.test_case_id} IN (${sql.join(testCaseIds, sql`,`)})`
        : sql`1=0`,
    ),
    with: { stepResults: true },
  });

  // A scenario is only terminal when EVERY test case has a terminal execution.
  // executions only contains rows that exist — missing rows mean Not Started.
  const allTestCasesHaveTerminalExec =
    testCaseIds.length > 0 &&
    testCaseIds.every((tcId) => {
      const exec = executions.find((e) => e.test_case_id === tcId);
      return exec && (exec.overall_result === "passed" || exec.overall_result === "failed" || exec.overall_result === "passed_by_agreement");
    });

  let newStatus = "pending";
  if (executions.length > 0) {
    const failed = executions.some((e) => e.overall_result === "failed");
    const hasPassedByAgreement = executions.some((e) => e.overall_result === "passed_by_agreement");
    const hasStepResults = executions.some((e) =>
      (e.stepResults ?? []).length > 0 && (e.stepResults ?? []).some(r => r.passed != null)
    );
    const execInProgress = executions.some((e) => e.status === "in_progress");

    if (failed && allTestCasesHaveTerminalExec) {
      // Only mark failed when all cases are done (no remaining Not Started)
      newStatus = "failed";
    } else if (allTestCasesHaveTerminalExec && !failed) {
      newStatus = hasPassedByAgreement ? "passed_by_agreement" : "passed";
    } else if (failed || hasStepResults || execInProgress) {
      newStatus = "in_progress";
    }
  }

  if (testRunUseCase.status !== newStatus) {
    await db
      .update(schema.testRunUseCases)
      .set({ status: newStatus })
      .where(eq(schema.testRunUseCases.id, testRunUseCase.id));
  }
}

async function recalculateTestRunCompletion(testRunId: number): Promise<void> {
  const allUseCases = await db.query.testRunUseCases.findMany({
    where: eq(schema.testRunUseCases.test_run_id, testRunId),
  });
  const terminalStatuses = ["passed", "failed", "passed_by_agreement"];
  if (allUseCases.length === 0) return;
  const allTerminal = allUseCases.every(uc => terminalStatuses.includes(uc.status));
  if (allTerminal) {
    const allPassed = allUseCases.every(uc => uc.status === "passed" || uc.status === "passed_by_agreement" || uc.free_pass);
    await db.update(schema.testRuns)
      .set({ status: "completed", passed: allPassed, updated_at: new Date() })
      .where(eq(schema.testRuns.id, testRunId));
  }
}

// GET /api/projects/:projectId/test-runs
router.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId || req.query.projectId);
    if (!projectId) {
      res.status(400).json({ message: "projectId is required" });
      return;
    }
    const data = await db.query.testRuns.findMany({
      where: eq(schema.testRuns.project_id, projectId),
      orderBy: desc(schema.testRuns.scheduled_at),
    });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/test-runs/:testRunId
router.get("/:testRunId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRun = await db.query.testRuns.findFirst({
      where: eq(schema.testRuns.id, testRunId),
      with: {
        checklistItems: { orderBy: [asc(schema.testRunChecklistItems.sort_order)] },
        executions: { with: { stepResults: { orderBy: [desc(schema.stepResults.recorded_at)] } } },
        useCases: {
          with: {
            useCase: {
              with: {
                testCases: {
                  orderBy: [asc(schema.testCases.sort_order)],
                  with: { steps: true },
                },
              },
            },
            tester: true,
          },
        },
        project: true,
      },
    });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }
    if (testRun.useCases) {
      testRun.useCases.sort((a, b) => (a.useCase?.sort_order ?? 0) - (b.useCase?.sort_order ?? 0));
    }
    res.json(testRun);
  } catch (err) { next(err); }
});

// POST /api/projects/:projectId/test-runs — Admin or TEST_LEAD
router.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.body.project_id);
    if (!projectId) { res.status(400).json({ message: "project_id is required in body" }); return; }

    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({
      project_id: z.number(),
      name: z.string(),
      scheduled_at: z.string().optional(),
      useCaseIds: z.array(z.number()).optional(),
    }).parse(req.body);

    const [testRun] = await db.insert(schema.testRuns).values({
      project_id: parsed.project_id,
      name: parsed.name,
      scheduled_at: parsed.scheduled_at ? new Date(parsed.scheduled_at) : null,
    }).returning();

    // If useCaseIds provided, add those; otherwise add all scenarios
    if (parsed.useCaseIds && parsed.useCaseIds.length > 0) {
      for (const useCaseId of parsed.useCaseIds) {
        await db.insert(schema.testRunUseCases).values({
          test_run_id: testRun.id,
          use_case_id: useCaseId,
        });
      }
    } else {
      const allUseCases = await db.query.useCases.findMany({
        where: eq(schema.useCases.project_id, projectId),
      });
      for (const uc of allUseCases) {
        await db.insert(schema.testRunUseCases).values({
          test_run_id: testRun.id,
          use_case_id: uc.id,
        });
      }
    }

    // Auto-seed 5 checklist items
    const defaultItems = [
      "Test environment is deployed and accessible",
      "Test data has been loaded and verified",
      "All testers have been granted system access",
      "Test scenarios and cases have been reviewed and approved",
      "Defect tracking process has been communicated to the team",
    ];
    const checklistValues = defaultItems.map((itemText, index) => ({
      test_run_id: testRun.id,
      item_text: itemText,
      sort_order: index + 1,
    }));
    await db.insert(schema.testRunChecklistItems).values(checklistValues);

    await logAudit({ entityType: "test_run", entityId: testRun.id, changedByUserId: req.user!.userId, toStatus: "created" });

    res.status(201).json(testRun);
  } catch (err) { next(err); }
});

// PATCH /api/test-runs/:testRunId — Admin or TEST_LEAD (with Zod validation)
router.patch("/:testRunId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const existing = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const allowed = await checkProjectRole(req, existing.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({
      name: z.string().optional(),
      scheduled_at: z.string().nullable().optional(),
      status: z.enum(["scheduled", "in_progress", "completed"]).optional(),
    }).parse(req.body);

    const updateData: any = { ...parsed, updated_at: new Date() };
    if (parsed.scheduled_at) {
      updateData.scheduled_at = new Date(parsed.scheduled_at);
    }

    const oldStatus = existing.status;
    const [updated] = await db.update(schema.testRuns)
      .set(updateData)
      .where(eq(schema.testRuns.id, testRunId))
      .returning();
    if (!updated) { res.status(404).json({ message: "Not found" }); return; }

    if (parsed.status && parsed.status !== oldStatus) {
      await logAudit({ entityType: "test_run", entityId: testRunId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: parsed.status });
    }

    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/test-runs/:testRunId (scheduled only) — Admin or TEST_LEAD
router.delete("/:testRunId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const existing = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const allowed = await checkProjectRole(req, existing.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    if (existing.status !== "scheduled") { res.status(400).json({ message: "Only scheduled runs can be deleted" }); return; }
    await db.delete(schema.testRuns).where(eq(schema.testRuns.id, testRunId));
    await logAudit({ entityType: "test_run", entityId: testRunId, changedByUserId: req.user!.userId, toStatus: "deleted" });
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/test-runs/:testRunId/re-run — Admin or TEST_LEAD
router.post("/:testRunId/re-run", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const source = await db.query.testRuns.findFirst({
      where: eq(schema.testRuns.id, testRunId),
      with: { useCases: true },
    });
    if (!source) { res.status(404).json({ message: "Source test run not found" }); return; }

    const allowed = await checkProjectRole(req, source.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({ name: z.string(), scheduled_at: z.string().optional(), failedOnly: z.boolean().optional().default(false) }).parse(req.body);

    const [newRun] = await db.insert(schema.testRuns).values({
      project_id: source.project_id,
      name: parsed.name,
      scheduled_at: parsed.scheduled_at ? new Date(parsed.scheduled_at) : null,
      source_test_run_id: testRunId,
    }).returning();

    const useCasesToCopy = parsed.failedOnly
      ? source.useCases.filter(uc => uc.status === "failed")
      : source.useCases;

    for (const uc of useCasesToCopy) {
      await db.insert(schema.testRunUseCases).values({
        test_run_id: newRun.id,
        use_case_id: uc.use_case_id,
      });
    }

    const defaultItems = [
      "Test environment is deployed and accessible",
      "Test data has been loaded and verified",
      "All testers have been granted system access",
      "Test scenarios and cases have been reviewed and approved",
      "Defect tracking process has been communicated to the team",
    ];
    const checklistValues = defaultItems.map((itemText, index) => ({
      test_run_id: newRun.id,
      item_text: itemText,
      sort_order: index + 1,
    }));
    await db.insert(schema.testRunChecklistItems).values(checklistValues);

    res.status(201).json(newRun);
  } catch (err) { next(err); }
});

// POST /api/test-runs/:testRunId/confirm-entry — Admin or TEST_LEAD
router.post("/:testRunId/confirm-entry", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const existing = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const allowed = await checkProjectRole(req, existing.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const [updated] = await db.update(schema.testRuns)
      .set({
        entry_confirmed: true,
        entry_confirmed_by_user_id: req.user!.userId,
        entry_confirmed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(schema.testRuns.id, testRunId))
      .returning();

    await logAudit({ entityType: "test_run", entityId: testRunId, changedByUserId: req.user!.userId, toStatus: "entry_confirmed" });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/test-runs/:testRunId/confirm-entry (alternative)
router.patch("/:testRunId/confirm-entry", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const existing = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const allowed = await checkProjectRole(req, existing.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const [updated] = await db.update(schema.testRuns)
      .set({
        entry_confirmed: true,
        entry_confirmed_by_user_id: req.user!.userId,
        entry_confirmed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(schema.testRuns.id, testRunId))
      .returning();

    await logAudit({ entityType: "test_run", entityId: testRunId, changedByUserId: req.user!.userId, toStatus: "entry_confirmed" });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/test-runs/:testRunId/use-cases/:testRunUseCaseId — assign tester, free pass, status
router.patch("/:testRunId/use-cases/:testRunUseCaseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRunUseCaseId = Number(req.params.testRunUseCaseId);

    const existing = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!existing) { res.status(404).json({ message: "Test run not found" }); return; }

    const allowed = await checkProjectRole(req, existing.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({
      assigned_tester_id: z.number().nullable().optional(),
      free_pass: z.boolean().optional(),
      status: z.enum(["pending", "in_progress", "passed", "failed", "passed_by_agreement"]).optional(),
    }).parse(req.body);

    const [updated] = await db.update(schema.testRunUseCases)
      .set({ ...parsed })
      .where(eq(schema.testRunUseCases.id, testRunUseCaseId))
      .returning();

    // Recalculate test run completion if status changed to terminal
    if (parsed.status) {
      await recalculateTestRunCompletion(testRunId);
    }

    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/test-runs/:testRunId/use-cases — add scenario to non-completed run
router.post("/:testRunId/use-cases", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const existing = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!existing) { res.status(404).json({ message: "Test run not found" }); return; }

    if (existing.status === "completed") { res.status(400).json({ message: "Cannot add scenarios to a completed run" }); return; }

    const allowed = await checkProjectRole(req, existing.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({ use_case_id: z.number() }).parse(req.body);

    const [inserted] = await db.insert(schema.testRunUseCases)
      .values({ test_run_id: testRunId, use_case_id: parsed.use_case_id })
      .returning();

    res.status(201).json(inserted);
  } catch (err) { next(err); }
});

// DELETE /api/test-runs/:testRunId/use-cases/:testRunUseCaseId
router.delete("/:testRunId/use-cases/:testRunUseCaseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRunUseCaseId = Number(req.params.testRunUseCaseId);

    const existing = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!existing) { res.status(404).json({ message: "Test run not found" }); return; }

    const allowed = await checkProjectRole(req, existing.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    await db.delete(schema.testRunUseCases).where(eq(schema.testRunUseCases.id, testRunUseCaseId));
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/test-runs/:testRunId/use-cases/:useCaseId/sync — recalculate scenario status
router.post("/:testRunId/use-cases/:useCaseId/sync", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const useCaseId = Number(req.params.useCaseId);

    await syncUseCaseStatus(testRunId, useCaseId);

    const testRunUseCase = await db.query.testRunUseCases.findFirst({
      where: and(
        eq(schema.testRunUseCases.test_run_id, testRunId),
        eq(schema.testRunUseCases.use_case_id, useCaseId),
      ),
    });
    if (!testRunUseCase) { res.status(404).json({ message: "Test run use case not found" }); return; }

    await recalculateTestRunCompletion(testRunId);

    res.json(testRunUseCase);
  } catch (err) { next(err); }
});

// PATCH /api/test-runs/:testRunId/use-cases/:testRunUseCaseId/tester-sign-off
router.patch("/:testRunId/use-cases/:testRunUseCaseId/tester-sign-off", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRunUseCaseId = Number(req.params.testRunUseCaseId);

    const truc = await db.query.testRunUseCases.findFirst({
      where: eq(schema.testRunUseCases.id, testRunUseCaseId),
    });
    if (!truc) { res.status(404).json({ message: "Test run use case not found" }); return; }

    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }

    // Only assigned TESTER or TEST_LEAD can sign off (spec § 4.3)
    const isAssignedTester = truc.assigned_tester_id === req.user!.userId;
    const isTestLead = await checkProjectRole(req, testRun.project_id, ["TEST_LEAD"]);
    if (!isAssignedTester && !isTestLead && req.user!.role !== "ADMIN") {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const [updated] = await db.update(schema.testRunUseCases)
      .set({
        tester_sign_off: true,
        tester_sign_off_at: new Date(),
      })
      .where(eq(schema.testRunUseCases.id, testRunUseCaseId))
      .returning();

    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/test-runs/:testRunId/access-qr — Admin or TEST_LEAD
router.get("/:testRunId/access-qr", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!testRun) { res.status(404).json({ message: "Not found" }); return; }

    const allowed = await checkProjectRole(req, testRun.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const forwardedProto = req.headers["x-forwarded-proto"];
    const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || process.env.PUBLIC_PROTOCOL || req.protocol;
    const host = process.env.PUBLIC_HOST || req.get("host");
    const accessUrl = `${proto}://${host}/tester/run/${testRunId}`;

    let qrDataUrl = "";
    try {
      const QRCode = (await import("qrcode")).default;
      qrDataUrl = await QRCode.toDataURL(accessUrl, { width: 256, margin: 2 });
    } catch {
      qrDataUrl = "";
    }

    res.json({ accessUrl, qrDataUrl });
  } catch (err) { next(err); }
});

// GET /api/test-runs/:testRunId/full-report
router.get("/:testRunId/full-report", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRun = await db.query.testRuns.findFirst({
      where: eq(schema.testRuns.id, testRunId),
      with: {
        project: true,
        useCases: {
          with: {
            useCase: { with: { testCases: { with: { steps: true } } } },
            tester: true,
          },
        },
        executions: { with: { testCase: true, stepResults: { orderBy: [desc(schema.stepResults.id)] } } },
        defects: { with: { testCase: true, retests: true } },
      },
    });
    if (!testRun) { res.status(404).json({ message: "Not found" }); return; }
    res.json(testRun);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/test-runs/analytics
router.get("/analytics", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.query.projectId);
    if (!projectId) { res.status(400).json({ message: "projectId required" }); return; }

    const runs = await db.query.testRuns.findMany({
      where: eq(schema.testRuns.project_id, projectId),
    });

    const total = runs.length;
    const passed = runs.filter(r => r.passed === true).length;
    const failed = runs.filter(r => r.passed === false).length;
    const inProgress = runs.filter(r => r.status === "in_progress").length;
    const scheduled = runs.filter(r => r.status === "scheduled").length;

    res.json({ total, passed, failed, inProgress, scheduled, passRate: total > 0 ? Math.round((passed / total) * 100) : 0 });
  } catch (err) { next(err); }
});

export default router;
