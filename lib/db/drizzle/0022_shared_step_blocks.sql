-- Phase 2c: reusable multi-step templates (copy-on-insert into test cases)
CREATE TABLE IF NOT EXISTS "project_shared_step_blocks" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_shared_step_blocks_project_id_idx"
  ON "project_shared_step_blocks" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_shared_step_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "block_id" integer NOT NULL REFERENCES "project_shared_step_blocks"("id") ON DELETE cascade,
  "step_number" text NOT NULL,
  "instruction" text NOT NULL,
  "test_data" text,
  "expected_result" text,
  "sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_shared_step_items_block_id_idx"
  ON "project_shared_step_items" ("block_id");
