import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog } from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { TestPlanForm, type TestPlanFormData } from "../components/test-plan-form";
import { ImportWizard } from "../components/import-wizard";
import { useConfirmDialog } from "../hooks/use-confirm-dialog";
import type { Project } from "../types/api";

type ViewMode = "cards" | "details";

type SortKey = "project_code" | "name" | "module_name" | "is_signed_off" | "created_at" | "testLead" | "useCaseCount" | "version";
type SortDir = "asc" | "desc";

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

const COLUMNS: { key: SortKey; label: string; sortable: boolean }[] = [
  { key: "project_code", label: "Code", sortable: true },
  { key: "name", label: "Name", sortable: true },
  { key: "module_name", label: "Module", sortable: true },
  { key: "is_signed_off", label: "Status", sortable: true },
  { key: "created_at", label: "Created", sortable: true },
  { key: "testLead", label: "Test Lead", sortable: true },
  { key: "useCaseCount", label: "Scenarios", sortable: true },
  { key: "version", label: "Version", sortable: true },
];

function getSortValue(p: Project, key: SortKey): string | number {
  switch (key) {
    case "project_code": return p.project_code;
    case "name": return p.name.toLowerCase();
    case "module_name": return p.module_name.toLowerCase();
    case "is_signed_off": return p.is_signed_off;
    case "created_at": return p.created_at;
    case "testLead": return (p.testLead?.name ?? "").toLowerCase();
    case "useCaseCount": return p.useCaseCount ?? 0;
    case "version": return p.version;
  }
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="material-symbols-outlined text-[14px] ml-1 align-text-bottom">
      {active ? (dir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}
    </span>
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
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/projects/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmName: deleteConfirmText }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
      setDeleteTarget(null);
      setDeleteConfirmText("");
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setDeleteTarget(null);
      setDeleteConfirmText("");
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: TestPlanFormData) => {
      const proj = await customFetch<Project>("/projects", {
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
      });

      const structure = data.structure ?? [];
      let scenarios = 0;
      let cases = 0;
      let steps = 0;

      for (const sc of structure) {
        if (!sc.code.trim() || !sc.name.trim()) continue;
        const useCase = await customFetch<{ id: number }>(
          `/use-cases?projectId=${proj.id}`,
          {
            method: "POST",
            body: JSON.stringify({
              code: sc.code.trim(),
              name: sc.name.trim(),
            }),
          }
        );
        scenarios++;

        for (const tc of sc.testCases) {
          if (!tc.caseNumber.trim() || !tc.title.trim()) continue;
          const hasStep = tc.steps.some((st) => st.instruction.trim());
          if (!hasStep) continue;

          const testCase = await customFetch<{ id: number }>("/test-cases", {
            method: "POST",
            body: JSON.stringify({
              use_case_id: useCase.id,
              case_number: tc.caseNumber.trim(),
              title: tc.title.trim(),
              ...(tc.precondition.trim()
                ? { precondition: tc.precondition.trim() }
                : {}),
            }),
          });
          cases++;

          const stepPayload = tc.steps
            .filter((st) => st.instruction.trim())
            .map((st, idx) => ({
              step_number: String(idx + 1),
              instruction: st.instruction.trim(),
              ...(st.testData.trim() ? { test_data: st.testData.trim() } : {}),
              ...(st.expectedResult.trim()
                ? { expected_result: st.expectedResult.trim() }
                : {}),
            }));

          if (stepPayload.length > 0) {
            await customFetch("/test-steps/bulk", {
              method: "POST",
              body: JSON.stringify({
                test_case_id: testCase.id,
                steps: stepPayload,
              }),
            });
            steps += stepPayload.length;
          }
        }
      }

      return { proj, structureCounts: { scenarios, cases, steps } };
    },
    onSuccess: ({ proj, structureCounts }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSlideOver(false);
      if (structureCounts.scenarios > 0) {
        toast.success(
          `Project created with ${structureCounts.scenarios} scenario(s), ${structureCounts.cases} case(s), ${structureCounts.steps} step(s)`
        );
        navigate(`/projects/${proj.id}`);
      } else {
        toast.success("Project created");
        setFollowUpProject(proj);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "created_at" ? "desc" : "asc");
    }
  };

  const filtered = useMemo(() => {
    let list = projects ?? [];
    if (filter === "signed_off") list = list.filter((p) => p.is_signed_off === 1);
    if (filter === "in_progress") list = list.filter((p) => p.is_signed_off === 0);

    if (view === "details") {
      list = [...list].sort((a, b) => {
        const va = getSortValue(a, sortKey);
        const vb = getSortValue(b, sortKey);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [projects, filter, view, sortKey, sortDir]);

  const handleDeleteClick = (p: Project) => {
    setDeleteTarget(p);
    setDeleteConfirmText("");
  };

  const isNonEmpty = (deleteTarget?.useCaseCount ?? 0) > 0;
  const confirmMatch = deleteConfirmText === deleteTarget?.name;

  const handleDeleteConfirm = () => {
    if (!deleteTarget || !confirmMatch) return;
    deleteMutation.mutate(deleteTarget.id);
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
                Import Plan
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
          {(["cards", "details"] as const).map((v) => (
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
                {v === "cards" ? "grid_view" : "table_rows"}
              </span>
              {v === "cards" ? "Cards" : "Details"}
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
      ) : filtered.length === 0 ? (
        <div className="text-center py-xl">
          <p className="text-on-surface-variant font-body-base">No projects found</p>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg">
          {filtered.map((p) => (
            <ProjectCard key={p.id} p={p} isAdmin={isAdmin} onDelete={handleDeleteClick} />
          ))}
        </div>
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-high text-label-sm text-on-surface-variant uppercase tracking-wider">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                    className={`py-3 px-4 font-label-sm select-none ${
                      col.sortable ? "cursor-pointer hover:text-on-surface" : ""
                    }`}
                  >
                    <span className="inline-flex items-center">
                      {col.label}
                      {col.sortable && <SortIcon active={sortKey === col.key} dir={sortDir} />}
                    </span>
                  </th>
                ))}
                <th className="py-3 px-4 font-label-sm w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <ProjectRow key={p.id} p={p} isAdmin={isAdmin} onDelete={handleDeleteClick} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-md"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
            onClick={() => { setDeleteTarget(null); setDeleteConfirmText(""); }}
            aria-hidden="true"
          />
          <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-lg mx-4 p-lg space-y-md transform transition-all">
            <div className="flex items-start gap-md">
              <div className="w-10 h-10 rounded-full bg-error-container text-error flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined">warning</span>
              </div>
              <div className="min-w-0">
                <h2 className="font-headline-md text-headline-md text-primary leading-tight">
                  Delete Project
                </h2>
                <p className="text-body-sm text-on-surface-variant mt-1">
                  This will permanently delete <strong>{deleteTarget.name}</strong> ({deleteTarget.project_code}).
                </p>
              </div>
            </div>

            {isNonEmpty && (
              <div className="bg-error-container/50 border border-error rounded-lg p-md -mx-sm">
                <p className="font-label-md text-error flex items-center gap-1.5 mb-1">
                  <span className="material-symbols-outlined text-[16px]">info</span>
                  This project contains data
                </p>
                <ul className="text-body-sm text-on-surface-variant space-y-0.5 ml-5 list-disc">
                  <li>{deleteTarget.useCaseCount} scenario{(deleteTarget.useCaseCount ?? 0) !== 1 ? "s" : ""}</li>
                  {deleteTarget.useCaseCount && deleteTarget.useCaseCount > 0 && (
                    <li>All test cases, steps, and execution results within those scenarios</li>
                  )}
                  <li>{deleteTarget.testRunCount ?? 0} test run{(deleteTarget.testRunCount ?? 0) !== 1 ? "s" : ""}</li>
                  <li>{deleteTarget.attachmentCount ?? 0} attachment{(deleteTarget.attachmentCount ?? 0) !== 1 ? "s" : ""}</li>
                  <li>Defects, discussions, and audit logs</li>
                </ul>
                <p className="text-body-sm text-on-surface-variant mt-2 font-medium">
                  This action <strong className="text-error">cannot be undone</strong>.
                </p>
              </div>
            )}

            <div>
              <label className="text-label-sm text-on-surface-variant font-label-sm block mb-1">
                Type the project name <strong className="text-on-surface">{deleteTarget.name}</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteTarget.name}
                className="w-full px-md py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant/40 text-body-sm focus:outline-none focus:ring-2 focus:ring-error/50 focus:border-error transition-all"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && confirmMatch) handleDeleteConfirm(); }}
              />
            </div>

            <div className="flex items-center justify-end gap-sm pt-sm">
              <Button
                variant="ghost"
                onClick={() => { setDeleteTarget(null); setDeleteConfirmText(""); }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!confirmMatch}
                onClick={handleDeleteConfirm}
                className={confirmMatch ? "!bg-error !text-on-error hover:!brightness-110" : ""}
              >
                Delete this project
              </Button>
            </div>
          </div>
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
              <p className="font-label-md text-on-surface">Import plan structure</p>
              <p className="text-body-sm text-on-surface-variant">Import scenarios, cases, and steps from Excel or CSV (results are never imported).</p>
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
