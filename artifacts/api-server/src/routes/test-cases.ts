import express from "express";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { checkProjectRole, denyUnlessProjectAccess, projectIdFromUseCase, projectIdFromTestCase, AuthenticatedRequest } from "../middlewares/auth.js";
import { bumpProjectVersion, logAudit } from "../utils/project.js";
import { setTestCasePreconditionLinks, resolvePreconditionDisplay } from "./preconditions.js";

const router = express.Router();

function linkedFromRow(tc: {
  precondition: string | null;
  preconditionLinks?: { precondition: { id: number; text: string } }[];
}) {
  const linked = (tc.preconditionLinks ?? []).map((l) => ({
    id: l.precondition.id,
    text: l.precondition.text,
  }));
  return resolvePreconditionDisplay(tc.precondition, linked);
}

// GET /api/use-cases/:useCaseId/test-cases
router.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const useCaseId = Number(req.params.useCaseId || req.query.useCaseId);
    if (!useCaseId) { res.status(400).json({ message: "useCaseId is required" }); return; }
    if (!(await denyUnlessProjectAccess(req, res, await projectIdFromUseCase(useCaseId)))) return;
    const data = await db.query.testCases.findMany({
      where: eq(schema.testCases.use_case_id, useCaseId),
      orderBy: schema.testCases.sort_order,
      with: {
        preconditionLinks: { with: { precondition: true } },
      },
    });
    res.json(
      data.map((tc) => {
        const { linkedPreconditions, resolvedPrecondition } = linkedFromRow(tc);
        const { preconditionLinks: _pl, ...rest } = tc;
        return { ...rest, linkedPreconditions, resolvedPrecondition };
      }),
    );
  } catch (err) { next(err); }
});

// GET /api/test-cases/:testCaseId
router.get("/:testCaseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.testCaseId);
    if (!(await denyUnlessProjectAccess(req, res, await projectIdFromTestCase(id)))) return;
    const testCase = await db.query.testCases.findFirst({
      where: eq(schema.testCases.id, id),
      with: {
        steps: { orderBy: sql`CAST(${schema.testSteps.step_number} AS INTEGER)` },
        preconditionLinks: { with: { precondition: true } },
      },
    });
    if (!testCase) { res.status(404).json({ message: "Test case not found" }); return; }
    const { linkedPreconditions, resolvedPrecondition } = linkedFromRow(testCase);
    const { preconditionLinks: _pl, ...rest } = testCase;
    res.json({ ...rest, linkedPreconditions, resolvedPrecondition });
  } catch (err) { next(err); }
});

// GET /api/test-cases/:testCaseId/steps
router.get("/:testCaseId/steps", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testCaseId = Number(req.params.testCaseId);
    if (!(await denyUnlessProjectAccess(req, res, await projectIdFromTestCase(testCaseId)))) return;
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
      precondition: z.string().optional(),
      precondition_ids: z.array(z.number()).optional(),
    }).parse(req.body);

    const maxSort = await db.select({ max: sql<number>`MAX(${schema.testCases.sort_order})` })
      .from(schema.testCases)
      .where(eq(schema.testCases.use_case_id, useCaseId));
    const nextSort = (maxSort[0]?.max ?? -1) + 1;

    const { precondition_ids, ...caseFields } = parsed;
    const [inserted] = await db.insert(schema.testCases).values({ ...caseFields, use_case_id: useCaseId, sort_order: nextSort }).returning();

    if (precondition_ids) {
      try {
        await setTestCasePreconditionLinks(inserted.id, useCase.project_id, precondition_ids);
      } catch (e: any) {
        if (e?.status === 422) {
          res.status(422).json({ message: e.message });
          return;
        }
        throw e;
      }
    }

    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_case", entityId: inserted.id, changedByUserId: req.user!.userId, toStatus: "created" });

    const full = await db.query.testCases.findFirst({
      where: eq(schema.testCases.id, inserted.id),
      with: { preconditionLinks: { with: { precondition: true } } },
    });
    const { linkedPreconditions, resolvedPrecondition } = linkedFromRow(full!);
    const { preconditionLinks: _pl, ...rest } = full!;
    res.status(201).json({ ...rest, linkedPreconditions, resolvedPrecondition });
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
      precondition: z.string().nullable().optional(),
      precondition_ids: z.array(z.number()).optional(),
      sort_order: z.number().optional(),
    }).parse(req.body);

    const { precondition_ids, ...caseFields } = parsed;
    const [updated] = await db.update(schema.testCases)
      .set(caseFields)
      .where(eq(schema.testCases.id, id))
      .returning();

    if (precondition_ids !== undefined) {
      try {
        await setTestCasePreconditionLinks(id, useCase.project_id, precondition_ids);
      } catch (e: any) {
        if (e?.status === 422) {
          res.status(422).json({ message: e.message });
          return;
        }
        throw e;
      }
    }

    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_case", entityId: id, changedByUserId: req.user!.userId, toStatus: "updated" });

    const full = await db.query.testCases.findFirst({
      where: eq(schema.testCases.id, id),
      with: { preconditionLinks: { with: { precondition: true } } },
    });
    const { linkedPreconditions, resolvedPrecondition } = linkedFromRow(full!);
    const { preconditionLinks: _pl, ...rest } = full!;
    res.json({ ...rest, linkedPreconditions, resolvedPrecondition });
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
