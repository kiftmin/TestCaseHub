import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { TestPlanForm, type TestPlanFormData } from "../components/test-plan-form";
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

      {/* Create Test Plan wizard */}
      <TestPlanForm
        mode="create"
        open={slideOver}
        onClose={() => setSlideOver(false)}
        onSave={(data) => createMutation.mutate(data)}
        saving={createMutation.isPending}
      />
    </>
  );
}
