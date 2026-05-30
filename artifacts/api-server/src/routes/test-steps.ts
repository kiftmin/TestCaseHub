import express from "express";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";

const router = express.Router();

// GET /api/test-steps?testCaseId=
router.get("/", async (req, res, next) => {
  try {
    const testCaseId = Number(req.query.testCaseId);
    if (!testCaseId) { res.status(400).json({ message: "testCaseId query parameter is required" }); return; }
    const data = await db.query.testSteps.findMany({
      where: eq(schema.testSteps.test_case_id, testCaseId),
      orderBy: sql`CAST(${schema.testSteps.step_number} AS INTEGER)`,
    });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/test-steps/:stepId
router.get("/:stepId", async (req, res, next) => {
  try {
    const id = Number(req.params.stepId);
    const step = await db.query.testSteps.findFirst({ where: eq(schema.testSteps.id, id) });
    if (!step) { res.status(404).json({ message: "Step not found" }); return; }
    res.json(step);
  } catch (err) { next(err); }
});

// POST /api/test-cases/:testCaseId/steps
router.post("/", async (req, res, next) => {
  try {
    const parsed = z.object({
      test_case_id: z.number(),
      step_number: z.string(),
      instruction: z.string(),
      test_data: z.string().optional(),
      expected_result: z.string().optional(),
    }).parse(req.body);

    const testCase = await db.query.testCases.findFirst({ where: eq(schema.testCases.id, parsed.test_case_id) });
    if (!testCase) { res.status(404).json({ message: "Test case not found" }); return; }

    const [inserted] = await db.insert(schema.testSteps).values(parsed).returning();

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, testCase.use_case_id) });
    if (useCase) {
      await db.update(schema.projects)
        .set({ version: sql`${schema.projects.version} + 1`, version_date: new Date() })
        .where(eq(schema.projects.id, useCase.project_id));
    }

    res.status(201).json(inserted);
  } catch (err) { next(err); }
});

// POST /api/test-steps/bulk
router.post("/bulk", async (req, res, next) => {
  try {
    const parsed = z.object({
      test_case_id: z.number(),
      steps: z.array(z.object({
        step_number: z.string(),
        instruction: z.string(),
        test_data: z.string().optional(),
        expected_result: z.string().optional(),
      })),
    }).parse(req.body);

    const testCase = await db.query.testCases.findFirst({ where: eq(schema.testCases.id, parsed.test_case_id) });
    if (!testCase) { res.status(404).json({ message: "Test case not found" }); return; }

    const values = parsed.steps.map(step => ({ test_case_id: parsed.test_case_id, ...step }));
    const inserted = await db.insert(schema.testSteps).values(values).returning();

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, testCase.use_case_id) });
    if (useCase) {
      await db.update(schema.projects)
        .set({ version: sql`${schema.projects.version} + 1`, version_date: new Date() })
        .where(eq(schema.projects.id, useCase.project_id));
    }

    res.status(201).json(inserted);
  } catch (err) { next(err); }
});

// PUT /api/test-steps/:stepId
router.put("/:stepId", async (req, res, next) => {
  try {
    const id = Number(req.params.stepId);
    const existing = await db.query.testSteps.findFirst({
      where: eq(schema.testSteps.id, id),
      with: { testCase: true },
    });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const [updated] = await db.update(schema.testSteps)
      .set(req.body)
      .where(eq(schema.testSteps.id, id))
      .returning();

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, existing.testCase.use_case_id) });
    if (useCase) {
      await db.update(schema.projects)
        .set({ version: sql`${schema.projects.version} + 1`, version_date: new Date() })
        .where(eq(schema.projects.id, useCase.project_id));
    }

    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/test-steps/:stepId
router.delete("/:stepId", async (req, res, next) => {
  try {
    const id = Number(req.params.stepId);
    const existing = await db.query.testSteps.findFirst({
      where: eq(schema.testSteps.id, id),
      with: { testCase: true },
    });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    await db.delete(schema.testSteps).where(eq(schema.testSteps.id, id));

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, existing.testCase.use_case_id) });
    if (useCase) {
      await db.update(schema.projects)
        .set({ version: sql`${schema.projects.version} + 1`, version_date: new Date() })
        .where(eq(schema.projects.id, useCase.project_id));
    }

    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
