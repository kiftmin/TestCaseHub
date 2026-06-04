-- Migration: Schema conformance fixes from spec audit
-- Adds bug_number, is_system_note, backfills existing defects

-- 1. Add bug_number to defects (nullable, backfillable)
ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "bug_number" integer;
--> statement-breakpoint

-- Backfill existing defects with project-scoped sequential bug numbers
UPDATE "defects" d
SET "bug_number" = sub.seq
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "project_id" ORDER BY "created_at") AS seq
  FROM "defects"
) sub
WHERE d.id = sub.id AND d."bug_number" IS NULL;
--> statement-breakpoint

-- 2. Add is_system_note to defect_notes
ALTER TABLE "defect_notes" ADD COLUMN IF NOT EXISTS "is_system_note" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- 3. Add index on defect_notes.is_system_note for efficient filtering
CREATE INDEX IF NOT EXISTS "idx_defect_notes_is_system_note" ON "defect_notes" ("is_system_note");
--> statement-breakpoint

-- 4. Add index on defects.bug_number for ordering
CREATE INDEX IF NOT EXISTS idx_defects_project_bug_number ON "defects" ("project_id", "bug_number");
