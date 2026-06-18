import type { StatusAuditLog } from "../types/api";

export const MACRO_EVENTS = new Set([
  "NEW",
  "TRIAGED",
  "READY_FOR_VERIFICATION",
  "CLOSED",
  "PASSED_BY_AGREEMENT",
  "REGRESSED",
]);

export const MICRO_EVENTS = new Set([
  "ASSIGNED",
  "IN_PROGRESS",
  "BLOCKED",
  "RESOLVED_DEV",
]);

export function isMacroEvent(entry: StatusAuditLog): boolean {
  return !!entry.to_status && MACRO_EVENTS.has(entry.to_status);
}

export function isMicroEvent(entry: StatusAuditLog): boolean {
  return !!entry.to_status && MICRO_EVENTS.has(entry.to_status);
}

export function isEscalation(entry: StatusAuditLog): boolean {
  if (entry.to_status === "REGRESSED") return true;
  return entry.from_status === "READY_FOR_VERIFICATION"
    && entry.to_status !== "CLOSED"
    && entry.to_status !== "PASSED_BY_AGREEMENT";
}

export function isAdminUndo(entry: StatusAuditLog): boolean {
  return entry.from_status === "BLOCKED"
    || entry.from_status === "RESOLVED_DEV" && entry.to_status === "IN_PROGRESS"
    || entry.from_status === "READY_FOR_VERIFICATION" && entry.to_status === "RESOLVED_DEV";
}
