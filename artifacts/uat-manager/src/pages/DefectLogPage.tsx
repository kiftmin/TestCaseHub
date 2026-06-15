import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useProjectRole } from "../hooks/useProjectRole";
import { Stepper, type Step } from "../components/ui/stepper";
import type { Defect, DefectNote, TestRun, ProjectAssignment } from "../types/api";

const statusBadge: Record<string, string> = {
  NEW: "bg-error-container text-on-error-container border-error/20",
  TRIAGED: "bg-orange-100 text-orange-800 border-orange-200",
  ASSIGNED: "bg-amber-100 text-amber-800 border-amber-200",
  IN_PROGRESS: "bg-cyan-100 text-cyan-800 border-cyan-200",
  BLOCKED: "bg-red-100 text-red-800 border-red-200",
  RESOLVED_DEV: "bg-indigo-100 text-indigo-800 border-indigo-200",
  READY_FOR_VERIFICATION: "bg-blue-100 text-blue-800 border-blue-200",
  PENDING_BIZ_ACCEPTANCE: "bg-amber-100 text-amber-800 border-amber-200",
  REGRESSED: "bg-red-100 text-red-800 border-red-200",
  CLOSED: "bg-green-100 text-green-800 border-green-200",
  PASSED_BY_AGREEMENT: "bg-purple-100 text-purple-800 border-purple-200",
};

const statusDisplay: Record<string, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  BLOCKED: "Blocked",
  RESOLVED_DEV: "Resolved by Dev",
  READY_FOR_VERIFICATION: "Ready for Verification",
  PENDING_BIZ_ACCEPTANCE: "Pending Business Decision",
  REGRESSED: "Regressed",
  CLOSED: "Closed",
  PASSED_BY_AGREEMENT: "Passed by Agreement",
};

const severityColors: Record<string, string> = {
  Critical: "text-error",
  Major: "text-amber-600",
  Minor: "text-on-surface-variant",
  Cosmetic: "text-on-surface-variant",
};

const severityRowBg: Record<string, string> = {
  Critical: "bg-red-50",
  Major: "bg-amber-50",
};

const severityDot: Record<string, string> = {
  Critical: "bg-red-500",
  Major: "bg-amber-500",
  Minor: "bg-gray-400",
  Cosmetic: "bg-gray-300",
};

const statusIcon: Record<string, string> = {
  NEW: "fiber_new",
  TRIAGED: "content_paste_search",
  ASSIGNED: "assignment_ind",
  IN_PROGRESS: "play_arrow",
  BLOCKED: "block",
  RESOLVED_DEV: "bug_report",
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
      className={`relative text-left p-sm rounded-xl border transition-all flex flex-col justify-between h-20 w-full min-w-0 ${
        isActive
          ? "bg-surface-container border-secondary shadow-sm"
          : "bg-surface border-outline-variant hover:bg-surface-container-high"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && (
            <span className={`material-symbols-outlined text-lg ${isActive ? "text-secondary" : "text-on-surface-variant"}`}>
              {icon}
            </span>
          )}
          <span className="font-label-sm text-label-sm text-on-surface-variant truncate">
            {label}
          </span>
        </div>
        <span className={`text-xl font-bold ml-2 ${isActive ? "text-secondary" : "text-on-surface"}`}>
          {count}
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full overflow-hidden mt-2 bg-surface-container-highest">
        <div
          className={`h-full rounded-full transition-all ${isActive ? "bg-secondary" : "bg-outline-variant/50"}`}
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

export function DefectLogPage({ params }: { params: { id: string } }) {
  const projectId = Number(params.id);
  const user = getStoredUser();
  const role = useProjectRole(projectId);
  useEffect(() => { document.title = "Defects | TestCaseHub"; }, []);

  const [runFilter, setRunFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortField, setSortField] = useState<string>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const canManage = role === "TEST_LEAD" || user?.role === "ADMIN";
  const isBusinessOwner = role === "BUSINESS_OWNER" || user?.role === "ADMIN";
  const isTester = role === "TESTER" || user?.role === "ADMIN";
  const isDeveloper = role === "DEVELOPER" || user?.role === "ADMIN";

  const { data: testRuns } = useQuery({
    queryKey: ["project-runs", projectId],
    queryFn: () => customFetch<TestRun[]>(`/projects/${projectId}/test-runs`),
  });

  const { data: allDefects } = useQuery({
    queryKey: ["project-defects", projectId],
    queryFn: () => customFetch<Defect[]>(`/projects/${projectId}/defects`),
    enabled: !!projectId,
  });

  const statusOrder = ["all","NEW","TRIAGED","ASSIGNED","IN_PROGRESS","BLOCKED","RESOLVED_DEV","READY_FOR_VERIFICATION","PENDING_BIZ_ACCEPTANCE","REGRESSED","CLOSED","PASSED_BY_AGREEMENT"];

  const statusDist = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of allDefects ?? []) map[d.status] = (map[d.status] ?? 0) + 1;
    return statusOrder.map(s => ({ key: s, label: s === "all" ? "All" : statusDisplay[s] ?? s, icon: s === "all" ? "bar_chart" : statusIcon[s], count: s === "all" ? (allDefects?.length ?? 0) : (map[s] ?? 0) }));
  }, [allDefects]);

  const total = allDefects?.length ?? 0;

  const filtered = useMemo(() => {
    return (allDefects ?? []).filter((d) => {
      if (runFilter !== "all" && d.test_run_id !== Number(runFilter)) return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (severityFilter !== "all" && d.severity !== severityFilter) return false;
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
  }, [allDefects, runFilter, statusFilter, severityFilter, search]);

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

  return (
    <div className="space-y-lg">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display-lg text-display-lg text-primary">Defect Log</h2>
          <p className="font-body-base text-on-surface-variant">
            Tracking {allDefects?.length ?? 0} defects across {testRuns?.length ?? 0} runs.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <section className="bg-surface border border-outline-variant rounded-xl p-md shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-md">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-outline uppercase tracking-wider">Test Run</label>
            <select
              value={runFilter}
              onChange={(e) => setRunFilter(e.target.value)}
              className="w-full bg-surface-container-low border-outline-variant rounded-lg p-2 text-sm focus:ring-secondary focus:border-secondary"
            >
              <option value="all">All Runs</option>
              {testRuns?.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-outline uppercase tracking-wider">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-surface-container-low border-outline-variant rounded-lg p-2 text-sm focus:ring-secondary focus:border-secondary"
            >
              <option value="all">All Statuses</option>
              {Object.keys(statusBadge).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-outline uppercase tracking-wider">Severity</label>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="w-full bg-surface-container-low border-outline-variant rounded-lg p-2 text-sm focus:ring-secondary focus:border-secondary"
            >
              <option value="all">All Severities</option>
              <option value="Critical">Critical</option>
              <option value="Major">Major</option>
              <option value="Minor">Minor</option>
              <option value="Cosmetic">Cosmetic</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { setRunFilter("all"); setStatusFilter("all"); setSeverityFilter("all"); setSearch(""); }}
              className="w-full bg-surface-container-high text-on-surface font-label-md text-label-md py-2 rounded-lg hover:bg-outline-variant transition-colors flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">filter_list</span>
              Clear All Filters
            </button>
          </div>
        </div>
      </section>

      {/* Status Distribution */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {statusDist.map((s) => (
          <div key={s.key} className="min-w-0">
            <StatusDistCard
              label={s.label}
              count={s.count}
              total={total}
              icon={s.icon}
              isActive={statusFilter === s.key}
              onClick={() => setStatusFilter(statusFilter === s.key ? "all" : s.key)}
            />
          </div>
        ))}
      </div>

      {/* Defect Table */}
      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <SortTh field="id" label="ID" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="test_case" label="Test Case / Step" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="severity" label="Sev" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="priority" label="Pri" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="created_at" label="Created" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="p-md text-xs font-bold text-outline uppercase text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {sorted.map((defect) => (
                <DefectRow
                  key={defect.id}
                  defect={defect}
                  expanded={expandedId === defect.id}
                  onToggle={() => setExpandedId(expandedId === defect.id ? null : defect.id)}
                  canManage={canManage}
                  isBusinessOwner={isBusinessOwner}
                  isTester={isTester}
                  isDeveloper={isDeveloper}
                  onMutated={() => { /* parent owns cache invalidation */ }}
                />
              ))}
                {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-lg text-center text-on-surface-variant font-body-sm">
                    No defects found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="p-md bg-surface-container-low border-t border-outline-variant flex items-center justify-between">
          <p className="text-xs text-on-surface-variant">
            Showing <span className="font-bold">{sorted.length}</span> of <span className="font-bold">{allDefects?.length ?? 0}</span> defects
          </p>
        </div>
      </div>
    </div>
  );
}

function DefectRow({
  defect,
  expanded,
  onToggle,
  canManage,
  isBusinessOwner,
  isTester,
  isDeveloper,
  onMutated,
}: {
  defect: Defect;
  expanded: boolean;
  onToggle: () => void;
  canManage: boolean;
  isBusinessOwner: boolean;
  isTester: boolean;
  isDeveloper: boolean;
  onMutated: () => void;
}) {
  const queryClient = useQueryClient();
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [retestOpen, setRetestOpen] = useState(false);
  const [acceptBizRiskOpen, setAcceptBizRiskOpen] = useState(false);
  const [rejectBizOpen, setRejectBizOpen] = useState(false);
  const [bizAcceptOpen, setBizAcceptOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [flagRetestNewOpen, setFlagRetestNewOpen] = useState(false);
  const [flagBlockedNewOpen, setFlagBlockedNewOpen] = useState(false);
  const [flagBusinessOpen, setFlagBusinessOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const [untriagedAction, setUntriagedAction] = useState<string | null>(null);
  const [pendingAfterClassify, setPendingAfterClassify] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<"overview" | "steps" | "activity">("overview");

  const isNew = defect.status === "NEW";
  const isClassified = !!(defect.severity && defect.priority);

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
      case "assign": setAssignOpen(true); break;
      case "retest": setFlagRetestNewOpen(true); break;
      case "acceptBiz": setFlagBusinessOpen(true); break;
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
  const isBlocked = defect.status === "BLOCKED";
  const isResolved = defect.status === "RESOLVED_DEV";
  const isReady = defect.status === "READY_FOR_VERIFICATION";
  const isClosed = defect.status === "CLOSED" || defect.status === "PASSED_BY_AGREEMENT";
  const isPendingBiz = defect.status === "PENDING_BIZ_ACCEPTANCE";

  const invalidateProject = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project-defects"] });
    queryClient.invalidateQueries({ queryKey: ["project-runs"] });
    onMutated();
  }, [queryClient, onMutated]);

  const classifyMut = useMutation({
    mutationFn: (data: { severity: string; priority: string }) =>
      customFetch(`/defects/${defect.id}/classify`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Defect classified");
      setClassifyOpen(false);
      const next = pendingAfterClassify;
      setPendingAfterClassify(null);
      if (next) setTimeout(() => proceedWithAction(next), 100);
    },
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
    mutationFn: () => customFetch(`/defects/${defect.id}/resolve`, { method: "PATCH", body: JSON.stringify({ root_cause_category: "Code" }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect resolved by developer"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resumeWorkMut = useMutation({
    mutationFn: (reason: string) => customFetch(`/defects/${defect.id}/resume-work`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidateProject(); toast.success("Work resumed"); },
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

  const flagAcceptedByBusinessMut = useMutation({
    mutationFn: (note: string) => customFetch(`/defects/${defect.id}/flag-accepted-by-business`, { method: "PATCH", body: JSON.stringify({ note }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect flagged for business decision"); setFlagBusinessOpen(false); },
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
    mutationFn: (note: string) => customFetch(`/defects/${defect.id}/notes`, { method: "POST", body: JSON.stringify({ note }) }),
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

  const statusSteps: Step[] = [
    { key: "NEW", label: "New" },
    { key: "TRIAGED", label: "Triaged" },
    { key: "ASSIGNED", label: "Assigned" },
    { key: "IN_PROGRESS", label: "In Progress" },
    { key: "RESOLVED_DEV", label: "Resolved" },
    { key: "READY_FOR_VERIFICATION", label: "Verification" },
    { key: "PENDING_BIZ_ACCEPTANCE", label: "Pending Biz" },
    { key: "CLOSED", label: "Closed" },
  ];
  const mainFlow: Record<string, number> = { NEW:0, TRIAGED:1, ASSIGNED:2, IN_PROGRESS:3, BLOCKED:3, RESOLVED_DEV:4, READY_FOR_VERIFICATION:5, PENDING_BIZ_ACCEPTANCE:6, CLOSED:7, PASSED_BY_AGREEMENT:7, REGRESSED:3 };
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
    if (defect.status === "CLOSED" || defect.status === "PASSED_BY_AGREEMENT") {
      idx.add(statusSteps.length - 1);
    }
    return [...idx].sort((a, b) => a - b);
  }, [visitedFrom, currentStatusIdx, defect.status]);

  return (
    <>
      <tr
        className={`group hover:bg-surface-container-low cursor-pointer transition-colors ${severityRowBg[defect.severity ?? ""] ?? ""} ${isClosed ? "opacity-60" : ""}`}
        onClick={onToggle}
      >
        <td className="p-md whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${severityDot[defect.severity ?? ""] ?? "bg-gray-300"} shrink-0`} />
            <span className="font-label-md text-label-md text-secondary font-bold">
              DEF-{defect.id}
            </span>
          </div>
        </td>
        <td className="p-md">
          <div className="flex flex-col gap-0.5">
            <p className="font-label-md text-label-md text-on-surface leading-tight">
              {defect.testCase?.title ?? `Test Case #${defect.test_case_id}`}
            </p>
            {stepInfo.instruction && (
              <p className="text-xs text-on-surface-variant leading-tight">
                Step {stepInfo.stepNumber}: {stepInfo.instruction}
              </p>
            )}
          </div>
        </td>
        <td className={`p-md font-body-sm text-body-sm whitespace-nowrap ${severityColors[defect.severity ?? ""] ?? ""}`}>
          {defect.severity ?? "—"}
        </td>
        <td className="p-md font-body-sm text-body-sm whitespace-nowrap text-on-surface-variant">
          {defect.priority ?? "—"}
        </td>
        <td className="p-md font-body-sm text-body-sm whitespace-nowrap">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${statusBadge[defect.status] ?? ""}`}>
            {statusDisplay[defect.status] ?? defect.status}
          </span>
          {defect.regression_index > 0 && (
            <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-200" title="Previously failed verification">
              REJ×{defect.regression_index}
            </span>
          )}
        </td>
        <td className="p-md font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">
          {new Date(defect.created_at).toLocaleDateString()}
        </td>
        <td className="p-md text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
            {/* NEW-specific triage pathways — Classify always available, others guarded by triage check */}
            {canManage && isNew && (
              <>
                {/* Classify (NEW → TRIAGED) */}
                <button onClick={() => setClassifyOpen(true)} className="bg-secondary-container/40 text-on-secondary-container px-2 py-1 rounded-md text-xs font-bold hover:bg-secondary-container transition-colors" title="Set severity and priority">
                  Classify
                </button>
                {/* Assign to Engineering — requires triage first */}
                <button
                  onClick={() => isClassified ? handleUntriagedAction("assign") : undefined}
                  disabled={!isClassified}
                  className={`px-2 py-1 rounded-md text-xs font-bold transition-colors ${
                    isClassified
                      ? "bg-amber-100 text-amber-800 hover:bg-amber-200 cursor-pointer"
                      : "bg-amber-50 text-amber-400 cursor-not-allowed opacity-60"
                  }`}
                  title={isClassified ? "Assign to Developer" : "Classify defect before assigning"}
                >
                  Assign
                </button>
                {/* Flag for Retesting (NEW → READY_FOR_VERIFICATION) */}
                <button onClick={() => handleUntriagedAction("retest")} className="bg-blue-100 text-blue-800 px-2 py-1 rounded-md text-xs font-bold hover:bg-blue-200 transition-colors" title="Send for verification">
                  Retest
                </button>
                {/* Flag for Business Decision — requires triage first */}
                <button
                  onClick={() => isClassified ? handleUntriagedAction("acceptBiz") : undefined}
                  disabled={!isClassified}
                  className={`px-2 py-1 rounded-md text-xs font-bold transition-colors ${
                    isClassified
                      ? "bg-purple-100 text-purple-800 hover:bg-purple-200 cursor-pointer"
                      : "bg-purple-50 text-purple-400 cursor-not-allowed opacity-60"
                  }`}
                  title={isClassified ? "Flag for Business Decision" : "Classify defect before flagging for business decision"}
                >
                  Flag Biz
                </button>
                {/* Flag as Blocked (NEW → BLOCKED) */}
                <button onClick={() => handleUntriagedAction("block")} className="bg-red-100 text-red-800 px-2 py-1 rounded-md text-xs font-bold hover:bg-red-200 transition-colors" title="Flag as blocked">
                  Block
                </button>
              </>
            )}
            {/* Classify — always available for TEST_LEAD on non-terminal defects (reclassify severity/priority) */}
            {canManage && !isNew && !isClosed && !isPendingBiz && (
              <button onClick={() => setClassifyOpen(true)} className="p-1.5 hover:bg-secondary-container hover:text-on-secondary-container rounded text-on-surface-variant transition-colors" title="Reclassify severity and priority">
                <span className="material-symbols-outlined text-sm">category</span>
              </button>
            )}
            {canManage && !isClosed && !isPendingBiz && !isNew && (
              <button onClick={() => setFlagBusinessOpen(true)} className="p-1.5 hover:bg-purple-100 hover:text-purple-700 rounded text-on-surface-variant transition-colors" title="Flag for Business Decision">
                <span className="material-symbols-outlined text-sm">pending_actions</span>
              </button>
            )}
            {/* TEST_LEAD: Assign (TRIAGED → ASSIGNED) */}
            {canManage && !isNew && isTriaged && (
              <button onClick={() => setAssignOpen(true)} className="p-1.5 hover:bg-amber-100 hover:text-amber-700 rounded text-on-surface-variant transition-colors" title="Assign to Developer">
                <span className="material-symbols-outlined text-sm">assignment</span>
              </button>
            )}
            {/* DEVELOPER: Start (ASSIGNED → IN_PROGRESS) */}
            {isDeveloper && isAssigned && (
              <button onClick={() => startMut.mutate()} className="p-1.5 hover:bg-cyan-100 hover:text-cyan-700 rounded text-on-surface-variant transition-colors" title="Start Work">
                <span className="material-symbols-outlined text-sm">play_arrow</span>
              </button>
            )}
            {/* DEVELOPER: Resolve (ASSIGNED | IN_PROGRESS → RESOLVED_DEV) */}
            {isDeveloper && (isAssigned || isInProgress) && (
              <button onClick={() => resolveDevMut.mutate()} className="p-1.5 hover:bg-blue-100 hover:text-blue-700 rounded text-on-surface-variant transition-colors" title="Resolve as Developer">
                <span className="material-symbols-outlined text-sm">bug_report</span>
              </button>
            )}
            {/* DEVELOPER: Block (ASSIGNED | IN_PROGRESS → BLOCKED) */}
            {isDeveloper && (isAssigned || isInProgress) && (
              <button onClick={() => setBlockOpen(true)} className="p-1.5 hover:bg-red-100 hover:text-red-700 rounded text-on-surface-variant transition-colors" title="Block">
                <span className="material-symbols-outlined text-sm">block</span>
              </button>
            )}
            {/* DEVELOPER | TEST_LEAD: Unblock (BLOCKED → <prior state>) */}
            {(isDeveloper || canManage) && isBlocked && (
              <button onClick={() => setUnblockOpen(true)} className="p-1.5 hover:bg-green-100 hover:text-green-700 rounded text-on-surface-variant transition-colors" title="Unblock">
                <span className="material-symbols-outlined text-sm">lock_open</span>
              </button>
            )}
            {/* DEVELOPER | TEST_LEAD: Resume Work (RESOLVED_DEV → IN_PROGRESS) */}
            {(isDeveloper || canManage) && isResolved && (
              <button onClick={() => { const r = prompt("Reason for resuming work:"); if (r) resumeWorkMut.mutate(r); }} className="p-1.5 hover:bg-orange-100 hover:text-orange-700 rounded text-on-surface-variant transition-colors" title="Resume Work">
                <span className="material-symbols-outlined text-sm">undo</span>
              </button>
            )}
            {/* TEST_LEAD: Flag Retest (RESOLVED_DEV → READY_FOR_VERIFICATION) */}
            {canManage && isResolved && (
              <button onClick={() => flagRetestMut.mutate()} className="p-1.5 hover:bg-amber-100 hover:text-amber-700 rounded text-on-surface-variant transition-colors" title="Send for Verification">
                <span className="material-symbols-outlined text-sm">history_edu</span>
              </button>
            )}
            {/* TESTER | TEST_LEAD: Record Retest Result (READY_FOR_VERIFICATION → CLOSED | REGRESSED) */}
            {(isTester || canManage) && isReady && (
              <button onClick={() => setRetestOpen(true)} className="p-1.5 hover:bg-blue-100 hover:text-blue-700 rounded text-on-surface-variant transition-colors" title="Record Retest Result">
                <span className="material-symbols-outlined text-sm">fact_check</span>
              </button>
            )}
            {/* BUSINESS_OWNER: Accept verification (READY_FOR_VERIFICATION → CLOSED) */}
            {isBusinessOwner && isReady && (
              <button onClick={() => setBizAcceptOpen(true)} className="p-1.5 hover:bg-green-100 hover:text-green-700 rounded text-on-surface-variant transition-colors" title="Accept">
                <span className="material-symbols-outlined text-sm">check_circle</span>
              </button>
            )}
            {/* BUSINESS_OWNER | TEST_LEAD: Reject verification (READY_FOR_VERIFICATION → ASSIGNED) */}
            {(isBusinessOwner || canManage) && isReady && (
              <button onClick={() => setRejectOpen(true)} className="p-1.5 hover:bg-error-container hover:text-on-error-container rounded text-on-surface-variant transition-colors" title="Reject">
                <span className="material-symbols-outlined text-sm">cancel</span>
              </button>
            )}
            {/* TEST_LEAD: Reschedule retest (READY_FOR_VERIFICATION → RESOLVED_DEV) */}
            {canManage && isReady && (
              <button onClick={() => setRescheduleOpen(true)} className="p-1.5 hover:bg-orange-100 hover:text-orange-700 rounded text-on-surface-variant transition-colors" title="Reschedule Retest — return to developer">
                <span className="material-symbols-outlined text-sm">schedule</span>
              </button>
            )}
            {/* BUSINESS_OWNER: Accept by Agreement (PENDING_BIZ_ACCEPTANCE → PASSED_BY_AGREEMENT) */}
            {isBusinessOwner && isPendingBiz && (
              <>
                <button onClick={() => setAcceptBizRiskOpen(true)} className="p-1.5 hover:bg-purple-100 hover:text-purple-700 rounded text-on-surface-variant transition-colors" title="Accept as Business Risk">
                  <span className="material-symbols-outlined text-sm">approval</span>
                </button>
                <button onClick={() => setRejectBizOpen(true)} className="p-1.5 hover:bg-red-100 hover:text-red-700 rounded text-on-surface-variant transition-colors" title="Reject Business Risk Acceptance">
                  <span className="material-symbols-outlined text-sm">thumb_down</span>
                </button>
              </>
            )}
            <button onClick={() => setNoteOpen(true)} className="p-1.5 hover:bg-surface-container-high rounded text-on-surface-variant transition-colors" title="Add Comment">
              <span className="material-symbols-outlined text-sm">comment</span>
            </button>
          </div>
        </td>
      </tr>
      <tr className={`bg-surface-container-lowest ${expanded ? "" : "hidden"}`}>
        <td className="p-0" colSpan={7}>
          <div className="mx-lg my-md border border-outline-variant/40 rounded-2xl overflow-hidden shadow-sm">
            {/* Header with Stepper */}
            <div className="p-lg border-b border-outline-variant/40 bg-surface">
              <div className="flex items-center justify-between mb-md">
                <h3 className="font-title-sm text-title-sm text-on-surface">
                  DEF-{defect.id} — {defect.testCase?.title ?? `Test Case #${defect.test_case_id}`}
                </h3>
                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold border ${statusBadge[defect.status] ?? ""}`}>
                  {statusDisplay[defect.status] ?? defect.status}
                </span>
              </div>
              <Stepper steps={statusSteps} currentIndex={currentStatusIdx} completedIndices={completedStatusIndices} />

              {/* Tab Menu */}
              <div className="flex gap-xs mt-md border-b border-outline-variant/30">
                <button
                  onClick={() => setActiveDetailTab("overview")}
                  className={`px-md py-sm font-label-sm text-label-sm rounded-t-lg border-b-2 transition-colors ${activeDetailTab === "overview" ? "border-secondary text-secondary" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveDetailTab("steps")}
                  className={`px-md py-sm font-label-sm text-label-sm rounded-t-lg border-b-2 transition-colors ${activeDetailTab === "steps" ? "border-secondary text-secondary" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}
                >
                  Test Steps
                </button>
                <button
                  onClick={() => setActiveDetailTab("activity")}
                  className={`px-md py-sm font-label-sm text-label-sm rounded-t-lg border-b-2 transition-colors ${activeDetailTab === "activity" ? "border-secondary text-secondary" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}
                >
                  Activity
                </button>
              </div>
            </div>

            {/* Tab Content */}
            <div className="p-lg">
              {activeDetailTab === "overview" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-xl">
                  <div className="space-y-md">
                    <div>
                      <h4 className="text-xs font-bold text-outline uppercase mb-sm">Test Scenario</h4>
                      <p className="font-body-sm text-body-sm text-on-surface font-semibold">{defect.testCase?.useCase?.name ?? `Scenario #${defect.testCase?.use_case_id}`}</p>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-outline uppercase mb-sm">Test Case</h4>
                      <p className="font-body-sm text-body-sm text-on-surface">{defect.testCase?.title ?? `Test Case #${defect.test_case_id}`}</p>
                    </div>
                    {stepInfo.instruction && (
                      <div className="p-md bg-red-50 border border-red-100 rounded-lg">
                        <h4 className="text-xs font-bold text-red-700 uppercase mb-sm flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">error</span>
                          Failed Step
                        </h4>
                        <p className="font-body-sm text-body-sm text-red-600 font-semibold">Step {stepInfo.stepNumber}: {stepInfo.instruction}</p>
                      </div>
                    )}
                    {defect.testCase?.acceptance_criteria && (
                      <div>
                        <h4 className="text-xs font-bold text-outline uppercase mb-sm">Acceptance Criteria</h4>
                        <p className="font-body-sm text-body-sm text-on-surface">{defect.testCase.acceptance_criteria}</p>
                      </div>
                    )}
                    {defect.execution?.notes && (
                      <div>
                        <h4 className="text-xs font-bold text-outline uppercase mb-sm">Execution Notes</h4>
                        <p className="font-body-sm text-body-sm text-on-surface">{defect.execution.notes}</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-md">
                    <div>
                      <h4 className="text-xs font-bold text-outline uppercase mb-sm">Execution Details</h4>
                      {defect.execution ? (
                        <div className="space-y-xs">
                          <p className="font-body-sm text-body-sm text-on-surface">Tester: {defect.execution.tester?.name ?? defect.execution.tester_name ?? "Unknown"}</p>
                          <p className="font-body-sm text-body-sm text-on-surface">Result: <span className={`font-bold ${defect.execution.overall_result === "failed" ? "text-error" : defect.execution.overall_result === "passed" ? "text-green-600" : ""}`}>{defect.execution.overall_result ?? "N/A"}</span></p>
                          <p className="font-body-sm text-body-sm text-on-surface">Executed: {defect.execution.executed_at ? new Date(defect.execution.executed_at).toLocaleString() : "N/A"}</p>
                        </div>
                      ) : (<p className="text-sm text-on-surface-variant">No execution record available.</p>)}
                    </div>
                    <div className="border-t border-outline-variant/30 pt-md">
                      <h4 className="text-xs font-bold text-outline uppercase mb-sm">Tester Notes</h4>
                      <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">{defect.tester_notes ?? "No tester notes."}</p>
                    </div>
                    {defect.accepted_by_business_note && (
                      <div>
                        <h4 className="text-xs font-bold text-outline uppercase mb-sm">Acceptance Note</h4>
                        <p className="font-body-sm text-body-sm text-on-surface">{defect.accepted_by_business_note}</p>
                      </div>
                    )}
                    {defect.retest_reason && (
                      <div>
                        <h4 className="text-xs font-bold text-outline uppercase mb-sm">Retest Reason</h4>
                        <p className="font-body-sm text-body-sm text-on-surface">{defect.retest_reason}</p>
                      </div>
                    )}
                    {defect.retests && defect.retests.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-outline uppercase mb-sm">Retest History</h4>
                        {defect.retests.map((rt) => (
                          <div key={rt.id} className="flex items-center gap-sm text-xs mb-xs">
                            <span className={`font-bold ${rt.retest_result === "passed" ? "text-green-600" : rt.retest_result === "failed" ? "text-error" : ""}`}>{rt.retest_result ?? "pending"}</span>
                            <span className="text-on-surface-variant">{rt.retest_notes ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {defect.regression_index > 0 && (
                      <div className="p-md bg-orange-50 border border-orange-200 rounded-lg">
                        <h4 className="text-xs font-bold text-orange-700 uppercase mb-sm flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">warning</span>
                          Previously Failed Verification
                        </h4>
                        <p className="font-body-sm text-body-sm text-orange-700">
                          This defect has been rejected <strong>{defect.regression_index}</strong> time{defect.regression_index === 1 ? "" : "s"} and returned to the developer for rework.
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-lg mt-sm text-xs text-on-surface-variant">
                      <span>Created: {new Date(defect.created_at).toLocaleString()}</span>
                      <span>Updated: {new Date(defect.updated_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}

              {activeDetailTab === "steps" && (
                <div>
                  {defect.execution?.stepResults && defect.execution.stepResults.length > 0 ? (
                    <div className="space-y-sm">
                      {defect.execution.stepResults.map((sr) => {
                        const isFailed = sr.passed === false;
                        const matchesDefect = stepInfo.stepNumber != null && String(sr.step?.step_number) === stepInfo.stepNumber;
                        return (
                          <div key={sr.id} className={`border-l-4 rounded-lg p-sm text-sm transition-all ${isFailed && matchesDefect ? "border-error bg-red-50 shadow-sm" : isFailed ? "border-error bg-surface-container-high" : "border-green-500 bg-surface-container-high/50 opacity-70"}`}>
                            <div className="flex items-center gap-sm mb-xs">
                              <span className="font-bold text-xs">Step {sr.step?.step_number ?? sr.step_id}</span>
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${isFailed ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>{isFailed ? "FAIL" : "PASS"}</span>
                            </div>
                            <p className="text-on-surface mb-xs"><span className="font-semibold">Instruction:</span> {sr.step?.instruction ?? "N/A"}</p>
                            {sr.step?.expected_result && <p className="text-on-surface mb-xs"><span className="font-semibold">Expected:</span> {sr.step.expected_result}</p>}
                            {sr.actual_result && <p className="text-on-surface mb-xs"><span className="font-semibold">Actual:</span> {sr.actual_result}</p>}
                            {sr.comments && <p className="text-on-surface-variant text-xs mt-1"><span className="font-semibold">Comments:</span> {sr.comments}</p>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (<p className="text-sm text-on-surface-variant text-center py-md">No test steps recorded.</p>)}
                </div>
              )}

              {activeDetailTab === "activity" && (
                <div>
                  {defect.notes && defect.notes.length > 0 ? (
                    <div className="space-y-sm max-h-80 overflow-y-auto pr-md">
                      {(() => {
                        const seen = new Set<string>();
                        const deduped: DefectNote[] = [];
                        for (const n of defect.notes ?? []) {
                          const key = `${n.id}-${n.note}-${n.created_at}`;
                          if (seen.has(key)) continue;
                          seen.add(key);
                          deduped.push(n);
                        }
                        return deduped;
                      })().map((n) => (
                        <div key={n.id} className={`rounded-lg p-sm text-sm ${n.is_system_note ? "bg-surface-container-low border border-outline-variant/30" : "bg-surface-container-high"}`}>
                          <div className="flex items-start gap-2">
                            {n.is_system_note && (<span className="text-on-surface-variant mt-0.5 flex-shrink-0 material-symbols-outlined text-sm">settings</span>)}
                            <div className="flex-1 min-w-0">
                              <p className={`text-on-surface ${n.is_system_note ? "italic text-on-surface-variant text-xs" : ""}`}>{n.note}</p>
                              <div className="flex items-center gap-1 mt-1">
                                <span className="text-[10px] text-on-surface-variant">{n.addedBy?.name ?? `User #${n.added_by_user_id ?? "system"}`}</span>
                                <span className="text-[10px] text-on-surface-variant">&middot;</span>
                                <span className="text-[10px] text-on-surface-variant">{new Date(n.created_at).toLocaleString()}</span>
                                {n.is_system_note && (<><span className="text-[10px] text-on-surface-variant">&middot;</span><span className="text-[10px] text-on-surface-variant italic">System Note</span></>)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (<p className="text-sm text-on-surface-variant text-center py-md">No activity recorded.</p>)}
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
            onSave={(data) => classifyMut.mutate(data)}
            loading={classifyMut.isPending}
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

      {/* Retest Dialog */}
      {retestOpen && (
        <Dialog onClose={() => setRetestOpen(false)} title="Record Retest Result">
          <RetestForm
            onSave={(data) => recordRetestMut.mutate(data)}
            loading={recordRetestMut.isPending}
          />
        </Dialog>
      )}

      {/* Accept Biz Risk Dialog */}
      {acceptBizRiskOpen && (
        <Dialog onClose={() => setAcceptBizRiskOpen(false)} title="Accept as Business Risk">
          <div className="space-y-md">
            <p className="font-body-sm text-on-surface-variant">
              This defect will be marked as accepted. A go-live justification is required for audit purposes.
            </p>
            <AcceptBizRiskForm
              onSave={(justification) => acceptBizRiskMut.mutate(justification)}
              onCancel={() => setAcceptBizRiskOpen(false)}
              loading={acceptBizRiskMut.isPending}
            />
          </div>
        </Dialog>
      )}

      {/* Reject Business Risk Acceptance Dialog */}
      {rejectBizOpen && (
        <Dialog onClose={() => setRejectBizOpen(false)} title="Reject Business Risk Acceptance">
          <RejectBizAcceptanceForm
            onSave={(reason) => rejectBizAcceptanceMut.mutate(reason)}
            onCancel={() => setRejectBizOpen(false)}
            loading={rejectBizAcceptanceMut.isPending}
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
            onSave={(note) => addNoteMut.mutate(note)}
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

      {/* Flag for Business Decision Dialog */}
      {flagBusinessOpen && (
        <Dialog onClose={() => setFlagBusinessOpen(false)} title="Flag for Business Decision">
          <FlagBusinessForm
            onSave={(note) => flagAcceptedByBusinessMut.mutate(note)}
            loading={flagAcceptedByBusinessMut.isPending}
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
                </p>
              </div>
            </div>
            <div className="flex gap-sm">
              <button
                onClick={handleClassifyThenAction}
                className="flex-1 py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 transition-colors"
              >
                Triage First
              </button>
              <button
                onClick={() => proceedWithAction(untriagedAction)}
                className="flex-1 py-sm bg-surface-container-high text-on-surface rounded-lg font-label-md hover:bg-outline-variant transition-colors"
              >
                Proceed Anyway
              </button>
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
  return (
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
    </div>
  );
}

function ClassifyForm({ onSave, loading }: { onSave: (d: { severity: string; priority: string }) => void; loading: boolean }) {
  const [severity, setSeverity] = useState("Major");
  const [priority, setPriority] = useState("P2");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ severity, priority }); }} className="space-y-md">
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
      <button type="submit" disabled={loading} className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
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
      className="p-md text-xs font-bold text-outline uppercase cursor-pointer select-none whitespace-nowrap hover:text-on-surface transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          {isActive ? (sortDir === "asc" ? "arrow_upward_alt" : "arrow_downward_alt") : "unfold_more"}
        </span>
      </div>
    </th>
  );
}

function NoteForm({ onSave, loading }: { onSave: (note: string) => void; loading: boolean }) {
  const [note, setNote] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) onSave(note.trim()); }} className="space-y-md">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Enter your comment..." required />
      <button type="submit" disabled={loading || !note.trim()} className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Saving..." : "Add Comment"}
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

function FlagBusinessForm({ onSave, loading }: { onSave: (note: string) => void; loading: boolean }) {
  const [note, setNote] = useState("");
  const charsLeft = 10 - note.length;
  const isValid = note.trim().length >= 10;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave(note.trim()); }} className="space-y-md">
      <p className="font-body-sm text-on-surface-variant">
        This will route the defect to <strong>Pending Business Decision</strong> status.
        The Business Owner will be required to formally accept or reject. Provide a
        justification for why this defect should be considered for business risk acceptance.
      </p>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Business Justification *</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Explain why this defect should be considered for business risk acceptance..." required />
        <p className={`text-label-xs ${charsLeft <= 0 ? "text-success" : "text-on-surface-variant/60"}`}>
          {charsLeft <= 0 ? "Minimum length met" : `${charsLeft} characters remaining (minimum 10)`}
        </p>
      </div>
      <button type="submit" disabled={loading || !isValid} className="w-full py-sm bg-purple-600 text-white rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Submitting..." : "Flag for Business Decision"}
      </button>
    </form>
  );
}

function AcceptBizRiskForm({ onSave, onCancel, loading }: { onSave: (justification: string) => void; onCancel: () => void; loading: boolean }) {
  const [justification, setJustification] = useState("");
  const charsLeft = 10 - justification.length;
  const isValid = justification.trim().length >= 10;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave(justification.trim()); }} className="space-y-md">
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Justification *</label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder="Explain why this defect is accepted as a business risk..."
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
          {loading ? "Submitting..." : "Confirm & Accept"}
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
  onSave, onCancel, loading,
}: { onSave: (reason: string) => void; onCancel: () => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  const isValid = reason.trim().length >= 10;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (isValid) onSave(reason.trim()); }} className="space-y-md">
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-md">
        <span className="material-symbols-outlined text-red-600 text-xl flex-shrink-0">warning</span>
        <p className="font-body-sm text-red-900">
          This defect will be returned to its <strong>prior state</strong>. The Test Lead
          will need to re-evaluate and re-flag if a business decision is still required.
          A rejection reason is required for audit purposes.
        </p>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Rejection Reason *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
          placeholder="Explain why this defect cannot be accepted as a business risk..."
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
          {loading ? "Submitting..." : "Reject & Return to Prior State"}
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
