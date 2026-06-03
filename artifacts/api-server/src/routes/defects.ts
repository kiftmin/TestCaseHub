import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";
import { logAudit } from "../utils/project.js";

const router = express.Router();

// GET /api/test-runs/:testRunId/defects
router.get("/test-runs/:testRunId/defects", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const result = await db.query.defects.findMany({
      where: eq(schema.defects.test_run_id, testRunId),
      with: { testCase: true, execution: { with: { stepResults: true } }, notes: true },
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/defects — all defects across all test runs of a project
// Replaces the N+1 client-side pattern in DefectLogPage.tsx
router.get("/projects/:projectId/defects", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);

    const testRuns = await db.query.testRuns.findMany({
      where: eq(schema.testRuns.project_id, projectId),
      columns: { id: true },
    });
    const runIds = testRuns.map((r) => r.id);
    if (runIds.length === 0) {
      res.json([]);
      return;
    }

    const result = await db.query.defects.findMany({
      where: (d, { inArray }) => inArray(d.test_run_id, runIds),
      with: { testCase: true, execution: { with: { stepResults: true } }, notes: true },
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/defects/:defectId
router.get("/defects/:defectId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.id, defectId),
      with: { testCase: true, execution: { with: { stepResults: true } }, notes: true, retests: true },
    });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    res.json(defect);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/flag-dev — TEST_LEAD only (formerly flag-bug)
router.patch("/defects/:defectId/flag-dev", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "ASSIGNED", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "ASSIGNED" });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/flag-retest — TEST_LEAD only
router.patch("/defects/:defectId/flag-retest", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string(), targetVerificationRunId: z.number().optional() });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "READY_FOR_VERIFICATION", retest_reason: data.reason, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await db.insert(schema.defectRetests).values({
      defect_id: defectId,
      test_run_id: defect.test_run_id,
      target_verification_run_id: data.targetVerificationRunId ?? null,
    });

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "READY_FOR_VERIFICATION", reason: data.reason });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/flag-accepted-by-business — TEST_LEAD only
router.patch("/defects/:defectId/flag-accepted-by-business", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "PASSED_BY_AGREEMENT", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();
    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "PASSED_BY_AGREEMENT" });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/business-accept — BUSINESS_OWNER only
router.patch("/defects/:defectId/business-accept", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ note: z.string() });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "CLOSED", accepted_by_business_note: data.note, updated_at: new Date(), closed_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "CLOSED", reason: data.note });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/business-reject — BUSINESS_OWNER only
router.patch("/defects/:defectId/business-reject", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().optional() });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const rejectionLog = data.reason ? JSON.stringify({ reason: data.reason, rejectedAt: new Date().toISOString(), rejectedBy: req.user!.userId }) : "{}";
    const [updated] = await db.update(schema.defects)
      .set({ status: "READY_FOR_VERIFICATION", rejection_log: rejectionLog, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "READY_FOR_VERIFICATION", reason: data.reason });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/classify — TEST_LEAD only
router.patch("/defects/:defectId/classify", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      severity: z.enum(["Critical", "Major", "Minor", "Cosmetic"]),
      priority: z.enum(["P1", "P2", "P3", "P4"]),
    });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const [updated] = await db.update(schema.defects)
      .set({ severity: data.severity, priority: data.priority, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/defects/:defectId/notes — TEST_LEAD, BUSINESS_OWNER, or participant
router.post("/defects/:defectId/notes", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ note: z.string() });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    // Check if user is TEST_LEAD for the project, ADMIN, BUSINESS_OWNER, or a participant
    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, defect.test_run_id) });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }

    const projectRole = await checkProjectRole(req, testRun.project_id, ["TEST_LEAD", "BUSINESS_OWNER"]);
    if (!projectRole && req.user!.role !== "ADMIN") {
      // Check if user is a participant with can_add_notes
      const discussions = await db.query.teamDiscussions.findMany({
        where: and(
          eq(schema.teamDiscussions.test_run_id, defect.test_run_id),
          eq(schema.teamDiscussions.is_active, true),
        ),
      });
      const discussionIds = discussions.map(d => d.id);
      if (discussionIds.length === 0) { res.status(403).json({ message: "Forbidden" }); return; }
      const participant = await db.query.teamDiscussionParticipants.findFirst({
        where: and(
          eq(schema.teamDiscussionParticipants.discussion_id, discussionIds[0]),
          eq(schema.teamDiscussionParticipants.user_id, req.user!.userId),
          eq(schema.teamDiscussionParticipants.can_add_notes, true),
        ),
      });
      if (!participant) { res.status(403).json({ message: "Forbidden" }); return; }
    }

    const [note] = await db.insert(schema.defectNotes)
      .values({ defect_id: defectId, added_by_user_id: req.user!.userId, note: data.note })
      .returning();

    res.status(201).json(note);
  } catch (err) { next(err); }
});

// GET /api/defects/:defectId/retests
router.get("/defects/:defectId/retests", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const retests = await db.query.defectRetests.findMany({
      where: eq(schema.defectRetests.defect_id, defectId),
    });
    res.json(retests);
  } catch (err) { next(err); }
});

// PATCH /api/defect-retests/:retestId — TESTER or TEST_LEAD
router.patch("/defect-retests/:retestId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const retestId = Number(req.params.retestId);
    const bodySchema = z.object({
      retestResult: z.enum(["passed", "failed"]),
      retestNotes: z.string().optional(),
    });
    const data = bodySchema.parse(req.body);

    const retest = await db.query.defectRetests.findFirst({
      where: eq(schema.defectRetests.id, retestId),
    });
    if (!retest) { res.status(404).json({ message: "Retest not found" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, retest.defect_id) });
    if (!defect) { res.status(404).json({ message: "Defect not found" }); return; }

    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, defect.test_run_id) });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }

    const allowed = await checkProjectRole(req, testRun.project_id, ["TEST_LEAD", "TESTER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const oldDefectStatus = defect.status;
    await db.update(schema.defectRetests)
      .set({
        retest_result: data.retestResult,
        retest_notes: data.retestNotes ?? null,
        retested_by_user_id: req.user!.userId,
        retested_at: new Date(),
      })
      .where(eq(schema.defectRetests.id, retestId));

    if (data.retestResult === "failed") {
      const newRegressionIndex = (defect.regression_index ?? 0) + 1;
      await db.update(schema.defects)
        .set({ status: "REGRESSED", regression_index: newRegressionIndex, updated_at: new Date() })
        .where(eq(schema.defects.id, retest.defect_id));

      await logAudit({
        entityType: "defect",
        entityId: retest.defect_id,
        changedByUserId: req.user!.userId,
        fromStatus: oldDefectStatus,
        toStatus: "REGRESSED",
        reason: "Retest failed: " + (data.retestNotes || "No notes"),
      });
    } else if (data.retestResult === "passed") {
      await db.update(schema.defects)
        .set({ status: "CLOSED", updated_at: new Date(), resolved_at: new Date() })
        .where(eq(schema.defects.id, retest.defect_id));

      await logAudit({
        entityType: "defect",
        entityId: retest.defect_id,
        changedByUserId: req.user!.userId,
        fromStatus: oldDefectStatus,
        toStatus: "CLOSED",
        reason: "Retest passed: " + (data.retestNotes || "No notes"),
      });
    }

    res.json({ message: "Retest recorded", retestResult: data.retestResult });
  } catch (err) { next(err); }
});

export default router;
