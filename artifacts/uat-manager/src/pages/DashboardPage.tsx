import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Cell, PieChart, Pie,
} from "recharts";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useAuth } from "../hooks/useAuth";
import type { ProjectAssignment, StatusAuditLog } from "../types/api";
import type {
  RoleOverview, TestLeadOverview, BusinessOverview, DeveloperOverview,
  TesterOverview, AdminOverview, QueueDefectItem, Readiness, SignOffStatusItem,
} from "../types/dashboard";
import { useState, useEffect, useMemo } from "react";
import { KpiCard } from "../components/ui";

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ef4444",
  Major: "#f97316",
  High: "#f97316",
  Minor: "#fbbf24",
  Cosmetic: "#94a3b8",
  Unspecified: "#94a3b8",
};

const AGE_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444"];

const READINESS_STYLE: Record<Readiness, { label: string; className: string; icon: string }> = {
  ready: { label: "Ready", className: "bg-green-100 text-green-800 border-green-200", icon: "check_circle" },
  at_risk: { label: "At Risk", className: "bg-amber-100 text-amber-800 border-amber-200", icon: "warning" },
  not_ready: { label: "Not Ready", className: "bg-red-100 text-red-800 border-red-200", icon: "cancel" },
};

const defectStatusColors: Record<string, string> = {
  NEW: "bg-red-100 text-red-700",
  TRIAGED: "bg-amber-100 text-amber-700",
  ASSIGNED: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  RESOLVED_DEV: "bg-green-100 text-green-700",
  QA_PASSED: "bg-teal-100 text-teal-700",
  READY_FOR_VERIFICATION: "bg-purple-100 text-purple-700",
  REGRESSED: "bg-red-100 text-red-700",
  CLOSED: "bg-surface-container-high text-on-surface-variant",
  PASSED_BY_AGREEMENT: "bg-green-100 text-green-700",
  PENDING_BIZ_ACCEPTANCE: "bg-orange-100 text-orange-800",
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
interface AuditLogEntry extends StatusAuditLog {
  changedBy?: { id: number; username: string; email: string; role: string };
}
interface ActivityResponse {
  recentExecutions?: RecentExecution[];
  recentDefects?: RecentDefect[];
  auditLogs?: AuditLogEntry[];
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function uniqueRoles(assignments: ProjectAssignment[] | undefined): string[] {
  if (!assignments?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of assignments) {
    if (!seen.has(a.role)) {
      seen.add(a.role);
      out.push(a.role);
    }
  }
  return out;
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

/** Projects this user holds a given project role on (from memberships). */
function projectsForRole(
  assignments: ProjectAssignment[] | undefined,
  role: string,
): Array<{ id: number; name: string; code?: string }> {
  if (!assignments?.length) return [];
  const map = new Map<number, { id: number; name: string; code?: string }>();
  for (const a of assignments) {
    if (a.role !== role) continue;
    const id = a.project_id;
    const name = a.project?.name ?? `Project #${id}`;
    const code = a.project?.project_code;
    if (!map.has(id)) map.set(id, { id, name, code });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function RoleScopeBanner({
  role,
  projects,
  navigate,
}: {
  role: string;
  projects: Array<{ id: number; name: string; code?: string }>;
  navigate: (p: string) => void;
}) {
  if (role === "ADMIN") {
    return (
      <div className="rounded-xl border border-secondary/30 bg-secondary-container/40 px-md py-sm flex flex-wrap items-start gap-sm">
        <span className="material-symbols-outlined text-secondary text-[20px] mt-0.5">public</span>
        <div className="min-w-0 flex-1">
          <p className="font-label-md text-label-md text-on-surface">Scope: entire system</p>
          <p className="text-label-sm text-on-surface-variant mt-0.5">
            Admin metrics cover all projects and users — not limited to a project role assignment.
          </p>
        </div>
      </div>
    );
  }

  const label = roleLabel(role);
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-md py-sm flex flex-wrap items-start gap-sm">
        <span className="material-symbols-outlined text-amber-700 text-[20px] mt-0.5">info</span>
        <div className="min-w-0 flex-1">
          <p className="font-label-md text-label-md text-amber-900">No projects in scope for {label}</p>
          <p className="text-label-sm text-amber-800/90 mt-0.5">
            You are not assigned as {label} on any project. This tab should disappear after your memberships refresh.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm space-y-sm">
      <div className="flex flex-wrap items-start gap-sm">
        <span className="material-symbols-outlined text-secondary text-[20px] mt-0.5">filter_alt</span>
        <div className="min-w-0 flex-1">
          <p className="font-label-md text-label-md text-on-surface">
            Scope: your {label} projects only ({projects.length})
          </p>
          <p className="text-label-sm text-on-surface-variant mt-0.5">
            KPIs and queues below are rolled up across these projects — not the whole portfolio.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-xs pl-0 sm:pl-7">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => navigate(`/projects/${p.id}`)}
            className="inline-flex items-center gap-1 max-w-full px-sm py-0.5 rounded-full bg-surface-container-high border border-outline-variant text-label-sm text-on-surface hover:bg-secondary-container hover:border-secondary/40 transition-colors"
            title={p.name}
          >
            <span className="material-symbols-outlined text-[14px] text-secondary">folder</span>
            <span className="truncate max-w-[14rem]">
              {p.code ? `[${p.code}] ` : ""}
              {p.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReadinessBadge({ readiness }: { readiness: Readiness }) {
  const s = READINESS_STYLE[readiness];
  return (
    <span className={`inline-flex items-center gap-xs px-sm py-xs rounded-lg border text-label-sm font-bold ${s.className}`}>
      <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>{s.icon}</span>
      {s.label}
    </span>
  );
}

function SectionCard({
  title, action, children, empty, emptyIcon = "inbox", emptyCta, onEmptyCta,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  empty?: boolean;
  emptyIcon?: string;
  emptyCta?: string;
  onEmptyCta?: () => void;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
      <div className="p-lg border-b border-outline-variant flex justify-between items-center gap-md">
        <h4 className="font-title-sm text-title-sm">{title}</h4>
        {action}
      </div>
      {empty ? (
        <div className="p-xl text-center text-on-surface-variant">
          <span className="material-symbols-outlined text-4xl mb-sm block opacity-50">{emptyIcon}</span>
          <p className="font-body-sm mb-md">Nothing here right now.</p>
          {emptyCta && onEmptyCta && (
            <button onClick={onEmptyCta} className="text-secondary font-label-md text-label-md hover:underline">
              {emptyCta}
            </button>
          )}
        </div>
      ) : children}
    </div>
  );
}

function DefectQueueTable({
  items, onRow, showAge = true,
}: {
  items: QueueDefectItem[];
  onRow: (d: QueueDefectItem) => void;
  showAge?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="bg-surface-container-low font-label-md text-label-md text-on-surface-variant">
          <tr>
            <th className="px-lg py-md">ID</th>
            <th className="px-lg py-md">Severity</th>
            <th className="px-lg py-md">Issue</th>
            <th className="px-lg py-md">Project</th>
            {showAge && <th className="px-lg py-md">Age</th>}
            <th className="px-lg py-md">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant font-body-sm text-body-sm">
          {items.map((d) => (
            <tr
              key={d.id}
              className="hover:bg-surface-container-low transition-colors cursor-pointer"
              onClick={() => onRow(d)}
            >
              <td className="px-lg py-md font-bold">#{d.id}</td>
              <td className="px-lg py-md">
                <span className="font-bold" style={{ color: SEVERITY_COLORS[d.severity ?? ""] ?? undefined }}>
                  {d.severity ?? "—"}
                </span>
              </td>
              <td className="px-lg py-md font-medium max-w-[220px] truncate">{d.title}</td>
              <td className="px-lg py-md text-on-surface-variant">{d.projectName}</td>
              {showAge && (
                <td className="px-lg py-md text-on-surface-variant">{d.ageDays}d</td>
              )}
              <td className="px-lg py-md">
                <span className={`px-sm py-xs rounded text-xs font-bold ${defectStatusColors[d.status] ?? "bg-surface-container-high"}`}>
                  {d.status.replace(/_/g, " ")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuickLinks({
  role, isAdmin, navigate,
}: {
  role: string | null;
  isAdmin: boolean;
  navigate: (path: string) => void;
}) {
  const links: { icon: string; label: string; href: string; show?: boolean }[] = [
    { icon: "inventory_2", label: "All Projects", href: "/projects" },
    { icon: "people", label: "User Management", href: "/users", show: isAdmin },
    { icon: "play_circle", label: "My Test Runs", href: "/tester", show: role === "TESTER" || !role },
    { icon: "bug_report", label: "Open Projects", href: "/projects", show: role === "DEVELOPER" || role === "TEST_LEAD" },
    { icon: "verified", label: "Sign-off", href: "/projects", show: role === "BUSINESS_OWNER" || role === "UAT_COORDINATOR" || role === "TEST_LEAD" },
  ];

  return (
    <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant h-fit">
      <h4 className="font-title-sm text-title-sm mb-lg">Shortcuts</h4>
      <div className="grid grid-cols-1 gap-sm">
        {links.filter((l) => l.show !== false).map((l) => (
          <button
            key={l.label}
            onClick={() => navigate(l.href)}
            className="flex items-center gap-md p-md bg-surface-container-low hover:bg-surface-container-high rounded-lg transition-colors group text-left"
          >
            <span className="material-symbols-outlined text-secondary">{l.icon}</span>
            <span className="font-label-md text-label-md flex-1">{l.label}</span>
            <span className="material-symbols-outlined opacity-0 group-hover:opacity-100 transition-opacity">chevron_right</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Role panels ─── */

function TestLeadPanel({
  data,
  navigate,
  scopedProjects,
}: {
  data: TestLeadOverview;
  navigate: (p: string) => void;
  scopedProjects: Array<{ id: number; name: string; code?: string }>;
}) {
  const chartData = data.progressByProject
    .filter((p) => p.total > 0)
    .slice(0, 8)
    .map((p) => ({
      name: p.name.length > 18 ? p.name.slice(0, 16) + "…" : p.name,
      fullName: p.name,
      projectId: p.projectId,
      Done: p.done,
      "In progress": p.inProgress,
      "Not started": p.notStarted,
    }));

  const goDefect = (d: QueueDefectItem) => navigate(`/projects/${d.projectId}/defects`);

  return (
    <div className="space-y-lg">
      <RoleScopeBanner role="TEST_LEAD" projects={scopedProjects} navigate={navigate} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-md">
        <KpiCard
          icon="trending_up"
          label="Execution"
          value={`${data.kpis.executionProgress}%`}
          hint={`${data.kpis.doneScenarios}/${data.kpis.totalScenarios} scenarios`}
          tone={data.kpis.executionProgress >= 80 ? "success" : data.kpis.executionProgress >= 50 ? "warning" : "danger"}
          onClick={() => navigate("/projects")}
        />
        <KpiCard
          icon="verified"
          label="Pass Rate"
          value={data.kpis.passRate != null ? `${data.kpis.passRate}%` : "—"}
          hint="Of executed scenarios"
          tone={data.kpis.passRate == null ? "default" : data.kpis.passRate >= 85 ? "success" : "warning"}
        />
        <KpiCard
          icon="priority_high"
          label="Triage Backlog"
          value={data.kpis.triageBacklog}
          hint="NEW defects"
          tone={data.kpis.triageBacklog > 0 ? "danger" : "success"}
          onClick={() => document.getElementById("tl-triage")?.scrollIntoView({ behavior: "smooth" })}
        />
        <KpiCard
          icon="report"
          label="Blocked / Critical"
          value={data.kpis.blockedOrCritical}
          hint="Needs attention"
          tone={data.kpis.blockedOrCritical > 0 ? "warning" : "success"}
        />
        <KpiCard
          icon="flag"
          label="UAT Readiness"
          value={<ReadinessBadge readiness={data.kpis.readiness} />}
          hint={data.kpis.readinessReasons[0] ?? ""}
          tone={data.kpis.readiness === "ready" ? "success" : data.kpis.readiness === "at_risk" ? "warning" : "danger"}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-lg">
        <SectionCard title="Execution by project" empty={chartData.length === 0} emptyIcon="bar_chart" emptyCta="View projects" onEmptyCta={() => navigate("/projects")}>
          <div className="p-md h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={((value) => Number(value ?? 0)) as any}
                  labelFormatter={(_, payload) => (payload?.[0]?.payload as { fullName?: string })?.fullName ?? ""}
                />
                <Legend />
                <Bar dataKey="Done" stackId="a" fill="#22c55e" cursor="pointer" onClick={(e) => {
                  const id = (e as unknown as { projectId?: number }).projectId;
                  if (id) navigate(`/projects/${id}/test-runs`);
                }} />
                <Bar dataKey="In progress" stackId="a" fill="#3b82f6" cursor="pointer" onClick={(e) => {
                  const id = (e as unknown as { projectId?: number }).projectId;
                  if (id) navigate(`/projects/${id}/test-runs`);
                }} />
                <Bar dataKey="Not started" stackId="a" fill="#e2e8f0" cursor="pointer" onClick={(e) => {
                  const id = (e as unknown as { projectId?: number }).projectId;
                  if (id) navigate(`/projects/${id}/test-runs`);
                }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="At-risk runs"
          empty={!data.atRiskRuns?.length}
          emptyIcon="health_and_safety"
          emptyCta="All runs look healthy"
        >
          <ul className="divide-y divide-outline-variant">
            {(data.atRiskRuns ?? []).map((r) => (
              <li
                key={r.id}
                className="px-lg py-md flex items-center justify-between gap-md cursor-pointer hover:bg-surface-container-low"
                onClick={() => navigate(`/test-runs/${r.id}`)}
              >
                <div className="min-w-0">
                  <p className="font-label-md text-label-md truncate">{r.name}</p>
                  <p className="text-label-sm text-on-surface-variant">{r.projectName} · {r.progressPct}%</p>
                </div>
                <span className="shrink-0 px-sm py-xs rounded bg-amber-100 text-amber-800 text-xs font-bold">{r.reason}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-lg" id="tl-triage">
        <SectionCard title="Triage now" empty={!data.triageQueue.length} emptyIcon="done_all" emptyCta="No NEW defects">
          <DefectQueueTable items={data.triageQueue} onRow={goDefect} />
        </SectionCard>
        <SectionCard title="Needs retest / verification" empty={!data.retestQueue.length} emptyIcon="replay">
          <DefectQueueTable items={data.retestQueue} onRow={goDefect} />
        </SectionCard>
      </div>
    </div>
  );
}

function BusinessOwnerPanel({
  data,
  navigate,
  scopedProjects,
}: {
  data: BusinessOverview;
  navigate: (p: string) => void;
  scopedProjects: Array<{ id: number; name: string; code?: string }>;
}) {
  const chartData = data.projectReadiness.map((p) => ({
    name: p.name.length > 16 ? p.name.slice(0, 14) + "…" : p.name,
    fullName: p.name,
    projectId: p.projectId,
    value: p.readiness === "ready" ? 3 : p.readiness === "at_risk" ? 2 : 1,
    readiness: p.readiness,
    executionPct: p.executionPct,
  }));

  const readinessColor = (r: Readiness) =>
    r === "ready" ? "#22c55e" : r === "at_risk" ? "#f59e0b" : "#ef4444";

  return (
    <div className="space-y-lg">
      <RoleScopeBanner role="BUSINESS_OWNER" projects={scopedProjects} navigate={navigate} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-md">
        <KpiCard
          icon="flag"
          label="Acceptance readiness"
          value={<ReadinessBadge readiness={data.kpis.readiness} />}
          hint={data.kpis.readinessReasons[0] ?? ""}
          tone={data.kpis.readiness === "ready" ? "success" : data.kpis.readiness === "at_risk" ? "warning" : "danger"}
        />
        <KpiCard
          icon="error"
          label="Critical open"
          value={data.kpis.criticalOpen}
          hint="Business-blocking issues"
          tone={data.kpis.criticalOpen > 0 ? "danger" : "success"}
          onClick={() => document.getElementById("bo-risk")?.scrollIntoView({ behavior: "smooth" })}
        />
        <KpiCard
          icon="task_alt"
          label="UAT completion"
          value={`${data.kpis.uatCompletion}%`}
          hint="Scenarios done"
          tone={data.kpis.uatCompletion >= 95 ? "success" : data.kpis.uatCompletion >= 80 ? "warning" : "danger"}
        />
        <KpiCard
          icon="pending_actions"
          label="Pending my decision"
          value={data.kpis.pendingMyDecision}
          hint="Acceptance or sign-off"
          tone={data.kpis.pendingMyDecision > 0 ? "warning" : "success"}
          onClick={() => document.getElementById("bo-decisions")?.scrollIntoView({ behavior: "smooth" })}
        />
        <KpiCard
          icon="verified"
          label="Signed off"
          value={`${data.kpis.signedOffCount}/${data.kpis.totalProjects}`}
          hint="Projects fully signed"
          tone="info"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-lg">
        <SectionCard title="Readiness by project" empty={!chartData.length} emptyIcon="analytics" emptyCta="View projects" onEmptyCta={() => navigate("/projects")}>
          <div className="p-md h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 3]} ticks={[1, 2, 3]} tickFormatter={(v) => (v === 3 ? "Ready" : v === 2 ? "Risk" : "No")} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const p = payload[0].payload as typeof chartData[0];
                    return (
                      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-sm shadow-md text-label-sm">
                        <p className="font-bold">{p.fullName}</p>
                        <p>Status: {READINESS_STYLE[p.readiness as Readiness].label}</p>
                        <p>Execution: {p.executionPct}%</p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="value"
                  radius={[6, 6, 0, 0]}
                  cursor="pointer"
                  onClick={(e) => {
                    const id = (e as unknown as { projectId?: number }).projectId;
                    if (id) navigate(`/projects/${id}/uat-summary`);
                  }}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.projectId} fill={readinessColor(entry.readiness as Readiness)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Sign-off status" empty={!data.projectReadiness.length}>
          <ul className="divide-y divide-outline-variant">
            {data.projectReadiness.map((p) => (
              <li
                key={p.projectId}
                className="px-lg py-md flex flex-col sm:flex-row sm:items-center justify-between gap-sm cursor-pointer hover:bg-surface-container-low"
                onClick={() => navigate(`/projects/${p.projectId}/sign-off`)}
              >
                <div className="min-w-0">
                  <p className="font-label-md text-label-md">{p.name}</p>
                  <p className="text-label-sm text-on-surface-variant">
                    TL {p.testLeadSigned ? "✓" : "—"} · BO {p.businessOwnerSigned ? "✓" : "—"} · {p.executionPct}% done
                  </p>
                  {p.reasons[0] && !p.signedOff && (
                    <p className="text-label-sm text-on-surface-variant mt-xs">{p.reasons[0]}</p>
                  )}
                </div>
                <ReadinessBadge readiness={p.readiness} />
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-lg" id="bo-decisions">
        <SectionCard title="Decisions needed" empty={!data.decisionsNeeded.length} emptyIcon="thumb_up">
          <DefectQueueTable
            items={data.decisionsNeeded}
            onRow={(d) => navigate(`/projects/${d.projectId}/defects`)}
          />
        </SectionCard>
        <div id="bo-risk">
          <SectionCard title="Residual risk" empty={!data.residualRisk.length} emptyIcon="shield">
            <DefectQueueTable
              items={data.residualRisk}
              onRow={(d) => navigate(`/projects/${d.projectId}/defects`)}
            />
          </SectionCard>
        </div>
      </div>

      {data.pendingSignOff.length > 0 && (
        <SectionCard title="Ready for your sign-off">
          <ul className="divide-y divide-outline-variant">
            {data.pendingSignOff.map((p) => (
              <li
                key={p.projectId}
                className="px-lg py-md flex items-center justify-between cursor-pointer hover:bg-surface-container-low"
                onClick={() => navigate(`/projects/${p.projectId}/sign-off`)}
              >
                <span className="font-label-md">{p.name}</span>
                <button className="bg-secondary text-on-secondary px-md py-xs rounded-lg font-label-md text-label-sm">
                  Sign off
                </button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

function DeveloperPanel({
  data,
  navigate,
  scopedProjects,
}: {
  data: DeveloperOverview;
  navigate: (p: string) => void;
  scopedProjects: Array<{ id: number; name: string; code?: string }>;
}) {
  const [chartMode, setChartMode] = useState<"severity" | "age">("severity");

  const severityData = Object.entries(data.bySeverity).map(([name, value]) => ({ name, value }));
  const ageData = Object.entries(data.ageBuckets).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-lg">
      <RoleScopeBanner role="DEVELOPER" projects={scopedProjects} navigate={navigate} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-md">
        <KpiCard icon="bug_report" label="My open" value={data.kpis.myOpen} tone={data.kpis.myOpen > 0 ? "info" : "success"}
          onClick={() => document.getElementById("dev-inbox")?.scrollIntoView({ behavior: "smooth" })} />
        <KpiCard icon="engineering" label="In progress" value={data.kpis.inProgress} tone="info" />
        <KpiCard icon="hourglass_top" label="Awaiting QA / retest" value={data.kpis.awaitingQa} tone={data.kpis.awaitingQa > 0 ? "warning" : "default"} />
        <KpiCard icon="schedule" label="Aging (>7d)" value={data.kpis.aging} tone={data.kpis.aging > 0 ? "danger" : "success"}
          onClick={() => setChartMode("age")} />
        <KpiCard icon="task_alt" label="Resolved this month" value={data.kpis.resolvedThisMonth} tone="success" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg">
        <SectionCard
          title={chartMode === "severity" ? "Open by severity" : "Open by age"}
          action={
            <div className="flex gap-xs bg-surface-container p-xs rounded-lg">
              <button
                onClick={() => setChartMode("severity")}
                className={`px-sm py-xs rounded text-label-sm font-bold ${chartMode === "severity" ? "bg-surface-container-lowest shadow-sm" : ""}`}
              >
                Severity
              </button>
              <button
                onClick={() => setChartMode("age")}
                className={`px-sm py-xs rounded text-label-sm font-bold ${chartMode === "age" ? "bg-surface-container-lowest shadow-sm" : ""}`}
              >
                Age
              </button>
            </div>
          }
          empty={(chartMode === "severity" ? severityData : ageData).length === 0}
          emptyIcon="celebration"
        >
          <div className="p-md h-64">
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === "severity" ? (
                <BarChart data={severityData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {severityData.map((e) => (
                      <Cell key={e.name} fill={SEVERITY_COLORS[e.name] ?? "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <BarChart data={ageData} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {ageData.map((e, i) => (
                      <Cell key={e.name} fill={AGE_COLORS[i % AGE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <div className="xl:col-span-2 space-y-lg" id="dev-inbox">
          <SectionCard title="My defect inbox" empty={!data.inbox.length} emptyIcon="inbox" emptyCta="No assigned defects">
            <DefectQueueTable
              items={data.inbox}
              onRow={(d) => navigate(`/projects/${d.projectId}/defects`)}
            />
          </SectionCard>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-lg">
        <SectionCard title="Blocked" empty={!data.blockedQueue.length} emptyIcon="lock_open">
          <DefectQueueTable
            items={data.blockedQueue}
            onRow={(d) => navigate(`/projects/${d.projectId}/defects`)}
          />
        </SectionCard>
        <SectionCard title="Returned / regressed" empty={!data.returnedQueue.length} emptyIcon="replay">
          <DefectQueueTable
            items={data.returnedQueue}
            onRow={(d) => navigate(`/projects/${d.projectId}/defects`)}
          />
        </SectionCard>
      </div>
    </div>
  );
}

function TesterHomePanel({
  data,
  navigate,
  scopedProjects,
}: {
  data: TesterOverview;
  navigate: (p: string) => void;
  scopedProjects: Array<{ id: number; name: string; code?: string }>;
}) {
  const pieData = [
    { name: "To do", value: data.todayProgress.todo, color: "#94a3b8" },
    { name: "In progress", value: data.todayProgress.inProgress, color: "#f59e0b" },
    { name: "Done", value: data.todayProgress.done, color: "#22c55e" },
  ].filter((d) => d.value > 0);

  const total = data.todayProgress.todo + data.todayProgress.inProgress + data.todayProgress.done;

  return (
    <div className="space-y-lg">
      <RoleScopeBanner role="TESTER" projects={scopedProjects} navigate={navigate} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-md">
        <KpiCard icon="today" label="Due / active" value={data.kpis.dueToday} tone="info" onClick={() => navigate("/tester")} />
        <KpiCard icon="pending_actions" label="My remaining" value={data.kpis.myRemaining} tone={data.kpis.myRemaining > 0 ? "warning" : "success"} />
        <KpiCard icon="task_alt" label="Completed today" value={data.kpis.completedToday} tone="success" />
        <KpiCard
          icon="percent"
          label="My pass rate"
          value={data.kpis.passRate != null ? `${data.kpis.passRate}%` : "—"}
          hint="Your recorded steps"
          tone={data.kpis.passRate != null && data.kpis.passRate < 70 ? "warning" : "default"}
        />
        <KpiCard icon="bug_report" label="Defects I found (open)" value={data.kpis.openDefectsFound} tone={data.kpis.openDefectsFound > 0 ? "info" : "default"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg">
        <SectionCard title="My progress" empty={total === 0} emptyIcon="play_circle" emptyCta="Open My Runs" onEmptyCta={() => navigate("/tester")}>
          <div className="p-md h-56 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75} paddingAngle={2}>
                  {pieData.map((e) => (
                    <Cell key={e.name} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Continue" empty={!data.continueQueue.length} emptyIcon="play_arrow" emptyCta="Nothing in progress">
          <ul className="divide-y divide-outline-variant">
            {data.continueQueue.map((s) => (
              <li
                key={s.trucId}
                className="px-lg py-md cursor-pointer hover:bg-surface-container-low"
                onClick={() => navigate(`/tester/run/${s.runId}`)}
              >
                <p className="font-label-md text-label-md">{s.scenarioCode} · {s.scenarioName}</p>
                <p className="text-label-sm text-on-surface-variant">{s.projectName} · {s.runName}</p>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Up next" empty={!data.upNext.length} emptyIcon="upcoming">
          <ul className="divide-y divide-outline-variant">
            {data.upNext.map((s) => (
              <li
                key={s.trucId}
                className="px-lg py-md cursor-pointer hover:bg-surface-container-low"
                onClick={() => navigate(`/tester/run/${s.runId}`)}
              >
                <p className="font-label-md text-label-md">{s.scenarioCode} · {s.scenarioName}</p>
                <p className="text-label-sm text-on-surface-variant">{s.projectName} · {s.runName}</p>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      {data.retestQueue.length > 0 && (
        <SectionCard title="Retest / verification">
          <DefectQueueTable
            items={data.retestQueue}
            onRow={(d) => navigate(d.runId ? `/tester/run/${d.runId}` : `/projects/${d.projectId}/defects`)}
          />
        </SectionCard>
      )}

      <div className="flex justify-center">
        <button
          onClick={() => navigate("/tester")}
          className="inline-flex items-center gap-sm bg-primary text-on-primary px-lg py-md rounded-xl font-label-md hover:opacity-90"
        >
          Open full My Runs workspace
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
      </div>
    </div>
  );
}

function AdminPanel({ data, navigate }: { data: AdminOverview; navigate: (p: string) => void }) {
  const severityData = Object.entries(data.openBySeverity)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const statusData = Object.entries(data.openByStatus)
    .map(([name, value]) => ({ name: name.replace(/_/g, " "), value, raw: name }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return (
    <div className="space-y-lg">
      <RoleScopeBanner role="ADMIN" projects={[]} navigate={navigate} />
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-md">
        <KpiCard
          icon="folder"
          label="Projects"
          value={data.kpis.totalProjects}
          hint={`${data.kpis.activeRuns} active run${data.kpis.activeRuns === 1 ? "" : "s"}`}
          onClick={() => navigate("/projects")}
        />
        <KpiCard
          icon="group"
          label="Active users"
          value={data.kpis.activeUsers}
          hint={`${data.kpis.inactiveUsers} inactive · ${data.kpis.adminUsers} admin`}
          onClick={() => navigate("/users")}
        />
        <KpiCard
          icon="bug_report"
          label="Open defects"
          value={data.kpis.openDefects}
          hint={`${data.kpis.newDefects} NEW · ${data.kpis.criticalOpen} Critical`}
          tone={data.kpis.openDefects > 0 ? (data.kpis.criticalOpen > 0 ? "danger" : "warning") : "success"}
          onClick={() => document.getElementById("admin-aging")?.scrollIntoView({ behavior: "smooth" })}
        />
        <KpiCard
          icon="health_and_safety"
          label="Portfolio risk"
          value={data.kpis.projectsWithoutLead + data.kpis.stalledRuns + data.kpis.incompleteSignOff}
          hint={`${data.kpis.projectsWithoutLead} no lead · ${data.kpis.stalledRuns} stalled · ${data.kpis.incompleteSignOff} unsigned`}
          tone={
            data.kpis.projectsWithoutLead + data.kpis.stalledRuns + data.kpis.incompleteSignOff > 0
              ? "warning"
              : "success"
          }
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-lg">
        <SectionCard
          title="Open defects by severity"
          empty={severityData.length === 0}
          emptyIcon="pie_chart"
          emptyCta="View projects"
          onEmptyCta={() => navigate("/projects")}
        >
          <div className="p-md h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={severityData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {severityData.map((entry) => (
                    <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] ?? "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="Open defects by status"
          empty={statusData.length === 0}
          emptyIcon="bar_chart"
        >
          <div className="p-md h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} name="Defects" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-lg">
        <SectionCard
          title="Governance — needs attention"
          empty={
            data.projectsWithoutLead.length === 0 &&
            data.projectsWithNoTeam.length === 0 &&
            data.incompleteSignOff.length === 0
          }
          emptyIcon="verified_user"
          emptyCta="All clear — open projects"
          onEmptyCta={() => navigate("/projects")}
        >
          <div className="divide-y divide-outline-variant">
            {data.projectsWithoutLead.map((p) => (
              <button
                key={`lead-${p.projectId}`}
                type="button"
                onClick={() => navigate(`/projects/${p.projectId}`)}
                className="w-full text-left px-md py-sm hover:bg-surface-container-low flex items-start gap-sm"
              >
                <span className="material-symbols-outlined text-amber-600 text-[20px] mt-0.5">person_off</span>
                <div className="min-w-0 flex-1">
                  <p className="font-label-md text-on-surface truncate">{p.name}</p>
                  <p className="text-label-sm text-on-surface-variant">No Test Lead assigned</p>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant text-[18px]">chevron_right</span>
              </button>
            ))}
            {data.projectsWithNoTeam.map((p) => (
              <button
                key={`team-${p.projectId}`}
                type="button"
                onClick={() => navigate(`/projects/${p.projectId}`)}
                className="w-full text-left px-md py-sm hover:bg-surface-container-low flex items-start gap-sm"
              >
                <span className="material-symbols-outlined text-blue-600 text-[20px] mt-0.5">group_off</span>
                <div className="min-w-0 flex-1">
                  <p className="font-label-md text-on-surface truncate">{p.name}</p>
                  <p className="text-label-sm text-on-surface-variant">No team members assigned</p>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant text-[18px]">chevron_right</span>
              </button>
            ))}
            {data.incompleteSignOff.map((p) => (
              <button
                key={`so-${p.projectId}`}
                type="button"
                onClick={() => navigate(`/projects/${p.projectId}/sign-off`)}
                className="w-full text-left px-md py-sm hover:bg-surface-container-low flex items-start gap-sm"
              >
                <span className="material-symbols-outlined text-purple-600 text-[20px] mt-0.5">draw</span>
                <div className="min-w-0 flex-1">
                  <p className="font-label-md text-on-surface truncate">{p.name}</p>
                  <p className="text-label-sm text-on-surface-variant">
                    Sign-off incomplete
                    {!p.testLeadSigned ? " · Test Lead pending" : ""}
                    {!p.businessOwnerSigned ? " · Business Owner pending" : ""}
                    {p.testLeadName ? ` · Lead: ${p.testLeadName}` : ""}
                  </p>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant text-[18px]">chevron_right</span>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="At-risk / stalled runs"
          empty={data.atRiskRuns.length === 0}
          emptyIcon="schedule"
          emptyCta="View projects"
          onEmptyCta={() => navigate("/projects")}
        >
          <div className="divide-y divide-outline-variant">
            {data.atRiskRuns.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/projects/${r.projectId}/test-runs`)}
                className="w-full text-left px-md py-sm hover:bg-surface-container-low flex items-start gap-sm"
              >
                <span className="material-symbols-outlined text-red-600 text-[20px] mt-0.5">timelapse</span>
                <div className="min-w-0 flex-1">
                  <p className="font-label-md text-on-surface truncate">{r.name}</p>
                  <p className="text-label-sm text-on-surface-variant">
                    {r.projectName} · {r.reason}
                  </p>
                </div>
                <span className="text-label-sm font-bold text-on-surface-variant shrink-0">{r.status}</span>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <div id="admin-aging">
        <SectionCard
          title="Aging / high-priority open defects"
          empty={data.agingDefects.length === 0}
          emptyIcon="bug_report"
          emptyCta="No aging defects"
        >
          <DefectQueueTable
            items={data.agingDefects}
            onRow={(d) => navigate(`/projects/${d.projectId}/defects`)}
          />
        </SectionCard>
      </div>

      <div className="flex flex-wrap gap-sm justify-center">
        <button
          type="button"
          onClick={() => navigate("/projects")}
          className="inline-flex items-center gap-xs bg-primary text-on-primary px-lg py-sm rounded-lg font-label-md hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[18px]">folder</span>
          Manage projects
        </button>
        <button
          type="button"
          onClick={() => navigate("/users")}
          className="inline-flex items-center gap-xs bg-surface-container-high text-on-surface px-lg py-sm rounded-lg font-label-md hover:bg-surface-container"
        >
          <span className="material-symbols-outlined text-[18px]">group</span>
          Manage users
        </button>
      </div>
    </div>
  );
}

function GenericPanel({
  navigate, isAdmin,
}: {
  navigate: (p: string) => void;
  isAdmin: boolean;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-xl text-center">
      <span className="material-symbols-outlined text-5xl text-secondary mb-md">dashboard</span>
      <h3 className="font-title-md text-title-md mb-sm">Operational overview</h3>
      <p className="text-on-surface-variant font-body-sm mb-lg max-w-md mx-auto">
        Select a project role above for role-specific KPIs, or open projects to continue.
      </p>
      <div className="flex flex-wrap gap-sm justify-center">
        <button onClick={() => navigate("/projects")} className="bg-primary text-on-primary px-md py-sm rounded-lg font-label-md">
          Projects
        </button>
        {isAdmin && (
          <button onClick={() => navigate("/users")} className="bg-surface-container-high px-md py-sm rounded-lg font-label-md">
            Users
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Main page ─── */

export function DashboardPage() {
  const user = getStoredUser();
  const { isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  const { data: assignments } = useQuery({
    queryKey: ["userProjects", user?.userId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/users/${user!.userId}/projects`),
    enabled: !!user?.userId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const roles = useMemo(() => {
    const r = uniqueRoles(assignments);
    if (isAdmin && !r.includes("ADMIN")) r.unshift("ADMIN");
    return r;
  }, [assignments, isAdmin]);

  const topRole = roles[0] ?? (isAdmin ? "ADMIN" : null);

  const scopedProjects = useMemo(() => {
    if (!currentRole || currentRole === "ADMIN") return [];
    if (currentRole === "BUSINESS_OWNER" || currentRole === "UAT_COORDINATOR") {
      const bo = projectsForRole(assignments, "BUSINESS_OWNER");
      const uc = projectsForRole(assignments, "UAT_COORDINATOR");
      const map = new Map<number, { id: number; name: string; code?: string }>();
      for (const p of [...bo, ...uc]) map.set(p.id, p);
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    return projectsForRole(assignments, currentRole);
  }, [assignments, currentRole]);

  useEffect(() => {
    if (!currentRole && topRole) setCurrentRole(topRole);
    else if (currentRole && roles.length && !roles.includes(currentRole)) setCurrentRole(topRole);
  }, [topRole, currentRole, roles]);

  // Testers: land on My Runs as primary home
  useEffect(() => {
    if (currentRole === "TESTER" && roles.length === 1) {
      navigate("/tester", { replace: true });
    }
  }, [currentRole, roles, navigate]);

  const { data: overview, isLoading, error, refetch } = useQuery({
    queryKey: ["roleOverview", currentRole, user?.userId],
    queryFn: () => customFetch<RoleOverview>(`/dashboard/role-overview?role=${currentRole}`),
    enabled: !!currentRole,
  });

  const { data: activity } = useQuery({
    queryKey: ["recentActivity", currentRole],
    queryFn: () => customFetch<ActivityResponse>(`/dashboard/recent-activity?role=${currentRole}`),
    enabled: !!currentRole,
  });

  // Prefetch sign-off for BO (overview already includes it)
  useQuery({
    queryKey: ["signOffStatus", currentRole],
    queryFn: () => customFetch<SignOffStatusItem[]>("/dashboard/sign-off-status?role=" + currentRole),
    enabled: currentRole === "BUSINESS_OWNER" || currentRole === "UAT_COORDINATOR",
  });

  useEffect(() => {
    document.title = "Dashboard | TestCaseHub";
  }, []);

  const recentEvents = useMemo(() => {
    const events: Array<{ icon: string; iconBg: string; description: string; timestamp: string; detail: string }> = [];
    activity?.auditLogs?.forEach((l) => {
      const action = l.to_status === "created" ? "created" : l.to_status === "deleted" ? "deleted" : l.to_status === "updated" ? "updated" : l.to_status ?? "updated";
      const entityMap: Record<string, string> = {
        user: "User", project: "Project", test_run: "Test Run", execution: "Execution",
        defect: "Defect", test_scenario: "Scenario", test_case: "Test Case",
      };
      const entity = entityMap[l.entity_type] ?? l.entity_type;
      const by = l.changedBy?.username ?? "system";
      let icon = "info";
      let iconBg = "bg-surface-container-high text-on-surface-variant";
      if (l.entity_type === "defect") { icon = "warning"; iconBg = "bg-amber-100 text-amber-700"; }
      else if (l.entity_type === "execution") {
        icon = l.to_status === "passed" ? "check_circle" : l.to_status === "failed" ? "cancel" : "play_circle";
        iconBg = l.to_status === "passed" ? "bg-green-100 text-green-700" : l.to_status === "failed" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700";
      } else if (l.entity_type === "test_run") { icon = "playlist_play"; iconBg = "bg-purple-100 text-purple-700"; }
      else if (l.entity_type === "project") { icon = "folder"; }
      else if (l.entity_type === "user") { icon = "person"; }
      events.push({
        icon,
        iconBg,
        description: `${entity} ${action}: ${l.reason ?? `#${l.entity_id}`}`,
        timestamp: l.changed_at,
        detail: `by ${by}`,
      });
    });
    activity?.recentExecutions?.forEach((e) => {
      events.push({
        icon: e.overall_result === "passed" ? "check_circle" : "cancel",
        iconBg: e.overall_result === "passed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700",
        description: `Execution #${e.id} ${e.overall_result === "passed" ? "passed" : "failed"} — "${e.testCase?.title ?? ""}"`,
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
    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 8);
  }, [activity]);

  const subtitle = useMemo(() => {
    if (currentRole === "DEVELOPER") return "What should you fix next?";
    if (currentRole === "TESTER") return "What do you run today?";
    if (currentRole === "BUSINESS_OWNER" || currentRole === "UAT_COORDINATOR") return "Can you accept this release?";
    if (currentRole === "TEST_LEAD") return "Can UAT finish on time with acceptable risk?";
    if (currentRole === "ADMIN") return "Portfolio health, access hygiene, and system risk.";
    return `Welcome back, ${user?.username?.split(" ")[0] ?? "User"}.`;
  }, [currentRole, user?.username]);

  if (error) {
    return (
      <div className="bg-error-container border border-error rounded-xl p-lg">
        <p className="text-error font-body-sm">Something went wrong — {(error as Error).message}</p>
        <button onClick={() => refetch()} className="mt-md bg-error text-on-error px-md py-sm rounded-lg font-label-md">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-xl">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-md">
        <div>
          <h1 className="font-display-lg text-display-lg text-primary">Dashboard</h1>
          <p className="font-body-base text-body-base text-on-surface-variant">{subtitle}</p>
        </div>
        {roles.length > 0 && (
          <div className="flex flex-wrap gap-xs bg-surface-container p-xs rounded-lg">
            {roles.slice(0, 6).map((role) => (
              <button
                key={role}
                onClick={() => {
                  if (role === "TESTER" && roles.length === 1) navigate("/tester");
                  else setCurrentRole(role);
                }}
                className={`px-md py-xs rounded-md font-label-sm text-label-sm transition-colors ${
                  currentRole === role ? "bg-surface-container-lowest shadow-sm" : "hover:bg-surface-container-high"
                }`}
              >
                {roleLabel(role)}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading && currentRole ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-md">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-surface-container-low animate-pulse" />
          ))}
        </div>
      ) : currentRole === "ADMIN" && overview?.role === "ADMIN" ? (
        <AdminPanel data={overview} navigate={navigate} />
      ) : currentRole === "TEST_LEAD" && overview?.role === "TEST_LEAD" ? (
        <TestLeadPanel data={overview} navigate={navigate} scopedProjects={scopedProjects} />
      ) : (currentRole === "BUSINESS_OWNER" || currentRole === "UAT_COORDINATOR") && overview && (overview.role === "BUSINESS_OWNER") ? (
        <BusinessOwnerPanel data={overview as BusinessOverview} navigate={navigate} scopedProjects={scopedProjects} />
      ) : currentRole === "DEVELOPER" && overview?.role === "DEVELOPER" ? (
        <DeveloperPanel data={overview} navigate={navigate} scopedProjects={scopedProjects} />
      ) : currentRole === "TESTER" && overview?.role === "TESTER" ? (
        <TesterHomePanel data={overview} navigate={navigate} scopedProjects={scopedProjects} />
      ) : (
        <GenericPanel navigate={navigate} isAdmin={isAdmin} />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg">
        <div className="xl:col-span-2 bg-surface-container-lowest p-lg rounded-xl border border-outline-variant">
          <div className="flex justify-between items-center mb-xl">
            <h4 className="font-title-sm text-title-sm">Recent activity</h4>
            <button onClick={() => navigate("/projects")} className="text-secondary font-label-md text-label-md">View projects</button>
          </div>
          {recentEvents.length > 0 ? (
            <div className="space-y-lg">
              {recentEvents.map((evt, i) => (
                <div key={i} className="flex items-start gap-md pb-lg border-b border-outline-variant last:border-0 last:pb-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${evt.iconBg}`}>
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>{evt.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-body-base text-body-base">{evt.description}</p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant mt-xs">{timeAgo(evt.timestamp)} · {evt.detail}</p>
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
        <QuickLinks role={currentRole} isAdmin={isAdmin} navigate={navigate} />
      </div>
    </div>
  );
}
