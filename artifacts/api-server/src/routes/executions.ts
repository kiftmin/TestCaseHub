import express from "express";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { checkProjectRole, denyUnlessProjectAccess, projectIdFromTestRun, AuthenticatedRequest } from "../middlewares/auth.js";
import { logAudit, logSystemNote } from "../utils/project.js";
import { syncUseCaseStatus } from "./test-runs.js";
import { getRetestScope, isTestCaseInRetestScope, getRetestCaseBlockReason } from "../utils/retest-scope.js";

const router = express.Router();

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

/**
 * Compute the progress of a test case execution based on its step results.
 * Progress tracks completeness of step data entry, NOT outcome.
 */
export async function computeExecutionProgress(executionId: number): Promise<"Not Started" | "In Progress" | "Completed"> {
  const execution = await db.query.executions.findFirst({
    where: eq(schema.executions.id, executionId),
    with: {
      testCase: { with: { steps: { orderBy: sql`CAST(${schema.testSteps.step_number} AS INTEGER)` } } },
      stepResults: true,
    },
  });
  if (!execution) return "Not Started";
  const steps = execution.testCase?.steps ?? [];
  if (steps.length === 0) return "Not Started";
  const stepResults = execution.stepResults ?? [];

  const allHaveResults = steps.every(s =>
    stepResults.some(r => r.step_id === s.id && r.passed != null),
  );
  if (!allHaveResults) {
    const someHaveResults = steps.some(s =>
      stepResults.some(r => r.step_id === s.id && r.passed != null),
    );
    return someHaveResults ? "In Progress" : "Not Started";
  }

  // All steps have pass/fail — verify failed steps have actual_result filled
  const failedWithoutActual = stepResults.filter(
    r => r.passed === false && (!r.actual_result || r.actual_result.trim() === ""),
  );
  if (failedWithoutActual.length > 0) return "In Progress";

  return "Completed";
}

/**
 * Compute scenario progress by rolling up its test case progresses.
 */
async function computeScenarioProgress(
  testRunId: number,
  useCaseId: number,
): Promise<"Not Started" | "In Progress" | "Completed"> {
  const useCase = await db.query.useCases.findFirst({
    where: eq(schema.useCases.id, useCaseId),
    with: { testCases: true },
  });
  if (!useCase || useCase.testCases.length === 0) return "Not Started";

  const testCaseIds = useCase.testCases.map(tc => tc.id);
  const executions = await db.query.executions.findMany({
    where: and(
      eq(schema.executions.test_run_id, testRunId),
      testCaseIds.length > 0
        ? inArray(schema.executions.test_case_id, testCaseIds)
        : sql`1=0`,
    ),
  });

  if (executions.length === 0) return "Not Started";

  let anyCompleted = false;
  let anyInProgress = false;
  for (const exec of executions) {
    const progress = await computeExecutionProgress(exec.id);
    if (progress === "Completed") anyCompleted = true;
    if (progress === "In Progress") anyInProgress = true;
  }

  const allStarted = useCase.testCases.every(tc =>
    executions.some(e => e.test_case_id === tc.id),
  );

  if (allStarted && executions.every(e =>
    e.stepResults?.some(r => r.passed != null) ?? false
  )) {
    // This is complex; simplify by checking each execution's progress
    const progresses = await Promise.all(
      executions.map(e => computeExecutionProgress(e.id)),
    );
    if (progresses.every(p => p === "Completed")) return "Completed";
    if (progresses.some(p => p === "Completed" || p === "In Progress")) return "In Progress";
  }

  if (anyInProgress || anyCompleted) return "In Progress";
  return "Not Started";
}

/**
 * Compute test run progress by rolling up all scenario progresses.
 */
async function computeTestRunProgress(testRunId: number): Promise<"Not Started" | "In Progress" | "Completed"> {
  const testRunUseCases = await db.query.testRunUseCases.findMany({
    where: eq(schema.testRunUseCases.test_run_id, testRunId),
  });
  if (testRunUseCases.length === 0) return "Not Started";

  let anyInProgress = false;
  let anyCompleted = false;
  let anyStarted = false;

  for (const truc of testRunUseCases) {
    const progress = await computeScenarioProgress(testRunId, truc.use_case_id);
    if (progress === "Completed") anyCompleted = true;
    if (progress === "In Progress") anyInProgress = true;
    if (progress !== "Not Started") anyStarted = true;
  }

  if (anyCompleted && !anyInProgress && !anyStarted) return "Completed";
  if (anyInProgress || anyCompleted) return "In Progress";
  return "Not Started";
}

// GET /api/dashboard/tester/:userId/test-runs
router.get("/dashboard/tester/:userId/test-runs", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = Number(req.params.userId);
    // Only self or ADMIN may view another user's tester dashboard
    if (req.user!.role !== "ADMIN" && req.user!.userId !== userId) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    // Return ONLY scenarios explicitly assigned to this tester.
    const myUseCases = await db.query.testRunUseCases.findMany({
      where: eq(schema.testRunUseCases.assigned_tester_id, userId),
      with: {
        testRun: {
          with: {
            project: true,
            executions: {
              with: { stepResults: true },
            },
          },
        },
        useCase: { with: { testCases: { with: { steps: true } } } },
      },
    });

    res.json(myUseCases);
  } catch (err) {
    next(err);
  }
});

// POST /api/test-runs/:testRunId/test-cases/:testCaseId/execute
router.post(
  "/test-runs/:testRunId/test-cases/:testCaseId/execute",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const testRunId = Number(req.params.testRunId);
      const testCaseId = Number(req.params.testCaseId);

      const parsed = z
        .object({
          tester_id: z.number(),
          tester_name: z.string().optional(),
        })
        .parse(req.body);

      const testRun = await db.query.testRuns.findFirst({
        where: eq(schema.testRuns.id, testRunId),
      });
      if (!testRun) {
        res.status(404).json({ message: "Test run not found" });
        return;
      }

      // Guard: Entry criteria must be confirmed
      if (!testRun.entry_confirmed) {
        res.status(403).json({
          message: "Entry criteria not confirmed for this test run",
        });
        return;
      }

      // Guard: Must have project access (TESTER or higher)
      const testerAllowed = await checkProjectRole(req, testRun.project_id, ["TESTER", "TEST_LEAD"]);
      if (!testerAllowed) {
        res.status(403).json({ message: "Forbidden — only TESTER role or higher can view this test case" });
        return;
      }

      const assigned = await isAssignedTester(testRunId, testCaseId, req.user!.userId);

      // Check for existing execution (works for both assigned and unassigned)
      const existingExecution = await db.query.executions.findFirst({
        where: and(
          eq(schema.executions.test_run_id, testRunId),
          eq(schema.executions.test_case_id, testCaseId),
        ),
        with: { stepResults: true },
      });

      // Not assigned — read-only view
      if (!assigned) {
        if (existingExecution) {
          res.json({ ...existingExecution, resumed: true });
          return;
        }
        // No existing execution — return read-only mode
        res.json({ readOnly: true, message: "Viewing in read-only mode — you are not assigned to this scenario" });
        return;
      }

      // Phase A+B: retest — only verify/regression; blocked cases hard-stop
      if (testRun.run_type === "retest") {
        const blockReason = await getRetestCaseBlockReason(testRunId, testCaseId, testRun.run_type);
        if (blockReason) {
          res.status(403).json({ message: blockReason });
          return;
        }
        const inScope = await isTestCaseInRetestScope(testRunId, testCaseId, testRun.run_type);
        if (!inScope) {
          res.status(403).json({
            message:
              "This test case is not in retest scope. Only Verify or opted-in Regression cases can be executed.",
          });
          return;
        }
      }

      // Guard: Cannot execute on a completed run
      if (testRun.status === "completed") {
        res.status(403).json({ message: "Cannot execute on a completed test run" });
        return;
      }

      // Allow re-execution: return existing execution if found
      if (existingExecution) {
        res.json({ ...existingExecution, resumed: true });
        return;
      }

      // Always attribute execution to the authenticated user (ignore client spoofing)
      const [execution] = await db
        .insert(schema.executions)
        .values({
          test_case_id: testCaseId,
          test_run_id: testRunId,
          tester_id: req.user!.userId,
          tester_name: parsed.tester_name ?? req.user!.username,
          status: "in_progress",
        })
        .returning();

      // Update test run status if needed
      if (testRun.status === "scheduled") {
        await db
          .update(schema.testRuns)
          .set({ status: "in_progress", updated_at: new Date() })
          .where(eq(schema.testRuns.id, testRunId));
      }

      // Sync the parent use case's status so dashboard KPIs stay accurate
      const testCase = await db.query.testCases.findFirst({
        where: eq(schema.testCases.id, testCaseId),
      });
      if (testCase) {
        await syncUseCaseStatus(testRunId, testCase.use_case_id);
      }

      await logAudit({ entityType: "execution", entityId: execution.id, changedByUserId: req.user!.userId, toStatus: "in_progress" });

      res.status(201).json(execution);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/executions/:executionId
router.patch("/executions/:executionId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const executionId = Number(req.params.executionId);
    const parsed = z
      .object({
        status: z.enum(["in_progress", "completed", "failed"]).optional(),
        overall_result: z
          .enum(["passed", "failed", "passed_by_agreement"])
          .optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const execution = await db.query.executions.findFirst({
      where: eq(schema.executions.id, executionId),
      with: { testRun: true, testCase: { with: { useCase: true } } },
    });
    if (!execution) {
      res.status(404).json({ message: "Execution not found" });
      return;
    }

    if (!execution.testRun.entry_confirmed) {
      res.status(403).json({
        message: "Entry criteria not confirmed for this test run",
      });
      return;
    }

    const testerAllowed = await checkProjectRole(req, execution.testRun.project_id, ["TESTER", "TEST_LEAD"]);
    if (!testerAllowed) {
      res.status(403).json({ message: "Forbidden — only TESTER role or higher can execute" });
      return;
    }
    const assigned = await isAssignedTester(execution.test_run_id!, execution.test_case_id, req.user!.userId);
    if (!assigned) {
      res.status(403).json({ message: "Forbidden — you are not assigned to this scenario" });
      return;
    }

    // Retest: blocked / out-of-scope cases cannot be completed or updated
    if (execution.testRun?.run_type === "retest" && execution.test_run_id) {
      const blockReason = await getRetestCaseBlockReason(
        execution.test_run_id,
        execution.test_case_id,
        execution.testRun.run_type,
      );
      if (blockReason) {
        res.status(403).json({ message: blockReason });
        return;
      }
      const inScope = await isTestCaseInRetestScope(
        execution.test_run_id,
        execution.test_case_id,
        execution.testRun.run_type,
      );
      if (!inScope) {
        res.status(403).json({
          message:
            "This test case is not in retest scope. Only Verify or opted-in Regression cases can be executed.",
        });
        return;
      }
    }

    // Check lock BEFORE write so post-sign-off edits cannot stick
    const execTc = await db.query.testCases.findFirst({
      where: eq(schema.testCases.id, execution.test_case_id),
      columns: { use_case_id: true },
    });
    if (execTc) {
      const truc = await db.query.testRunUseCases.findFirst({
        where: and(
          eq(schema.testRunUseCases.test_run_id, execution.test_run_id!),
          eq(schema.testRunUseCases.use_case_id, execTc.use_case_id),
        ),
        columns: { tester_sign_off: true },
      });
      if (truc?.tester_sign_off) {
        res.status(423).json({ message: "Scenario is locked — tester has already signed off" });
        return;
      }
    }

    const oldStatus = execution.status;
    const [updated] = await db
      .update(schema.executions)
      .set({ ...parsed, executed_at: new Date() })
      .where(eq(schema.executions.id, executionId))
      .returning();

    await logAudit({ entityType: "execution", entityId: executionId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: parsed.status });

    if (execTc && execution.test_run_id) {
      await syncUseCaseStatus(execution.test_run_id, execTc.use_case_id);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/executions/:executionId/steps/:stepId/result
router.post(
  "/executions/:executionId/steps/:stepId/result",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const executionId = Number(req.params.executionId);
      const stepId = Number(req.params.stepId);

      const parsed = z
        .object({
          actual_result: z.string().optional(),
          comments: z.string().optional(),
          passed: z.boolean(),
        })
        .parse(req.body);

      const execution = await db.query.executions.findFirst({
        where: eq(schema.executions.id, executionId),
        with: { testRun: true, testCase: true },
      });
      if (!execution) {
        res.status(404).json({ message: "Execution not found" });
        return;
      }

      if (!execution.testRun) {
        res.status(400).json({ message: "Execution has no associated test run" });
        return;
      }
      if (!execution.testRun.entry_confirmed) {
        res.status(403).json({
          message: "Entry criteria not confirmed for this test run",
        });
        return;
      }

      const testerAllowed = await checkProjectRole(req, execution.testRun.project_id, ["TESTER", "TEST_LEAD"]);
      if (!testerAllowed) {
        res.status(403).json({ message: "Forbidden — only TESTER role or higher can execute" });
        return;
      }
      const assigned = await isAssignedTester(execution.test_run_id!, execution.test_case_id, req.user!.userId);
      if (!assigned) {
        res.status(403).json({ message: "Forbidden — you are not assigned to this scenario" });
        return;
      }

      // Retest: blocked / out-of-scope cases cannot record step results
      if (execution.testRun?.run_type === "retest" && execution.test_run_id) {
        const blockReason = await getRetestCaseBlockReason(
          execution.test_run_id,
          execution.test_case_id,
          execution.testRun.run_type,
        );
        if (blockReason) {
          res.status(403).json({ message: blockReason });
          return;
        }
        const inScope = await isTestCaseInRetestScope(
          execution.test_run_id,
          execution.test_case_id,
          execution.testRun.run_type,
        );
        if (!inScope) {
          res.status(403).json({
            message:
              "This test case is not in retest scope. Only Verify or opted-in Regression cases can be executed.",
          });
          return;
        }
      }

      // Check if scenario is locked (tester has signed off)
      const postTc = await db.query.testCases.findFirst({
        where: eq(schema.testCases.id, execution.test_case_id),
        columns: { use_case_id: true },
      });
      if (postTc) {
        const truc = await db.query.testRunUseCases.findFirst({
          where: and(
            eq(schema.testRunUseCases.test_run_id, execution.test_run_id!),
            eq(schema.testRunUseCases.use_case_id, postTc.use_case_id),
          ),
          columns: { tester_sign_off: true },
        });
        if (truc?.tester_sign_off) {
          res.status(423).json({ message: "Scenario is locked — tester has already signed off" });
          return;
        }
      }

      // Upsert: update existing step result or create new one
      const existingResult = await db.query.stepResults.findFirst({
        where: and(
          eq(schema.stepResults.execution_id, executionId),
          eq(schema.stepResults.step_id, stepId),
        ),
        orderBy: desc(schema.stepResults.id),
      });
      console.log(`[exec] POST step result exec=${executionId} step=${stepId} existingResult=${existingResult?.id ?? "none"} body=${JSON.stringify(parsed)}`);

      let stepResult;
      if (existingResult) {
        [stepResult] = await db.update(schema.stepResults)
          .set({
            actual_result: parsed.actual_result,
            comments: parsed.comments,
            passed: parsed.passed,
            recorded_at: new Date(),
          })
          .where(eq(schema.stepResults.id, existingResult.id))
          .returning();
        // Clean up older duplicates
        const delResult = await db.delete(schema.stepResults)
          .where(
            and(
              eq(schema.stepResults.execution_id, executionId),
              eq(schema.stepResults.step_id, stepId),
              sql`${schema.stepResults.id} != ${existingResult.id}`,
            ),
          );
        if (delResult.rowCount && delResult.rowCount > 0) {
          console.log(`[exec] Cleaned up ${delResult.rowCount} older duplicate(s) for exec=${executionId} step=${stepId}`);
        }
      } else {
        [stepResult] = await db
          .insert(schema.stepResults)
          .values({
            execution_id: executionId,
            step_id: stepId,
            actual_result: parsed.actual_result,
            comments: parsed.comments,
            passed: parsed.passed,
          })
          .returning();
        console.log(`[exec] INSERTED new step_result id=${stepResult.id} for exec=${executionId} step=${stepId}`);
      }

      // Sync the parent use case's status so dashboard KPIs stay accurate
      const tc = await db.query.testCases.findFirst({
        where: eq(schema.testCases.id, execution.test_case_id),
      });
      if (tc && execution.test_run_id) {
        await syncUseCaseStatus(execution.test_run_id, tc.use_case_id);
      }

      res.status(existingResult ? 200 : 201).json({ stepResult });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/executions/:executionId/steps/:stepId/result — update existing step result
router.put(
  "/executions/:executionId/steps/:stepId/result",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const executionId = Number(req.params.executionId);
      const stepId = Number(req.params.stepId);

      const parsed = z
        .object({
          actual_result: z.string().optional(),
          comments: z.string().optional(),
          passed: z.boolean().optional(),
        })
        .parse(req.body);

      const existing = await db.query.stepResults.findFirst({
        where: and(
          eq(schema.stepResults.execution_id, executionId),
          eq(schema.stepResults.step_id, stepId),
        ),
        orderBy: desc(schema.stepResults.id),
      });
      if (!existing) {
        res.status(404).json({ message: "Step result not found. Use POST to create." });
        return;
      }

      const exec = await db.query.executions.findFirst({
        where: eq(schema.executions.id, executionId),
        with: { testRun: true },
      });
      if (!exec?.testRun) {
        res.status(400).json({ message: "Execution has no associated test run" });
        return;
      }
      if (!exec.testRun.entry_confirmed) {
        res.status(403).json({ message: "Entry criteria not confirmed for this test run" });
        return;
      }
      const testerAllowed = await checkProjectRole(req, exec.testRun.project_id, ["TESTER", "TEST_LEAD"]);
      if (!testerAllowed) {
        res.status(403).json({ message: "Forbidden — only TESTER role or higher can execute" });
        return;
      }
      const assigned = await isAssignedTester(exec.test_run_id!, exec.test_case_id, req.user!.userId);
      if (!assigned) {
        res.status(403).json({ message: "Forbidden — you are not assigned to this scenario" });
        return;
      }

      // Retest: blocked / out-of-scope cases cannot update step results
      if (exec.testRun?.run_type === "retest" && exec.test_run_id) {
        const blockReason = await getRetestCaseBlockReason(
          exec.test_run_id,
          exec.test_case_id,
          exec.testRun.run_type,
        );
        if (blockReason) {
          res.status(403).json({ message: blockReason });
          return;
        }
        const inScope = await isTestCaseInRetestScope(
          exec.test_run_id,
          exec.test_case_id,
          exec.testRun.run_type,
        );
        if (!inScope) {
          res.status(403).json({
            message:
              "This test case is not in retest scope. Only Verify or opted-in Regression cases can be executed.",
          });
          return;
        }
      }

      // Check if scenario is locked (tester has signed off)
      const putTc = await db.query.testCases.findFirst({
        where: eq(schema.testCases.id, exec.test_case_id),
        columns: { use_case_id: true },
      });
      if (putTc) {
        const truc = await db.query.testRunUseCases.findFirst({
          where: and(
            eq(schema.testRunUseCases.test_run_id, exec.test_run_id!),
            eq(schema.testRunUseCases.use_case_id, putTc.use_case_id),
          ),
          columns: { tester_sign_off: true },
        });
        if (truc?.tester_sign_off) {
          res.status(423).json({ message: "Scenario is locked — tester has already signed off" });
          return;
        }
      }

      console.log(`[exec] PUT step result exec=${executionId} step=${stepId} existingId=${existing.id} body=${JSON.stringify(parsed)}`);

      const [updated] = await db.update(schema.stepResults)
        .set({
          ...parsed,
          recorded_at: new Date(),
        })
        .where(eq(schema.stepResults.id, existing.id))
        .returning();

      // Clean up older duplicate step results for this execution+step
      const delResult = await db.delete(schema.stepResults)
        .where(
          and(
            eq(schema.stepResults.execution_id, executionId),
            eq(schema.stepResults.step_id, stepId),
            sql`${schema.stepResults.id} != ${existing.id}`,
          ),
        );
      if (delResult.rowCount && delResult.rowCount > 0) {
        console.log(`[exec] PUT cleaned up ${delResult.rowCount} older duplicate(s) for exec=${executionId} step=${stepId}`);
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/test-runs/:testRunId/progress — compute progress at all levels
router.get("/test-runs/:testRunId/progress", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    if (!(await denyUnlessProjectAccess(req, res, await projectIdFromTestRun(testRunId)))) return;
    const testRun = await db.query.testRuns.findFirst({
      where: eq(schema.testRuns.id, testRunId),
      with: {
        executions: { with: { stepResults: true, testCase: true } },
        useCases: { with: { useCase: { with: { testCases: true } } } },
      },
    });
    if (!testRun) {
      res.status(404).json({ message: "Test run not found" });
      return;
    }

    const retestScope =
      testRun.run_type === "retest" ? await getRetestScope(testRunId) : null;
    const allowedCaseIds = retestScope ? new Set(retestScope.testCaseIds) : null;

    const allExecutions = (testRun.executions ?? []).filter(
      (e) => !allowedCaseIds || allowedCaseIds.has(e.test_case_id),
    );

    // Test case progress
    const caseProgressMap = new Map<number, string>();
    for (const exec of allExecutions) {
      caseProgressMap.set(exec.test_case_id, await computeExecutionProgress(exec.id));
    }
    // Ensure enrolled cases with no execution show as Not Started
    if (allowedCaseIds) {
      for (const tcId of allowedCaseIds) {
        if (!caseProgressMap.has(tcId)) caseProgressMap.set(tcId, "Not Started");
      }
    }

    // Scenario progress (retest: only enrolled cases count)
    const scenarioProgressMap = new Map<number, string>();
    for (const truc of testRun.useCases ?? []) {
      if (!truc.useCase) continue;
      let cases = truc.useCase.testCases ?? [];
      if (allowedCaseIds) {
        cases = cases.filter((tc) => allowedCaseIds.has(tc.id));
      }
      const progresses: string[] = [];
      for (const tc of cases) {
        const p = caseProgressMap.get(tc.id) ?? "Not Started";
        progresses.push(p);
      }
      if (progresses.length === 0) {
        scenarioProgressMap.set(truc.use_case_id, "Not Started");
      } else if (progresses.every(p => p === "Completed")) {
        scenarioProgressMap.set(truc.use_case_id, "Completed");
      } else if (progresses.some(p => p === "In Progress" || p === "Completed")) {
        scenarioProgressMap.set(truc.use_case_id, "In Progress");
      } else {
        scenarioProgressMap.set(truc.use_case_id, "Not Started");
      }
    }

    // Test run progress
    const scenarioProgresses = Array.from(scenarioProgressMap.values());
    let runProgress: string;
    if (scenarioProgresses.length === 0) {
      runProgress = "Not Started";
    } else if (scenarioProgresses.every(p => p === "Completed")) {
      runProgress = "Completed";
    } else if (scenarioProgresses.some(p => p === "In Progress" || p === "Completed")) {
      runProgress = "In Progress";
    } else {
      runProgress = "Not Started";
    }

    res.json({
      testRunProgress: runProgress,
      scenarioProgress: Object.fromEntries(scenarioProgressMap),
      caseProgress: Object.fromEntries(caseProgressMap),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/test-runs/:testRunId/submit — submit the entire test run
router.post("/test-runs/:testRunId/submit", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRun = await db.query.testRuns.findFirst({
      where: eq(schema.testRuns.id, testRunId),
    });
    if (!testRun) {
      res.status(404).json({ message: "Test run not found" });
      return;
    }

    // Guard: entry must be confirmed
    if (!testRun.entry_confirmed) {
      res.status(403).json({ message: "Entry criteria not confirmed for this test run" });
      return;
    }

    // Guard: must be tester or test lead
    const testerAllowed = await checkProjectRole(req, testRun.project_id, ["TESTER", "TEST_LEAD"]);
    if (!testerAllowed) {
      res.status(403).json({ message: "Forbidden — only TESTER role or higher can submit" });
      return;
    }

    // Guard: must not already be completed
    if (testRun.status === "completed") {
      res.status(403).json({ message: "Test run is already completed" });
      return;
    }

    // Only check use cases assigned to this user — no one may submit
    // scenarios they are not personally assigned to.
    const allUseCases = await db.query.testRunUseCases.findMany({
      where: and(
        eq(schema.testRunUseCases.test_run_id, testRunId),
        eq(schema.testRunUseCases.assigned_tester_id, req.user!.userId),
      ),
      with: { useCase: { with: { testCases: true } } },
    });

    // Phase A+B: retest runs only require executable cases (verify + regression)
    const retestScope =
      testRun.run_type === "retest" ? await getRetestScope(testRunId) : null;
    const retestCaseIdSet = retestScope ? new Set(retestScope.testCaseIds) : null;
    const retestVerifyCaseIds = retestScope ? new Set(retestScope.verifyCaseIds) : null;

    // Collect test case IDs scoped to the user's assigned use cases (and retest scope)
    let userTcIds = allUseCases.flatMap(
      (truc) => truc.useCase?.testCases.map((tc) => tc.id) ?? [],
    );
    if (retestCaseIdSet) {
      userTcIds = userTcIds.filter((id) => retestCaseIdSet.has(id));
    }

    const allExecutions = userTcIds.length > 0
      ? await db.query.executions.findMany({
          where: and(
            eq(schema.executions.test_run_id, testRunId),
            inArray(schema.executions.test_case_id, userTcIds),
          ),
          with: {
            stepResults: true,
            testCase: { with: { steps: true, useCase: true } },
          },
        })
      : [];

    const incompleteCases: string[] = [];

    for (const truc of allUseCases) {
      if (!truc.useCase) continue;
      for (const tc of truc.useCase.testCases) {
        // Skip out-of-scope cases on retest runs
        if (retestCaseIdSet && !retestCaseIdSet.has(tc.id)) continue;
        const exec = allExecutions.find((e) => e.test_case_id === tc.id);
        if (!exec) {
          incompleteCases.push(`${tc.case_number} — ${tc.title} (Not Started)`);
          continue;
        }
        const progress = await computeExecutionProgress(exec.id);
        if (progress !== "Completed") {
          incompleteCases.push(`${tc.case_number} — ${tc.title} (${progress})`);
        }
      }
    }

    if (incompleteCases.length > 0) {
      const details = incompleteCases.join("\n");
      res.status(400).json({
        message: `Cannot submit: some test cases are not completed\n${details}`,
        incompleteCases,
      });
      return;
    }

    // Determine overall pass/fail: any step failed => run failed
    let anyStepFailed = false;
    for (const exec of allExecutions) {
      for (const sr of exec.stepResults ?? []) {
        if (sr.passed === false) {
          anyStepFailed = true;
          break;
        }
      }
      if (anyStepFailed) break;
    }

    const projectId = testRun.project_id;
    const userId = req.user!.userId;

    const submitResult = await db.transaction(async (tx) => {
      // Lock the run row so concurrent submits serialize
      const [lockedRun] = await tx
        .select()
        .from(schema.testRuns)
        .where(eq(schema.testRuns.id, testRunId))
        .for("update");
      if (!lockedRun) {
        throw Object.assign(new Error("Test run not found"), { status: 404 });
      }
      if (lockedRun.status === "completed") {
        throw Object.assign(new Error("Test run is already completed"), { status: 403 });
      }

      // Set overall_result on each execution based on its step results
      for (const exec of allExecutions) {
        const stepResults = exec.stepResults ?? [];
        const steps = exec.testCase?.steps ?? [];
        if (steps.length === 0) continue;
        const hasFailed = stepResults.some((sr) => sr.passed === false);
        const overallResult = hasFailed ? "failed" : "passed";
        exec.overall_result = overallResult;
        await tx
          .update(schema.executions)
          .set({
            overall_result: overallResult,
            status: "completed",
            executed_at: new Date(),
          })
          .where(eq(schema.executions.id, exec.id));
      }

      // Serialize bug numbers for this project
      await tx.execute(sql`SELECT id FROM defects WHERE project_id = ${projectId} FOR UPDATE`);
      const maxBugRows = await tx
        .select({ max: sql<number>`COALESCE(MAX(${schema.defects.bug_number}), 0)` })
        .from(schema.defects)
        .where(eq(schema.defects.project_id, projectId));
      let nextBugNumber = Number(maxBugRows[0]?.max ?? 0) + 1;

      const createdDefects: { id: number; bug_number: number | null }[] = [];

      // Phase A+B: retest must NOT open NEW for verify cases (auto-regress instead).
      // Regression opt-in cases may still create NEW defects on failure.
      const verifyCaseIds = retestVerifyCaseIds ?? new Set<number>();

      // Case-level defects: one NEW defect per failed test case (not per failed step)
      for (const exec of allExecutions) {
        if (exec.overall_result !== "failed") continue;
        if (lockedRun.run_type === "retest" && verifyCaseIds.has(exec.test_case_id)) {
          continue;
        }

        const failedSteps = (exec.stepResults ?? []).filter((sr) => sr.passed === false);
        if (failedSteps.length === 0) continue;

        // Idempotent: skip if a NEW defect already exists for this execution+case
        const existing = await tx.query.defects.findFirst({
          where: and(
            eq(schema.defects.execution_id, exec.id),
            eq(schema.defects.test_case_id, exec.test_case_id),
            eq(schema.defects.status, "NEW"),
          ),
          columns: { id: true },
        });
        if (existing) continue;

        const stepLines = failedSteps.map((sr) => {
          const step = exec.testCase?.steps?.find((s) => s.id === sr.step_id);
          const parts = [
            step ? `Step ${step.step_number}: ${step.instruction}` : `Step #${sr.step_id}`,
            sr.actual_result ? `Actual Result: ${sr.actual_result}` : null,
            sr.comments ? `Comments: ${sr.comments}` : null,
          ].filter(Boolean);
          return parts.join("\n");
        });

        const notes = [
          `Auto-created from test run submission`,
          `Test Case: ${exec.testCase?.case_number ?? ""} — ${exec.testCase?.title ?? ""}`,
          `Failed steps (${failedSteps.length}):`,
          ...stepLines,
        ]
          .filter(Boolean)
          .join("\n");

        const [defect] = await tx
          .insert(schema.defects)
          .values({
            project_id: projectId,
            bug_number: nextBugNumber++,
            test_run_id: testRunId,
            test_case_id: exec.test_case_id,
            execution_id: exec.id,
            status: "NEW",
            tester_notes: notes,
          })
          .returning();
        createdDefects.push(defect);
      }

      // Lock submitted scenarios
      const userUseCaseIds = allUseCases.map((truc) => truc.id);
      if (userUseCaseIds.length > 0) {
        await tx
          .update(schema.testRunUseCases)
          .set({ tester_sign_off: true, tester_sign_off_at: new Date() })
          .where(inArray(schema.testRunUseCases.id, userUseCaseIds));
      }

      // Retest auto-resolve: only defects enrolled in THIS run (via defect_retests)
      if (lockedRun.run_type === "retest" && retestScope && retestScope.defectIds.length > 0) {
        const executionResultByTestCaseId = new Map<number, "passed" | "failed">();
        for (const e of allExecutions) {
          executionResultByTestCaseId.set(
            e.test_case_id,
            e.overall_result === "failed" ? "failed" : "passed",
          );
        }

        const linkedDefects = await tx
          .select()
          .from(schema.defects)
          .where(
            and(
              inArray(schema.defects.id, retestScope.defectIds),
              eq(schema.defects.status, "READY_FOR_VERIFICATION"),
            ),
          )
          .for("update");

        for (const defect of linkedDefects) {
          // Only resolve if this user's submit covered the case
          if (!userTcIds.includes(defect.test_case_id)) continue;
          const result: "passed" | "failed" =
            executionResultByTestCaseId.get(defect.test_case_id) ?? "passed";

          const oldStatus = "READY_FOR_VERIFICATION";
          if (result === "passed") {
            await tx
              .update(schema.defects)
              .set({
                status: "CLOSED",
                regression_index: 0,
                updated_at: new Date(),
                closed_at: new Date(),
              })
              .where(
                and(
                  eq(schema.defects.id, defect.id),
                  eq(schema.defects.status, "READY_FOR_VERIFICATION"),
                ),
              );
            await logAudit({ entityType: "defect", entityId: defect.id, changedByUserId: userId, fromStatus: oldStatus, toStatus: "CLOSED" });
            await logSystemNote(defect.id, oldStatus, "CLOSED", userId);
          } else {
            await tx
              .update(schema.defects)
              .set({
                status: "REGRESSED",
                regression_index: sql`${schema.defects.regression_index} + 1`,
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(schema.defects.id, defect.id),
                  eq(schema.defects.status, "READY_FOR_VERIFICATION"),
                ),
              );
            await logAudit({ entityType: "defect", entityId: defect.id, changedByUserId: userId, fromStatus: oldStatus, toStatus: "REGRESSED" });
            await logSystemNote(defect.id, oldStatus, "REGRESSED", userId);
          }

          // Record result on the enrollment row
          await tx
            .update(schema.defectRetests)
            .set({
              retest_result: result,
              retested_by_user_id: userId,
              retested_at: new Date(),
            })
            .where(
              and(
                eq(schema.defectRetests.defect_id, defect.id),
                eq(schema.defectRetests.target_verification_run_id, testRunId),
              ),
            );
        }
      }

      const allRunUseCases = await tx.query.testRunUseCases.findMany({
        where: eq(schema.testRunUseCases.test_run_id, testRunId),
        columns: { tester_sign_off: true },
      });
      const allSignedOff =
        allRunUseCases.length > 0 && allRunUseCases.every((uc) => uc.tester_sign_off);

      if (allSignedOff) {
        const allExecs = await tx.query.executions.findMany({
          where: eq(schema.executions.test_run_id, testRunId),
          columns: { overall_result: true },
        });
        const allPassed =
          allExecs.length > 0 &&
          allExecs.every(
            (e) => e.overall_result === "passed" || e.overall_result === "passed_by_agreement",
          );
        await tx
          .update(schema.testRuns)
          .set({
            status: "completed",
            passed: allPassed,
            updated_at: new Date(),
          })
          .where(eq(schema.testRuns.id, testRunId));
      }

      return {
        createdDefects,
        allSignedOff,
        signedOffCount: allRunUseCases.filter((uc) => uc.tester_sign_off).length,
        totalUseCases: allRunUseCases.length,
        runStatusBefore: lockedRun.status,
        runName: lockedRun.name,
        isRetest: lockedRun.run_type === "retest",
      };
    });

    // Post-commit audit/notes (best-effort; data is already consistent)
    for (const defect of submitResult.createdDefects) {
      await logSystemNote(defect.id, null, "NEW", userId);
    }
    for (const truc of allUseCases) {
      if (truc.useCase) {
        await syncUseCaseStatus(testRunId, truc.useCase.id);
      }
    }

    if (submitResult.allSignedOff) {
      await logAudit({
        entityType: "test_run",
        entityId: testRunId,
        changedByUserId: userId,
        fromStatus: submitResult.runStatusBefore,
        toStatus: "completed",
        reason: anyStepFailed
          ? `Submitted — ${submitResult.createdDefects.length} defect(s) created for failed test cases`
          : "Submitted — all steps passed",
      });
    } else {
      await logAudit({
        entityType: "test_run",
        entityId: testRunId,
        changedByUserId: userId,
        fromStatus: submitResult.runStatusBefore,
        toStatus: "in_progress",
        reason: `Partial submit — ${submitResult.createdDefects.length} defect(s) created, ${submitResult.signedOffCount}/${submitResult.totalUseCases} scenarios signed off`,
      });
    }

    res.json({
      message: submitResult.allSignedOff
        ? "Test run completed"
        : "Your scenarios submitted — waiting for other testers",
      passed: !anyStepFailed,
      defectsCreated: submitResult.createdDefects.length,
      testRunId,
      allSignedOff: submitResult.allSignedOff,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status && err instanceof Error) {
      res.status(status).json({ message: err.message });
      return;
    }
    next(err);
  }
});

export default router;

/* ────────────────────────────────────────────────────────────────────
   Assignment guard — only the user assigned to a scenario may
   execute its test cases, record step results, or submit.
   ──────────────────────────────────────────────────────────────────── */

async function isAssignedTester(
  testRunId: number,
  testCaseId: number,
  userId: number,
): Promise<boolean> {
  const testCase = await db.query.testCases.findFirst({
    where: eq(schema.testCases.id, testCaseId),
    columns: { use_case_id: true },
  });
  if (!testCase) return false;

  const truc = await db.query.testRunUseCases.findFirst({
    where: and(
      eq(schema.testRunUseCases.test_run_id, testRunId),
      eq(schema.testRunUseCases.use_case_id, testCase.use_case_id),
    ),
    columns: { assigned_tester_id: true },
  });

  return truc?.assigned_tester_id === userId;
}
