import express from "express";
import { eq, desc, and, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, checkProjectRole, checkProjectQa, AuthenticatedRequest } from "../middlewares/auth.js";
import { logAudit, logSystemNote } from "../utils/project.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// GET endpoints (open to all authenticated)
// ---------------------------------------------------------------------------

// GET /api/test-runs/:testRunId/defects
router.get("/test-runs/:testRunId/defects", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    let result = await db.query.defects.findMany({
      where: eq(schema.defects.test_run_id, testRunId),
      with: {
        testCase: { with: { steps: true, useCase: true } },
        execution: { with: { stepResults: { with: { step: true } }, tester: true } },
        notes: { with: { addedBy: true } },
        retests: true,
      },
    });
    result = await Promise.all(result.map(enrichDecisionType));
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/defects
router.get("/projects/:projectId/defects", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    let result = await db.query.defects.findMany({
      where: eq(schema.defects.project_id, projectId),
      with: {
        testCase: { with: { steps: true, useCase: true } },
        execution: { with: { stepResults: { with: { step: true } }, tester: true } },
        notes: { with: { addedBy: true } },
        retests: true,
      },
    });
    result = await Promise.all(result.map(enrichDecisionType));

    // Flag defects that are part of a non-completed retest run
    const activeRetestRuns = await db.query.testRuns.findMany({
      where: and(
        eq(schema.testRuns.project_id, projectId),
        eq(schema.testRuns.run_type, "retest"),
        ne(schema.testRuns.status, "completed"),
      ),
      with: { useCases: { columns: { use_case_id: true } } },
    });
    const activeRetestUseCaseIds = new Set<number>(
      activeRetestRuns.flatMap((r) => r.useCases.map((uc) => uc.use_case_id)),
    );
    result = result.map((d) => ({
      ...d,
      inActiveRetestRun: activeRetestUseCaseIds.has(d.testCase?.useCase?.id),
    }));

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/defects/:defectId
router.get("/defects/:defectId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.id, defectId),
      with: {
        testCase: { with: { steps: true, useCase: true } },
        execution: { with: { stepResults: { with: { step: true } }, tester: true } },
        notes: { with: { addedBy: true } },
        retests: true,
      },
    });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    res.json(await enrichDecisionType(defect));
  } catch (err) { next(err); }
});

// GET /api/defects/:defectId/retests
router.get("/defects/:defectId/retests", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const retests = await db.query.defectRetests.findMany({
      where: eq(schema.defectRetests.defect_id, defectId),
    });
    res.json(retests);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Helper: resolve project_id from a defect
// ---------------------------------------------------------------------------
async function getProjectId(defectId: number): Promise<number | null> {
  const defect = await db.query.defects.findFirst({
    where: eq(schema.defects.id, defectId),
    columns: { id: true, test_run_id: true },
  });
  if (!defect) return null;
  const tr = await db.query.testRuns.findFirst({
    where: eq(schema.testRuns.id, defect.test_run_id),
    columns: { project_id: true },
  });
  return tr?.project_id ?? null;
}

/**
 * Reads the audit trail to find the from_status of the most recent transition
 * that resulted in `targetStatus` for the given defect.
 * Used to implement "rollback to prior state" on unblock and biz-risk rejection.
 * Falls back to `fallback` if no audit entry is found.
 */
async function getPriorState(
  defectId: number,
  targetStatus: string,
  fallback: string
): Promise<string> {
  const entry = await db.query.statusAuditLog.findFirst({
    where: and(
      eq(schema.statusAuditLog.entity_id, defectId),
      eq(schema.statusAuditLog.entity_type, "defect"),
      eq(schema.statusAuditLog.to_status, targetStatus)
    ),
    orderBy: [desc(schema.statusAuditLog.changed_at)],
    columns: { from_status: true },
  });
  return entry?.from_status ?? fallback;
}

/**
 * Enriches a defect with decision_type parsed from the audit log
 * when the defect is in PENDING_BIZ_ACCEPTANCE status.
 */
async function enrichDecisionType(defect: any): Promise<any> {
  if (defect?.status === "PENDING_BIZ_ACCEPTANCE") {
    const auditEntry = await db.query.statusAuditLog.findFirst({
      where: and(
        eq(schema.statusAuditLog.entity_id, defect.id),
        eq(schema.statusAuditLog.entity_type, "defect"),
        eq(schema.statusAuditLog.to_status, "PENDING_BIZ_ACCEPTANCE")
      ),
      orderBy: [desc(schema.statusAuditLog.changed_at)],
    });
    const reason = auditEntry?.reason || "";
    defect.decision_type = reason.startsWith("[RISK WAIVER]") ? "risk_waiver" : "business_review";
  }
  return defect;
}

// ---------------------------------------------------------------------------
// PHASE 1 — TEST_LEAD Triage
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/classify — TEST_LEAD only
// Any non-terminal status — updates severity + priority (and optionally assignee).
// If currently NEW (or TRIAGED if assignee provided), also transitions status.
router.patch("/defects/:defectId/classify", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      severity: z.enum(["Critical", "Major", "Minor", "Cosmetic"]),
      priority: z.enum(["P1", "P2", "P3", "P4"]),
      assigned_to_user_id: z.number().optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    let targetStatus = oldStatus;
    const updateData: Record<string, any> = {
      severity: data.severity,
      priority: data.priority,
      updated_at: new Date(),
    };

    if (data.assigned_to_user_id !== undefined) {
      updateData.assigned_to_user_id = data.assigned_to_user_id;
      if (oldStatus === "NEW") {
        // Log intermediate TRIAGED step so the stepper tracks it as visited
        await logSystemNote(defectId, "NEW", "TRIAGED", req.user!.userId);
        targetStatus = "ASSIGNED";
      } else if (oldStatus === "TRIAGED") {
        targetStatus = "ASSIGNED";
      }
    } else if (oldStatus === "NEW") {
      targetStatus = "TRIAGED";
    }

    updateData.status = targetStatus;

    const [updated] = await db.update(schema.defects)
      .set(updateData)
      .where(eq(schema.defects.id, defectId))
      .returning();

    let assignedUserText = "";
    if (data.assigned_to_user_id) {
      const assignedUser = await db.query.users.findFirst({ where: eq(schema.users.id, data.assigned_to_user_id), columns: { name: true } });
      assignedUserText = `Assigned to ${assignedUser?.name ?? `user #${data.assigned_to_user_id}`}`;
    }

    if (targetStatus !== oldStatus) {
      await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: targetStatus });
      await logSystemNote(defectId, oldStatus, targetStatus, req.user!.userId, assignedUserText || undefined);
    } else {
      // Reclassification without status change — log a system note for the severity/priority update
      await logSystemNote(defectId, oldStatus, oldStatus, req.user!.userId, `Reclassified: severity=${data.severity}, priority=${data.priority}`);
    }
    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: oldStatus, reason: `Reclassified: severity=${data.severity}, priority=${data.priority}` });
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/assign — TEST_LEAD only
// TRIAGED ──────────────────────────────────────────────────────> ASSIGNED
// Defect MUST be in TRIAGED state. Assignment from NEW is no longer permitted.
router.patch("/defects/:defectId/assign", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      assigned_to_user_id: z.number(),
      support_ticket_number: z.string().optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "TRIAGED") {
      res.status(409).json({ message: "Defect must be triaged before it can be assigned. Please classify severity and priority first." });
      return;
    }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({
        status: "ASSIGNED",
        assigned_to_user_id: data.assigned_to_user_id,
        support_ticket_number: data.support_ticket_number ?? null,
        updated_at: new Date(),
      })
      .where(eq(schema.defects.id, defectId))
      .returning();

    const assignedUser = await db.query.users.findFirst({ where: eq(schema.users.id, data.assigned_to_user_id), columns: { name: true } });
    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "ASSIGNED" });
    await logSystemNote(defectId, oldStatus, "ASSIGNED", req.user!.userId, `Assigned to ${assignedUser?.name ?? `user #${data.assigned_to_user_id}`}`);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/flag-blocked — TEST_LEAD only
// Sets is_blocked flag to true on the defect.
// Requires mandatory reason text.
router.patch("/defects/:defectId/flag-blocked", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().min(1, "Block reason is required") });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    
    const terminalStatuses = ["CLOSED", "PASSED_BY_AGREEMENT"];
    if (terminalStatuses.includes(defect.status)) {
      res.status(400).json({ message: "Cannot block a closed or finalized defect" });
      return;
    }

    const [updated] = await db.update(schema.defects)
      .set({ is_blocked: true, blocked_reason: data.reason, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: defect.status, toStatus: "BLOCKED", reason: `Blocked: ${data.reason}` });
    await logSystemNote(defectId, defect.status, "BLOCKED", req.user!.userId, `Flagged as Blocked: ${data.reason}`, true);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/flag-retest-from-new — TEST_LEAD only
// NEW | TRIAGED | ASSIGNED | IN_PROGRESS | BLOCKED | REGRESSED | QA_PASSED
//   ─────────────────────────────────────────────────────────────────────────> READY_FOR_VERIFICATION
// Automatically provisions a defect_retests trace and a retest_reason.
// Accepts any non-terminal, non-closed status so Test Leads can retest from any stage.
// RESOLVED_DEV is explicitly blocked here so a resolved-but-not-QA'd defect cannot
// skip the QA gate through this back door (use flag-retest after QA passes instead).
router.patch("/defects/:defectId/flag-retest-from-new", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      reason: z.string().default("Flagged for retesting"),
      targetVerificationRunId: z.number().optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    const blockedStatuses = ["CLOSED", "PASSED_BY_AGREEMENT", "PENDING_BIZ_ACCEPTANCE", "RESOLVED_DEV"];
    if (blockedStatuses.includes(defect.status)) {
      res.status(409).json({ message: "Defect must pass QA review before it can be sent for verification. A resolved (but not QA-reviewed) defect cannot be retested directly." });
      return;
    }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "READY_FOR_VERIFICATION", retest_reason: data.reason, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await db.insert(schema.defectRetests).values({
      defect_id: defectId,
      test_run_id: defect.test_run_id,
      target_verification_run_id: data.targetVerificationRunId ?? defect.test_run_id,
    });

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "READY_FOR_VERIFICATION", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "READY_FOR_VERIFICATION", req.user!.userId, data.reason);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/submit-for-business-decision — TEST_LEAD only
// NEW | TRIAGED | ASSIGNED | IN_PROGRESS | RESOLVED_DEV | QA_PASSED | REGRESSED | READY_FOR_VERIFICATION
//   ─────────────────────────────────────────────────────────────────────────────────────────────────> PENDING_BIZ_ACCEPTANCE
// Single unified endpoint for risk waivers and general business decisions.
router.patch("/defects/:defectId/submit-for-business-decision", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      justification: z.string().min(10, "Justification must be at least 10 characters"),
      decisionType: z.enum(["risk_waiver", "business_review"]).default("business_review"),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const validFromStates = ["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "RESOLVED_DEV", "QA_PASSED", "REGRESSED", "READY_FOR_VERIFICATION"];
    if (!validFromStates.includes(defect.status)) {
      res.status(400).json({
        message: `Defect must be in one of these states to submit for business decision: ${validFromStates.join(", ")}. Current status: ${defect.status}`
      });
      return;
    }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({
        status: "PENDING_BIZ_ACCEPTANCE",
        accepted_by_business_note: data.justification,
        updated_at: new Date(),
      })
      .where(eq(schema.defects.id, defectId))
      .returning();

    const reasonPrefix = data.decisionType === "risk_waiver" ? "[RISK WAIVER] " : "[BUSINESS REVIEW] ";
    await logAudit({
      entityType: "defect",
      entityId: defectId,
      changedByUserId: req.user!.userId,
      fromStatus: oldStatus,
      toStatus: "PENDING_BIZ_ACCEPTANCE",
      reason: reasonPrefix + data.justification,
    });

    const decisionTypeLabel = data.decisionType === "risk_waiver" ? "Risk waiver" : "Business review";
    await logSystemNote(defectId, oldStatus, "PENDING_BIZ_ACCEPTANCE", req.user!.userId, `${decisionTypeLabel} submitted for Business Owner approval: ${data.justification}`);

    res.json(updated);
  } catch (err) { next(err); }
});


// PATCH /defects/:defectId/quick-verify — TEST_LEAD | TESTER
// READY_FOR_VERIFICATION ────────────────────────────────────> CLOSED (pass) | REGRESSED (fail + regression bump)
// Auto-generates a hidden verification test run, logs a completed Retest record, and immediately transitions status.
router.patch("/defects/:defectId/quick-verify", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      result: z.enum(["passed", "failed"]),
      notes: z.string().optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD", "TESTER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.id, defectId),
      with: { testCase: { with: { useCase: true } } },
    });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    if (defect.status !== "READY_FOR_VERIFICATION") {
      res.status(400).json({ message: "Defect must be READY_FOR_VERIFICATION to verify." });
      return;
    }

    // Block Quick Verify when the defect is enrolled in an active retest run.
    // In that case the retest run's execution results will auto-resolve the defect
    // using test-case-level attribution, which is more accurate than a manual verdict.
    const useCaseId = defect.testCase?.useCase?.id;
    if (useCaseId) {
      const activeRetestRun = await db.query.testRuns.findFirst({
        where: and(
          eq(schema.testRuns.project_id, projectId),
          eq(schema.testRuns.run_type, "retest"),
          ne(schema.testRuns.status, "completed"),
        ),
        with: { useCases: { columns: { use_case_id: true } } },
      });
      const enrolledInActiveRun = activeRetestRun?.useCases.some(
        (uc) => uc.use_case_id === useCaseId,
      );
      if (enrolledInActiveRun) {
        res.status(409).json({
          message:
            "This defect is part of an active retest run and will be resolved automatically when testers complete that run. Quick Verify is disabled to prevent a conflicting manual verdict.",
        });
        return;
      }
    }

    const oldStatus = defect.status;

    // Look up the test_case to find the parent use_case_id for scenario injection
    const testCase = await db.query.testCases.findFirst({
      where: eq(schema.testCases.id, defect.test_case_id),
    });

    // Create a hidden verification test run linked to the same project
    const [verificationRun] = await db.insert(schema.testRuns).values({
      project_id: projectId,
      name: `Quick Verify — DEF-${defect.id}`,
      status: "completed",
      entry_confirmed: true,
      entry_confirmed_by_user_id: req.user!.userId,
      entry_confirmed_at: new Date(),
    }).returning();

    // Inject the parent scenario into the new test run so it isn't empty
    if (testCase?.use_case_id) {
      await db.insert(schema.testRunUseCases).values({
        test_run_id: verificationRun.id,
        use_case_id: testCase.use_case_id,
        assigned_tester_id: req.user!.userId,
        status: data.result === "passed" ? "passed" : "failed",
      });
    }

    // Create a completed defect_retest record linking this verification run to the defect
    const [retestRecord] = await db.insert(schema.defectRetests).values({
      defect_id: defectId,
      test_run_id: defect.test_run_id,
      target_verification_run_id: verificationRun.id,
      assigned_tester_id: req.user!.userId,
      retest_result: data.result,
      retest_notes: data.notes ?? null,
      retested_by_user_id: req.user!.userId,
      retested_at: new Date(),
    }).returning();

    if (data.result === "passed") {
      const [updated] = await db.update(schema.defects)
        .set({ status: "CLOSED", regression_index: 0, updated_at: new Date(), closed_at: new Date() })
        .where(eq(schema.defects.id, defectId))
        .returning();

      await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "CLOSED", reason: data.notes ?? "Quick verify passed" });
      await logSystemNote(defectId, oldStatus, "CLOSED", req.user!.userId, `Quick verification passed. ${data.notes ?? ""}`);
      res.json({ defect: updated, verificationRun, retestId: retestRecord.id });
    } else {
      const [updated] = await db.update(schema.defects)
        .set({
          status: "REGRESSED",
          regression_index: sql`${schema.defects.regression_index} + 1`,
          updated_at: new Date(),
        })
        .where(eq(schema.defects.id, defectId))
        .returning();

      await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "REGRESSED", reason: data.notes ?? "Quick verify failed" });
      await logSystemNote(defectId, oldStatus, "REGRESSED", req.user!.userId, `Quick verification failed. Regression counter incremented. ${data.notes ?? ""}`);
      res.json({ defect: updated, verificationRun, retestId: retestRecord.id });
    }
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PHASE 2 — Developer Cycle
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/start — DEVELOPER or TEST_LEAD
// ASSIGNED ───────────────────────────────────────────────────> IN_PROGRESS
router.patch("/defects/:defectId/start", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["DEVELOPER", "TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    if (defect.status !== "ASSIGNED") { res.status(409).json({ message: `Cannot start defect in status ${defect.status}. Only ASSIGNED defects can be started.` }); return; }
    // DEVELOPER can only start their own defect; TEST_LEAD can start any
    if (defect.assigned_to_user_id !== req.user!.userId) {
      const isTestLead = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
      if (!isTestLead) {
        res.status(403).json({ message: "You can only start work on defects assigned to you." });
        return;
      }
    }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "IN_PROGRESS", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "IN_PROGRESS" });
    await logSystemNote(defectId, oldStatus, "IN_PROGRESS", req.user!.userId);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/block — DEVELOPER or TEST_LEAD
// Sets is_blocked flag to true on the defect.
// Requires reason text.
router.patch("/defects/:defectId/block", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().min(1) });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["DEVELOPER", "TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    if (defect.status !== "TRIAGED" && defect.status !== "ASSIGNED" && defect.status !== "IN_PROGRESS" && defect.status !== "REGRESSED") {
      res.status(409).json({ message: `Cannot block defect in status ${defect.status}. Only TRIAGED, ASSIGNED, IN_PROGRESS, or REGRESSED defects can be blocked.` });
      return;
    }
    // DEVELOPER can only block their own defect; TEST_LEAD can block any
    if (defect.assigned_to_user_id !== req.user!.userId) {
      const isTestLead = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
      if (!isTestLead) {
        res.status(403).json({ message: "You can only block defects assigned to you." });
        return;
      }
    }

    const [updated] = await db.update(schema.defects)
      .set({ is_blocked: true, blocked_reason: data.reason, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: defect.status, toStatus: "BLOCKED", reason: `Blocked: ${data.reason}` });
    await logSystemNote(defectId, defect.status, "BLOCKED", req.user!.userId, `Blocked: ${data.reason}`, true);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/unblock — DEVELOPER or TEST_LEAD
// Sets is_blocked flag to false on the defect.
router.patch("/defects/:defectId/unblock", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().min(1, "Reason is required") });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }

    const role = req.user!.role;
    const projectRole = (await db.query.projectAssignments.findFirst({
      where: and(eq(schema.projectAssignments.project_id, projectId), eq(schema.projectAssignments.user_id, req.user!.userId)),
      columns: { role: true },
    }))?.role;

    const isAdmin = role === "ADMIN";
    const isTestLead = projectRole === "TEST_LEAD";
    const isDeveloper = projectRole === "DEVELOPER";
    if (!isAdmin && !isTestLead && !isDeveloper) {
      res.status(403).json({ message: "Only developer or test lead can unblock" });
      return;
    }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (!defect.is_blocked) {
      res.status(400).json({ message: "Defect is not blocked" });
      return;
    }

    if (isDeveloper && defect.assigned_to_user_id !== req.user!.userId) {
      res.status(403).json({ message: "You can only unblock your own assigned defects" });
      return;
    }

    const [updated] = await db.update(schema.defects)
      .set({ is_blocked: false, blocked_reason: null, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: "BLOCKED", toStatus: defect.status, reason: `Unblocked: ${data.reason}` });
    await logSystemNote(defectId, "BLOCKED", defect.status, req.user!.userId, `Unblocked: ${data.reason}`, true);
    res.json({
      id: updated.id,
      status: updated.status,
      assigned_to_user_id: updated.assigned_to_user_id,
      is_blocked: updated.is_blocked,
      updated_at: updated.updated_at,
    });
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/resolve — DEVELOPER or TEST_LEAD
// ASSIGNED | IN_PROGRESS ──────────────────────────────────────> RESOLVED_DEV
// Requires root_cause_category. Sets resolved_at.
router.patch("/defects/:defectId/resolve", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      root_cause_category: z.string().min(3, "Root cause category must be at least 3 characters"),
    });
    const data = bodySchema.parse(req.body);
    const validCategories = ["Requirements Gap", "Design Defect", "Coding Error", "Environment Issue", "Test Data Issue", "Configuration Error", "Third-Party Integration", "Other"];
    if (!validCategories.includes(data.root_cause_category) && !data.root_cause_category.startsWith("Other: ")) {
      res.status(400).json({ message: `Invalid root cause category. Use one of: ${validCategories.join(", ")} or specify "Other: <description>"` });
      return;
    }

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["DEVELOPER", "TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    // DEVELOPER can only resolve their own defect; TEST_LEAD can resolve any
    if (defect.assigned_to_user_id !== req.user!.userId) {
      const isTestLead = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
      if (!isTestLead) {
        res.status(403).json({ message: "You can only resolve defects assigned to you." });
        return;
      }
    }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "RESOLVED_DEV", root_cause_category: data.root_cause_category, resolved_at: new Date(), updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "RESOLVED_DEV", reason: data.root_cause_category });
    await logSystemNote(defectId, oldStatus, "RESOLVED_DEV", req.user!.userId, `Root cause: ${data.root_cause_category}`);
    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PHASE 2.5 — QA Review (gate before verification)
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/qa-review — ADMIN, or DEVELOPER with is_qa flag
// RESOLVED_DEV ────────────────────────────────────────────────> QA_PASSED (pass) | IN_PROGRESS (fail)
// regression_index is NEVER changed by this endpoint — a QA fail is a fresh dev cycle, not a regression.
router.patch("/defects/:defectId/qa-review", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      result: z.enum(["passed", "failed"]),
      notes: z.string().optional(),
    }).superRefine((data, ctx) => {
      if (data.result === "failed" && (!data.notes || data.notes.trim().length < 3)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A failure reason of at least 3 characters is required when QA review fails",
          path: ["notes"],
        });
      }
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }

    const isQa = await checkProjectQa(req, projectId);
    if (!isQa) {
      res.status(403).json({ message: "Forbidden — only QA-flagged developers (or an admin) may submit a QA verdict" });
      return;
    }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "RESOLVED_DEV") {
      res.status(409).json({ message: "Defect must be RESOLVED_DEV to submit a QA verdict." });
      return;
    }

    // A developer cannot QA review their own defect
    if (defect.assigned_to_user_id === req.user!.userId) {
      res.status(400).json({ message: "A developer cannot QA review a defect assigned to themselves." });
      return;
    }

    const oldStatus = defect.status;
    const regressionIndex = defect.regression_index ?? 0;

    if (data.result === "passed") {
      const [updated] = await db.update(schema.defects)
        .set({
          status: "QA_PASSED",
          qa_reviewed_by_user_id: req.user!.userId,
          qa_reviewed_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(schema.defects.id, defectId))
        .returning();

      await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "QA_PASSED", reason: data.notes ?? "QA passed" });
      await logSystemNote(defectId, oldStatus, "QA_PASSED", req.user!.userId, `QA review passed. ${data.notes ?? ""}`);

      res.json(updated);
    } else {
      const [updated] = await db.update(schema.defects)
        .set({
          status: "IN_PROGRESS",
          qa_reviewed_by_user_id: null,
          qa_reviewed_at: null,
          regression_index: regressionIndex,
          updated_at: new Date(),
        })
        .where(eq(schema.defects.id, defectId))
        .returning();

      await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "IN_PROGRESS", reason: data.notes ?? "QA failed" });
      await logSystemNote(defectId, oldStatus, "IN_PROGRESS", req.user!.userId, `QA review failed. ${data.notes ?? ""}`);

      res.json(updated);
    }
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PHASE 3 — Verification
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/flag-retest — TEST_LEAD only
// QA_PASSED ────────────────────────────────────────────────> READY_FOR_VERIFICATION
// Automatically provisions a defect_retests trace with target_verification_run_id
// Requires the defect to have passed QA review first (see PHASE 2.5).
router.patch("/defects/:defectId/flag-retest", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      reason: z.string(),
      targetVerificationRunId: z.number(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "QA_PASSED") {
      res.status(409).json({ message: "Defect must pass QA review before it can be sent for verification." });
      return;
    }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "READY_FOR_VERIFICATION", retest_reason: data.reason, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await db.insert(schema.defectRetests).values({
      defect_id: defectId,
      test_run_id: defect.test_run_id,
      target_verification_run_id: data.targetVerificationRunId,
    });

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "READY_FOR_VERIFICATION", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "READY_FOR_VERIFICATION", req.user!.userId, data.reason);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defect-retests/:retestId — TESTER or TEST_LEAD
// READY_FOR_VERIFICATION ──────────────────────────────────────> CLOSED | ASSIGNED
router.patch("/defect-retests/:retestId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const retestId = Number(req.params.retestId);
    const bodySchema = z.object({
      retestResult: z.enum(["passed", "failed"]),
      retestNotes: z.string().optional(),
    });
    const data = bodySchema.parse(req.body);

    const retest = await db.query.defectRetests.findFirst({
      where: eq(schema.defectRetests.id, retestId),
    });
    if (!retest) { res.status(404).json({ message: "Retest not found" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, retest.defect_id) });
    if (!defect) { res.status(404).json({ message: "Defect not found" }); return; }

    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, defect.test_run_id) });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }

    const allowed = await checkProjectRole(req, testRun.project_id, ["TEST_LEAD", "TESTER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const oldDefectStatus = defect.status;
    await db.update(schema.defectRetests)
      .set({
        retest_result: data.retestResult,
        retest_notes: data.retestNotes ?? null,
        retested_by_user_id: req.user!.userId,
        retested_at: new Date(),
      })
      .where(eq(schema.defectRetests.id, retestId));

    if (data.retestResult === "failed") {
      const newRegressionIndex = (defect.regression_index ?? 0) + 1;
      await db.update(schema.defects)
        .set({ status: "REGRESSED", regression_index: newRegressionIndex, updated_at: new Date() })
        .where(eq(schema.defects.id, retest.defect_id));

      await logAudit({
        entityType: "defect",
        entityId: retest.defect_id,
        changedByUserId: req.user!.userId,
        fromStatus: oldDefectStatus,
        toStatus: "REGRESSED",
        reason: "Retest failed: " + (data.retestNotes || "No notes"),
      });
      await logSystemNote(retest.defect_id, oldDefectStatus, "REGRESSED", req.user!.userId, "Retest failed: " + (data.retestNotes || "No notes"));
    } else if (data.retestResult === "passed") {
      await db.update(schema.defects)
        .set({ status: "CLOSED", regression_index: 0, updated_at: new Date(), resolved_at: new Date() })
        .where(eq(schema.defects.id, retest.defect_id));

      await logAudit({
        entityType: "defect",
        entityId: retest.defect_id,
        changedByUserId: req.user!.userId,
        fromStatus: oldDefectStatus,
        toStatus: "CLOSED",
        reason: "Retest passed: " + (data.retestNotes || "No notes"),
      });
      await logSystemNote(retest.defect_id, oldDefectStatus, "CLOSED", req.user!.userId, "Retest passed: " + (data.retestNotes || "No notes"));
    }

    res.json({ message: "Retest recorded", retestResult: data.retestResult });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PHASE 4 — Closure / Exception
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/accept — BUSINESS_OWNER only
// READY_FOR_VERIFICATION ──────────────────────────────────────> CLOSED
router.patch("/defects/:defectId/accept", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ note: z.string() });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["BUSINESS_OWNER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "CLOSED", accepted_by_business_note: data.note, updated_at: new Date(), closed_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "CLOSED", reason: data.note });
    await logSystemNote(defectId, oldStatus, "CLOSED", req.user!.userId, data.note);
    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PHASE 5 — Rollback & Escalation
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/resume-work — DEVELOPER or TEST_LEAD
// RESOLVED_DEV | QA_PASSED ──────────────────────────────────────> IN_PROGRESS
// Level 1 rollback (quick undo, no approval)
router.patch("/defects/:defectId/resume-work", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().min(1, "Reason is required") });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["DEVELOPER", "TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Only developer or test lead can resume work" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "RESOLVED_DEV" && defect.status !== "QA_PASSED") {
      res.status(400).json({ message: "Defect is not in RESOLVED_DEV or QA_PASSED state" });
      return;
    }

    const isDeveloper = await checkProjectRole(req, projectId, ["DEVELOPER"]);
    const isAdmin = req.user!.role === "ADMIN";
    const isTestLead = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (isDeveloper && !isAdmin && !isTestLead && defect.assigned_to_user_id !== req.user!.userId) {
      res.status(403).json({ message: "You can only resume work on your own assigned defects" });
      return;
    }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "IN_PROGRESS", resolved_at: null, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "IN_PROGRESS", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "IN_PROGRESS", req.user!.userId, data.reason);
    res.json({
      id: updated.id,
      status: updated.status,
      assigned_to_user_id: updated.assigned_to_user_id,
      resolved_at: updated.resolved_at,
      updated_at: updated.updated_at,
    });
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/reschedule-retest — TEST_LEAD only
// READY_FOR_VERIFICATION ──────────────────────────────────────> QA_PASSED
// Level 1 rollback (quick undo of "sent for verification", no approval).
// Returns to QA_PASSED (not RESOLVED_DEV): the defect already passed QA, so it
// should not have to go through the QA gate again — only the verification send is undone.
router.patch("/defects/:defectId/reschedule-retest", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().min(1, "Reason is required") });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Only test lead can reschedule retest" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "READY_FOR_VERIFICATION") {
      res.status(400).json({ message: "Defect is not in READY_FOR_VERIFICATION state" });
      return;
    }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "QA_PASSED", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await db.delete(schema.defectRetests)
      .where(eq(schema.defectRetests.defect_id, defectId));

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "QA_PASSED", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "QA_PASSED", req.user!.userId, data.reason);
    res.json({
      id: updated.id,
      status: updated.status,
      updated_at: updated.updated_at,
    });
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/reject-verification — BUSINESS_OWNER or TEST_LEAD
// READY_FOR_VERIFICATION ──────────────────────────────────────> ASSIGNED
// Level 2 rollback (escalation, requires reason + analytics)
router.patch("/defects/:defectId/reject-verification", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      reason: z.string().min(10, "Reason is required and must be at least 10 characters"),
      rejectionType: z.enum(["failed_retest", "failed_qa_review", "other"]).optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["BUSINESS_OWNER", "TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Only business owner or test lead can reject verification" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "READY_FOR_VERIFICATION") {
      res.status(400).json({ message: "Defect is not in READY_FOR_VERIFICATION state" });
      return;
    }

    if (!defect.assigned_to_user_id) {
      res.status(422).json({ message: "Defect has no assigned developer. Assign a developer before rejecting verification." });
      return;
    }

    const oldStatus = defect.status;
    const newRegressionIndex = (defect.regression_index ?? 0) + 1;

    // Append to rejection_log as JSON array
    let rejections: Array<{ at: string; by: number; reason: string; type?: string }> = [];
    if (defect.rejection_log) {
      try {
        const parsed = JSON.parse(defect.rejection_log);
        if (Array.isArray(parsed.rejections)) {
          rejections = parsed.rejections;
        }
      } catch { /* start fresh */ }
    }
    rejections.push({
      at: new Date().toISOString(),
      by: req.user!.userId,
      reason: data.reason,
      ...(data.rejectionType ? { type: data.rejectionType } : {}),
    });

    const rejectionLog = JSON.stringify({ rejections });

    const [updated] = await db.update(schema.defects)
      .set({
        status: "ASSIGNED",
        regression_index: newRegressionIndex,
        rejection_log: rejectionLog,
        updated_at: new Date(),
      })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await db.delete(schema.defectRetests)
      .where(eq(schema.defectRetests.defect_id, defectId));

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "ASSIGNED", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "ASSIGNED", req.user!.userId, data.reason);

    // TODO: Notify developer (in-app notification + optional email)
    // To be implemented when notification infrastructure is available

    res.json({
      id: updated.id,
      status: updated.status,
      assigned_to_user_id: updated.assigned_to_user_id,
      updated_at: updated.updated_at,
      regression_index: updated.regression_index,
    });
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/regress — DEVELOPER, TEST_LEAD, or BUSINESS_OWNER
// CLOSED | PASSED_BY_AGREEMENT ──────────────────────────────────> REGRESSED
// Level 2 rollback (escalation — production defect found)
router.patch("/defects/:defectId/regress", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      reason: z.string().min(20, "Reason must be at least 20 characters (provide details)"),
      incidentType: z.enum(["production", "staging", "regression"]),
      customerReference: z.string().optional(),
      severity: z.enum(["Critical", "Major", "Minor"]).optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["DEVELOPER", "TEST_LEAD", "BUSINESS_OWNER"]);
    if (!allowed) { res.status(403).json({ message: "Insufficient permissions to regress defect" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "CLOSED" && defect.status !== "PASSED_BY_AGREEMENT") {
      res.status(400).json({ message: "Defect is not in a closeable state (not CLOSED)" });
      return;
    }

    const oldStatus = defect.status;
    const newRegressionIndex = (defect.regression_index ?? 0) + 1;

    // Append to rejection_log as JSON array under regressions key
    let regressions: Array<{ at: string; by: number; reason: string; type: string; customerReference?: string }> = [];
    if (defect.rejection_log) {
      try {
        const parsed = JSON.parse(defect.rejection_log);
        if (Array.isArray(parsed.regressions)) {
          regressions = parsed.regressions;
        }
      } catch { /* start fresh */ }
    }
    regressions.push({
      at: new Date().toISOString(),
      by: req.user!.userId,
      reason: data.reason,
      type: data.incidentType,
      ...(data.customerReference ? { customerReference: data.customerReference } : {}),
    });

    const rejectionLog = JSON.stringify({ ...(defect.rejection_log ? (() => { try { return JSON.parse(defect.rejection_log); } catch { return {}; } })() : {}), regressions });

    // Set priority to P1 if it was lower
    const currentPriority = defect.priority ?? "P4";
    const newPriority = (currentPriority === "P1" || currentPriority === "P2") ? currentPriority : "P1";

    const updateData: Record<string, unknown> = {
      status: "REGRESSED",
      regression_index: newRegressionIndex,
      rejection_log: rejectionLog,
      priority: newPriority,
      updated_at: new Date(),
    };

    const [updated] = await db.update(schema.defects)
      .set(updateData)
      .where(eq(schema.defects.id, defectId))
      .returning();

    // Create a comment/note with full regression details
    const regressionNote = [
      `Regression reported: ${data.reason}`,
      `Incident type: ${data.incidentType}`,
      data.customerReference ? `Customer reference: ${data.customerReference}` : null,
      `Severity impact: ${data.severity ?? "Not specified"}`,
    ].filter(Boolean).join("\n");

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "REGRESSED", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "REGRESSED", req.user!.userId, regressionNote);

    // TODO: Notify PROJECT_LEAD and TEST_LEAD urgently (escalation required)
    // To be implemented when notification infrastructure is available

    res.json({
      id: updated.id,
      status: updated.status,
      updated_at: updated.updated_at,
      regression_index: updated.regression_index,
    });
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/retry-after-regression — TEST_LEAD only
// REGRESSED ───────────────────────────────────────────────────> ASSIGNED
// Level 2 rollback (escalation — restart dev cycle after root cause analysis)
router.patch("/defects/:defectId/retry-after-regression", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      reason: z.string().min(1, "Reason is required"),
      reassignTo: z.number().optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Only test lead can retry regressed defects" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "REGRESSED") {
      res.status(400).json({ message: "Defect is not in REGRESSED state" });
      return;
    }

    // If reassignTo provided, verify user exists and has DEVELOPER role
    if (data.reassignTo !== undefined) {
      const devAssignment = await db.query.projectAssignments.findFirst({
        where: and(
          eq(schema.projectAssignments.project_id, projectId),
          eq(schema.projectAssignments.user_id, data.reassignTo),
          eq(schema.projectAssignments.role, "DEVELOPER"),
        ),
      });
      if (!devAssignment) {
        res.status(422).json({ message: "Developer not found or invalid" });
        return;
      }
    }

    const oldStatus = defect.status;
    const updateData: Record<string, unknown> = {
      status: "ASSIGNED",
      updated_at: new Date(),
    };
    if (data.reassignTo !== undefined) {
      updateData.assigned_to_user_id = data.reassignTo;
    }

    let reassignDetail = "";
    if (data.reassignTo !== undefined) {
      const oldDev = await db.query.users.findFirst({
        where: eq(schema.users.id, defect.assigned_to_user_id ?? -1),
        columns: { name: true },
      });
      const newDev = await db.query.users.findFirst({
        where: eq(schema.users.id, data.reassignTo),
        columns: { name: true },
      });
      const oldName = oldDev?.name ?? `user #${defect.assigned_to_user_id}`;
      const newName = newDev?.name ?? `user #${data.reassignTo}`;
      reassignDetail = `Reassigned from ${oldName} to ${newName}: `;
    }

    const [updated] = await db.update(schema.defects)
      .set(updateData)
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "ASSIGNED", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "ASSIGNED", req.user!.userId, reassignDetail + data.reason);

    // TODO: Notify developer of reassignment
    // To be implemented when notification infrastructure is available

    res.json({
      id: updated.id,
      status: updated.status,
      assigned_to_user_id: updated.assigned_to_user_id,
      updated_at: updated.updated_at,
    });
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/reassign — TEST_LEAD only
// Lateral handoff: ASSIGNED | IN_PROGRESS ─── (status unchanged) ───> new developer
// Only valid while the defect is actively with a developer in the Development Cycle.
// REGRESSED defects are reassigned via retry-after-regression's reassignTo param instead.
router.patch("/defects/:defectId/reassign", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      newDeveloperId: z.number(),
      reason: z.string().min(1, "Reason is required"),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "ASSIGNED" && defect.status !== "IN_PROGRESS") {
      const message =
        defect.status === "REGRESSED"
          ? "Cannot reassign a REGRESSED defect here — use Retry After Regression, which supports reassignment."
          : "Defect can only be reassigned while it is ASSIGNED or IN_PROGRESS.";
      res.status(409).json({ message });
      return;
    }

    if (data.newDeveloperId === defect.assigned_to_user_id) {
      res.status(400).json({ message: "Defect is already assigned to this developer" });
      return;
    }

    // Verify the target user has an active DEVELOPER assignment on this project
    const devAssignment = await db.query.projectAssignments.findFirst({
      where: and(
        eq(schema.projectAssignments.project_id, projectId),
        eq(schema.projectAssignments.user_id, data.newDeveloperId),
        eq(schema.projectAssignments.role, "DEVELOPER"),
      ),
    });
    if (!devAssignment) {
      res.status(422).json({ message: "Developer not found or invalid" });
      return;
    }

    const oldDev = await db.query.users.findFirst({
      where: eq(schema.users.id, defect.assigned_to_user_id ?? -1),
      columns: { name: true },
    });
    const newDev = await db.query.users.findFirst({
      where: eq(schema.users.id, data.newDeveloperId),
      columns: { name: true },
    });
    const oldName = oldDev?.name ?? `user #${defect.assigned_to_user_id}`;
    const newName = newDev?.name ?? `user #${data.newDeveloperId}`;
    const detail = `Reassigned from ${oldName} to ${newName}: ${data.reason}`;

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ assigned_to_user_id: data.newDeveloperId, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    // Status is unchanged — log the ownership change in both audit trail and note timeline.
    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: oldStatus, reason: detail });
    await logSystemNote(defectId, oldStatus, oldStatus, req.user!.userId, detail);

    res.json({
      id: updated.id,
      status: updated.status,
      assigned_to_user_id: updated.assigned_to_user_id,
      updated_at: updated.updated_at,
    });
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/accept-by-agreement — BUSINESS_OWNER only
// PENDING_BIZ_ACCEPTANCE ────────────────────────> PASSED_BY_AGREEMENT
// Requires mandatory justification (min 10 chars)
router.patch("/defects/:defectId/accept-by-agreement", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      justification: z.string().min(10, "Justification is required and must be at least 10 characters"),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["BUSINESS_OWNER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "PENDING_BIZ_ACCEPTANCE") {
      res.status(400).json({ message: "Only defects pending business acceptance can be accepted by agreement" });
      return;
    }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "PASSED_BY_AGREEMENT", accepted_by_business_note: data.justification, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    const auditEntry = await db.query.statusAuditLog.findFirst({
      where: and(
        eq(schema.statusAuditLog.entity_id, defectId),
        eq(schema.statusAuditLog.entity_type, "defect"),
        eq(schema.statusAuditLog.to_status, "PENDING_BIZ_ACCEPTANCE")
      ),
      orderBy: [desc(schema.statusAuditLog.changed_at)],
    });
    const decisionType = auditEntry?.reason?.startsWith("[RISK WAIVER]") ? "Risk Waiver" : "Business Review";

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "PASSED_BY_AGREEMENT", reason: data.justification, justification: data.justification });
    await logSystemNote(defectId, oldStatus, "PASSED_BY_AGREEMENT", req.user!.userId, `[${decisionType}] ${data.justification}`);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/reject-biz-acceptance — BUSINESS_OWNER only
// PENDING_BIZ_ACCEPTANCE ────────────────────────> <prior state>
// Rolls back to the state the defect was in before it was flagged (from audit trail).
// Falls back to TRIAGED if audit entry not found.
// Clears accepted_by_business_note. Requires rejection reason (min 10 chars).
router.patch("/defects/:defectId/reject-biz-acceptance", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      reason: z.string().min(10, "Rejection reason must be at least 10 characters"),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["BUSINESS_OWNER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    if (defect.status !== "PENDING_BIZ_ACCEPTANCE") {
      res.status(400).json({ message: "Only defects pending business acceptance can be rejected." });
      return;
    }

    const rollbackStatus = await getPriorState(defectId, "PENDING_BIZ_ACCEPTANCE", "TRIAGED");

    const auditEntry = await db.query.statusAuditLog.findFirst({
      where: and(
        eq(schema.statusAuditLog.entity_id, defectId),
        eq(schema.statusAuditLog.entity_type, "defect"),
        eq(schema.statusAuditLog.to_status, "PENDING_BIZ_ACCEPTANCE")
      ),
      orderBy: [desc(schema.statusAuditLog.changed_at)],
    });
    const decisionType = auditEntry?.reason?.startsWith("[RISK WAIVER]") ? "Risk Waiver" : "Business Review";

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({
        status: rollbackStatus,
        accepted_by_business_note: null,
        updated_at: new Date(),
      })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({
      entityType: "defect",
      entityId: defectId,
      changedByUserId: req.user!.userId,
      fromStatus: oldStatus,
      toStatus: rollbackStatus,
      reason: data.reason,
    });
    await logSystemNote(defectId, oldStatus, rollbackStatus, req.user!.userId, `[${decisionType}] ${data.reason}`);
    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

// POST /api/defects/:defectId/notes — TEST_LEAD, BUSINESS_OWNER, DEVELOPER, or participant
router.post("/defects/:defectId/notes", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      note: z.string().min(1),
      is_internal: z.boolean().optional().default(false),
    });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, defect.test_run_id) });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }

    // Developers, Test Leads and Business Owners can always comment
    const projectRole = await checkProjectRole(req, testRun.project_id, ["TEST_LEAD", "BUSINESS_OWNER", "DEVELOPER"]);

    if (!projectRole && req.user!.role !== "ADMIN") {
      // Fall back: check if they're an active team-discussion participant
      const discussions = await db.query.teamDiscussions.findMany({
        where: and(
          eq(schema.teamDiscussions.test_run_id, defect.test_run_id),
          eq(schema.teamDiscussions.is_active, true),
        ),
      });
      const discussionIds = discussions.map(d => d.id);
      if (discussionIds.length === 0) { res.status(403).json({ message: "Forbidden" }); return; }
      const participant = await db.query.teamDiscussionParticipants.findFirst({
        where: and(
          eq(schema.teamDiscussionParticipants.discussion_id, discussionIds[0]),
          eq(schema.teamDiscussionParticipants.user_id, req.user!.userId),
          eq(schema.teamDiscussionParticipants.can_add_notes, true),
        ),
      });
      if (!participant) { res.status(403).json({ message: "Forbidden" }); return; }
    }

    // Only technical roles may create internal dev notes
    let isTechnicalRole = req.user!.role === "ADMIN";
    if (!isTechnicalRole) {
      const assignment = await db.query.projectAssignments.findFirst({
        where: and(
          eq(schema.projectAssignments.project_id, testRun.project_id),
          eq(schema.projectAssignments.user_id, req.user!.userId),
        ),
        columns: { role: true },
      });
      isTechnicalRole = assignment?.role === "DEVELOPER" || assignment?.role === "TEST_LEAD";
      if (!isTechnicalRole) {
        const project = await db.query.projects.findFirst({
          where: eq(schema.projects.id, testRun.project_id),
          columns: { test_lead_id: true },
        });
        isTechnicalRole = project?.test_lead_id === req.user!.userId;
      }
    }
    const isInternal = data.is_internal && isTechnicalRole;

    const [note] = await db.insert(schema.defectNotes)
      .values({
        defect_id: defectId,
        added_by_user_id: req.user!.userId,
        note: data.note,
        is_internal: isInternal,
      })
      .returning();

    res.status(201).json(note);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Aging Matrix
// ---------------------------------------------------------------------------

// GET /api/projects/:projectId/defect-aging-matrix
// Returns all defects with their current-state age and total age
router.get("/projects/:projectId/defect-aging-matrix", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const result = await db.execute(sql`
      SELECT
        d.id AS "defectId",
        d.bug_number AS "bugNumber",
        d.status,
        d.severity,
        d.priority,
        d.ticket_type AS "ticketType",
        d.regression_index AS "regressionIndex",
        d.assigned_to_user_id AS "assignedToUserId",
        d.support_ticket_number AS "supportTicketNumber",
        d.root_cause_category AS "rootCauseCategory",
        AGE(d.updated_at)::text AS "currentStateAge",
        AGE(d.created_at)::text AS "totalAge",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt",
        d.resolved_at AS "resolvedAt",
        d.closed_at AS "closedAt"
      FROM ${schema.defects} d
      WHERE d.project_id = ${projectId}
      ORDER BY d.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
