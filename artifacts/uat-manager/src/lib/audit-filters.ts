/**
 * audit-filters.ts
 *
 * Filters for the AuditTrail "Milestones" view.
 * A macro/milestone event is a significant state transition worth calling out
 * in a governance summary — not every intermediate internal step.
 */

interface AuditEntry {
  from_status?: string | null;
  to_status?: string | null;
  entity_type?: string | null;
  decision_type?: string | null;
  notes?: string | null;
}

/** Statuses that represent meaningful milestones in the UAT lifecycle */
const MILESTONE_STATUSES = new Set([
  "TRIAGED",
  "ASSIGNED",
  "READY_FOR_VERIFICATION",
  "PENDING_BIZ_ACCEPTANCE",
  "PASSED_BY_AGREEMENT",
  "CLOSED",
  "PENDING_RISK_ACCEPTANCE",
  "REGRESSED",
]);

/**
 * Returns true if this audit entry represents a high-level milestone
 * worth showing in the condensed Milestones view.
 */
export function isMacroEvent(entry: AuditEntry): boolean {
  const to = entry.to_status ?? "";
  const from = entry.from_status ?? "";

  // Any transition INTO a milestone status counts
  if (MILESTONE_STATUSES.has(to)) return true;

  // A transition OUT of CLOSED or PASSED_BY_AGREEMENT (regression / re-open) counts
  if (MILESTONE_STATUSES.has(from) && to && from !== to) return true;

  return false;
}

/**
 * Returns true if this entry represents an escalation path
 * (e.g. triage, risk acceptance, business decision).
 */
export function isEscalation(entry: AuditEntry): boolean {
  const to = entry.to_status ?? "";
  return (
    to === "PENDING_BIZ_ACCEPTANCE" ||
    to === "PENDING_RISK_ACCEPTANCE" ||
    to === "PASSED_BY_AGREEMENT" ||
    to === "TRIAGED"
  );
}

/**
 * Returns true if this entry represents an admin undo / override action.
 */
export function isAdminUndo(entry: AuditEntry): boolean {
  const notes = entry.notes ?? "";
  return notes.toLowerCase().includes("undo") || notes.toLowerCase().includes("override");
}
