-- Migration: Simplify defect status (13 states to 10 states)
-- 1. Add is_blocked and blocked_reason columns to defects table
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "is_blocked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "blocked_reason" text;
--> statement-breakpoint

-- 2. Migrate existing BLOCKED status
UPDATE "defects" SET
  status = 'IN_PROGRESS',
  is_blocked = true,
  blocked_reason = 'Migrated from BLOCKED state',
  updated_at = now()
WHERE status = 'BLOCKED';
--> statement-breakpoint

-- 3. Migrate existing IN_VERIFICATION status
UPDATE "defects" SET
  status = 'READY_FOR_VERIFICATION',
  updated_at = now()
WHERE status = 'IN_VERIFICATION';
--> statement-breakpoint

-- 4. Migrate existing PENDING_DEPLOYMENT_APPROVAL status
UPDATE "defects" SET
  status = 'READY_FOR_VERIFICATION',
  updated_at = now()
WHERE status = 'PENDING_DEPLOYMENT_APPROVAL';
--> statement-breakpoint

-- 5. Recreate the enum type without BLOCKED, IN_VERIFICATION, or PENDING_DEPLOYMENT_APPROVAL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'defect_status_old') THEN
    DROP TYPE defect_status_old;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'defect_status') THEN
    CREATE TYPE "public"."defect_status" AS ENUM(
      'NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS',
      'RESOLVED_DEV', 'READY_FOR_VERIFICATION', 'REGRESSED', 'CLOSED',
      'PENDING_BIZ_ACCEPTANCE', 'PASSED_BY_AGREEMENT'
    );
  END IF;
END $$;
--> statement-breakpoint

-- 6. Drop default, alter column type, then set new default
ALTER TABLE "defects" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'defect_status') THEN
    ALTER TABLE "defects" ALTER COLUMN "status" SET DATA TYPE defect_status USING status::text::defect_status;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'defect_status') THEN
    ALTER TABLE "defects" ALTER COLUMN "status" SET DEFAULT 'NEW';
  END IF;
END $$;
