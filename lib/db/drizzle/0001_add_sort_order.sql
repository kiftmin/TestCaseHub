ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_run_use_cases" ADD COLUMN IF NOT EXISTS "free_pass_reason" text;
