-- Add blocked_by_case_id column to executions table.
-- overall_result is a text column with application-level enum validation,
-- so no ALTER TYPE is needed — "blocked_dependency" is accepted by Drizzle schemas.
ALTER TABLE executions
  ADD COLUMN blocked_by_case_id INTEGER REFERENCES test_cases(id) ON DELETE SET NULL;
