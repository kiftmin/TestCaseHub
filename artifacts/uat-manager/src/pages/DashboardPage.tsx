import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useAuth } from "../hooks/useAuth";
import type { DashboardSummary, Bug, ProjectAssignment, TestRunUseCase } from "../types/api";
import { useState, useEffect, useMemo } from "react";

const severityColors: Record<string, string> = {
  Critical: "text-error",
  Major: "text-amber-600",
  Minor: "text-blue-600",
  Cosmetic: "text-green-600",
};

const bugStatusColors: Record<string, string> = {
  OPEN: "bg-red-100 text-red-700",
  ASSIGNED: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  RESOLVED: "bg-green-100 text-green-700",
  TEST: "bg-purple-100 text-purple-700",
  FAILED_TO_RESOLVE: "bg-red-100 text-red-700",
  CLOSED: "bg-surface-container-high text-on-surface-variant",
  REOPENED: "bg-amber-100 text-amber-700",
};

interface RecentExecution {
  id: number;
  overall_result: string | null;
  executed_at: string | null;
  testCase?: { title: string };
  testRun?: { name: string };
}
interface RecentDefect {
  id: number;
  status: string;
  severity: string | null;
  created_at: string;
  testCase?: { title: string };
}
interface RecentBug {
  id: number;
  bug_number: number;
  status: string;
  created_at: string;
  developer?: { name: string };
  defect?: { testCase?: { title: string } };
}
interface ActivityResponse {
  recentExecutions?: RecentExecution[];
  recentDefects?: RecentDefect[];
  recentBugs?: RecentBug[];
}
interface TesterRun {
  id: number;
  name: string;
  status: string;
  updated_at?: string;
  scheduled_at?: string | null;
  project?: { name: string };
  useCases?: TestRunUseCase[];
}

export function DashboardPage() {
  const user = getStoredUser();
  const { isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  const { data: summary, isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ["dashboardSummary"],
    queryFn: () => customFetch<DashboardSummary>("/dashboard/summary"),
  });

  const { data: activity } = useQuery({
    queryKey: ["recentActivity"],
    queryFn: () => customFetch<ActivityResponse>("/dashboard/recent-activity"),
  });

  const { data: assignments } = useQuery({
    queryKey: ["userProjects", user?.userId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/users/${user!.userId}/projects`),
    enabled: !!user?.userId,
  });

  const topRole = useMemo(() => assignments?.[0]?.role ?? null, [assignments]);

  useEffect(() => {
    if (!currentRole && topRole) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentRole(topRole);
    } else if (currentRole && !assignments?.some((a) => a.role === currentRole)) {
      // currentRole is stale; fall back to top role if any, else null
      setCurrentRole(topRole);
    }
  }, [topRole, currentRole, assignments]);

  const { data: myBugs } = useQuery({
    queryKey: ["myBugs", user?.userId],
    queryFn: () => customFetch<Bug[]>(`/dashboard/developer/${user!.userId}/bugs`),
    enabled: currentRole === "DEVELOPER" && !!user?.userId,
  });

  const { data: myRuns } = useQuery({
    queryKey: ["testerRuns", user?.userId],
    queryFn: () => customFetch<TesterRun[]>(`/dashboard/tester/${user!.userId}/test-runs`),
    enabled: currentRole === "TESTER" && !!user?.userId,
  });

  const { data: signOffStatus } = useQuery({
    queryKey: ["signOffStatus"],
    queryFn: () => customFetch<{ projectId: number; name: string; signedOff: boolean }[]>("/dashboard/sign-off-status"),
    enabled: currentRole === "BUSINESS_OWNER" || currentRole === "UAT_COORDINATOR",
  });

  useEffect(() => {
    document.title = "Dashboard | TestCaseHub";
  }, []);

  const myOpenBugs = useMemo(
    () => myBugs?.filter(b => b.status !== "CLOSED" && b.status !== "RESOLVED") ?? [],
    [myBugs],
  );
  const myInProgress = useMemo(
    () => myBugs?.filter(b => b.status === "IN_PROGRESS" || b.status === "ASSIGNED") ?? [],
    [myBugs],
  );
  const myResolved = useMemo(
    () => myBugs?.filter(b => b.status === "RESOLVED" || b.status === "CLOSED") ?? [],
    [myBugs],
  );

  const testerRunStats = useMemo(() => {
    if (!myRuns) return null;
    return {
      assigned: myRuns.length,
      completedToday: myRuns.filter(
        (r) => r.status === "completed" && r.updated_at && new Date(r.updated_at).toDateString() === new Date().toDateString(),
      ).length,
      openDefectsFound: 0,
    };
  }, [myRuns]);

  const recentEvents = useMemo(() => {
    const events: Array<{ icon: string; iconBg: string; description: string; timestamp: string; detail: string }> = [];
    activity?.recentExecutions?.forEach((e) => {
      events.push({
        icon: e.overall_result === "passed" ? "check_circle" : "cancel",
        iconBg: e.overall_result === "passed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700",
        description: `Execution #${e.id} ${e.overall_result === "passed" ? "passed" : "failed"} for test case "${e.testCase?.title ?? ""}"`,
        timestamp: e.executed_at ?? new Date().toISOString(),
        detail: e.testRun?.name ?? "",
      });
    });
    activity?.recentDefects?.forEach((d) => {
      events.push({
        icon: "warning",
        iconBg: "bg-amber-100 text-amber-700",
        description: `Defect #${d.id} ${d.status} — ${d.severity ?? ""}`,
        timestamp: d.created_at,
        detail: d.testCase?.title ?? "",
      });
    });
    activity?.recentBugs?.forEach((b) => {
      events.push({
        icon: "bug_report",
        iconBg: "bg-blue-100 text-blue-700",
        description: `Bug #${b.bug_number} ${b.status} — assigned to ${b.developer?.name ?? "unassigned"}`,
        timestamp: b.created_at,
        detail: b.defect?.testCase?.title ?? "",
      });
    });
    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10);
  }, [activity]);

  function timeAgo(dateStr: string) {
    // eslint-disable-next-line react-hooks/purity -- display helper, fine to use Date.now
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

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
      <div className="flex justify-between items-end">
        <div>
          <h1 className="font-display-lg text-display-lg text-primary">Dashboard</h1>
          <p className="font-body-base text-body-base text-on-surface-variant">
            {currentRole === "DEVELOPER" ? "System Health: Stable. Track your assigned bugs." :
             currentRole === "TESTER" ? `Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${user?.username?.split(" ")[0] ?? "Tester"}.` :
             `Welcome back, ${user?.username?.split(" ")[0] ?? "User"}. Here is your operational overview.`}
          </p>
        </div>
        <div className="flex gap-xs bg-surface-container p-xs rounded-lg">
          {(assignments ?? []).slice(0, 4).map((a) => (
            <button
              key={a.id}
              onClick={() => setCurrentRole(a.role)}
              className={`px-md py-xs rounded-md font-label-sm text-label-sm transition-colors ${
                currentRole === a.role ? "bg-surface-container-lowest shadow-sm" : "hover:bg-surface-container-high"
              }`}
            >
              {a.role.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      {/* Stat Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-lg">
        <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
          <div className="flex justify-between items-start mb-md">
            <span className="material-symbols-outlined text-secondary text-3xl">folder_shared</span>
          </div>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {currentRole === "DEVELOPER" ? "My Open Bugs" : currentRole === "TESTER" ? "Assigned Runs" : "Active Projects"}
          </p>
          <h3 className="font-headline-md text-headline-md mt-xs">
            {summaryLoading ? <span className="skeleton inline-block w-16 h-8 rounded" /> :
             currentRole === "DEVELOPER" ? myOpenBugs.length :
             currentRole === "TESTER" ? (testerRunStats?.assigned ?? summary?.totalTestRuns ?? 0) :
             summary?.totalProjects ?? 0}
          </h3>
        </div>
        <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
          <div className="flex justify-between items-start mb-md">
            <span className="material-symbols-outlined text-secondary text-3xl">play_circle</span>
          </div>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {currentRole === "DEVELOPER" ? "My In-Progress" : currentRole === "TESTER" ? "Completed Today" : "Test Runs"}
          </p>
          <h3 className="font-headline-md text-headline-md mt-xs">
            {summaryLoading ? <span className="skeleton inline-block w-16 h-8 rounded" /> :
             currentRole === "DEVELOPER" ? myInProgress.length :
             currentRole === "TESTER" ? (testerRunStats?.completedToday ?? 0) :
             summary?.totalTestRuns ?? 0}
          </h3>
        </div>
        <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
          <div className="flex justify-between items-start mb-md">
            <span className="material-symbols-outlined text-secondary text-3xl">fact_check</span>
          </div>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {currentRole === "DEVELOPER" ? "My Resolved (This Month)" : currentRole === "TESTER" ? "Open Defects Found" : "Test Cases"}
          </p>
          <h3 className="font-headline-md text-headline-md mt-xs">
            {summaryLoading ? <span className="skeleton inline-block w-16 h-8 rounded" /> :
             currentRole === "DEVELOPER" ? myResolved.length :
             currentRole === "TESTER" ? (testerRunStats?.openDefectsFound ?? 0) :
             summary?.totalTestCases ?? 0}
          </h3>
        </div>
        <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
          <div className="flex justify-between items-start mb-md">
            <span className="material-symbols-outlined text-error text-3xl">bug_report</span>
          </div>
          <p className="font-label-md text-label-md text-on-surface-variant">Open Defects</p>
          <h3 className="font-headline-md text-headline-md mt-xs">
            {summaryLoading ? <span className="skeleton inline-block w-16 h-8 rounded" /> : summary?.totalDefects ?? 0}
          </h3>
        </div>
      </div>

      {/* Role-specific content */}
      {currentRole === "DEVELOPER" ? (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div className="p-lg border-b border-outline-variant flex justify-between items-center">
            <h4 className="font-title-sm text-title-sm">My Bug Inbox</h4>
          </div>
          {myBugs && myBugs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-surface-container-low font-label-md text-label-md text-on-surface-variant">
                  <tr>
                    <th className="px-lg py-md">ID</th>
                    <th className="px-lg py-md">Severity</th>
                    <th className="px-lg py-md">Issue Title</th>
                    <th className="px-lg py-md">Project</th>
                    <th className="px-lg py-md">Reported</th>
                    <th className="px-lg py-md">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant font-body-sm text-body-sm">
                  {[...myBugs].sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()).map((bug) => (
                    <tr key={bug.id} className="hover:bg-surface-container-low transition-colors cursor-pointer"
                      onClick={() => navigate(`/projects/${bug.project_id}/bugs`)}
                    >
                      <td className="px-lg py-md font-bold">#{bug.bug_number}</td>
                      <td className="px-lg py-md">
                        <span className={`flex items-center gap-xs font-bold ${severityColors[bug.defect?.severity ?? ""] ?? ""}`}>
                          <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                          {bug.defect?.severity ?? "—"}
                        </span>
                      </td>
                      <td className="px-lg py-md font-medium">{bug.defect?.testCase?.title ?? `Bug #${bug.bug_number}`}</td>
                      <td className="px-lg py-md text-on-surface-variant">{bug.project?.name ?? ""}</td>
                      <td className="px-lg py-md text-on-surface-variant">{timeAgo(bug.opened_at)}</td>
                      <td className="px-lg py-md">
                        <span className={`px-sm py-xs rounded text-xs font-bold ${bugStatusColors[bug.status] ?? ""}`}>
                          {bug.status.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-lg text-center text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl mb-md">bug_report</span>
              <p>No bugs assigned to you yet.</p>
            </div>
          )}
        </div>
      ) : currentRole === "TESTER" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-lg">
          {myRuns && myRuns.length > 0 ? (
            myRuns.map((run) => {
              const total = run.useCases?.length ?? 0;
              const done = run.useCases?.filter((uc) => uc.status !== "pending").length ?? 0;
              const progress = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <div key={run.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
                  <div className="p-lg space-y-md">
                    <div className="flex justify-between">
                      <span className="px-sm py-xs bg-error-container text-error rounded font-label-sm text-label-sm font-bold uppercase tracking-wider">
                        {run.status === "completed" ? "Completed" : run.status === "in_progress" ? "Active" : "Scheduled"}
                      </span>
                      {run.scheduled_at && (
                        <span className="font-label-md text-label-md text-on-surface-variant flex items-center gap-xs">
                          <span className="material-symbols-outlined text-sm">schedule</span>
                          {timeAgo(run.scheduled_at)}
                        </span>
                      )}
                    </div>
                    <div>
                      <h5 className="font-title-sm text-title-sm mb-xs">{run.name}</h5>
                      <p className="font-body-sm text-body-sm text-on-surface-variant">Project: {run.project?.name ?? ""}</p>
                    </div>
                    <div className="space-y-sm">
                      <div className="flex justify-between font-label-sm text-label-sm">
                        <span>Progress</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                        <div className="bg-secondary h-full" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="bg-surface-container-low px-lg py-md border-t border-outline-variant flex justify-between items-center">
                    <span className="font-label-sm text-label-sm text-on-surface-variant">{done}/{total} Cases Executed</span>
                    <button onClick={() => navigate(`/test-runs/${run.id}`)}
                      className="bg-secondary text-on-secondary px-md py-xs rounded-lg font-label-md text-label-md">
                      {run.status === "completed" ? "Review" : "Resume"}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full text-center text-on-surface-variant py-xl">
              <span className="material-symbols-outlined text-4xl mb-md">play_circle</span>
              <p>No test runs assigned yet.</p>
            </div>
          )}
        </div>
      ) : currentRole === "BUSINESS_OWNER" || currentRole === "UAT_COORDINATOR" ? (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div className="p-lg border-b border-outline-variant">
            <h4 className="font-title-sm text-title-sm">Sign-off Status</h4>
          </div>
          {signOffStatus && signOffStatus.length > 0 ? (
            <div className="divide-y divide-outline-variant">
              {signOffStatus.map((p) => (
                <div key={p.projectId} className="px-lg py-md flex items-center justify-between">
                  <span className="font-body-base">{p.name}</span>
                  <span className={`px-sm py-xs rounded text-label-sm font-bold ${p.signedOff ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                    {p.signedOff ? "Signed Off" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-lg text-center text-on-surface-variant">
              <p>No projects available.</p>
            </div>
          )}
        </div>
      ) : null}

      {/* Recent Activity + Quick Links (shown for all roles) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg">
        <div className="xl:col-span-2 bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
          <div className="flex justify-between items-center mb-xl">
            <h4 className="font-title-sm text-title-sm">Recent Activity</h4>
            <button onClick={() => navigate("/projects")} className="text-secondary font-label-md text-label-md">View All</button>
          </div>
          {recentEvents.length > 0 ? (
            <div className="space-y-lg">
              {recentEvents.map((evt, i) => (
                <div key={i} className="flex items-start gap-md pb-lg border-b border-outline-variant last:border-0 last:pb-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${evt.iconBg}`}>
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>{evt.icon}</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-body-base text-body-base">{evt.description}</p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant mt-xs">{timeAgo(evt.timestamp)} • {evt.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-on-surface-variant py-lg">
              <p>No recent activity.</p>
            </div>
          )}
        </div>
        <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant h-fit">
          <h4 className="font-title-sm text-title-sm mb-lg">Quick Links</h4>
          <div className="grid grid-cols-1 gap-sm">
            <button onClick={() => navigate("/projects")} className="flex items-center gap-md p-md bg-surface-container-low hover:bg-surface-container-high rounded-lg transition-colors group text-left">
              <span className="material-symbols-outlined text-secondary">inventory_2</span>
              <span className="font-label-md text-label-md flex-1">All Projects</span>
              <span className="material-symbols-outlined opacity-0 group-hover:opacity-100 transition-opacity">chevron_right</span>
            </button>
            {isAdmin && (
              <button onClick={() => navigate("/users")} className="flex items-center gap-md p-md bg-surface-container-low hover:bg-surface-container-high rounded-lg transition-colors group text-left">
                <span className="material-symbols-outlined text-secondary">people</span>
                <span className="font-label-md text-label-md flex-1">User Management</span>
                <span className="material-symbols-outlined opacity-0 group-hover:opacity-100 transition-opacity">chevron_right</span>
              </button>
            )}
            <button onClick={() => navigate("/tester")} className="flex items-center gap-md p-md bg-surface-container-low hover:bg-surface-container-high rounded-lg transition-colors group text-left">
              <span className="material-symbols-outlined text-secondary">play_circle</span>
              <span className="font-label-md text-label-md flex-1">My Test Runs</span>
              <span className="material-symbols-outlined opacity-0 group-hover:opacity-100 transition-opacity">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
