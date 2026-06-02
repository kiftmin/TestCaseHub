import { useLocation } from "wouter";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import type { TestRunUseCase } from "../types/api";

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
};

const ucStatusColors: Record<string, string> = {
  passed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  in_progress: "bg-amber-100 text-amber-700",
  pending: "bg-surface-container-high text-on-surface-variant",
  passed_by_agreement: "bg-purple-100 text-purple-700",
};

function daysUntil(dateStr: string): string {
  const now = new Date();
  const target = new Date(dateStr);
  const diff = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `Overdue by ${Math.abs(diff)} days`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `In ${diff} days`;
}

export function TesterDashboardPage() {
  const [, navigate] = useLocation();
  const user = getStoredUser();
  useEffect(() => { document.title = "My Runs | TestCaseHub"; }, []);

  const { data: runs, isLoading } = useQuery({
    queryKey: ["tester-runs", user?.userId],
    queryFn: () => customFetch<(TestRunUseCase & { testRun?: { id: number; name: string; status: string; scheduled_at: string | null; project?: { name: string } } })[]>(
      `/dashboard/tester/${user!.userId}/test-runs`
    ),
    enabled: !!user?.userId,
  });

  const grouped: Record<number, { run: { id: number; name: string; status: string; scheduled_at: string | null; project?: { name: string } }; useCases: Array<TestRunUseCase & { testRun?: { id: number; name: string; status: string; scheduled_at: string | null; project?: { name: string } } }> }> = {};
  runs?.forEach((r) => {
    const runId = r.test_run_id;
    if (!grouped[runId]) {
      grouped[runId] = { run: r.testRun ?? { id: runId, name: `Run #${runId}`, status: "scheduled", scheduled_at: null }, useCases: [] };
    }
    grouped[runId].useCases.push(r);
  });

  const runGroups = Object.values(grouped);

  if (isLoading) {
    return (
      <div className="space-y-lg animate-pulse">
        <div className="w-1/2 h-8 skeleton rounded" />
        <div className="bento-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-surface border border-outline-variant rounded-xl p-lg">
              <div className="w-3/4 h-5 skeleton rounded mb-2" />
              <div className="w-1/2 h-4 skeleton rounded mb-4" />
              <div className="w-full h-2 skeleton rounded mb-2" />
              <div className="w-1/3 h-4 skeleton rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-lg">
      <div>
        <h2 className="font-display-lg text-display-lg text-primary">
          My Runs
        </h2>
        <p className="font-body-base text-body-base text-on-surface-variant">
          {runGroups.length > 0
            ? `You have ${runGroups.length} active test run${runGroups.length > 1 ? "s" : ""} assigned.`
            : "No test runs assigned yet."}
        </p>
      </div>

      <div className="bento-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.5rem" }}>
        {runGroups.map(({ run, useCases }) => {
          const totalExec = useCases.filter((uc) => uc.status !== "pending").length;
          const progress = useCases.length > 0 ? Math.round((totalExec / useCases.length) * 100) : 0;

          return (
            <div
              key={run.id}
              className="bg-surface border border-outline-variant rounded-xl overflow-hidden hover:shadow-lg transition-all group flex flex-col"
            >
              <div className="p-lg flex-1 flex flex-col">
                <div className="mb-md">
                  <div className="flex items-center justify-between mb-sm">
                    <span className={`px-sm py-xs rounded text-label-sm font-bold uppercase ${statusColors[run.status] ?? ""}`}>
                      {run.status.replace(/_/g, " ")}
                    </span>
                    {run.scheduled_at && (
                      <span className="text-label-sm text-on-surface-variant">{daysUntil(run.scheduled_at)}</span>
                    )}
                  </div>
                  <p className="text-label-sm text-secondary-container mb-xs uppercase tracking-tight">
                    {run.project?.name ?? ""}
                  </p>
                  <h4 className="font-title-sm text-title-sm text-on-surface">{run.name}</h4>
                </div>

                <div className="mb-md">
                  <div className="flex justify-between items-center mb-sm">
                    <span className="text-body-sm font-body-sm text-on-surface-variant">Progress</span>
                    <span className="text-body-sm font-bold text-primary">{progress}%</span>
                  </div>
                  <div className="w-full bg-surface-container-high rounded-full h-1.5 overflow-hidden">
                    <div className="bg-secondary h-full rounded-full transition-all duration-1000" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="mt-auto pt-md flex items-center justify-between border-t border-outline-variant/50">
                  <div className="flex items-center gap-md flex-wrap">
                    {useCases.slice(0, 3).map((uc) => (
                      <span
                        key={uc.id}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${ucStatusColors[uc.status] ?? ""}`}
                      >
                        {uc.useCase?.code ?? `#${uc.use_case_id}`}
                      </span>
                    ))}
                    {useCases.length > 3 && (
                      <span className="text-[10px] text-on-surface-variant">+{useCases.length - 3}</span>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(`/test-runs/${run.id}`)}
                    className="py-2 px-md bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-surface-variant active:scale-[0.98] transition-all"
                  >
                    Start Testing
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
