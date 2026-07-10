-- Migration: QA review gate
-- 1. Add is_qa flag to project_assignments (a developer with QA capability)
-- 2. Add QA review columns to defects
-- 3. Add QA_PASSED to the defect_status enum between RESOLVED_DEV and READY_FOR_VERIFICATION
--    Uses the rename-create-alter-drop pattern (see 0014_simplify_defect_status.sql)
--    so this is safe for an enum already in use by a column with a default.

-- 1. is_qa flag
ALTER TABLE "project_assignments" ADD COLUMN IF NOT EXISTS "is_qa" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- 2. QA review tracking columns on defects
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "qa_reviewed_by_user_id" integer REFERENCES "users" ("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "qa_reviewed_at" timestamptz;
--> statement-breakpoint

-- 3. Recreate the enum type with QA_PASSED inserted before READY_FOR_VERIFICATION
ALTER TYPE "public"."defect_status" RENAME TO "defect_status_old";
--> statement-breakpoint

CREATE TYPE "public"."defect_status" AS ENUM(
  'NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS',
  'RESOLVED_DEV', 'QA_PASSED', 'READY_FOR_VERIFICATION', 'REGRESSED', 'CLOSED',
  'PENDING_BIZ_ACCEPTANCE', 'PASSED_BY_AGREEMENT'
);
--> statement-breakpoint

ALTER TABLE "defects" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint

ALTER TABLE "defects"
  ALTER COLUMN "status" SET DATA TYPE "public"."defect_status"
  USING status::text::"public"."defect_status";
--> statement-breakpoint

ALTER TABLE "defects" ALTER COLUMN "status" SET DEFAULT 'NEW';
--> statement-breakpoint

DROP TYPE "public"."defect_status_old";
