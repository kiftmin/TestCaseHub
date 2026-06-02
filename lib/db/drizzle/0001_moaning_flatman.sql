CREATE TABLE IF NOT EXISTS "bug_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"bug_id" integer NOT NULL,
	"added_by_user_id" integer,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "test_run_use_cases" ADD COLUMN "free_pass_reason" text;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bug_notes" ADD CONSTRAINT "bug_notes_bug_id_bugs_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."bugs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bug_notes" ADD CONSTRAINT "bug_notes_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
