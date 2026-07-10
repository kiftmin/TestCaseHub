import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useProjectRole, useIsProjectQa } from "../hooks/useProjectRole";
import { Stepper, type Step } from "../components/ui/stepper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { DEFECT_VIEWS } from "../lib/defect-views";
import { downloadDefectsExcel, downloadCsv } from "../lib/csv-utils";
import type { Defect, DefectNote, TestRun, ProjectAssignment } from "../types/api";

const statusBadge: Record<string, string> = {
  NEW: "bg-error-container text-on-error-container border-error/20",
  TRIAGED: "bg-orange-100 text-orange-800 border-orange-200",
  ASSIGNED: "bg-amber-100 text-amber-800 border-amber-200",
  IN_PROGRESS: "bg-cyan-100 text-cyan-800 border-cyan-200",
  RESOLVED_DEV: "bg-indigo-100 text-indigo-800 border-indigo-200",
  QA_PASSED: "bg-teal-100 text-teal-800 border-teal-200",
  READY_FOR_VERIFICATION: "bg-blue-100 text-blue-800 border-blue-200",
  REGRESSED: "bg-red-100 text-red-800 border-red-200",
  CLOSED: "bg-green-100 text-green-800 border-green-200",
  PASSED_BY_AGREEMENT: "bg-purple-100 text-purple-800 border-purple-200",
  PENDING_BIZ_ACCEPTANCE: "bg-sky-100 text-sky-800 border-sky-200",
};

const statusDisplay: Record<string, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  RESOLVED_DEV: "Resolved by Dev",
  QA_PASSED: "QA Passed",
  READY_FOR_VERIFICATION: "Ready for Verification",
  PENDING_BIZ_ACCEPTANCE: "Pending Business Decision",
  REGRESSED: "Regressed",
  CLOSED: "Closed",
  PASSED_BY_AGREEMENT: "Passed by Agreement",
};

function statusBadgeClass(defect: { status: string; is_blocked?: boolean; decision_type?: string }): string {
  if (defect.is_blocked) return "bg-red-100 text-red-800 border-red-200";
  if (defect.status === "PENDING_BIZ_ACCEPTANCE") {
    return defect.decision_type === "risk_waiver"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : "bg-sky-100 text-sky-800 border-sky-200";
  }
  return statusBadge[defect.status] ?? "";
}

const severityColors: Record<string, string> = {
  Critical: "text-error",
  Major: "text-amber-600",
  Minor: "text-on-surface-variant",
  Cosmetic: "text-on-surface-variant",
};



const severityDot: Record<string, string> = {
  Critical: "bg-red-500",
  Major: "bg-amber-500",
  Minor: "bg-gray-400",
  Cosmetic: "bg-gray-300",
};

const DEV_INTERNAL_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS", "RESOLVED_DEV", "REGRESSED"]);

const MASKED_BADGE = "bg-indigo-100 text-indigo-800 border-indigo-200";

const statusIcon: Record<string, string> = {
  NEW: "fiber_new",
  TRIAGED: "content_paste_search",
  ASSIGNED: "assignment_ind",
  IN_PROGRESS: "play_arrow",
  RESOLVED_DEV: "bug_report",
  QA_PASSED: "verified",
  READY_FOR_VERIFICATION: "fact_check",
  PENDING_BIZ_ACCEPTANCE: "pending_actions",
  REGRESSED: "warning",
  CLOSED: "check_circle",
  PASSED_BY_AGREEMENT: "approval",
};

// ── Status Distribution Card ──
function StatusDistCard({
  label,
  count,
  total,
  icon,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  total: number;
  icon?: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <button
      onClick={onClick}
      className={`relative text-left px-md py-sm rounded-xl border transition-all flex flex-col justify-between h-[72px] w-full min-w-0 ${
        isActive
          ? "bg-surface-container border-secondary ring-1 ring-secondary/30 shadow-sm"
          : "bg-surface border-outline-variant hover:bg-surface-container-high hover:border-outline"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && (
            <span className={`material-symbols-outlined text-lg ${isActive ? "text-secondary" : "text-on-surface-variant"}`}>
              {icon}
            </span>
          )}
          <span className="text-[11px] font-semibold text-on-surface-variant truncate tracking-tight">
            {label}
          </span>
        </div>
        <span className={`text-lg font-bold leading-none ${isActive ? "text-secondary" : "text-on-surface"}`}>
          {count}
        </span>
      </div>
      <div className="w-full h-1 rounded-full overflow-hidden bg-surface-container-highest">
        <div
          className={`h-full rounded-full transition-all duration-300 ${isActive ? "bg-secondary" : "bg-outline-variant/50"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}

// ── Helper Components ──
function extractFailedStep(defect: Defect): { stepNumber?: string; instruction?: string } {
  const notes = defect.tester_notes ?? "";
  const stepMatch = notes.match(/^Step\s+(\S+?):\s+(.+)$/m);
  if (stepMatch) {
    return { stepNumber: stepMatch[1], instruction: stepMatch[2] };
  }
  const sr = defect.execution?.stepResults?.find(r => r.passed === false);
  if (sr?.step) {
    return { stepNumber: sr.step.step_number, instruction: sr.step.instruction };
  }
  return {};
}

function TabContent({
  statusDist,
  statusFilter,
  setStatusFilter,
  total,
  sorted,
  role,
  canManage,
  isBusinessOwner,
  isTester,
  isDeveloper,
  isQa,
  projectId,
  expandedId,
  setExpandedId,
  sortField,
  sortDir,
  handleSort,
  activeTab,
}: {
  statusDist: { key: string; label: string; icon?: string; count: number; noFilter?: boolean }[];
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  total: number;
  sorted: Defect[];
  role: string | null;
  canManage: boolean;
  isBusinessOwner: boolean;
  isTester: boolean;
  isDeveloper: boolean;
  isQa: boolean;
  projectId: number;
  expandedId: number | null;
  setExpandedId: (v: number | null) => void;
  sortField: string;
  sortDir: "asc" | "desc";
  handleSort: (field: string) => void;
  activeTab: string;
}) {
  return (
    <>
      {/* Status Distribution */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {statusDist.map((s) => (
          <div key={s.key} className="min-w-0">
            <StatusDistCard
              label={s.label}
              count={s.count}
              total={total}
              icon={s.icon}
              isActive={!s.noFilter && statusFilter === s.key}
              onClick={s.noFilter ? () => {} : () => setStatusFilter(statusFilter === s.key ? "all" : s.key)}
            />
          </div>
        ))}
      </div>

      {/* Defect Table */}
      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant">
                <SortTh field="id" label="ID" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="test_case" label="Test Case / Step" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="severity" label="Sev" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="priority" label="Pri" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="created_at" label="Created" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-md py-sm text-[10px] font-bold text-outline uppercase tracking-wider text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60">
              {sorted.map((defect) => (
                 <DefectRow
                  key={defect.id}
                  defect={defect}
                  expanded={expandedId === defect.id}
                  onToggle={() => setExpandedId(expandedId === defect.id ? null : defect.id)}
                  role={role}
                  canManage={canManage}
                  isBusinessOwner={isBusinessOwner}
                  isTester={isTester}
                  isDeveloper={isDeveloper}
                  isQa={isQa}
                  projectId={projectId}
                  onMutated={() => {}}
                  activeTab={activeTab}
                />
              ))}
                {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-lg text-center text-on-surface-variant font-body-sm">
                    <div className="flex flex-col items-center gap-2 py-lg">
                      <span className="material-symbols-outlined text-3xl text-outline-variant">search_off</span>
                      <p className="text-on-surface-variant">No defects match the current filters</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-md py-sm bg-surface-container-low border-t border-outline-variant flex items-center justify-between">
          <p className="text-xs text-on-surface-variant">
            Showing <span className="font-semibold">{sorted.length}</span> of <span className="font-semibold">{total}</span> defects
          </p>
        </div>
      </div>
    </>
  );
}

function DeveloperRejectionBanner({ defect }: { defect: Defect }) {
  let rejectionNote: string | null = null;
  if (defect.rejection_log) {
    try {
      const log = JSON.parse(defect.rejection_log);
      const last = Array.isArray(log) ? log[log.length - 1] : log;
      rejectionNote = last?.reason ?? last?.note ?? last?.justification ?? null;
    } catch { /* ignore parse errors */ }
  }
  return (
    <div className="mb-lg px-md py-sm bg-red-50 border border-red-200 rounded-lg">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-red-600 text-xl flex-shrink-0">error</span>
        <div>
          <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider mb-xs">QA Rejection Notice</p>
          <p className="font-body-sm text-body-sm text-red-700">
            {rejectionNote ?? `This defect failed verification and was returned (rejected ${defect.regression_index} time${defect.regression_index === 1 ? "" : "s"}).`}
          </p>
        </div>
      </div>
    </div>
  );
}

export function DefectLogPage({ params }: { params: { id: string } }) {
  const projectId = Number(params.id);
  const user = getStoredUser();
  const role = useProjectRole(projectId);
  useEffect(() => { document.title = "Defects | TestCaseHub"; }, []);

  const [runFilter, setRunFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [developerFilter, setDeveloperFilter] = useState("all");

  const { data: projectUsers } = useQuery({
    queryKey: ["project-users", projectId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/projects/${projectId}/users`),
  });
  const developers = projectUsers?.filter((a) => a.role === "DEVELOPER") ?? [];
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortField, setSortField] = useState<string>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const canManage = role === "TEST_LEAD" || user?.role === "ADMIN";
  const isBusinessOwner = role === "BUSINESS_OWNER" || user?.role === "ADMIN";
  const isTester = role === "TESTER" || user?.role === "ADMIN";
  const isDeveloper = role === "DEVELOPER" || user?.role === "ADMIN";
  const isQa = useIsProjectQa(projectId);

  const defaultTab = role === "DEVELOPER" ? "developer" : (role === "ADMIN" || role === "TEST_LEAD") ? "full" : "business";
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    setStatusFilter("all");
    setSeverityFilter("all");
    setSearch("");
    setDeveloperFilter("all");
  }, [activeTab]);

  const { data: testRuns } = useQuery({
    queryKey: ["project-runs", projectId],
    queryFn: () => customFetch<TestRun[]>(`/projects/${projectId}/test-runs`),
  });

  const { data: allDefects } = useQuery({
    queryKey: ["project-defects", projectId],
    queryFn: () => customFetch<Defect[]>(`/projects/${projectId}/defects`),
    enabled: !!projectId,
  });

  const tabStatuses = useMemo(() => {
    if (activeTab === "full" || activeTab === "my") return new Set(Object.keys(statusBadge));
    if (activeTab === "business") return new Set([...DEFECT_VIEWS.BUSINESS.active, ...DEFECT_VIEWS.BUSINESS.withDev, ...DEFECT_VIEWS.BUSINESS.historical]);
    if (activeTab === "developer") return new Set([...DEFECT_VIEWS.DEVELOPER.actionable, ...DEFECT_VIEWS.DEVELOPER.recentlyResolved]);
    return new Set(Object.keys(statusBadge));
  }, [activeTab]);

  const statusOrder = useMemo(() => {
    return ["all", ...Object.keys(statusBadge).filter((s) => tabStatuses.has(s))];
  }, [tabStatuses]);

  const tabFiltered = useMemo(() => {
    if (activeTab === "full") return allDefects ?? [];
    if (activeTab === "my") return (allDefects ?? []).filter((d) => d.assigned_to_user_id === user?.userId);
    if (activeTab === "business") {
      const valid = new Set([...DEFECT_VIEWS.BUSINESS.active, ...DEFECT_VIEWS.BUSINESS.withDev, ...DEFECT_VIEWS.BUSINESS.historical]);
      return (allDefects ?? []).filter((d) => valid.has(d.status));
    }
    if (activeTab === "developer") {
      const valid = new Set([...DEFECT_VIEWS.DEVELOPER.actionable, ...DEFECT_VIEWS.DEVELOPER.recentlyResolved]);
      return (allDefects ?? []).filter((d) => valid.has(d.status));
    }
    return allDefects ?? [];
  }, [allDefects, activeTab, user?.userId]);

  const statusDist = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of tabFiltered) map[d.status] = (map[d.status] ?? 0) + 1;

    if (activeTab === "business") {
      const devSum = (["ASSIGNED", "IN_PROGRESS", "RESOLVED_DEV", "REGRESSED"] as const)
        .reduce((sum, s) => sum + (map[s] ?? 0), 0);
      return [
        { key: "all", label: "All", icon: "bar_chart", count: tabFiltered.length },
        { key: "NEW", label: "New", icon: statusIcon["NEW"], count: map["NEW"] ?? 0 },
        { key: "TRIAGED", label: "Triaged", icon: statusIcon["TRIAGED"], count: map["TRIAGED"] ?? 0 },
        { key: "WITH_DEV", label: "With Development", icon: "construction", count: devSum },
        { key: "READY_FOR_VERIFICATION", label: "Ready for Verification", icon: statusIcon["READY_FOR_VERIFICATION"], count: map["READY_FOR_VERIFICATION"] ?? 0 },
        { key: "CLOSED", label: "Closed", icon: statusIcon["CLOSED"], count: map["CLOSED"] ?? 0 },
        { key: "PASSED_BY_AGREEMENT", label: "Passed by Agreement", icon: statusIcon["PASSED_BY_AGREEMENT"], count: map["PASSED_BY_AGREEMENT"] ?? 0 },
      ];
    }

    return statusOrder.map(s => ({
      key: s,
      label: s === "all" ? "All" : statusDisplay[s] ?? s,
      icon: s === "all" ? "bar_chart" : statusIcon[s],
      count: s === "all" ? tabFiltered.length : (map[s] ?? 0),
    }));
  }, [tabFiltered, activeTab, statusOrder]);

  const total = tabFiltered.length;

  const filtered = useMemo(() => {
    return tabFiltered.filter((d) => {
      if (runFilter !== "all" && d.test_run_id !== Number(runFilter)) return false;
      if (statusFilter === "WITH_DEV") {
        if (!DEV_INTERNAL_STATUSES.has(d.status)) return false;
      } else if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (severityFilter !== "all" && d.severity !== severityFilter) return false;
      if (developerFilter !== "all" && d.assigned_to_user_id !== Number(developerFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        const match =
          `DEF-${d.id}`.toLowerCase().includes(q) ||
          d.testCase?.title?.toLowerCase().includes(q) ||
          d.tester_notes?.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [tabFiltered, runFilter, statusFilter, severityFilter, developerFilter, search]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortField) {
      case "status": return a.status.localeCompare(b.status) * dir;
      case "severity": {
        const order = ["Cosmetic", "Minor", "Major", "Critical"];
        const sa = order.indexOf(a.severity ?? "");
        const sb = order.indexOf(b.severity ?? "");
        return (sa - sb) * dir;
      }
      case "priority": {
        const order = ["P4", "P3", "P2", "P1"];
        const pa = order.indexOf(a.priority ?? "");
        const pb = order.indexOf(b.priority ?? "");
        return (pa - pb) * dir;
      }
      case "created_at": return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      case "test_case": {
        const ta = a.testCase?.title ?? "";
        const tb = b.testCase?.title ?? "";
        return ta.localeCompare(tb) * dir;
      }
      default: return (a.id - b.id) * dir;
    }
  }), [filtered, sortField, sortDir]);

  const handleExportExcel = useCallback(() => {
    const date = new Date().toISOString().slice(0, 10);
    downloadDefectsExcel(`defects-log-${date}.xlsx`, sorted.map((d) => ({
      id: d.id,
      title: d.testCase?.title ?? "",
      status: d.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      severity: d.severity,
      assignee: d.execution?.tester?.name ?? "",
      targetRelease: "",
    })));
  }, [sorted]);

  const handleExportCsv = useCallback(() => {
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `defects-log-${date}.csv`,
      ["ID", "Title", "Severity", "State", "Assignee", "Target Release"],
      sorted.map((d) => [
        `DEF-${d.id}`,
        d.testCase?.title ?? "",
        d.severity ?? "",
        statusDisplay[d.status] ?? d.status,
        d.execution?.tester?.name ?? "",
        "",
      ])
    );
  }, [sorted]);

  return (
    <>
    <div className="space-y-lg print:hidden">
      <header className="flex items-start justify-between gap-md">
        <div className="flex items-start gap-md">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-secondary-container text-on-secondary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">bug_report</span>
          </div>
          <div>
            <h1 className="font-display-lg text-display-lg text-primary leading-tight">Defect Log</h1>
            <p className="font-body-base text-on-surface-variant mt-0.5">
              Tracking <span className="font-semibold text-on-surface">{allDefects?.length ?? 0}</span> defects across <span className="font-semibold text-on-surface">{testRuns?.length ?? 0}</span> runs.
            </p>
          </div>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-lg">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="business">
              <span className="material-symbols-outlined text-sm">business_center</span>
              Business / QA
            </TabsTrigger>
            {(role === "DEVELOPER" || role === "TEST_LEAD" || role === "ADMIN") && (
              <TabsTrigger value="developer">
                <span className="material-symbols-outlined text-sm">code</span>
                Developer
              </TabsTrigger>
            )}
            {(role === "ADMIN" || role === "TEST_LEAD" || role === "UAT_COORDINATOR") && (
              <TabsTrigger value="full">
                <span className="material-symbols-outlined text-sm">dashboard</span>
                Full Board
              </TabsTrigger>
            )}
            <TabsTrigger value="my">
              <span className="material-symbols-outlined text-sm">person</span>
              My Defects
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-sm">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-sm px-md py-sm border border-outline text-on-surface rounded-lg font-label-md hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-sm">file_download</span>
              Export CSV
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-sm px-md py-sm border border-outline text-on-surface rounded-lg font-label-md hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-sm">file_download</span>
              Export Excel
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-sm px-md py-sm border border-outline text-on-surface rounded-lg font-label-md hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-sm">print</span>
              Print Log
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <section className="bg-surface border border-outline-variant rounded-xl p-md shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-md">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider">Test Run</label>
              <select
                value={runFilter}
                onChange={(e) => setRunFilter(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm text-sm focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary transition-all"
              >
                <option value="all">All Runs</option>
                {testRuns?.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm text-sm focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary transition-all"
              >
                <option value="all">All Statuses</option>
                {[...tabStatuses].map((s) => (
                  <option key={s} value={s}>{statusDisplay[s] ?? s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider">Severity</label>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm text-sm focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary transition-all"
              >
                <option value="all">All Severities</option>
                <option value="Critical">Critical</option>
                <option value="Major">Major</option>
                <option value="Minor">Minor</option>
                <option value="Cosmetic">Cosmetic</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider">Developer</label>
              <select
                value={developerFilter}
                onChange={(e) => setDeveloperFilter(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm text-sm focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary transition-all"
              >
                <option value="all">All Developers</option>
                {developers.map((d) => (
                  <option key={d.user_id} value={d.user_id}>{d.user.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider">Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search defects..."
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm text-sm focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary transition-all"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => { setRunFilter("all"); setStatusFilter("all"); setSeverityFilter("all"); setDeveloperFilter("all"); setSearch(""); }}
                className="w-full bg-surface-container-high text-on-surface font-label-md text-label-md py-sm rounded-lg hover:bg-outline-variant transition-colors flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">filter_list</span>
                Clear
              </button>
            </div>
          </div>
        </section>

        <TabsContent value="business">
          <TabContent
            statusDist={statusDist}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            total={total}
            sorted={sorted}
            role={role}
            canManage={canManage}
            isBusinessOwner={isBusinessOwner}
            isTester={isTester}
            isDeveloper={isDeveloper}
            isQa={isQa}
            projectId={projectId}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            sortField={sortField}
            sortDir={sortDir}
            handleSort={handleSort}
            activeTab={activeTab}
          />
        </TabsContent>

        <TabsContent value="developer">
          <TabContent
            statusDist={statusDist}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            total={total}
            sorted={sorted}
            role={role}
            canManage={canManage}
            isBusinessOwner={isBusinessOwner}
            isTester={isTester}
            isDeveloper={isDeveloper}
            isQa={isQa}
            projectId={projectId}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            sortField={sortField}
            sortDir={sortDir}
            handleSort={handleSort}
            activeTab={activeTab}
          />
        </TabsContent>

        <TabsContent value="full">
          <TabContent
            statusDist={statusDist}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            total={total}
            sorted={sorted}
            role={role}
            canManage={canManage}
            isBusinessOwner={isBusinessOwner}
            isTester={isTester}
            isDeveloper={isDeveloper}
            isQa={isQa}
            projectId={projectId}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            sortField={sortField}
            sortDir={sortDir}
            handleSort={handleSort}
            activeTab={activeTab}
          />
        </TabsContent>

        <TabsContent value="my">
          <TabContent
            statusDist={statusDist}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            total={total}
            sorted={sorted}
            role={role}
            canManage={canManage}
            isBusinessOwner={isBusinessOwner}
            isTester={isTester}
            isDeveloper={isDeveloper}
            isQa={isQa}
            projectId={projectId}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            sortField={sortField}
            sortDir={sortDir}
            handleSort={handleSort}
            activeTab={activeTab}
          />
        </TabsContent>
      </Tabs>
    </div>

    {/* ── Corporate print layout ─────────────────────────────────────────── */}
    <div className="hidden print:block" id="defects-print-root">

      {/* Document header */}
      <div style={{ borderBottom: "3px solid #4648d4", paddingBottom: "12px", marginBottom: "18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em", color: "#4648d4", textTransform: "uppercase", marginBottom: "4px" }}>
              TestCaseHub — Enterprise UAT
            </p>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1b1b1d", margin: 0, lineHeight: 1.2 }}>
              Defect Log Report
            </h1>
            <p style={{ fontSize: "10px", color: "#45464d", marginTop: "4px" }}>
              {activeTab === "full" ? "All Defects" : activeTab === "business" ? "Business View" : activeTab === "developer" ? "Developer View" : "QA View"}
              {statusFilter !== "all" && ` · Filtered: ${statusDisplay[statusFilter] ?? statusFilter}`}
              {severityFilter !== "all" && ` · Severity: ${severityFilter}`}
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: "9px", color: "#45464d", lineHeight: 1.8 }}>
            <p style={{ margin: 0, fontWeight: 700, color: "#1b1b1d" }}>CONFIDENTIAL</p>
            <p style={{ margin: 0 }}>Generated: {new Date().toLocaleString()}</p>
            <p style={{ margin: 0 }}>Total Records: <strong>{sorted.length}</strong></p>
          </div>
        </div>
      </div>

      {/* Executive summary strip */}
      {(() => {
        const critical = sorted.filter(d => d.severity === "Critical").length;
        const major    = sorted.filter(d => d.severity === "Major").length;
        const minor    = sorted.filter(d => d.severity === "Minor").length;
        const open     = sorted.filter(d => !["CLOSED","PASSED_BY_AGREEMENT"].includes(d.status)).length;
        const closed   = sorted.filter(d =>  ["CLOSED","PASSED_BY_AGREEMENT"].includes(d.status)).length;
        const cells = [
          { label: "Total Defects",  value: sorted.length,  color: "#1b1b1d" },
          { label: "Open",           value: open,            color: "#ba1a1a" },
          { label: "Closed",         value: closed,          color: "#15803d" },
          { label: "Critical",       value: critical,        color: "#ba1a1a" },
          { label: "Major",          value: major,           color: "#b45309" },
          { label: "Minor",          value: minor,           color: "#45464d" },
        ];
        return (
          <div style={{ display: "flex", border: "1px solid #c6c6cd", borderRadius: "6px", marginBottom: "18px", overflow: "hidden" }}>
            {cells.map((c, i) => (
              <div key={c.label} style={{
                flex: 1,
                textAlign: "center",
                padding: "8px 4px",
                borderRight: i < cells.length - 1 ? "1px solid #c6c6cd" : "none",
                background: i === 0 ? "#f6f3f5" : "white",
              }}>
                <p style={{ fontSize: "16px", fontWeight: 700, color: c.color, margin: 0 }}>{c.value}</p>
                <p style={{ fontSize: "8px", color: "#45464d", margin: 0, marginTop: "2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{c.label}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9px" }}>
        <thead>
          <tr style={{ backgroundColor: "#4648d4", color: "white" }}>
            <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 700, letterSpacing: "0.06em", width: "7%",  whiteSpace: "nowrap" }}>ID</th>
            <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 700, letterSpacing: "0.06em", width: "28%"                      }}>Defect Title</th>
            <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 700, letterSpacing: "0.06em", width: "10%"                      }}>Severity</th>
            <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 700, letterSpacing: "0.06em", width: "16%"                      }}>State</th>
            <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 700, letterSpacing: "0.06em", width: "14%"                      }}>Assignee</th>
            <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 700, letterSpacing: "0.06em", width: "13%"                      }}>Scenario</th>
            <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 700, letterSpacing: "0.06em", width: "12%", whiteSpace: "nowrap" }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => {
            const sevColor =
              d.severity === "Critical" ? "#fef2f2" :
              d.severity === "Major"    ? "#fffbeb" :
              d.severity === "Minor"    ? "#f0fdf4" : "white";
            const sevTextColor =
              d.severity === "Critical" ? "#991b1b" :
              d.severity === "Major"    ? "#92400e" :
              d.severity === "Minor"    ? "#166534" : "#45464d";
            return (
              <tr
                key={d.id}
                className="defect-print-row"
                style={{ backgroundColor: i % 2 === 0 ? "white" : "#f9f9fb", borderBottom: "1px solid #e4e2e4" }}
              >
                <td style={{ padding: "6px 8px", fontWeight: 700, color: "#4648d4", whiteSpace: "nowrap" }}>DEF-{d.id}</td>
                <td style={{ padding: "6px 8px", color: "#1b1b1d" }}>{d.testCase?.title ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  {d.severity ? (
                    <span style={{
                      display: "inline-block",
                      padding: "2px 7px",
                      borderRadius: "4px",
                      backgroundColor: sevColor,
                      color: sevTextColor,
                      fontWeight: 700,
                      fontSize: "8px",
                      letterSpacing: "0.04em",
                    }}>
                      {d.severity}
                    </span>
                  ) : "—"}
                </td>
                <td style={{ padding: "6px 8px", color: "#1b1b1d" }}>{statusDisplay[d.status] ?? d.status}</td>
                <td style={{ padding: "6px 8px", color: "#45464d" }}>{d.execution?.tester?.name ?? "—"}</td>
                <td style={{ padding: "6px 8px", color: "#45464d", fontSize: "8px" }}>{d.testCase?.useCase?.name ?? "—"}</td>
                <td style={{ padding: "6px 8px", color: "#45464d", whiteSpace: "nowrap" }}>{new Date(d.created_at).toLocaleDateString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Footer */}
      <div style={{ marginTop: "18px", paddingTop: "8px", borderTop: "1px solid #c6c6cd", display: "flex", justifyContent: "space-between", fontSize: "8px", color: "#76777d" }}>
        <span>TestCaseHub Enterprise UAT — Defect Log — CONFIDENTIAL</span>
        <span>Generated {new Date().toLocaleDateString()}</span>
      </div>
    </div>

    <style>{`
      @media print {
        @page { size: landscape; margin: 15mm 12mm; }

        /* Make everything invisible but keep layout intact */
        body * { visibility: hidden; }

        /* Then reveal only our print root and all its children */
        #defects-print-root,
        #defects-print-root * { visibility: visible; }

        #defects-print-root {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          background: white;
          font-family: Arial, Helvetica, sans-serif;
        }

        .defect-print-row { break-inside: avoid; }
      }
    `}</style>
    </>
  );
}

function DefectRow({
  defect,
  expanded,
  onToggle,
  role,
  canManage,
  isBusinessOwner,
  isTester,
  isDeveloper,
  isQa,
  projectId,
  onMutated,
  activeTab,
}: {
  defect: Defect;
  expanded: boolean;
  onToggle: () => void;
  role: string | null;
  canManage: boolean;
  isBusinessOwner: boolean;
  isTester: boolean;
  isDeveloper: boolean;
  isQa: boolean;
  projectId: number;
  onMutated: () => void;
  activeTab: string;
}) {
  const user = getStoredUser();
  const queryClient = useQueryClient();
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [retestOpen, setRetestOpen] = useState(false);
  const [acceptBizRiskOpen, setAcceptBizRiskOpen] = useState(false);
  const [rejectBizOpen, setRejectBizOpen] = useState(false);
  const [bizAcceptOpen, setBizAcceptOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [devNoteFilter, setDevNoteFilter] = useState<"all" | "internal" | "standard">("all");
  const [flagRetestNewOpen, setFlagRetestNewOpen] = useState(false);
  const [flagBlockedNewOpen, setFlagBlockedNewOpen] = useState(false);
  const [showBusinessDecisionDialog, setShowBusinessDecisionDialog] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [qaReviewOpen, setQaReviewOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [resumeWorkOpen, setResumeWorkOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const [untriagedAction, setUntriagedAction] = useState<string | null>(null);
  const [pendingAfterClassify, setPendingAfterClassify] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<"overview" | "steps" | "activity">("overview");
  const [quickVerifyResultAction, setQuickVerifyResultAction] = useState<"passed" | "failed" | null>(null);

  const isNew = defect.status === "NEW";
  const isClassified = !!(defect.severity && defect.priority);
  // is_blocked is now a flag — the defect retains its underlying status
  const isBlocked = defect.is_blocked === true;

  const handleUntriagedAction = (action: string) => {
    if (isNew && !isClassified) {
      setUntriagedAction(action);
    } else {
      proceedWithAction(action);
    }
  };

  const proceedWithAction = (action: string) => {
    setUntriagedAction(null);
    setPendingAfterClassify(null);
    switch (action) {
      case "classify": setClassifyOpen(true); break;
      case "assign": setAssignOpen(true); break;
      case "retest": setFlagRetestNewOpen(true); break;
      case "block": setFlagBlockedNewOpen(true); break;
    }
  };

  const handleClassifyThenAction = () => {
    setPendingAfterClassify(untriagedAction);
    setUntriagedAction(null);
    setClassifyOpen(true);
  };
  const isTriaged = defect.status === "TRIAGED";
  const isAssigned = defect.status === "ASSIGNED";
  const isInProgress = defect.status === "IN_PROGRESS";
  const isResolved = defect.status === "RESOLVED_DEV" || defect.status === "QA_PASSED";
  const isQaPassed = defect.status === "QA_PASSED";
  const isReady = defect.status === "READY_FOR_VERIFICATION";
  const isClosed = defect.status === "CLOSED" || defect.status === "PASSED_BY_AGREEMENT";
  const isPendingBiz = defect.status === "PENDING_BIZ_ACCEPTANCE";

  const canRetestFromAnyState = false; // Removed: flag-retest is only valid from RESOLVED_DEV, handled by the dedicated Send for Verification button

  const invalidateProject = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project-defects"] });
    queryClient.invalidateQueries({ queryKey: ["project-runs"] });
    onMutated();
  }, [queryClient, onMutated]);

  const classifyMut = useMutation({
    mutationFn: (data: { severity: string; priority: string; assigned_to_user_id?: number }) =>
      customFetch(`/defects/${defect.id}/classify`, { method: "PATCH", body: JSON.stringify(data) }),
    onError: (e: Error) => toast.error(e.message),
  });

  const assignMut = useMutation({
    mutationFn: (data: { assigned_to_user_id: number; support_ticket_number?: string }) => customFetch(`/defects/${defect.id}/assign`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
    onSuccess: () => { invalidateProject(); toast.success("Assigned to developer"); setAssignOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startMut = useMutation({
    mutationFn: () => customFetch(`/defects/${defect.id}/start`, { method: "PATCH" }),
    onSuccess: () => { invalidateProject(); toast.success("Work started"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const blockMut = useMutation({
    mutationFn: (reason: string) => customFetch(`/defects/${defect.id}/block`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect blocked"); setBlockOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const unblockMut = useMutation({
    mutationFn: (reason: string) =>
      customFetch(`/defects/${defect.id}/unblock`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => { invalidateProject(); toast.success("Block lifted"); setUnblockOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveDevMut = useMutation({
    mutationFn: (rootCause: string) => customFetch(`/defects/${defect.id}/resolve`, { method: "PATCH", body: JSON.stringify({ root_cause_category: rootCause }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect resolved by developer"); setResolveOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const qaReviewMut = useMutation({
    mutationFn: (data: { result: "passed" | "failed"; notes?: string }) =>
      customFetch(`/defects/${defect.id}/qa-review`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateProject(); toast.success("QA review recorded"); setQaReviewOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reassignMut = useMutation({
    mutationFn: (data: { newDeveloperId: number; reason: string }) =>
      customFetch(`/defects/${defect.id}/reassign`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect reassigned"); setReassignOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resumeWorkMut = useMutation({
    mutationFn: (reason: string) => customFetch(`/defects/${defect.id}/resume-work`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidateProject(); toast.success("Work resumed"); setResumeWorkOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const flagRetestMut = useMutation({
    mutationFn: () => customFetch(`/defects/${defect.id}/flag-retest`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Ready for verification", targetVerificationRunId: defect.test_run_id }),
    }),
    onSuccess: () => { invalidateProject(); toast.success("Sent for verification"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const flagRetestFromNewMut = useMutation({
    mutationFn: (data: { reason: string; targetVerificationRunId?: number }) =>
      customFetch(`/defects/${defect.id}/flag-retest-from-new`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect sent for retesting"); setFlagRetestNewOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const flagBlockedNewMut = useMutation({
    mutationFn: (reason: string) => customFetch(`/defects/${defect.id}/flag-blocked`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect flagged as blocked"); setFlagBlockedNewOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitBusinessDecisionMut = useMutation({
    mutationFn: (data: { justification: string; decisionType: "risk_waiver" | "business_review" }) =>
      customFetch(`/defects/${defect.id}/submit-for-business-decision`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateProject(); toast.success("Submitted for business decision"); setShowBusinessDecisionDialog(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const quickVerifyMut = useMutation({
    mutationFn: (data: { result: string; notes?: string }) =>
      customFetch(`/defects/${defect.id}/quick-verify`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateProject(); toast.success("Verification recorded"); setQuickVerifyResultAction(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const acceptBizRiskMut = useMutation({
    mutationFn: (justification: string) => customFetch(`/defects/${defect.id}/accept-by-agreement`, { method: "PATCH", body: JSON.stringify({ justification }) }),
    onSuccess: () => { invalidateProject(); toast.success("Accepted by agreement"); setAcceptBizRiskOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectBizAcceptanceMut = useMutation({
    mutationFn: (reason: string) =>
      customFetch(`/defects/${defect.id}/reject-biz-acceptance`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Business risk acceptance rejected — defect returned to prior state");
      setRejectBizOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bizAcceptMut = useMutation({
    mutationFn: (note: string) => customFetch(`/defects/${defect.id}/accept`, { method: "PATCH", body: JSON.stringify({ note }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect accepted"); setBizAcceptOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bizRejectMut = useMutation({
    mutationFn: (reason: string) => customFetch(`/defects/${defect.id}/reject-verification`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect rejected"); setRejectOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rescheduleMut = useMutation({
    mutationFn: (reason: string) => customFetch(`/defects/${defect.id}/reschedule-retest`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidateProject(); toast.success("Retest rescheduled — defect returned to developer"); setRescheduleOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addNoteMut = useMutation({
    mutationFn: ({ note, is_internal }: { note: string; is_internal: boolean }) =>
      customFetch(`/defects/${defect.id}/notes`, { method: "POST", body: JSON.stringify({ note, is_internal }) }),
    onSuccess: () => { invalidateProject(); toast.success("Comment added"); setNoteOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordRetestMut = useMutation({
    mutationFn: (data: { retestResult: string; retestNotes: string }) => {
      const retestId = defect.retests?.[0]?.id;
      if (!retestId) throw new Error("No retest record found");
      return customFetch(`/defect-retests/${retestId}`, { method: "PATCH", body: JSON.stringify(data) });
    },
    onSuccess: () => { invalidateProject(); toast.success("Retest recorded"); setRetestOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const stepInfo = extractFailedStep(defect);

  const { statusSteps, mainFlow, isRegressed } = useMemo(() => {
    if (activeTab === "business") {
      const steps: Step[] = [
        { key: "NEW", label: "New" },
        { key: "TRIAGED", label: "Triaged" },
        { key: "WITH_DEV", label: "With Development" },
        { key: "READY_FOR_VERIFICATION", label: "Verification" },
        { key: "CLOSED", label: "Closed/Finalized" },
      ];
      const flow: Record<string, number> = {
        NEW: 0, TRIAGED: 1,
        ASSIGNED: 2, IN_PROGRESS: 2, RESOLVED_DEV: 2, QA_PASSED: 2, REGRESSED: 2,
        READY_FOR_VERIFICATION: 3, PENDING_BIZ_ACCEPTANCE: 3,
        CLOSED: 4, PASSED_BY_AGREEMENT: 4,
      };
      return { statusSteps: steps, mainFlow: flow, isRegressed: defect.regression_index > 0 };
    }
    if (activeTab === "developer") {
      const steps: Step[] = [
        { key: "ASSIGNED", label: "Assigned" },
        { key: "IN_PROGRESS", label: "In Progress" },
        { key: "RESOLVED_DEV", label: "Resolved" },
        { key: "QA_PASSED", label: "QA Passed" },
      ];
      const flow: Record<string, number> = {
        ASSIGNED: 0, IN_PROGRESS: 1, RESOLVED_DEV: 2, QA_PASSED: 3, REGRESSED: 0,
      };
      return { statusSteps: steps, mainFlow: flow, isRegressed: defect.regression_index > 0 };
    }
    // Full board — 11 states
    const steps: Step[] = [
      { key: "NEW", label: "New" },
      { key: "TRIAGED", label: "Triaged" },
      { key: "ASSIGNED", label: "Assigned" },
      { key: "IN_PROGRESS", label: "In Progress" },
      { key: "RESOLVED_DEV", label: "Resolved" },
      { key: "QA_PASSED", label: "QA Passed" },
      { key: "READY_FOR_VERIFICATION", label: "Verification" },
      { key: "PENDING_BIZ_ACCEPTANCE", label: "Pending Biz" },
      { key: "CLOSED", label: "Closed" },
    ];
    const flow: Record<string, number> = { NEW:0, TRIAGED:1, ASSIGNED:2, IN_PROGRESS:3, RESOLVED_DEV:4, QA_PASSED:5, READY_FOR_VERIFICATION:6, PENDING_BIZ_ACCEPTANCE:7, CLOSED:8, PASSED_BY_AGREEMENT:8, REGRESSED:3 };
    return { statusSteps: steps, mainFlow: flow, isRegressed: defect.regression_index > 0 };
  }, [activeTab, defect.regression_index]);
  const currentStatusIdx = mainFlow[defect.status] ?? 0;

  // Derive actually completed steps from system notes to avoid marking skipped states as completed
  const visitedFrom = useMemo(() => {
    const fromStates = new Set<string>();
    if (defect.notes) {
      const seen = new Set<string>();
      for (const n of defect.notes) {
        if (!n.is_system_note) continue;
        // Skip duplicate notes (same content + same timestamp)
        const key = `${n.note}|${n.created_at}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = n.note.match(/from '([^']+)' to '([^']+)'/);
        if (m && m[1] !== m[2]) fromStates.add(m[1]);
      }
    }
    return fromStates;
  }, [defect.notes]);

  const completedStatusIndices = useMemo(() => {
    const idx = new Set<number>();
    for (const s of visitedFrom) {
      const i = mainFlow[s];
      if (i != null && i < currentStatusIdx) idx.add(i);
    }
    // If defect is in a terminal state, mark the final step as completed too
    if (["CLOSED", "PASSED_BY_AGREEMENT"].includes(defect.status)) {
      idx.add(statusSteps.length - 1);
    }
    return [...idx].sort((a, b) => a - b);
  }, [visitedFrom, currentStatusIdx, defect.status]);

  return (
    <>
      <tr
        className={`group hover:bg-surface-container-low cursor-pointer transition-colors ${isClosed ? "opacity-70" : ""}`}
        onClick={onToggle}
      >
        <td className="px-md py-sm whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${severityDot[defect.severity ?? ""] ?? "bg-gray-300"} shrink-0`} />
            <span className="font-label-md text-label-md text-secondary font-semibold">
              DEF-{defect.id}
            </span>
            {defect.inActiveRetestRun && (role === "DEVELOPER" || role === "TEST_LEAD" || role === "ADMIN") && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold uppercase tracking-wider" title="This defect is part of an active retest run">
                Retest
              </span>
            )}
          </div>
        </td>
        <td className="px-md py-sm">
          <div className="flex flex-col gap-0.5">
            <p className="font-label-md text-label-md text-on-surface leading-tight truncate max-w-[240px]">
              {defect.testCase?.title ?? `Test Case #${defect.test_case_id}`}
            </p>
            {stepInfo.instruction && (
              <p className="text-xs text-on-surface-variant leading-tight truncate max-w-[240px]">
                Step {stepInfo.stepNumber}: {stepInfo.instruction}
              </p>
            )}
          </div>
        </td>
        <td className={`px-md py-sm text-sm whitespace-nowrap ${severityColors[defect.severity ?? ""] ?? ""}`}>
          <span className="font-medium">{defect.severity ?? "—"}</span>
        </td>
        <td className="px-md py-sm text-sm whitespace-nowrap text-on-surface-variant">
          <span className="font-medium">{defect.priority ?? "—"}</span>
        </td>
        <td className="p-md whitespace-nowrap">
          <div className="flex flex-col gap-0.5">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${activeTab === "business" && DEV_INTERNAL_STATUSES.has(defect.status) ? MASKED_BADGE : statusBadgeClass(defect)}`}>
              {activeTab === "business" && DEV_INTERNAL_STATUSES.has(defect.status) ? null : <span className="material-symbols-outlined text-[12px]">{isBlocked ? "block" : (statusIcon[defect.status] ?? "circle")}</span>}
              {activeTab === "business" && DEV_INTERNAL_STATUSES.has(defect.status) ? "With Development" : isBlocked ? "Blocked" : (statusDisplay[defect.status] ?? defect.status)}
            </span>
            {isBlocked && activeTab !== "business" && (
              <span className="text-[9px] text-red-600 font-medium truncate max-w-[120px]" title={defect.blocked_reason ?? ""}>
                {defect.blocked_reason ?? "Blocked"}
              </span>
            )}
          </div>
          {defect.regression_index > 0 && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-orange-100 text-orange-700 border border-orange-200" title="Previously failed verification">
              REJ×{defect.regression_index}
            </span>
          )}
        </td>
        <td className="px-md py-sm text-sm text-on-surface-variant whitespace-nowrap">
          {new Date(defect.created_at).toLocaleDateString()}
        </td>
        <td className="px-md py-sm text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-0.5">
            {/* Classify / Reclassify */}
            {canManage && !isClosed && !isPendingBiz && (
              <button
                onClick={() => isNew ? setClassifyOpen(true) : handleUntriagedAction("classify")}
                className="action-btn action-btn-secondary"
                title={isNew ? "Set severity and priority" : "Reclassify severity and priority"}
              >
                <span className="material-symbols-outlined text-sm">category</span>
              </button>
            )}
            {/* Assign (TRIAGED → ASSIGNED; NEW only when not blocked) */}
            {canManage && (isTriaged || (isNew && !isBlocked)) && (
              <button
                onClick={() => handleUntriagedAction("assign")}
                className="action-btn action-btn-amber"
                title="Assign to Developer"
              >
                <span className="material-symbols-outlined text-sm">assignment</span>
              </button>
            )}
            {/* Developer: Start Work (ASSIGNED → IN_PROGRESS) — assigned developer only */}
            {isDeveloper && isAssigned && !isBlocked && defect.assigned_to_user_id === user?.userId && (
              <button
                onClick={() => startMut.mutate()}
                className="action-btn action-btn-cyan"
                title="Start Work"
              >
                <span className="material-symbols-outlined text-sm">play_arrow</span>
              </button>
            )}
            {/* Developer: Resolve (ASSIGNED | IN_PROGRESS → RESOLVED_DEV) — assigned developer only */}
            {isDeveloper && (isAssigned || isInProgress) && !isBlocked && defect.assigned_to_user_id === user?.userId && (
              <button
                onClick={() => setResolveOpen(true)}
                className="action-btn action-btn-blue"
                title="Resolve as Developer"
              >
                <span className="material-symbols-outlined text-sm">bug_report</span>
              </button>
            )}
            {/* Block (TRIAGED | ASSIGNED | IN_PROGRESS | REGRESSED) — assigned dev or manager */}
            {(isDeveloper || canManage) && (isTriaged || isAssigned || isInProgress) && !isBlocked && (canManage || defect.assigned_to_user_id === user?.userId) && (
              <button
                onClick={() => setBlockOpen(true)}
                className="action-btn action-btn-red"
                title="Flag as Blocked"
              >
                <span className="material-symbols-outlined text-sm">block</span>
              </button>
            )}
            {/* Unblock — clears the is_blocked flag */}
            {(isDeveloper || canManage) && isBlocked && (
              <button
                onClick={() => setUnblockOpen(true)}
                className="action-btn action-btn-green"
                title="Unblock"
              >
                <span className="material-symbols-outlined text-sm">lock_open</span>
              </button>
            )}
            {/* Resume Work (RESOLVED_DEV → IN_PROGRESS) — assigned dev or manager */}
            {(isDeveloper || canManage) && isResolved && (canManage || defect.assigned_to_user_id === user?.userId) && (
              <button
                onClick={() => setResumeWorkOpen(true)}
                className="action-btn action-btn-orange"
                title="Resume Work"
              >
                <span className="material-symbols-outlined text-sm">undo</span>
              </button>
            )}
            {/* QA Review (RESOLVED_DEV → QA_PASSED | IN_PROGRESS) — QA-flagged developers only */}
            {isQa && defect.status === "RESOLVED_DEV" && (
              <>
                <button
                  onClick={() => setQaReviewOpen(true)}
                  className="action-btn action-btn-teal"
                  title="QA Review — Pass / Fail"
                >
                  <span className="material-symbols-outlined text-sm">verified</span>
                </button>
              </>
            )}
            {/* Flag Retest (QA_PASSED → READY_FOR_VERIFICATION) — gated behind QA review */}
            {canManage && isQaPassed && (
              <button
                onClick={() => flagRetestMut.mutate()}
                className="action-btn action-btn-amber"
                title="Send for Verification"
              >
                <span className="material-symbols-outlined text-sm">history_edu</span>
              </button>
            )}
            {/* Reassign active defect to another developer (ASSIGNED | IN_PROGRESS) — TEST_LEAD only */}
            {canManage && (isAssigned || isInProgress) && !isBlocked && (
              <button
                onClick={() => setReassignOpen(true)}
                className="action-btn action-btn-purple"
                title="Reassign to another developer"
              >
                <span className="material-symbols-outlined text-sm">swap_horiz</span>
              </button>
            )}
            {/* Flag Retest from NEW or non-terminal */}
            {canManage && canRetestFromAnyState && (
              <button
                onClick={() => handleUntriagedAction("retest")}
                className="action-btn action-btn-blue"
                title="Flag for retesting"
              >
                <span className="material-symbols-outlined text-sm">fact_check</span>
              </button>
            )}
            {/* Flag Blocked from NEW — hidden when already blocked */}
            {canManage && isNew && !isBlocked && (
              <button
                onClick={() => handleUntriagedAction("block")}
                className="action-btn action-btn-red"
                title="Flag as blocked"
              >
                <span className="material-symbols-outlined text-sm">block</span>
              </button>
            )}
            {/* Quick Verify — immediately prompt pass/fail (READY_FOR_VERIFICATION) */}
            {/* Hidden when the defect is enrolled in an active retest run — execution results will auto-resolve it */}
            {(isTester || canManage) && isReady && !defect.inActiveRetestRun && (
              <>
                <button
                  onClick={() => setQuickVerifyResultAction("passed")}
                  className="action-btn action-btn-green"
                  title="Quick Verify — Pass"
                >
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                </button>
                <button
                  onClick={() => setQuickVerifyResultAction("failed")}
                  className="action-btn action-btn-red"
                  title="Quick Verify — Fail"
                >
                  <span className="material-symbols-outlined text-sm">cancel</span>
                </button>
              </>
            )}

            {/* Business Owner: Accept (READY_FOR_VERIFICATION → CLOSED) */}
            {isBusinessOwner && isReady && (
              <button
                onClick={() => setBizAcceptOpen(true)}
                className="action-btn action-btn-green"
                title="Accept (Business)"
              >
                <span className="material-symbols-outlined text-sm">approval</span>
              </button>
            )}
            {/* Business Owner | TEST_LEAD: Reject (READY_FOR_VERIFICATION → ASSIGNED) */}
            {(isBusinessOwner || canManage) && isReady && (
              <button
                onClick={() => setRejectOpen(true)}
                className="action-btn action-btn-red"
                title="Reject — Escalate to ASSIGNED (regression +1, formal rejection, retest traces cleared)"
              >
                <span className="material-symbols-outlined text-sm">thumb_down</span>
              </button>
            )}
            {/* Reschedule Retest (READY_FOR_VERIFICATION → RESOLVED_DEV) */}
            {canManage && isReady && (
              <button
                onClick={() => setRescheduleOpen(true)}
                className="action-btn action-btn-orange"
                title="Reschedule — Soft return to RESOLVED_DEV (no regression penalty, keeps dev progress)"
              >
                <span className="material-symbols-outlined text-sm">schedule</span>
              </button>
            )}
            {/* Submit for Business Decision */}
            {canManage && !isClosed && !isNew && !isPendingBiz && (
              <button
                onClick={() => setShowBusinessDecisionDialog(true)}
                className="action-btn action-btn-purple"
                title="Submit for Business Decision"
              >
                <span className="material-symbols-outlined text-sm">pending_actions</span>
              </button>
            )}
            {/* Business Owner: Accept/Reject Pending Biz Decision */}
            {isBusinessOwner && isPendingBiz && (
              <>
                <button
                  onClick={() => setAcceptBizRiskOpen(true)}
                  className="action-btn action-btn-purple"
                  title={defect.decision_type === "risk_waiver" ? "Accept as Business Risk" : "Accept by Agreement"}
                >
                  <span className="material-symbols-outlined text-sm">approval</span>
                </button>
                <button
                  onClick={() => setRejectBizOpen(true)}
                  className="action-btn action-btn-red"
                  title={defect.decision_type === "risk_waiver" ? "Reject Risk Waiver" : "Reject Business Review"}
                >
                  <span className="material-symbols-outlined text-sm">thumb_down</span>
                </button>
              </>
            )}
            {/* Add Comment — always available */}
            <button
              onClick={() => setNoteOpen(true)}
              className="action-btn action-btn-neutral"
              title="Add Comment"
            >
              <span className="material-symbols-outlined text-sm">comment</span>
            </button>
          </div>
        </td>
      </tr>
      <tr className={`${expanded ? "" : "hidden"}`}>
        <td className="p-0" colSpan={7}>
          <div className="mx-lg mb-md border border-outline-variant rounded-xl overflow-hidden shadow-sm bg-surface-container-lowest">
            {/* Header with Stepper */}
            <div className="p-lg border-b border-outline-variant bg-surface">
              <div className="flex items-center justify-between mb-md">
                <div className="min-w-0 flex-1">
                  <h3 className="font-title-sm text-title-sm text-on-surface truncate">
                    DEF-{defect.id} — {defect.testCase?.title ?? `Test Case #${defect.test_case_id}`}
                  </h3>
                  {defect.inActiveRetestRun && (role === "DEVELOPER" || role === "TEST_LEAD" || role === "ADMIN") && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold uppercase tracking-wider" title="This defect is part of an active retest run">
                      Retest
                    </span>
                  )}
                </div>
                <span className={`shrink-0 ml-md inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${activeTab === "business" && DEV_INTERNAL_STATUSES.has(defect.status) ? MASKED_BADGE : statusBadgeClass(defect)}`}>
                  <span className="material-symbols-outlined text-sm">{isBlocked ? "block" : (statusIcon[defect.status] ?? "circle")}</span>
                  {activeTab === "business" && DEV_INTERNAL_STATUSES.has(defect.status) ? "With Development" : isBlocked ? "Blocked" : (statusDisplay[defect.status] ?? defect.status)}
                </span>
              </div>
              <Stepper steps={statusSteps} currentIndex={currentStatusIdx} completedIndices={completedStatusIndices} />

              {isRegressed && activeTab !== "full" && (
                <div className={`mt-md flex items-center gap-2 px-md py-sm rounded-lg ${activeTab === "developer" ? "bg-red-50 border border-red-200" : "bg-orange-50 border border-orange-200"}`}>
                  <span className="material-symbols-outlined text-sm text-red-600">warning</span>
                  <span className="text-xs font-semibold text-red-700">
                    Previously rejected {defect.regression_index} time{defect.regression_index === 1 ? "" : "s"} — returned for rework
                  </span>
                </div>
              )}

              {/* Tab Menu */}
              <div className="flex gap-1 mt-md">
                <button
                  onClick={() => setActiveDetailTab("overview")}
                  className={`px-md py-sm text-xs font-medium rounded-md transition-colors ${activeDetailTab === "overview" ? "bg-secondary-container/20 text-secondary" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"}`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveDetailTab("steps")}
                  className={`px-md py-sm text-xs font-medium rounded-md transition-colors ${activeDetailTab === "steps" ? "bg-secondary-container/20 text-secondary" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"}`}
                >
                  Test Steps
                </button>
                <button
                  onClick={() => setActiveDetailTab("activity")}
                  className={`px-md py-sm text-xs font-medium rounded-md transition-colors ${activeDetailTab === "activity" ? "bg-secondary-container/20 text-secondary" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"}`}
                >
                  Activity
                </button>
              </div>
            </div>

            {/* Tab Content */}
            <div className="p-lg">
              {activeDetailTab === "overview" && (
                <>
                  {(activeTab === "developer" && isRegressed) && (
                    <DeveloperRejectionBanner defect={defect} />
                  )}

                  {/* KPI Row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg">
                    <div className="bg-surface-container-low rounded-lg px-md py-sm border border-outline-variant/40">
                      <p className="text-[10px] font-bold text-outline uppercase tracking-wider">Lifetime Age</p>
                      <p className="font-title-sm text-title-sm text-on-surface mt-0.5">
                        {Math.floor((Date.now() - new Date(defect.created_at).getTime()) / (1000 * 60 * 60 * 24))}d
                      </p>
                    </div>
                    <div className="bg-surface-container-low rounded-lg px-md py-sm border border-outline-variant/40">
                      <p className="text-[10px] font-bold text-outline uppercase tracking-wider">Severity</p>
                      <p className={`font-title-sm text-title-sm mt-0.5 ${severityColors[defect.severity ?? ""] ?? "text-on-surface"}`}>
                        {defect.severity ?? "—"}
                      </p>
                    </div>
                    <div className="bg-surface-container-low rounded-lg px-md py-sm border border-outline-variant/40">
                      <p className="text-[10px] font-bold text-outline uppercase tracking-wider">Priority</p>
                      <p className="font-title-sm text-title-sm text-on-surface mt-0.5">{defect.priority ?? "—"}</p>
                    </div>
                    <div className="bg-surface-container-low rounded-lg px-md py-sm border border-outline-variant/40">
                      <p className="text-[10px] font-bold text-outline uppercase tracking-wider">Regressions</p>
                      <p className="font-title-sm text-title-sm text-on-surface mt-0.5">{defect.regression_index}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-lg">
                    <div className="space-y-md">
                      <div>
                        <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Test Scenario</p>
                        <p className="font-body-sm text-body-sm text-on-surface font-medium">{defect.testCase?.useCase?.name ?? `Scenario #${defect.testCase?.use_case_id}`}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Test Case</p>
                        <p className="font-body-sm text-body-sm text-on-surface">{defect.testCase?.title ?? `Test Case #${defect.test_case_id}`}</p>
                      </div>
                      {stepInfo.instruction && (
                        <div className="px-md py-sm bg-red-50 border border-red-100 rounded-lg">
                          <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider mb-xs flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">error</span>
                            Failed Step
                          </p>
                          <p className="font-body-sm text-body-sm text-red-600 font-semibold">Step {stepInfo.stepNumber}: {stepInfo.instruction}</p>
                        </div>
                      )}
                      {defect.testCase?.acceptance_criteria && (
                        <div>
                          <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Acceptance Criteria</p>
                          <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">{defect.testCase.acceptance_criteria}</p>
                        </div>
                      )}
                      {defect.execution?.notes && (
                        <div>
                          <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Execution Notes</p>
                          <p className="font-body-sm text-body-sm text-on-surface">{defect.execution.notes}</p>
                        </div>
                      )}
                    </div>
                    <div className="space-y-md">
                      <div className="bg-surface-container-low rounded-lg px-md py-sm border border-outline-variant/40">
                        <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Execution Details</p>
                        {defect.execution ? (
                          <div className="space-y-0.5">
                            <p className="font-body-sm text-body-sm text-on-surface">Tester: {defect.execution.tester?.name ?? defect.execution.tester_name ?? "Unknown"}</p>
                            <p className="font-body-sm text-body-sm text-on-surface">Result: <span className={`font-semibold ${defect.execution.overall_result === "failed" ? "text-error" : defect.execution.overall_result === "passed" ? "text-green-600" : ""}`}>{defect.execution.overall_result ?? "N/A"}</span></p>
                            <p className="font-body-sm text-body-sm text-on-surface">Executed: {defect.execution.executed_at ? new Date(defect.execution.executed_at).toLocaleString() : "N/A"}</p>
                          </div>
                        ) : (<p className="font-body-sm text-body-sm text-on-surface-variant">No execution record available.</p>)}
                      </div>

                      <div>
                        <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Tester Notes</p>
                        <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">{defect.tester_notes ?? "No tester notes."}</p>
                      </div>

                      {defect.root_cause_category && (
                        <div>
                          <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Root Cause</p>
                          <p className="font-body-sm text-body-sm text-on-surface">{defect.root_cause_category}</p>
                        </div>
                      )}

                      {defect.accepted_by_business_note && (
                        <div>
                          <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Acceptance Note</p>
                          <p className="font-body-sm text-body-sm text-on-surface">{defect.accepted_by_business_note}</p>
                        </div>
                      )}

                      {defect.retest_reason && (
                        <div>
                          <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Retest Reason</p>
                          <p className="font-body-sm text-body-sm text-on-surface">{defect.retest_reason}</p>
                        </div>
                      )}

                      {defect.retests && defect.retests.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-xs">Retest History</p>
                          <div className="space-y-1">
                            {defect.retests.map((rt) => (
                              <div key={rt.id} className="flex items-center gap-sm text-xs px-md py-sm bg-surface-container-low rounded-lg border border-outline-variant/40">
                                <span className={`font-bold uppercase ${rt.retest_result === "passed" ? "text-green-600" : rt.retest_result === "failed" ? "text-error" : "text-on-surface-variant"}`}>
                                  {rt.retest_result === "passed" ? "PASS" : rt.retest_result === "failed" ? "FAIL" : "PENDING"}
                                </span>
                                {rt.retest_notes && <span className="text-on-surface-variant">— {rt.retest_notes}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {defect.regression_index > 0 && activeTab !== "business" && (
                        <div className="px-md py-sm bg-orange-50 border border-orange-200 rounded-lg">
                          <p className="text-[10px] font-bold text-orange-700 uppercase tracking-wider mb-xs flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">warning</span>
                            Previously Failed Verification
                          </p>
                          <p className="font-body-sm text-body-sm text-orange-700">
                            This defect has been rejected <strong>{defect.regression_index}</strong> time{defect.regression_index === 1 ? "" : "s"} and returned to the developer for rework.
                          </p>
                        </div>
                      )}

                      {isBusinessOwner && isPendingBiz && (
                        <BusinessOwnerDecisionPanel
                          decisionType={defect.decision_type}
                          onAccept={() => setAcceptBizRiskOpen(true)}
                          onReject={() => setRejectBizOpen(true)}
                        />
                      )}

                      <div className="flex items-center gap-lg pt-xs text-[11px] text-on-surface-variant border-t border-outline-variant/30">
                        <span>Created: {new Date(defect.created_at).toLocaleString()}</span>
                        <span>Updated: {new Date(defect.updated_at).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeDetailTab === "steps" && (
                <div>
                  {defect.execution?.stepResults && defect.execution.stepResults.length > 0 ? (
                    <div className="space-y-sm">
                      {defect.execution.stepResults.map((sr) => {
                        const isFailed = sr.passed === false;
                        const matchesDefect = stepInfo.stepNumber != null && String(sr.step?.step_number) === stepInfo.stepNumber;
                        return (
                          <div key={sr.id} className={`rounded-lg border-l-4 p-sm text-sm transition-all ${matchesDefect ? "border-error bg-red-50 shadow-sm" : "opacity-50"}`}>
                            <div className="flex items-center gap-sm mb-xs">
                              <span className="font-semibold text-xs">Step {sr.step?.step_number ?? sr.step_id}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${matchesDefect ? "bg-red-100 text-red-800" : isFailed ? "bg-red-50 text-red-400" : "bg-green-100 text-green-800"}`}>{isFailed ? "FAIL" : "PASS"}</span>
                            </div>
                            <p className="text-on-surface mb-xs"><span className="font-medium">Instruction:</span> {sr.step?.instruction ?? "N/A"}</p>
                            {sr.step?.expected_result && <p className="text-on-surface mb-xs"><span className="font-medium">Expected:</span> {sr.step.expected_result}</p>}
                            {sr.actual_result && <p className="text-on-surface mb-xs"><span className="font-medium">Actual:</span> {sr.actual_result}</p>}
                            {sr.comments && <p className="text-on-surface-variant text-xs mt-1"><span className="font-medium">Comments:</span> {sr.comments}</p>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (<p className="font-body-sm text-body-sm text-on-surface-variant text-center py-lg">No test steps recorded.</p>)}
                </div>
              )}

              {activeDetailTab === "activity" && (
                <div>
                  {/* Internal note filter toggle */}
                  {(role === "DEVELOPER" || role === "TEST_LEAD" || role === "ADMIN") && (
                    <div className="flex items-center gap-xs mb-sm">
                      {(["all", "internal", "standard"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setDevNoteFilter(v)}
                          className={`text-[11px] px-sm py-xs rounded-full font-label-sm transition-colors ${devNoteFilter === v ? "bg-secondary text-on-secondary" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"}`}
                        >
                          {v === "all" ? "Show All" : v === "internal" ? "Internal Only" : "Business Only"}
                        </button>
                      ))}
                    </div>
                  )}
                  {defect.notes && defect.notes.length > 0 ? (
                    <div className="space-y-sm max-h-80 overflow-y-auto pr-md">
                      {(() => {
                        const seen = new Set<string>();
                        const shownStatuses = new Set<string>();
                        const microNoise = new Set(['ASSIGNED', 'IN_PROGRESS', 'RESOLVED_DEV']);
                        const deduped: DefectNote[] = [];

                        for (const n of defect.notes ?? []) {
                          const key = `${n.id}-${n.note}-${n.created_at}`;
                          if (seen.has(key)) continue;
                          seen.add(key);

                          // Visibility: hide internal notes from non-technical roles
                          if ((n.is_internal ?? false) && role !== "DEVELOPER" && role !== "TEST_LEAD" && role !== "ADMIN") continue;

                          // Technical role filter toggle
                          if (role === "DEVELOPER" || role === "TEST_LEAD" || role === "ADMIN") {
                            if (devNoteFilter === "internal" && !(n.is_internal ?? false)) continue;
                            if (devNoteFilter === "standard" && (n.is_internal ?? false)) continue;
                          }

                          if (activeTab !== "business" || !n.is_system_note) {
                            deduped.push(n);
                            continue;
                          }

                          if (n.action === 'CREATED' || n.action === 'NEW') {
                            deduped.push(n);
                            continue;
                          }

                          const lowerNote = n.note.toLowerCase();
                          if (
                            lowerNote.includes('root cause') ||
                            lowerNote.includes('regression index') ||
                            lowerNote.includes('assignee') ||
                            lowerNote.includes('assigned to')
                          ) {
                            continue;
                          }

                          const statusMatch = n.note.match(/to\s+['"\[]?([A-Z_]+)['"\]]?/i);

                          if (statusMatch && statusMatch[1]) {
                            const extractedStatus = statusMatch[1].toUpperCase();

                            if (extractedStatus === 'NEW') {
                              deduped.push(n);
                              continue;
                            }

                            if (microNoise.has(extractedStatus)) {
                              if (['IN_PROGRESS', 'RESOLVED_DEV'].includes(extractedStatus)) {
                                continue;
                              }
                              if (extractedStatus === 'ASSIGNED') {
                                deduped.push(n);
                              }
                              continue;
                            }

                            shownStatuses.add(extractedStatus);
                            deduped.push(n);
                            continue;
                          }

                          deduped.push(n);
                        }
                        return deduped;
                      })().map((n) => {
                        const isInternalNote = n.is_internal ?? false;
                        return (
                          <div key={n.id} className={`rounded-lg px-md py-sm text-sm ${
                            isInternalNote
                              ? "bg-amber-50 border border-amber-200"
                              : n.is_system_note
                              ? "bg-surface-container-low border border-outline-variant/30"
                              : "bg-surface-container-high"
                          }`}>
                            <div className="flex items-start gap-2">
                              {isInternalNote && (
                                <span className="text-amber-700 mt-0.5 flex-shrink-0 material-symbols-outlined text-sm">lock</span>
                              )}
                              {!isInternalNote && n.is_system_note && (
                                <span className="text-on-surface-variant mt-0.5 flex-shrink-0 material-symbols-outlined text-sm">settings</span>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className={`${isInternalNote ? "text-amber-900" : n.is_system_note ? "italic text-on-surface-variant text-xs" : "text-on-surface"}`}>
                                  {n.note}
                                </p>
                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                  <span className="text-[10px] text-on-surface-variant">{n.addedBy?.name ?? `User #${n.added_by_user_id ?? "system"}`}</span>
                                  <span className="text-[10px] text-on-surface-variant">&middot;</span>
                                  <span className="text-[10px] text-on-surface-variant">{new Date(n.created_at).toLocaleString()}</span>
                                  {isInternalNote && (
                                    <><span className="text-[10px] text-on-surface-variant">&middot;</span>
                                    <span className="text-[10px] font-bold text-amber-700">Internal Dev Note</span></>
                                  )}
                                  {!isInternalNote && n.is_system_note && (
                                    <><span className="text-[10px] text-on-surface-variant">&middot;</span>
                                    <span className="text-[10px] text-on-surface-variant italic">System Note</span></>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (<p className="font-body-sm text-body-sm text-on-surface-variant text-center py-lg">No activity recorded.</p>)}
                </div>
              )}
            </div>
          </div>
        </td>
      </tr>

      {/* Classify Dialog */}
      {classifyOpen && (
        <Dialog onClose={() => setClassifyOpen(false)} title={isNew ? "Classify Defect" : "Reclassify Defect"}>
          <ClassifyForm
            projectId={defect.project_id}
            onSave={(data) => {
              classifyMut.mutate(data, {
                onSuccess: () => {
                  toast.success("Defect classified");
                  setClassifyOpen(false);
                  const next = pendingAfterClassify;
                  setPendingAfterClassify(null);
                  invalidateProject();
                  if (data.blockReason) {
                    flagBlockedNewMut.mutate(data.blockReason);
                  }
                  if (next === "assign" && data.assigned_to_user_id === undefined) {
                    proceedWithAction("assign");
                  } else if (next && next !== "assign") {
                    proceedWithAction(next);
                  }
                },
                onError: (e: Error) => toast.error(e.message),
              });
            }}
            loading={classifyMut.isPending}
            isBlocked={isBlocked}
            showAssignOption={isNew}
          />
        </Dialog>
      )}

      {/* Assign Developer Dialog */}
      {assignOpen && (
        <Dialog onClose={() => setAssignOpen(false)} title="Assign to Developer">
          <AssignDeveloperForm
            projectId={defect.project_id}
            onAssign={(data) => assignMut.mutate(data)}
            loading={assignMut.isPending}
          />
        </Dialog>
      )}

      {/* Reject Dialog */}
      {rejectOpen && (
        <Dialog onClose={() => setRejectOpen(false)} title="Reject Defect">
          <RejectForm
            onSave={(reason) => bizRejectMut.mutate(reason)}
            loading={bizRejectMut.isPending}
          />
        </Dialog>
      )}

      {/* Reschedule Retest Dialog */}
      {rescheduleOpen && (
        <Dialog onClose={() => setRescheduleOpen(false)} title="Reschedule Retest">
          <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg p-md mb-sm">
            <span className="material-symbols-outlined text-orange-700 text-xl flex-shrink-0">schedule</span>
            <p className="font-body-sm text-orange-900">
              Level 1 rollback — sends the defect back to <strong>RESOLVED_DEV</strong> without a regression penalty.
              The developer can make adjustments and re-submit. Use this when the fix mostly works but needs minor changes.
            </p>
          </div>
          <SimpleReasonForm
            label="Reason"
            placeholder="Explain why the retest needs to be rescheduled..."
            confirmLabel="Reschedule"
            confirmClassName="bg-orange-600"
            onSave={(reason) => rescheduleMut.mutate(reason)}
            onCancel={() => setRescheduleOpen(false)}
            loading={rescheduleMut.isPending}
          />
        </Dialog>
      )}

      {/* Resolve Defect Dialog */}
      {resolveOpen && (
        <Dialog onClose={() => setResolveOpen(false)} title="Resolve Defect">
          <ResolveForm
            onSave={(rootCause) => resolveDevMut.mutate(rootCause)}
            onCancel={() => setResolveOpen(false)}
            loading={resolveDevMut.isPending}
          />
        </Dialog>
      )}

      {/* QA Review Dialog */}
      {qaReviewOpen && (
        <Dialog onClose={() => setQaReviewOpen(false)} title="QA Review">
          <QaReviewForm
            onSave={(data) => qaReviewMut.mutate(data)}
            onCancel={() => setQaReviewOpen(false)}
            loading={qaReviewMut.isPending}
          />
        </Dialog>
      )}

      {/* Reassign Dialog */}
      {reassignOpen && (
        <Dialog onClose={() => setReassignOpen(false)} title="Reassign Defect">
          <ReassignForm
            projectId={projectId}
            currentDeveloperId={defect.assigned_to_user_id}
            onSave={(data) => reassignMut.mutate(data)}
            onCancel={() => setReassignOpen(false)}
            loading={reassignMut.isPending}
          />
        </Dialog>
      )}

      {/* Resume Work Dialog */}
      {resumeWorkOpen && (
        <Dialog onClose={() => setResumeWorkOpen(false)} title="Resume Work">
          <SimpleReasonForm
            label="Reason for Resuming Work"
            placeholder="Explain why this defect needs more work..."
            confirmLabel="Resume Work"
            confirmClassName="bg-orange-600"
            onSave={(reason) => resumeWorkMut.mutate(reason)}
            onCancel={() => setResumeWorkOpen(false)}
            loading={resumeWorkMut.isPending}
          />
        </Dialog>
      )}

      {/* Retest Dialog */}
      {retestOpen && (
        <Dialog onClose={() => setRetestOpen(false)} title="Record Retest Result">
          <RetestForm
            onSave={(data) => recordRetestMut.mutate(data)}
            loading={recordRetestMut.isPending}
          />
        </Dialog>
      )}

      {/* Accept Biz Risk Dialog — context-aware based on decision_type */}
      {acceptBizRiskOpen && (
        <Dialog onClose={() => setAcceptBizRiskOpen(false)} title={defect.decision_type === "risk_waiver" ? "Accept as Business Risk" : "Accept by Agreement"}>
          <div className="space-y-md">
            {defect.decision_type === "risk_waiver" ? (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-md">
                <span className="text-xl flex-shrink-0">⚠️</span>
                <p className="font-body-sm text-amber-900">
                  This is a <strong>Risk Waiver</strong> decision. The defect will be marked as a business risk and go-live is authorized. A justification is required for audit purposes.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-3 bg-sky-50 border border-sky-200 rounded-lg p-md">
                <span className="text-xl flex-shrink-0">📋</span>
                <p className="font-body-sm text-sky-900">
                  This is a <strong>Business Review</strong> decision. The defect is accepted by agreement. A justification is required for audit purposes.
                </p>
              </div>
            )}
            <AcceptBizRiskForm
              onSave={(justification) => acceptBizRiskMut.mutate(justification)}
              onCancel={() => setAcceptBizRiskOpen(false)}
              loading={acceptBizRiskMut.isPending}
              decisionType={defect.decision_type}
            />
          </div>
        </Dialog>
      )}

      {/* Reject Business Risk Acceptance Dialog — context-aware based on decision_type */}
      {rejectBizOpen && (
        <Dialog onClose={() => setRejectBizOpen(false)} title={defect.decision_type === "risk_waiver" ? "Reject Risk Waiver" : "Reject Business Review"}>
          <RejectBizAcceptanceForm
            onSave={(reason) => rejectBizAcceptanceMut.mutate(reason)}
            onCancel={() => setRejectBizOpen(false)}
            loading={rejectBizAcceptanceMut.isPending}
            decisionType={defect.decision_type}
          />
        </Dialog>
      )}

      {/* Biz Accept (READY_FOR_VERIFICATION → CLOSED) Dialog */}
      {bizAcceptOpen && (
        <Dialog onClose={() => setBizAcceptOpen(false)} title="Accept Defect">
          <BizAcceptForm
            onSave={(note) => bizAcceptMut.mutate(note)}
            onCancel={() => setBizAcceptOpen(false)}
            loading={bizAcceptMut.isPending}
          />
        </Dialog>
      )}

      {/* Add Comment Dialog */}
      {noteOpen && (
        <Dialog onClose={() => setNoteOpen(false)} title="Add Comment">
          <NoteForm
            canMakeInternal={isDeveloper || canManage}
            defectStatus={defect.status}
            onSave={(note, is_internal) => addNoteMut.mutate({ note, is_internal })}
            loading={addNoteMut.isPending}
          />
        </Dialog>
      )}

      {/* Flag Retest from New Dialog */}
      {flagRetestNewOpen && (
        <Dialog onClose={() => setFlagRetestNewOpen(false)} title="Flag for Retesting">
          <FlagRetestFromNewForm
            onSave={(data) => flagRetestFromNewMut.mutate(data)}
            loading={flagRetestFromNewMut.isPending}
          />
        </Dialog>
      )}

      {/* Flag Blocked Dialog */}
      {flagBlockedNewOpen && (
        <Dialog onClose={() => setFlagBlockedNewOpen(false)} title="Flag as Blocked">
          <FlagBlockedForm
            onSave={(reason) => flagBlockedNewMut.mutate(reason)}
            loading={flagBlockedNewMut.isPending}
          />
        </Dialog>
      )}

      {/* Submit for Business Decision Dialog */}
      {showBusinessDecisionDialog && (
        <Dialog onClose={() => setShowBusinessDecisionDialog(false)} title="Submit for Business Decision">
          <BusinessDecisionForm
            onSave={(data) => submitBusinessDecisionMut.mutate(data)}
            loading={submitBusinessDecisionMut.isPending}
          />
        </Dialog>
      )}

      {/* Quick Verify Result Dialog (direct pass/fail from READY_FOR_VERIFICATION) */}
      {quickVerifyResultAction && (
        <Dialog onClose={() => setQuickVerifyResultAction(null)} title={quickVerifyResultAction === "passed" ? "Quick Verify — Pass" : "Quick Verify — Fail"}>
          <QuickVerifyResultForm
            result={quickVerifyResultAction}
            onSave={(data) => quickVerifyMut.mutate(data)}
            onCancel={() => setQuickVerifyResultAction(null)}
            loading={quickVerifyMut.isPending}
          />
        </Dialog>
      )}

      {/* Block Dialog */}
      {blockOpen && (
        <Dialog onClose={() => setBlockOpen(false)} title="Flag as Blocked">
          <SimpleReasonForm
            label="Block Reason"
            placeholder="Describe what is blocking progress on this defect..."
            confirmLabel="Flag as Blocked"
            confirmClassName="bg-red-600"
            onSave={(reason) => blockMut.mutate(reason)}
            onCancel={() => setBlockOpen(false)}
            loading={blockMut.isPending}
          />
        </Dialog>
      )}

      {/* Unblock Dialog */}
      {unblockOpen && (
        <Dialog onClose={() => setUnblockOpen(false)} title="Unblock Defect">
          <SimpleReasonForm
            label="Unblock Reason"
            placeholder="Describe what was resolved or changed to unblock this defect..."
            confirmLabel="Unblock"
            confirmClassName="bg-green-600"
            onSave={(reason) => unblockMut.mutate(reason)}
            onCancel={() => setUnblockOpen(false)}
            loading={unblockMut.isPending}
          />
        </Dialog>
      )}

      {/* Untriaged Warning Dialog */}
      {untriagedAction && (
        <Dialog onClose={() => setUntriagedAction(null)} title="Defect Not Triaged">
          <div className="space-y-md">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-md">
              <span className="material-symbols-outlined text-amber-600 text-xl flex-shrink-0">warning</span>
              <div>
                <p className="font-label-md text-label-md text-amber-900 mb-xs">No severity or priority assigned</p>
                <p className="font-body-sm text-body-sm text-amber-800">
                  This defect is still in NEW status without a Severity or Priority classification.
                  It is strongly recommended to triage the defect first so downstream teams have the full picture.
                  {untriagedAction === "assign" && " Assignment requires the defect to be triaged first."}
                </p>
              </div>
            </div>
            <div className="flex gap-sm">
              <button
                onClick={(e) => { e.stopPropagation(); handleClassifyThenAction(); }}
                className="flex-1 py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 transition-colors"
              >
                Triage First
              </button>
              {untriagedAction !== "assign" && (
                <button
                  onClick={() => proceedWithAction(untriagedAction)}
                  className="flex-1 py-sm bg-surface-container-high text-on-surface rounded-lg font-label-md hover:bg-outline-variant transition-colors"
                >
                  Proceed Anyway
                </button>
              )}
              <button
                onClick={() => setUntriagedAction(null)}
                className="py-sm px-md bg-surface text-on-surface-variant rounded-lg font-label-md hover:bg-surface-container-high transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

function Dialog({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg space-y-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-title-sm text-title-sm">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-surface-container-low">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

function ClassifyForm({ projectId, onSave, loading, isBlocked, showAssignOption }: { projectId: number; onSave: (d: { severity: string; priority: string; assigned_to_user_id?: number; blockReason?: string }) => void; loading: boolean; isBlocked?: boolean; showAssignOption?: boolean }) {
  const [severity, setSeverity] = useState("Major");
  const [priority, setPriority] = useState("P2");
  const [assignedId, setAssignedId] = useState<number | null>(null);
  const [flagBlocked, setFlagBlocked] = useState(false);
  const [blockReason, setBlockReason] = useState("");

  const { data: assignments } = useQuery({
    queryKey: ["project-users", projectId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/projects/${projectId}/users`),
  });
  const developers = assignments?.filter((a) => a.role === "DEVELOPER") ?? [];

  return (
    <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onSave({ severity, priority, ...(assignedId != null ? { assigned_to_user_id: assignedId } : {}), ...(flagBlocked && blockReason.trim() ? { blockReason: blockReason.trim() } : {}) }); }} className="space-y-md">
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Severity</label>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm">
          <option value="Critical">Critical</option>
          <option value="Major">Major</option>
          <option value="Minor">Minor</option>
          <option value="Cosmetic">Cosmetic</option>
        </select>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Priority</label>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm">
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
          <option value="P4">P4</option>
        </select>
      </div>
      {showAssignOption && (
        <div className="space-y-sm">
          <label className="font-label-sm text-label-sm">Assign to Developer (optional)</label>
          <select value={assignedId ?? ""} onChange={(e) => setAssignedId(e.target.value ? Number(e.target.value) : null)} className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm">
            <option value="">— Not assigned —</option>
            {developers.map((d) => (
              <option key={d.user_id} value={d.user_id}>{d.user.name} ({d.user.username})</option>
            ))}
          </select>
        </div>
      )}
      {!isBlocked && (
        <div className="border-t border-outline-variant/40 pt-md">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={flagBlocked} onChange={(e) => { setFlagBlocked(e.target.checked); if (!e.target.checked) setBlockReason(""); }} className="w-4 h-4 rounded border-outline-variant text-red-600 focus:ring-red-500" />
            <span className="font-label-sm text-label-sm">Flag as Blocked</span>
          </label>
          {flagBlocked && (
            <div className="space-y-sm mt-sm">
              <label className="font-label-sm text-label-sm">Block Reason *</label>
              <textarea value={blockReason} onChange={(e) => setBlockReason(e.target.value)} className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Describe the environmental crash, third-party failure, or missing requirement..." required />
            </div>
          )}
        </div>
      )}
      <button type="submit" disabled={loading || (flagBlocked && !blockReason.trim())} className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Saving..." : "Classify"}
      </button>
    </form>
  );
}

function RejectForm({ onSave, loading }: { onSave: (reason: string) => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  const charsLeft = 10 - reason.trim().length;
  const isValid = reason.trim().length >= 10;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave(reason.trim()); }} className="space-y-md">
      <div className="flex items-start gap-3 bg-error-container/20 border border-error-container/40 rounded-lg p-md mb-sm">
        <span className="material-symbols-outlined text-error text-xl flex-shrink-0">warning</span>
        <p className="font-body-sm text-error">
          This will return the defect to the <strong>ASSIGNED</strong> state and increment its regression counter.
          The developer will need to rework it. A detailed reason is required for audit purposes.
        </p>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Rejection Reason *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Explain why this retest failed and what needs to be reworked..." required />
        <p className={`text-label-xs ${charsLeft <= 0 ? "text-success" : "text-on-surface-variant/60"}`}>
          {charsLeft <= 0 ? "Minimum length met" : `${charsLeft} characters remaining (minimum 10)`}
        </p>
      </div>
      <button type="submit" disabled={loading || !isValid} className="w-full py-sm bg-error text-on-error rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Saving..." : "Reject & Return to Assigned"}
      </button>
    </form>
  );
}

function RetestForm({ onSave, loading }: { onSave: (d: { retestResult: string; retestNotes: string }) => void; loading: boolean }) {
  const [result, setResult] = useState("passed");
  const [notes, setNotes] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ retestResult: result, retestNotes: notes }); }} className="space-y-md">
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Result</label>
        <select value={result} onChange={(e) => setResult(e.target.value)} className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm">
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-20 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Retest notes..." />
      </div>
      <button type="submit" disabled={loading} className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Saving..." : "Record Retest"}
      </button>
    </form>
  );
}

function SortTh({ field, label, sortField, sortDir, onSort }: { field: string; label: string; sortField: string; sortDir: string; onSort: (f: string) => void }) {
  const isActive = sortField === field;
  return (
    <th
      className="px-md py-sm text-[10px] font-bold text-outline uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-on-surface transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-0.5">
        {label}
        <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          {isActive ? (sortDir === "asc" ? "arrow_upward_alt" : "arrow_downward_alt") : "unfold_more"}
        </span>
      </div>
    </th>
  );
}

function NoteForm({ onSave, loading, canMakeInternal, defectStatus }: { onSave: (note: string, is_internal: boolean) => void; loading: boolean; canMakeInternal: boolean; defectStatus: string }) {
  const [note, setNote] = useState("");
  const [isInternal, setIsInternal] = useState(
    canMakeInternal && ["ASSIGNED", "IN_PROGRESS", "RESOLVED_DEV"].includes(defectStatus),
  );
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) onSave(note.trim(), isInternal); }} className="space-y-md">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
        placeholder={isInternal ? "Internal note — not visible to Business Owners or Testers..." : "Enter your comment..."}
        required
      />
      {canMakeInternal && (
        <div className="flex items-center justify-between p-sm rounded-lg border border-outline-variant bg-surface-container-low">
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-sm text-on-surface-variant">lock</span>
            <div>
              <p className="text-label-sm font-label-sm text-on-surface">Internal Note</p>
              <p className="text-[10px] text-on-surface-variant">Hidden from Business Owners &amp; Testers</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isInternal}
            onClick={() => setIsInternal(!isInternal)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isInternal ? "bg-secondary" : "bg-outline-variant"}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${isInternal ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
          </button>
        </div>
      )}
      {isInternal && (
        <div className="flex items-center gap-xs px-sm py-xs rounded bg-amber-50 border border-amber-200">
          <span className="material-symbols-outlined text-sm text-amber-700">visibility_off</span>
          <p className="text-[11px] text-amber-800">This note will only be visible to Developers, Test Leads and Admins.</p>
        </div>
      )}
      <button
        type="submit"
        disabled={loading || !note.trim()}
        className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50"
      >
        {loading ? "Saving..." : isInternal ? "Add Internal Note" : "Add Comment"}
      </button>
    </form>
  );
}

function AssignDeveloperForm({ projectId, onAssign, loading }: { projectId: number; onAssign: (data: { assigned_to_user_id: number; support_ticket_number?: string }) => void; loading: boolean }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ticketNumber, setTicketNumber] = useState("");

  const { data: assignments } = useQuery({
    queryKey: ["project-users", projectId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/projects/${projectId}/users`),
  });

  const developers = assignments?.filter((a) => a.role === "DEVELOPER") ?? [];

  return (
    <div className="space-y-md">
      {developers.length === 0 ? (
        <p className="font-body-sm text-on-surface-variant">
          No developers are assigned to this project. Add a team member with the DEVELOPER role first.
        </p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (selectedId) onAssign({ assigned_to_user_id: selectedId, ...(ticketNumber ? { support_ticket_number: ticketNumber } : {}) }); }} className="space-y-md">
          <div className="space-y-sm">
            <label className="font-label-sm text-label-sm">Select Developer</label>
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm"
            >
              <option value="" disabled>Choose a developer...</option>
              {developers.map((d) => (
                <option key={d.user_id} value={d.user_id}>
                  {d.user.name} ({d.user.username})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-sm">
            <label className="font-label-sm text-label-sm">External Ticket Ref (optional)</label>
            <input
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              placeholder="e.g. JIRA-123, SNOW-INC-456"
              className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm"
            />
          </div>
          <button type="submit" disabled={loading || !selectedId} className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
            {loading ? "Assigning..." : "Assign"}
          </button>
        </form>
      )}
    </div>
  );
}

function FlagRetestFromNewForm({ onSave, loading }: { onSave: (data: { reason: string; targetVerificationRunId?: number }) => void; loading: boolean }) {
  const [reason, setReason] = useState("Transient issue — flagging for verification");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ reason: reason.trim() }); }} className="space-y-md">
      <p className="font-body-sm text-on-surface-variant">
        This will move the defect directly to <strong>Ready for Verification</strong> and create a retest tracking record.
      </p>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Reason</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-20 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Why is this being flagged for retest?" required />
      </div>
      <button type="submit" disabled={loading} className="w-full py-sm bg-blue-600 text-white rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Flagging..." : "Flag for Retesting"}
      </button>
    </form>
  );
}

function FlagBlockedForm({ onSave, loading }: { onSave: (reason: string) => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onSave(reason.trim()); }} className="space-y-md">
      <p className="font-body-sm text-on-surface-variant">
        Moving this NEW defect to <strong>Blocked</strong>. Provide a mandatory explanation of the blocking issue.
      </p>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Block Reason *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Describe the environmental crash, third-party failure, or missing requirement..." required />
      </div>
      <button type="submit" disabled={loading || !reason.trim()} className="w-full py-sm bg-red-600 text-white rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Flagging..." : "Flag as Blocked"}
      </button>
    </form>
  );
}

function BusinessDecisionForm({ onSave, loading }: { onSave: (data: { justification: string; decisionType: "risk_waiver" | "business_review" }) => void; loading: boolean }) {
  const [justification, setJustification] = useState("");
  const [decisionType, setDecisionType] = useState<"risk_waiver" | "business_review">("business_review");
  const charsLeft = 10 - justification.length;
  const isValid = justification.trim().length >= 10;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave({ justification: justification.trim(), decisionType }); }} className="space-y-md">
      <p className="font-body-sm text-on-surface-variant">
        This will route the defect to <strong>Pending Business Decision</strong> for Business Owner approval.
        Choose whether this is a risk waiver or a general business review.
      </p>

      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Decision Type</label>
        <div className="flex gap-md">
          <label className={`flex-1 flex items-start gap-2 p-md rounded-lg border cursor-pointer transition-colors ${decisionType === "business_review" ? "bg-secondary-container/20 border-secondary" : "bg-surface border-outline-variant hover:bg-surface-container-high"}`}>
            <input type="radio" name="decisionType" value="business_review" checked={decisionType === "business_review"} onChange={() => setDecisionType("business_review")} className="mt-0.5" />
            <div>
              <span className="font-label-sm text-label-sm">Business Review</span>
              <p className="text-xs text-on-surface-variant">Request Business Owner decision on how to proceed</p>
            </div>
          </label>
          <label className={`flex-1 flex items-start gap-2 p-md rounded-lg border cursor-pointer transition-colors ${decisionType === "risk_waiver" ? "bg-amber-50 border-amber-400" : "bg-surface border-outline-variant hover:bg-surface-container-high"}`}>
            <input type="radio" name="decisionType" value="risk_waiver" checked={decisionType === "risk_waiver"} onChange={() => setDecisionType("risk_waiver")} className="mt-0.5" />
            <div>
              <span className="font-label-sm text-label-sm">Risk Waiver</span>
              <p className="text-xs text-on-surface-variant">Request approval to ship a known defect with documented risk acceptance</p>
            </div>
          </label>
        </div>
      </div>

      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Justification *</label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder={decisionType === "risk_waiver" ? "Explain why this defect can be accepted as a known risk (mitigation plan, timeline, etc.)" : "Explain the business context and request Business Owner decision"}
          required
        />
        <p className={`text-label-xs ${charsLeft <= 0 ? "text-success" : "text-on-surface-variant/60"}`}>
          {charsLeft <= 0 ? "Minimum length met" : `${charsLeft} characters remaining (minimum 10)`}
        </p>
      </div>

      {decisionType === "risk_waiver" && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
          <span className="material-symbols-outlined text-amber-600 text-lg flex-shrink-0">warning</span>
          <p className="text-xs text-amber-900">
            Once approved by the Business Owner, this defect will be marked as <strong>PASSED_BY_AGREEMENT</strong> and included in UAT sign-off documentation as a known, accepted risk.
          </p>
        </div>
      )}

      <button type="submit" disabled={loading || !isValid} className="w-full py-sm bg-purple-600 text-white rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Submitting..." : "Submit for Approval"}
      </button>
    </form>
  );
}

function AcceptBizRiskForm({ onSave, onCancel, loading, decisionType }: { onSave: (justification: string) => void; onCancel: () => void; loading: boolean; decisionType?: "risk_waiver" | "business_review" }) {
  const [justification, setJustification] = useState("");
  const charsLeft = 10 - justification.length;
  const isValid = justification.trim().length >= 10;
  const isRiskWaiver = decisionType === "risk_waiver";
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave(justification.trim()); }} className="space-y-md">
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Justification *</label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder={isRiskWaiver ? "Explain why this defect is accepted as a business risk..." : "Explain why this defect is accepted by agreement..."}
          required
        />
        <p className={`text-label-xs ${charsLeft <= 0 ? "text-success" : "text-on-surface-variant/60"}`}>
          {charsLeft <= 0 ? "Minimum length met" : `${charsLeft} characters remaining (minimum 10)`}
        </p>
      </div>
      <div className="flex justify-end gap-md pt-sm">
        <button type="button" onClick={onCancel} className="px-4 py-sm bg-surface border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container-high transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !isValid} className="px-4 py-sm bg-purple-600 text-white rounded-lg font-label-sm hover:brightness-110 disabled:opacity-50 transition-all">
          {loading ? "Submitting..." : isRiskWaiver ? "Confirm & Accept Risk" : "Confirm & Accept"}
        </button>
      </div>
    </form>
  );
}

function BizAcceptForm({ onSave, onCancel, loading }: { onSave: (note: string) => void; onCancel: () => void; loading: boolean }) {
  const [note, setNote] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) onSave(note.trim()); }} className="space-y-md">
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Acceptance Note</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder="Enter an acceptance note..."
        />
      </div>
      <div className="flex justify-end gap-md pt-sm">
        <button type="button" onClick={onCancel} className="px-4 py-sm bg-surface border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container-high transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !note.trim()} className="px-4 py-sm bg-green-600 text-white rounded-lg font-label-sm hover:brightness-110 disabled:opacity-50 transition-all">
          {loading ? "Submitting..." : "Accept"}
        </button>
      </div>
    </form>
  );
}

function RejectBizAcceptanceForm({
  onSave, onCancel, loading, decisionType,
}: { onSave: (reason: string) => void; onCancel: () => void; loading: boolean; decisionType?: "risk_waiver" | "business_review" }) {
  const [reason, setReason] = useState("");
  const isValid = reason.trim().length >= 10;
  const isRiskWaiver = decisionType === "risk_waiver";
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave(reason.trim()); }} className="space-y-md">
      <div className={`flex items-start gap-3 rounded-lg p-md ${isRiskWaiver ? "bg-red-50 border border-red-200" : "bg-orange-50 border border-orange-200"}`}>
        <span className="text-xl flex-shrink-0">{isRiskWaiver ? "⚠️" : "📋"}</span>
        <p className={`font-body-sm ${isRiskWaiver ? "text-red-900" : "text-orange-900"}`}>
          {isRiskWaiver ? (
            <>This defect will be returned to its <strong>prior state</strong> and the risk waiver will be declined. The Test Lead will need to re-evaluate the need for a business decision.</>
          ) : (
            <>This defect will be returned to its <strong>prior state</strong> and the business review will be declined. The Test Lead will need to re-evaluate the need for a business decision.</>
          )}
        </p>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Rejection Reason *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder={isRiskWaiver ? "Explain why this risk waiver is rejected..." : "Explain why this business review is declined..."}
          required
        />
        <p className={`text-label-xs ${reason.trim().length >= 10 ? "text-success" : "text-on-surface-variant/60"}`}>
          {reason.trim().length >= 10 ? "Minimum length met" : `${10 - reason.trim().length} characters remaining (minimum 10)`}
        </p>
      </div>
      <div className="flex justify-end gap-md pt-sm">
        <button type="button" onClick={onCancel}
          className="px-4 py-sm bg-surface border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container-high transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !isValid}
          className="px-4 py-sm bg-red-600 text-white rounded-lg font-label-sm hover:brightness-110 disabled:opacity-50 transition-all">
          {loading ? "Submitting..." : isRiskWaiver ? "Reject Risk Waiver" : "Decline Business Review"}
        </button>
      </div>
    </form>
  );
}

/** Generic reason-collection form used for block and unblock modals */
function ResolveForm({ onSave, onCancel, loading }: { onSave: (rootCause: string) => void; onCancel: () => void; loading: boolean }) {
  const [rootCause, setRootCause] = useState("Coding Error");
  const [customCause, setCustomCause] = useState("");
  const rootCauseOptions = [
    "Requirements Gap", "Design Defect", "Coding Error", "Environment Issue",
    "Test Data Issue", "Configuration Error", "Third-Party Integration", "Other",
  ];
  const isOther = rootCause === "Other";
  const isValid = !isOther || customCause.trim().length >= 3;
  const finalValue = isOther ? `Other: ${customCause.trim()}` : rootCause;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave(finalValue); }} className="space-y-md">
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-md">
        <span className="material-symbols-outlined text-blue-600 text-xl flex-shrink-0">info</span>
        <p className="font-body-sm text-blue-900">
          This will mark the defect as <strong>Resolved by Developer</strong> and send it for verification.
          Select the root cause category for audit tracking.
        </p>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Root Cause Category *</label>
        <select
          value={rootCause}
          onChange={(e) => setRootCause(e.target.value)}
          className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm"
        >
          {rootCauseOptions.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {isOther && (
          <div className="mt-sm">
            <label className="font-label-sm text-label-sm">Describe the root cause *</label>
            <textarea
              value={customCause}
              onChange={(e) => setCustomCause(e.target.value)}
              className="w-full h-20 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none mt-sm"
              placeholder="Describe the root cause in detail..."
              required
            />
            <p className={`text-label-xs mt-xs ${customCause.trim().length >= 3 ? "text-success" : "text-on-surface-variant/60"}`}>
              {customCause.trim().length >= 3 ? "Minimum length met" : `${3 - customCause.trim().length} characters remaining (minimum 3)`}
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-md pt-sm">
        <button type="button" onClick={onCancel}
          className="px-4 py-sm bg-surface border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container-high transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !isValid}
          className="px-4 py-sm bg-blue-600 text-white rounded-lg font-label-sm hover:brightness-110 disabled:opacity-50 transition-all">
          {loading ? "Submitting..." : "Resolve as Developer"}
        </button>
      </div>
    </form>
  );
}

function QuickVerifyResultForm({
  result, onSave, onCancel, loading,
}: {
  result: "passed" | "failed";
  onSave: (data: { result: string; notes?: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [notes, setNotes] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ result, notes: notes.trim() || undefined }); }} className="space-y-md">
      <div className={`flex items-start gap-3 rounded-lg p-md ${result === "passed" ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
        <span className={`material-symbols-outlined text-xl flex-shrink-0 ${result === "passed" ? "text-green-600" : "text-red-600"}`}>
          {result === "passed" ? "check_circle" : "warning"}
        </span>
        <div>
          <p className={`font-label-md text-label-md ${result === "passed" ? "text-green-900" : "text-red-900"}`}>
            {result === "passed" ? "Defect Passed Verification" : "Defect Failed Verification"}
          </p>
          <p className={`font-body-sm text-body-sm ${result === "passed" ? "text-green-800" : "text-red-800"}`}>
            {result === "passed"
              ? "This defect will be closed. It is ready for deployment."
              : "This defect will be returned to ASSIGNED status and the regression counter will be incremented."}
          </p>
        </div>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Verification Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full h-20 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder={result === "passed" ? "Optional notes about the verification..." : "Describe what failed and what needs to be reworked..."}
        />
      </div>
      <div className="flex justify-end gap-md pt-sm">
        <button type="button" onClick={onCancel}
          className="px-4 py-sm bg-surface border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container-high transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading}
          className={`px-4 py-sm text-white rounded-lg font-label-sm hover:brightness-110 disabled:opacity-50 transition-all ${result === "passed" ? "bg-green-600" : "bg-red-600"}`}>
          {loading ? "Recording..." : result === "passed" ? "Confirm Pass" : "Confirm Fail"}
        </button>
      </div>
    </form>
  );
}

/** Generic reason-collection form used for block and unblock modals */
function SimpleReasonForm({
  label, placeholder, confirmLabel, confirmClassName, onSave, onCancel, loading,
}: {
  label: string;
  placeholder: string;
  confirmLabel: string;
  confirmClassName: string;
  onSave: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");
  const isValid = reason.trim().length >= 1;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave(reason.trim()); }} className="space-y-md">
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">{label} *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder={placeholder}
          required
        />
      </div>
      <div className="flex justify-end gap-md pt-sm">
        <button type="button" onClick={onCancel}
          className="px-4 py-sm bg-surface border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container-high transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !isValid}
          className={`px-4 py-sm text-white rounded-lg font-label-sm hover:brightness-110 disabled:opacity-50 transition-all ${confirmClassName}`}>
          {loading ? "Submitting..." : confirmLabel}
        </button>
      </div>
    </form>
  );
}

/** QA review form — pass or fail a RESOLVED_DEV defect. Notes required on fail. */
function QaReviewForm({
  onSave, onCancel, loading,
}: {
  onSave: (data: { result: "passed" | "failed"; notes?: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [result, setResult] = useState<"passed" | "failed">("passed");
  const [notes, setNotes] = useState("");
  const isValid = result === "passed" || notes.trim().length >= 3;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave({ result, notes: notes.trim() || undefined }); }} className="space-y-md">
      <div className={`flex items-start gap-3 rounded-lg p-md ${result === "passed" ? "bg-teal-50 border border-teal-200" : "bg-red-50 border border-red-200"}`}>
        <span className={`material-symbols-outlined text-xl flex-shrink-0 ${result === "passed" ? "text-teal-600" : "text-red-600"}`}>
          {result === "passed" ? "verified" : "cancel"}
        </span>
        <div>
          <p className={`font-label-md text-label-md ${result === "passed" ? "text-teal-900" : "text-red-900"}`}>
            {result === "passed" ? "QA Review Passed" : "QA Review Failed"}
          </p>
          <p className={`font-body-sm text-body-sm ${result === "passed" ? "text-teal-800" : "text-red-800"}`}>
            {result === "passed"
              ? "The defect will move to QA Passed and become eligible for verification."
              : "The defect will return to In Progress with the same developer. A reason is required."}
          </p>
        </div>
      </div>
      <div className="flex gap-md">
        <button
          type="button"
          onClick={() => setResult("passed")}
          className={`flex-1 py-sm rounded-lg font-label-sm border ${result === "passed" ? "bg-teal-600 text-white border-teal-600" : "bg-surface border-outline-variant"}`}
        >
          Pass
        </button>
        <button
          type="button"
          onClick={() => setResult("failed")}
          className={`flex-1 py-sm rounded-lg font-label-sm border ${result === "failed" ? "bg-red-600 text-white border-red-600" : "bg-surface border-outline-variant"}`}
        >
          Fail
        </button>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">
          {result === "passed" ? "QA Notes (optional)" : "Failure Reason *"}
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full h-20 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder={result === "passed" ? "Optional notes about the QA pass..." : "Explain why the QA review failed (min 3 characters)..."}
        />
      </div>
      <div className="flex justify-end gap-md pt-sm">
        <button type="button" onClick={onCancel}
          className="px-4 py-sm bg-surface border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container-high transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !isValid}
          className={`px-4 py-sm text-white rounded-lg font-label-sm hover:brightness-110 disabled:opacity-50 transition-all ${result === "passed" ? "bg-teal-600" : "bg-red-600"}`}>
          {loading ? "Submitting..." : result === "passed" ? "Confirm Pass" : "Confirm Fail"}
        </button>
      </div>
    </form>
  );
}

/** Reassign an active defect to another developer on the project. */
function ReassignForm({
  projectId, currentDeveloperId, onSave, onCancel, loading,
}: {
  projectId: number;
  currentDeveloperId: number | null;
  onSave: (data: { newDeveloperId: number; reason: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const { data: assignments } = useQuery({
    queryKey: ["project-users", projectId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/projects/${projectId}/users`),
  });
  const developers = assignments?.filter((a) => a.role === "DEVELOPER" && a.user_id !== currentDeveloperId) ?? [];
  const [newDeveloperId, setNewDeveloperId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const isValid = newDeveloperId != null && reason.trim().length >= 1;

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid && newDeveloperId != null) onSave({ newDeveloperId, reason: reason.trim() }); }} className="space-y-md">
      <div className="flex items-start gap-3 bg-purple-50 border border-purple-200 rounded-lg p-md">
        <span className="material-symbols-outlined text-purple-600 text-xl flex-shrink-0">swap_horiz</span>
        <p className="font-body-sm text-purple-900">
          Reassign this defect to another developer. The status is unchanged — this is a lateral handoff.
        </p>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">New Developer *</label>
        <select
          value={newDeveloperId ?? ""}
          onChange={(e) => setNewDeveloperId(e.target.value ? Number(e.target.value) : null)}
          className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm"
        >
          <option value="">— Select developer —</option>
          {developers.map((d) => (
            <option key={d.user_id} value={d.user_id}>{d.user.name} ({d.user.username}){d.is_qa ? " · QA" : ""}</option>
          ))}
        </select>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Reason *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full h-20 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder="Why is this being reassigned?"
          required
        />
      </div>
      <div className="flex justify-end gap-md pt-sm">
        <button type="button" onClick={onCancel}
          className="px-4 py-sm bg-surface border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container-high transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !isValid}
          className="px-4 py-sm bg-purple-600 text-white rounded-lg font-label-sm hover:brightness-110 disabled:opacity-50 transition-all">
          {loading ? "Reassigning..." : "Reassign"}
        </button>
      </div>
    </form>
  );
}

/* ─── Business Owner Decision Panel ─────────────────────────────────────── */

function BusinessOwnerDecisionPanel({
  decisionType,
  onAccept,
  onReject,
}: {
  decisionType?: "risk_waiver" | "business_review";
  onAccept: () => void;
  onReject: () => void;
}) {
  const isRiskWaiver = decisionType === "risk_waiver";
  return (
    <div className="border border-outline-variant rounded-xl overflow-hidden">
      <div className={`px-md py-sm flex items-center gap-3 border-b ${isRiskWaiver ? "bg-amber-50 border-amber-200" : "bg-sky-50 border-sky-200"}`}>
        <span className={`material-symbols-outlined text-xl ${isRiskWaiver ? "text-amber-600" : "text-sky-600"}`}>
          {isRiskWaiver ? "warning" : "fact_check"}
        </span>
        <div>
          <p className="text-xs font-bold">{isRiskWaiver ? "Risk Waiver Decision" : "Business Review Decision"}</p>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {isRiskWaiver
              ? "The Test Lead has flagged this defect as a risk waiver for business acceptance."
              : "The Test Lead has submitted this defect for a business review decision."}
          </p>
        </div>
      </div>
      <div className="px-md py-sm bg-surface flex items-center gap-md">
        <button
          onClick={onAccept}
          className="px-4 py-sm bg-purple-600 text-white rounded-lg text-xs font-semibold hover:brightness-110 transition-all"
        >
          {isRiskWaiver ? "Accept as Business Risk" : "Accept by Agreement"}
        </button>
        <button
          onClick={onReject}
          className="px-4 py-sm bg-surface border border-outline-variant rounded-lg text-xs font-semibold text-on-surface hover:bg-surface-container-high transition-colors"
        >
          {isRiskWaiver ? "Reject Risk Waiver" : "Decline Business Review"}
        </button>
      </div>
    </div>
  );
}
