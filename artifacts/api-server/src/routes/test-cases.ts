import express from "express";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";

const router = express.Router();

// GET /api/test-cases?useCaseId=
router.get("/", async (req, res, next) => {
  try {
    const useCaseId = Number(req.query.useCaseId);
    if (!useCaseId) { res.status(400).json({ message: "useCaseId query parameter is required" }); return; }
    const data = await db.query.testCases.findMany({
      where: eq(schema.testCases.use_case_id, useCaseId),
      orderBy: desc(schema.testCases.created_at),
    });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/test-cases/:testCaseId
router.get("/:testCaseId", async (req, res, next) => {
  try {
    const id = Number(req.params.testCaseId);
    const testCase = await db.query.testCases.findFirst({
      where: eq(schema.testCases.id, id),
      with: { steps: true },
    });
    if (!testCase) { res.status(404).json({ message: "Test case not found" }); return; }
    res.json(testCase);
  } catch (err) { next(err); }
});

// POST /api/test-cases
router.post("/", async (req, res, next) => {
  try {
    const parsed = z.object({
      use_case_id: z.number(),
      case_number: z.string(),
      title: z.string(),
      test_type: z.string().optional(),
      estimated_minutes: z.number().optional(),
      acceptance_criteria: z.string().optional(),
    }).parse(req.body);

    const [inserted] = await db.insert(schema.testCases).values(parsed).returning();

    // Bump project version via useCase -> project
    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, parsed.use_case_id) });
    if (useCase) {
      await db.update(schema.projects)
        .set({ version: sql`${schema.projects.version} + 1`, version_date: new Date() })
        .where(eq(schema.projects.id, useCase.project_id));
    }

    res.status(201).json(inserted);
  } catch (err) { next(err); }
});

// PUT /api/test-cases/:testCaseId
router.put("/:testCaseId", async (req, res, next) => {
  try {
    const id = Number(req.params.testCaseId);
    const existing = await db.query.testCases.findFirst({ where: eq(schema.testCases.id, id) });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const [updated] = await db.update(schema.testCases)
      .set(req.body)
      .where(eq(schema.testCases.id, id))
      .returning();

    // Bump project version
    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, existing.use_case_id) });
    if (useCase) {
      await db.update(schema.projects)
        .set({ version: sql`${schema.projects.version} + 1`, version_date: new Date() })
        .where(eq(schema.projects.id, useCase.project_id));
    }

    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/test-cases/:testCaseId
router.delete("/:testCaseId", async (req, res, next) => {
  try {
    const id = Number(req.params.testCaseId);
    const existing = await db.query.testCases.findFirst({ where: eq(schema.testCases.id, id) });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    await db.delete(schema.testCases).where(eq(schema.testCases.id, id));

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, existing.use_case_id) });
    if (useCase) {
      await db.update(schema.projects)
        .set({ version: sql`${schema.projects.version} + 1`, version_date: new Date() })
        .where(eq(schema.projects.id, useCase.project_id));
    }

    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
