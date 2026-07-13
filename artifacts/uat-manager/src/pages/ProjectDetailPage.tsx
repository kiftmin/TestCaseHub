import { useState, useCallback, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useProjectRole } from "../hooks/useProjectRole";
import { Button } from "../components/ui/button";
import { TestPlanForm, type TestPlanFormData } from "../components/test-plan-form";
import { TestPlanTab as TestPlanTabV2 } from "../components/test-plan-tab";
import type {
  Project,
  UseCase,
  ProjectAssignment,
  User,
} from "../types/api";

/* ───────────── Page component ───────────── */

export function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const projectId = Number(params.id);
  const [, setLocation] = useLocation();
  const [, teamRoute] = useRoute("/projects/:id/team");
  const [, runsRoute] = useRoute("/projects/:id/test-runs");

  const routeTab = teamRoute ? "team" : runsRoute ? "runs" : "plan";
  const [tab, setTab] = useState<"plan" | "team" | "runs">(routeTab);

  useEffect(() => { document.title = "Project | TestCaseHub"; }, []);

  useEffect(() => {
    const current = teamRoute ? "team" : runsRoute ? "runs" : "plan";
    if (current !== tab) setTab(current);
  }, [teamRoute, runsRoute]);

  const handleTab = (t: "plan" | "team" | "runs") => {
    setTab(t);
    if (t === "team") {
      setLocation(`/projects/${projectId}/team`, { replace: true });
    } else if (t === "runs") {
      setLocation(`/projects/${projectId}/test-runs`, { replace: true });
    } else {
      setLocation(`/projects/${projectId}`, { replace: true });
    }
  };

  return (
    <div className="space-y-lg">
      <TabNav tab={tab} onTab={handleTab} projectId={projectId} />
      <ProjectHeader projectId={projectId} />
      {tab === "plan" && <TestPlanTabV2 projectId={projectId} />}
      {tab === "team" && <TeamTab projectId={projectId} />}
      {tab === "runs" && <TestRunsTab projectId={projectId} />}
    </div>
  );
}

/* ───────────── Tab navigation ───────────── */

function TabNav({
  tab,
  onTab,
  projectId,
}: {
  tab: string;
  onTab: (t: "plan" | "team" | "runs") => void;
  projectId: number;
}) {
  const [, navigate] = useLocation();
  const tabs = [
    { key: "plan", label: "Test Plan" },
    { key: "team", label: "Team" },
    { key: "runs", label: "Test Runs" },
  ] as const;
  const links = [
    { key: "defects", label: "Defects", href: `/projects/${projectId}/defects` },
    { key: "sign-off", label: "Sign-off", href: `/projects/${projectId}/sign-off` },
  ] as const;
  return (
    <div className="flex gap-lg border-b border-outline-variant overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onTab(t.key)}
          className={`px-md py-sm font-label-md text-label-md transition-colors whitespace-nowrap ${
            tab === t.key
              ? "text-secondary border-b-2 border-secondary -mb-[1px]"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          {t.label}
        </button>
      ))}
      <div className="w-px bg-outline-variant self-stretch mx-sm" />
      {links.map((l) => (
        <button
          key={l.key}
          onClick={() => navigate(l.href)}
          className="px-md py-sm font-label-md text-label-md transition-colors whitespace-nowrap text-on-surface-variant hover:text-primary"
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Project header card ───────────── */

function ProjectHeader({ projectId }: { projectId: number }) {
  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => customFetch<Project>(`/projects/${projectId}`),
  });
  const role = useProjectRole(projectId);
  const canEdit = role === "TEST_LEAD" || role === "ADMIN" || role === "TEST_AUTHOR";
  const user = getStoredUser();
  const isAdmin = user?.role === "ADMIN";
  const [, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const queryClient = useQueryClient();

  const editMutation = useMutation({
    mutationFn: (data: TestPlanFormData) =>
      customFetch<Project>(`/projects/${projectId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: data.name.trim(),
          designed_by: data.designedBy.trim(),
          module_name: data.moduleName.trim(),
          design_date: data.designDate,
          test_link: data.testLink.trim() || null,
          test_lead_id: data.testLeadId,
          objectives: data.objectives.trim() || null,
          scope: data.scope.trim() || null,
          out_of_scope: data.outOfScope.trim() || null,
          entry_criteria: data.entryCriteria.trim() || null,
          exit_criteria: data.exitCriteria.trim() || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      setEditOpen(false);
      toast.success("Project updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      customFetch<void>(`/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
      navigate("/projects");
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setDeleteOpen(false);
      setDeleteConfirmText("");
    },
  });

  if (isLoading) {
    return (
      <section className="bg-surface border border-outline-variant rounded-lg overflow-hidden animate-pulse p-md space-y-2">
        <div className="w-3/4 h-5 skeleton rounded" />
        <div className="w-1/2 h-4 skeleton rounded" />
      </section>
    );
  }

  if (!project) {
    return (
      <section className="bg-surface border border-outline-variant rounded-lg p-md">
        <p className="text-error font-body-base">Project not found</p>
      </section>
    );
  }

  return (
    <section className="bg-surface border border-outline-variant rounded-lg overflow-hidden">
      <div
        onClick={() => setCollapsed(!collapsed)}
        className="p-md flex items-center justify-between cursor-pointer hover:bg-surface-container-low transition-colors"
      >
        <div className="flex items-center gap-md flex-wrap">
          <span className="px-sm py-1 bg-surface-container text-on-surface-variant font-label-sm text-label-sm rounded">
            {project.project_code}
          </span>
          <h1 className="font-title-sm text-title-sm">{project.name}</h1>
          <span className="px-sm py-1 bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm rounded">
            v{project.version}
          </span>
          <span
            className={`flex items-center gap-xs px-sm py-1 font-label-sm text-label-sm rounded ${
              project.is_signed_off === 1
                ? "bg-green-100 text-green-700"
                : "bg-outline-variant/20 text-on-surface-variant"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                project.is_signed_off === 1
                  ? "bg-green-500"
                  : "bg-secondary animate-pulse"
              }`}
            />
            {project.is_signed_off === 1 ? "SIGNED OFF" : "IN PROGRESS"}
          </span>
        </div>
        <div className="flex items-center gap-md">
          {canEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditOpen(true);
              }}
              className="flex items-center gap-sm text-secondary font-label-md text-label-md border border-secondary px-md py-1 rounded-lg hover:bg-secondary/5 transition-all"
            >
              <span className="material-symbols-outlined text-sm">edit</span>
              Edit Project
            </button>
          )}
          {isAdmin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteOpen(true);
                setDeleteConfirmText("");
              }}
              className="flex items-center gap-sm text-error font-label-md text-label-md border border-error px-md py-1 rounded-lg hover:bg-error/5 transition-all"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              Delete
            </button>
          )}
          <span className="material-symbols-outlined text-on-surface-variant transition-transform">
            {collapsed ? "expand_more" : "expand_less"}
          </span>
        </div>
      </div>
      <TestPlanForm
        key={project.id}
        mode="edit"
        open={editOpen}
        initial={project}
        saving={editMutation.isPending}
        onSave={(data) => editMutation.mutate(data)}
        onClose={() => setEditOpen(false)}
      />
      {/* Delete Confirmation Modal */}
      {deleteOpen && project && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-md" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
            onClick={() => { setDeleteOpen(false); setDeleteConfirmText(""); }}
            aria-hidden="true"
          />
          <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-lg mx-4 p-lg space-y-md">
            <div className="flex items-start gap-md">
              <div className="w-10 h-10 rounded-full bg-error-container text-error flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined">warning</span>
              </div>
              <div className="min-w-0">
                <h2 className="font-headline-md text-headline-md text-primary leading-tight">Delete Project</h2>
                <p className="text-body-sm text-on-surface-variant mt-1">
                  This will permanently delete <strong>{project.name}</strong> ({project.project_code}).
                </p>
              </div>
            </div>

            {(project.useCaseCount ?? 0) > 0 && (
              <div className="bg-error-container/50 border border-error rounded-lg p-md -mx-sm">
                <p className="font-label-md text-error flex items-center gap-1.5 mb-1">
                  <span className="material-symbols-outlined text-[16px]">info</span>
                  This project contains data
                </p>
                <ul className="text-body-sm text-on-surface-variant space-y-0.5 ml-5 list-disc">
                  <li>{project.useCaseCount} scenario{(project.useCaseCount ?? 0) !== 1 ? "s" : ""}</li>
                  <li>All test cases, steps, and execution results within those scenarios</li>
                  <li>{project.testRunCount ?? 0} test run{(project.testRunCount ?? 0) !== 1 ? "s" : ""}</li>
                  <li>Defects, discussions, and audit logs</li>
                </ul>
                <p className="text-body-sm text-on-surface-variant mt-2 font-medium">
                  This action <strong className="text-error">cannot be undone</strong>.
                </p>
              </div>
            )}

            <div>
              <label className="text-label-sm text-on-surface-variant font-label-sm block mb-1">
                Type the project name <strong className="text-on-surface">{project.name}</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={project.name}
                className="w-full px-md py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant/40 text-body-sm focus:outline-none focus:ring-2 focus:ring-error/50 focus:border-error transition-all"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && deleteConfirmText === project.name) {
                    deleteMutation.mutate();
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-sm pt-sm">
              <Button variant="ghost" onClick={() => { setDeleteOpen(false); setDeleteConfirmText(""); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={deleteConfirmText !== project.name}
                onClick={() => deleteMutation.mutate()}
                className={deleteConfirmText === project.name ? "!bg-error !text-on-error hover:!brightness-110" : ""}
              >
                Delete this project
              </Button>
            </div>
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="p-md pt-0 grid grid-cols-1 md:grid-cols-3 gap-lg border-t border-outline-variant/50 bg-surface-container-lowest">
          <div className="mt-md">
            <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold mb-xs">
              Designed By
            </p>
            <p className="font-label-md text-label-md">{project.designed_by}</p>
          </div>
          <div className="mt-md">
            <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold mb-xs">
              Module
            </p>
            <p className="font-label-md text-label-md">{project.module_name}</p>
          </div>
          <div className="mt-md">
            <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold mb-xs">
              Created Date
            </p>
            <p className="font-label-md text-label-md">
              {new Date(project.created_at).toLocaleDateString()}
            </p>
          </div>
          {project.objectives && (
            <div className="col-span-3 mt-sm">
              <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold mb-xs">
                Objectives
              </p>
              <p className="font-body-sm">{project.objectives}</p>
            </div>
          )}
          {project.scope && (
            <div className="col-span-3 mt-sm">
              <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold mb-xs">
                Scope
              </p>
              <p className="font-body-sm">{project.scope}</p>
            </div>
          )}
          {project.out_of_scope && (
            <div className="col-span-3 mt-sm">
              <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold mb-xs">
                Out of Scope
              </p>
              <p className="font-body-sm">{project.out_of_scope}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}


/* ───────────── TEAM TAB ───────────── */

function TeamTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const role = useProjectRole(projectId);
  const canManage = role === "TEST_LEAD" || role === "ADMIN";
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ProjectAssignment | null>(null);

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["project-users", projectId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/projects/${projectId}/users`),
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project-users", projectId] });
  }, [queryClient, projectId]);

  const addMutation = useMutation({
    mutationFn: (d: { userId: number; role: string; isQa?: boolean }) =>
      customFetch(`/projects/${projectId}/users`, {
        method: "POST",
        body: JSON.stringify(d),
      }),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      toast.success("Member added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchMutation = useMutation({
    mutationFn: (d: { userId: number; isQa: boolean }) =>
      customFetch(`/projects/${projectId}/users/${d.userId}`, {
        method: "PATCH",
        body: JSON.stringify({ isQa: d.isQa }),
      }),
    onSuccess: () => {
      invalidate();
      toast.success("QA flag updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: number) =>
      customFetch<void>(`/projects/${projectId}/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setRemoveTarget(null);
      toast.success("Member removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const roleColors: Record<string, string> = {
    TEST_LEAD: "text-secondary",
    TEST_AUTHOR: "text-on-tertiary-container",
    BUSINESS_OWNER: "text-purple-700",
    TESTER: "text-on-surface-variant",
    DEVELOPER: "text-blue-700",
    UAT_COORDINATOR: "text-amber-700",
  };

  if (isLoading) {
    return (
      <div className="bg-surface border border-outline-variant rounded-lg p-md space-y-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-md">
            <div className="w-8 h-8 rounded-full skeleton" />
            <div className="w-32 h-4 skeleton rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-outline-variant rounded-lg p-md">
      <div className="flex items-center justify-between mb-md">
        <h3 className="font-title-sm text-title-sm">Assigned Team</h3>
        {canManage && (
          <button
            onClick={() => setAddOpen(true)}
            className="bg-primary text-on-primary font-label-sm text-label-sm px-md py-1 rounded-lg hover:opacity-90"
          >
            Add Member
          </button>
        )}
      </div>
      <div className="space-y-sm">
        {assignments?.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between p-sm hover:bg-surface-container-low rounded-lg transition-colors"
          >
            <div className="flex items-center gap-md">
              <div className="w-8 h-8 rounded-full bg-secondary-fixed flex items-center justify-center font-label-md text-on-secondary-fixed text-xs">
                {a.user?.name
                  ?.split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() ?? "?"}
              </div>
              <div>
                <p className="font-label-md text-label-md">{a.user?.name ?? "Unknown"}</p>
                <div className="flex items-center gap-1.5">
                  <p
                    className={`text-[10px] font-bold uppercase tracking-tighter ${
                      roleColors[a.role] ?? "text-on-surface-variant"
                    }`}
                  >
                    {a.role}
                  </p>
                  {a.role === "DEVELOPER" && a.is_qa && (
                    <span className="text-[9px] font-bold uppercase tracking-tighter bg-teal-100 text-teal-700 px-1 rounded">
                      QA
                    </span>
                  )}
                </div>
              </div>
            </div>
            {canManage && a.role === "DEVELOPER" && (
              <button
                onClick={() => patchMutation.mutate({ userId: a.user_id, isQa: !a.is_qa })}
                className={`text-[10px] font-bold uppercase tracking-tighter px-1.5 py-0.5 rounded border ${
                  a.is_qa ? "bg-teal-100 text-teal-700 border-teal-200" : "bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                }`}
                title="Toggle QA review capability"
              >
                {a.is_qa ? "QA ✓" : "Set QA"}
              </button>
            )}
            {canManage && (
              <button
                onClick={() => setRemoveTarget(a)}
                className="material-symbols-outlined text-on-surface-variant hover:text-error"
              >
                remove_circle
              </button>
            )}
          </div>
        ))}
        {(!assignments || assignments.length === 0) && (
          <p className="text-on-surface-variant font-body-sm">No team members assigned yet.</p>
        )}
      </div>

      {/* Add Member Dialog */}
      {addOpen && (
          <AddMemberDialog
            existingUserIds={assignments?.map((a) => a.user_id) ?? []}
            onSave={(d) => addMutation.mutate({ userId: d.userId, role: d.role, isQa: d.isQa })}
            onClose={() => setAddOpen(false)}
            saving={addMutation.isPending}
          />
      )}

      {/* Remove Confirm */}
      {removeTarget && (
        <ConfirmDialog
          title="Remove Member"
          message={`Remove ${removeTarget.user?.name ?? "this user"} from the project?`}
          confirmLabel="Remove"
          onConfirm={() => removeMutation.mutate(removeTarget.user_id)}
          onCancel={() => setRemoveTarget(null)}
          loading={removeMutation.isPending}
          destructive
        />
      )}
    </div>
  );
}

/* ───────────── Add Member Dialog ───────────── */

function AddMemberDialog({
  existingUserIds,
  onSave,
  onClose,
  saving,
}: {
  existingUserIds: number[];
  onSave: (d: { userId: number; role: string; isQa?: boolean }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => customFetch<User[]>("/users"),
  });
  const [userId, setUserId] = useState<number | null>(null);
  const [role, setRole] = useState("TESTER");
  const [isQa, setIsQa] = useState(false);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg space-y-lg">
        <h3 className="font-headline-md text-headline-md text-primary">Add Team Member</h3>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">User</label>
          <select
            className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
            value={userId ?? ""}
            onChange={(e) => setUserId(Number(e.target.value))}
          >
            <option value="" disabled>
              Select a user...
            </option>
            {users
              ?.filter((u) => u.is_active && !existingUserIds.includes(u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.username})
                </option>
              ))}
          {users?.filter((u) => u.is_active && !existingUserIds.includes(u.id)).length === 0 && (
            <option value="" disabled>All users are already members</option>
          )}
          </select>
        </div>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">Project Role</label>
          <select
            className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
            value={role}
            onChange={(e) => { setRole(e.target.value); if (e.target.value !== "DEVELOPER") setIsQa(false); }}
          >
            {[
              "TEST_LEAD",
              "TEST_AUTHOR",
              "BUSINESS_OWNER",
              "TESTER",
              "DEVELOPER",
              "UAT_COORDINATOR",
            ].map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        {role === "DEVELOPER" && (
          <label className="flex items-center gap-2 text-on-surface font-label-sm">
            <input
              type="checkbox"
              checked={isQa}
              onChange={(e) => setIsQa(e.target.checked)}
              className="w-4 h-4"
            />
            Is QA? (developer with QA review capability)
          </label>
        )}
        <div className="flex gap-md justify-end">
          <button
            onClick={onClose}
            className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!userId || saving}
          onClick={() => userId && onSave({ userId, role, isQa: role === "DEVELOPER" ? isQa : false })}
            className="px-lg py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 transition-all disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add Member"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── TEST RUNS TAB ───────────── */

function TestRunsTab({ projectId }: { projectId: number }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const role = useProjectRole(projectId);
  const canCreate = role === "TEST_LEAD" || role === "ADMIN";
  const [newDialog, setNewDialog] = useState(false);
  const [retestDialog, setRetestDialog] = useState(false);

  const { data: runs, isLoading } = useQuery({
    queryKey: ["project-test-runs", projectId],
    queryFn: () => customFetch<(import("../types/api").TestRun)[]>(`/projects/${projectId}/test-runs`),
  });

  const { data: useCases } = useQuery({
    queryKey: ["use-cases", projectId],
    queryFn: () => customFetch<UseCase[]>(`/use-cases?projectId=${projectId}`),
    enabled: newDialog,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project-test-runs", projectId] });
  }, [queryClient, projectId]);

  const createMutation = useMutation({
    mutationFn: (d: { name: string; scheduled_at: string; useCaseIds: number[] }) =>
      customFetch("/test-runs", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          name: d.name,
          scheduled_at: d.scheduled_at || undefined,
          useCaseIds: d.useCaseIds,
        }),
      }),
    onSuccess: () => {
      invalidate();
      setNewDialog(false);
      toast.success("Test run created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createRetestMutation = useMutation({
    mutationFn: (d: { name: string; scheduled_at?: string }) =>
      customFetch(`/projects/${projectId}/test-runs/retest`, {
        method: "POST",
        body: JSON.stringify(d),
      }),
    onSuccess: () => {
      invalidate();
      setRetestDialog(false);
      toast.success("Retest run created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusColors: Record<string, string> = {
    completed: "bg-outline-variant/30 text-on-surface-variant",
    in_progress: "bg-secondary-container text-on-secondary-container",
    scheduled: "bg-blue-100 text-blue-700",
  };

  if (isLoading) {
    return (
      <div className="space-y-sm animate-pulse">
        {[1, 2].map((i) => (
          <div key={i} className="border border-outline-variant rounded-lg p-md">
            <div className="w-1/2 h-5 skeleton rounded mb-2" />
            <div className="w-1/3 h-4 skeleton rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-title-sm text-title-sm">Test Runs</h3>
        {canCreate && (
          <div className="flex items-center gap-sm">
            <button
              onClick={() => setRetestDialog(true)}
              className="border border-outline-variant font-label-sm text-label-sm px-md py-1 rounded-lg hover:bg-surface-container-low transition-all"
            >
              Create Retest Run
            </button>
            <button
              onClick={() => setNewDialog(true)}
              className="bg-secondary text-on-secondary font-label-sm text-label-sm px-md py-1 rounded-lg hover:brightness-110 transition-all"
            >
              New Test Run
            </button>
          </div>
        )}
      </div>

      {runs?.map((r) => (
        <div
          key={r.id}
          onClick={() => navigate(`/test-runs/${r.id}`)}
          className="border border-outline-variant rounded-lg p-md hover:border-secondary transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-xs">
            <div className="flex items-center gap-sm">
              <h4 className="font-label-md text-label-md">{r.name}</h4>
              {r.run_type === "retest" && (
                <span className="text-[10px] px-sm py-0.5 rounded bg-amber-100 text-amber-700 font-bold uppercase">
                  Retest
                </span>
              )}
            </div>
            <span
              className={`text-[10px] px-sm py-1 rounded font-bold uppercase ${statusColors[r.status] ?? ""}`}
            >
              {r.status.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex items-center gap-md text-[10px] text-on-surface-variant">
            {r.scheduled_at && (
              <span>Scheduled: {new Date(r.scheduled_at).toLocaleDateString()}</span>
            )}
            {r.passed !== null && (
              <span className={r.passed ? "text-green-600" : "text-red-600"}>
                {r.passed ? "Passed" : "Failed"}
              </span>
            )}
          </div>
        </div>
      ))}
      {(!runs || runs.length === 0) && (
        <p className="text-on-surface-variant font-body-sm">No test runs yet.</p>
      )}

      {/* Retest Run Dialog */}
      {retestDialog && (
        <RetestRunDialog
          onSave={(d) => createRetestMutation.mutate(d)}
          onClose={() => setRetestDialog(false)}
          saving={createRetestMutation.isPending}
        />
      )}

      {/* New Test Run Dialog */}
      {newDialog && (
        <NewTestRunDialog
          useCases={useCases ?? []}
          onSave={(d) => createMutation.mutate(d)}
          onClose={() => setNewDialog(false)}
          saving={createMutation.isPending}
        />
      )}
    </div>
  );
}

/* ───────────── New Test Run Dialog ───────────── */

function NewTestRunDialog({
  useCases,
  onSave,
  onClose,
  saving,
}: {
  useCases: UseCase[];
  onSave: (d: { name: string; scheduled_at: string; useCaseIds: number[] }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selected, setSelected] = useState<Set<number>>(() => new Set(useCases.map((u) => u.id)));
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && useCases.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(new Set(useCases.map((u) => u.id)));
      setInitialized(true);
    }
  }, [useCases, initialized]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-lg mx-4 p-lg space-y-lg max-h-[80vh] overflow-y-auto">
        <h3 className="font-headline-md text-headline-md text-primary">New Test Run</h3>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">Run Name</label>
          <input
            className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
            placeholder="e.g. Phase 2 Regression"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">Scheduled At (optional)</label>
          <input
            className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">Scenarios</label>
          <div className="space-y-xs max-h-48 overflow-y-auto border border-outline-variant rounded-lg p-sm">
            {useCases.map((uc) => (
              <label
                key={uc.id}
                className="flex items-center gap-md px-sm py-1.5 hover:bg-surface-container-low rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(uc.id)}
                  onChange={() => toggle(uc.id)}
                  className="w-4 h-4 rounded border-outline-variant text-secondary focus:ring-secondary"
                />
                <span className="font-label-sm text-on-surface">
                  [{uc.code}] {uc.name}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-md justify-end">
          <button
            onClick={onClose}
            className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!name || saving}
            onClick={() =>
              onSave({ name, scheduled_at: scheduledAt, useCaseIds: Array.from(selected) })
            }
            className="px-lg py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 transition-all disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Run"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Retest Run Dialog ───────────── */

function RetestRunDialog({
  onSave,
  onClose,
  saving,
}: {
  onSave: (d: { name: string; scheduled_at?: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState("Retest Run");
  const [scheduledAt, setScheduledAt] = useState("");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg space-y-lg">
        <h3 className="font-headline-md text-headline-md text-primary">Create Retest Run</h3>
        <p className="font-body-sm text-on-surface-variant">
          Automatically creates a test run containing the scenarios linked to all
          defects currently at <strong>Ready for Verification</strong>. Business
          testers will see this run in their dashboard.
        </p>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">Run Name</label>
          <input
            className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">Scheduled At (optional)</label>
          <input
            className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary outline-none"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>
        <div className="flex gap-md justify-end">
          <button
            onClick={onClose}
            className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!name || saving}
            onClick={() => onSave({ name, scheduled_at: scheduledAt || undefined })}
            className="px-lg py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 transition-all disabled:opacity-50"
          >
            {saving ? "Creating\u2026" : "Create Retest Run"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Shared Confirm Dialog ───────────── */

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
  destructive,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onCancel}
      />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg">
        <h3 className="font-headline-md text-headline-md text-primary mb-sm">{title}</h3>
        <p className="font-body-base text-on-surface-variant mb-lg">{message}</p>
        <div className="flex gap-md justify-end">
          <button
            onClick={onCancel}
            className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-lg py-sm rounded-lg font-label-md transition-all disabled:opacity-50 ${
              destructive
                ? "bg-error text-on-error hover:brightness-110"
                : "bg-secondary text-on-secondary hover:brightness-110"
            }`}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
