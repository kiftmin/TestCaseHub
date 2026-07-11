import express from "express";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";
import { logAudit, logSystemNote } from "../utils/project.js";
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
router.get("/dashboard/tester/:userId/test-runs", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);

    // Return ONLY scenarios explicitly assigned to this tester.
    // This enforces that testers can only see and act on their own work.
    const myUseCases = await db.query.testRunUseCases.findMany({
      where: eq(schema.testRunUseCases.assigned_tester_id, userId),
      with: {
        testRun: {
          with: {
            project: true,
            // Only fetch executions for this tester's test cases
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

      // Guard: Must be assigned as tester to this scenario
      const testerAllowed = await checkProjectRole(req, testRun.project_id, ["TESTER", "TEST_LEAD"]);
      if (!testerAllowed) {
        res.status(403).json({ message: "Forbidden — only TESTER role or higher can execute" });
        return;
      }
      const assigned = await isAssignedTester(testRunId, testCaseId, req.user!.userId);
      if (!assigned) {
        res.status(403).json({ message: "Forbidden — you are not assigned to this scenario" });
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
    const assigned = await isAssignedTester(execution.test_run_id!, execution.test_case_id, req.user!.userId);
    if (!assigned) {
      res.status(403).json({ message: "Forbidden — you are not assigned to this scenario" });
      return;
    }

    const oldStatus = execution.status;
    const [updated] = await db
      .update(schema.executions)
      .set({ ...parsed, executed_at: new Date() })
      .where(eq(schema.executions.id, executionId))
      .returning();

    // Check if scenario is locked (tester has signed off) — no further edits allowed
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

    await logAudit({ entityType: "execution", entityId: executionId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: parsed.status });

    // Sync the parent use case's status so dashboard KPIs stay accurate
    const tc = execTc || await db.query.testCases.findFirst({
      where: eq(schema.testCases.id, execution.test_case_id),
    });
    if (tc && execution.test_run_id) {
      await syncUseCaseStatus(execution.test_run_id, tc.use_case_id);
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

    // Only check use cases assigned to this user — no one may submit
    // scenarios they are not personally assigned to.
    const allUseCases = await db.query.testRunUseCases.findMany({
      where: and(
        eq(schema.testRunUseCases.test_run_id, testRunId),
        eq(schema.testRunUseCases.assigned_tester_id, req.user!.userId),
      ),
      with: { useCase: { with: { testCases: true } } },
    });

    // Collect test case IDs scoped to the user's assigned use cases
    const userTcIds = allUseCases.flatMap(
      truc => truc.useCase?.testCases.map(tc => tc.id) ?? [],
    );

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
          await logSystemNote(defect.id, null, "NEW", req.user!.userId);
        }
      }
    }

    // Sync use case statuses
    for (const truc of allUseCases) {
      if (truc.useCase) {
        await syncUseCaseStatus(testRunId, truc.useCase.id);
      }
    }

    // Lock all submitted scenarios — no further step/execution edits allowed
    const userUseCaseIds = allUseCases.map(truc => truc.id);
    if (userUseCaseIds.length > 0) {
      await db.update(schema.testRunUseCases)
        .set({ tester_sign_off: true, tester_sign_off_at: new Date() })
        .where(inArray(schema.testRunUseCases.id, userUseCaseIds));
    }

    // Auto-resolve defects if this is a retest run
    const testRunFull = await db.query.testRuns.findFirst({
      where: eq(schema.testRuns.id, testRunId),
    });

    if (testRunFull?.run_type === "retest") {
      for (const truc of allUseCases) {
        const useCaseId = truc.use_case_id;

        // Find the test case IDs in this use case
        const ucTestCaseIds = truc.useCase?.testCases.map(tc => tc.id) ?? [];

        // Find READY_FOR_VERIFICATION defects for these test cases
        const linkedDefects = ucTestCaseIds.length > 0
          ? await db.query.defects.findMany({
              where: and(
                eq(schema.defects.project_id, testRunFull.project_id),
                eq(schema.defects.status, "READY_FOR_VERIFICATION"),
                inArray(schema.defects.test_case_id, ucTestCaseIds),
              ),
            })
          : [];

        if (linkedDefects.length === 0) continue;

        // Build a lookup of test_case_id → execution result for this use case.
        // Each defect is resolved based on its OWN test case's result — not the
        // scenario-level overall — so that a failure in test case B does not
        // incorrectly penalise a READY_FOR_VERIFICATION defect linked to test case A
        // (whose fix may be correct) or bump the regression_index of a defect that
        // is still being fixed on an unrelated test case in the same scenario.
        const executionResultByTestCaseId = new Map<number, "passed" | "failed">();
        for (const e of allExecutions) {
          if (ucTestCaseIds.includes(e.test_case_id)) {
            executionResultByTestCaseId.set(
              e.test_case_id,
              e.overall_result === "failed" ? "failed" : "passed",
            );
          }
        }

        // Resolve each READY_FOR_VERIFICATION defect using only its own test case result.
        for (const defect of linkedDefects) {
          const result: "passed" | "failed" =
            executionResultByTestCaseId.get(defect.test_case_id) ?? "passed";

          if (result === "passed") {
            await db.update(schema.defects)
              .set({
                status: "CLOSED",
                regression_index: 0,
                updated_at: new Date(),
                closed_at: new Date(),
              })
              .where(eq(schema.defects.id, defect.id));
          } else {
            await db.update(schema.defects)
              .set({
                status: "REGRESSED",
                regression_index: sql`${schema.defects.regression_index} + 1`,
                updated_at: new Date(),
              })
              .where(eq(schema.defects.id, defect.id));
          }

          const noteMessage = `Auto-resolved from retest run "${testRunFull.name}" — this defect's test case ${result === "passed" ? "passed" : "failed"}.`;
          await logSystemNote(defect.id, "READY_FOR_VERIFICATION", result === "passed" ? "CLOSED" : "REGRESSED", req.user!.userId, noteMessage);

          await logAudit({
            entityType: "defect",
            entityId: defect.id,
            changedByUserId: req.user!.userId,
            fromStatus: "READY_FOR_VERIFICATION",
            toStatus: result === "passed" ? "CLOSED" : "REGRESSED",
            reason: `Auto-resolved from retest run ${testRunId} — test case ${defect.test_case_id} ${result}`,
          });
        }
      }
    }

    // Check if all use cases in the test run are signed off
    const allRunUseCases = await db.query.testRunUseCases.findMany({
      where: eq(schema.testRunUseCases.test_run_id, testRunId),
      columns: { tester_sign_off: true },
    });
    const allSignedOff = allRunUseCases.length > 0 && allRunUseCases.every(uc => uc.tester_sign_off);

    if (allSignedOff) {
      // Determine overall pass/fail across all executions in the run
      const allExecs = await db.query.executions.findMany({
        where: eq(schema.executions.test_run_id, testRunId),
        columns: { overall_result: true },
      });
      const anyFailed = allExecs.some(e => e.overall_result === "failed" || e.overall_result === "passed_by_agreement");
      const allPassed = allExecs.length > 0 && allExecs.every(e => e.overall_result === "passed" || e.overall_result === "passed_by_agreement");

      await db.update(schema.testRuns)
        .set({
          status: "completed",
          passed: allPassed,
          updated_at: new Date(),
        })
        .where(eq(schema.testRuns.id, testRunId));

      await logAudit({
        entityType: "test_run",
        entityId: testRunId,
        changedByUserId: req.user!.userId,
        fromStatus: testRun.status,
        toStatus: "completed",
        reason: anyFailed
          ? `Submitted — ${createdDefects.length} defect(s) created for failed steps`
          : "Submitted — all steps passed",
      });
    } else {
      await logAudit({
        entityType: "test_run",
        entityId: testRunId,
        changedByUserId: req.user!.userId,
        fromStatus: testRun.status,
        toStatus: "in_progress",
        reason: `Partial submit — ${createdDefects.length} defect(s) created, ${allRunUseCases.filter(uc => uc.tester_sign_off).length}/${allRunUseCases.length} scenarios signed off`,
      });
    }

    res.json({
      message: allSignedOff ? "Test run completed" : "Your scenarios submitted — waiting for other testers",
      passed: !anyStepFailed,
      defectsCreated: createdDefects.length,
      testRunId,
      allSignedOff,
    });
  } catch (err) {
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
