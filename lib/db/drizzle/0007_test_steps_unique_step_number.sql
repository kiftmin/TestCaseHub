-- Add unique constraint on (test_case_id, step_number) to prevent duplicate step numbers
-- within a single test case.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'test_steps_test_case_id_step_number_unique'
  ) THEN
    ALTER TABLE test_steps
      ADD CONSTRAINT test_steps_test_case_id_step_number_unique
      UNIQUE (test_case_id, step_number);
  END IF;
END $$;
