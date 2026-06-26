ALTER TABLE "test_runs"
  ADD COLUMN IF NOT EXISTS "run_type" text NOT NULL DEFAULT 'standard';
