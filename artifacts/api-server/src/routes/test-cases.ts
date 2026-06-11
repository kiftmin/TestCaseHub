import express from "express";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";
import { bumpProjectVersion, logAudit } from "../utils/project.js";

const router = express.Router();

// GET /api/use-cases/:useCaseId/test-cases
router.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const useCaseId = Number(req.params.useCaseId || req.query.useCaseId);
    if (!useCaseId) { res.status(400).json({ message: "useCaseId is required" }); return; }
    const data = await db.query.testCases.findMany({
      where: eq(schema.testCases.use_case_id, useCaseId),
      orderBy: schema.testCases.sort_order,
    });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/test-cases/:testCaseId
router.get("/:testCaseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.testCaseId);
    const testCase = await db.query.testCases.findFirst({
      where: eq(schema.testCases.id, id),
      with: { steps: { orderBy: sql`CAST(${schema.testSteps.step_number} AS INTEGER)` } },
    });
    if (!testCase) { res.status(404).json({ message: "Test case not found" }); return; }
    res.json(testCase);
  } catch (err) { next(err); }
});

// GET /api/test-cases/:testCaseId/steps
router.get("/:testCaseId/steps", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testCaseId = Number(req.params.testCaseId);
    const data = await db.query.testSteps.findMany({
      where: eq(schema.testSteps.test_case_id, testCaseId),
      orderBy: sql`CAST(${schema.testSteps.step_number} AS INTEGER)`,
    });
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/use-cases/:useCaseId/test-cases — Admin, TEST_LEAD, TEST_AUTHOR
router.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const useCaseId = Number(req.params.useCaseId || req.body.use_case_id);
    if (!useCaseId) { res.status(400).json({ message: "use_case_id is required" }); return; }

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, useCaseId) });
    if (!useCase) { res.status(404).json({ message: "Use case not found" }); return; }

    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({
      use_case_id: z.number().optional(),
      case_number: z.string(),
      title: z.string(),
      test_type: z.string().optional(),
      estimated_minutes: z.number().optional(),
      acceptance_criteria: z.string().optional(),
    }).parse(req.body);

    const maxSort = await db.select({ max: sql<number>`MAX(${schema.testCases.sort_order})` })
      .from(schema.testCases)
      .where(eq(schema.testCases.use_case_id, useCaseId));
    const nextSort = (maxSort[0]?.max ?? -1) + 1;

    const [inserted] = await db.insert(schema.testCases).values({ ...parsed, use_case_id: useCaseId, sort_order: nextSort }).returning();

    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_case", entityId: inserted.id, changedByUserId: req.user!.userId, toStatus: "created" });

    res.status(201).json(inserted);
  } catch (err) { next(err); }
});

// PUT /api/test-cases/:testCaseId — Admin, TEST_LEAD, TEST_AUTHOR (with Zod validation)
router.put("/:testCaseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.testCaseId);
    const existing = await db.query.testCases.findFirst({ where: eq(schema.testCases.id, id) });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, existing.use_case_id) });
    if (!useCase) { res.status(404).json({ message: "Use case not found" }); return; }

    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({
      case_number: z.string().optional(),
      title: z.string().optional(),
      test_type: z.string().nullable().optional(),
      estimated_minutes: z.number().nullable().optional(),
      acceptance_criteria: z.string().nullable().optional(),
      sort_order: z.number().optional(),
    }).parse(req.body);

    const [updated] = await db.update(schema.testCases)
      .set(parsed)
      .where(eq(schema.testCases.id, id))
      .returning();

    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_case", entityId: id, changedByUserId: req.user!.userId, toStatus: "updated" });

    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/test-cases/:testCaseId — Admin, TEST_LEAD, TEST_AUTHOR
router.delete("/:testCaseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.testCaseId);
    const existing = await db.query.testCases.findFirst({ where: eq(schema.testCases.id, id) });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }

    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, existing.use_case_id) });
    if (!useCase) { res.status(404).json({ message: "Use case not found" }); return; }

    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    await db.delete(schema.testCases).where(eq(schema.testCases.id, id));
    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_case", entityId: id, changedByUserId: req.user!.userId, toStatus: "deleted" });

    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
