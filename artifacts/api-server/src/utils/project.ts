import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@workspace/db";

export async function bumpProjectVersion(projectId: number): Promise<void> {
  await db
    .update(schema.projects)
    .set({
      version: sql`${schema.projects.version} + 1`,
      version_date: new Date(),
    })
    .where(eq(schema.projects.id, projectId));
}

export interface AuditLogParams {
  entityType: string;
  entityId: number;
  changedByUserId: number | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  await db.insert(schema.statusAuditLog).values({
    entity_type: params.entityType,
    entity_id: params.entityId,
    changed_by_user_id: params.changedByUserId,
    from_status: params.fromStatus ?? null,
    to_status: params.toStatus ?? null,
    reason: params.reason ?? null,
  });
}

export async function logSystemNote(defectId: number, fromStatus: string | null | undefined, toStatus: string, changedByUserId: number, reason?: string): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, changedByUserId),
    columns: { name: true },
  });
  const userName = user?.name ?? `User #${changedByUserId}`;
  let noteText = `System Note: Defect status changed from '${fromStatus ?? "N/A"}' to '${toStatus}' by ${userName}.`;
  if (reason) {
    noteText += ` Reason: ${reason}`;
  }
  await db.insert(schema.defectNotes).values({
    defect_id: defectId,
    added_by_user_id: changedByUserId,
    note: noteText,
    is_system_note: true,
  });
}
