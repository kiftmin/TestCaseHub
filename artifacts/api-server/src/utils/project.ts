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
