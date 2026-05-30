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

// GET /api/projects/:projectId/bugs
router.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId || req.query.projectId);
    if (!projectId) {
      res.status(400).json({ message: "projectId is required" });
      return;
    }
    const conditions = [eq(schema.bugs.project_id, projectId)];
    if (req.query.status) conditions.push(eq(schema.bugs.status, req.query.status as string));
    if (req.query.developerId) conditions.push(eq(schema.bugs.assigned_developer_id, Number(req.query.developerId)));
    if (req.query.ticketNumber) conditions.push(eq(schema.bugs.support_ticket_number, req.query.ticketNumber as string));
    if (req.query.rootCauseCategory) conditions.push(eq(schema.bugs.root_cause_category, req.query.rootCauseCategory as string));

    const result = await db.query.bugs.findMany({
      where: and(...conditions),
      with: { defect: true, developer: true },
      orderBy: desc(schema.bugs.created_at),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/bugs/:bugId
router.get("/:bugId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const bugId = Number(req.params.bugId);
    const bug = await db.query.bugs.findFirst({
      where: eq(schema.bugs.id, bugId),
      with: { defect: true, developer: true },
    });
    if (!bug) { res.status(404).json({ message: "Not found" }); return; }
    res.json(bug);
  } catch (err) { next(err); }
});

// PATCH /api/bugs/:bugId/assign
router.patch("/:bugId/assign", async (req: AuthenticatedRequest, res, next) => {
  try {
    const bugId = Number(req.params.bugId);
    const bodySchema = z.object({ developerId: z.number(), supportTicketNumber: z.string().optional() });
    const data = bodySchema.parse(req.body);

    const bug = await db.query.bugs.findFirst({ where: eq(schema.bugs.id, bugId) });
    if (!bug) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = bug.status;
    const [updated] = await db.update(schema.bugs)
      .set({
        assigned_developer_id: data.developerId,
        support_ticket_number: data.supportTicketNumber ?? bug.support_ticket_number,
        status: "ASSIGNED",
        assigned_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(schema.bugs.id, bugId))
      .returning();

    await logAudit({ entityType: "bug", entityId: bugId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: "ASSIGNED" });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/bugs/:bugId/status
router.patch("/:bugId/status", async (req: AuthenticatedRequest, res, next) => {
  try {
    const bugId = Number(req.params.bugId);
    const bodySchema = z.object({ status: z.string(), reason: z.string().optional() });
    const data = bodySchema.parse(req.body);

    const bug = await db.query.bugs.findFirst({ where: eq(schema.bugs.id, bugId) });
    if (!bug) { res.status(404).json({ message: "Not found" }); return; }

    const oldStatus = bug.status;
    const updateData: any = { status: data.status, updated_at: new Date() };

    if (data.status === "RESOLVED") updateData.resolved_at = new Date();
    if (data.status === "FAILED_TO_RESOLVE") {
      if (!data.reason) { res.status(400).json({ message: "Reason required for FAILED_TO_RESOLVE" }); return; }
      updateData.failed_to_resolve_reason = data.reason;
      updateData.failed_to_resolve_at = new Date();
    }
    if (data.status === "TEST") updateData.test_at = new Date();

    const [updated] = await db.update(schema.bugs)
      .set(updateData)
      .where(eq(schema.bugs.id, bugId))
      .returning();

    await logAudit({ entityType: "bug", entityId: bugId, changedByUserId: req.user!.userId, fromStatus: oldStatus, toStatus: data.status, reason: data.reason });

    // If bug goes to TEST, update linked defect status
    if (data.status === "TEST") {
      await db.update(schema.defects)
        .set({ status: "Ready for Testing", updated_at: new Date() })
        .where(eq(schema.defects.id, bug.defect_id));
    }

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/bugs/:bugId/notes
router.patch("/:bugId/notes", async (req: AuthenticatedRequest, res, next) => {
  try {
    const bugId = Number(req.params.bugId);
    const bodySchema = z.object({ notes: z.string().optional(), rootCauseCategory: z.string().optional() });
    const data = bodySchema.parse(req.body);

    const updateData: any = { updated_at: new Date() };
    if (data.notes !== undefined) updateData.developer_notes = data.notes;
    if (data.rootCauseCategory !== undefined) updateData.root_cause_category = data.rootCauseCategory;

    const [updated] = await db.update(schema.bugs)
      .set(updateData)
      .where(eq(schema.bugs.id, bugId))
      .returning();
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/bugs/:bugId/reassign
router.patch("/:bugId/reassign", async (req: AuthenticatedRequest, res, next) => {
  try {
    const bugId = Number(req.params.bugId);
    const bodySchema = z.object({ developerId: z.number() });
    const data = bodySchema.parse(req.body);

    const [updated] = await db.update(schema.bugs)
      .set({ assigned_developer_id: data.developerId, status: "ASSIGNED", assigned_at: new Date(), updated_at: new Date() })
      .where(eq(schema.bugs.id, bugId))
      .returning();

    await logAudit({ entityType: "bug", entityId: bugId, changedByUserId: req.user!.userId, toStatus: "ASSIGNED" });

    res.json(updated);
  } catch (err) { next(err); }
});

export default router;
