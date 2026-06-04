import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";
import { logAudit, logSystemNote } from "../utils/project.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// GET endpoints (open to all authenticated)
// ---------------------------------------------------------------------------

// GET /api/test-runs/:testRunId/defects
router.get("/test-runs/:testRunId/defects", async (req: AuthenticatedRequest, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const result = await db.query.defects.findMany({
      where: eq(schema.defects.test_run_id, testRunId),
      with: {
        testCase: { with: { steps: true, useCase: true } },
        execution: { with: { stepResults: { with: { step: true } }, tester: true } },
        notes: { with: { addedBy: true } },
        retests: true,
      },
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/defects
router.get("/projects/:projectId/defects", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const result = await db.query.defects.findMany({
      where: eq(schema.defects.project_id, projectId),
      with: {
        testCase: { with: { steps: true, useCase: true } },
        execution: { with: { stepResults: { with: { step: true } }, tester: true } },
        notes: { with: { addedBy: true } },
        retests: true,
      },
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
      with: {
        testCase: { with: { steps: true, useCase: true } },
        execution: { with: { stepResults: { with: { step: true } }, tester: true } },
        notes: { with: { addedBy: true } },
        retests: true,
      },
    });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    res.json(defect);
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

// ---------------------------------------------------------------------------
// Helper: resolve project_id from a defect
// ---------------------------------------------------------------------------
async function getProjectId(defectId: number): Promise<number | null> {
  const defect = await db.query.defects.findFirst({
    where: eq(schema.defects.id, defectId),
    columns: { id: true, test_run_id: true },
  });
  if (!defect) return null;
  const tr = await db.query.testRuns.findFirst({
    where: eq(schema.testRuns.id, defect.test_run_id),
    columns: { project_id: true },
  });
  return tr?.project_id ?? null;
}

// ---------------------------------------------------------------------------
// PHASE 1 — TEST_LEAD Triage
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/classify — TEST_LEAD only
// Any non-terminal status — updates severity + priority.
// If currently NEW, also transitions to TRIAGED.
router.patch("/defects/:defectId/classify", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      severity: z.enum(["Critical", "Major", "Minor", "Cosmetic"]),
      priority: z.enum(["P1", "P2", "P3", "P4"]),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const targetStatus = oldStatus === "NEW" ? "TRIAGED" : oldStatus;
    const [updated] = await db.update(schema.defects)
      .set({ severity: data.severity, priority: data.priority, status: targetStatus, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    if (targetStatus !== oldStatus) {
      await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: targetStatus });
      await logSystemNote(defectId, oldStatus, targetStatus, req.user!.userId);
    }
    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: oldStatus, reason: `Reclassified: severity=${data.severity}, priority=${data.priority}` });
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/assign — TEST_LEAD only
// TRIAGED ──────────────────────────────────────────────────────> ASSIGNED
// Binds assigned_to_user_id and optionally support_ticket_number
router.patch("/defects/:defectId/assign", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      assigned_to_user_id: z.number(),
      support_ticket_number: z.string().optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({
        status: "ASSIGNED",
        assigned_to_user_id: data.assigned_to_user_id,
        support_ticket_number: data.support_ticket_number ?? null,
        updated_at: new Date(),
      })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "ASSIGNED" });
    await logSystemNote(defectId, oldStatus, "ASSIGNED", req.user!.userId, `Assigned to user #${data.assigned_to_user_id}`);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/flag-blocked — TEST_LEAD only
// NEW ────────────────────────────────────────────────────────> BLOCKED
// Requires mandatory reason text
router.patch("/defects/:defectId/flag-blocked", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().min(1, "Block reason is required") });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    if (defect.status !== "NEW") { res.status(400).json({ message: "Only NEW defects can be flagged as blocked" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "BLOCKED", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "BLOCKED", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "BLOCKED", req.user!.userId, data.reason);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/flag-retest-from-new — TEST_LEAD only
// NEW ────────────────────────────────────────────────────────> READY_FOR_VERIFICATION
// Automatically provisions a defect_retests trace and a retest_reason
router.patch("/defects/:defectId/flag-retest-from-new", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      reason: z.string().default("Flagged for retesting from NEW status"),
      targetVerificationRunId: z.number().optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    if (defect.status !== "NEW") { res.status(400).json({ message: "Only NEW defects can be flagged for retesting from new" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "READY_FOR_VERIFICATION", retest_reason: data.reason, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await db.insert(schema.defectRetests).values({
      defect_id: defectId,
      test_run_id: defect.test_run_id,
      target_verification_run_id: data.targetVerificationRunId ?? defect.test_run_id,
    });

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "READY_FOR_VERIFICATION", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "READY_FOR_VERIFICATION", req.user!.userId, data.reason);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/flag-accepted-by-business — TEST_LEAD only
// NEW ────────────────────────────────────────────────────────> PASSED_BY_AGREEMENT
// Routes directly to the business owner exception track
router.patch("/defects/:defectId/flag-accepted-by-business", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ note: z.string().min(1, "Business justification note is required") });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }
    if (defect.status !== "NEW") { res.status(400).json({ message: "Only NEW defects can be flagged as accepted by business" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "PASSED_BY_AGREEMENT", accepted_by_business_note: data.note, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "PASSED_BY_AGREEMENT", reason: data.note });
    await logSystemNote(defectId, oldStatus, "PASSED_BY_AGREEMENT", req.user!.userId, data.note);
    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PHASE 2 — Developer Cycle
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/start — DEVELOPER only
// ASSIGNED ───────────────────────────────────────────────────> IN_PROGRESS
router.patch("/defects/:defectId/start", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["DEVELOPER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "IN_PROGRESS", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "IN_PROGRESS" });
    await logSystemNote(defectId, oldStatus, "IN_PROGRESS", req.user!.userId);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/block — DEVELOPER only
// ASSIGNED | IN_PROGRESS ──────────────────────────────────────> BLOCKED
// Requires reason text
router.patch("/defects/:defectId/block", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().min(1) });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["DEVELOPER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "BLOCKED", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "BLOCKED", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "BLOCKED", req.user!.userId, data.reason);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/unblock — DEVELOPER or TEST_LEAD
// BLOCKED ─────────────────────────────────────────────────────> IN_PROGRESS
router.patch("/defects/:defectId/unblock", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["DEVELOPER", "TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "IN_PROGRESS", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "IN_PROGRESS", reason: "Block lifted" });
    await logSystemNote(defectId, oldStatus, "IN_PROGRESS", req.user!.userId, "Block lifted");
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/resolve — DEVELOPER only
// ASSIGNED | IN_PROGRESS ──────────────────────────────────────> RESOLVED_DEV
// Requires root_cause_category. Sets resolved_at.
router.patch("/defects/:defectId/resolve", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      root_cause_category: z.enum(["Requirements Gap", "Design Defect", "Coding Error", "Environment Issue", "Test Data Issue", "Configuration Error", "Third-Party Integration", "Other"]),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["DEVELOPER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "RESOLVED_DEV", root_cause_category: data.root_cause_category, resolved_at: new Date(), updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "RESOLVED_DEV", reason: data.root_cause_category });
    await logSystemNote(defectId, oldStatus, "RESOLVED_DEV", req.user!.userId, `Root cause: ${data.root_cause_category}`);
    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PHASE 3 — Verification
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/flag-retest — TEST_LEAD only
// RESOLVED_DEV ────────────────────────────────────────────────> READY_FOR_VERIFICATION
// Automatically provisions a defect_retests trace with target_verification_run_id
router.patch("/defects/:defectId/flag-retest", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({
      reason: z.string(),
      targetVerificationRunId: z.number(),
    });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

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
      target_verification_run_id: data.targetVerificationRunId,
    });

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "READY_FOR_VERIFICATION", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "READY_FOR_VERIFICATION", req.user!.userId, data.reason);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defect-retests/:retestId — TESTER or TEST_LEAD
// READY_FOR_VERIFICATION ──────────────────────────────────────> CLOSED | ASSIGNED
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
      await logSystemNote(retest.defect_id, oldDefectStatus, "REGRESSED", req.user!.userId, "Retest failed: " + (data.retestNotes || "No notes"));
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
      await logSystemNote(retest.defect_id, oldDefectStatus, "CLOSED", req.user!.userId, "Retest passed: " + (data.retestNotes || "No notes"));
    }

    res.json({ message: "Retest recorded", retestResult: data.retestResult });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PHASE 4 — Closure / Exception
// ---------------------------------------------------------------------------

// PATCH /defects/:defectId/accept — BUSINESS_OWNER only
// READY_FOR_VERIFICATION ──────────────────────────────────────> CLOSED
router.patch("/defects/:defectId/accept", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ note: z.string() });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["BUSINESS_OWNER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "CLOSED", accepted_by_business_note: data.note, updated_at: new Date(), closed_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "CLOSED", reason: data.note });
    await logSystemNote(defectId, oldStatus, "CLOSED", req.user!.userId, data.note);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/reject — BUSINESS_OWNER only
// READY_FOR_VERIFICATION ──────────────────────────────────────> READY_FOR_VERIFICATION (re-opened)
router.patch("/defects/:defectId/reject", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().optional() });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["BUSINESS_OWNER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const rejectionLog = data.reason ? JSON.stringify({ reason: data.reason, rejectedAt: new Date().toISOString(), rejectedBy: req.user!.userId }) : "{}";
    const [updated] = await db.update(schema.defects)
      .set({ status: "READY_FOR_VERIFICATION", rejection_log: rejectionLog, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "READY_FOR_VERIFICATION", reason: data.reason });
    await logSystemNote(defectId, oldStatus, "READY_FOR_VERIFICATION", req.user!.userId, data.reason ?? undefined);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /defects/:defectId/accept-by-agreement — BUSINESS_OWNER only
// Any non-terminal state ───────────────────────────────────────> PASSED_BY_AGREEMENT
// Requires mandatory accepted_by_business_note
router.patch("/defects/:defectId/accept-by-agreement", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ note: z.string().min(1, "Business justification note is required") });
    const data = bodySchema.parse(req.body);

    const projectId = await getProjectId(defectId);
    if (!projectId) { res.status(404).json({ message: "Defect not found" }); return; }
    const allowed = await checkProjectRole(req, projectId, ["BUSINESS_OWNER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "PASSED_BY_AGREEMENT", accepted_by_business_note: data.note, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "PASSED_BY_AGREEMENT", reason: data.note });
    await logSystemNote(defectId, oldStatus, "PASSED_BY_AGREEMENT", req.user!.userId, data.note);
    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

// POST /api/defects/:defectId/notes — TEST_LEAD, BUSINESS_OWNER, or participant
router.post("/defects/:defectId/notes", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ note: z.string() });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, defect.test_run_id) });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }

    const projectRole = await checkProjectRole(req, testRun.project_id, ["TEST_LEAD", "BUSINESS_OWNER"]);
    if (!projectRole && req.user!.role !== "ADMIN") {
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

// ---------------------------------------------------------------------------
// Aging Matrix
// ---------------------------------------------------------------------------

// GET /api/projects/:projectId/defect-aging-matrix
// Returns all defects with their current-state age and total age
router.get("/projects/:projectId/defect-aging-matrix", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const result = await db.execute(sql`
      SELECT
        d.id AS "defectId",
        d.bug_number AS "bugNumber",
        d.status,
        d.severity,
        d.priority,
        d.ticket_type AS "ticketType",
        d.regression_index AS "regressionIndex",
        d.assigned_to_user_id AS "assignedToUserId",
        d.support_ticket_number AS "supportTicketNumber",
        d.root_cause_category AS "rootCauseCategory",
        AGE(d.updated_at)::text AS "currentStateAge",
        AGE(d.created_at)::text AS "totalAge",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt",
        d.resolved_at AS "resolvedAt",
        d.closed_at AS "closedAt"
      FROM ${schema.defects} d
      WHERE d.project_id = ${projectId}
      ORDER BY d.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
