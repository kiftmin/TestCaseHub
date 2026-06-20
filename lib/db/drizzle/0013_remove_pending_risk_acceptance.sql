-- Migration: Remove PENDING_RISK_ACCEPTANCE from defect_status enum
-- Risk waivers now route through PENDING_BIZ_ACCEPTANCE with [RISK WAIVER] audit prefix.

-- 1. Move any existing PENDING_RISK_ACCEPTANCE rows to PENDING_BIZ_ACCEPTANCE
UPDATE "defects" SET
  status = 'PENDING_BIZ_ACCEPTANCE',
  accepted_by_business_note = COALESCE(accepted_by_business_note, '[RISK WAIVER] Migrated from PENDING_RISK_ACCEPTANCE'),
  updated_at = now()
WHERE status = 'PENDING_RISK_ACCEPTANCE';
--> statement-breakpoint

-- 2. Recreate the enum type without PENDING_RISK_ACCEPTANCE
ALTER TYPE defect_status RENAME TO defect_status_old;
--> statement-breakpoint

CREATE TYPE "public"."defect_status" AS ENUM(
  'NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED',
  'RESOLVED_DEV', 'READY_FOR_VERIFICATION', 'REGRESSED', 'CLOSED',
  'PENDING_BIZ_ACCEPTANCE', 'PASSED_BY_AGREEMENT',
  'PENDING_DEPLOYMENT_APPROVAL', 'IN_VERIFICATION'
);
--> statement-breakpoint

ALTER TABLE "defects" ALTER COLUMN "status" SET DATA TYPE defect_status USING status::text::defect_status;
--> statement-breakpoint

ALTER TABLE "defects" ALTER COLUMN "status" SET DEFAULT 'NEW';
--> statement-breakpoint

DROP TYPE defect_status_old;
