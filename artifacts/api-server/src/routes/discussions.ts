import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";

const router = express.Router();

// POST /api/test-runs/:testRunId/discussions - Create team discussion
router.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId || req.body.testRunId);
    const bodySchema = z.object({
      testRunId: z.number().optional(),
      meetingType: z.enum(["defect_review", "post_mortem"]),
      participantIds: z.array(z.number()),
    });
    const data = bodySchema.parse(req.body);

    const runId = testRunId || data.testRunId;
    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, runId) });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }

    const [discussion] = await db.insert(schema.teamDiscussions)
      .values({
        project_id: testRun.project_id,
        test_run_id: runId,
        initiated_by_user_id: req.user!.userId,
        meeting_type: data.meetingType,
      })
      .returning();

    // Add participants
    for (const userId of data.participantIds) {
      const canAddNotes = data.meetingType === "post_mortem"; // Business Owners get note permission by default
      await db.insert(schema.teamDiscussionParticipants)
        .values({ discussion_id: discussion.id, user_id: userId, can_add_notes: canAddNotes });
    }

    res.status(201).json(discussion);
  } catch (err) { next(err); }
});

// GET /api/discussions/:discussionId
router.get("/:discussionId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const discussionId = Number(req.params.discussionId);
    const discussion = await db.query.teamDiscussions.findFirst({
      where: eq(schema.teamDiscussions.id, discussionId),
      with: {
        participants: { with: { user: true } },
        initiatedBy: true,
      },
    });
    if (!discussion) { res.status(404).json({ message: "Not found" }); return; }
    res.json(discussion);
  } catch (err) { next(err); }
});

// POST /api/discussions/:discussionId/participants
router.post("/:discussionId/participants", async (req: AuthenticatedRequest, res, next) => {
  try {
    const discussionId = Number(req.params.discussionId);
    const bodySchema = z.object({ userId: z.number(), canAddNotes: z.boolean().optional().default(false) });
    const data = bodySchema.parse(req.body);

    const [participant] = await db.insert(schema.teamDiscussionParticipants)
      .values({ discussion_id: discussionId, user_id: data.userId, can_add_notes: data.canAddNotes })
      .returning();
    res.status(201).json(participant);
  } catch (err) { next(err); }
});

// DELETE /api/discussions/:discussionId/participants/:userId
router.delete("/:discussionId/participants/:userId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const discussionId = Number(req.params.discussionId);
    const userId = Number(req.params.userId);
    await db.delete(schema.teamDiscussionParticipants)
      .where(and(
        eq(schema.teamDiscussionParticipants.discussion_id, discussionId),
        eq(schema.teamDiscussionParticipants.user_id, userId)
      ));
    res.status(204).end();
  } catch (err) { next(err); }
});

// PATCH /api/discussions/:discussionId/end
router.patch("/:discussionId/end", async (req: AuthenticatedRequest, res, next) => {
  try {
    const discussionId = Number(req.params.discussionId);
    const [updated] = await db.update(schema.teamDiscussions)
      .set({ is_active: false, ended_at: new Date() })
      .where(eq(schema.teamDiscussions.id, discussionId))
      .returning();
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/discussions/:discussionId/defects/:defectId
router.get("/:discussionId/defects/:defectId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.id, defectId),
      with: {
        testCase: { with: { steps: true } },
        execution: { with: { stepResults: true } },
        notes: true,
        retests: true,
      },
    });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    res.json(defect);
  } catch (err) { next(err); }
});

export default router;
