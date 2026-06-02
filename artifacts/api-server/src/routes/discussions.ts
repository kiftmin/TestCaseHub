import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";

const router = express.Router();

// POST /api/test-runs/:testRunId/discussions — TEST_LEAD only
router.post("/test-runs/:testRunId/discussions", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const bodySchema = z.object({
      meetingType: z.enum(["defect_review", "post_mortem"]),
      participantIds: z.array(z.number()),
    });
    const data = bodySchema.parse(req.body);

    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }

    const allowed = await checkProjectRole(req, testRun.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const [discussion] = await db.insert(schema.teamDiscussions)
      .values({
        project_id: testRun.project_id,
        test_run_id: testRunId,
        initiated_by_user_id: req.user!.userId,
        meeting_type: data.meetingType,
      })
      .returning();

    // Determine can_add_notes per-participant based on project role and meeting type
    // Spec §7.13: defect_review → developers are viewers (no notes); post_mortem → business owners can add notes.
    const projectAssignments = await db.query.projectAssignments.findMany({
      where: eq(schema.projectAssignments.project_id, testRun.project_id),
    });
    const roleByUserId = new Map<number, string>();
    for (const pa of projectAssignments) {
      roleByUserId.set(pa.user_id, pa.role);
    }

    for (const userId of data.participantIds) {
      const userRole = roleByUserId.get(userId);
      let canAddNotes = false;
      if (data.meetingType === "post_mortem" && userRole === "BUSINESS_OWNER") {
        canAddNotes = true;
      }
      await db.insert(schema.teamDiscussionParticipants)
        .values({ discussion_id: discussion.id, user_id: userId, can_add_notes: canAddNotes });
    }

    res.status(201).json(discussion);
  } catch (err) { next(err); }
});

// GET /api/discussions/:discussionId
router.get("/discussions/:discussionId", async (req: AuthenticatedRequest, res, next) => {
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

// POST /api/discussions/:discussionId/participants — TEST_LEAD only
router.post("/discussions/:discussionId/participants", async (req: AuthenticatedRequest, res, next) => {
  try {
    const discussionId = Number(req.params.discussionId);

    const discussion = await db.query.teamDiscussions.findFirst({ where: eq(schema.teamDiscussions.id, discussionId) });
    if (!discussion) { res.status(404).json({ message: "Discussion not found" }); return; }

    const allowed = await checkProjectRole(req, discussion.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const bodySchema = z.object({ userId: z.number(), canAddNotes: z.boolean().optional().default(false) });
    const data = bodySchema.parse(req.body);

    const [participant] = await db.insert(schema.teamDiscussionParticipants)
      .values({ discussion_id: discussionId, user_id: data.userId, can_add_notes: data.canAddNotes })
      .returning();
    res.status(201).json(participant);
  } catch (err) { next(err); }
});

// DELETE /api/discussions/:discussionId/participants/:userId — TEST_LEAD only
router.delete("/discussions/:discussionId/participants/:userId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const discussionId = Number(req.params.discussionId);

    const discussion = await db.query.teamDiscussions.findFirst({ where: eq(schema.teamDiscussions.id, discussionId) });
    if (!discussion) { res.status(404).json({ message: "Discussion not found" }); return; }

    const allowed = await checkProjectRole(req, discussion.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const userId = Number(req.params.userId);
    await db.delete(schema.teamDiscussionParticipants)
      .where(and(
        eq(schema.teamDiscussionParticipants.discussion_id, discussionId),
        eq(schema.teamDiscussionParticipants.user_id, userId)
      ));
    res.status(204).end();
  } catch (err) { next(err); }
});

// PATCH /api/discussions/:discussionId/end — TEST_LEAD only
router.patch("/discussions/:discussionId/end", async (req: AuthenticatedRequest, res, next) => {
  try {
    const discussionId = Number(req.params.discussionId);

    const discussion = await db.query.teamDiscussions.findFirst({ where: eq(schema.teamDiscussions.id, discussionId) });
    if (!discussion) { res.status(404).json({ message: "Discussion not found" }); return; }

    const allowed = await checkProjectRole(req, discussion.project_id, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }

    const [updated] = await db.update(schema.teamDiscussions)
      .set({ is_active: false, ended_at: new Date() })
      .where(eq(schema.teamDiscussions.id, discussionId))
      .returning();
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/discussions/:discussionId/defects/:defectId
router.get("/discussions/:discussionId/defects/:defectId", async (req: AuthenticatedRequest, res, next) => {
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
