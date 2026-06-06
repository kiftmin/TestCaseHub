# Technical Bug Report — Execution Engine & Test Run Lifecycle

## Overview

Issues found in the Execution Engine (Guided mode) and Test Run completion flow,
discovered during a multi-user test run with two scenarios assigned to two
different users.

---

## Bug 1: Test Run auto-completes before all scenarios are done

**Status:** 🔴 Open  
**Severity:** High  
**Component:** `artifacts/api-server/src/routes/executions.ts` (lines 183–196)  
                    `artifacts/api-server/src/routes/test-runs.ts` (lines 11–24, 412)

### Symptom
A test run with 2 scenarios (scenario 1 → user 1, scenario 2 → user 2) was
marked `status = "completed"` after user 1 finished scenario 1, before user 2
had started scenario 2. This prevented user 2 from executing their test cases
(backend returns 403 "Cannot execute on a completed test run").

### Expected behavior
The test run should only flip to `"completed"` when ALL scenarios
(`testRunUseCases`) have terminal statuses (`"passed"`, `"failed"`,
`"passed_by_agreement"`).

### Analysis
There are two auto-completion pathways:

1. **`executions.ts:183-196`** — fires inside `PATCH /executions/:id` when
   `parsed.status === "completed"` or `"failed"`. Queries all
   `testRunUseCases` and checks if every one is terminal. This runs BEFORE the
   sync endpoint updates the current use case's status, so it should see the
   use case as still non-terminal and NOT complete the run.

2. **`test-runs.ts:412` → `recalculateTestRunCompletion()`** — fires AFTER
   the sync endpoint updates the current use case's status. Checks all use
   cases. With scenario 1 → terminal, scenario 2 → `"pending"`, this should
   NOT complete the run.

Both pathways should be safe, yet the run was completed. Possible causes:
   - A bug in the `allTerminal` check (e.g., empty use case list returns
     `true` because `allUseCases.length > 0` check is bypassed, but
     `.every()` on empty array returns `true`)
   - Race condition between PATCH and sync
   - Someone manually called `PATCH /test-runs/:id` with `{ status: "completed" }`
   - `free_pass` column interacting unexpectedly with terminal checks

### To investigate
- Reproduce with a 2-scenario test run
- Add logging before the `if (allTerminal)` guard to log each use case's
  status
- Verify whether scenario 2's `testRunUseCase` was somehow already terminal
  before user 1 completed

---

## Bug 2: Guided mode — Previous / Next / Complete buttons don't persist step result

**Status:** ✅ Fixed in commit `f9c2ca2`  
**Component:** `artifacts/uat-manager/src/pages/TestRunDetailPage.tsx`

### Symptom
In Guided mode, clicking Previous or Next navigates without saving the current
step's text fields (`actual_result`, `comments`). Only clicking Pass/Fail
triggers a save. The Complete button also doesn't save the last step's text
before the confirmation dialog.

### Fix
Each navigation handler now calls `submitStepResult(s.id, ...)` before
changing `currentStep`:
- Previous (line 1264–1268): saves if passed !== null
- Next (line 1284–1286): saves current result
- Complete (line 1243–1247): awaits `submitStepResult` before showing
  confirmation

---

## Bug 3: Fields appear blank during async initExec

**Status:** ✅ Fixed in commit `f9c2ca2`  
**Component:** `artifacts/uat-manager/src/pages/TestRunDetailPage.tsx`

### Symptom
On mount, the execution modal shows empty fields while `initExec` runs
because `results` state starts as `{}`. No loading indicator is shown.

### Fix
- Added `initialLoading` state (`useState(true)`)
- Spinner renders while `initialLoading` is true
- `setInitialLoading(false)` is called in:
  - The session-cache early return
  - The `if (!entryConfirmed)` guard
  - The `if (!user)` guard
  - The `finally` block of `initExec` (both success and error paths)

---

## Bug 4: Vite oxc parser chokes on JSX boundary pattern `)}<`

**Status:** ✅ Fixed in commit `f9c2ca2`  
**Component:** `artifacts/uat-manager/src/pages/TestRunDetailPage.tsx`

### Symptom
Build error with Vite's `oxc` parser when encountering `</div>)}</div>` —
the parser misinterprets the closing angle bracket sequence as an unterminated
regex.

### Fix
Replaced the inline ternary inside JSX with an IIFE:
```tsx
{(() => {
  if (condition) return (...);
  return (...);
})()}
```
This avoids the `)}<` sequence entirely.

---

## Bug 5: ReadOnly guard prevents execution creation POST for non-admin users

**Status:** ✅ Fixed in commit `f9c2ca2`  
**Component:** `artifacts/uat-manager/src/pages/TestRunDetailPage.tsx` (line 812)

### Symptom
A guard was added (previous session) to skip the execution creation POST when
`readOnly = true`, to avoid 403 console noise on completed runs. However,
`readOnly` was incorrectly `true` for user 2 on an `in_progress` test run,
causing the POST to be skipped entirely. The fallback loaded a stale execution
with 0 step results, leaving blank fields.

### Fix
Removed the `readOnly` guard entirely. The POST is always attempted. The
catch block handles both expected 403 cases gracefully:
- `"already been executed"` → loads from full-report
- `"Cannot execute on a completed test run"` → loads from full-report for viewing

---

## Bug 6: Startup cleanup deletes wrong duplicate step_results row

**Status:** ✅ Fixed in commit `f9c2ca2`  
**Component:** `artifacts/api-server/src/db.ts`

### Symptom
On startup, duplicate `step_results` rows were cleaned up by keeping `MAX(id)`
(latest inserted). But the correct row to keep is the one with the most recent
`recorded_at` (latest update). This caused execution data to regress to an
older state after a server restart.

### Fix
Changed from:
```sql
DELETE ... WHERE id <> MAX(id)
```
To:
```sql
DELETE ... WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY execution_id, step_id
      ORDER BY recorded_at DESC, id DESC
    ) as rn FROM step_results
  ) ranked WHERE ranked.rn > 1
)
```
This keeps the most recently updated row (ties broken by highest id).

---

## Bug 7: Full-report endpoint returns unsorted stepResults

**Status:** ✅ Fixed in commit `f9c2ca2`  
**Component:** `artifacts/api-server/src/routes/test-runs.ts` (line 493)

### Symptom
The `full-report` endpoint's `executions[].stepResults` array had no
deterministic ordering, causing step results to appear in arbitrary order
when loaded in the frontend.

### Fix
Added `orderBy: [desc(schema.stepResults.id)]` to the `stepResults`
relation in the Drizzle query.

---

## Bug 8: Light pink Fail button color

**Status:** 🔴 Open  
**Severity:** Low  
**Component:** `artifacts/uat-manager/src/pages/TestRunDetailPage.tsx`

### Symptom
The Fail button (or failed status indicator) renders in a light pink color
instead of the expected stronger red. The issue appeared after the IIFE
restructure of the body section.

### Likely cause
CSS class mismatch, missing `bg-red-*` utility, or the button inheriting a
different color from the restructured DOM tree. The `statusColors` map or
`ucStatusColors` may need adjustment.

### To investigate
- Check the button/status element's applied classes
- Verify that `bg-red-100` / `text-red-700` classes are being applied correctly
- Compare the rendered HTML before and after the IIFE restructure

---

## Bug 9: Proof upload / camera box not rendering below image field

**Status:** 🔴 Open  
**Severity:** Medium  
**Component:** `artifacts/uat-manager/src/pages/TestRunDetailPage.tsx`

### Symptom
The file upload button for proof images does not appear below the image
preview field in the execution modal.

### Expected behavior
A file input or upload button should render below the proof image URL/field,
allowing the tester to attach screenshots.

### Possible causes
- The upload button is conditionally hidden when `readOnly` is true
- The `onProofUpload` callback is undefined
- The `proofImage` prop is causing the `GuidedMode` component to render a
  different state without the upload button
- DOM structure changed after the IIFE restructure

### To investigate
- Check `GuidedMode` component's rendering logic for proof upload
- Check whether `onProofUpload` prop is correctly passed
- Check `readOnly` guard around the upload button
- Verify the `handleProofUpload` function is accessible

---

## Bug 10: All scenarios visible to all users, no per-user filtering

**Status:** 🔴 Open (Design decision)  
**Severity:** Low  
**Component:** `artifacts/uat-manager/src/pages/TestRunDetailPage.tsx` (line 383)

### Symptom
User 2 (tester) can see and click on user 1's test cases in the UI. All
scenarios and their test cases are rendered without filtering by the
currently logged-in user.

### Impact
- User 2 might accidentally click on user 1's test case and see their data
- Confusion about which test cases belong to which user

### Fix options
- Filter `useCases` to only show scenarios assigned to the current user
- Add a visual indicator (badge, color) to distinguish own vs others' scenarios
- Keep current behavior (all visible) but improve tester-name labels

---

## Appendix: Commit history since Bug 1–7 fixes

| Commit | Description |
|---|---|
| `f9c2ca2` | execution engine data staleness, guided mode persistence, startup cleanup |
| `a452c92` | add execution session cache module-level Map to survive remounts |
| `9ca2cc3` | execution data loss, stale data, permissions, and defect lifecycle |

All fixes are on the `main` branch.
