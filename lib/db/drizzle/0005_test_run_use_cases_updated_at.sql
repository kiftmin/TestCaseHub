-- Migration: Add updated_at to test_run_use_cases
-- Required for the "Completed Today" KPI on the tester dashboard.
-- Existing rows are backfilled with created_at so historical scenarios are still trackable.

ALTER TABLE "test_run_use_cases" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint

UPDATE "test_run_use_cases"
SET "updated_at" = "created_at"
WHERE "updated_at" IS NULL OR "updated_at" = "created_at" AND "created_at" < now() - interval '1 minute';
--> statement-breakpoint

-- Trigger to auto-update updated_at on row update
CREATE OR REPLACE FUNCTION trg_test_run_use_cases_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_test_run_use_cases_set_updated_at ON "test_run_use_cases";
--> statement-breakpoint

CREATE TRIGGER trg_test_run_use_cases_set_updated_at
BEFORE UPDATE ON "test_run_use_cases"
FOR EACH ROW
EXECUTE FUNCTION trg_test_run_use_cases_updated_at();
