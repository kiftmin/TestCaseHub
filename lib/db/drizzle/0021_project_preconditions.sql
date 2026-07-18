-- Phase 2a: reusable project precondition library + case links
CREATE TABLE IF NOT EXISTS "project_preconditions" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "text" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_preconditions_project_id_idx"
  ON "project_preconditions" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "test_case_preconditions" (
  "id" serial PRIMARY KEY NOT NULL,
  "test_case_id" integer NOT NULL REFERENCES "test_cases"("id") ON DELETE cascade,
  "precondition_id" integer NOT NULL REFERENCES "project_preconditions"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "test_case_preconditions_unique"
  ON "test_case_preconditions" ("test_case_id", "precondition_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_case_preconditions_case_idx"
  ON "test_case_preconditions" ("test_case_id");
