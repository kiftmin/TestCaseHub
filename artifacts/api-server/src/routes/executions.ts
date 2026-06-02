import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";
import { logAudit } from "../utils/project.js";

const router = express.Router();

// GET /api/dashboard/tester/:userId/test-runs
router.get("/dashboard/tester/:userId/test-runs", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);

    const assignedUseCases = await db.query.testRunUseCases.findMany({
      where: eq(schema.testRunUseCases.assigned_tester_id, userId),
      with: { testRun: { with: { project: true } }, useCase: true },
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

      // Guard: Cannot execute on a completed run
      if (testRun.status === "completed") {
        res.status(403).json({ message: "Cannot execute on a completed test run" });
        return;
      }

      // Guard: No duplicate execution per test case in same run
      const existingExecution = await db.query.executions.findFirst({
        where: and(
          eq(schema.executions.test_run_id, testRunId),
          eq(schema.executions.test_case_id, testCaseId),
        ),
      });
      if (existingExecution) {
        res.status(403).json({ message: "Test case has already been executed in this test run" });
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

    const oldStatus = execution.status;
    const [updated] = await db
      .update(schema.executions)
      .set({ ...parsed, executed_at: new Date() })
      .where(eq(schema.executions.id, executionId))
      .returning();

    // Auto-create defect on failure — unconditional (spec §7.8)
    let defect = null;
    if (parsed.overall_result === "failed") {
      [defect] = await db
        .insert(schema.defects)
        .values({
          test_run_id: execution.test_run_id!,
          test_case_id: execution.test_case_id,
          execution_id: executionId,
          tester_notes: parsed.notes || "Auto-created from failed execution",
          status: "New Defect",
        })
        .returning();
    }

    await logAudit({ entityType: "execution", entityId: executionId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: parsed.status });

    // After execution update, check if test run should auto-complete
    if (parsed.status === "completed" || parsed.status === "failed") {
      const testRunId = execution.test_run_id;
      const allUseCases = await db.query.testRunUseCases.findMany({
        where: eq(schema.testRunUseCases.test_run_id, testRunId),
      });
      const terminalStatuses = ["passed", "failed", "passed_by_agreement"];
      const allTerminal = allUseCases.length > 0 && allUseCases.every(uc => terminalStatuses.includes(uc.status));
      if (allTerminal) {
        const allPassed = allUseCases.every(uc => uc.status === "passed" || uc.status === "passed_by_agreement" || uc.free_pass);
        await db.update(schema.testRuns)
          .set({ status: "completed", passed: allPassed, updated_at: new Date() })
          .where(eq(schema.testRuns.id, testRunId));
      }
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

      if (!execution.testRun.entry_confirmed) {
        res.status(403).json({
          message: "Entry criteria not confirmed for this test run",
        });
        return;
      }

      const [stepResult] = await db
        .insert(schema.stepResults)
        .values({
          execution_id: executionId,
          step_id: stepId,
          actual_result: parsed.actual_result,
          comments: parsed.comments,
          passed: parsed.passed,
        })
        .returning();

      res.status(201).json({ stepResult });
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
      });
      if (!existing) {
        res.status(404).json({ message: "Step result not found. Use POST to create." });
        return;
      }

      const [updated] = await db.update(schema.stepResults)
        .set({
          ...parsed,
          recorded_at: new Date(),
        })
        .where(eq(schema.stepResults.id, existing.id))
        .returning();

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
