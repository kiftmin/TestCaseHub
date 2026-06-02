import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useProjectRole } from "../hooks/useProjectRole";
import type { Bug, User, ProjectAssignment } from "../types/api";

const statusBadge: Record<string, string> = {
  OPEN: "bg-error-container text-on-error-container",
  ASSIGNED: "bg-amber-100 text-amber-800 border border-amber-200",
  IN_PROGRESS: "bg-primary-fixed text-primary",
  RESOLVED: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
  FAILED_TO_RESOLVE: "bg-red-200 text-red-900",
  CLOSED: "bg-green-100 text-green-800 border border-green-200",
  REOPENED: "bg-amber-200 text-amber-900",
};

export function BugListPage({ params }: { params: { id: string } }) {
  const projectId = Number(params.id);
  const user = getStoredUser();
  const role = useProjectRole(projectId);
  useEffect(() => { document.title = "Bugs | TestCaseHub"; }, []);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortField, setSortField] = useState<string>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const isTestLead = role === "TEST_LEAD" || user?.role === "ADMIN";
  const isDeveloper = role === "DEVELOPER";

  const { data: bugs } = useQuery({
    queryKey: ["project-bugs", projectId, statusFilter],
    queryFn: () => customFetch<Bug[]>(`/projects/${projectId}/bugs${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`),
  });

  const { data: assignments } = useQuery({
    queryKey: ["project-users", projectId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/projects/${projectId}/users`),
    enabled: isTestLead,
  });

  const developers: User[] = (assignments ?? [])
    .filter((a) => a.role === "DEVELOPER" || a.role === "TEST_LEAD")
    .map((a) => a.user)
    .filter((u): u is User => !!u);

  const filtered = (bugs ?? []).filter((b) => {
    if (search) {
      const q = search.toLowerCase();
      return (
        `BUG-${b.bug_number}`.toLowerCase().includes(q) ||
        b.defect?.testCase?.title?.toLowerCase().includes(q) ||
        b.support_ticket_number?.toLowerCase().includes(q) ||
        b.developer?.name?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortField) {
      case "bug_number": return (a.bug_number - b.bug_number) * dir;
      case "status": return (a.status.localeCompare(b.status)) * dir;
      case "created_at": return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      case "developer": {
        const na = a.developer?.name ?? "";
        const nb = b.developer?.name ?? "";
        return na.localeCompare(nb) * dir;
      }
      case "defect": {
        const ta = a.defect?.testCase?.title ?? "";
        const tb = b.defect?.testCase?.title ?? "";
        return ta.localeCompare(tb) * dir;
      }
      default: return (a.id - b.id) * dir;
    }
  });

  return (
    <div className="space-y-lg">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display-lg text-display-lg text-primary">Bug Tracking</h2>
          <p className="font-body-base text-on-surface-variant">
            Manage and monitor {bugs?.length ?? 0} technical issues.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface border border-outline-variant rounded-xl p-md flex flex-wrap items-center gap-lg">
        <div className="flex items-center gap-md">
          <span className="font-label-md text-label-md text-outline">Filter by:</span>
          <div className="relative min-w-[160px]">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm font-label-md text-on-surface focus:ring-2 focus:ring-secondary focus:border-secondary outline-none appearance-none"
            >
              <option value="all">Status: All</option>
              {Object.keys(statusBadge).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-outline">expand_more</span>
          </div>
        </div>
        <div className="h-8 w-px bg-outline-variant mx-sm" />
        <div className="flex items-center gap-sm flex-1">
          <div className="flex-1 max-w-md relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-md py-sm bg-surface-container-low border border-outline-variant rounded-lg font-body-sm focus:ring-2 focus:ring-secondary outline-none"
              placeholder="Search Bug #, defect, or ticket..."
            />
          </div>
          <button
            onClick={() => { setStatusFilter("all"); setSearch(""); }}
            className="p-sm text-outline hover:bg-surface-container-low rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined">filter_list</span>
          </button>
        </div>
      </div>

      {/* Bug Table */}
      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant">
              <SortTh field="bug_number" label="Bug #" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh field="defect" label="Linked Defect" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh field="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh field="created_at" label="Created" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh field="developer" label="Assigned Developer" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh field="support_ticket_number" label="Support Ticket" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <th className="px-lg py-md font-label-md text-label-md text-on-surface-variant text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {sorted.map((bug) => (
              <BugRow
                key={bug.id}
                bug={bug}
                expanded={expandedId === bug.id}
                onToggle={() => setExpandedId(expandedId === bug.id ? null : bug.id)}
                isTestLead={isTestLead}
                isDeveloper={isDeveloper}
                currentUserId={user?.userId}
                developers={developers}
                projectId={projectId}
              />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-lg py-md text-center text-on-surface-variant font-body-sm">
                  No bugs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-lg py-md bg-surface-container-low border-t border-outline-variant flex justify-between items-center">
          <span className="font-body-sm text-outline">Showing {sorted.length} of {bugs?.length ?? 0} bugs</span>
        </div>
        </div>
      </div>
    </div>
  );
}

function SortTh({ field, label, sortField, sortDir, onSort }: { field: string; label: string; sortField: string; sortDir: string; onSort: (f: string) => void }) {
  const isActive = sortField === field;
  return (
    <th
      className="px-lg py-md font-label-md text-label-md text-on-surface-variant cursor-pointer select-none whitespace-nowrap hover:text-on-surface transition-colors"
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

function BugRow({
  bug,
  expanded,
  onToggle,
  isTestLead,
  isDeveloper,
  currentUserId,
  developers,
  projectId,
}: {
  bug: Bug;
  expanded: boolean;
  onToggle: () => void;
  isTestLead: boolean;
  isDeveloper: boolean;
  currentUserId: number | undefined;
  developers: User[];
  projectId: number;
}) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);

  const isMyBug = bug.assigned_developer_id === currentUserId;

  const invalidateBugs = () => {
    queryClient.invalidateQueries({ queryKey: ["project-bugs"] });
    queryClient.invalidateQueries({ queryKey: ["myBugs"] });
  };

  const assignMut = useMutation({
    mutationFn: (data: { developerId: number; supportTicketNumber?: string }) =>
      customFetch(`/bugs/${bug.id}/assign`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateBugs(); toast.success("Bug assigned"); setAssignOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (data: { status: string; reason?: string; rootCauseCategory?: string }) =>
      customFetch(`/bugs/${bug.id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateBugs(); toast.success("Status updated"); setResolveOpen(false); setFailedOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const notesMut = useMutation({
    mutationFn: (data: { notes: string; rootCauseCategory?: string }) =>
      customFetch(`/bugs/${bug.id}/notes`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateBugs(); toast.success("Notes updated"); setNotesOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reassignMut = useMutation({
    mutationFn: (developerId: number) =>
      customFetch(`/bugs/${bug.id}/reassign`, { method: "PATCH", body: JSON.stringify({ developerId }) }),
    onSuccess: () => { invalidateBugs(); toast.success("Bug reassigned"); setReassignOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addNoteMut = useMutation({
    mutationFn: (note: string) =>
      customFetch(`/bugs/${bug.id}/notes`, { method: "POST", body: JSON.stringify({ note }) }),
    onSuccess: () => { invalidateBugs(); toast.success("Comment added"); setAddNoteOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const isClosed = bug.status === "CLOSED";

  return (
    <>
      <tr className={`hover:bg-surface-container-low transition-colors group cursor-pointer ${isClosed ? "opacity-60" : ""}`} onClick={onToggle}>
        <td className="px-lg py-md font-label-md text-primary font-semibold">#BUG-{bug.bug_number}</td>
        <td className="px-lg py-md font-body-sm text-on-surface">
          <button
            onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${projectId}/defects`); }}
            className="hover:underline cursor-pointer text-left"
          >
            {bug.defect?.testCase?.title ?? `Defect #${bug.defect_id}`}
          </button>
        </td>
        <td className="px-lg py-md">
          <span className={`inline-flex items-center px-sm py-1 rounded-full text-xs font-bold gap-1 ${statusBadge[bug.status] ?? ""}`}>
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              {bug.status === "OPEN" ? "error" : bug.status === "ASSIGNED" ? "person" : bug.status === "IN_PROGRESS" ? "sync" : bug.status === "RESOLVED" ? "check_circle" : bug.status === "CLOSED" ? "task_alt" : "warning"}
            </span>
            {bug.status}
          </span>
        </td>
        <td className="px-lg py-md font-body-sm text-on-surface-variant whitespace-nowrap">
          {new Date(bug.created_at).toLocaleDateString()}
        </td>
        <td className="px-lg py-md">
          {bug.developer ? (
            <span className="font-body-sm text-on-surface">{bug.developer.name}</span>
          ) : (
            <span className="text-outline italic font-body-sm">Unassigned</span>
          )}
        </td>
        <td className="px-lg py-md font-body-sm">
          {bug.support_ticket_number ? (
            <span className="text-secondary underline">{bug.support_ticket_number}</span>
          ) : (
            <span className="text-outline">—</span>
          )}
        </td>
        <td className="px-lg py-md text-right" onClick={(e) => e.stopPropagation()}>
          {isTestLead && bug.status === "OPEN" && (
            <button onClick={() => setAssignOpen(true)} className="bg-secondary-container text-on-secondary-container px-md py-1 rounded font-label-sm hover:opacity-80">
              Assign
            </button>
          )}
          {isDeveloper && isMyBug && bug.status === "ASSIGNED" && (
            <button onClick={() => statusMut.mutate({ status: "IN_PROGRESS" })} className="bg-primary text-on-primary px-md py-1 rounded font-label-sm hover:opacity-80">
              Start Work
            </button>
          )}
          {isDeveloper && isMyBug && bug.status === "IN_PROGRESS" && (
            <div className="flex gap-1">
              <button onClick={() => setResolveOpen(true)} className="bg-secondary text-on-secondary px-md py-1 rounded font-label-sm hover:opacity-80">
                Resolve
              </button>
              <button onClick={() => setFailedOpen(true)} className="bg-error text-on-error px-md py-1 rounded font-label-sm hover:opacity-80">
                Failed
              </button>
            </div>
          )}
          {isTestLead && (bug.status === "RESOLVED") && (
            <button onClick={() => statusMut.mutate({ status: "TEST" })} className="bg-secondary text-on-secondary px-md py-1 rounded font-label-sm hover:opacity-80">
              Mark TEST
            </button>
          )}
          {isTestLead && (bug.status === "FAILED_TO_RESOLVE" || bug.status === "REOPENED") && (
            <button onClick={() => setReassignOpen(true)} className="bg-secondary-container text-on-secondary-container px-md py-1 rounded font-label-sm hover:opacity-80">
              Reassign
            </button>
          )}
          <button onClick={() => setNotesOpen(true)} className="p-1.5 hover:bg-surface-container-high rounded text-on-surface-variant transition-colors ml-1" title="Update Notes">
            <span className="material-symbols-outlined text-sm">note</span>
          </button>
          <button onClick={() => setAddNoteOpen(true)} className="p-1.5 hover:bg-surface-container-high rounded text-on-surface-variant transition-colors" title="Add Comment">
            <span className="material-symbols-outlined text-sm">comment</span>
          </button>
        </td>
      </tr>
      <tr className={`bg-surface-container-lowest ${expanded ? "" : "hidden"}`}>
        <td className="p-0" colSpan={7}>
          <div className="p-lg border-l-4 border-secondary ml-md my-sm space-y-md">
            <div>
              <h4 className="text-xs font-bold text-outline uppercase mb-sm">Developer Notes</h4>
              <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">
                {bug.developer_notes ?? "No developer notes yet."}
              </p>
              <div className="flex items-center gap-lg mt-sm text-xs text-on-surface-variant">
                <span>Created: {new Date(bug.created_at).toLocaleString()}</span>
                <span>Updated: {new Date(bug.updated_at).toLocaleString()}</span>
              </div>
            </div>
            {bug.failed_to_resolve_reason && (
              <div>
                <h4 className="text-xs font-bold text-outline uppercase mb-sm">Failed to Resolve Reason</h4>
                <p className="font-body-sm text-body-sm text-error">{bug.failed_to_resolve_reason}</p>
              </div>
            )}
            {bug.root_cause_category && (
              <div>
                <h4 className="text-xs font-bold text-outline uppercase mb-sm">Root Cause Category</h4>
                <p className="font-body-sm text-body-sm text-on-surface">{bug.root_cause_category}</p>
              </div>
            )}
            {/* Comments Thread */}
            {bug.notes && bug.notes.length > 0 && (
              <div className="border-t border-outline-variant pt-md">
                <h4 className="text-xs font-bold text-outline uppercase mb-sm">
                  Comments ({bug.notes.length})
                </h4>
                <div className="space-y-sm max-h-48 overflow-y-auto">
                  {bug.notes.map((n) => (
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

      {/* Assign Dialog */}
      {assignOpen && (
        <Dialog onClose={() => setAssignOpen(false)} title="Assign Bug">
          <AssignForm
            developers={developers.filter((d) => d.id !== currentUserId)}
            onSave={(data) => assignMut.mutate(data)}
            loading={assignMut.isPending}
          />
        </Dialog>
      )}

      {/* Resolve Dialog */}
      {resolveOpen && (
        <Dialog onClose={() => setResolveOpen(false)} title="Mark Resolved">
          <ResolveForm
            onSave={(data) => {
              notesMut.mutate({ notes: data.developerNotes, rootCauseCategory: data.rootCauseCategory });
              setTimeout(() => statusMut.mutate({ status: "RESOLVED" }), 100);
            }}
            loading={notesMut.isPending || statusMut.isPending}
          />
        </Dialog>
      )}

      {/* Failed to Resolve Dialog */}
      {failedOpen && (
        <Dialog onClose={() => setFailedOpen(false)} title="Failed to Resolve">
          <FailedForm
            onSave={(reason) => statusMut.mutate({ status: "FAILED_TO_RESOLVE", reason })}
            loading={statusMut.isPending}
          />
        </Dialog>
      )}

      {/* Reassign Dialog */}
      {reassignOpen && (
        <Dialog onClose={() => setReassignOpen(false)} title="Reassign Bug">
          <ReassignForm
            developers={developers.filter((d) => d.id !== bug.assigned_developer_id)}
            onSave={(developerId) => reassignMut.mutate(developerId)}
            loading={reassignMut.isPending}
          />
        </Dialog>
      )}

      {/* Notes Dialog */}
      {notesOpen && (
        <Dialog onClose={() => setNotesOpen(false)} title={bug.developer_notes ? "Edit Notes" : "Add Notes"}>
          <form onSubmit={(e) => { e.preventDefault(); notesMut.mutate({ notes: notesText || bug.developer_notes || "" }); }} className="space-y-md">
            <textarea
              defaultValue={bug.developer_notes ?? ""}
              onChange={(e) => setNotesText(e.target.value)}
              className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none"
              placeholder="Developer notes..."
            />
            <button type="submit" disabled={notesMut.isPending} className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
              {notesMut.isPending ? "Saving..." : "Save Notes"}
            </button>
          </form>
        </Dialog>
      )}

      {/* Add Comment Dialog */}
      {addNoteOpen && (
        <Dialog onClose={() => setAddNoteOpen(false)} title="Add Comment">
          <BugNoteForm
            onSave={(note) => addNoteMut.mutate(note)}
            loading={addNoteMut.isPending}
          />
        </Dialog>
      )}
    </>
  );
}

function BugNoteForm({ onSave, loading }: { onSave: (note: string) => void; loading: boolean }) {
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

function Dialog({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg space-y-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-title-sm text-title-sm">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-surface-container-low"><span className="material-symbols-outlined">close</span></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AssignForm({ developers, onSave, loading }: { developers: User[]; onSave: (d: { developerId: number; supportTicketNumber?: string }) => void; loading: boolean }) {
  const [devId, setDevId] = useState(developers[0]?.id ?? 0);
  const [ticket, setTicket] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ developerId: devId, supportTicketNumber: ticket || undefined }); }} className="space-y-md">
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Developer</label>
        <select value={devId} onChange={(e) => setDevId(Number(e.target.value))} className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm">
          {developers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Support Ticket (optional)</label>
        <input value={ticket} onChange={(e) => setTicket(e.target.value)} className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm" placeholder="e.g. SUP-12345" />
      </div>
      <button type="submit" disabled={loading || !devId} className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Saving..." : "Assign"}
      </button>
    </form>
  );
}

function ResolveForm({ onSave, loading }: { onSave: (d: { developerNotes: string; rootCauseCategory: string }) => void; loading: boolean }) {
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ developerNotes: notes, rootCauseCategory: category }); }} className="space-y-md">
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Root Cause Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} required className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm">
          <option value="">Select...</option>
          <option value="Requirements Gap">Requirements Gap</option>
          <option value="Design Defect">Design Defect</option>
          <option value="Coding Error">Coding Error</option>
          <option value="Environment Issue">Environment Issue</option>
          <option value="Test Data Issue">Test Data Issue</option>
          <option value="Configuration Error">Configuration Error</option>
          <option value="Third-Party Integration">Third-Party Integration</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Developer Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-20 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Resolution notes..." />
      </div>
      <button type="submit" disabled={loading || !category} className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Saving..." : "Resolve"}
      </button>
    </form>
  );
}

function FailedForm({ onSave, loading }: { onSave: (reason: string) => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onSave(reason.trim()); }} className="space-y-md">
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-24 bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none" placeholder="Reason for failing to resolve..." required />
      <button type="submit" disabled={loading || !reason.trim()} className="w-full py-sm bg-error text-on-error rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Saving..." : "Confirm"}
      </button>
    </form>
  );
}

function ReassignForm({ developers, onSave, loading }: { developers: User[]; onSave: (devId: number) => void; loading: boolean }) {
  const [devId, setDevId] = useState(developers[0]?.id ?? 0);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(devId); }} className="space-y-md">
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm">Reassign to</label>
        <select value={devId} onChange={(e) => setDevId(Number(e.target.value))} className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm">
          {developers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <button type="submit" disabled={loading || !devId} className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50">
        {loading ? "Saving..." : "Reassign"}
      </button>
    </form>
  );
}
