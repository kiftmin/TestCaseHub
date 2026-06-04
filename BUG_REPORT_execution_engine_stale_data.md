# Bug: Execution Engine loads stale data — database data reverts between sessions

## Symptom (Updated)

The execution engine loads stale data from the database. The step_results rows in the database **have different values between full-report fetches** — same row IDs, but different `actual_result`, `passed`, etc. values. This means something is **reverting the data in the database** between sessions.

### Critical evidence from console logs

**First session** (after user submitted step results):
```
Selected execution id=26, stepResults= [
  {"id":99,"step_id":1,"passed":false,"actual_result":"dfsdf"},
  {"id":108,"step_id":2,"passed":true,"actual_result":"fgdgf"},
  {"id":125,"step_id":3,"passed":false,"actual_result":"jhkjhktrytryhtfh"},
  {"id":126,"step_id":9,"passed":false,"actual_result":"Q4"}
]
```

**Current session** (same test case, after server restart):
```
Selected execution id=26, stepResults= [
  {"id":125,"step_id":3,"passed":false,"actual_result":"A3"},
  {"id":99,"step_id":1,"passed":false,"actual_result":"q"},
  {"id":108,"step_id":2,"passed":false,"actual_result":"s1"},
  {"id":126,"step_id":9,"passed":false,"actual_result":"s3"}
]
```

The rows with IDs **99, 108, 125, 126** have **different values** between the two fetches. The data in the database was modified between the two sessions by something other than the user's PUT/POST requests.

## Architecture

### Frontend Component Structure (`TestRunDetailPage.tsx`)

The file contains **two components** in the same file:

1. **`TestRunDetailPage`** (line ~54) — The main page component
   - Holds `execModal` state: `useState<{ testCase: TestCase; testRunUseCase: TestRunUseCase } | null>(null)`
   - Renders `ExecutionModal` conditionally:
     ```tsx
     {execModal && (
       <ExecutionModal
         key={execModal.testCase.id}
         testRunId={testRunId}
         testCase={execModal.testCase}
         testRunUseCase={execModal.testRunUseCase}
         entryConfirmed={testRun.entry_confirmed}
         readOnly={isCompleted}
         onClose={() => setExecModal(null)}
       />
     )}
     ```

2. **`ExecutionModal`** (line ~710) — The modal component
   - Has its own state: `execution`, `results`, `overallResult`, `testerNotes`, `currentStep`, etc.
   - Has a `useEffect` with deps `[entryConfirmed, testRunId, testCase.id]` (line ~773)
   - This effect calls `initExec()` to load/create the execution
   - `initExec`: POST to create execution → if 403 "already executed", fetch full-report → populate state
   - The full-report includes `executions` with nested `stepResults`

### Key Props

| Prop | Source | Type |
|------|--------|------|
| `testCase` | `execModal.testCase` (state) | `TestCase` |
| `testRunId` | `Number(params.id)` from URL | `number` |
| `entryConfirmed` | `testRun.entry_confirmed` from `useQuery` | `boolean` |
| `readOnly` | `testRun.status === "completed"` | `boolean` |

### Backend Step Result Endpoints (`executions.ts`)

1. `POST /api/executions/:executionId/steps/:stepId/result` — **Upsert**: check for existing → update if exists, insert if not. After update, deletes older duplicates for the same `(execution_id, step_id)`.

2. `PUT /api/executions/:executionId/steps/:stepId/result` — Same logic: find latest (`orderBy: desc(id)`), update it, delete older duplicates.

Both endpoints use:
```typescript
const existingResult = await db.query.stepResults.findFirst({
  where: and(
    eq(schema.stepResults.execution_id, executionId),
    eq(schema.stepResults.step_id, stepId),
  ),
  orderBy: desc(schema.stepResults.id),
});
if (existingResult) {
  // UPDATE existing row, then DELETE older duplicates
} else {
  // INSERT new row
}
```

3. `GET /api/test-runs/:testRunId/full-report` — Returns all executions with nested stepResults:
```typescript
executions: { with: { testCase: true, stepResults: true } },
```

4. `PATCH /api/executions/:executionId` — Completes the execution (sets status, overall_result, notes)

### Database Schema (`schema.ts`)

```typescript
export const stepResults = pgTable("step_results", {
  id: serial("id").primaryKey(),
  execution_id: integer("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  step_id: integer("step_id").notNull().references(() => testSteps.id, { onDelete: "cascade" }),
  actual_result: text("actual_result"),          // nullable
  comments: text("comments"),                    // nullable
  passed: boolean("passed"),                     // NULLABLE! (no .notNull())
  recorded_at: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
});
```

**Important**: `passed` is nullable (`boolean("passed")` without `.notNull()`). This means `passed` can be `null`, `true`, or `false` in the database.

### Database Unique Indexes (added in `db.ts` startup cleanup)

- `idx_executions_run_case` — `CREATE UNIQUE INDEX ON executions (test_run_id, test_case_id)`
- `idx_step_results_exec_step` — `CREATE UNIQUE INDEX ON step_results (execution_id, step_id)`

Startup cleanup deletes duplicate rows keeping only the MAX(id) per group. The cleanup runs once on server start.

## What We've Tried (and why it's not enough)

### Backend fixes
- POST step result changed from always-INSERT to UPSERT ✓
- PUT endpoint uses `orderBy: desc(id)` to find the latest duplicate ✓
- Both endpoints delete older duplicates after updating the latest one ✓

### Database fixes
- Startup cleanup removes duplicate executions and step_results ✓
- Unique indexes prevent future duplicates ✓

### Frontend fixes
- `useRef` guard (removed — doesn't survive unmount) ✗
- Module-level cache (Map) — persists execution data across component remounts ✓
- Removed unnecessary `invalidateQueries` from `submitStepResult` ✓
- Restore `overallResult` and `testerNotes` from full-report ✓

### Why the module-level cache doesn't fix the issue

The cache preserves the USER'S in-session state across component remounts. But the **database data itself is stale**. The full-report endpoint returns different values for the same step_result rows between sessions. Since `initExec` loads data from the full-report (both on initial mount AND after the component somehow remounts mid-session), the stale DB data overwrites the user's cached values.

## Root Cause Investigation

### Confirmed: Database data changes between sessions

The SAME step_result rows (IDs 99, 108, 125, 126) for the SAME execution (ID 26) have DIFFERENT values when fetched at different times. No user-facing code directly modifies step_results outside of the PUT/POST endpoints.

### Hypotheses for what causes the data to revert

#### Hypothesis 1: Startup cleanup deletes wrong rows

The cleanup query:
```sql
DELETE FROM step_results sr1 USING (
  SELECT execution_id, step_id, MAX(id) AS max_id
  FROM step_results
  GROUP BY execution_id, step_id
  HAVING COUNT(*) > 1
) dup
WHERE sr1.execution_id = dup.execution_id
  AND sr1.step_id = dup.step_id
  AND sr1.id <> dup.max_id
```

This keeps MAX(id) per (execution_id, step_id) group. If the user's PUT/POST updated a row with a LOWER id (because the old backend code used `findFirst` without ordering), the startup cleanup would DELETE that updated row and keep a higher-id row with OLD data.

**Check**: Did the original backend code (before the fix) update the FIRST found row (not the latest)? The PUT endpoint originally used `Array.find()` or `findFirst` without `orderBy: desc(id)`. If so, it could have updated row 97 instead of row 108 for step_id=2. Then the startup cleanup deleted row 97 (not MAX(id)), losing the update.

#### Hypothesis 2: Two backend processes running

If two Node.js processes connect to the same database (one with old code, one with new), they could both write step_results. The old code (without unique index) creates new rows. The new code (with unique index) upserts. This creates conflicting data.

#### Hypothesis 3: The `passed` field being nullable causes wrong HTTP method choice

In the frontend's `submitStepResult`:
```typescript
const hasExisting = results[stepId]?.passed != null;
```

If `results[stepId].passed` is `null` (loaded from DB, since `passed` is nullable), `hasExisting` is `false`, so the frontend sends POST instead of PUT. Both endpoints do upsert, so this shouldn't cause data loss. BUT: if the POST endpoint's `findFirst` returns `undefined` (due to some condition), it would INSERT a new row. The unique index would cause a constraint violation error, and the `catch` block would return a 500 error. The frontend would show a toast error. The data might not be saved.

#### Hypothesis 4: Drizzle relations return incorrect data

The `executions.stepResults` relation (`many(stepResults)`) without explicit `fields`/`references` relies on Drizzle's inverse relation inference. If the inference is wrong, the full-report endpoint might return stepResults from a different execution.

## Files Involved

- `artifacts/uat-manager/src/pages/TestRunDetailPage.tsx` — Frontend (TestRunDetailPage + ExecutionModal)
- `artifacts/api-server/src/routes/executions.ts` — Backend step result endpoints (POST/PUT)
- `artifacts/api-server/src/routes/test-runs.ts` — Full-report endpoint (line 479)
- `artifacts/api-server/src/db.ts` — Startup cleanup and unique indexes
- `lib/db/src/schema.ts` — Database schema (stepResults, executions)
- `lib/api-client-react/src/custom-fetch.ts` — HTTP client

## Next Agent: Diagnostic Steps

### Step 1: Check if step_results are actually being updated correctly

Add logging to the PUT/POST step result endpoints to log the CURRENT database values BEFORE the update:

```typescript
// In POST endpoint (executions.ts line ~247)
const existingResult = await db.query.stepResults.findFirst({
  where: and(
    eq(schema.stepResults.execution_id, executionId),
    eq(schema.stepResults.step_id, stepId),
  ),
  orderBy: desc(schema.stepResults.id),
});
console.log(`[exec] POST step result BEFORE: id=${existingResult?.id} passed=${existingResult?.passed} actual_result=${existingResult?.actual_result} body=${JSON.stringify(parsed)}`);
```

Submit a step result and check BOTH server-side logs AND the subsequent database state.

### Step 2: Write a diagnostic endpoint

Add a `GET /api/executions/:id/debug` endpoint that returns the raw step_results and execution data for debugging:
```typescript
router.get("/executions/:id/debug", async (req, res, next) => {
  const execution = await db.query.executions.findFirst({
    where: eq(schema.executions.id, Number(req.params.id)),
    with: { stepResults: true },
  });
  res.json(execution);
});
```

This bypasses the frontend and the full-report endpoint to check the raw DB state.

### Step 3: Check for duplicate backend processes

Run `netstat -ano | findstr :3000` and `netstat -ano | findstr :3001` to see if there are multiple servers running.

### Step 4: Verify Drizzle relation inference

The `stepResults: many(stepResults)` relation on executions may need explicit `fields`/`references`:
```typescript
stepResults: many(stepResults, {
  fields: [executions.id],
  references: [stepResults.execution_id],
}),
```

Test if the full-report returns correct stepResults for each execution after adding explicit references.

### Step 5: Check if startup cleanup is the culprit

The startup cleanup runs on EVERY server restart. It keeps MAX(id) per group. Add logging to show what it deletes and what it keeps:
```sql
SELECT execution_id, step_id, id, actual_result, passed
FROM step_results
WHERE (execution_id, step_id) IN (
  SELECT execution_id, step_id
  FROM step_results
  GROUP BY execution_id, step_id
  HAVING COUNT(*) > 1
)
ORDER BY execution_id, step_id, id;
```

Run this BEFORE the cleanup to see the full picture.
