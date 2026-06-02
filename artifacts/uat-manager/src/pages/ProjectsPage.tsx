import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import type { Project } from "../types/api";

function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => customFetch<Project[]>("/projects"),
  });
}

export function ProjectsPage() {
  return <ProjectsPageContent />;
}

function ProjectsPageContent() {
  const user = getStoredUser();
  const isAdmin = user?.role === "ADMIN";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  useEffect(() => { document.title = "Projects | TestCaseHub"; }, []);
  const { data: projects, isLoading, error } = useProjects();
  const [slideOver, setSlideOver] = useState(false);
  const [filter, setFilter] = useState<"all" | "signed_off" | "in_progress">("all");

  const createMutation = useMutation({
    mutationFn: (data: Record<string, string | null>) =>
      customFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          designedBy: data.designed_by,
          moduleName: data.module_name,
          designDate: data.design_date,
          testLink: data.test_link || null,
          testLeadId: user?.userId ?? 1,
        }),
      }),
    onSuccess: (proj) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSlideOver(false);
      toast.success("Project created");
      navigate(`/projects/${proj.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = projects?.filter((p) => {
    if (filter === "signed_off") return p.is_signed_off === 1;
    if (filter === "in_progress") return p.is_signed_off === 0;
    return true;
  });

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
        {isAdmin && (
          <button
            onClick={() => setSlideOver(true)}
            className="bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md flex items-center gap-sm shadow-sm hover:brightness-110 transition-all"
          >
            <span className="material-symbols-outlined">add_circle</span>
            New Project
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-sm mb-lg">
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

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md animate-pulse"
            >
              <div className="flex justify-between mb-sm">
                <div className="w-16 h-5 skeleton rounded" />
                <div className="w-20 h-5 skeleton rounded-full" />
              </div>
              <div className="w-3/4 h-6 skeleton rounded mb-2" />
              <div className="w-1/2 h-4 skeleton rounded mb-4" />
              <div className="pt-md border-t border-outline-variant/50 flex justify-between">
                <div className="w-12 h-4 skeleton rounded" />
                <div className="w-16 h-6 skeleton rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-xl">
          <p className="text-error font-body-base">Failed to load projects</p>
        </div>
      ) : filtered?.length === 0 ? (
        <div className="text-center py-xl">
          <p className="text-on-surface-variant font-body-base">No projects found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg">
          {filtered?.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="group bg-surface-container-lowest border border-outline-variant rounded-xl p-md cursor-pointer hover:shadow-lg hover:border-secondary/30 transition-all duration-300"
            >
              <div className="flex justify-between items-start mb-sm">
                <code className="font-mono text-[11px] px-2 py-1 bg-surface-container-high text-on-surface-variant rounded">
                  {p.project_code}
                </code>
                <span
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    p.is_signed_off === 1
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      p.is_signed_off === 1 ? "bg-green-500" : "bg-amber-500"
                    }`}
                  />
                  {p.is_signed_off === 1 ? "Signed Off" : "In Progress"}
                </span>
              </div>
              <h3 className="font-title-sm text-title-sm text-on-surface mb-1 group-hover:text-secondary transition-colors">
                {p.name}
              </h3>
              <p className="text-body-sm text-on-surface-variant mb-4">
                Module: {p.module_name}
              </p>
              <div className="flex items-center justify-between pt-md border-t border-outline-variant/50">
                <span className="text-label-sm font-label-sm text-on-surface-variant">
                  v{p.version}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Project Slide-over */}
      <NewProjectSlideOver
        open={slideOver}
        onClose={() => setSlideOver(false)}
        onSave={(data) => createMutation.mutate(data)}
        saving={createMutation.isPending}
      />
    </>
  );
}

function NewProjectSlideOver({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: Record<string, string | null>) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    project_code: "",
    name: "",
    module_name: "",
    designed_by: "",
    design_date: "",
    test_link: "",
    objectives: "",
    scope: "",
    out_of_scope: "",
    entry_criteria: "",
    exit_criteria: "",
  });
  const [errors, setErrors] = useState<string[]>([]);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    if (!form.project_code.trim()) errs.push("Project Code is required");
    if (!form.name.trim()) errs.push("Project Name is required");
    if (!form.module_name.trim()) errs.push("Module Name is required");
    if (!form.designed_by.trim()) errs.push("Designed By is required");
    if (!form.design_date.trim()) errs.push("Design Date is required");
    setErrors(errs);
    if (errs.length > 0) return;

    onSave({
      ...form,
      test_link: form.test_link.trim() || null,
      objectives: form.objectives.trim() || null,
      scope: form.scope.trim() || null,
      out_of_scope: form.out_of_scope.trim() || null,
      entry_criteria: form.entry_criteria.trim() || null,
      exit_criteria: form.exit_criteria.trim() || null,
    });
  };

  return (
    <div
      className={`fixed inset-0 z-[100] ${open ? "" : "invisible"}`}
      style={{ pointerEvents: open ? "auto" : "none" }}
    >
      <div
        className="absolute inset-0 slide-over-backdrop"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div
          className={`w-screen max-w-xl transform transition-transform duration-500 ease-in-out bg-surface-container-lowest shadow-2xl flex flex-col ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant bg-surface">
            <h2 className="font-headline-md text-headline-md text-primary">New Project</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-container-high rounded-full transition-colors"
            >
              <span className="material-symbols-outlined text-on-surface-variant">close</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-lg space-y-lg">
            {errors.length > 0 && (
              <div className="p-md bg-error-container border border-error/20 rounded-lg">
                {errors.map((e, i) => (
                  <p key={i} className="font-body-sm text-on-error-container">{e}</p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-md">
              <div className="space-y-1">
                <label className="text-label-sm font-label-sm text-on-surface-variant block">Project Code</label>
                <input
                  className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all font-mono"
                  placeholder="e.g. TCH-001"
                  value={form.project_code}
                  onChange={set("project_code")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-label-sm font-label-sm text-on-surface-variant block">Module</label>
                <input
                  className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all"
                  placeholder="Enter module"
                  value={form.module_name}
                  onChange={set("module_name")}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-label-sm font-label-sm text-on-surface-variant block">Project Name</label>
              <input
                className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all font-semibold"
                placeholder="Project title"
                value={form.name}
                onChange={set("name")}
              />
            </div>

            <div className="grid grid-cols-2 gap-md">
              <div className="space-y-1">
                <label className="text-label-sm font-label-sm text-on-surface-variant block">Designed By</label>
                <input
                  className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all"
                  placeholder="Full name"
                  value={form.designed_by}
                  onChange={set("designed_by")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-label-sm font-label-sm text-on-surface-variant block">Design Date</label>
                <input
                  className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all"
                  type="date"
                  value={form.design_date}
                  onChange={set("design_date")}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-label-sm font-label-sm text-on-surface-variant block">Test Link (URL)</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">link</span>
                <input
                  className="w-full bg-surface border border-outline-variant rounded-lg pl-10 pr-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all"
                  placeholder="https://..."
                  type="url"
                  value={form.test_link}
                  onChange={set("test_link")}
                />
              </div>
            </div>

            <div className="space-y-lg">
              <div className="space-y-1">
                <label className="text-label-sm font-label-sm text-on-surface-variant block">Objectives</label>
                <textarea
                  className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all resize-none"
                  rows={2}
                  value={form.objectives}
                  onChange={set("objectives")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-label-sm font-label-sm text-on-surface-variant block">Scope</label>
                <textarea
                  className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all resize-none"
                  rows={2}
                  value={form.scope}
                  onChange={set("scope")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-label-sm font-label-sm text-on-surface-variant block">Out of Scope</label>
                <textarea
                  className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all resize-none"
                  rows={2}
                  value={form.out_of_scope}
                  onChange={set("out_of_scope")}
                />
              </div>
              <div className="grid grid-cols-2 gap-md">
                <div className="space-y-1">
                  <label className="text-label-sm font-label-sm text-on-surface-variant block">Entry Criteria</label>
                  <textarea
                    className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all resize-none"
                    rows={3}
                    value={form.entry_criteria}
                    onChange={set("entry_criteria")}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-label-sm font-label-sm text-on-surface-variant block">Exit Criteria</label>
                  <textarea
                    className="w-full bg-surface border border-outline-variant rounded-lg px-md py-sm text-body-base focus:border-secondary focus:ring-1 focus:ring-secondary outline-none transition-all resize-none"
                    rows={3}
                    value={form.exit_criteria}
                    onChange={set("exit_criteria")}
                  />
                </div>
              </div>
            </div>

            <div className="p-lg bg-surface border-t border-outline-variant flex justify-end gap-md sticky bottom-0 -mx-lg -mb-lg">
              <button
                type="button"
                onClick={onClose}
                className="px-lg py-sm rounded-lg border border-outline-variant text-on-surface font-label-md hover:bg-surface-container-low transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-lg py-sm rounded-lg bg-secondary text-on-secondary font-label-md hover:brightness-110 shadow-md transition-all disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create Project"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
