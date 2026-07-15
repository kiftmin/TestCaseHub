import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { CameraCapture } from "../components/CameraCapture";
import {
  BackBar,
  EmptyState,
  FilterTabs,
  StatusChip,
  progressStatusVariant,
  type FilterTab,
} from "../components/ui";
import type {
  TestRun,
  TestCase,
  TestStep,
  Execution,
  StepResult,
} from "../types/api";

/* ────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────── */

type CaseProgress = "Not Started" | "In Progress" | "Completed";

interface Draft {
  stepId: number;
  passed: boolean | null;
  actual_result: string;
  comments: string;
  savedAt: string;
}

// Unified per-step entry. Used by both Guided and Quick wizards so the
// source of truth lives in TesterCasePage and survives mode switches.
export interface ExecutionEntry {
  passed: boolean | null;
  actual_result: string;
  comments: string;
}

const EMPTY_ENTRY: ExecutionEntry = { passed: null, actual_result: "", comments: "" };

type CaseFilter = "all" | "not_started" | "in_progress" | "completed" | "blocked";

const PROGRESS_LABELS: Record<CaseProgress, string> = {
  "Not Started": "Not Started",
  "In Progress": "In Progress",
  Completed: "Completed",
};

const PROGRESS_ICONS: Record<CaseProgress, string> = {
  "Not Started": "radio_button_unchecked",
  "In Progress": "autorenew",
  Completed: "check_circle",
};

function isCaseBlocked(tc: TestCase): boolean {
  return tc.retestRole === "blocked" || tc.retestExecutable === false;
}

/* ────────────────────────────────────────────────────────────────────
   Utilities
   ──────────────────────────────────────────────────────────────────── */

function draftKey(testRunId: number, testCaseId: number, stepId: number, userId?: number) {
  const uid = userId != null ? `u${userId}_` : "";
  return `draft_step_${uid}${testRunId}_${testCaseId}_${stepId}`;
}

function isFromToday(savedAt: string): boolean {
  const d = new Date(savedAt);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function computeCaseProgress(
  steps: { id: number }[],
  stepResults: { step_id: number; passed: boolean | null; actual_result?: string | null }[],
): CaseProgress {
  if (steps.length === 0) return "Not Started";
  const allHavePassFail = steps.every(s =>
    stepResults.some(r => r.step_id === s.id && r.passed != null),
  );
  if (!allHavePassFail) {
    const someHavePassFail = steps.some(s =>
      stepResults.some(r => r.step_id === s.id && r.passed != null),
    );
    return someHavePassFail ? "In Progress" : "Not Started";
  }
  // All steps have pass/fail — verify failed steps have actual_result filled
  const failedWithoutActual = stepResults.filter(
    r => r.passed === false && (!r.actual_result || r.actual_result.trim() === ""),
  );
  if (failedWithoutActual.length > 0) return "In Progress";
  return "Completed";
}

/* ────────────────────────────────────────────────────────────────────
   Page entry — dispatches between selector and wizard
   ──────────────────────────────────────────────────────────────────── */

export function TesterCasePage({
  params,
}: {
  params: { testRunId: string; scenarioId: string; testCaseId?: string };
}) {
  const [, navigate] = useLocation();
  const testRunId = Number(params.testRunId);
  const scenarioId = Number(params.scenarioId);
  const testCaseId = params.testCaseId ? Number(params.testCaseId) : null;
  const user = getStoredUser();

  // Per-mount override of the mode (set by the in-page "Switch to ..." buttons).
  // Resets automatically when the user navigates to a different test case.
  const [modeOverride, setModeOverride] = useState<"guided" | "quick" | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset override when test case changes
    setModeOverride(null);
  }, [testCaseId]);

  useEffect(() => {
    document.title = testCaseId ? "Execute Test Case | TestCaseHub" : "Test Cases | TestCaseHub";
  }, [testCaseId]);

  if (!testCaseId) {
    return (
      <TestCaseSelector
        testRunId={testRunId}
        scenarioId={scenarioId}
        onBack={() => navigate(`/tester/run/${testRunId}`)}
      />
    );
  }

  const sessionMode: "guided" | "quick" =
    (typeof window !== "undefined" && sessionStorage.getItem(`tester_mode_${user?.userId}`) === "quick")
      ? "quick"
      : "guided";
  const mode = modeOverride ?? sessionMode;

  const onModeChange = (next: "guided" | "quick") => {
    sessionStorage.setItem(`tester_mode_${user?.userId}`, next);
    setModeOverride(next);
  };

  if (mode === "quick") {
    return (
      <ExecutionEngine
        mode="quick"
        testRunId={testRunId}
        scenarioId={scenarioId}
        testCaseId={testCaseId}
        onBack={() => navigate(`/tester/run/${testRunId}/scenario/${scenarioId}`)}
        onModeChange={onModeChange}
      />
    );
  }
  return (
    <ExecutionEngine
      mode="guided"
      testRunId={testRunId}
      scenarioId={scenarioId}
      testCaseId={testCaseId}
      onBack={() => navigate(`/tester/run/${testRunId}/scenario/${scenarioId}`)}
      onModeChange={onModeChange}
    />
  );
}

/* ────────────────────────────────────────────────────────────────────
   Execution Engine — owns the shared state (entries, localResults,
   hydration, sessionStorage sync) so the Guided and Quick wizards
   always operate on the same source of truth. Switching modes
   preserves every per-step Pass/Fail selection, actual_result text,
   and comments.
   ──────────────────────────────────────────────────────────────────── */

function ExecutionEngine({
  mode,
  testRunId,
  scenarioId,
  testCaseId,
  onBack,
  onModeChange,
}: {
  mode: "guided" | "quick";
  testRunId: number;
  scenarioId: number;
  testCaseId: number;
  onBack: () => void;
  onModeChange: (next: "guided" | "quick") => void;
}) {
  const user = getStoredUser();

  const { data: testCase } = useQuery({
    queryKey: ["test-case", testCaseId],
    queryFn: () => customFetch<TestCase & { steps: TestStep[]; stepResults?: StepResult[] }>(`/test-cases/${testCaseId}`),
    enabled: !!testCaseId,
  });

  const { data: testRun } = useQuery({
    queryKey: ["test-run", testRunId],
    queryFn: () => customFetch<TestRun>(`/test-runs/${testRunId}`),
    enabled: !!testRunId,
    staleTime: 0,
  });

  // Retest scope for this case (blocked / verify / regression)
  const retestCaseMeta = useMemo(() => {
    if (!testRun || testRun.run_type !== "retest") return null;
    const fromItems = testRun.verificationItems?.find((i) => i.testCaseId === testCaseId);
    if (fromItems) {
      return {
        role: fromItems.role,
        executable: fromItems.executable,
        blockingReason:
          fromItems.role === "blocked"
            ? `Blocked — open defect${fromItems.bugNumber != null ? ` #${fromItems.bugNumber}` : ""} still in development`
            : null,
      };
    }
    const fromTree = testRun.useCases
      ?.flatMap((u) => u.useCase?.testCases ?? [])
      .find((tc) => tc.id === testCaseId);
    if (fromTree?.retestRole) {
      return {
        role: fromTree.retestRole,
        executable: fromTree.retestExecutable !== false && fromTree.retestRole !== "blocked",
        blockingReason: fromTree.retestBlockingReason ?? null,
      };
    }
    if (testRun.blockedCaseIds?.includes(testCaseId)) {
      return { role: "blocked" as const, executable: false, blockingReason: "This test case is blocked and cannot be executed" };
    }
    return null;
  }, [testRun, testCaseId]);

  const isBlockedRetestCase =
    retestCaseMeta?.role === "blocked" || retestCaseMeta?.executable === false;

  const { data: execution } = useQuery({
    queryKey: ["tester-execution", testRunId, testCaseId],
    queryFn: async () => {
      const run = await customFetch<TestRun>(`/test-runs/${testRunId}`);
      // Never create an execution for blocked retest cases
      if (run.run_type === "retest") {
        const blocked =
          run.blockedCaseIds?.includes(testCaseId) ||
          run.verificationItems?.find((i) => i.testCaseId === testCaseId)?.role === "blocked" ||
          run.useCases
            ?.flatMap((u) => u.useCase?.testCases ?? [])
            .find((tc) => tc.id === testCaseId)?.retestRole === "blocked" ||
          run.verificationItems?.find((i) => i.testCaseId === testCaseId)?.executable === false;
        if (blocked) return undefined;
      }
      const existing = run.executions?.find((e) => e.test_case_id === testCaseId);
      if (existing) return existing;
      const result = await customFetch<Execution | { readOnly: boolean }>(`/test-runs/${testRunId}/test-cases/${testCaseId}/execute`, {
        method: "POST",
        body: JSON.stringify({ tester_id: user!.userId, tester_name: user!.username }),
      });
      if (result && typeof result === "object" && "readOnly" in result && (result as any).readOnly === true) {
        return undefined;
      }
      return result as Execution;
    },
    // Wait for test-run (scope) before attempting execute — avoids creating
    // an execution for a blocked retest case during the initial load race.
    enabled: !!testCaseId && !!user && !!testRun && !isBlockedRetestCase,
    retry: false,
  });

  const steps = useMemo(() => testCase?.steps ?? [], [testCase]);

  // Read-only: tester signed off, or retest-blocked case
  const isReadOnly = useMemo(() => {
    if (isBlockedRetestCase) return true;
    if (!testRun?.useCases) return false;
    const uc = testRun.useCases.find(u => u.use_case_id === scenarioId);
    return uc?.tester_sign_off === true;
  }, [testRun, scenarioId, isBlockedRetestCase]);

  const persistedStepResults = useMemo(() => {
    const map = new Map<number, StepResult>();
    (execution?.stepResults ?? []).forEach((r) => map.set(r.step_id, r));
    (testCase?.stepResults ?? []).forEach((r) => map.set(r.step_id, r));
    return map;
  }, [execution?.stepResults, testCase?.stepResults]);

  // Per-step entries — the single source of truth for both wizards.
  const [entries, setEntries] = useState<Map<number, ExecutionEntry>>(new Map());
  // Optimistic pass/fail per step — survives mode switches.
  const [localResults, setLocalResults] = useState<Map<number, boolean>>(new Map());
  // Tracks in-flight step-result mutations so we can block navigation while saves are pending.
  const pendingMutations = useRef(0);

  // Hydrate entries from sessionStorage drafts (today only) and API step results.
  // MERGE only — never wipe in-progress local edits when queries refetch
  // (invalidate after Pass/Fail used to replace the whole Map and blank
  // "What actually happened" until the server response caught up).
  useEffect(() => {
    if (steps.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- merge hydrate from session + API
    setEntries((prev) => {
      let changed = false;
      const next = new Map(prev);
      steps.forEach((s) => {
        const existing = next.get(s.id);
        // Keep any local content the user already has for this step
        if (
          existing &&
          (existing.passed != null ||
            (existing.actual_result && existing.actual_result.trim() !== "") ||
            (existing.comments && existing.comments.trim() !== ""))
        ) {
          return;
        }

        const key = draftKey(testRunId, testCaseId, s.id);
        const stored = sessionStorage.getItem(key);
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as Draft;
            if (parsed.savedAt && isFromToday(parsed.savedAt)) {
              next.set(s.id, {
                passed: parsed.passed,
                actual_result: parsed.actual_result,
                comments: parsed.comments,
              });
              changed = true;
              return;
            }
            sessionStorage.removeItem(key);
          } catch {
            sessionStorage.removeItem(key);
          }
        }

        const persisted = persistedStepResults.get(s.id);
        if (persisted) {
          next.set(s.id, {
            passed: persisted.passed,
            actual_result: persisted.actual_result ?? "",
            comments: persisted.comments ?? "",
          });
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [steps, testRunId, testCaseId, persistedStepResults]);

  // Persist drafts to sessionStorage (debounced, but writes happen
  // synchronously before the next render, so a quick mode switch
  // never loses data).
  useEffect(() => {
    if (entries.size === 0) return;
    const timeoutId = setTimeout(() => {
      steps.forEach((s) => {
        const e = entries.get(s.id);
        if (!e) return;
        if (e.passed === null && !e.actual_result && !e.comments) return;
        const key = draftKey(testRunId, testCaseId, s.id);
        sessionStorage.setItem(
          key,
          JSON.stringify({
            stepId: s.id,
            passed: e.passed,
            actual_result: e.actual_result,
            comments: e.comments,
            savedAt: new Date().toISOString(),
          })
        );
      });
    }, 150);
    return () => clearTimeout(timeoutId);
  }, [entries, steps, testRunId, testCaseId]);

  // Warn before browser refresh/close when mutations are in-flight.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingMutations.current > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const setEntry = (stepId: number, patch: Partial<ExecutionEntry>) => {
    setEntries((prev) => {
      const next = new Map(prev);
      const current = next.get(stepId) ?? { ...EMPTY_ENTRY };
      next.set(stepId, { ...current, ...patch });
      return next;
    });
    // Keep localResults in sync with the draft's `passed` so the Step wizard
    // (which reads from stepResultsByStep = persisted + localResults) reflects
    // Pass/Fail clicks made in Quick mode.
    if (typeof patch.passed === "boolean") {
      setLocalResults((prev) => {
        const next = new Map(prev);
        next.set(stepId, patch.passed!);
        return next;
      });
    }
  };

  const removeDraft = (stepId: number) => {
    setEntries((prev) => {
      if (!prev.has(stepId)) return prev;
      const next = new Map(prev);
      next.delete(stepId);
      return next;
    });
    const key = draftKey(testRunId, testCaseId, stepId);
    sessionStorage.removeItem(key);
  };

  const guardedOnBack = () => {
    if (pendingMutations.current > 0) {
      toast.warning("Please wait — saving your results...");
      return;
    }
    onBack();
  };

  const sharedProps = {
    testRunId,
    scenarioId,
    testCaseId,
    testCase,
    steps,
    execution,
    persistedStepResults,
    entries,
    setEntries,
    setEntry,
    localResults,
    setLocalResults,
    removeDraft,
    onBack: guardedOnBack,
    onModeChange,
    pendingMutations,
    isReadOnly,
    blockReason: isBlockedRetestCase
      ? (retestCaseMeta?.blockingReason ??
        "This test case is blocked and cannot be executed in this verification run")
      : null,
  };

  if (mode === "quick") {
    return <QuickWizard {...sharedProps} />;
  }
  return <StepWizard {...sharedProps} />;
}

/* ────────────────────────────────────────────────────────────────────
   Level 2: Test Case Selector
   ──────────────────────────────────────────────────────────────────── */

function TestCaseSelector({
  testRunId,
  scenarioId,
  onBack,
}: {
  testRunId: number;
  scenarioId: number;
  onBack: () => void;
}) {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"guided" | "quick">(() => {
    const stored = sessionStorage.getItem(`tester_mode_${getStoredUser()?.userId}`);
    return stored === "quick" ? "quick" : "guided";
  });
  const [filter, setFilter] = useState<CaseFilter>("all");

  useEffect(() => {
    sessionStorage.setItem(`tester_mode_${getStoredUser()?.userId}`, mode);
  }, [mode]);

  const { data: testRun, isLoading: testRunLoading } = useQuery({
    queryKey: ["test-run", testRunId],
    queryFn: () => customFetch<TestRun>(`/test-runs/${testRunId}`),
    staleTime: 0, // always refetch on mount so progress reflects latest submissions
  });

  const { data: useCase, isLoading: useCaseLoading } = useQuery({
    queryKey: ["use-case", scenarioId],
    queryFn: () =>
      customFetch<{ id: number; name: string; code: string; testCases: (TestCase & { steps?: TestStep[]; stepResults?: StepResult[] })[] }>(
        `/use-cases/${scenarioId}`
      ),
    staleTime: 0,
  });

  const isLoading = testRunLoading || useCaseLoading;

  // For retest runs, only show scoped cases (verify/regression/blocked) with roles.
  // Never fall back to the full plan — that would re-enable blocked siblings.
  const testCases = useMemo(() => {
    if (testRun?.run_type === "retest") {
      const fromRun =
        testRun.useCases?.find((u) => u.use_case_id === scenarioId)?.useCase?.testCases ?? [];
      if (fromRun.length > 0) return fromRun;

      const items = (testRun.verificationItems ?? []).filter((i) => i.useCaseId === scenarioId);
      if (items.length === 0) return [];
      const byId = new Map((useCase?.testCases ?? []).map((tc) => [tc.id, tc]));
      return items.map((item) => {
        const base = byId.get(item.testCaseId);
        return {
          ...(base ?? {
            id: item.testCaseId,
            use_case_id: scenarioId,
            case_number: item.caseNumber ?? String(item.testCaseId),
            title: item.caseTitle ?? `Test Case #${item.testCaseId}`,
            test_type: null,
            estimated_minutes: null,
            acceptance_criteria: null,
            precondition: null,
            created_at: "",
          }),
          retestRole: item.role,
          retestExecutable: item.executable,
          retestDefectId: item.defectId,
          retestBugNumber: item.bugNumber,
          retestBlockingReason:
            item.role === "blocked"
              ? `Open defect${item.bugNumber != null ? ` #${item.bugNumber}` : ""} still in development`
              : null,
        } as TestCase & { steps?: TestStep[]; stepResults?: StepResult[] };
      });
    }
    return useCase?.testCases ?? [];
  }, [testRun, useCase, scenarioId]);

  // Build a reliable testCaseId → progress map.
  // If the execution has been submitted (overall_result set), use that directly.
  // Otherwise compute from step results so in-progress work is reflected.
  const caseProgressById = useMemo(() => {
    const map = new Map<number, CaseProgress>();
    const execs = testRun?.executions ?? [];
    for (const exec of execs) {
      const tc = testCases.find(t => t.id === exec.test_case_id);
      if (!tc) continue;
      let progress: CaseProgress;
      if (exec.overall_result != null) {
        // Execution was submitted — it's definitively Completed
        progress = "Completed";
      } else {
        progress = computeCaseProgress(tc.steps ?? [], exec.stepResults ?? []);
      }
      map.set(exec.test_case_id, progress);
    }
    return map;
  }, [testRun?.executions, testCases]);

  const caseProgresses = useMemo(
    () => testCases.map((tc) => caseProgressById.get(tc.id) ?? "Not Started"),
    [testCases, caseProgressById]
  );
  const summary = useMemo(() => {
    const total = testCases.length;
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let blocked = 0;
    testCases.forEach((tc, i) => {
      if (isCaseBlocked(tc)) {
        blocked++;
        return;
      }
      const p = caseProgresses[i];
      if (p === "Completed") completed++;
      else if (p === "In Progress") inProgress++;
      else notStarted++;
    });
    const executable = total - blocked;
    // Progress only counts cases that can be executed (exclude blocked)
    const progress = executable > 0 ? Math.round((completed / executable) * 100) : 0;
    return { total, completed, inProgress, notStarted, blocked, executable, progress };
  }, [testCases, caseProgresses]);

  const filteredIndices = useMemo(() => {
    return testCases
      .map((tc, i) => ({ tc, progress: caseProgresses[i], index: i }))
      .filter(({ tc, progress }) => {
        const blocked = isCaseBlocked(tc);
        if (filter === "all") return true;
        if (filter === "blocked") return blocked;
        if (blocked) return false; // blocked only under All / Blocked filters
        if (filter === "not_started") return progress === "Not Started";
        if (filter === "in_progress") return progress === "In Progress";
        if (filter === "completed") return progress === "Completed";
        return true;
      });
  }, [testCases, caseProgresses, filter]);

  const filterTabs: FilterTab<CaseFilter>[] = [
    { key: "all", label: "All", count: testCases.length, icon: "view_module" },
    { key: "not_started", label: "Not Started", count: summary.notStarted, icon: "radio_button_unchecked" },
    { key: "in_progress", label: "In Progress", count: summary.inProgress, icon: "autorenew" },
    { key: "completed", label: "Completed", count: summary.completed, icon: "check_circle" },
    ...(summary.blocked > 0
      ? [{ key: "blocked" as const, label: "Blocked", count: summary.blocked, icon: "block" }]
      : []),
  ];

  return (
    <div className="space-y-lg max-w-5xl mx-auto w-full">
      <BackBar
        back={{ label: "Scenarios", href: `/tester/run/${testRunId}` }}
        current={useCase?.code ?? `Scenario #${scenarioId}`}
        context={useCase?.name}
        onBack={onBack}
      />

      <header className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg space-y-md">
        <div className="space-y-xs">
          <p className="text-label-sm uppercase tracking-widest font-bold text-on-surface-variant">
            {testRun?.project?.name ?? "Project"} • {testRun?.name ?? "Test Run"}
          </p>
          <h1 className="font-display-md text-display-md text-primary leading-tight">
            {useCase?.name ?? "Test Scenario"}
          </h1>
          <div className="flex items-center gap-sm pt-sm flex-wrap">
            <Stat label="Total" value={summary.total} />
            <Stat label="Completed" value={summary.completed} tone="success" />
            <Stat label="In Progress" value={summary.inProgress} tone="warning" />
            <Stat label="Not Started" value={summary.notStarted} tone="neutral" />
            {summary.blocked > 0 && (
              <Stat label="Blocked" value={summary.blocked} tone="error" />
            )}
          </div>
          <div className="space-y-xs pt-sm">
            <div className="flex items-center justify-between text-label-sm">
              <span className="font-bold uppercase tracking-wider text-on-surface-variant">Progress</span>
              <span>
                {summary.completed} / {summary.executable} executable
                {summary.blocked > 0 ? (
                  <span className="text-on-surface-variant"> · {summary.blocked} blocked</span>
                ) : null}
              </span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
              <div
                className="bg-secondary h-full rounded-full transition-all duration-500"
                style={{ width: `${summary.progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-sm pt-sm border-t border-outline-variant/50">
          <div>
            <p className="text-label-sm uppercase tracking-wider font-bold text-on-surface-variant">
              Execution mode
            </p>
            <p className="text-body-sm text-on-surface-variant mt-0.5">
              Choose how testers work through this scenario.
            </p>
          </div>
          <div role="tablist" className="inline-flex items-center gap-xs bg-surface-container p-xs rounded-lg shrink-0">
            {(["guided", "quick"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`px-md py-xs rounded-md font-label-md text-label-sm transition-all ${
                  mode === m
                    ? "bg-surface-container-lowest text-secondary shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {m === "guided" ? "Guided" : "Quick"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-sm">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-surface-container-low border border-outline-variant rounded-xl animate-pulse" />
          ))}
        </div>
      ) : testCases.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No test cases in this scenario"
          description="The Test Lead has not added any test cases to this scenario yet."
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-md flex-wrap">
            <FilterTabs<CaseFilter> tabs={filterTabs} active={filter} onChange={setFilter} />
            <p className="text-label-sm text-on-surface-variant">
              Showing {filteredIndices.length} of {testCases.length}
            </p>
          </div>

          {filteredIndices.length === 0 ? (
            <EmptyState
              icon="filter_alt_off"
              title="Nothing matches this filter"
              description="Try a different filter to see more test cases."
            />
          ) : (
            <div className="space-y-sm">
              {filteredIndices.map(({ tc, progress }) => {
                const blocked =
                  tc.retestRole === "blocked" || tc.retestExecutable === false;
                const actionLabel = blocked
                  ? "Blocked"
                  : progress === "Completed"
                    ? "Review"
                    : progress === "In Progress"
                      ? "Continue"
                      : "Start";
                return (
                  <article
                    key={tc.id}
                    className={`bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden transition-all ${
                      blocked ? "opacity-70" : "hover:shadow-md"
                    }`}
                  >
                    <button
                      onClick={() => {
                        if (blocked) {
                          toast.error(
                            tc.retestBlockingReason ||
                              "This test case is blocked and cannot be executed in this verification run",
                          );
                          return;
                        }
                        navigate(`/tester/run/${testRunId}/scenario/${scenarioId}/case/${tc.id}`);
                      }}
                      className={`w-full p-md flex items-start gap-md text-left ${
                        blocked ? "cursor-not-allowed" : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0 space-y-xs">
                        <div className="flex items-center gap-sm flex-wrap">
                          <span className="text-label-md font-label-md text-secondary font-bold">
                            [{tc.case_number}]
                          </span>
                          {tc.test_type && (
                            <span className="text-[10px] uppercase tracking-wider font-bold text-on-secondary-container bg-secondary-container px-2 py-0.5 rounded-full">
                              {tc.test_type}
                            </span>
                          )}
                          {tc.estimated_minutes != null && (
                            <span className="text-label-sm text-on-surface-variant inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">schedule</span>
                              ~{tc.estimated_minutes}m
                            </span>
                          )}
                          {blocked ? (
                            <StatusChip variant="error" icon="block">
                              Blocked
                            </StatusChip>
                          ) : (
                            <StatusChip variant={progressStatusVariant[progress]} icon={PROGRESS_ICONS[progress]}>
                              {PROGRESS_LABELS[progress]}
                            </StatusChip>
                          )}
                          {tc.retestRole === "verify" && (
                            <span className="text-[10px] uppercase tracking-wider font-bold text-green-800 bg-green-100 px-2 py-0.5 rounded-full">
                              Verify
                              {tc.retestBugNumber != null ? ` #${tc.retestBugNumber}` : ""}
                            </span>
                          )}
                          {tc.retestRole === "regression" && (
                            <span className="text-[10px] uppercase tracking-wider font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full">
                              Regression
                            </span>
                          )}
                        </div>
                        <p className="font-title-sm text-title-sm text-on-surface leading-snug">
                          {tc.title}
                        </p>
                        {blocked && tc.retestBlockingReason && (
                          <p className="text-body-sm text-red-700">
                            {tc.retestBlockingReason}
                          </p>
                        )}
                        {!blocked && tc.acceptance_criteria && (
                          <p className="text-body-sm text-on-surface-variant line-clamp-2">
                            <span className="font-bold uppercase tracking-wider text-[10px]">Acceptance: </span>
                            {tc.acceptance_criteria}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-sm">
                        {!blocked && (
                          <span className="hidden sm:inline-flex items-center gap-xs px-md py-1.5 rounded-lg bg-primary text-on-primary text-label-sm font-label-md hover:opacity-90 transition-all">
                            {actionLabel}
                            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                          </span>
                        )}
                        {blocked ? (
                          <span className="material-symbols-outlined text-red-600">block</span>
                        ) : (
                          <span className="material-symbols-outlined text-on-surface-variant sm:hidden">chevron_right</span>
                        )}
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "error" | "neutral" }) {
  const toneClass =
    tone === "success" ? "text-green-700" :
    tone === "warning" ? "text-amber-700" :
    tone === "error" ? "text-red-700" :
    "text-on-surface";
  return (
    <div className="flex items-center gap-xs">
      <span className={`font-headline-sm text-headline-sm ${toneClass}`}>{value}</span>
      <span className="text-label-sm uppercase tracking-wider font-bold text-on-surface-variant">{label}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Level 3: Step Wizard
   ──────────────────────────────────────────────────────────────────── */

function StepWizard({
  testRunId,
  scenarioId,
  testCaseId,
  testCase,
  steps,
  execution,
  entries,
  setEntry,
  localResults,
  setLocalResults,
  removeDraft,
  onBack,
  onModeChange,
  pendingMutations,
  isReadOnly,
  blockReason,
}: {
  testRunId: number;
  scenarioId: number;
  testCaseId: number;
  testCase: (TestCase & { steps: TestStep[]; stepResults?: StepResult[] }) | undefined;
  steps: TestStep[];
  execution: Execution | undefined;
  entries: Map<number, ExecutionEntry>;
  setEntries: React.Dispatch<React.SetStateAction<Map<number, ExecutionEntry>>>;
  setEntry: (stepId: number, patch: Partial<ExecutionEntry>) => void;
  localResults: Map<number, boolean>;
  setLocalResults: React.Dispatch<React.SetStateAction<Map<number, boolean>>>;
  removeDraft: (stepId: number) => void;
  onBack: () => void;
  onModeChange: (next: "guided" | "quick") => void;
  pendingMutations: React.MutableRefObject<number>;
  isReadOnly: boolean;
  blockReason?: string | null;
}) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [stepIndex, setStepIndex] = useState(0);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentStep = steps[stepIndex];
  const entry = currentStep ? entries.get(currentStep.id) : undefined;

  // Merge persisted step results with optimistic local ones and any draft
  // entries (highest priority — the user's in-progress Pass/Fail click).
  // Including `entries` here is what keeps the Pass button + sidebar in sync
  // with the Quick wizard, which reads `entries.passed` first.
  const stepResultsByStep = useMemo(() => {
    const map = new Map<number, boolean | null>();
    (execution?.stepResults ?? []).forEach((r) => map.set(r.step_id, r.passed));
    (testCase?.stepResults ?? []).forEach((r) => map.set(r.step_id, r.passed));
    localResults.forEach((v, k) => map.set(k, v));
    entries.forEach((entry, k) => {
      if (entry.passed !== null) {
        map.set(k, entry.passed);
      }
    });
    return map;
  }, [execution?.stepResults, testCase?.stepResults, localResults, entries]);

  const submitStepMut = useMutation({
    mutationFn: (data: { passed: boolean; actual_result: string; comments: string }) =>
      customFetch(`/executions/${execution!.id}/steps/${currentStep!.id}/result`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onMutate: (vars) => {
      pendingMutations.current++;
      const stepId = currentStep!.id;
      const previous = localResults.get(stepId) ?? null;
      setLocalResults((prev) => {
        const next = new Map(prev);
        next.set(stepId, vars.passed);
        return next;
      });
      return { stepId, previous };
    },
    onSuccess: (_data, vars) => {
      // Clear sessionStorage draft only — keep entries so the textarea
      // does not blank while queries refetch (see merge hydrate above).
      const stepId = currentStep!.id;
      sessionStorage.removeItem(draftKey(testRunId, testCaseId, stepId));
      toast.success(`Step ${stepIndex + 1} recorded as ${vars.passed ? "Pass" : "Fail"}`);
      queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
      queryClient.invalidateQueries({ queryKey: ["tester-execution", testRunId, testCaseId] });
      queryClient.invalidateQueries({ queryKey: ["test-case", testCaseId] });
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx) {
        setLocalResults((prev) => {
          const next = new Map(prev);
          if (ctx.previous == null) next.delete(ctx.stepId);
          else next.set(ctx.stepId, ctx.previous);
          return next;
        });
      }
      toast.error(e.message);
    },
    onSettled: () => { pendingMutations.current--; },
  });

  // Is the current step recorded? (used to enable Next)
  const currentStepRecorded =
    stepResultsByStep.get(currentStep?.id ?? -1) != null;

  // Are all steps recorded? (used to enable Submit Case on the last step)
  const allStepsRecorded = useMemo(() => {
    if (steps.length === 0) return false;
    return steps.every((s) => stepResultsByStep.get(s.id) != null);
  }, [steps, stepResultsByStep]);

  // Check if all failed steps have actual_result filled
  const validateFailedSteps = useMemo(() => {
    const failedSteps: string[] = [];
    steps.forEach((s) => {
      const e = entries.get(s.id);
      const persisted = execution?.stepResults?.find(r => r.step_id === s.id);
      const passed = e?.passed ?? localResults.get(s.id) ?? persisted?.passed ?? null;
      if (passed === false) {
        const actual = e?.actual_result ?? persisted?.actual_result ?? "";
        if (!actual.trim()) {
          failedSteps.push(`Step ${s.step_number}: "What actually happened" is required when marking a step as Fail`);
        }
      }
    });
    return failedSteps;
  }, [steps, entries, localResults, execution]);

  // Check if execution already has an overall_result (was previously submitted)
  const previouslySubmitted = execution?.overall_result != null;

  if (!testCase) {
    return (
      <div className="max-w-2xl mx-auto py-2xl text-center">
        <div className="w-10 h-10 mx-auto border-4 border-secondary border-t-transparent rounded-full animate-spin" />
        <p className="mt-md text-on-surface-variant">Loading test case…</p>
      </div>
    );
  }

  if (!currentStep) {
    return (
      <div className="max-w-2xl mx-auto py-2xl">
        <EmptyState
          icon="inbox"
          title="This test case has no steps"
          description="Ask your Test Lead to add at least one step before executing."
          action={
            <button
              onClick={onBack}
              className="inline-flex items-center gap-xs px-lg py-sm bg-primary text-on-primary rounded-lg font-label-md hover:opacity-90 transition-all"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Cases
            </button>
          }
        />
      </div>
    );
  }

  const overallProgress = ((stepIndex + 1) / steps.length) * 100;
  const canPrev = stepIndex > 0;
  const isLast = stepIndex === steps.length - 1;

  return (
    <div className="space-y-md max-w-7xl mx-auto w-full">
      {blockReason ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-md flex items-center gap-sm">
          <span className="material-symbols-outlined text-red-600">block</span>
          <span className="text-label-md text-red-800">{blockReason}</span>
        </div>
      ) : isReadOnly ? (
        <div className="bg-gray-100 border border-gray-300 rounded-xl p-md flex items-center gap-sm">
          <span className="material-symbols-outlined text-gray-500">lock</span>
          <span className="text-label-md text-gray-600">
            This test case is read-only — you have already submitted this test run.
          </span>
        </div>
      ) : null}
      <BackBar
        back={{ label: "Cases", href: `/tester/run/${testRunId}/scenario/${scenarioId}` }}
        current={`[${testCase.case_number}] ${testCase.title}`}
        context={`Step ${stepIndex + 1} of ${steps.length}`}
        onBack={onBack}
        right={
          <div className="flex items-center gap-xs">
            <button
              onClick={() => onModeChange("quick")}
              className="inline-flex items-center gap-xs px-sm py-xs text-label-sm text-on-surface-variant hover:text-on-surface border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">bolt</span>
              Switch to Quick
            </button>
            <button
              onClick={() => setShowSidebar((s) => !s)}
              className="inline-flex items-center gap-xs px-sm py-xs text-label-sm text-on-surface-variant hover:text-on-surface border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors"
              aria-pressed={showSidebar}
            >
              <span className="material-symbols-outlined text-[16px]">
                {showSidebar ? "view_list" : "view_headline"}
              </span>
              {showSidebar ? "Hide steps" : "Show steps"}
            </button>
          </div>
        }
      />

      <div className="grid gap-md" style={{ gridTemplateColumns: showSidebar ? "minmax(0, 280px) minmax(0, 1fr)" : "minmax(0, 1fr)" }}>
        {showSidebar && (
          <StepSidebar
            steps={steps}
            currentIndex={stepIndex}
            stepResults={stepResultsByStep}
            onJump={(i) => setStepIndex(i)}
          />
        )}

        <div className="space-y-md min-w-0">
          {/* Progress bar */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md">
            <div className="flex items-center justify-between text-label-sm mb-xs">
              <span className="font-bold uppercase tracking-wider text-on-surface-variant">
                Overall progress
              </span>
              <span className="font-bold text-on-surface">
                {stepIndex + 1} / {steps.length} steps
              </span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
              <div
                className="bg-secondary h-full rounded-full transition-all duration-500"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>

          {testCase.acceptance_criteria && (
            <div className="bg-secondary-container border-l-4 border-secondary rounded-xl p-md flex gap-md">
              <div className="shrink-0 w-8 h-8 rounded-full bg-secondary text-on-secondary flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">flag</span>
              </div>
              <div className="min-w-0">
                <p className="text-label-sm uppercase tracking-wider font-bold text-on-secondary-container mb-1">
                  Acceptance criteria
                </p>
                <p className="text-body-base text-on-secondary-container">
                  {testCase.acceptance_criteria}
                </p>
              </div>
            </div>
          )}

          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg space-y-md">
            <header className="flex items-center gap-md pb-md border-b border-outline-variant">
              <div className="shrink-0 w-12 h-12 rounded-full bg-primary text-on-primary flex items-center justify-center font-headline-md text-headline-md">
                {stepIndex + 1}
              </div>
              <div className="min-w-0">
                <p className="text-label-sm uppercase tracking-wider font-bold text-on-surface-variant">
                  Step {stepIndex + 1} of {steps.length}
                </p>
                <h2 className="font-title-sm text-title-sm text-on-surface">
                  Execute the following action
                </h2>
              </div>
            </header>

            <p className="text-body-lg text-on-surface leading-relaxed font-body-base">
              {currentStep.instruction}
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-md">
              <p className="text-label-sm uppercase tracking-wider font-bold text-amber-800 mb-1 inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">data_object</span>
                Test data
              </p>
              <p className={`text-body-base whitespace-pre-wrap ${currentStep.test_data ? "text-amber-900" : "text-amber-700/60 italic"}`}>
                {currentStep.test_data || "Not provided"}
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-md">
              <p className="text-label-sm uppercase tracking-wider font-bold text-blue-800 mb-1 inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">target</span>
                Expected result
              </p>
              <p className={`text-body-base whitespace-pre-wrap ${currentStep.expected_result ? "text-blue-900" : "text-blue-700/60 italic"}`}>
                {currentStep.expected_result || "Not provided"}
              </p>
            </div>
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md space-y-md">
            <div>
              <label className="text-label-md font-label-md text-on-surface mb-xs block">
                What actually happened?
              </label>
              <textarea
                value={entry?.actual_result ?? ""}
                onChange={(e) => setEntry(currentStep.id, { actual_result: e.target.value })}
                rows={3}
                placeholder="Describe what you observed while executing this step…"
                disabled={isReadOnly}
                className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base text-on-surface placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-secondary/20 focus:border-secondary outline-none transition-all resize-y disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </div>

            {entry && (entry.actual_result || entry.comments) && (
              <div className="bg-amber-100 border border-amber-300 rounded-lg p-sm flex items-center justify-between text-label-sm">
                <span className="text-amber-900 inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  Draft saved automatically
                </span>
                <button
                  onClick={() => {
                    removeDraft(currentStep.id);
                  }}
                  className="text-amber-900 hover:text-amber-700 font-bold underline"
                >
                  Clear
                </button>
              </div>
            )}

            {!isReadOnly && (
              <CameraCapture
                key={currentStep.id}
                onUploaded={(url) => {
                  const prev = entry?.comments ?? "";
                  setEntry(currentStep.id, { comments: `${prev}\n[photo: ${url}]` });
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="sticky bottom-0 left-0 right-0 bg-surface-container-lowest border-t border-outline-variant -mx-lg px-lg py-md shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
        <div className="max-w-7xl mx-auto flex items-center gap-sm flex-wrap">
          <button
            disabled={!canPrev}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            className="inline-flex items-center gap-xs px-lg py-sm border border-outline-variant text-on-surface rounded-lg font-label-md text-label-sm hover:bg-surface-container-low transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Previous
          </button>

          <div className="flex-1" />

          {/* Pass / Fail segmented control — neutral until selected */}
          <div
            role="radiogroup"
            aria-label="Step result"
            className="inline-flex items-center bg-surface-container rounded-lg p-0.5"
          >
            <button
              role="radio"
              aria-checked={stepResultsByStep.get(currentStep!.id) === false}
              onClick={() => {
                if (isReadOnly) return;
                setEntry(currentStep!.id, { passed: false });
                submitStepMut.mutate({
                  passed: false,
                  actual_result: entry?.actual_result ?? "",
                  comments: entry?.comments ?? "",
                });
              }}
              disabled={submitStepMut.isPending || isReadOnly}
              className={`inline-flex items-center gap-xs px-lg py-sm rounded-md font-label-md text-label-sm transition-all ${
                stepResultsByStep.get(currentStep!.id) === false
                  ? "bg-error text-on-error shadow-sm"
                  : "text-on-surface hover:bg-surface-container-low"
              } disabled:opacity-50`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {stepResultsByStep.get(currentStep!.id) === false ? "cancel" : "circle"}
              </span>
              Fail
            </button>
            <button
              role="radio"
              aria-checked={stepResultsByStep.get(currentStep!.id) === true}
              onClick={() => {
                if (isReadOnly) return;
                setEntry(currentStep!.id, { passed: true });
                submitStepMut.mutate({
                  passed: true,
                  actual_result: entry?.actual_result ?? "",
                  comments: entry?.comments ?? "",
                });
              }}
              disabled={submitStepMut.isPending || isReadOnly}
              className={`inline-flex items-center gap-xs px-lg py-sm rounded-md font-label-md text-label-sm transition-all ${
                stepResultsByStep.get(currentStep!.id) === true
                  ? "bg-green-600 text-white shadow-sm"
                  : "text-on-surface hover:bg-surface-container-low"
              } disabled:opacity-50`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {stepResultsByStep.get(currentStep!.id) === true ? "check_circle" : "circle"}
              </span>
              Pass
            </button>
          </div>

          {/* Next / Submit Case */}
          {isLast ? (
            <button
              onClick={async () => {
                if (!allStepsRecorded || !execution || isSubmitting) return;
                if (validateFailedSteps.length > 0) {
                  toast.error(validateFailedSteps[0]);
                  return;
                }
                setIsSubmitting(true);

                // Snapshot the full result set from local state before any mutations
                const stepSnapshot = steps.map((s) => {
                  const e = entries.get(s.id);
                  const persisted = execution.stepResults?.find((r) => r.step_id === s.id);
                  return {
                    stepId: s.id,
                    passed: e?.passed ?? persisted?.passed ?? null,
                    actual_result: e?.actual_result ?? persisted?.actual_result ?? "",
                    comments: e?.comments ?? persisted?.comments ?? "",
                    needsSave: entries.has(s.id),
                  };
                });

                const anyFailed = stepSnapshot.some((r) => r.passed === false);

                try {
                  // 1. Re-save step results so the latest actual_result is persisted
                  for (const snap of stepSnapshot) {
                    if (!snap.needsSave) continue;
                    await customFetch(`/executions/${execution.id}/steps/${snap.stepId}/result`, {
                      method: "POST",
                      body: JSON.stringify({
                        passed: snap.passed,
                        actual_result: snap.actual_result,
                        comments: snap.comments,
                      }),
                    });
                  }

                  // 2. Mark execution as completed
                  await customFetch(`/executions/${execution.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      status: "completed",
                      overall_result: anyFailed ? "failed" : "passed",
                    }),
                  });

                  // 3. Clear drafts
                  steps.forEach((s) => removeDraft(s.id));

                  toast.success(previouslySubmitted ? "Results updated" : "Test case saved");
                  await queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
                  queryClient.invalidateQueries({ queryKey: ["use-case", scenarioId] });
                  queryClient.invalidateQueries({ queryKey: ["tester-execution", testRunId, testCaseId] });
                  queryClient.invalidateQueries({ queryKey: ["test-case", testCaseId] });
                  navigate(`/tester/run/${testRunId}/scenario/${scenarioId}`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to save case");
                } finally {
                  setIsSubmitting(false);
                }
              }}
              disabled={!allStepsRecorded || isSubmitting || isReadOnly}
              className="inline-flex items-center gap-xs px-xl py-sm bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                !allStepsRecorded
                  ? "Record a result for every step before submitting"
                  : validateFailedSteps.length > 0
                    ? "Fill in 'What actually happened' for failed steps"
                    : undefined
              }
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">check</span>
                  {previouslySubmitted ? "Update Results" : "Submit Case"}
                </>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                // Validate current step before advancing
                if (currentStepRecorded) {
                  const entry = entries.get(currentStep!.id);
                  const persisted = execution?.stepResults?.find(r => r.step_id === currentStep!.id);
                  const passed = entry?.passed ?? persisted?.passed ?? null;
                  if (passed === false) {
                    const actual = entry?.actual_result ?? persisted?.actual_result ?? "";
                    if (!actual.trim()) {
                      toast.error('Please describe "What actually happened" before continuing');
                      return;
                    }
                  }
                }
                setStepIndex((i) => Math.min(steps.length - 1, i + 1));
              }}
              disabled={!currentStepRecorded}
              className="inline-flex items-center gap-xs px-xl py-sm bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={!currentStepRecorded ? "Mark this step as Pass or Fail before continuing" : undefined}
            >
              Next
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          )}
        </div>
        {!currentStepRecorded && (
          <p className="max-w-7xl mx-auto mt-sm text-label-sm text-on-surface-variant text-center">
            Mark this step as <span className="font-bold text-on-surface">Pass</span> or <span className="font-bold text-on-surface">Fail</span> to continue.
          </p>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Step Sidebar
   ──────────────────────────────────────────────────────────────────── */

function StepSidebar({
  steps,
  currentIndex,
  stepResults,
  onJump,
}: {
  steps: TestStep[];
  currentIndex: number;
  onJump: (index: number) => void;
  stepResults: Map<number, boolean | null>;
}) {
  return (
    <aside className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md self-start sticky top-md max-h-[calc(100vh-2rem)] overflow-y-auto">
      <h2 className="text-label-md font-label-md uppercase tracking-wider font-bold text-on-surface-variant mb-sm px-sm">
        Steps ({steps.length})
      </h2>
      <ol className="space-y-xs">
        {steps.map((s, i) => {
          const isCurrent = i === currentIndex;
          const result = stepResults.get(s.id);
          const isPassed = result === true;
          const isFailed = result === false;
          return (
            <li key={s.id}>
              <button
                onClick={() => onJump(i)}
                className={`w-full text-left p-sm rounded-lg flex items-start gap-sm transition-all ${
                  isCurrent
                    ? "bg-secondary-container text-on-secondary-container"
                    : "hover:bg-surface-container-low text-on-surface"
                }`}
              >
                <span
                  className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-label-sm font-bold ${
                    isPassed ? "bg-green-600 text-white" :
                    isFailed ? "bg-error text-on-error" :
                    isCurrent ? "bg-primary text-on-primary" :
                    "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  {isPassed ? (
                    <span className="material-symbols-outlined text-[14px]">check</span>
                  ) : isFailed ? (
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <p className={`text-label-sm line-clamp-2 ${isCurrent ? "font-bold" : ""}`}>
                    {s.instruction}
                  </p>
                  {isCurrent && (
                    <p className="text-[10px] uppercase tracking-wider font-bold mt-1 opacity-80">
                      Current
                    </p>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Level 3 (Quick mode): all steps on one scrollable page
   ──────────────────────────────────────────────────────────────────── */

function QuickWizard({
  testRunId,
  scenarioId,
  testCaseId,
  testCase,
  steps,
  execution,
  entries,
  setEntry,
  localResults,
  setLocalResults,
  removeDraft,
  onBack,
  onModeChange,
  pendingMutations,
  isReadOnly,
  blockReason,
}: {
  testRunId: number;
  scenarioId: number;
  testCaseId: number;
  testCase: (TestCase & { steps: TestStep[]; stepResults?: StepResult[] }) | undefined;
  steps: TestStep[];
  execution: Execution | undefined;
  entries: Map<number, ExecutionEntry>;
  setEntries: React.Dispatch<React.SetStateAction<Map<number, ExecutionEntry>>>;
  setEntry: (stepId: number, patch: Partial<ExecutionEntry>) => void;
  localResults: Map<number, boolean>;
  setLocalResults: React.Dispatch<React.SetStateAction<Map<number, boolean>>>;
  removeDraft: (stepId: number) => void;
  onBack: () => void;
  onModeChange: (next: "guided" | "quick") => void;
  pendingMutations: React.MutableRefObject<number>;
  isReadOnly: boolean;
  blockReason?: string | null;
}) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Per-step save mutation (saves individual step results as they're entered)
  const saveStepMut = useMutation({
    mutationFn: ({ stepId, data }: { stepId: number; data: { passed: boolean; actual_result: string; comments: string } }) =>
      customFetch(`/executions/${execution!.id}/steps/${stepId}/result`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onMutate: () => { pendingMutations.current++; },
    onSuccess: (_data, vars) => {
      // Don't remove the draft from entries — that would clear the textarea's
      // "what actually happened" text on the next render.  Just clear the
      // sessionStorage copy since it has been persisted to the API.
      const key = draftKey(testRunId, testCaseId, vars.stepId);
      sessionStorage.removeItem(key);
    },
    onError: (e: Error, vars) => {
      setLocalResults((prev) => {
        const next = new Map(prev);
        next.delete(vars.stepId);
        return next;
      });
      toast.error(e.message);
    },
    onSettled: () => { pendingMutations.current--; },
  });

  // Save a single step result when pass/fail is toggled
  const handleQuickStepResult = (stepId: number, passed: boolean, entry: ExecutionEntry) => {
    setLocalResults((prev) => {
      const next = new Map(prev);
      next.set(stepId, passed);
      return next;
    });
    saveStepMut.mutate({
      stepId,
      data: {
        passed,
        actual_result: entry.actual_result,
        comments: entry.comments,
      },
    });
  };

  // Persisted pass/fail only — used for sidebar indicators and per-step status
  const persistedResults = useMemo(() => {
    const map = new Map<number, boolean | null>();
    (execution?.stepResults ?? []).forEach((r) => map.set(r.step_id, r.passed));
    (testCase?.stepResults ?? []).forEach((r) => map.set(r.step_id, r.passed));
    return map;
  }, [execution?.stepResults, testCase?.stepResults]);

  const summary = useMemo(() => {
    let passed = 0, failed = 0, pending = 0;
    steps.forEach((s) => {
      const e = entries.get(s.id);
      const r = e?.passed ?? persistedResults.get(s.id) ?? localResults.get(s.id) ?? null;
      if (r === true) passed++;
      else if (r === false) failed++;
      else pending++;
    });
    return { passed, failed, pending, total: steps.length };
  }, [entries, persistedResults, localResults, steps]);

  // readyToSubmit: all steps must have a pass/fail result (in-memory or persisted)
  const readyToSubmit = useMemo(() => {
    if (steps.length === 0) return false;
    return steps.every((s) => {
      const e = entries.get(s.id);
      const local = localResults.get(s.id);
      const persisted = persistedResults.get(s.id);
      return (e?.passed ?? local ?? persisted ?? null) !== null;
    });
  }, [steps, entries, localResults, persistedResults]);

  // Validate failed steps have actual_result filled (check both entries and persisted)
  const validateFailedSteps = useMemo(() => {
    const failedSteps: string[] = [];
    steps.forEach((s) => {
      const e = entries.get(s.id);
      const persistedResult = execution?.stepResults?.find((r) => r.step_id === s.id);
      const passed = e?.passed ?? localResults.get(s.id) ?? persistedResult?.passed ?? null;
      if (passed === false) {
        const actual = e?.actual_result ?? persistedResult?.actual_result ?? "";
        if (!actual.trim()) {
          failedSteps.push(`Step ${s.step_number}: "What actually happened" is required when marking a step as Fail`);
        }
      }
    });
    return failedSteps;
  }, [steps, entries, localResults, execution?.stepResults]);

  // Check if execution already has an overall_result (was previously submitted)
  const previouslySubmitted = execution?.overall_result != null;

  const handleSubmit = async () => {
    if (!execution || !readyToSubmit || isSubmitting) return;
    if (validateFailedSteps.length > 0) {
      toast.error(validateFailedSteps[0]);
      return;
    }
    setIsSubmitting(true);

    // Snapshot the full result set NOW before any state mutations.
    // For each step: prefer in-memory entry, fall back to persisted result.
    const stepSnapshot = steps.map((s) => {
      const e = entries.get(s.id);
      const persistedResult = execution.stepResults?.find((r) => r.step_id === s.id);
      return {
        stepId: s.id,
        passed: e?.passed ?? persistedResult?.passed ?? null,
        actual_result: e?.actual_result ?? persistedResult?.actual_result ?? "",
        comments: e?.comments ?? persistedResult?.comments ?? "",
        needsSave: entries.has(s.id),
      };
    });

    const anyFailed = stepSnapshot.some((r) => r.passed === false);

    try {
      // 1. Save any unsaved in-memory step results
      for (const snap of stepSnapshot) {
        if (!snap.needsSave) continue;
        await customFetch(`/executions/${execution.id}/steps/${snap.stepId}/result`, {
          method: "POST",
          body: JSON.stringify({
            passed: snap.passed,
            actual_result: snap.actual_result,
            comments: snap.comments,
          }),
        });
      }

      // 2. Mark execution as completed with correct overall_result
      await customFetch(`/executions/${execution.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          overall_result: anyFailed ? "failed" : "passed",
        }),
      });

      // 3. Clear drafts after successful save
      steps.forEach((s) => removeDraft(s.id));

      toast.success(previouslySubmitted ? "Results updated" : "Test case complete");
      await queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
      queryClient.invalidateQueries({ queryKey: ["tester-execution", testRunId, testCaseId] });
      queryClient.invalidateQueries({ queryKey: ["test-case", testCaseId] });
      queryClient.invalidateQueries({ queryKey: ["use-case", scenarioId] });
      navigate(`/tester/run/${testRunId}/scenario/${scenarioId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit case";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!testCase) {
    return (
      <div className="max-w-2xl mx-auto py-2xl text-center">
        <div className="w-10 h-10 mx-auto border-4 border-secondary border-t-transparent rounded-full animate-spin" />
        <p className="mt-md text-on-surface-variant">Loading test case…</p>
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-2xl">
        <EmptyState
          icon="inbox"
          title="This test case has no steps"
          description="Ask your Test Lead to add at least one step before executing."
          action={
            <button
              onClick={onBack}
              className="inline-flex items-center gap-xs px-lg py-sm bg-primary text-on-primary rounded-lg font-label-md hover:opacity-90 transition-all"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Cases
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-md max-w-4xl mx-auto w-full pb-32">
      {blockReason ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-md flex items-center gap-sm">
          <span className="material-symbols-outlined text-red-600">block</span>
          <span className="text-label-md text-red-800">{blockReason}</span>
        </div>
      ) : isReadOnly ? (
        <div className="bg-gray-100 border border-gray-300 rounded-xl p-md flex items-center gap-sm">
          <span className="material-symbols-outlined text-gray-500">lock</span>
          <span className="text-label-md text-gray-600">
            This test case is read-only — you have already submitted this test run.
          </span>
        </div>
      ) : null}
      <BackBar
        back={{ label: "Cases", href: `/tester/run/${testRunId}/scenario/${scenarioId}` }}
        current={`[${testCase.case_number}] ${testCase.title}`}
        context="Quick mode"
        onBack={onBack}
        right={
          <button
            onClick={() => onModeChange("guided")}
            className="inline-flex items-center gap-xs px-sm py-xs text-label-sm text-on-surface-variant hover:text-on-surface border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">view_kanban</span>
            Switch to Guided
          </button>
        }
      />

      {/* Summary progress card */}
      <div className="bg-gradient-to-br from-primary to-primary/80 text-on-primary rounded-2xl p-lg shadow-sm relative overflow-hidden">
        <div className="absolute right-0 top-0 w-64 h-64 bg-on-primary/5 rounded-full -translate-y-1/2 translate-x-1/4" aria-hidden="true" />
        <div className="relative space-y-md">
          <div className="flex items-start justify-between gap-md flex-wrap">
            <div className="min-w-0">
              <p className="text-label-sm uppercase tracking-widest font-bold opacity-80">
                Quick mode — record all steps at once
              </p>
              <h1 className="font-display-md text-display-md leading-tight mt-1">
                [{testCase.case_number}] {testCase.title}
              </h1>
            </div>
            <StatusChip variant="info" icon="bolt" size="md" className="!bg-on-primary/15 !text-on-primary">
              Quick
            </StatusChip>
          </div>
          <div className="grid grid-cols-3 gap-sm">
            <div className="bg-on-primary/10 rounded-lg p-sm">
              <p className="text-label-sm uppercase tracking-wider opacity-80 font-bold">Passed</p>
              <p className="font-headline-md text-headline-md leading-none mt-1">{summary.passed}</p>
            </div>
            <div className="bg-on-primary/10 rounded-lg p-sm">
              <p className="text-label-sm uppercase tracking-wider opacity-80 font-bold">Failed</p>
              <p className="font-headline-md text-headline-md leading-none mt-1">{summary.failed}</p>
            </div>
            <div className="bg-on-primary/10 rounded-lg p-sm">
              <p className="text-label-sm uppercase tracking-wider opacity-80 font-bold">Pending</p>
              <p className="font-headline-md text-headline-md leading-none mt-1">{summary.pending}</p>
            </div>
          </div>
          <div className="space-y-xs">
            <div className="flex items-center justify-between text-label-sm opacity-90">
              <span className="font-bold uppercase tracking-wider">Progress</span>
              <span>{summary.passed + summary.failed} / {summary.total} steps</span>
            </div>
            <div className="w-full bg-on-primary/20 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-on-primary rounded-full transition-all duration-500"
                style={{ width: `${summary.total > 0 ? ((summary.passed + summary.failed) / summary.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {testCase.acceptance_criteria && (
        <div className="bg-secondary-container border-l-4 border-secondary rounded-xl p-md flex gap-md">
          <div className="shrink-0 w-8 h-8 rounded-full bg-secondary text-on-secondary flex items-center justify-center">
            <span className="material-symbols-outlined text-[18px]">flag</span>
          </div>
          <div className="min-w-0">
            <p className="text-label-sm uppercase tracking-wider font-bold text-on-secondary-container mb-1">
              Acceptance criteria
            </p>
            <p className="text-body-base text-on-secondary-container">
              {testCase.acceptance_criteria}
            </p>
          </div>
        </div>
      )}

      {/* All steps in one scrollable list */}
      <ol className="space-y-md">
        {steps.map((s, stepIdx) => {
          const e = entries.get(s.id) ?? { ...EMPTY_ENTRY };
          const persisted = persistedResults.get(s.id);
          const optimistic = localResults.get(s.id);
          const effective = e.passed ?? optimistic ?? persisted ?? null;
          return (
            <li
              key={s.id}
              className={`bg-surface-container-lowest border rounded-xl p-lg space-y-md transition-colors ${
                effective === true ? "border-green-200 bg-green-50/30" :
                effective === false ? "border-red-200 bg-red-50/30" :
                "border-outline-variant"
              }`}
            >
              <div className="flex items-start gap-md">
                <div
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-headline-sm text-headline-sm ${
                    effective === true ? "bg-green-600 text-white" :
                    effective === false ? "bg-error text-on-error" :
                    "bg-primary text-on-primary"
                  }`}
                >
                  {effective === true ? (
                    <span className="material-symbols-outlined text-[18px]">check</span>
                  ) : effective === false ? (
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  ) : (
                    stepIdx + 1
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-label-sm uppercase tracking-wider font-bold text-on-surface-variant">
                    Step {stepIdx + 1} of {steps.length}
                  </p>
                  <p className="text-body-lg text-on-surface leading-relaxed font-body-base mt-1">
                    {s.instruction}
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-sm pl-0 sm:pl-13">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-sm">
                  <p className="text-label-sm uppercase tracking-wider font-bold text-amber-800 mb-1 inline-flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">data_object</span>
                    Test data
                  </p>
                  <p className={`text-body-sm whitespace-pre-wrap ${s.test_data ? "text-amber-900" : "text-amber-700/60 italic"}`}>
                    {s.test_data || "Not provided"}
                  </p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-sm">
                  <p className="text-label-sm uppercase tracking-wider font-bold text-blue-800 mb-1 inline-flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">target</span>
                    Expected result
                  </p>
                  <p className={`text-body-sm whitespace-pre-wrap ${s.expected_result ? "text-blue-900" : "text-blue-700/60 italic"}`}>
                    {s.expected_result || "Not provided"}
                  </p>
                </div>
              </div>

              <div className="space-y-sm pl-0 sm:pl-13">
                <label className="text-label-md font-label-md text-on-surface block">
                  What actually happened?
                </label>
                <textarea
                  value={e.actual_result}
                  onChange={(ev) => setEntry(s.id, { actual_result: ev.target.value })}
                  rows={2}
                  placeholder="Describe what you observed…"
                  disabled={isReadOnly}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base text-on-surface placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-secondary/20 focus:border-secondary outline-none transition-all resize-y disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50"
                />
                <div className="flex items-center gap-sm">
                  <button
                    onClick={() => {
                      if (isReadOnly) return;
                      setEntry(s.id, { passed: true });
                      if (execution) {
                        handleQuickStepResult(s.id, true, entries.get(s.id) ?? EMPTY_ENTRY);
                      }
                    }}
                    disabled={saveStepMut.isPending || isReadOnly}
                    className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-xs px-lg py-sm rounded-lg font-label-md text-label-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      effective === true
                        ? "bg-green-600 text-white shadow-sm"
                        : "bg-surface-container-low text-on-surface border border-outline-variant hover:bg-green-50 hover:border-green-200 hover:text-green-700"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    Pass
                  </button>
                  <button
                    onClick={() => {
                      if (isReadOnly) return;
                      // Validate: if marking Fail, check actual_result is filled
                      const entry_ = entries.get(s.id) ?? EMPTY_ENTRY;
                      if (!entry_.actual_result?.trim()) {
                        toast.error('Please describe "What actually happened" before marking as Fail');
                        return;
                      }
                      setEntry(s.id, { passed: false });
                      if (execution) {
                        handleQuickStepResult(s.id, false, entry_);
                      }
                    }}
                    disabled={saveStepMut.isPending || isReadOnly}
                    className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-xs px-lg py-sm rounded-lg font-label-md text-label-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      effective === false
                        ? "bg-error text-on-error shadow-sm"
                        : "bg-surface-container-low text-on-surface border border-outline-variant hover:bg-red-50 hover:border-red-200 hover:text-red-700"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">cancel</span>
                    Fail
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Sticky submit bar */}
      <div className="sticky bottom-0 left-0 right-0 bg-surface-container-lowest border-t border-outline-variant -mx-lg px-lg py-md shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-sm flex-wrap">
          <div className="text-label-sm text-on-surface-variant">
            {readyToSubmit ? (
              <span className="inline-flex items-center gap-xs text-green-700 font-bold">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                All steps recorded — ready to submit
              </span>
            ) : (
              <span>
                {summary.pending} of {summary.total} step{summary.total === 1 ? "" : "s"} still pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-sm">
            <button
              onClick={onBack}
              className="px-lg py-sm border border-outline-variant text-on-surface rounded-lg font-label-md text-label-sm hover:bg-surface-container-low transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!readyToSubmit || isSubmitting || isReadOnly}
              title={validateFailedSteps.length > 0 ? validateFailedSteps[0] : undefined}
              className="inline-flex items-center gap-xs px-xl py-sm bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">check</span>
                  {previouslySubmitted ? "Update Results" : "Submit Case"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
