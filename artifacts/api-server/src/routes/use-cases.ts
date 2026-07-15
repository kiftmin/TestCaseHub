import express from "express";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { checkProjectRole, denyUnlessProjectAccess, projectIdFromUseCase, AuthenticatedRequest } from "../middlewares/auth.js";
import { bumpProjectVersion, logAudit } from "../utils/project.js";

const router = express.Router();

// These routes are mounted at /api/use-cases and /api/projects/:projectId/use-cases
// We handle the project-based route differently - note that Express router params work from the mount point

// GET /api/projects/:projectId/use-cases
router.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId || req.query.projectId);
    if (!projectId) {
      res.status(400).json({ message: "projectId is required" });
      return;
    }
    if (!(await denyUnlessProjectAccess(req, res, projectId))) return;
    const result = await db.query.useCases.findMany({
      where: eq(schema.useCases.project_id, projectId),
      orderBy: schema.useCases.sort_order,
      with: { testCases: { with: { steps: true } } },
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/use-cases/:useCaseId/test-cases
router.get("/:useCaseId/test-cases", async (req: AuthenticatedRequest, res, next) => {
  try {
    const useCaseId = Number(req.params.useCaseId);
    if (!(await denyUnlessProjectAccess(req, res, await projectIdFromUseCase(useCaseId)))) return;
    const data = await db.query.testCases.findMany({
      where: eq(schema.testCases.use_case_id, useCaseId),
      orderBy: desc(schema.testCases.created_at),
    });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/use-cases/:useCaseId — scenario detail with test cases and steps
router.get("/:useCaseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const useCaseId = Number(req.params.useCaseId);
    const data = await db.query.useCases.findFirst({
      where: eq(schema.useCases.id, useCaseId),
      with: {
        testCases: {
          orderBy: schema.testCases.sort_order,
          with: { steps: { orderBy: sql`CAST(${schema.testSteps.step_number} AS INTEGER)` } },
        },
      },
    });
    if (!data) { res.status(404).json({ message: "Not found" }); return; }
    if (!(await denyUnlessProjectAccess(req, res, data.project_id))) return;
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/projects/:projectId/use-cases
router.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId || req.query.projectId);
    if (!projectId) {
      res.status(400).json({ message: "projectId is required" });
      return;
    }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const bodySchema = z.object({
      code: z.string(),
      name: z.string(),
      priority: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
    });
    const data = bodySchema.parse(req.body);

    const maxSort = await db.select({ max: sql<number>`MAX(${schema.useCases.sort_order})` })
      .from(schema.useCases)
      .where(eq(schema.useCases.project_id, projectId));
    const nextSort = (maxSort[0]?.max ?? -1) + 1;

    const [useCase] = await db.insert(schema.useCases)
      .values({ project_id: projectId, code: data.code, name: data.name, priority: data.priority ?? null, category: data.category ?? null, sort_order: nextSort })
      .returning();

    await bumpProjectVersion(projectId);
    await logAudit({ entityType: "test_scenario", entityId: useCase.id, changedByUserId: req.user!.userId, toStatus: "created" });

    res.status(201).json(useCase);
  } catch (err) { next(err); }
});

// PUT /api/use-cases/:useCaseId
router.put("/:useCaseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const useCaseId = Number(req.params.useCaseId);
    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, useCaseId) });
    if (!useCase) { res.status(404).json({ message: "Not found" }); return; }
    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const parsed = z.object({
      code: z.string().optional(),
      name: z.string().optional(),
      priority: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      sort_order: z.number().optional(),
    }).parse(req.body);

    const [updated] = await db.update(schema.useCases)
      .set(parsed)
      .where(eq(schema.useCases.id, useCaseId))
      .returning();

    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_scenario", entityId: useCaseId, changedByUserId: req.user!.userId, toStatus: "updated" });

    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/use-cases/:useCaseId
router.delete("/:useCaseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const useCaseId = Number(req.params.useCaseId);
    const useCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.id, useCaseId) });
    if (!useCase) { res.status(404).json({ message: "Not found" }); return; }
    const allowed = await checkProjectRole(req, useCase.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    await db.delete(schema.useCases).where(eq(schema.useCases.id, useCaseId));
    await bumpProjectVersion(useCase.project_id);
    await logAudit({ entityType: "test_scenario", entityId: useCaseId, changedByUserId: req.user!.userId, toStatus: "deleted" });

    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
