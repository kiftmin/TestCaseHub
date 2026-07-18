import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { checkProjectRole, denyUnlessProjectAccess, projectIdFromTestCase, projectIdFromTestStep, AuthenticatedRequest } from "../middlewares/auth.js";
import { bumpProjectVersion, logAudit } from "../utils/project.js";

const router = express.Router();

// GET /api/test-cases/:testCaseId/steps
router.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testCaseId = Number(req.params.testCaseId || req.query.testCaseId);
    if (!testCaseId) { res.status(400).json({ message: "testCaseId is required" }); return; }
    if (!(await denyUnlessProjectAccess(req, res, await projectIdFromTestCase(testCaseId)))) return;
    const data = await db.query.testSteps.findMany({
      where: eq(schema.testSteps.test_case_id, testCaseId),
      orderBy: sql`CAST(${schema.testSteps.step_number} AS INTEGER)`,
    });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/test-steps/:stepId
router.get("/:stepId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.stepId);
    if (!(await denyUnlessProjectAccess(req, res, await projectIdFromTestStep(id)))) return;
    const step = await db.query.testSteps.findFirst({ where: eq(schema.testSteps.id, id) });
    if (!step) { res.status(404).json({ message: "Step not found" }); return; }
    res.json(step);
  } catch (err) { next(err); }
});

// POST /api/test-cases/:testCaseId/steps — Admin, TEST_LEAD, TEST_AUTHOR
router.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testCaseId = Number(req.params.testCaseId || req.body.test_case_id);
    if (!testCaseId) { res.status(400).json({ message: "test_case_id is required" }); return; }

    const testCase = await db.query.testCases.findFirst({ where: eq(schema.testCases.id, testCaseId) });
    if (!testCase) { res.status(404).json({ message: "Test case not found" }); return; }

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, testCase.use_case_id) });
    if (!useCase) { res.status(404).json({ message: "Use case not found" }); return; }

    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({
      test_case_id: z.number().optional(),
      step_number: z.string(),
      instruction: z.string(),
      test_data: z.string().optional(),
      expected_result: z.string().optional(),
    }).parse(req.body);

    const [inserted] = await db.insert(schema.testSteps).values({ ...parsed, test_case_id: testCaseId }).returning();
    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_step", entityId: inserted.id, changedByUserId: req.user!.userId, toStatus: "created" });

    res.status(201).json(inserted);
  } catch (err) {
    if (err instanceof Error && err.message.includes("test_steps_test_case_id_step_number_unique")) {
      res.status(409).json({ message: `Step number already exists in this test case.` });
      return;
    }
    next(err);
  }
});

// POST /api/test-steps/bulk
router.post("/bulk", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testCaseId = Number(req.body.test_case_id);
    if (!testCaseId) { res.status(400).json({ message: "test_case_id is required" }); return; }

    const testCase = await db.query.testCases.findFirst({ where: eq(schema.testCases.id, testCaseId) });
    if (!testCase) { res.status(404).json({ message: "Test case not found" }); return; }

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, testCase.use_case_id) });
    if (!useCase) { res.status(404).json({ message: "Use case not found" }); return; }

    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({
      test_case_id: z.number(),
      steps: z.array(z.object({
        step_number: z.string(),
        instruction: z.string(),
        test_data: z.string().optional(),
        expected_result: z.string().optional(),
      })),
    }).parse(req.body);

    const values = parsed.steps.map(step => ({ test_case_id: parsed.test_case_id, ...step }));
    const inserted = await db.insert(schema.testSteps).values(values).returning();
    await bumpProjectVersion(useCase.project_id);

    res.status(201).json(inserted);
  } catch (err) {
    if (err instanceof Error && err.message.includes("test_steps_test_case_id_step_number_unique")) {
      res.status(409).json({ message: `One or more step numbers already exist in this test case.` });
      return;
    }
    next(err);
  }
});

// PUT /api/test-steps/reorder — atomic reorder within a test case
router.put("/reorder", async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = z.object({
      steps: z.array(z.object({ id: z.number(), step_number: z.string() })),
    }).parse(req.body);

    if (parsed.steps.length === 0) { res.status(400).json({ message: "No steps provided" }); return; }

    // Verify all steps belong to the same test case and user has access
    const steps = await db.query.testSteps.findMany({
      where: inArray(schema.testSteps.id, parsed.steps.map(s => s.id)),
      with: { testCase: true },
    });
    if (steps.length !== parsed.steps.length) {
      res.status(404).json({ message: "One or more steps not found" }); return;
    }
    const testCaseId = steps[0].test_case_id;
    if (steps.some(s => s.test_case_id !== testCaseId)) {
      res.status(400).json({ message: "All steps must belong to the same test case" }); return;
    }

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, steps[0].testCase.use_case_id) });
    if (!useCase) { res.status(404).json({ message: "Use case not found" }); return; }

    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    // Atomic reorder: set to negative temp values then to final values (same transaction avoids unique conflicts)
    await db.transaction(async (tx) => {
      for (let i = 0; i < parsed.steps.length; i++) {
        await tx.update(schema.testSteps)
          .set({ step_number: String(-(i + 1)) })
          .where(eq(schema.testSteps.id, parsed.steps[i].id));
      }
      for (let i = 0; i < parsed.steps.length; i++) {
        await tx.update(schema.testSteps)
          .set({ step_number: parsed.steps[i].step_number })
          .where(eq(schema.testSteps.id, parsed.steps[i].id));
      }
    });

    await bumpProjectVersion(useCase.project_id);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("test_steps_test_case_id_step_number_unique")) {
      res.status(409).json({ message: `Step number already exists in this test case.` });
      return;
    }
    next(err);
  }
});

// PUT /api/test-steps/:stepId — Admin, TEST_LEAD, TEST_AUTHOR (with Zod validation)
router.put("/:stepId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.stepId);
    const existing = await db.query.testSteps.findFirst({
      where: eq(schema.testSteps.id, id),
      with: { testCase: true },
    });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, existing.testCase.use_case_id) });
    if (!useCase) { res.status(404).json({ message: "Use case not found" }); return; }

    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({
      step_number: z.string().optional(),
      instruction: z.string().optional(),
      test_data: z.string().nullable().optional(),
      expected_result: z.string().nullable().optional(),
    }).parse(req.body);

    const [updated] = await db.update(schema.testSteps)
      .set(parsed)
      .where(eq(schema.testSteps.id, id))
      .returning();

    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_step", entityId: id, changedByUserId: req.user!.userId, toStatus: "updated" });

    res.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message.includes("test_steps_test_case_id_step_number_unique")) {
      res.status(409).json({ message: `Step number already exists in this test case.` });
      return;
    }
    next(err);
  }
});

// DELETE /api/test-steps/:stepId — Admin, TEST_LEAD, TEST_AUTHOR
router.delete("/:stepId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.stepId);
    const existing = await db.query.testSteps.findFirst({
      where: eq(schema.testSteps.id, id),
      with: { testCase: true },
    });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, existing.testCase.use_case_id) });
    if (!useCase) { res.status(404).json({ message: "Use case not found" }); return; }

    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    await db.delete(schema.testSteps).where(eq(schema.testSteps.id, id));
    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_step", entityId: id, changedByUserId: req.user!.userId, toStatus: "deleted" });

    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
