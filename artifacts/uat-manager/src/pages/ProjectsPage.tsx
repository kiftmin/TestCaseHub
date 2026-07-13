import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog } from "../components/ui/dialog";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { TestPlanForm, type TestPlanFormData } from "../components/test-plan-form";
import { ImportWizard } from "../components/import-wizard";
import { useConfirmDialog } from "../hooks/use-confirm-dialog";
import type { Project } from "../types/api";

type ViewMode = "cards" | "list" | "details";

function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => customFetch<Project[]>("/projects"),
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function StatusBadge({ isSignedOff }: { isSignedOff: number }) {
  const on = isSignedOff === 1;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
        on ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-green-500" : "bg-amber-500"}`} />
      {on ? "Signed Off" : "In Progress"}
    </span>
  );
}

function ProjectCard({ p, isAdmin, onDelete }: { p: Project; isAdmin: boolean; onDelete: (p: Project) => void }) {
  const [, navigate] = useLocation();
  return (
    <div
      onClick={() => navigate(`/projects/${p.id}`)}
      className="group bg-surface-container-lowest border border-outline-variant rounded-xl p-md cursor-pointer hover:shadow-lg hover:border-secondary/30 transition-all duration-300"
    >
      <div className="flex justify-between items-start mb-sm">
        <code className="font-mono text-[11px] px-2 py-1 bg-surface-container-high text-on-surface-variant rounded">
          {p.project_code}
        </code>
        <StatusBadge isSignedOff={p.is_signed_off} />
      </div>
      <h3 className="font-title-sm text-title-sm text-on-surface mb-1 group-hover:text-secondary transition-colors">
        {p.name}
      </h3>
      <p className="text-body-sm text-on-surface-variant mb-3">Module: {p.module_name}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-label-sm text-on-surface-variant mb-3">
        <span>Created: {formatDate(p.created_at)}</span>
        <span>Lead: {p.testLead?.name ?? "—"}</span>
        <span>Scenarios: {p.useCaseCount ?? 0}</span>
      </div>
      <div className="flex items-center justify-between pt-md border-t border-outline-variant/50">
        <span className="text-label-sm font-label-sm text-on-surface-variant">v{p.version}</span>
        {isAdmin && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(p); }}
            className="text-on-surface-variant/40 hover:text-error transition-colors p-1"
            title="Delete project"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ProjectRow({ p, isAdmin, onDelete }: { p: Project; isAdmin: boolean; onDelete: (p: Project) => void }) {
  const [, navigate] = useLocation();
  return (
    <tr
      onClick={() => navigate(`/projects/${p.id}`)}
      className="border-b border-outline-variant/50 cursor-pointer hover:bg-surface-container-high transition-colors"
    >
      <td className="py-3 px-4">
        <code className="font-mono text-[11px] px-2 py-1 bg-surface-container-high text-on-surface-variant rounded">
          {p.project_code}
        </code>
      </td>
      <td className="py-3 px-4 font-label-md text-on-surface">{p.name}</td>
      <td className="py-3 px-4 text-label-sm text-on-surface-variant">{p.module_name}</td>
      <td className="py-3 px-4"><StatusBadge isSignedOff={p.is_signed_off} /></td>
      <td className="py-3 px-4 text-label-sm text-on-surface-variant">{formatDate(p.created_at)}</td>
      <td className="py-3 px-4 text-label-sm text-on-surface-variant">{p.testLead?.name ?? "—"}</td>
      <td className="py-3 px-4 text-label-sm text-on-surface-variant">{p.useCaseCount ?? 0}</td>
      <td className="py-3 px-4 text-label-sm text-on-surface-variant">v{p.version}</td>
      <td className="py-3 px-4">
        {isAdmin && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(p); }}
            className="text-on-surface-variant/40 hover:text-error transition-colors p-1"
            title="Delete project"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        )}
      </td>
    </tr>
  );
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md animate-pulse">
          <div className="flex justify-between mb-sm"><div className="w-16 h-5 skeleton rounded" /><div className="w-20 h-5 skeleton rounded-full" /></div>
          <div className="w-3/4 h-6 skeleton rounded mb-2" /><div className="w-1/2 h-4 skeleton rounded mb-4" />
          <div className="pt-md border-t border-outline-variant/50 flex justify-between"><div className="w-12 h-4 skeleton rounded" /><div className="w-16 h-6 skeleton rounded-full" /></div>
        </div>
      ))}
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="animate-pulse space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4 p-4 bg-surface-container-lowest border border-outline-variant rounded-lg">
          <div className="w-20 h-5 skeleton rounded" />
          <div className="w-48 h-5 skeleton rounded" />
          <div className="w-32 h-5 skeleton rounded" />
          <div className="w-24 h-5 skeleton rounded" />
        </div>
      ))}
    </div>
  );
}

export function ProjectsPage() {
  return <ProjectsPageContent />;
}

function ProjectsPageContent() {
  const user = getStoredUser();
  const isAdmin = user?.role === "ADMIN";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const confirm = useConfirmDialog();
  useEffect(() => { document.title = "Projects | TestCaseHub"; }, []);
  const { data: projects, isLoading, error } = useProjects();
  const [slideOver, setSlideOver] = useState(false);
  const [filter, setFilter] = useState<"all" | "signed_off" | "in_progress">("all");
  const [importOpen, setImportOpen] = useState(false);
  const [followUpProject, setFollowUpProject] = useState<Project | null>(null);
  const [view, setView] = useState<ViewMode>("cards");

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createMutation = useMutation({
    mutationFn: (data: TestPlanFormData) =>
      customFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: data.name.trim(),
          designedBy: data.designedBy.trim(),
          moduleName: data.moduleName.trim(),
          designDate: data.designDate,
          testLink: data.testLink.trim() || null,
          testLeadId: data.testLeadId,
          objectives: data.objectives.trim() || null,
          scope: data.scope.trim() || null,
          outOfScope: data.outOfScope.trim() || null,
          entryCriteria: data.entryCriteria.trim() || null,
          exitCriteria: data.exitCriteria.trim() || null,
        }),
      }),
    onSuccess: (proj) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSlideOver(false);
      toast.success("Project created");
      setFollowUpProject(proj);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = projects?.filter((p) => {
    if (filter === "signed_off") return p.is_signed_off === 1;
    if (filter === "in_progress") return p.is_signed_off === 0;
    return true;
  });

  const handleDelete = (p: Project) => {
    confirm.ask({
      title: "Delete Project",
      message: `Are you sure you want to permanently delete "${p.name}" (${p.project_code})? This will remove all use cases, test cases, test runs, defects, and discussions — this action cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => deleteMutation.mutate(p.id),
    });
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-md mb-xl">
        <div>
          <h2 className="font-display-lg text-display-lg text-primary tracking-tight">
            Projects
          </h2>
          <p className="text-on-surface-variant font-body-base">
            Manage and monitor your enterprise UAT cycles.
          </p>
        </div>
        <div className="flex items-center gap-sm">
          {isAdmin && (
            <>
              <button
                onClick={() => setImportOpen(true)}
                className="bg-surface-container-high text-on-surface px-lg py-sm rounded-lg font-label-md flex items-center gap-sm border border-outline-variant hover:bg-surface-container transition-all"
              >
                <span className="material-symbols-outlined">upload_file</span>
                Import from Excel
              </button>
              <button
                onClick={() => setSlideOver(true)}
                className="bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md flex items-center gap-sm shadow-sm hover:brightness-110 transition-all"
              >
                <span className="material-symbols-outlined">add_circle</span>
                New Project
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter Bar + View Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-sm mb-lg">
        <div className="flex items-center gap-sm">
          <span className="text-label-sm text-on-surface-variant font-label-sm uppercase tracking-wider">
            Filter by:
          </span>
          <div className="flex gap-xs">
            {(["all", "in_progress", "signed_off"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-md py-1.5 rounded-full border text-label-sm font-label-sm transition-colors ${
                  filter === f
                    ? "border-secondary bg-secondary/10 text-secondary"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {f === "all"
                  ? "All Projects"
                  : f === "signed_off"
                    ? "Signed Off"
                    : "In Progress"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center bg-surface-container-high rounded-lg p-0.5 border border-outline-variant">
          {(["cards", "list", "details"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-label-sm font-label-sm transition-colors ${
                view === v
                  ? "bg-surface-container-lowest text-on-surface shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {v === "cards" ? "grid_view" : v === "list" ? "view_list" : "table_rows"}
              </span>
              {v === "cards" ? "Cards" : v === "list" ? "List" : "Details"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        view === "cards" ? <SkeletonCards /> : <SkeletonTable />
      ) : error ? (
        <div className="text-center py-xl">
          <p className="text-error font-body-base">Failed to load projects</p>
        </div>
      ) : filtered?.length === 0 ? (
        <div className="text-center py-xl">
          <p className="text-on-surface-variant font-body-base">No projects found</p>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg">
          {filtered?.map((p) => (
            <ProjectCard key={p.id} p={p} isAdmin={isAdmin} onDelete={handleDelete} />
          ))}
        </div>
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-high text-label-sm text-on-surface-variant uppercase tracking-wider">
                <th className="py-3 px-4 font-label-sm">Code</th>
                <th className="py-3 px-4 font-label-sm">Name</th>
                <th className="py-3 px-4 font-label-sm">Module</th>
                <th className="py-3 px-4 font-label-sm">Status</th>
                <th className="py-3 px-4 font-label-sm">Created</th>
                <th className="py-3 px-4 font-label-sm">Test Lead</th>
                <th className="py-3 px-4 font-label-sm">Scenarios</th>
                <th className="py-3 px-4 font-label-sm">Version</th>
                <th className="py-3 px-4 font-label-sm w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered?.map((p) => (
                <ProjectRow key={p.id} p={p} isAdmin={isAdmin} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Test Plan wizard */}
      <TestPlanForm
        mode="create"
        open={slideOver}
        onClose={() => setSlideOver(false)}
        onSave={(data) => createMutation.mutate(data)}
        saving={createMutation.isPending}
      />

      {/* Import from Excel wizard (new-project mode) */}
      <ImportWizard
        mode="new-project"
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImportComplete={(projId) => {
          setImportOpen(false);
          navigate(`/projects/${projId}`);
        }}
      />

      {/* Part 2: Follow-up choices after project creation */}
      <Dialog
        open={!!followUpProject}
        onClose={() => {
          if (followUpProject) navigate(`/projects/${followUpProject.id}`);
          setFollowUpProject(null);
        }}
        title="Project created"
        subtitle="What would you like to do next?"
        size="md"
      >
        <div className="flex flex-col gap-md py-md">
          <button
            onClick={() => {
              const p = followUpProject!;
              setFollowUpProject(null);
              navigate(`/projects/${p.id}?openScenario=1`);
            }}
            className="flex items-center gap-md p-md border border-outline-variant rounded-lg hover:bg-surface-container-high transition-colors text-left"
          >
            <span className="material-symbols-outlined text-secondary text-[32px]">playlist_add</span>
            <div>
              <p className="font-label-md text-on-surface">Add use cases now</p>
              <p className="text-body-sm text-on-surface-variant">Open the project and start creating scenarios right away.</p>
            </div>
          </button>
          <button
            onClick={() => {
              const p = followUpProject!;
              setFollowUpProject(null);
              navigate(`/projects/${p.id}?import=1`);
            }}
            className="flex items-center gap-md p-md border border-outline-variant rounded-lg hover:bg-surface-container-high transition-colors text-left"
          >
            <span className="material-symbols-outlined text-secondary text-[32px]">upload_file</span>
            <div>
              <p className="font-label-md text-on-surface">Import from Excel</p>
              <p className="text-body-sm text-on-surface-variant">Import test cases from a spreadsheet into this project.</p>
            </div>
          </button>
          <button
            onClick={() => {
              const p = followUpProject!;
              setFollowUpProject(null);
              navigate(`/projects/${p.id}`);
            }}
            className="flex items-center gap-md p-md border border-outline-variant rounded-lg hover:bg-surface-container-high transition-colors text-left"
          >
            <span className="material-symbols-outlined text-on-surface-variant text-[32px]">schedule</span>
            <div>
              <p className="font-label-md text-on-surface">I'll do this later</p>
              <p className="text-body-sm text-on-surface-variant">Go to the project overview page.</p>
            </div>
          </button>
        </div>
      </Dialog>

      {confirm.dialog}
    </>
  );
}
