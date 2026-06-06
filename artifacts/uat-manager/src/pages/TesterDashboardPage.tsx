import { useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import {
  PageHeader,
  EmptyState,
  StatusChip,
  runStatusVariant,
  KpiCard,
  FilterTabs,
  type FilterTab,
} from "../components/ui";
import type { TestRunUseCase, Execution } from "../types/api";

/* ────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────── */

type CaseProgress = "Not Started" | "In Progress" | "Completed";

type TestRunSummary = {
  id: number;
  name: string;
  status: "scheduled" | "in_progress" | "completed";
  scheduled_at: string | null;
  project?: { name: string; project_code?: string };
  executions?: Execution[];
};

type TesterRunItem = TestRunUseCase & {
  testRun?: TestRunSummary;
};

type RunGroup = {
  run: TestRunSummary;
  useCases: TesterRunItem[];
  progress: CaseProgress;
  completed: number;
  inProgress: number;
  notStarted: number;
  totalCases: number;
};

type RunFilter = "all" | "active" | "in_progress" | "completed" | "today";

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

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
  const failedWithoutActual = stepResults.filter(
    r => r.passed === false && (!r.actual_result || r.actual_result.trim() === ""),
  );
  if (failedWithoutActual.length > 0) return "In Progress";
  return "Completed";
}

/* ────────────────────────────────────────────────────────────────────
   Date helpers
   ──────────────────────────────────────────────────────────────────── */

function daysUntil(dateStr: string): { label: string; tone: "warning" | "info" | "error" | "neutral" } {
  const now = new Date();
  const target = new Date(dateStr);
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: `Overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"}`, tone: "error" };
  if (diff === 0) return { label: "Today", tone: "warning" };
  if (diff === 1) return { label: "Tomorrow", tone: "info" };
  if (diff <= 7) return { label: `In ${diff} days`, tone: "info" };
  return { label: `In ${diff} days`, tone: "neutral" };
}

function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/* ────────────────────────────────────────────────────────────────────
   Run Card
   ──────────────────────────────────────────────────────────────────── */

function RunCard({ group, onOpen }: { group: RunGroup; onOpen: (runId: number) => void }) {
  const { run, useCases, progress, completed, inProgress, notStarted, totalCases } = group;
  const progress_pct = totalCases > 0 ? Math.round((completed / totalCases) * 100) : 0;
  const primaryAction = inProgress > 0 ? "Continue Testing" : notStarted > 0 ? "Start Testing" : "Review Results";
  const schedule = run.scheduled_at ? daysUntil(run.scheduled_at) : null;
  const runStatusVariant_ = runStatusVariant[run.status] ?? "neutral";
  const runStatusIcon =
    run.status === "completed" ? "check_circle" :
    run.status === "in_progress" ? "autorenew" : "event";

  return (
    <article className="group bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden hover:shadow-md transition-all flex flex-col">
      <div className="p-md md:p-lg space-y-md flex-1 flex flex-col">
        <header className="space-y-xs">
          <div className="flex items-center justify-between gap-sm">
            <p className="text-label-sm uppercase tracking-wider font-bold text-secondary truncate">
              {run.project?.name ?? "Project"}
            </p>
            <StatusChip variant={runStatusVariant_} icon={runStatusIcon}>
              {run.status.replace(/_/g, " ")}
            </StatusChip>
          </div>
          <h3 className="font-title-md text-title-md text-on-surface leading-snug">
            {run.name}
          </h3>
          {schedule && (
            <p className="text-body-sm text-on-surface-variant inline-flex items-center gap-xs">
              <span className="material-symbols-outlined text-[14px]">event</span>
              {schedule.label}
            </p>
          )}
        </header>

        <div className="space-y-xs">
          <div className="flex items-center justify-between text-label-sm">
            <span className="text-on-surface-variant font-bold uppercase tracking-wider">Progress</span>
            <span className="font-bold text-on-surface">
              {completed} / {totalCases} cases
            </span>
          </div>
          <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                progress === "Completed"
                  ? "bg-secondary"
                  : inProgress > 0
                    ? "bg-gradient-to-r from-secondary to-warning"
                    : "bg-surface-container-high"
              }`}
              style={{ width: `${progress_pct}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-sm">
          <Stat label="To Do" value={notStarted} tone="neutral" />
          <Stat label="In Progress" value={inProgress} tone="warning" />
          <Stat label="Done" value={completed} tone="success" />
        </div>
      </div>

      <footer className="px-md md:px-lg py-sm border-t border-outline-variant bg-surface-container-low/50 flex items-center justify-between gap-sm">
        <div className="flex items-center gap-xs flex-wrap min-w-0">
          {useCases.slice(0, 4).map((uc) => (
            <span
              key={uc.id}
              className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant bg-surface-container-high px-1.5 py-0.5 rounded"
            >
              {uc.useCase?.code ?? `#${uc.use_case_id}`}
            </span>
          ))}
          {useCases.length > 4 && (
            <span className="text-[10px] text-on-surface-variant">+{useCases.length - 4}</span>
          )}
        </div>
        <button
          onClick={() => onOpen(run.id)}
          className="inline-flex items-center gap-xs px-md py-1.5 bg-primary text-on-primary rounded-lg font-label-md text-label-sm hover:opacity-90 active:scale-[0.98] transition-all"
        >
          {primaryAction}
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </button>
      </footer>
    </article>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "neutral" | "warning" | "success" }) {
  const toneClasses =
    tone === "success" ? "text-green-700" :
    tone === "warning" ? "text-amber-700" :
    "text-on-surface";
  return (
    <div className="rounded-lg bg-surface-container-low border border-outline-variant/50 px-sm py-xs text-center">
      <p className={`font-headline-sm text-headline-sm leading-none ${toneClasses}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mt-1">{label}</p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export function TesterDashboardPage() {
  const [, navigate] = useLocation();
  const user = getStoredUser();
  const [filter, setFilter] = useState<RunFilter>("all");

  useEffect(() => { document.title = "My Runs | TestCaseHub"; }, []);

  const { data: runs, isLoading } = useQuery({
    queryKey: ["tester-runs", user?.userId],
    queryFn: () => customFetch<TesterRunItem[]>(
      `/dashboard/tester/${user!.userId}/test-runs`
    ),
    enabled: !!user?.userId,
  });

  const grouped = useMemo<RunGroup[]>(() => {
    const map = new Map<number, RunGroup>();
    runs?.forEach((r) => {
      const runId = r.test_run_id;
      if (!map.has(runId)) {
        map.set(runId, {
          run: r.testRun ?? {
            id: runId,
            name: `Run #${runId}`,
            status: "scheduled",
            scheduled_at: null,
          },
          useCases: [],
          progress: "Not Started",
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          totalCases: 0,
        });
      }
      map.get(runId)!.useCases.push(r);
    });

    // Compute progress for each run
    for (const [, group] of map) {
      let completed = 0, inProg = 0, notStarted = 0, totalCases = 0;
      const runExecs = (group.run as any).executions ?? [];
      for (const uc of group.useCases) {
        const tcs = uc.useCase?.testCases ?? [];
        for (const tc of tcs) {
          totalCases++;
          const exec = runExecs.find((e: any) => e.test_case_id === tc.id);
          if (!exec) {
            notStarted++;
            continue;
          }
          const progress = computeCaseProgress(tc.steps ?? [], exec.stepResults ?? []);
          if (progress === "Completed") completed++;
          else if (progress === "In Progress") inProg++;
          else notStarted++;
        }
      }

      let runProgress: CaseProgress = "Not Started";
      if (totalCases > 0 && completed === totalCases) runProgress = "Completed";
      else if (completed > 0 || inProg > 0) runProgress = "In Progress";

      group.completed = completed;
      group.inProgress = inProg;
      group.notStarted = notStarted;
      group.totalCases = totalCases;
      group.progress = runProgress;
    }

    return Array.from(map.values());
  }, [runs]);

  const kpis = useMemo(() => {
    const allUseCases = grouped.flatMap((g) => g.useCases);
    const totalRuns = grouped.length;
    const activeRuns = grouped.filter((g) => g.run.status !== "completed").length;
    const totalScenarios = allUseCases.length;
    const completedToday = allUseCases.filter((uc) => {
      return isToday(uc.updated_at);
    }).length;
    const completedRuns = grouped.filter((g) => g.progress === "Completed").length;
    const passRate = completedRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : null;
    return { totalRuns, activeRuns, totalScenarios, completedToday, passRate };
  }, [grouped]);

  const filteredGroups = useMemo(() => {
    return grouped.filter((g) => {
      if (filter === "all") return true;
      if (filter === "active") return g.run.status !== "completed";
      if (filter === "in_progress") return g.run.status === "in_progress";
      if (filter === "completed") return g.run.status === "completed";
      if (filter === "today") return isToday(g.run.scheduled_at);
      return true;
    });
  }, [grouped, filter]);

  const filterTabs: FilterTab<RunFilter>[] = [
    { key: "all", label: "All Runs", count: grouped.length, icon: "view_module" },
    { key: "active", label: "Active", count: kpis.activeRuns, icon: "play_circle" },
    { key: "in_progress", label: "In Progress", count: grouped.filter((g) => g.run.status === "in_progress").length, icon: "autorenew" },
    { key: "today", label: "Scheduled Today", count: grouped.filter((g) => isToday(g.run.scheduled_at)).length, icon: "today" },
    { key: "completed", label: "Completed", count: grouped.filter((g) => g.run.status === "completed").length, icon: "check_circle" },
  ];

  const handleOpen = (runId: number) => navigate(`/tester/run/${runId}`);

  return (
    <div className="space-y-lg max-w-7xl mx-auto w-full">
      <PageHeader
        icon="play_circle"
        eyebrow="Execution Engine"
        title="My Runs"
        description={
          grouped.length > 0
            ? `${kpis.activeRuns} active test run${kpis.activeRuns === 1 ? "" : "s"} • ${kpis.totalScenarios} scenario${kpis.totalScenarios === 1 ? "" : "s"} assigned to you`
            : "No test runs are assigned to you yet."
        }
      />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-md" aria-label="Key metrics">
        <KpiCard
          icon="inventory_2"
          label="Total Runs"
          value={kpis.totalRuns}
          hint={kpis.activeRuns > 0 ? `${kpis.activeRuns} active` : "All complete"}
          tone="info"
        />
        <KpiCard
          icon="checklist"
          label="My Scenarios"
          value={kpis.totalScenarios}
          hint={`Across ${kpis.totalRuns} run${kpis.totalRuns === 1 ? "" : "s"}`}
        />
        <KpiCard
          icon="task_alt"
          label="Completed Today"
          value={kpis.completedToday}
          hint={kpis.completedToday === 0 ? "Nothing finished today" : "Nice work today"}
          tone="success"
        />
        <KpiCard
          icon="percent"
          label="Pass Rate"
          value={kpis.passRate != null ? `${kpis.passRate}%` : "—"}
          hint={kpis.passRate != null ? "Across all completed scenarios" : "No data yet"}
          tone={kpis.passRate != null && kpis.passRate < 70 ? "warning" : "default"}
        />
      </section>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-lg">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg animate-pulse space-y-md">
              <div className="w-3/4 h-4 bg-surface-container-high rounded" />
              <div className="w-1/2 h-6 bg-surface-container-high rounded" />
              <div className="w-full h-2 bg-surface-container-high rounded" />
              <div className="grid grid-cols-3 gap-sm">
                <div className="h-10 bg-surface-container-high rounded" />
                <div className="h-10 bg-surface-container-high rounded" />
                <div className="h-10 bg-surface-container-high rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon="play_circle"
          title="No runs assigned yet"
          description="When a Test Lead assigns a scenario to you in a test run, it will appear here. Make sure you are a member of the project."
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-md flex-wrap">
            <FilterTabs<RunFilter> tabs={filterTabs} active={filter} onChange={setFilter} />
            <p className="text-label-sm text-on-surface-variant">
              Showing {filteredGroups.length} of {grouped.length}
            </p>
          </div>

          {filteredGroups.length === 0 ? (
            <EmptyState
              icon="filter_alt_off"
              title="No runs match this filter"
              description="Try a different filter to see more of your assigned runs."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-lg">
              {filteredGroups.map((g) => (
                <RunCard key={g.run.id} group={g} onOpen={handleOpen} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
