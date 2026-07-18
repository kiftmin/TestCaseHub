import express from "express";
import { eq, and, sql, inArray, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import {
  checkProjectRole,
  denyUnlessProjectAccess,
  AuthenticatedRequest,
} from "../middlewares/auth.js";

const router = express.Router();

// GET /api/projects/:projectId/preconditions
router.get(
  "/projects/:projectId/preconditions",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!(await denyUnlessProjectAccess(req, res, projectId))) return;
      const rows = await db.query.projectPreconditions.findMany({
        where: eq(schema.projectPreconditions.project_id, projectId),
        orderBy: [asc(schema.projectPreconditions.sort_order), asc(schema.projectPreconditions.id)],
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/projects/:projectId/preconditions
router.post(
  "/projects/:projectId/preconditions",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const projectId = Number(req.params.projectId);
      const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD", "TEST_AUTHOR"]);
      if (!allowed && req.user!.role !== "ADMIN") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const data = z
        .object({
          text: z.string().min(1, "Text is required"),
        })
        .parse(req.body);

      const maxSort = await db
        .select({ max: sql<number>`MAX(${schema.projectPreconditions.sort_order})` })
        .from(schema.projectPreconditions)
        .where(eq(schema.projectPreconditions.project_id, projectId));
      const nextSort = (maxSort[0]?.max ?? -1) + 1;

      const [row] = await db
        .insert(schema.projectPreconditions)
        .values({
          project_id: projectId,
          text: data.text.trim(),
          sort_order: nextSort,
        })
        .returning();

      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/preconditions/:id
router.put("/preconditions/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.query.projectPreconditions.findFirst({
      where: eq(schema.projectPreconditions.id, id),
    });
    if (!existing) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    const allowed = await checkProjectRole(req, existing.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const data = z
      .object({
        text: z.string().min(1).optional(),
        sort_order: z.number().optional(),
      })
      .parse(req.body);

    const [updated] = await db
      .update(schema.projectPreconditions)
      .set({
        ...(data.text != null ? { text: data.text.trim() } : {}),
        ...(data.sort_order != null ? { sort_order: data.sort_order } : {}),
      })
      .where(eq(schema.projectPreconditions.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/preconditions/:id
router.delete("/preconditions/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.query.projectPreconditions.findFirst({
      where: eq(schema.projectPreconditions.id, id),
    });
    if (!existing) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    const allowed = await checkProjectRole(req, existing.project_id, ["TEST_LEAD", "TEST_AUTHOR"]);
    if (!allowed && req.user!.role !== "ADMIN") {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    await db.delete(schema.projectPreconditions).where(eq(schema.projectPreconditions.id, id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

/** Replace linked library preconditions for a test case (must belong to project). */
export async function setTestCasePreconditionLinks(
  testCaseId: number,
  projectId: number,
  preconditionIds: number[],
): Promise<void> {
  const unique = [...new Set(preconditionIds.filter((n) => Number.isFinite(n) && n > 0))];

  if (unique.length > 0) {
    const valid = await db.query.projectPreconditions.findMany({
      where: and(
        eq(schema.projectPreconditions.project_id, projectId),
        inArray(schema.projectPreconditions.id, unique),
      ),
      columns: { id: true },
    });
    const validIds = new Set(valid.map((v) => v.id));
    const bad = unique.filter((id) => !validIds.has(id));
    if (bad.length > 0) {
      throw Object.assign(new Error(`Invalid precondition id(s) for this project: ${bad.join(", ")}`), {
        status: 422,
      });
    }
  }

  await db
    .delete(schema.testCasePreconditions)
    .where(eq(schema.testCasePreconditions.test_case_id, testCaseId));

  if (unique.length > 0) {
    await db.insert(schema.testCasePreconditions).values(
      unique.map((precondition_id) => ({
        test_case_id: testCaseId,
        precondition_id,
      })),
    );
  }
}

/** Enrich a test case row with linked preconditions + resolved display text. */
export function resolvePreconditionDisplay(
  freeText: string | null | undefined,
  linked: { id: number; text: string }[],
): { linkedPreconditions: { id: number; text: string }[]; resolvedPrecondition: string | null } {
  const parts = [
    ...linked.map((l) => l.text.trim()).filter(Boolean),
    ...(freeText?.trim() ? [freeText.trim()] : []),
  ];
  return {
    linkedPreconditions: linked,
    resolvedPrecondition: parts.length > 0 ? parts.join("\n") : null,
  };
}
