import { useLocation } from "wouter";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import {
  PageHeader,
  EmptyState,
  StatusChip,
  runStatusVariant,
  progressStatusVariant,
  KpiCard,
  FilterTabs,
  type FilterTab,
} from "../components/ui";
import type { TestRunUseCase, Execution } from "../types/api";
import type { TesterOverview } from "../types/dashboard";

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
              {completed} / {totalCases} scenarios
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
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: '', dir: 'asc' });

  useEffect(() => { document.title = "My Runs | TestCaseHub"; }, []);

  const { data: runs, isLoading } = useQuery({
    queryKey: ["tester-runs", user?.userId],
    queryFn: () => customFetch<TesterRunItem[]>(
      `/dashboard/tester/${user!.userId}/test-runs`
    ),
    enabled: !!user?.userId,
  });

  const { data: overview } = useQuery({
    queryKey: ["roleOverview", "TESTER", user?.userId],
    queryFn: () => customFetch<TesterOverview>("/dashboard/role-overview?role=TESTER"),
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

    // Compute progress for each run — count scenarios assigned to this tester
    for (const [, group] of map) {
      let completed = 0, inProg = 0, notStarted = 0;
      const runExecs = (group.run as any).executions ?? [];
      const runType = (group.run as any).run_type as string | undefined;
      const blockedCaseIds = new Set<number>(
        ((group.run as any).blockedCaseIds as number[] | undefined) ?? [],
      );

      for (const uc of group.useCases) {
        // Authoritative after submit: sign-off or terminal scenario status
        const signedOff = uc.tester_sign_off === true;
        const terminalStatus =
          uc.status === "passed" ||
          uc.status === "failed" ||
          uc.status === "passed_by_agreement";
        if (signedOff || terminalStatus) {
          completed++;
          continue;
        }

        const tcs = (uc.useCase?.testCases ?? []).filter((tc: any) => {
          // Retest: ignore blocked cases — they are not executable
          if (tc.retestRole === "blocked" || tc.retestExecutable === false) return false;
          if (blockedCaseIds.has(tc.id)) return false;
          return true;
        });

        const caseProgresses = tcs.map((tc: any) => {
          const exec = runExecs.find((e: any) => e.test_case_id === tc.id);
          if (!exec) return "Not Started" as CaseProgress;
          if (exec.overall_result != null) return "Completed" as CaseProgress;
          return computeCaseProgress(tc.steps ?? [], exec.stepResults ?? []);
        });

        // All-blocked retest scenario (no executable cases) counts as complete for this tester
        const scenarioProgress: CaseProgress =
          tcs.length === 0 && runType === "retest" ? "Completed" :
          caseProgresses.length === 0 ? "Not Started" :
          caseProgresses.every((p: CaseProgress) => p === "Completed") ? "Completed" :
          caseProgresses.some((p: CaseProgress) => p === "In Progress" || p === "Completed") ? "In Progress" :
          "Not Started";

        if (scenarioProgress === "Completed") completed++;
        else if (scenarioProgress === "In Progress") inProg++;
        else notStarted++;
      }

      const totalScenarios = group.useCases.length;
      let runProgress: CaseProgress = "Not Started";
      if (totalScenarios > 0 && completed === totalScenarios) runProgress = "Completed";
      else if (completed > 0 || inProg > 0) runProgress = "In Progress";

      group.completed = completed;
      group.inProgress = inProg;
      group.notStarted = notStarted;
      group.totalCases = totalScenarios; // reusing field — now means totalScenarios
      group.progress = runProgress;
    }

    return Array.from(map.values());
  }, [runs]);

  const kpis = useMemo(() => {
    const allUseCases = grouped.flatMap((g) => g.useCases);
    const totalRuns = grouped.length;
    const activeRuns = grouped.filter((g) => g.run.status !== "completed").length;
    const totalScenarios = allUseCases.length;
    const remaining = allUseCases.filter(
      (uc) => uc.status !== "passed" && uc.status !== "failed" && uc.status !== "passed_by_agreement" && !uc.tester_sign_off,
    ).length;
    const completedToday = allUseCases.filter(
      (uc) => (uc.status === "passed" || uc.status === "failed" || uc.status === "passed_by_agreement" || uc.tester_sign_off) && isToday(uc.updated_at)
    ).length;
    const dueToday = grouped.filter((g) => isToday(g.run.scheduled_at) || g.run.status === "in_progress").length;

    const myTcIds = new Set(
      allUseCases.flatMap((uc) => (uc.useCase?.testCases ?? []).map((tc: { id: number }) => tc.id))
    );
    const allExecs = grouped.flatMap((g) => (g.run as { executions?: Execution[] }).executions ?? []);
    const myExecs = allExecs.filter((e) => myTcIds.has(e.test_case_id));
    const allStepResults = myExecs.flatMap((e) => (e as Execution & { stepResults?: { passed: boolean | null }[] }).stepResults ?? []);
    const recordedSteps = allStepResults.filter((sr) => sr.passed != null);
    const passedSteps = recordedSteps.filter((sr) => sr.passed === true);
    const localPassRate = recordedSteps.length > 0
      ? Math.round((passedSteps.length / recordedSteps.length) * 100)
      : null;

    const todo = grouped.reduce((s, g) => s + g.notStarted, 0);
    const inProgress = grouped.reduce((s, g) => s + g.inProgress, 0);
    const done = grouped.reduce((s, g) => s + g.completed, 0);

    return {
      totalRuns,
      activeRuns,
      totalScenarios,
      remaining: overview?.kpis.myRemaining ?? remaining,
      completedToday: overview?.kpis.completedToday ?? completedToday,
      dueToday: overview?.kpis.dueToday ?? dueToday,
      passRate: overview?.kpis.passRate ?? localPassRate,
      openDefectsFound: overview?.kpis.openDefectsFound ?? 0,
      todo: overview?.todayProgress.todo ?? todo,
      inProgressCount: overview?.todayProgress.inProgress ?? inProgress,
      doneCount: overview?.todayProgress.done ?? done,
    };
  }, [grouped, overview]);

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

  const toggleSort = (key: string) => {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const sortedGroups = useMemo(() => {
    if (!sort.key) return filteredGroups;
    return [...filteredGroups].sort((a, b) => {
      const getVal = (g: RunGroup): string => {
        switch (sort.key) {
          case "name": return g.run.name.toLowerCase();
          case "project": return (g.run as any).project?.name?.toLowerCase() ?? "";
          case "status": return g.run.status;
          case "progress": return g.progress;
          case "scenarios": return String(g.totalCases).padStart(10, "0");
          default: return "";
        }
      };
      const aVal = getVal(a);
      const bVal = getVal(b);
      return sort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [filteredGroups, sort]);

  const SortHeader = ({ sortKey, children, className }: { sortKey: string; children: ReactNode; className?: string }) => {
    const active = sort.key === sortKey;
    return (
      <th
        className={`${className ?? ""} px-md py-sm text-[10px] font-bold text-outline uppercase tracking-wider cursor-pointer select-none hover:text-on-surface transition-colors`}
        onClick={() => toggleSort(sortKey)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {active ? (
            <span className="material-symbols-outlined text-[12px]">{sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
          ) : (
            <span className="material-symbols-outlined text-[12px] opacity-30">unfold_more</span>
          )}
        </span>
      </th>
    );
  };

  return (
    <div className="space-y-lg max-w-7xl mx-auto w-full">
      <PageHeader
        icon="play_circle"
        eyebrow="Tester workspace"
        title="My Runs"
        description={
          grouped.length > 0
            ? `What do you run today? · ${kpis.activeRuns} active run${kpis.activeRuns === 1 ? "" : "s"} · ${kpis.remaining} scenario${kpis.remaining === 1 ? "" : "s"} remaining`
            : "No test runs are assigned to you yet."
        }
      />

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-md" aria-label="Key metrics">
        <KpiCard
          icon="today"
          label="Due / active"
          value={kpis.dueToday}
          hint={kpis.activeRuns > 0 ? `${kpis.activeRuns} active runs` : "Nothing due"}
          tone="info"
          onClick={() => setFilter("today")}
        />
        <KpiCard
          icon="pending_actions"
          label="My remaining"
          value={kpis.remaining}
          hint={`${kpis.totalScenarios} assigned total`}
          tone={kpis.remaining > 0 ? "warning" : "success"}
          onClick={() => setFilter("active")}
        />
        <KpiCard
          icon="task_alt"
          label="Completed today"
          value={kpis.completedToday}
          hint={kpis.completedToday === 0 ? "Nothing finished today" : "Nice work"}
          tone="success"
        />
        <KpiCard
          icon="percent"
          label="My pass rate"
          value={kpis.passRate != null ? `${kpis.passRate}%` : "—"}
          hint={kpis.passRate != null ? "Your steps" : "No results yet"}
          tone={kpis.passRate != null && kpis.passRate < 70 ? "warning" : "default"}
        />
        <KpiCard
          icon="bug_report"
          label="Defects I found (open)"
          value={kpis.openDefectsFound}
          hint="From your executions"
          tone={kpis.openDefectsFound > 0 ? "info" : "default"}
        />
      </section>

      {(kpis.todo + kpis.inProgressCount + kpis.doneCount) > 0 && (
        <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md md:p-lg grid grid-cols-1 md:grid-cols-3 gap-md items-center">
          <div className="md:col-span-1 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: "To do", value: kpis.todo, color: "#94a3b8" },
                    { name: "In progress", value: kpis.inProgressCount, color: "#f59e0b" },
                    { name: "Done", value: kpis.doneCount, color: "#22c55e" },
                  ].filter((d) => d.value > 0)}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={40}
                  outerRadius={60}
                  paddingAngle={2}
                >
                  {[
                    { name: "To do", value: kpis.todo, color: "#94a3b8" },
                    { name: "In progress", value: kpis.inProgressCount, color: "#f59e0b" },
                    { name: "Done", value: kpis.doneCount, color: "#22c55e" },
                  ].filter((d) => d.value > 0).map((e) => (
                    <Cell key={e.name} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="md:col-span-2 space-y-sm">
            <h4 className="font-title-sm text-title-sm">Today&apos;s progress</h4>
            <p className="text-body-sm text-on-surface-variant">
              {kpis.doneCount} done · {kpis.inProgressCount} in progress · {kpis.todo} to do across your assigned scenarios.
            </p>
            <div className="flex flex-wrap gap-sm">
              <button
                onClick={() => setFilter(kpis.inProgressCount > 0 ? "in_progress" : "active")}
                className="inline-flex items-center gap-xs px-md py-sm rounded-lg bg-primary text-on-primary font-label-md text-label-sm"
              >
                {kpis.inProgressCount > 0 ? "Continue testing" : "Start testing"}
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
              <button
                onClick={() => setFilter("today")}
                className="inline-flex items-center gap-xs px-md py-sm rounded-lg bg-surface-container-high font-label-md text-label-sm"
              >
                Scheduled today
              </button>
            </div>
          </div>
        </section>
      )}

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
          <div className="flex items-center justify-between gap-md flex-wrap-reverse">
            <div className="flex items-center gap-md">
              <FilterTabs<RunFilter> tabs={filterTabs} active={filter} onChange={setFilter} />
              <div className="inline-flex items-center gap-xs bg-surface-container p-xs rounded-lg shrink-0">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-md py-xs rounded-md font-label-md text-label-sm transition-all ${
                    viewMode === 'cards'
                      ? 'bg-surface-container-lowest text-secondary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">grid_view</span>
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-md py-xs rounded-md font-label-md text-label-sm transition-all ${
                    viewMode === 'list'
                      ? 'bg-surface-container-lowest text-secondary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">list</span>
                  List
                </button>
              </div>
            </div>
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
            viewMode === 'cards' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-lg">
                {filteredGroups.map((g) => (
                  <RunCard key={g.run.id} group={g} onOpen={handleOpen} />
                ))}
              </div>
            ) : (
              <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-container-low border-b border-outline-variant">
                        <SortHeader sortKey="name">Run Name</SortHeader>
                        <SortHeader sortKey="project">Project</SortHeader>
                        <SortHeader sortKey="status">Status</SortHeader>
                        <SortHeader sortKey="progress">Progress</SortHeader>
                        <SortHeader sortKey="scenarios">Scenarios</SortHeader>
                        <th className="px-md py-sm text-[10px] font-bold text-outline uppercase tracking-wider text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/60">
                      {sortedGroups.map((g) => {
                        const { run, progress, completed, totalCases } = g;
                        const runStatusVariant_ = runStatusVariant[run.status] ?? "neutral";
                        const runStatusIcon = run.status === "completed" ? "check_circle" : run.status === "in_progress" ? "autorenew" : "event";
                        const primaryAction = g.inProgress > 0 ? "Continue Testing" : g.notStarted > 0 ? "Start Testing" : "Review Results";
                        return (
                          <tr key={run.id} className="hover:bg-surface-container-low cursor-pointer" onClick={() => handleOpen(run.id)}>
                            <td className="px-md py-sm"><p className="font-title-sm text-title-sm text-on-surface leading-snug">{run.name}</p></td>
                            <td className="px-md py-sm"><p className="text-body-sm text-on-surface-variant">{run.project?.name ?? ""}</p></td>
                            <td className="px-md py-sm">
                              <StatusChip variant={runStatusVariant_} icon={runStatusIcon} size="sm">
                                {run.status.replace(/_/g, " ")}
                              </StatusChip>
                            </td>
                            <td className="px-md py-sm">
                              <StatusChip variant={progressStatusVariant[progress]} size="sm">
                                {completed}/{totalCases}
                              </StatusChip>
                            </td>
                            <td className="px-md py-sm"><p className="text-body-sm text-on-surface-variant">{totalCases}</p></td>
                            <td className="px-md py-sm text-right">
                              <button onClick={(e) => { e.stopPropagation(); handleOpen(run.id); }} className="inline-flex items-center gap-xs px-md py-1.5 rounded-lg bg-primary text-on-primary text-label-sm font-label-md hover:opacity-90 transition-all">
                                {primaryAction}
                                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
