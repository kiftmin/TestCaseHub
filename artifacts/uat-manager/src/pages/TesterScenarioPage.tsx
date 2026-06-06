import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import {
  BackBar,
  EmptyState,
  FilterTabs,
  StatusChip,
  Dialog,
  progressStatusVariant,
  type FilterTab,
} from "../components/ui";
import type { TestRun, TestRunUseCase, TestCase, TestStep, Execution } from "../types/api";

/* ────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────── */

type ScenarioFilter = "all" | "to_do" | "in_progress" | "done";
type CaseProgress = "Not Started" | "In Progress" | "Completed";

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

function computeCaseProgress(
  steps: { id: number }[],
  stepResults: { step_id: number; passed: boolean | null; actual_result?: string | null }[],
): CaseProgress {
  if (!steps || steps.length === 0) return "Not Started";
  if (!stepResults || stepResults.length === 0) return "Not Started";
  const allHavePassFail = steps.every(s =>
    stepResults.some(r => r && r.step_id === s.id && r.passed != null),
  );
  if (!allHavePassFail) {
    const someHavePassFail = steps.some(s =>
      stepResults.some(r => r && r.step_id === s.id && r.passed != null),
    );
    return someHavePassFail ? "In Progress" : "Not Started";
  }
  const failedWithoutActual = stepResults.filter(
    r => r && r.passed === false && (!r.actual_result || String(r.actual_result).trim() === ""),
  );
  if (failedWithoutActual.length > 0) return "In Progress";
  return "Completed";
}

function computeScenarioProgress(
  testCases: (TestCase & { steps?: TestStep[] })[],
  executions: Execution[],
): CaseProgress {
  if (!testCases || testCases.length === 0) return "Not Started";
  if (!executions || executions.length === 0) return "Not Started";
  const progresses = testCases.map(tc => {
    const exec = executions.find(e => e && e.test_case_id === tc.id);
    if (!exec) return "Not Started" as CaseProgress;
    const steps = tc.steps ?? [];
    const stepResults = exec.stepResults ?? [];
    return computeCaseProgress(steps, stepResults);
  });
  if (progresses.every(p => p === "Completed")) return "Completed";
  if (progresses.some(p => p === "In Progress" || p === "Completed")) return "In Progress";
  return "Not Started";
}

function computeRunProgress(
  useCases: TestRunUseCase[],
  executions: Execution[],
): CaseProgress {
  if (!useCases || useCases.length === 0) return "Not Started";
  const progresses = useCases.map(uc => {
    const tcs = uc.useCase?.testCases ?? [];
    return computeScenarioProgress(tcs, executions);
  });
  if (progresses.every(p => p === "Completed")) return "Completed";
  if (progresses.some(p => p === "In Progress" || p === "Completed")) return "In Progress";
  return "Not Started";
}

/* ────────────────────────────────────────────────────────────────────
   Status mapping helpers
   ──────────────────────────────────────────────────────────────────── */

const PRIORITY_BADGE_VARIANT: Record<string, "error" | "warning" | "neutral"> = {
  Critical: "error",
  High: "warning",
  Medium: "warning",
  Low: "neutral",
};

const PRIORITY_STRIPE: Record<string, string> = {
  Critical: "border-l-error",
  High: "border-l-orange-500",
  Medium: "border-l-amber-500",
  Low: "border-l-outline-variant",
};

const PROGRESS_ICONS: Record<CaseProgress, string> = {
  "Not Started": "radio_button_unchecked",
  "In Progress": "autorenew",
  Completed: "check_circle",
};

const PROGRESS_LABELS: Record<CaseProgress, string> = {
  "Not Started": "Not Started",
  "In Progress": "In Progress",
  Completed: "Completed",
};

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export function TesterScenarioPage({ params }: { params: { testRunId: string } }) {
  const [, navigate] = useLocation();
  const testRunId = Number(params.testRunId);
  const [filter, setFilter] = useState<ScenarioFilter>("all");
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => { document.title = "Scenarios | TestCaseHub"; }, []);

  const { data: testRun, isLoading } = useQuery({
    queryKey: ["test-run", testRunId],
    queryFn: () => customFetch<TestRun>(`/test-runs/${testRunId}`),
    enabled: !!testRunId,
  });

  const useCases = useMemo(() => testRun?.useCases ?? [], [testRun]);
  const allExecutions = useMemo(() => testRun?.executions ?? [], [testRun]);
  const isBlocked = !!testRun && !testRun.entry_confirmed;
  const isCompleted = testRun?.status === "completed";

  // Debug: log actual data shape to diagnose progress issues
  useEffect(() => {
    if (testRun) {
      console.log("[TesterScenarioPage] testRun loaded", {
        useCaseCount: useCases.length,
        executionCount: allExecutions.length,
        executions: allExecutions.map(e => ({ id: e.id, test_case_id: e.test_case_id, stepResultsCount: e.stepResults?.length })),
        useCases: useCases.map(uc => ({
          use_case_id: uc.use_case_id,
          testCaseCount: uc.useCase?.testCases?.length,
          testCases: uc.useCase?.testCases?.map(tc => ({
            id: tc.id,
            stepCount: tc.steps?.length,
            steps: tc.steps?.map(s => s.id),
          })),
        })),
      });
    }
  }, [testRun, useCases, allExecutions]);

  // Compute scenario-level progress from step results
  const scenarioProgresses = useMemo(() => {
    const map = new Map<number, CaseProgress>();
    useCases.forEach(uc => {
      const tcs = uc.useCase?.testCases ?? [];
      map.set(uc.use_case_id, computeScenarioProgress(tcs, allExecutions));
    });
    // Debug: log computed progress
    console.log("[TesterScenarioPage] computed scenarioProgresses", Object.fromEntries(map));
    return map;
  }, [useCases, allExecutions]);

  // Compute run-level progress
  const runProgress = useMemo(() => {
    return computeRunProgress(useCases, allExecutions);
  }, [useCases, allExecutions]);

  const summary = useMemo(() => {
    const total = useCases.length;
    const completed = useCases.filter((uc) =>
      (scenarioProgresses.get(uc.use_case_id) ?? "Not Started") === "Completed"
    ).length;
    const inProgress = useCases.filter((uc) =>
      (scenarioProgresses.get(uc.use_case_id) ?? "Not Started") === "In Progress"
    ).length;
    const notStarted = useCases.filter((uc) =>
      (scenarioProgresses.get(uc.use_case_id) ?? "Not Started") === "Not Started"
    ).length;
    const progress_val = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, notStarted, progress: progress_val };
  }, [useCases, scenarioProgresses]);

  const submitTestRunMut = useMutation({
    mutationFn: () =>
      customFetch(`/test-runs/${testRunId}/submit`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Test run submitted successfully");
      queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
      queryClient.invalidateQueries({ queryKey: ["tester-runs"] });
      setShowSubmitDialog(false);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setShowSubmitDialog(false);
    },
  });

  const filtered = useMemo(() => {
    return useCases.filter((uc) => {
      const p = scenarioProgresses.get(uc.use_case_id) ?? "Not Started";
      if (filter === "all") return true;
      if (filter === "to_do") return p === "Not Started";
      if (filter === "in_progress") return p === "In Progress";
      if (filter === "done") return p === "Completed";
      return true;
    });
  }, [useCases, filter, scenarioProgresses]);

  const filterTabs: FilterTab<ScenarioFilter>[] = [
    { key: "all", label: "All", count: useCases.length, icon: "view_module" },
    { key: "to_do", label: "To Do", count: useCases.filter((uc) => (scenarioProgresses.get(uc.use_case_id) ?? "Not Started") === "Not Started").length, icon: "radio_button_unchecked" },
    { key: "in_progress", label: "In Progress", count: summary.inProgress, icon: "autorenew" },
    { key: "done", label: "Done", count: summary.completed, icon: "check_circle" },
  ];

  if (isBlocked) {
    return (
      <div className="max-w-2xl mx-auto py-2xl">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-xl text-center space-y-md">
          <div className="w-16 h-16 mx-auto rounded-full bg-error-container text-error flex items-center justify-center">
            <span className="material-symbols-outlined text-[32px]">lock</span>
          </div>
          <div>
            <h1 className="font-title-lg text-title-lg text-on-surface">Test run not cleared</h1>
            <p className="text-body-base text-on-surface-variant mt-2 max-w-md mx-auto">
              This test run has not been cleared to start. The Test Lead must confirm the entry criteria before you can execute scenarios.
            </p>
          </div>
          <button
            onClick={() => navigate("/tester")}
            className="inline-flex items-center gap-xs px-lg py-sm bg-primary text-on-primary rounded-lg font-label-md hover:opacity-90 transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to My Runs
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-lg max-w-5xl mx-auto w-full">
      <BackBar
        back={{ label: "My Runs", href: "/tester" }}
        current={testRun?.name ?? "Test Run"}
        context={testRun?.project?.name}
        onBack={() => navigate("/tester")}
      />

      <header className="bg-gradient-to-br from-primary to-primary/80 text-on-primary rounded-2xl p-lg md:p-xl shadow-sm overflow-hidden relative">
        <div className="absolute right-0 top-0 w-64 h-64 bg-on-primary/5 rounded-full -translate-y-1/2 translate-x-1/4" aria-hidden="true" />
        <div className="relative space-y-md">
          <div className="flex items-start justify-between gap-md flex-wrap">
            <div className="min-w-0">
              <p className="text-label-sm uppercase tracking-widest font-bold opacity-80">
                {testRun?.project?.name ?? "Project"}
              </p>
              <h1 className="font-display-md text-display-md leading-tight mt-1">
                {testRun?.name ?? "Test Run"}
              </h1>
            </div>
            {testRun && (
              <StatusChip
                variant={testRun.status === "completed" ? "success" : testRun.status === "in_progress" ? "warning" : "info"}
                icon={testRun.status === "completed" ? "check_circle" : testRun.status === "in_progress" ? "autorenew" : "event"}
                size="md"
                className="!bg-on-primary/15 !text-on-primary"
              >
                {testRun.status.replace(/_/g, " ")}
              </StatusChip>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-sm">
            <SummaryStat label="Total" value={summary.total} />
            <SummaryStat label="Completed" value={summary.completed} />
            <SummaryStat label="In Progress" value={summary.inProgress} />
            <SummaryStat label="Not Started" value={summary.notStarted} />
          </div>
          <div className="space-y-xs">
            <div className="flex items-center justify-between text-label-sm opacity-90">
              <span className="font-bold uppercase tracking-wider">Progress</span>
              <span>{summary.completed} / {summary.total} scenarios</span>
            </div>
            <div className="w-full bg-on-primary/20 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-on-primary rounded-full transition-all duration-700"
                style={{ width: `${summary.progress}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-sm">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-surface-container-low border border-outline-variant rounded-xl animate-pulse" />
          ))}
        </div>
      ) : useCases.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No scenarios assigned"
          description="There are no scenarios in this test run that are assigned to you."
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-md flex-wrap">
            <FilterTabs<ScenarioFilter> tabs={filterTabs} active={filter} onChange={setFilter} />
            <p className="text-label-sm text-on-surface-variant">
              Showing {filtered.length} of {useCases.length}
            </p>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon="filter_alt_off"
              title="Nothing matches this filter"
              description="Try a different filter to see more scenarios."
            />
          ) : (
            <div className="space-y-sm">
              {filtered.map((uc) => (
                <ScenarioRow
                  key={uc.id}
                  useCase={uc}
                  progress={scenarioProgresses.get(uc.use_case_id) ?? "Not Started"}
                  onOpen={() => navigate(`/tester/run/${testRunId}/scenario/${uc.use_case_id}`)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Submit Test Run section — only shown when progress is Completed and run is not yet submitted */}
      {runProgress === "Completed" && !isCompleted && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-300 rounded-2xl p-lg md:p-xl mt-lg">
          <div className="flex items-start justify-between gap-md flex-wrap">
            <div className="min-w-0 space-y-xs">
              <div className="flex items-center gap-xs">
                <span className="material-symbols-outlined text-green-700 text-[20px]">check_circle</span>
                <h2 className="font-title-md text-title-md text-green-800">All scenarios completed</h2>
              </div>
              <p className="text-body-base text-green-700">
                Every test case in this run has been completed. You can now submit the test run.
                Once submitted, the run will be set to read-only and defects will be created for any failed steps.
              </p>
            </div>
            <button
              onClick={() => setShowSubmitDialog(true)}
              className="inline-flex items-center gap-xs px-xl py-md bg-green-700 text-white rounded-xl font-label-md text-label-md hover:bg-green-800 active:scale-[0.98] transition-all shadow-sm shrink-0"
            >
              <span className="material-symbols-outlined text-[20px]">check</span>
              Submit Test Run
            </button>
          </div>
        </div>
      )}

      {/* Submit warning dialog */}
      {showSubmitDialog && (
        <Dialog
          open={showSubmitDialog}
          onClose={() => setShowSubmitDialog(false)}
          title="Submit Test Run"
          size="sm"
        >
          <div className="space-y-md">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-md flex gap-md">
              <span className="material-symbols-outlined text-amber-700 shrink-0">warning</span>
              <div className="text-body-sm text-amber-900">
                <p className="font-bold mb-xs">Warning: Read-only mode</p>
                <p>
                  Once you submit this test run, it will be set to <strong>read-only mode</strong>. You will not
                  be able to make any further changes to the test case results or step data.
                </p>
              </div>
            </div>

            <p className="text-body-sm text-on-surface-variant">
              Failed steps will be automatically created as <strong>Defects</strong> with status <strong>New</strong>
              {' '}in the Defects table for triage by the Test Lead.
            </p>

            <div className="flex items-center justify-end gap-sm pt-sm border-t border-outline-variant">
              <button
                onClick={() => setShowSubmitDialog(false)}
                className="px-lg py-sm border border-outline-variant text-on-surface rounded-lg font-label-md text-label-sm hover:bg-surface-container-low transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => submitTestRunMut.mutate()}
                disabled={submitTestRunMut.isPending}
                className="inline-flex items-center gap-xs px-xl py-sm bg-green-700 text-white rounded-lg font-label-md text-label-md hover:bg-green-800 transition-all disabled:opacity-50"
              >
                {submitTestRunMut.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">check</span>
                    Confirm Submit
                  </>
                )}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────────────────────────────── */

function SummaryStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-on-primary/10 rounded-lg p-sm backdrop-blur-sm">
      <p className="text-label-sm uppercase tracking-wider opacity-80 font-bold">{label}</p>
      <p className="font-headline-md text-headline-md leading-none mt-1">{value}</p>
    </div>
  );
}

function ScenarioRow({
  useCase,
  onOpen,
  progress,
}: {
  useCase: TestRunUseCase;
  onOpen: () => void;
  progress: CaseProgress;
}) {
  const priority = useCase.useCase?.priority;
  const stripe = priority ? PRIORITY_STRIPE[priority] ?? PRIORITY_STRIPE.Low : PRIORITY_STRIPE.Low;
  const actionLabel = progress === "Completed" ? "Review" : progress === "In Progress" ? "Continue" : "Start";
  const actionIcon = progress === "Completed" ? "visibility" : progress === "In Progress" ? "play_arrow" : "arrow_forward";

  return (
    <article
      className={`bg-surface-container-lowest border border-outline-variant border-l-4 ${stripe} rounded-xl overflow-hidden hover:shadow-md transition-all`}
    >
      <button
        onClick={onOpen}
        className="w-full p-md flex items-start gap-md text-left"
      >
        <div className="flex-1 min-w-0 space-y-xs">
          <div className="flex items-center gap-sm flex-wrap">
            <span className="text-label-md font-label-md text-secondary font-bold">
              {useCase.useCase?.code ?? `#${useCase.use_case_id}`}
            </span>
            {priority && (
              <StatusChip variant={PRIORITY_BADGE_VARIANT[priority] ?? "neutral"} size="sm">
                {priority}
              </StatusChip>
            )}
            {useCase.useCase?.category && (
              <span className="text-[10px] text-on-surface-variant bg-surface-container-high px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                {useCase.useCase.category}
              </span>
            )}
            <StatusChip
              variant={progressStatusVariant[progress] ?? "neutral"}
              icon={PROGRESS_ICONS[progress]}
              size="sm"
            >
              {PROGRESS_LABELS[progress]}
            </StatusChip>
          </div>
          <p className="font-title-sm text-title-sm text-on-surface leading-snug">
            {useCase.useCase?.name ?? `Scenario #${useCase.use_case_id}`}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-sm">
          <span className="hidden sm:inline-flex items-center gap-xs px-md py-1.5 rounded-lg bg-primary text-on-primary text-label-sm font-label-md group-hover:opacity-90 transition-all">
            {actionLabel}
            <span className="material-symbols-outlined text-[16px]">{actionIcon}</span>
          </span>
          <span className="material-symbols-outlined text-on-surface-variant sm:hidden">chevron_right</span>
        </div>
      </button>
    </article>
  );
}
