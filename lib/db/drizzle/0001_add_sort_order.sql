ALTER TABLE "use_cases" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
