# Implementation Plan — Defect-Driven Retest Run

This plan describes the changes required to allow a Test Lead to compile a **Retest Run** from all defects currently at `READY_FOR_VERIFICATION`, and for tester execution results in that run to automatically resolve the linked defects — closing the loop without manual intervention.

---

## Background

Currently, once a developer resolves a defect and the Test Lead promotes it to `READY_FOR_VERIFICATION`, there is no automated mechanism to surface those defects back to business testers. A Test Lead must manually cross-reference defects against scenarios and build a new test run by hand. After testers execute, the Test Lead must then manually Quick Verify each defect individually.

This plan eliminates both manual steps.

---

## Proposed Changes

### 1. Database — `test_runs` table: add `run_type` column

The `test_runs` table needs a new `run_type` column to distinguish standard UAT runs from retest runs. This drives UI labelling and the auto-resolve logic.

**Values:** `"standard"` (default) | `"retest"`

#### [MODIFY] `lib/db/src/schema.ts`

Add `run_type` to the `testRuns` table:

```typescript
run_type: text("run_type", { enum: ["standard", "retest"] })
  .notNull()
  .default("standard"),
```

#### [NEW] `lib/db/drizzle/0015_add_run_type_to_test_runs.sql`

```sql
ALTER TABLE "test_runs"
  ADD COLUMN IF NOT EXISTS "run_type" text NOT NULL DEFAULT 'standard';
```

No data migration required — all existing rows default to `"standard"` correctly.

---

### 2. Backend API — new `POST /projects/:projectId/test-runs/retest` endpoint

#### [MODIFY] `artifacts/api-server/src/routes/test-runs.ts`

Add a new endpoint after the existing `POST /` (create test run) handler.

**What it does:**
1. Queries all `READY_FOR_VERIFICATION` defects for the project.
2. Extracts the `use_case_id` from each defect's linked `test_case` (via `testCase.use_case_id`).
3. Deduplicates use case IDs (multiple defects may share the same scenario).
4. Creates a new test run with `run_type = "retest"` and `source_test_run_id` set to the original test run of the first defect in each use case group (for traceability).
5. Inserts a `test_run_use_cases` row for each unique use case.
6. Seeds the standard entry checklist.
7. Returns the new run along with a summary of which defects were included.

**Authorisation:** `TEST_LEAD` or `ADMIN` only.

```typescript
// POST /api/projects/:projectId/test-runs/retest — TEST_LEAD / ADMIN only
router.post("/retest", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ message: "projectId is required" });
      return;
    }

    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const parsed = z.object({
      name: z.string(),
      scheduled_at: z.string().optional(),
    }).parse(req.body);

    // 1. Find all READY_FOR_VERIFICATION defects for this project
    const defects = await db.query.defects.findMany({
      where: and(
        eq(schema.defects.project_id, projectId),
        eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      ),
      with: {
        testCase: true,
      },
    });

    if (defects.length === 0) {
      res.status(400).json({
        message: "No defects are currently at READY_FOR_VERIFICATION",
      });
      return;
    }

    // 2. Extract unique use case IDs
    const useCaseIdSet = new Set<number>();
    for (const defect of defects) {
      if (defect.testCase?.use_case_id) {
        useCaseIdSet.add(defect.testCase.use_case_id);
      }
    }
    const useCaseIds = Array.from(useCaseIdSet);

    if (useCaseIds.length === 0) {
      res.status(400).json({
        message: "Could not resolve use case IDs from the linked defects",
      });
      return;
    }

    // 3. Create the retest run
    const [newRun] = await db.insert(schema.testRuns).values({
      project_id: projectId,
      name: parsed.name,
      scheduled_at: parsed.scheduled_at ? new Date(parsed.scheduled_at) : null,
      run_type: "retest",
    }).returning();

    // 4. Insert test_run_use_cases
    for (const useCaseId of useCaseIds) {
      await db.insert(schema.testRunUseCases).values({
        test_run_id: newRun.id,
        use_case_id: useCaseId,
      });
    }

    // 5. Seed standard entry checklist
    const defaultItems = [
      "Fixes have been deployed to the test environment",
      "Test data has been refreshed as required",
      "All testers have been notified of the retest scope",
      "Defects to be retested have been communicated to the team",
      "Test environment is accessible to all assigned testers",
    ];
    await db.insert(schema.testRunChecklistItems).values(
      defaultItems.map((item_text, sort_order) => ({
        test_run_id: newRun.id,
        item_text,
        sort_order: sort_order + 1,
      })),
    );

    await logAudit({
      entityType: "test_run",
      entityId: newRun.id,
      changedByUserId: req.user!.userId,
      toStatus: "created_retest",
    });

    res.status(201).json({
      ...newRun,
      defect_count: defects.length,
      use_case_count: useCaseIds.length,
    });
  } catch (err) { next(err); }
});
```

> **Route ordering note:** Register this route **before** `router.post("/")` (the generic create endpoint) to prevent Express matching `"/retest"` as a `project_id` parameter. Alternatively — and more robustly — register it under a distinct path such as `POST /projects/:projectId/retest-run` and wire it up in `app.ts` separately.

---

### 3. Backend API — auto-resolve defect on execution submit

When a tester submits a use case in a retest run, the system should automatically find the `READY_FOR_VERIFICATION` defect linked to that use case and call the existing quick-verify logic.

#### [MODIFY] `artifacts/api-server/src/routes/executions.ts`

In the `POST /test-runs/:testRunId/submit` handler, after the existing use case status sync and test run completion check, add:

```typescript
// Auto-resolve defects if this is a retest run
const testRunFull = await db.query.testRuns.findFirst({
  where: eq(schema.testRuns.id, testRunId),
});

if (testRunFull?.run_type === "retest") {
  for (const truc of allUseCases) {
    const useCaseId = truc.use_case_id;

    // Find the test case IDs in this use case
    const ucTestCaseIds = truc.useCase?.testCases.map(tc => tc.id) ?? [];

    // Find READY_FOR_VERIFICATION defects for these test cases
    const linkedDefects = ucTestCaseIds.length > 0
      ? await db.query.defects.findMany({
          where: and(
            eq(schema.defects.project_id, testRunFull.project_id),
            eq(schema.defects.status, "READY_FOR_VERIFICATION"),
            inArray(schema.defects.test_case_id, ucTestCaseIds),
          ),
        })
      : [];

    // Determine result for this use case from executions
    const ucExecutions = allExecutions.filter(e =>
      ucTestCaseIds.includes(e.test_case_id),
    );
    const anyFailed = ucExecutions.some(e => e.overall_result === "failed");
    const result: "passed" | "failed" = anyFailed ? "failed" : "passed";

    // Resolve each linked defect
    for (const defect of linkedDefects) {
      if (result === "passed") {
        await db.update(schema.defects)
          .set({
            status: "CLOSED",
            regression_index: 0,
            updated_at: new Date(),
            closed_at: new Date(),
          })
          .where(eq(schema.defects.id, defect.id));
      } else {
        await db.update(schema.defects)
          .set({
            status: "ASSIGNED",
            regression_index: sql`${schema.defects.regression_index} + 1`,
            updated_at: new Date(),
          })
          .where(eq(schema.defects.id, defect.id));
      }

      // Log the auto-resolution in the audit trail
      await logAudit({
        entityType: "defect",
        entityId: defect.id,
        changedByUserId: req.user!.userId,
        fromStatus: "READY_FOR_VERIFICATION",
        toStatus: result === "passed" ? "CLOSED" : "ASSIGNED",
        reason: `Auto-resolved from retest run ${testRunId} — ${result}`,
      });
    }
  }
}
```

> **Import note:** `inArray` and `sql` are already imported in `executions.ts`. `logAudit` will need to be imported from `../utils/project.js` if not already present.

---

### 4. Frontend — API type update

#### [MODIFY] `artifacts/uat-manager/src/types/api.ts`

Add `run_type` to the `TestRun` interface:

```typescript
export interface TestRun {
  // ... existing fields ...
  run_type: "standard" | "retest";
}
```

---

### 5. Frontend — "Create Retest Run" button in `ProjectDetailPage`

#### [MODIFY] `artifacts/uat-manager/src/pages/ProjectDetailPage.tsx`

**In `TestRunsTab`:**

Add a second mutation alongside `createMutation`:

```typescript
const createRetestMutation = useMutation({
  mutationFn: (d: { name: string; scheduled_at?: string }) =>
    customFetch(`/projects/${projectId}/test-runs/retest`, {
      method: "POST",
      body: JSON.stringify(d),
    }),
  onSuccess: () => {
    invalidate();
    setRetestDialog(false);
    toast.success("Retest run created");
  },
  onError: (e: Error) => toast.error(e.message),
});
```

Add a `retestDialog` state alongside the existing `newDialog` state, and a second button in the header row:

```tsx
{canCreate && (
  <div className="flex items-center gap-sm">
    <button
      onClick={() => setRetestDialog(true)}
      className="border border-outline-variant font-label-sm text-label-sm px-md py-1 rounded-lg hover:bg-surface-container-low transition-all"
    >
      Create Retest Run
    </button>
    <button
      onClick={() => setNewDialog(true)}
      className="bg-secondary text-on-secondary font-label-sm text-label-sm px-md py-1 rounded-lg hover:brightness-110 transition-all"
    >
      New Test Run
    </button>
  </div>
)}
```

The "Create Retest Run" button opens a simpler `RetestRunDialog` — just a name field and optional scheduled date, no scenario selection (scenarios are determined automatically from the defect list):

```tsx
function RetestRunDialog({
  onSave,
  onClose,
  saving,
}: {
  onSave: (d: { name: string; scheduled_at?: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState("Retest Run");
  const [scheduledAt, setScheduledAt] = useState("");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg space-y-lg">
        <h3 className="font-headline-md text-headline-md text-primary">Create Retest Run</h3>
        <p className="font-body-sm text-on-surface-variant">
          Automatically creates a test run containing the scenarios linked to all
          defects currently at <strong>Ready for Verification</strong>. Business
          testers will see this run in their dashboard.
        </p>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">Run Name</label>
          <input
            className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">Scheduled At (optional)</label>
          <input
            className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary outline-none"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>
        <div className="flex gap-md justify-end">
          <button
            onClick={onClose}
            className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!name || saving}
            onClick={() => onSave({ name, scheduled_at: scheduledAt || undefined })}
            className="px-lg py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 transition-all disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create Retest Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**In the run list render**, add a visual distinction for retest runs so the Test Lead can tell them apart at a glance:

```tsx
{runs?.map((r) => (
  <div key={r.id} onClick={() => navigate(`/test-runs/${r.id}`)} ...>
    <div className="flex items-center justify-between mb-xs">
      <div className="flex items-center gap-sm">
        <h4 className="font-label-md text-label-md">{r.name}</h4>
        {r.run_type === "retest" && (
          <span className="text-[10px] px-sm py-0.5 rounded bg-amber-100 text-amber-700 font-bold uppercase">
            Retest
          </span>
        )}
      </div>
      <span className={`text-[10px] px-sm py-1 rounded font-bold uppercase ${statusColors[r.status] ?? ""}`}>
        {r.status.replace(/_/g, " ")}
      </span>
    </div>
    ...
  </div>
))}
```

---

## Verification Plan

### Automated Tests

#### [MODIFY] `artifacts/api-server/src/__tests__/defects-rollback.test.ts`

Add test cases covering:

- `POST /projects/:id/test-runs/retest` returns 400 when no `READY_FOR_VERIFICATION` defects exist.
- `POST /projects/:id/test-runs/retest` returns 201 with correct `use_case_count` and `defect_count` when defects exist, and the created run has `run_type = "retest"`.
- Duplicate use cases (two defects in the same scenario) are deduplicated — only one `test_run_use_cases` row is created.
- Submitting a completed use case in a retest run with a passing result transitions the linked defect to `CLOSED`.
- Submitting with a failing result transitions the linked defect to `ASSIGNED` and increments `regression_index`.

Run with:

```powershell
npx tsx --env-file=.env src/__tests__/defects-rollback.test.ts
```

### Manual Verification

1. Ensure at least two defects are at `READY_FOR_VERIFICATION`, linked to different scenarios.
2. As a Test Lead, open the project's Test Runs tab and click **Create Retest Run**.
3. Name the run, save. Verify the new run appears with the **Retest** badge and contains only the scenarios linked to the `READY_FOR_VERIFICATION` defects (not all project scenarios).
4. Confirm entry criteria, assign the run to a business tester.
5. As the business tester, open the run, execute the scenarios, and submit — one pass, one fail.
6. Return to the Defect Log. Verify the defect whose scenario passed is now `CLOSED`, and the one that failed has returned to `ASSIGNED` with `regression_index` incremented by 1.
7. Verify both transitions appear in the audit trail with `reason: "Auto-resolved from retest run …"`.

---

## User Review Required

> [!WARNING]
> **Partial use case submissions:** The current auto-resolve logic triggers when a tester submits their assigned use cases. If a use case is assigned to Tester A but a different `READY_FOR_VERIFICATION` defect is linked to a test case within the same use case that is assigned to Tester B, auto-resolution will only fire after Tester B submits. This is correct behaviour but should be validated against how testers are assigned in practice.

> [!WARNING]
> **Multiple defects per use case:** If two separate defects both link to test cases within the same use case, both defects will receive the same pass/fail outcome (the overall result of all test cases in that scenario). There is currently no mechanism to resolve individual defects differently within a single scenario. If this is a real scenario in your data, a more granular test-case-to-defect mapping would be required.

> [!NOTE]
> **Checklist wording:** The retest run entry checklist uses different default items from the standard run checklist (reflecting the deployment/fix context rather than the initial test setup). Review the five items and adjust the wording to match your organisation's process before shipping.
