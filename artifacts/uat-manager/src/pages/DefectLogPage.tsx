import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useProjectRole } from "../hooks/useProjectRole";
import type { Defect, TestRun } from "../types/api";

const statusBadge: Record<string, string> = {
  NEW: "bg-error-container text-on-error-container border-error/20",
  TRIAGED: "bg-orange-100 text-orange-800 border-orange-200",
  ASSIGNED: "bg-amber-100 text-amber-800 border-amber-200",
  IN_PROGRESS: "bg-cyan-100 text-cyan-800 border-cyan-200",
  BLOCKED: "bg-red-100 text-red-800 border-red-200",
  RESOLVED_DEV: "bg-indigo-100 text-indigo-800 border-indigo-200",
  READY_FOR_VERIFICATION: "bg-blue-100 text-blue-800 border-blue-200",
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

      {/* Defect Table */}
      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <SortTh field="id" label="ID" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="test_case" label="Test Case" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="severity" label="Severity" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh field="priority" label="Priority" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
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
  const user = getStoredUser();
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [retestOpen, setRetestOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const isNew = defect.status === "NEW";
  const isTriaged = defect.status === "TRIAGED";
  const isAssigned = defect.status === "ASSIGNED";
  const isInProgress = defect.status === "IN_PROGRESS";
  const isBlocked = defect.status === "BLOCKED";
  const isResolved = defect.status === "RESOLVED_DEV";
  const isReady = defect.status === "READY_FOR_VERIFICATION";
  const isRegressed = defect.status === "REGRESSED";
  const isClosed = defect.status === "CLOSED" || defect.status === "PASSED_BY_AGREEMENT";

  const invalidateProject = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project-defects"] });
    queryClient.invalidateQueries({ queryKey: ["project-runs"] });
    onMutated();
  }, [queryClient, onMutated]);

  const classifyMut = useMutation({
    mutationFn: (data: { severity: string; priority: string }) =>
      customFetch(`/defects/${defect.id}/classify`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect classified"); setClassifyOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignMut = useMutation({
    mutationFn: () => customFetch(`/defects/${defect.id}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ assigned_to_user_id: user!.userId }),
    }),
    onSuccess: () => { invalidateProject(); toast.success("Assigned to developer"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startMut = useMutation({
    mutationFn: () => customFetch(`/defects/${defect.id}/start`, { method: "PATCH" }),
    onSuccess: () => { invalidateProject(); toast.success("Work started"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const blockMut = useMutation({
    mutationFn: (reason: string) => customFetch(`/defects/${defect.id}/block`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect blocked"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const unblockMut = useMutation({
    mutationFn: () => customFetch(`/defects/${defect.id}/unblock`, { method: "PATCH" }),
    onSuccess: () => { invalidateProject(); toast.success("Block lifted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveDevMut = useMutation({
    mutationFn: () => customFetch(`/defects/${defect.id}/resolve`, { method: "PATCH", body: JSON.stringify({ root_cause_category: "Code" }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect resolved by developer"); },
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

  const exceptionMut = useMutation({
    mutationFn: (note: string) => customFetch(`/defects/${defect.id}/accept-by-agreement`, { method: "PATCH", body: JSON.stringify({ note }) }),
    onSuccess: () => { invalidateProject(); toast.success("Accepted by agreement"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bizAcceptMut = useMutation({
    mutationFn: (note: string) => customFetch(`/defects/${defect.id}/accept`, { method: "PATCH", body: JSON.stringify({ note }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect accepted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bizRejectMut = useMutation({
    mutationFn: (reason: string) => customFetch(`/defects/${defect.id}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidateProject(); toast.success("Defect rejected"); setRejectOpen(false); },
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

  return (
    <>
      <tr
        className="group hover:bg-surface-container-low cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className={`p-md font-label-md text-label-md text-secondary font-bold ${isClosed ? "opacity-60" : ""}`}>
          DEF-{defect.id}
        </td>
        <td className="p-md">
          <p className={`font-label-md text-label-md text-on-surface ${isClosed ? "opacity-60" : ""}`}>
            {defect.testCase?.title ?? `Test Case #${defect.test_case_id}`}
          </p>
        </td>
        <td className="p-md">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusBadge[defect.status] ?? ""}`}>
            {statusDisplay[defect.status] ?? defect.status}
          </span>
        </td>
        <td className={`p-md font-body-sm text-body-sm ${severityColors[defect.severity ?? ""] ?? ""}`}>
          {defect.severity ?? "—"}
        </td>
        <td className="p-md font-body-sm text-body-sm">{defect.priority ?? "—"}</td>
        <td className="p-md font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">
          {new Date(defect.created_at).toLocaleDateString()}
        </td>
        <td className="p-md text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
            {/* TEST_LEAD: Classify (NEW → TRIAGED) */}
            {canManage && isNew && (
              <button onClick={() => setClassifyOpen(true)} className="p-1.5 hover:bg-secondary-container hover:text-on-secondary-container rounded text-on-surface-variant transition-colors" title="Classify">
                <span className="material-symbols-outlined text-sm">category</span>
              </button>
            )}
            {/* TEST_LEAD: Assign (NEW | TRIAGED → ASSIGNED) */}
            {canManage && (isNew || isTriaged) && (
              <button onClick={() => assignMut.mutate()} className="p-1.5 hover:bg-amber-100 hover:text-amber-700 rounded text-on-surface-variant transition-colors" title="Assign to Developer">
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
              <button onClick={() => { const r = prompt("Block reason:"); if (r) blockMut.mutate(r); }} className="p-1.5 hover:bg-red-100 hover:text-red-700 rounded text-on-surface-variant transition-colors" title="Block">
                <span className="material-symbols-outlined text-sm">block</span>
              </button>
            )}
            {/* DEVELOPER | TEST_LEAD: Unblock (BLOCKED → IN_PROGRESS) */}
            {(isDeveloper || canManage) && isBlocked && (
              <button onClick={() => unblockMut.mutate()} className="p-1.5 hover:bg-green-100 hover:text-green-700 rounded text-on-surface-variant transition-colors" title="Unblock">
                <span className="material-symbols-outlined text-sm">check_circle</span>
              </button>
            )}
            {/* TEST_LEAD: Flag Retest (RESOLVED_DEV → READY_FOR_VERIFICATION) */}
            {canManage && isResolved && (
              <button onClick={() => flagRetestMut.mutate()} className="p-1.5 hover:bg-amber-100 hover:text-amber-700 rounded text-on-surface-variant transition-colors" title="Send for Verification">
                <span className="material-symbols-outlined text-sm">history_edu</span>
              </button>
            )}
            {/* TESTER: Record Retest Result (READY_FOR_VERIFICATION → CLOSED | REGRESSED) */}
            {isTester && isReady && (
              <button onClick={() => setRetestOpen(true)} className="bg-secondary/10 text-secondary hover:bg-secondary hover:text-on-secondary px-3 py-1 rounded-md text-xs font-bold transition-all">
                Record Retest
              </button>
            )}
            {/* BUSINESS_OWNER: Accept (READY_FOR_VERIFICATION → CLOSED) */}
            {isBusinessOwner && isReady && (
              <>
                <button onClick={() => { const n = prompt("Acceptance note:"); if (n) bizAcceptMut.mutate(n); }} className="p-1.5 hover:bg-green-100 hover:text-green-700 rounded text-on-surface-variant transition-colors" title="Accept">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                </button>
                <button onClick={() => setRejectOpen(true)} className="p-1.5 hover:bg-error-container hover:text-on-error-container rounded text-on-surface-variant transition-colors" title="Reject">
                  <span className="material-symbols-outlined text-sm">cancel</span>
                </button>
              </>
            )}
            {/* BUSINESS_OWNER: Accept by Agreement (any non-terminal → PASSED_BY_AGREEMENT) */}
            {isBusinessOwner && !isClosed && !isNew && (
              <button onClick={() => { const n = prompt("Business justification:"); if (n) exceptionMut.mutate(n); }} className="p-1.5 hover:bg-purple-100 hover:text-purple-700 rounded text-on-surface-variant transition-colors" title="Accept by Agreement">
                <span className="material-symbols-outlined text-sm">approval</span>
              </button>
            )}
            <button onClick={() => setNoteOpen(true)} className="p-1.5 hover:bg-surface-container-high rounded text-on-surface-variant transition-colors" title="Add Comment">
              <span className="material-symbols-outlined text-sm">comment</span>
            </button>
          </div>
        </td>
      </tr>
      <tr className={`bg-surface-container-lowest ${expanded ? "" : "hidden"}`}>
        <td className="p-0" colSpan={7}>
          <div className={`p-lg border-l-4 ${isNew ? "border-error" : isAssigned ? "border-amber-400" : isReady ? "border-blue-500" : "border-green-500"} ml-md my-sm space-y-md`}>
            <div className="grid grid-cols-2 gap-xl">
              <div>
                <h4 className="text-xs font-bold text-outline uppercase mb-sm">Tester Notes</h4>
                <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">
                  {defect.tester_notes ?? "No tester notes."}
                </p>
                <div className="flex items-center gap-lg mt-sm text-xs text-on-surface-variant">
                  <span>Created: {new Date(defect.created_at).toLocaleString()}</span>
                  <span>Updated: {new Date(defect.updated_at).toLocaleString()}</span>
                </div>
              </div>
              <div>
                {defect.accepted_by_business_note && (
                  <div className="mb-md">
                    <h4 className="text-xs font-bold text-outline uppercase mb-sm">Acceptance Note</h4>
                    <p className="font-body-sm text-body-sm text-on-surface">{defect.accepted_by_business_note}</p>
                  </div>
                )}
                {defect.rejection_log && (() => {
                  try { const r = JSON.parse(defect.rejection_log); return (
                    <div className="mb-md">
                      <h4 className="text-xs font-bold text-outline uppercase mb-sm">Rejection Log</h4>
                      <p className="font-body-sm text-body-sm text-error">{r.reason ?? "No reason"}</p>
                    </div>
                  ); } catch { return null; }
                })()}
                {defect.retest_reason && (
                  <div className="mb-md">
                    <h4 className="text-xs font-bold text-outline uppercase mb-sm">Retest Reason</h4>
                    <p className="font-body-sm text-body-sm text-on-surface">{defect.retest_reason}</p>
                  </div>
                )}
                {defect.retests && defect.retests.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-outline uppercase mb-sm">Retest History</h4>
                    {defect.retests.map((rt) => (
                      <div key={rt.id} className="flex items-center gap-sm text-xs mb-xs">
                        <span className={`font-bold ${rt.retest_result === "passed" ? "text-green-600" : rt.retest_result === "failed" ? "text-error" : ""}`}>
                          {rt.retest_result ?? "pending"}
                        </span>
                        <span className="text-on-surface-variant">{rt.retest_notes ?? ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Comments Thread */}
            {defect.notes && defect.notes.length > 0 && (
              <div className="border-t border-outline-variant pt-md mt-md">
                <h4 className="text-xs font-bold text-outline uppercase mb-sm">
                  Comments ({defect.notes.length})
                </h4>
                <div className="space-y-sm max-h-48 overflow-y-auto">
                  {defect.notes.map((n) => (
                    <div key={n.id} className="bg-surface-container-low rounded-lg p-sm text-sm">
                      <p className="text-on-surface">{n.note}</p>
                      <p className="text-xs text-on-surface-variant mt-1">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </td>
      </tr>

      {/* Classify Dialog */}
      {classifyOpen && (
        <Dialog onClose={() => setClassifyOpen(false)} title="Classify Defect">
          <ClassifyForm
            onSave={(data) => classifyMut.mutate(data)}
            loading={classifyMut.isPending}
          />
        </Dialog>
      )}

      {/* Reject Dialog */}
      {rejectOpen && (
        <Dialog onClose={() => setRejectOpen(false)} title="Reject Defect">
          <div className="space-y-md">
            <p className="font-body-sm text-on-surface-variant">Enter the reason for rejection:</p>
            <RejectForm
              onSave={(reason) => bizRejectMut.mutate(reason)}
              loading={bizRejectMut.isPending}
            />
          </div>
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

      {/* Add Comment Dialog */}
      {noteOpen && (
        <Dialog onClose={() => setNoteOpen(false)} title="Add Comment">
          <NoteForm
            onSave={(note) => addNoteMut.mutate(note)}
            loading={addNoteMut.isPending}
          />
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
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onSave(reason.trim()); }} className="space-y-md">
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Reason for rejection..." required />
      <button type="submit" disabled={loading || !reason.trim()} className="w-full py-sm bg-error text-on-error rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Saving..." : "Reject"}
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
