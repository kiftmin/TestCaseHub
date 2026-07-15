import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@workspace/db";

/** Allowed source statuses for each transition action. */
export const DEFECT_TRANSITIONS: Record<string, readonly string[]> = {
  classify: ["NEW"],
  assign: ["NEW", "TRIAGED", "ASSIGNED"],
  "flag-blocked": ["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS"],
  "flag-retest-from-new": ["NEW"],
  "submit-for-business-decision": ["NEW", "TRIAGED"],
  start: ["ASSIGNED", "REGRESSED"],
  block: ["ASSIGNED", "IN_PROGRESS"],
  unblock: ["ASSIGNED", "IN_PROGRESS"],
  resolve: ["ASSIGNED", "IN_PROGRESS", "REGRESSED"],
  "qa-review": ["RESOLVED_DEV"],
  "flag-retest": ["QA_PASSED"],
  "quick-verify": ["READY_FOR_VERIFICATION"],
  accept: ["READY_FOR_VERIFICATION"],
  "resume-work": ["RESOLVED_DEV", "QA_PASSED"],
  "reschedule-retest": ["QA_PASSED", "READY_FOR_VERIFICATION"],
  "reject-verification": ["READY_FOR_VERIFICATION"],
  regress: ["CLOSED", "PASSED_BY_AGREEMENT"],
  "retry-after-regression": ["REGRESSED"],
  reassign: ["ASSIGNED", "IN_PROGRESS", "TRIAGED"],
  "accept-by-agreement": ["PENDING_BIZ_ACCEPTANCE", "NEW", "TRIAGED"],
  "reject-biz-acceptance": ["PENDING_BIZ_ACCEPTANCE"],
};

export type DefectRow = typeof schema.defects.$inferSelect;

/**
 * Lock a defect row, assert status is in allowedFrom, apply patch.
 * Returns the updated row, or a failure reason.
 */
export async function transitionDefect(opts: {
  defectId: number;
  allowedFrom: readonly string[];
  patch: Record<string, unknown>;
}): Promise<
  | { ok: true; before: DefectRow; after: DefectRow }
  | { ok: false; status: 404 | 409; message: string }
> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.defects)
      .where(eq(schema.defects.id, opts.defectId))
      .for("update");

    if (!locked) {
      return { ok: false as const, status: 404 as const, message: "Not found" };
    }

    if (!opts.allowedFrom.includes(locked.status)) {
      return {
        ok: false as const,
        status: 409 as const,
        message: `Invalid status transition: defect is ${locked.status}, expected one of [${opts.allowedFrom.join(", ")}]`,
      };
    }

    const [after] = await tx
      .update(schema.defects)
      .set({ ...opts.patch, updated_at: new Date() })
      .where(
        and(
          eq(schema.defects.id, opts.defectId),
          inArray(schema.defects.status, [...opts.allowedFrom]),
        ),
      )
      .returning();

    if (!after) {
      return {
        ok: false as const,
        status: 409 as const,
        message: "Status changed concurrently — please retry",
      };
    }

    return { ok: true as const, before: locked, after };
  });
}

/** Next bug number under a row lock on existing defects for the project (call inside a transaction). */
export async function nextBugNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: number,
): Promise<number> {
  // Lock existing defect rows for this project so concurrent submits serialize numbering
  await tx.execute(sql`
    SELECT id FROM defects WHERE project_id = ${projectId} FOR UPDATE
  `);
  const rows = await tx
    .select({ max: sql<number>`COALESCE(MAX(${schema.defects.bug_number}), 0)` })
    .from(schema.defects)
    .where(eq(schema.defects.project_id, projectId));
  return Number(rows[0]?.max ?? 0) + 1;
}
