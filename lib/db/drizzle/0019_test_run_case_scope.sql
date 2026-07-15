-- Phase B: per-run case roles (verify / regression / blocked)
CREATE TABLE IF NOT EXISTS "test_run_case_scope" (
  "id" serial PRIMARY KEY NOT NULL,
  "test_run_id" integer NOT NULL REFERENCES "test_runs"("id") ON DELETE cascade,
  "test_case_id" integer NOT NULL REFERENCES "test_cases"("id") ON DELETE cascade,
  "role" text NOT NULL,
  "defect_id" integer REFERENCES "defects"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_test_run_case_scope_run_case"
  ON "test_run_case_scope" ("test_run_id", "test_case_id");

CREATE INDEX IF NOT EXISTS "idx_test_run_case_scope_run_id"
  ON "test_run_case_scope" ("test_run_id");

CREATE INDEX IF NOT EXISTS "idx_test_run_case_scope_role"
  ON "test_run_case_scope" ("test_run_id", "role");
