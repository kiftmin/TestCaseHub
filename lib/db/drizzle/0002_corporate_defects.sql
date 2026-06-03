-- Corporate Defect Tracking Lifecycle Migration
-- Consolidates bugs into defects, adds enterprise status engine

-- 1. Add new columns to defects table
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "project_id" integer;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "ticket_type" text DEFAULT 'SOFTWARE_BUG' NOT NULL;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "assigned_to_user_id" integer;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "support_ticket_number" text;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "root_cause_category" text;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "regression_index" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "defects" ALTER COLUMN "test_run_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "defects" ALTER COLUMN "execution_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "defect_retests" ADD COLUMN IF NOT EXISTS "target_verification_run_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "defects" ADD CONSTRAINT "defects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "defects" ADD CONSTRAINT "defects_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "defect_retests" ADD CONSTRAINT "defect_retests_target_verification_run_id_test_runs_id_fk" FOREIGN KEY ("target_verification_run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_defects_project_id ON "defects" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_defects_assigned_to_user_id ON "defects" ("assigned_to_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_defects_ticket_type ON "defects" ("ticket_type");
