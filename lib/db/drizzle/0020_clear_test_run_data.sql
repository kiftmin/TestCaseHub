-- Migration 0020: Clear all test run data while preserving the test plan
-- Destructive: deletes test runs, defects, executions, discussions, audit logs, attachments
-- Preserves: projects, use cases, test cases, test steps, users, project assignments

--> statement-breakpoint
-- 1. Delete status audit logs for test runs, defects, and executions (no FK — standalone table)
DELETE FROM "status_audit_log"
WHERE "entity_type" IN ('defect', 'test_run', 'execution');

--> statement-breakpoint
-- 2. Delete attachments for test runs and defects (no FK — standalone table)
DELETE FROM "attachments"
WHERE "entity_type" IN ('defect', 'test_run', 'test-run');

--> statement-breakpoint
-- 3. Delete test runs — cascades to:
--    test_run_case_scope, test_run_checklist_items, test_run_use_cases,
--    team_discussions (→ team_discussion_participants),
--    defects (→ defect_notes, defect_retests)
DELETE FROM "test_runs";

--> statement-breakpoint
-- 4. Delete executions — survive test_run deletion because test_run_id uses ON DELETE SET NULL
--    Cascades to: step_results
DELETE FROM "executions";
