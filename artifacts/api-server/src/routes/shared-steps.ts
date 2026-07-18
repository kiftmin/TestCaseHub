import express from "express";
import { eq, sql, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import {
  checkProjectRole,
  denyUnlessProjectAccess,
  projectIdFromTestCase,
  AuthenticatedRequest,
} from "../middlewares/auth.js";
import { bumpProjectVersion, logAudit } from "../utils/project.js";

const router = express.Router();

const stepItemSchema = z.object({
  instruction: z.string().min(1),
  test_data: z.string().optional().nullable(),
  expected_result: z.string().optional().nullable(),
});

async function loadBlockWithItems(blockId: number) {
  return db.query.projectSharedStepBlocks.findFirst({
    where: eq(schema.projectSharedStepBlocks.id, blockId),
    with: {
      items: {
        orderBy: [asc(schema.projectSharedStepItems.sort_order), asc(schema.projectSharedStepItems.id)],
      },
    },
  });
}

// GET /api/projects/:projectId/shared-step-blocks
router.get(
  "/projects/:projectId/shared-step-blocks",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!(await denyUnlessProjectAccess(req, res, projectId))) return;
      const rows = await db.query.projectSharedStepBlocks.findMany({
        where: eq(schema.projectSharedStepBlocks.project_id, projectId),
        orderBy: [
          asc(schema.projectSharedStepBlocks.sort_order),
          asc(schema.projectSharedStepBlocks.id),
        ],
        with: {
          items: {
            orderBy: [
              asc(schema.projectSharedStepItems.sort_order),
              asc(schema.projectSharedStepItems.id),
            ],
          },
        },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/projects/:projectId/shared-step-blocks
router.post(
  "/projects/:projectId/shared-step-blocks",
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
          name: z.string().min(1, "Name is required"),
          steps: z.array(stepItemSchema).min(1, "At least one step is required"),
        })
        .parse(req.body);

      const maxSort = await db
        .select({ max: sql<number>`MAX(${schema.projectSharedStepBlocks.sort_order})` })
        .from(schema.projectSharedStepBlocks)
        .where(eq(schema.projectSharedStepBlocks.project_id, projectId));
      const nextSort = (maxSort[0]?.max ?? -1) + 1;

      const [block] = await db
        .insert(schema.projectSharedStepBlocks)
        .values({
          project_id: projectId,
          name: data.name.trim(),
          sort_order: nextSort,
        })
        .returning();

      await db.insert(schema.projectSharedStepItems).values(
        data.steps.map((s, i) => ({
          block_id: block.id,
          step_number: String(i + 1),
          instruction: s.instruction.trim(),
          test_data: s.test_data?.trim() || null,
          expected_result: s.expected_result?.trim() || null,
          sort_order: i,
        })),
      );

      const full = await loadBlockWithItems(block.id);
      res.status(201).json(full);
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/shared-step-blocks/:id
router.put("/shared-step-blocks/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.query.projectSharedStepBlocks.findFirst({
      where: eq(schema.projectSharedStepBlocks.id, id),
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
        name: z.string().min(1).optional(),
        sort_order: z.number().optional(),
        steps: z.array(stepItemSchema).min(1).optional(),
      })
      .parse(req.body);

    if (data.name != null || data.sort_order != null) {
      await db
        .update(schema.projectSharedStepBlocks)
        .set({
          ...(data.name != null ? { name: data.name.trim() } : {}),
          ...(data.sort_order != null ? { sort_order: data.sort_order } : {}),
        })
        .where(eq(schema.projectSharedStepBlocks.id, id));
    }

    if (data.steps) {
      await db
        .delete(schema.projectSharedStepItems)
        .where(eq(schema.projectSharedStepItems.block_id, id));
      await db.insert(schema.projectSharedStepItems).values(
        data.steps.map((s, i) => ({
          block_id: id,
          step_number: String(i + 1),
          instruction: s.instruction.trim(),
          test_data: s.test_data?.trim() || null,
          expected_result: s.expected_result?.trim() || null,
          sort_order: i,
        })),
      );
    }

    const full = await loadBlockWithItems(id);
    res.json(full);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/shared-step-blocks/:id
router.delete("/shared-step-blocks/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.query.projectSharedStepBlocks.findFirst({
      where: eq(schema.projectSharedStepBlocks.id, id),
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

    await db
      .delete(schema.projectSharedStepBlocks)
      .where(eq(schema.projectSharedStepBlocks.id, id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/test-cases/:testCaseId/insert-shared-steps
// Copy a shared block into a test case as concrete steps (append after existing).
router.post(
  "/test-cases/:testCaseId/insert-shared-steps",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const testCaseId = Number(req.params.testCaseId);
      const projectId = await projectIdFromTestCase(testCaseId);
      if (!(await denyUnlessProjectAccess(req, res, projectId))) return;

      const allowed = await checkProjectRole(req, projectId!, ["TEST_LEAD", "TEST_AUTHOR"]);
      if (!allowed && req.user!.role !== "ADMIN") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const data = z
        .object({
          block_id: z.number(),
        })
        .parse(req.body);

      const block = await loadBlockWithItems(data.block_id);
      if (!block || block.project_id !== projectId) {
        res.status(404).json({ message: "Shared step block not found in this project" });
        return;
      }
      if (!block.items?.length) {
        res.status(422).json({ message: "Shared step block has no steps" });
        return;
      }

      const existing = await db.query.testSteps.findMany({
        where: eq(schema.testSteps.test_case_id, testCaseId),
      });
      let maxNum = 0;
      for (const s of existing) {
        const n = parseInt(String(s.step_number), 10);
        if (Number.isFinite(n) && n > maxNum) maxNum = n;
      }

      const values = block.items.map((item, i) => ({
        test_case_id: testCaseId,
        step_number: String(maxNum + i + 1),
        instruction: item.instruction,
        test_data: item.test_data,
        expected_result: item.expected_result,
      }));

      const inserted = await db.insert(schema.testSteps).values(values).returning();
      await bumpProjectVersion(projectId!);
      await logAudit({
        entityType: "test_step",
        entityId: inserted[0]?.id ?? testCaseId,
        changedByUserId: req.user!.userId,
        toStatus: "shared_block_inserted",
      });

      res.status(201).json(inserted);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/projects/:projectId/shared-step-blocks/from-test-case
// Create a library block from an existing test case's steps.
router.post(
  "/projects/:projectId/shared-step-blocks/from-test-case",
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
          test_case_id: z.number(),
          name: z.string().min(1).optional(),
        })
        .parse(req.body);

      const tc = await db.query.testCases.findFirst({
        where: eq(schema.testCases.id, data.test_case_id),
        with: {
          useCase: true,
          steps: {
            orderBy: sql`CAST(${schema.testSteps.step_number} AS INTEGER)`,
          },
        },
      });
      if (!tc || tc.useCase.project_id !== projectId) {
        res.status(404).json({ message: "Test case not found in this project" });
        return;
      }
      const steps = (tc.steps ?? []).filter((s) => s.instruction?.trim());
      if (steps.length === 0) {
        res.status(422).json({ message: "Test case has no steps to copy" });
        return;
      }

      const maxSort = await db
        .select({ max: sql<number>`MAX(${schema.projectSharedStepBlocks.sort_order})` })
        .from(schema.projectSharedStepBlocks)
        .where(eq(schema.projectSharedStepBlocks.project_id, projectId));
      const nextSort = (maxSort[0]?.max ?? -1) + 1;

      const name =
        data.name?.trim() ||
        `${tc.case_number}: ${tc.title}`.slice(0, 120);

      const [block] = await db
        .insert(schema.projectSharedStepBlocks)
        .values({
          project_id: projectId,
          name,
          sort_order: nextSort,
        })
        .returning();

      await db.insert(schema.projectSharedStepItems).values(
        steps.map((s, i) => ({
          block_id: block.id,
          step_number: String(i + 1),
          instruction: s.instruction,
          test_data: s.test_data,
          expected_result: s.expected_result,
          sort_order: i,
        })),
      );

      const full = await loadBlockWithItems(block.id);
      res.status(201).json(full);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
