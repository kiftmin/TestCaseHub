import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch, API_ORIGIN } from "../lib/api-client";
import { useProjectRole } from "../hooks/useProjectRole";
import type {
  Project,
  UseCase,
  TestCase,
  TestStep,
  ProjectAssignment,
  User,
} from "../types/api";

const ucStatusColors: Record<string, string> = {
  Critical: "text-error",
  High: "text-orange-600",
  Medium: "text-amber-600",
  Low: "text-on-surface-variant",
};

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
      {tab === "plan" && <TestPlanTab projectId={projectId} />}
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
  const [collapsed, setCollapsed] = useState(false);

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
                /* Edit project - could open slide-over in future */
              }}
              className="flex items-center gap-sm text-secondary font-label-md text-label-md border border-secondary px-md py-1 rounded-lg hover:bg-secondary/5 transition-all"
            >
              <span className="material-symbols-outlined text-sm">edit</span>
              Edit Project
            </button>
          )}
          <span className="material-symbols-outlined text-on-surface-variant transition-transform">
            {collapsed ? "expand_more" : "expand_less"}
          </span>
        </div>
      </div>
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

/* ───────────── TEST PLAN TAB ───────────── */

function TestPlanTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => customFetch<Project>(`/projects/${projectId}`),
  });

  const invalidateProject = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }, [queryClient, projectId]);

  const role = useProjectRole(projectId);
  const canEdit = role === "TEST_LEAD" || role === "ADMIN" || role === "TEST_AUTHOR";

  /* ── Scenario CRUD ── */
  const createScenario = useMutation({
    mutationFn: (d: { code: string; name: string; priority: string; category: string }) =>
      customFetch<UseCase>(`/use-cases?projectId=${projectId}`, {
        method: "POST",
        body: JSON.stringify({ code: d.code, name: d.name, priority: d.priority || null, category: d.category || null }),
      }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Scenario created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateScenario = useMutation({
    mutationFn: (d: { id: number; code: string; name: string; priority: string; category: string }) =>
      customFetch<UseCase>(`/use-cases/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({ code: d.code, name: d.name, priority: d.priority, category: d.category }),
      }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteScenario = useMutation({
    mutationFn: (id: number) => customFetch<void>(`/use-cases/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Scenario deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── Test Case CRUD ── */
  const createTestCase = useMutation({
    mutationFn: (d: {
      use_case_id: number;
      case_number: string;
      title: string;
      test_type: string;
      estimated_minutes: number | null;
      acceptance_criteria: string;
    }) =>
      customFetch<TestCase>("/test-cases", {
        method: "POST",
        body: JSON.stringify({
          use_case_id: d.use_case_id,
          case_number: d.case_number,
          title: d.title,
          test_type: d.test_type,
          ...(d.estimated_minutes != null ? { estimated_minutes: d.estimated_minutes } : {}),
          ...(d.acceptance_criteria ? { acceptance_criteria: d.acceptance_criteria } : {}),
        }),
      }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Test case created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateTestCase = useMutation({
    mutationFn: (d: {
      id: number;
      case_number: string;
      title: string;
      test_type: string;
      estimated_minutes: number | null;
      acceptance_criteria: string;
    }) =>
      customFetch<TestCase>(`/test-cases/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({
          case_number: d.case_number,
          title: d.title,
          ...(d.test_type ? { test_type: d.test_type } : { test_type: null }),
          ...(d.estimated_minutes != null ? { estimated_minutes: d.estimated_minutes } : { estimated_minutes: null }),
          ...(d.acceptance_criteria ? { acceptance_criteria: d.acceptance_criteria } : { acceptance_criteria: null }),
        }),
      }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTestCase = useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/test-cases/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Test case deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── Step CRUD ── */
  const createStep = useMutation({
    mutationFn: (d: {
      test_case_id: number;
      step_number: string;
      instruction: string;
      test_data: string;
      expected_result: string;
    }) =>
      customFetch<TestStep>("/test-steps", {
        method: "POST",
        body: JSON.stringify(d),
      }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Step created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStep = useMutation({
    mutationFn: (d: {
      id: number;
      instruction: string;
      test_data: string;
      expected_result: string;
    }) =>
      customFetch<TestStep>(`/test-steps/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({
          instruction: d.instruction,
          test_data: d.test_data,
          expected_result: d.expected_result,
        }),
      }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteStep = useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/test-steps/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Step deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── Reorder helpers ── */
  const reorderSteps = useCallback(async (items: { id: number; step_number: string }[]) => {
    await Promise.all(items.map(s =>
      customFetch<TestStep>(`/test-steps/${s.id}`, {
        method: "PUT",
        body: JSON.stringify({ step_number: s.step_number }),
      })
    ));
    invalidateProject();
  }, [invalidateProject]);

  const reorderCases = useCallback(async (items: { id: number; sort_order: number }[]) => {
    await Promise.all(items.map(tc =>
      customFetch<TestCase>(`/test-cases/${tc.id}`, {
        method: "PUT",
        body: JSON.stringify({ sort_order: tc.sort_order }),
      })
    ));
    invalidateProject();
  }, [invalidateProject]);

  const reorderScenarios = useCallback(async (items: { id: number; sort_order: number }[]) => {
    await Promise.all(items.map(uc =>
      customFetch<UseCase>(`/use-cases/${uc.id}`, {
        method: "PUT",
        body: JSON.stringify({ sort_order: uc.sort_order }),
      })
    ));
    invalidateProject();
  }, [invalidateProject]);

  const [dragScenarioIndex, setDragScenarioIndex] = useState<number | null>(null);
  const [dragOverScenarioIndex, setDragOverScenarioIndex] = useState<number | null>(null);

  if (isLoading) {
    return (
      <section className="space-y-sm">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-surface border border-outline-variant rounded-lg p-md animate-pulse"
          >
            <div className="w-3/4 h-5 skeleton rounded" />
            <div className="w-1/2 h-4 skeleton rounded mt-2" />
          </div>
        ))}
      </section>
    );
  }

  const useCases = (project as Project & { useCases?: UseCase[] })?.useCases ?? [];

  const handleScenarioDragStart = (e: React.DragEvent, idx: number) => {
    if (!canEdit) return;
    setDragScenarioIndex(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const handleScenarioDragOver = (e: React.DragEvent, idx: number) => {
    if (!canEdit || dragScenarioIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverScenarioIndex(idx);
  };

  const handleScenarioDragLeave = () => {
    setDragOverScenarioIndex(null);
  };

  const handleScenarioDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragScenarioIndex === null || dragScenarioIndex === dropIdx) {
      setDragScenarioIndex(null);
      setDragOverScenarioIndex(null);
      return;
    }
    const reordered = [...useCases];
    const [moved] = reordered.splice(dragScenarioIndex, 1);
    reordered.splice(dropIdx, 0, moved);
    const updated = reordered.map((uc, i) => ({ id: uc.id, sort_order: i }));
    reorderScenarios(updated);
    setDragScenarioIndex(null);
    setDragOverScenarioIndex(null);
  };

  const handleScenarioDragEnd = () => {
    setDragScenarioIndex(null);
    setDragOverScenarioIndex(null);
  };

  return (
    <section className="space-y-sm">
      {/* Tree */}
      {useCases.map((uc, idx) => (
        <div
          key={uc.id}
          draggable={canEdit}
          onDragStart={(e) => handleScenarioDragStart(e, idx)}
          onDragOver={(e) => handleScenarioDragOver(e, idx)}
          onDragLeave={handleScenarioDragLeave}
          onDrop={(e) => handleScenarioDrop(e, idx)}
          onDragEnd={handleScenarioDragEnd}
          className={`transition-colors ${
            dragOverScenarioIndex === idx ? "bg-secondary/10 border-t-2 border-secondary rounded-lg" : ""
          } ${dragScenarioIndex === idx ? "opacity-50" : ""}`}
        >
          <ScenarioRow
            uc={uc}
            canEdit={canEdit}
            onUpdate={(d) => updateScenario.mutate({ id: uc.id, ...d })}
            onDelete={() => deleteScenario.mutate(uc.id)}
            onAddCase={(d) => createTestCase.mutate(d)}
            onUpdateCase={(d) => updateTestCase.mutate(d)}
            onDeleteCase={(id) => deleteTestCase.mutate(id)}
            onAddStep={(d) => createStep.mutate(d)}
            onUpdateStep={(d) => updateStep.mutate(d)}
            onDeleteStep={(id) => deleteStep.mutate(id)}
            onReorderCases={(items) => reorderCases(items)}
            onReorderSteps={(items) => reorderSteps(items)}
          />
        </div>
      ))}

      {/* Add Scenario */}
      {canEdit && (
        <AddScenarioForm
          onSave={(d) => createScenario.mutate(d)}
          saving={createScenario.isPending}
        />
      )}
    </section>
  );
}

/* ───────────── Scenario row ───────────── */

function ScenarioRow({
  uc,
  canEdit,
  onUpdate,
  onDelete,
  onAddCase,
  onUpdateCase,
  onDeleteCase,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
  onReorderCases,
  onReorderSteps,
}: {
  uc: UseCase & { testCases?: (TestCase & { steps?: TestStep[] })[] };
  canEdit: boolean;
  onUpdate: (d: { code: string; name: string; priority: string; category: string }) => void;
  onDelete: () => void;
  onAddCase: (d: {
    use_case_id: number;
    case_number: string;
    title: string;
    test_type: string;
    estimated_minutes: number | null;
    acceptance_criteria: string;
  }) => void;
  onUpdateCase: (d: {
    id: number;
    case_number: string;
    title: string;
    test_type: string;
    estimated_minutes: number | null;
    acceptance_criteria: string;
  }) => void;
  onDeleteCase: (id: number) => void;
  onAddStep: (d: {
    test_case_id: number;
    step_number: string;
    instruction: string;
    test_data: string;
    expected_result: string;
  }) => void;
  onUpdateStep: (d: {
    id: number;
    instruction: string;
    test_data: string;
    expected_result: string;
  }) => void;
  onDeleteStep: (id: number) => void;
  onReorderCases: (items: { id: number; sort_order: number }[]) => void;
  onReorderSteps: (items: { id: number; step_number: string }[]) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editCode, setEditCode] = useState(uc.code);
  const [editName, setEditName] = useState(uc.name);
  const [editPriority, setEditPriority] = useState(uc.priority ?? "");
  const [addCase, setAddCase] = useState(false);

  const [dragCaseIndex, setDragCaseIndex] = useState<number | null>(null);
  const [dragOverCaseIndex, setDragOverCaseIndex] = useState<number | null>(null);

  const testCases = uc.testCases ?? [];

  const handleCaseDragStart = (e: React.DragEvent, idx: number) => {
    if (!canEdit) return;
    setDragCaseIndex(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const handleCaseDragOver = (e: React.DragEvent, idx: number) => {
    if (!canEdit || dragCaseIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCaseIndex(idx);
  };

  const handleCaseDragLeave = () => {
    setDragOverCaseIndex(null);
  };

  const handleCaseDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragCaseIndex === null || dragCaseIndex === dropIdx) {
      setDragCaseIndex(null);
      setDragOverCaseIndex(null);
      return;
    }
    const reordered = [...testCases];
    const [moved] = reordered.splice(dragCaseIndex, 1);
    reordered.splice(dropIdx, 0, moved);
    const updated = reordered.map((tc, i) => ({ id: tc.id, sort_order: i }));
    onReorderCases(updated);
    setDragCaseIndex(null);
    setDragOverCaseIndex(null);
  };

  const handleCaseDragEnd = () => {
    setDragCaseIndex(null);
    setDragOverCaseIndex(null);
  };

  return (
    <div className="bg-surface border border-outline-variant rounded-lg">
      {/* Scenario header */}
      <div className="p-md flex items-center justify-between group hover:bg-surface-container-low transition-colors">
        <div className="flex items-center gap-sm flex-1 min-w-0">
          <span
            className="material-symbols-outlined text-on-surface-variant cursor-pointer select-none"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "arrow_drop_down" : "arrow_right"}
          </span>
          {editing ? (
            <div className="flex items-center gap-2 flex-1">
              <select
                className="text-[11px] font-bold border border-outline-variant rounded px-1 py-0.5"
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value)}
              >
                <option value="">No Priority</option>
                <option value="Critical">CRITICAL</option>
                <option value="High">HIGH</option>
                <option value="Medium">MEDIUM</option>
                <option value="Low">LOW</option>
              </select>
              <input
                className="font-label-md border border-secondary rounded px-1 py-0.5 flex-1 min-w-0"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                placeholder="Code"
              />
              <input
                className="font-title-sm text-title-sm border border-secondary rounded px-1 py-0.5 flex-1 min-w-0"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Scenario name"
              />
              <button
                onClick={() => {
                  onUpdate({ code: editCode, name: editName, priority: editPriority, category: uc.category ?? "" });
                  setEditing(false);
                }}
                className="material-symbols-outlined text-secondary"
              >
                check_circle
              </button>
              <button
                onClick={() => setEditing(false)}
                className="material-symbols-outlined text-on-surface-variant"
              >
                close
              </button>
            </div>
          ) : (
            <>
              {uc.priority && (
                <span
                  className={`font-label-md text-label-md font-bold ${
                    ucStatusColors[uc.priority] ?? "text-on-surface-variant"
                  }`}
                >
                  [{uc.priority.toUpperCase()}]
                </span>
              )}
              <h3 className="font-title-sm text-title-sm text-on-surface">
                [{uc.code}] {uc.name}
              </h3>
            </>
          )}
        </div>
        {!editing && canEdit && (
          <div className="flex items-center gap-md opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setAddCase(!addCase)}
              className="material-symbols-outlined text-on-surface-variant hover:text-secondary"
              title="Add test case"
            >
              add_box
            </button>
            <button
              onClick={() => {
                setEditCode(uc.code);
                setEditName(uc.name);
                setEditPriority(uc.priority ?? "");
                setEditing(true);
              }}
              className="material-symbols-outlined text-on-surface-variant hover:text-secondary"
            >
              edit
            </button>
            <button
              onClick={onDelete}
              className="material-symbols-outlined text-on-surface-variant hover:text-error"
            >
              delete
            </button>
          </div>
        )}
      </div>

      {/* Expanded children */}
      {expanded && (
        <div className="ml-xl border-l border-outline-variant">
          {testCases.map((tc, idx) => (
            <div
              key={tc.id}
              draggable={canEdit}
              onDragStart={(e) => handleCaseDragStart(e, idx)}
              onDragOver={(e) => handleCaseDragOver(e, idx)}
              onDragLeave={handleCaseDragLeave}
              onDrop={(e) => handleCaseDrop(e, idx)}
              onDragEnd={handleCaseDragEnd}
              className={`transition-colors ${
                dragOverCaseIndex === idx ? "bg-secondary/10 border-t-2 border-secondary" : ""
              } ${dragCaseIndex === idx ? "opacity-50" : ""}`}
            >
              <TestCaseRow
                tc={tc}
                canEdit={canEdit}
                onUpdate={(d) => onUpdateCase({ id: tc.id, ...d })}
                onDelete={() => onDeleteCase(tc.id)}
                onAddStep={(d) => onAddStep(d)}
                onUpdateStep={onUpdateStep}
                onDeleteStep={onDeleteStep}
                onReorderSteps={(items) => onReorderSteps && onReorderSteps(items)}
              />
            </div>
          ))}

          {/* Add Case form */}
          {addCase && (
            <AddCaseForm
              useCaseId={uc.id}
              onSave={(d) => {
                onAddCase(d);
                setAddCase(false);
              }}
              onCancel={() => setAddCase(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────── Test Case row ───────────── */

function TestCaseRow({
  tc,
  canEdit,
  onUpdate,
  onDelete,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
  onReorderSteps,
}: {
  tc: TestCase & { steps?: TestStep[] };
  canEdit: boolean;
  onUpdate: (d: {
    case_number: string;
    title: string;
    test_type: string;
    estimated_minutes: number | null;
    acceptance_criteria: string;
  }) => void;
  onDelete: () => void;
  onAddStep: (d: {
    test_case_id: number;
    step_number: string;
    instruction: string;
    test_data: string;
    expected_result: string;
  }) => void;
  onUpdateStep: (d: {
    id: number;
    instruction: string;
    test_data: string;
    expected_result: string;
  }) => void;
  onDeleteStep: (id: number) => void;
  onReorderSteps: (items: { id: number; step_number: string }[]) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(tc.title);
  const [editCaseNumber, setEditCaseNumber] = useState(tc.case_number);
  const [editType, setEditType] = useState(tc.test_type ?? "");
  const [addStep, setAddStep] = useState(false);

  const [dragStepIndex, setDragStepIndex] = useState<number | null>(null);
  const [dragOverStepIndex, setDragOverStepIndex] = useState<number | null>(null);

  const steps = tc.steps ?? [];

  const handleStepDragStart = (e: React.DragEvent, idx: number) => {
    if (!canEdit) return;
    setDragStepIndex(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const handleStepDragOver = (e: React.DragEvent, idx: number) => {
    if (!canEdit || dragStepIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStepIndex(idx);
  };

  const handleStepDragLeave = () => {
    setDragOverStepIndex(null);
  };

  const handleStepDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragStepIndex === null || dragStepIndex === dropIdx) {
      setDragStepIndex(null);
      setDragOverStepIndex(null);
      return;
    }
    const reordered = [...steps];
    const [moved] = reordered.splice(dragStepIndex, 1);
    reordered.splice(dropIdx, 0, moved);
    const updated = reordered.map((s, i) => ({ id: s.id, step_number: String(i + 1) }));
    onReorderSteps(updated);
    setDragStepIndex(null);
    setDragOverStepIndex(null);
  };

  const handleStepDragEnd = () => {
    setDragStepIndex(null);
    setDragOverStepIndex(null);
  };

  return (
    <div>
      {/* Test case header */}
      <div className="p-md py-sm flex items-center justify-between group hover:bg-surface-container-low transition-colors">
        <div className="flex items-center gap-sm flex-1 min-w-0">
          <span
            className="material-symbols-outlined text-on-surface-variant cursor-pointer select-none"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "arrow_drop_down" : "arrow_right"}
          </span>
          {editing ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                className="font-label-md border border-secondary rounded px-1 py-0.5 w-24"
                value={editCaseNumber}
                onChange={(e) => setEditCaseNumber(e.target.value)}
                placeholder="Case #"
              />
              <input
                className="font-label-md border border-secondary rounded px-1 py-0.5 flex-1 min-w-0"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title"
              />
              <input
                className="text-[11px] font-bold border border-outline-variant rounded px-1 py-0.5 w-28"
                value={editType}
                onChange={(e) => setEditType(e.target.value)}
                placeholder="Type"
              />
              <button
                onClick={() => {
                  onUpdate({
                    case_number: editCaseNumber,
                    title: editTitle,
                    test_type: editType,
                    estimated_minutes: tc.estimated_minutes,
                    acceptance_criteria: tc.acceptance_criteria ?? "",
                  });
                  setEditing(false);
                }}
                className="material-symbols-outlined text-secondary"
              >
                check_circle
              </button>
              <button
                onClick={() => setEditing(false)}
                className="material-symbols-outlined text-on-surface-variant"
              >
                close
              </button>
            </div>
          ) : (
            <>
              {tc.test_type && (
                <span className="font-label-md text-label-md text-secondary font-bold">
                  [{tc.test_type.toUpperCase()}]
                </span>
              )}
              <h4 className="font-label-md text-label-md text-on-surface">
                [{tc.case_number}] {tc.title}
              </h4>
            </>
          )}
        </div>
        {!editing && canEdit && (
          <div className="flex items-center gap-md opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setAddStep(!addStep)}
              className="material-symbols-outlined text-on-surface-variant hover:text-secondary"
              title="Add step"
            >
              playlist_add
            </button>
            <button
              onClick={() => {
                setEditTitle(tc.title);
                setEditCaseNumber(tc.case_number);
                setEditType(tc.test_type ?? "");
                setEditing(true);
              }}
              className="material-symbols-outlined text-on-surface-variant hover:text-secondary"
            >
              edit
            </button>
            <button
              onClick={onDelete}
              className="material-symbols-outlined text-on-surface-variant hover:text-error"
            >
              delete
            </button>
          </div>
        )}
      </div>

      {/* Steps */}
      {expanded && (
        <div className="ml-xl space-y-[1px]">
          {steps.map((s, idx) => (
            <div
              key={s.id}
              draggable={canEdit}
              onDragStart={(e) => handleStepDragStart(e, idx)}
              onDragOver={(e) => handleStepDragOver(e, idx)}
              onDragLeave={handleStepDragLeave}
              onDrop={(e) => handleStepDrop(e, idx)}
              onDragEnd={handleStepDragEnd}
              className={`transition-colors ${
                dragOverStepIndex === idx ? "bg-secondary/10 border-t-2 border-secondary" : ""
              } ${dragStepIndex === idx ? "opacity-50" : ""}`}
            >
              <StepRow
                step={s}
                index={idx + 1}
                canEdit={canEdit}
                onUpdate={(d) => onUpdateStep({ id: s.id, ...d })}
                onDelete={() => onDeleteStep(s.id)}
              />
            </div>
          ))}
          {addStep && (
            <AddStepForm
              testCaseId={tc.id}
              nextNumber={steps.length + 1}
              onSave={(d) => {
                onAddStep(d);
                setAddStep(false);
              }}
              onCancel={() => setAddStep(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────── Step row ───────────── */

function StepRow({
  step,
  index,
  canEdit,
  onUpdate,
  onDelete,
}: {
  step: TestStep;
  index: number;
  canEdit: boolean;
  onUpdate: (d: { instruction: string; test_data: string; expected_result: string }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState(step.instruction);
  const [testData, setTestData] = useState(step.test_data ?? "");
  const [expectedResult, setExpectedResult] = useState(step.expected_result ?? "");
  const [saved, setSaved] = useState(false);
  const [stepImages, setStepImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!step.id) return;
    customFetch<{ id: number; file_url: string }[]>(`/attachments/test_step/${step.id}`)
      .then((data) => setStepImages(data.map((a) => a.file_url)))
      .catch(() => {});
  }, [step.id]);

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await customFetch<{ fileUrl: string }>("/upload", {
        method: "POST",
        body: formData,
      });
      await customFetch("/attachments", {
        method: "POST",
        body: JSON.stringify({
          entity_type: "test_step",
          entity_id: step.id,
          file_url: uploadRes.fileUrl,
          file_name: file.name,
          file_type: file.type,
        }),
      });
      setStepImages((prev) => [...prev, uploadRes.fileUrl]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    onUpdate({ instruction, test_data: testData, expected_result: expectedResult });
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const bg = editing ? "bg-surface-container" : "bg-surface";

  return (
    <div
      className={`p-md py-sm ${bg} flex items-start justify-between group relative`}
    >
      <div className="flex items-start gap-md flex-1 min-w-0">
        <span className="font-label-md text-label-md text-on-surface-variant pt-0.5">
          {index}.
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          {editing ? (
            <div className="relative max-w-lg mb-sm">
              <input
                className="w-full bg-surface border border-secondary rounded px-sm py-1 font-body-sm text-body-sm focus:ring-1 focus:ring-secondary focus:outline-none"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              {saved && (
                <div className="absolute -top-8 right-0 bg-inverse-surface text-inverse-on-surface text-[10px] px-sm py-1 rounded flex items-center gap-xs shadow-md">
                  Saved <span className="material-symbols-outlined text-[12px]">check</span>
                </div>
              )}
            </div>
          ) : (
            <p className="font-body-sm text-body-sm text-on-surface">{step.instruction}</p>
          )}
          {editing ? (
            <div className="flex gap-sm">
              <input
                className="flex-1 border-b border-outline-variant px-1 py-0.5 bg-transparent font-body-sm text-body-sm outline-none focus:border-secondary"
                placeholder="Test data (optional)"
                value={testData}
                onChange={(e) => setTestData(e.target.value)}
              />
              <input
                className="flex-1 border-b border-outline-variant px-1 py-0.5 bg-transparent font-body-sm text-body-sm outline-none focus:border-secondary"
                placeholder="Expected result (optional)"
                value={expectedResult}
                onChange={(e) => setExpectedResult(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-sm">
              <div className="flex gap-sm flex-wrap">
                {step.test_data && (
                  <span className="inline-block bg-amber-50 border border-amber-200 rounded px-sm py-0.5 text-[11px] text-amber-900">
                    Data: {step.test_data}
                  </span>
                )}
                {step.expected_result && (
                  <span className="inline-block bg-blue-50 border border-blue-200 rounded px-sm py-0.5 text-[11px] text-blue-900">
                    Expected: {step.expected_result}
                  </span>
                )}
              </div>
              {stepImages.length > 0 && (
                <div className="flex gap-sm flex-wrap">
                  {stepImages.map((url, i) => (
                    <img
                      key={i}
                      src={`${API_ORIGIN}${url}`}
                      alt="Step reference"
                      className="w-16 h-16 object-cover rounded border border-outline-variant cursor-pointer hover:opacity-80"
                      onClick={() => window.open(`${API_ORIGIN}${url}`, "_blank")}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-md shrink-0">
          {editing ? (
            <>
              <button onClick={save} className="material-symbols-outlined text-secondary">
                check_circle
              </button>
              <button onClick={() => setEditing(false)} className="material-symbols-outlined text-on-surface-variant">
                close
              </button>
            </>
          ) : (
            <div className="flex items-center gap-md opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="material-symbols-outlined text-on-surface-variant hover:text-secondary"
              >
                {uploading ? "hourglass_top" : "image"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => {
                  setInstruction(step.instruction);
                  setTestData(step.test_data ?? "");
                  setExpectedResult(step.expected_result ?? "");
                  setEditing(true);
                }}
                className="material-symbols-outlined text-on-surface-variant hover:text-secondary"
              >
                edit
              </button>
              <button onClick={onDelete} className="material-symbols-outlined text-on-surface-variant hover:text-error">
                delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────── Add Scenario form ───────────── */

function AddScenarioForm({
  onSave,
  saving,
}: {
  onSave: (d: { code: string; name: string; priority: string; category: string }) => void;
  saving: boolean;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("");

  return (
    <div className="w-full py-md border-2 border-dashed border-outline-variant rounded-lg flex items-center justify-center gap-sm hover:bg-surface-container hover:border-secondary/50 transition-all">
      <span className="material-symbols-outlined text-on-surface-variant">add_circle</span>
      <input
        className="bg-transparent border-b border-outline-variant font-label-md px-1 py-0.5 w-24 outline-none focus:border-secondary"
        placeholder="Code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <input
        className="bg-transparent border-b border-outline-variant font-label-md px-1 py-0.5 w-48 outline-none focus:border-secondary"
        placeholder="Scenario name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        className="text-[11px] border border-outline-variant rounded px-1 py-0.5"
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
      >
        <option value="">Priority</option>
        <option value="Critical">CRITICAL</option>
        <option value="High">HIGH</option>
        <option value="Medium">MEDIUM</option>
        <option value="Low">LOW</option>
      </select>
      <button
        disabled={!code || !name || saving}
        onClick={() => {
          onSave({ code, name, priority, category: "" });
          setCode("");
          setName("");
          setPriority("");
        }}
        className="font-label-sm text-secondary hover:underline disabled:opacity-30"
      >
        {saving ? "Adding..." : "Add Scenario"}
      </button>
    </div>
  );
}

/* ───────────── Add Case inline form ───────────── */

function AddCaseForm({
  useCaseId,
  onSave,
  onCancel,
}: {
  useCaseId: number;
  onSave: (d: {
    use_case_id: number;
    case_number: string;
    title: string;
    test_type: string;
    estimated_minutes: number | null;
    acceptance_criteria: string;
  }) => void;
  onCancel: () => void;
}) {
  const [caseNumber, setCaseNumber] = useState("");
  const [title, setTitle] = useState("");
  const [testType, setTestType] = useState("");

  return (
    <div className="p-md py-sm flex items-center gap-2 bg-surface-container-low">
      <span className="material-symbols-outlined text-on-surface-variant text-sm">add</span>
      <input
        className="border-b border-outline-variant font-label-sm px-1 py-0.5 w-20 bg-transparent outline-none focus:border-secondary"
        placeholder="Case #"
        value={caseNumber}
        onChange={(e) => setCaseNumber(e.target.value)}
      />
      <input
        className="border-b border-outline-variant font-label-sm px-1 py-0.5 flex-1 bg-transparent outline-none focus:border-secondary"
        placeholder="Test case title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="border-b border-outline-variant font-label-sm px-1 py-0.5 w-20 bg-transparent outline-none focus:border-secondary"
        placeholder="Type"
        value={testType}
        onChange={(e) => setTestType(e.target.value)}
      />
      <button
        disabled={!caseNumber || !title}
        onClick={() => {
          onSave({
            use_case_id: useCaseId,
            case_number: caseNumber,
            title,
            test_type: testType,
            estimated_minutes: null,
            acceptance_criteria: "",
          });
        }}
        className="font-label-sm text-secondary hover:underline disabled:opacity-30"
      >
        Save
      </button>
      <button onClick={onCancel} className="font-label-sm text-on-surface-variant hover:underline">
        Cancel
      </button>
    </div>
  );
}

/* ───────────── Add Step inline form ───────────── */

function AddStepForm({
  testCaseId,
  nextNumber,
  onSave,
  onCancel,
}: {
  testCaseId: number;
  nextNumber: number;
  onSave: (d: {
    test_case_id: number;
    step_number: string;
    instruction: string;
    test_data: string;
    expected_result: string;
  }) => void;
  onCancel: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [testData, setTestData] = useState("");
  const [expectedResult, setExpectedResult] = useState("");

  const save = () => {
    if (!instruction) return;
    onSave({
      test_case_id: testCaseId,
      step_number: String(nextNumber),
      instruction,
      test_data: testData,
      expected_result: expectedResult,
    });
  };

  return (
    <div className="p-md bg-surface-container-low border-b border-outline-variant">
      <div className="flex items-center gap-2 mb-sm">
        <span className="font-label-md text-label-md text-on-surface-variant">{nextNumber}.</span>
        <input
          className="flex-1 border-b border-outline-variant px-1 py-0.5 bg-transparent font-body-sm outline-none focus:border-secondary"
          placeholder="Step instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
        <button
          disabled={!instruction}
          onClick={save}
          className="font-label-sm text-secondary hover:underline disabled:opacity-30"
        >
          Save
        </button>
        <button onClick={onCancel} className="font-label-sm text-on-surface-variant hover:underline">
          Cancel
        </button>
      </div>
      <div className="flex gap-sm ml-lg">
        <input
          className="flex-1 border-b border-outline-variant px-1 py-0.5 bg-transparent font-body-sm text-body-sm outline-none focus:border-secondary"
          placeholder="Test data (optional)"
          value={testData}
          onChange={(e) => setTestData(e.target.value)}
        />
        <input
          className="flex-1 border-b border-outline-variant px-1 py-0.5 bg-transparent font-body-sm text-body-sm outline-none focus:border-secondary"
          placeholder="Expected result (optional)"
          value={expectedResult}
          onChange={(e) => setExpectedResult(e.target.value)}
        />
      </div>
    </div>
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
    mutationFn: (d: { userId: number; role: string }) =>
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
                <p
                  className={`text-[10px] font-bold uppercase tracking-tighter ${
                    roleColors[a.role] ?? "text-on-surface-variant"
                  }`}
                >
                  {a.role}
                </p>
              </div>
            </div>
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
            onSave={(d) => addMutation.mutate({ userId: d.userId, role: d.role })}
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
  onSave,
  onClose,
  saving,
}: {
  onSave: (d: { userId: number; role: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => customFetch<User[]>("/users"),
  });
  const [userId, setUserId] = useState<number | null>(null);
  const [role, setRole] = useState("TESTER");

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
              ?.filter((u) => u.is_active)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.username})
                </option>
              ))}
          </select>
        </div>
        <div className="space-y-sm">
          <label className="block font-label-md text-on-surface">Project Role</label>
          <select
            className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
            value={role}
            onChange={(e) => setRole(e.target.value)}
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
        <div className="flex gap-md justify-end">
          <button
            onClick={onClose}
            className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!userId || saving}
          onClick={() => userId && onSave({ userId, role })}
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
          <button
            onClick={() => setNewDialog(true)}
            className="bg-secondary text-on-secondary font-label-sm text-label-sm px-md py-1 rounded-lg hover:brightness-110 transition-all"
          >
            New Test Run
          </button>
        )}
      </div>

      {runs?.map((r) => (
        <div
          key={r.id}
          onClick={() => navigate(`/test-runs/${r.id}`)}
          className="border border-outline-variant rounded-lg p-md hover:border-secondary transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-xs">
            <h4 className="font-label-md text-label-md">{r.name}</h4>
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
