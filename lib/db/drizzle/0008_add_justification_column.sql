-- Add justification column to status_audit_log for corporate audit compliance.
-- Stores the required go-live justification when a defect transitions to PASSED_BY_AGREEMENT.

ALTER TABLE status_audit_log
  ADD COLUMN IF NOT EXISTS justification text;
