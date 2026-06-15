-- Migration: Reset all defects to NEW status and remove linked data
-- This is a destructive rollback: clears audit trail, notes, retests, and
-- resets each defect to its initial NEW state with no severity/priority.
-- Existing defect records (id, project, test_run, test_case references) are preserved.

--> statement-breakpoint
-- 1. Remove status audit log entries for defects
DELETE FROM "status_audit_log" WHERE "entity_type" = 'defect';

--> statement-breakpoint
-- 2. Remove all defect retests (child table, no FK cascade on update)
DELETE FROM "defect_retests";

--> statement-breakpoint
-- 3. Remove all defect notes (child table, no FK cascade on update)
DELETE FROM "defect_notes";

--> statement-breakpoint
-- 4. Reset every defect to NEW status and clear lifecycle fields
UPDATE "defects"
SET
  "status" = 'NEW',
  "severity" = NULL,
  "priority" = NULL,
  "assigned_to_user_id" = NULL,
  "support_ticket_number" = NULL,
  "root_cause_category" = NULL,
  "regression_index" = 0,
  "tester_notes" = NULL,
  "retest_reason" = NULL,
  "accepted_by_business_note" = NULL,
  "rejection_log" = NULL,
  "resolved_at" = NULL,
  "closed_at" = NULL,
  "updated_at" = NOW();
