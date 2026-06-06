import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";
import { logAudit } from "../utils/project.js";
import { syncUseCaseStatus } from "./test-runs.js";

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
        ? sql`${schema.executions.test_case_id} IN (${sql.join(testCaseIds, sql`,`)})`
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
router.get("/dashboard/tester/:userId/test-runs", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);

    const assignedUseCases = await db.query.testRunUseCases.findMany({
      where: eq(schema.testRunUseCases.assigned_tester_id, userId),
      with: {
        testRun: {
          with: {
            project: true,
            executions: {
              with: {
                stepResults: true,
              },
            },
          },
        },
        useCase: { with: { testCases: { with: { steps: true } } } },
      },
    });

    res.json(assignedUseCases);
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

      // Guard: Must be assigned as tester or TEST_LEAD/ADMIN
      const testerAllowed = await checkProjectRole(req, testRun.project_id, ["TESTER", "TEST_LEAD"]);
      if (!testerAllowed) {
        res.status(403).json({ message: "Forbidden — only TESTER role or higher can execute" });
        return;
      }

      // Guard: Cannot execute on a completed run
      if (testRun.status === "completed") {
        res.status(403).json({ message: "Cannot execute on a completed test run" });
        return;
      }

      // Allow re-execution: return existing execution if found
      const existingExecution = await db.query.executions.findFirst({
        where: and(
          eq(schema.executions.test_run_id, testRunId),
          eq(schema.executions.test_case_id, testCaseId),
        ),
        with: { stepResults: true },
      });
      if (existingExecution) {
        res.json({ ...existingExecution, resumed: true });
        return;
      }

      const [execution] = await db
        .insert(schema.executions)
        .values({
          test_case_id: testCaseId,
          test_run_id: testRunId,
          tester_id: parsed.tester_id,
          tester_name: parsed.tester_name,
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

    const oldStatus = execution.status;
    const [updated] = await db
      .update(schema.executions)
      .set({ ...parsed, executed_at: new Date() })
      .where(eq(schema.executions.id, executionId))
      .returning();

    // Auto-create defect on failure — only if one doesn't already exist for this execution
    let defect = null;
    if (parsed.overall_result === "failed") {
      const projectId = execution.testRun?.project_id;
      if (!projectId) {
        res.status(400).json({ message: "Cannot create defect: test run has no project" });
        return;
      }
      const existingDefect = await db.query.defects.findFirst({
        where: eq(schema.defects.execution_id, executionId),
      });
      if (!existingDefect) {
        const maxBug = await db
          .select({ max: sql`COALESCE(MAX(bug_number), 0)` })
          .from(schema.defects)
          .where(eq(schema.defects.project_id, projectId));
        const nextBugNumber = (maxBug[0]?.max as number ?? 0) + 1;
        [defect] = await db
          .insert(schema.defects)
          .values({
            project_id: projectId,
            bug_number: nextBugNumber,
            test_run_id: execution.test_run_id!,
            test_case_id: execution.test_case_id,
            execution_id: executionId,
            tester_notes: parsed.notes || "Auto-created from failed execution",
          })
          .returning();
      } else {
        defect = existingDefect;
      }
    }

    await logAudit({ entityType: "execution", entityId: executionId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: parsed.status });

    // Sync the parent use case's status so dashboard KPIs stay accurate
    const tc = await db.query.testCases.findFirst({
      where: eq(schema.testCases.id, execution.test_case_id),
    });
    if (tc && execution.test_run_id) {
      await syncUseCaseStatus(execution.test_run_id, tc.use_case_id);
    }

    res.json({ ...updated, defect: defect || undefined });
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

    const allExecutions = testRun.executions ?? [];

    // Test case progress
    const caseProgressMap = new Map<number, string>();
    for (const exec of allExecutions) {
      caseProgressMap.set(exec.test_case_id, await computeExecutionProgress(exec.id));
    }

    // Scenario progress
    const scenarioProgressMap = new Map<number, string>();
    for (const truc of testRun.useCases ?? []) {
      if (!truc.useCase) continue;
      const cases = truc.useCase.testCases ?? [];
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

    // Gather all executions with step results and test cases with steps
    const allExecutions = await db.query.executions.findMany({
      where: eq(schema.executions.test_run_id, testRunId),
      with: {
        stepResults: true,
        testCase: { with: { steps: true, useCase: true } },
      },
    });

    // Check every test case in every scenario has Completed progress
    const allUseCases = await db.query.testRunUseCases.findMany({
      where: eq(schema.testRunUseCases.test_run_id, testRunId),
      with: { useCase: { with: { testCases: true } } },
    });

    const incompleteCases: string[] = [];

    for (const truc of allUseCases) {
      if (!truc.useCase) continue;
      for (const tc of truc.useCase.testCases) {
        const exec = allExecutions.find(e => e.test_case_id === tc.id);
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
      res.status(400).json({
        message: "Cannot submit: some test cases are not completed",
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

    // Set overall_result on each execution based on its step results
    for (const exec of allExecutions) {
      const stepResults = exec.stepResults ?? [];
      const steps = exec.testCase?.steps ?? [];
      if (steps.length === 0) continue;
      const hasFailed = stepResults.some(sr => sr.passed === false);
      const overallResult = hasFailed ? "failed" : "passed";

      // Only update if not already set
      if (exec.overall_result !== overallResult) {
        await db.update(schema.executions)
          .set({
            overall_result: overallResult,
            status: "completed",
            executed_at: new Date(),
          })
          .where(eq(schema.executions.id, exec.id));
      }
    }

    // Create defects for every failed step
    const projectId = testRun.project_id;
    const maxBug = await db
      .select({ max: sql`COALESCE(MAX(bug_number), 0)` })
      .from(schema.defects)
      .where(eq(schema.defects.project_id, projectId));
    let nextBugNumber = (maxBug[0]?.max as number ?? 0) + 1;

    const createdDefects: any[] = [];

    for (const exec of allExecutions) {
      for (const sr of exec.stepResults ?? []) {
        if (sr.passed === false) {
          const step = exec.testCase?.steps?.find(s => s.id === sr.step_id);
          const notes = [
            `Auto-created from test run submission`,
            `Test Case: ${exec.testCase?.case_number ?? ""} — ${exec.testCase?.title ?? ""}`,
            step ? `Step ${step.step_number}: ${step.instruction}` : "",
            sr.actual_result ? `Actual Result: ${sr.actual_result}` : "",
            sr.comments ? `Comments: ${sr.comments}` : "",
          ].filter(Boolean).join("\n");

          const [defect] = await db.insert(schema.defects)
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
      }
    }

    // Mark test run as completed
    const oldStatus = testRun.status;
    await db.update(schema.testRuns)
      .set({
        status: "completed",
        passed: !anyStepFailed,
        updated_at: new Date(),
      })
      .where(eq(schema.testRuns.id, testRunId));

    await logAudit({
      entityType: "test_run",
      entityId: testRunId,
      changedByUserId: req.user!.userId,
      fromStatus: oldStatus,
      toStatus: "completed",
      reason: anyStepFailed
        ? `Submitted — ${createdDefects.length} defect(s) created for failed steps`
        : "Submitted — all steps passed",
    });

    // Sync use case statuses
    for (const truc of allUseCases) {
      if (truc.useCase) {
        await syncUseCaseStatus(testRunId, truc.useCase.id);
      }
    }

    res.json({
      message: "Test run submitted successfully",
      passed: !anyStepFailed,
      defectsCreated: createdDefects.length,
      testRunId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
