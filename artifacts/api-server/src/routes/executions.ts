import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";

const router = express.Router();

// GET /api/dashboard/tester/:userId/test-runs
router.get("/tester/:userId/test-runs", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);

    // Find all test run use cases assigned to this user
    const assignedUseCases = await db.query.testRunUseCases.findMany({
      where: eq(schema.testRunUseCases.assigned_tester_id, userId),
      with: { testRun: true, useCase: true },
    });

    const testRunIds = [...new Set(assignedUseCases.map((uc) => uc.test_run_id))];

    const testRuns = await db.query.testRuns.findMany({
      where: (tr, { inArray }) => inArray(tr.id, testRunIds),
      with: { project: true },
      orderBy: desc(schema.testRuns.created_at),
    });

    res.json(testRuns);
  } catch (err) {
    next(err);
  }
});

// POST /api/test-runs/:testRunId/test-cases/:testCaseId/execute
router.post(
  "/test-runs/:testRunId/test-cases/:testCaseId/execute",
  async (req, res, next) => {
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

      if (!testRun.entry_confirmed) {
        res.status(403).json({
          message: "Entry criteria must be confirmed before execution",
        });
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

      res.status(201).json(execution);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/executions/:executionId
router.patch("/executions/:executionId", async (req, res, next) => {
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
      with: { testRun: true },
    });
    if (!execution) {
      res.status(404).json({ message: "Execution not found" });
      return;
    }

    if (!execution.testRun.entry_confirmed) {
      res.status(403).json({
        message: "Entry criteria must be confirmed before updating execution",
      });
      return;
    }

    const [updated] = await db
      .update(schema.executions)
      .set({ ...parsed, executed_at: new Date() })
      .where(eq(schema.executions.id, executionId))
      .returning();

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/executions/:executionId/steps/:stepId/result
router.post(
  "/executions/:executionId/steps/:stepId/result",
  async (req, res, next) => {
    try {
      const executionId = Number(req.params.executionId);
      const stepId = Number(req.params.stepId);

      const parsed = z
        .object({
          actual_result: z.string().optional(),
          comments: z.string().optional(),
          passed: z.boolean(),
          auto_create_defect: z.boolean().optional().default(false),
          defect_tester_notes: z.string().optional(),
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
          message: "Entry criteria must be confirmed before recording step results",
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

      let defect = null;

      // Auto-create defect on failure if requested
      if (!parsed.passed && parsed.auto_create_defect) {
        const [newDefect] = await db
          .insert(schema.defects)
          .values({
            test_run_id: execution.test_run_id!,
            test_case_id: execution.test_case_id,
            execution_id: executionId,
            tester_notes: parsed.defect_tester_notes || "Auto-created from failed step",
            status: "New Defect",
          })
          .returning();
        defect = newDefect;
      }

      res.status(201).json({ stepResult, defect });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
