-- Integrity + scale: unique constraints and missing FK indexes
-- Safe to re-run (IF NOT EXISTS / concurrent-safe patterns)

-- Deduplicate before unique indexes (keep highest id)
DELETE FROM project_assignments a
USING project_assignments b
WHERE a.project_id = b.project_id
  AND a.user_id = b.user_id
  AND a.id < b.id;

DELETE FROM test_run_use_cases a
USING test_run_use_cases b
WHERE a.test_run_id = b.test_run_id
  AND a.use_case_id = b.use_case_id
  AND a.id < b.id;

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_assignments_project_user_unique
  ON project_assignments (project_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_run_use_cases_run_case_unique
  ON test_run_use_cases (test_run_id, use_case_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_executions_run_case
  ON executions (test_run_id, test_case_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_step_results_exec_step
  ON step_results (execution_id, step_id);

-- bug_number unique per project (allow multiple NULLs if any legacy rows)
CREATE UNIQUE INDEX IF NOT EXISTS idx_defects_project_bug_number_unique
  ON defects (project_id, bug_number)
  WHERE bug_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_use_cases_project_code_unique
  ON use_cases (project_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_use_case_case_number_unique
  ON test_cases (use_case_id, case_number);

-- Hot-path FK / filter indexes
CREATE INDEX IF NOT EXISTS idx_use_cases_project_id ON use_cases (project_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_use_case_id ON test_cases (use_case_id);
CREATE INDEX IF NOT EXISTS idx_test_steps_test_case_id ON test_steps (test_case_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_project_id ON test_runs (project_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_project_status ON test_runs (project_id, status);
CREATE INDEX IF NOT EXISTS idx_test_run_use_cases_test_run_id ON test_run_use_cases (test_run_id);
CREATE INDEX IF NOT EXISTS idx_test_run_use_cases_assigned_tester ON test_run_use_cases (assigned_tester_id);
CREATE INDEX IF NOT EXISTS idx_step_results_execution_id ON step_results (execution_id);
CREATE INDEX IF NOT EXISTS idx_defect_notes_defect_id ON defect_notes (defect_id);
CREATE INDEX IF NOT EXISTS idx_defects_project_status ON defects (project_id, status);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_defect_retests_defect_id ON defect_retests (defect_id);
CREATE INDEX IF NOT EXISTS idx_checklist_test_run_id ON test_run_checklist_items (test_run_id);
