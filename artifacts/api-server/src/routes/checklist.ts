import express from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";

const router = express.Router();

// GET /api/test-runs/:testRunId/checklist
router.get("/", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId || req.query.testRunId);
    if (!testRunId) { res.status(400).json({ message: "testRunId is required" }); return; }
    const data = await db.query.testRunChecklistItems.findMany({
      where: eq(schema.testRunChecklistItems.test_run_id, testRunId),
      orderBy: schema.testRunChecklistItems.sort_order,
      with: { checkedBy: true },
    });
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/test-runs/:testRunId/checklist
router.post("/", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId || req.body.test_run_id);
    const parsed = z.object({ itemText: z.string() }).parse(req.body);

    // Get max sort_order
    const items = await db.query.testRunChecklistItems.findMany({
      where: eq(schema.testRunChecklistItems.test_run_id, testRunId),
      orderBy: desc(schema.testRunChecklistItems.sort_order),
      limit: 1,
    });
    const nextSort = items.length > 0 ? items[0].sort_order + 1 : 6;

    const [inserted] = await db.insert(schema.testRunChecklistItems)
      .values({ test_run_id: testRunId, item_text: parsed.itemText, sort_order: nextSort })
      .returning();
    res.status(201).json(inserted);
  } catch (err) { next(err); }
});

// PATCH /api/test-runs/:testRunId/checklist/:itemId
router.patch("/:itemId", async (req, res, next) => {
  try {
    const itemId = Number(req.params.itemId);
    const parsed = z.object({ isChecked: z.boolean() }).parse(req.body);

    const existing = await db.query.testRunChecklistItems.findFirst({ where: eq(schema.testRunChecklistItems.id, itemId) });
    if (!existing) { res.status(404).json({ message: "Checklist item not found" }); return; }

    const [updated] = await db.update(schema.testRunChecklistItems)
      .set({
        is_checked: parsed.isChecked,
        checked_at: parsed.isChecked ? new Date() : null,
        checked_by_user_id: parsed.isChecked ? (req as any).user?.userId : null,
      })
      .where(eq(schema.testRunChecklistItems.id, itemId))
      .returning();
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/test-runs/:testRunId/checklist/:itemId
router.delete("/:itemId", async (req, res, next) => {
  try {
    const itemId = Number(req.params.itemId);
    await db.delete(schema.testRunChecklistItems).where(eq(schema.testRunChecklistItems.id, itemId));
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
