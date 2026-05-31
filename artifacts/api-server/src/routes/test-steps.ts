import express from "express";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";

const router = express.Router();

async function bumpProjectVersion(projectId: number): Promise<void> {
  await db.update(schema.projects)
    .set({ version: sql`${schema.projects.version} + 1`, version_date: new Date() })
    .where(eq(schema.projects.id, projectId));
}

async function logAudit(params: { entityType: string; entityId: number; changedByUserId: number | null; fromStatus?: string | null; toStatus?: string | null }) {
  await db.insert(schema.statusAuditLog).values({
    entity_type: params.entityType,
    entity_id: params.entityId,
    changed_by_user_id: params.changedByUserId,
    from_status: params.fromStatus ?? null,
    to_status: params.toStatus ?? null,
  });
}

// GET /api/test-cases/:testCaseId/steps
router.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testCaseId = Number(req.params.testCaseId || req.query.testCaseId);
    if (!testCaseId) { res.status(400).json({ message: "testCaseId is required" }); return; }
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
  } catch (err) { next(err); }
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
  } catch (err) { next(err); }
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
  } catch (err) { next(err); }
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
