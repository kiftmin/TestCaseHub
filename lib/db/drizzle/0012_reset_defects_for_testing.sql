-- Migration: Add new dual-gate statuses, reset all defects to NEW, clear audit trail and notes
-- This is destructive: wipes status_audit_log, defect_notes, defect_retests for defects
-- and resets every defect to NEW with no severity/priority/lifecycle fields.
-- Existing defect records (id, project, test_run, test_case references) are preserved.

--> statement-breakpoint
-- 1. Remove status audit log entries for defects
DELETE FROM "status_audit_log" WHERE "entity_type" = 'defect';

--> statement-breakpoint
-- 2. Remove all defect retests
DELETE FROM "defect_retests";

--> statement-breakpoint
-- 3. Remove all defect notes (comments + system notes)
DELETE FROM "defect_notes";

--> statement-breakpoint
-- 4. Reset every defect to NEW status and clear all lifecycle fields
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
