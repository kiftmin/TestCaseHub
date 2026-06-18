DO $$ BEGIN
 CREATE TYPE "public"."defect_status" AS ENUM('NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED_DEV', 'READY_FOR_VERIFICATION', 'REGRESSED', 'CLOSED', 'PENDING_BIZ_ACCEPTANCE', 'PASSED_BY_AGREEMENT', 'PENDING_DEPLOYMENT_APPROVAL', 'PENDING_RISK_ACCEPTANCE', 'IN_VERIFICATION');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP TABLE "bug_notes";--> statement-breakpoint
DROP TABLE "bugs";--> statement-breakpoint
ALTER TABLE "defects" ALTER COLUMN "execution_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ALTER COLUMN "status" SET DATA TYPE defect_status;--> statement-breakpoint
ALTER TABLE "defects" ALTER COLUMN "status" SET DEFAULT 'NEW';--> statement-breakpoint
ALTER TABLE "defect_notes" ADD COLUMN "is_system_note" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "defect_retests" ADD COLUMN "target_verification_run_id" integer;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "bug_number" integer;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "project_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "ticket_type" text DEFAULT 'SOFTWARE_BUG' NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "assigned_to_user_id" integer;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "support_ticket_number" text;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "root_cause_category" text;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "regression_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "status_audit_log" ADD COLUMN "justification" text;--> statement-breakpoint
ALTER TABLE "test_run_use_cases" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "defect_retests" ADD CONSTRAINT "defect_retests_target_verification_run_id_test_runs_id_fk" FOREIGN KEY ("target_verification_run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
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
