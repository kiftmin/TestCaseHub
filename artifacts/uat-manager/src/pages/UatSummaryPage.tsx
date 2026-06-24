import { useEffect, useMemo } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { customFetch } from "../lib/api-client";
import type { TestRun, TestRunUseCase } from "../types/api";

interface ExecutionWithDefects {
  id: number;
  defects?: Array<{
    id: number;
    status: string;
  }>;
}

interface UatSummary {
  totalScenarios: number;
  totalTestRuns: number;
  passRate: number;
  defectsByStatus: Record<string, number>;
  defectsBySeverity: Record<string, number>;
}

const DEFECT_STATUS_COLORS: Record<string, string> = {
  NEW: "#ef4444",
  TRIAGED: "#f59e0b",
  ASSIGNED: "#f59e0b",
  IN_PROGRESS: "#3b82f6",
  RESOLVED_DEV: "#22c55e",
  READY_FOR_VERIFICATION: "#a855f7",
  REGRESSED: "#ef4444",
  CLOSED: "#22c55e",
  PASSED_BY_AGREEMENT: "#16a34a",
};

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ef4444",
  Major: "#f97316",
  Minor: "#fbbf24",
  Cosmetic: "#c0c1ff",
};

const RUN_STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-surface-container",
  in_progress: "bg-secondary-container",
  completed: "bg-surface-container-highest",
  failed: "bg-error-container",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  failed: "Failed",
};

const OTHER_DEFECT_COLOR = "#94a3b8";

function DonutLabel({ total }: { total: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-center">
        <div className="text-3xl font-bold text-on-surface">{total}</div>
        <div className="text-label-sm text-on-surface-variant">Total</div>
      </div>
    </div>
  );
}

export function UatSummaryPage({ params: propParams }: { params?: { id?: string } } = {}) {
  const [, routeParams] = useRoute<{ id: string }>("/projects/:id/uat-summary");
  const projectId = propParams?.id ? Number(propParams.id) : routeParams ? Number(routeParams.id) : null;

  useEffect(() => {
    document.title = "UAT Summary | TestCaseHub";
  }, []);

  const { data: summary, isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ["uat-summary", projectId],
    queryFn: () => customFetch<UatSummary>(`/projects/${projectId}/uat-summary`),
    enabled: projectId !== null,
  });

  const { data: testRuns, isLoading: runsLoading } = useQuery({
    queryKey: ["test-runs", projectId],
    queryFn: () => customFetch<TestRun[]>(`/projects/${projectId}/test-runs`),
    enabled: projectId !== null,
  });

  const isLoading = summaryLoading || runsLoading;

  const totalDefects = useMemo(
    () => (summary ? Object.values(summary.defectsByStatus).reduce((sum, v) => sum + v, 0) : 0),
    [summary],
  );

  const openDefects = useMemo(() => {
    if (!testRuns) return 0;
    return testRuns.reduce((count, run) => {
      const executions = ((run as TestRun & { executions?: ExecutionWithDefects[] }).executions) ?? [];
      return count + executions.reduce((ec, exec) => {
        const defects = (exec as ExecutionWithDefects).defects ?? [];
        return ec + defects.filter((d) => d.status !== "CLOSED" && d.status !== "PASSED_BY_AGREEMENT").length;
      }, 0);
    }, 0);
  }, [testRuns]);

  const donutData = useMemo(
    () => (summary ? Object.entries(summary.defectsByStatus).map(([name, value]) => ({ name, value })) : []),
    [summary],
  );

  const severityData = useMemo(
    () => (summary ? Object.entries(summary.defectsBySeverity).map(([name, value]) => ({ name, value })) : []),
    [summary],
  );

  const getDonutColor = (name: string) => DEFECT_STATUS_COLORS[name] ?? OTHER_DEFECT_COLOR;

  const loadingSkeleton = (
    <div className="animate-pulse space-y-lg">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-lg">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg space-y-md">
            <div className="w-8 h-8 skeleton rounded-lg" />
            <div className="w-20 h-4 skeleton rounded" />
            <div className="w-12 h-8 skeleton rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg h-80 skeleton rounded" />
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg h-80 skeleton rounded" />
      </div>
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg h-60 skeleton rounded" />
    </div>
  );

  if (summaryError) {
    return (
      <div className="bg-error-container border border-error rounded-xl p-lg">
        <p className="text-error font-body-sm">Something went wrong — {summaryError.message}</p>
        <button onClick={() => refetchSummary()} className="mt-md bg-error text-on-error px-md py-sm rounded-lg font-label-md">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-xl">
      <div>
        <h1 className="font-display-lg text-display-lg text-primary">UAT Summary</h1>
        <p className="font-body-base text-body-base text-on-surface-variant">Overview of user acceptance testing results</p>
      </div>

      {isLoading ? loadingSkeleton : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-lg">
            <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
              <p className="font-label-md text-label-md text-on-surface-variant">Total Scenarios</p>
              <h3 className="font-headline-md text-headline-md mt-xs">{summary?.totalScenarios ?? 0}</h3>
            </div>
            <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
              <p className="font-label-md text-label-md text-on-surface-variant">Total Runs</p>
              <h3 className="font-headline-md text-headline-md mt-xs">{summary?.totalTestRuns ?? 0}</h3>
            </div>
            <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
              <p className="font-label-md text-label-md text-on-surface-variant">Run Pass Rate</p>
              <h3 className="font-headline-md text-headline-md mt-xs">{summary?.passRate != null ? `${Math.round(summary.passRate)}%` : "—"}</h3>
            </div>
            <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
              <p className="font-label-md text-label-md text-on-surface-variant">Total Defects</p>
              <h3 className="font-headline-md text-headline-md mt-xs">{totalDefects}</h3>
            </div>
            <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
              <p className="font-label-md text-label-md text-on-surface-variant">Open Defects</p>
              <h3 className="font-headline-md text-headline-md mt-xs">{openDefects}</h3>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg">
              <h2 className="font-title-sm text-title-sm mb-lg">Defects by Status</h2>
              {donutData.length > 0 ? (
                <div className="relative">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        dataKey="value"
                        nameKey="name"
                      >
                        {donutData.map((entry) => (
                          <Cell key={entry.name} fill={getDonutColor(entry.name)} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                  <DonutLabel total={totalDefects} />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[300px] text-on-surface-variant">
                  <span className="material-symbols-outlined text-4xl mb-md">pie_chart</span>
                  <p className="font-body-sm">No defect data available</p>
                </div>
              )}
            </div>

            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg">
              <h2 className="font-title-sm text-title-sm mb-lg">Defects by Severity</h2>
              {severityData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={severityData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {severityData.map((entry) => (
                        <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] ?? "#94a3b8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-[300px] text-on-surface-variant">
                  <span className="material-symbols-outlined text-4xl mb-md">bar_chart</span>
                  <p className="font-body-sm">No severity data available</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
            <div className="p-lg border-b border-outline-variant">
              <h2 className="font-title-sm text-title-sm">Test Runs</h2>
            </div>
            {testRuns && testRuns.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low font-label-md text-label-md text-on-surface-variant">
                    <tr>
                      <th className="px-lg py-md">Run Name</th>
                      <th className="px-lg py-md">Status</th>
                      <th className="px-lg py-md">Scheduled</th>
                      <th className="px-lg py-md">Pass/Fail</th>
                      <th className="px-lg py-md">Scenarios</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant font-body-sm text-body-sm">
                    {testRuns.map((run) => {
                      const useCases: TestRunUseCase[] = (run.useCases as TestRunUseCase[] | undefined) ?? [];
                      const passed = useCases.filter((uc) => uc.status === "passed" || uc.status === "passed_by_agreement").length;
                      const failed = useCases.filter((uc) => uc.status === "failed").length;
                      const isFailed = run.status === "completed" && run.passed === false;
                      const displayStatus = isFailed ? "failed" : run.status;
                      return (
                        <tr key={run.id} className="hover:bg-surface-container-low transition-colors">
                          <td className="px-lg py-md font-medium">{run.name}</td>
                          <td className="px-lg py-md">
                            <span className={`inline-block px-sm py-xs rounded text-label-sm font-bold ${RUN_STATUS_STYLES[displayStatus] ?? "bg-surface-container"}`}>
                              {RUN_STATUS_LABELS[displayStatus] ?? run.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                            </span>
                          </td>
                          <td className="px-lg py-md text-on-surface-variant">
                            {run.scheduled_at ? new Date(run.scheduled_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-lg py-md">
                            {useCases.length > 0 ? (
                              <span>
                                <span className="text-green-600 font-semibold">{passed}</span>
                                {" / "}
                                <span className="text-red-600 font-semibold">{failed}</span>
                              </span>
                            ) : (
                              <span className="text-on-surface-variant">—</span>
                            )}
                          </td>
                          <td className="px-lg py-md">{useCases.length}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-lg text-center text-on-surface-variant">
                <span className="material-symbols-outlined text-4xl mb-md">play_circle</span>
                <p>No test runs yet.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
