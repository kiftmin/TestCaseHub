-- Backfill test_run_use_cases.status from existing executions.
-- Bug: test_run_use_cases.status was never updated when executions
-- happened, so dashboards/KPIs always read "pending". This migration
-- computes the correct status from executions of the use case's
-- test cases (same logic as the API syncUseCaseStatus helper).
--
-- Status rules:
--   failed               — any execution.overall_result = 'failed'
--   passed               — all executions passed, none by_agreement
--   passed_by_agreement  — all executions passed, some by_agreement
--   in_progress          — at least one execution started, none terminal
--   pending              — no executions yet
--
-- Also backfills updated_at to the latest execution.executed_at
-- (or created_at if no executions) so the "Completed Today" KPI
-- reflects actual completion time.

UPDATE test_run_use_cases truc
SET
  status = COALESCE((
    WITH uc_test_cases AS (
      SELECT id FROM test_cases WHERE use_case_id = truc.use_case_id
    ),
    uc_executions AS (
      SELECT e.overall_result, e.status, e.executed_at
      FROM executions e
      WHERE e.test_run_id = truc.test_run_id
        AND e.test_case_id IN (SELECT id FROM uc_test_cases)
    )
    SELECT
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM uc_executions) THEN 'pending'
        WHEN EXISTS (SELECT 1 FROM uc_executions WHERE overall_result = 'failed') THEN 'failed'
        WHEN (SELECT bool_and(overall_result IN ('passed', 'passed_by_agreement')) FROM uc_executions) THEN
          CASE WHEN EXISTS (SELECT 1 FROM uc_executions WHERE overall_result = 'passed_by_agreement')
               THEN 'passed_by_agreement' ELSE 'passed' END
        WHEN EXISTS (SELECT 1 FROM uc_executions WHERE status = 'in_progress') THEN 'in_progress'
        ELSE 'pending'
      END
  ), truc.status),
  updated_at = COALESCE(
    (SELECT MAX(executed_at) FROM executions
     WHERE test_run_id = truc.test_run_id
       AND test_case_id IN (SELECT id FROM test_cases WHERE use_case_id = truc.use_case_id)),
    truc.created_at
  )
WHERE TRUE;
