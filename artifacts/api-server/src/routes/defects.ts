import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";

const router = express.Router();

async function logAudit(params: { entityType: string; entityId: number; changedByUserId: number | null; fromStatus?: string | null; toStatus?: string | null; reason?: string | null }) {
  await db.insert(schema.statusAuditLog).values({
    entity_type: params.entityType,
    entity_id: params.entityId,
    changed_by_user_id: params.changedByUserId,
    from_status: params.fromStatus ?? null,
    to_status: params.toStatus ?? null,
    reason: params.reason ?? null,
  });
}

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

// GET /api/defects/:defectId
router.get("/:defectId", async (req: AuthenticatedRequest, res, next) => {
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

// PATCH /api/defects/:defectId/flag-bug
router.patch("/:defectId/flag-bug", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "Submitted to Dev to Fix", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    // Create a bug record with auto-increment bug_number
    const maxBug = await db
      .select({ max: sql<number>`COALESCE(MAX(${schema.bugs.bug_number}), 0)` })
      .from(schema.bugs)
      .where(eq(schema.bugs.project_id, defect.test_run_id)); // use test_run's project
    const bugNumber = (maxBug[0]?.max || 0) + 1;

    await db.insert(schema.bugs).values({
      project_id: defect.test_run_id, // This maps to project but we need actual project
      defect_id: defectId,
      bug_number: bugNumber,
      status: "OPEN",
    });

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "Submitted to Dev to Fix" });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/flag-retest
router.patch("/:defectId/flag-retest", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string() });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "Ready for Testing", retest_reason: data.reason, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    // Create defect_retests record
    await db.insert(schema.defectRetests).values({
      defect_id: defectId,
      test_run_id: defect.test_run_id,
    });

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "Ready for Testing", reason: data.reason });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/flag-accepted-by-business
router.patch("/:defectId/flag-accepted-by-business", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "Accepted by Business", updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();
    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "Accepted by Business" });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/business-accept
router.patch("/:defectId/business-accept", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ note: z.string() });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const [updated] = await db.update(schema.defects)
      .set({ status: "Accepted by Business", accepted_by_business_note: data.note, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "Accepted by Business", reason: data.note });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/business-reject
router.patch("/:defectId/business-reject", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ reason: z.string().optional() });
    const data = bodySchema.parse(req.body);

    const defect = await db.query.defects.findFirst({ where: eq(schema.defects.id, defectId) });
    if (!defect) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = defect.status;
    const rejectionLog = data.reason ? JSON.stringify({ reason: data.reason, rejectedAt: new Date().toISOString(), rejectedBy: req.user!.userId }) : "{}";
    const [updated] = await db.update(schema.defects)
      .set({ status: "Ready for Testing", rejection_log: rejectionLog, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    await logAudit({ entityType: "defect", entityId: defectId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "Ready for Testing", reason: data.reason });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/defects/:defectId/classify
router.patch("/:defectId/classify", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ severity: z.string(), priority: z.string() });
    const data = bodySchema.parse(req.body);

    const [updated] = await db.update(schema.defects)
      .set({ severity: data.severity, priority: data.priority, updated_at: new Date() })
      .where(eq(schema.defects.id, defectId))
      .returning();

    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/defects/:defectId/notes
router.post("/:defectId/notes", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const bodySchema = z.object({ note: z.string() });
    const data = bodySchema.parse(req.body);

    const [note] = await db.insert(schema.defectNotes)
      .values({ defect_id: defectId, added_by_user_id: req.user!.userId, note: data.note })
      .returning();

    res.status(201).json(note);
  } catch (err) { next(err); }
});

// GET /api/defects/:defectId/retests
router.get("/:defectId/retests", async (req: AuthenticatedRequest, res, next) => {
  try {
    const defectId = Number(req.params.defectId);
    const retests = await db.query.defectRetests.findMany({
      where: eq(schema.defectRetests.defect_id, defectId),
    });
    res.json(retests);
  } catch (err) { next(err); }
});

export default router;
