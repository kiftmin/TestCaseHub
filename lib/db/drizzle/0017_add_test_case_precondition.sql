-- Migration: Add precondition column to test_cases
-- Mirrors the existing acceptance_criteria column (nullable text).
-- Covers the rarer case-specific override (e.g. "Invoice Exists" for one test
-- case), distinct from the project-wide projects.entry_criteria.
ALTER TABLE "test_cases" ADD COLUMN IF NOT EXISTS "precondition" text;
