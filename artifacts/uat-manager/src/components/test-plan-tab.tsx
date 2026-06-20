import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/empty-state";
import { customFetch, API_ORIGIN } from "../lib/api-client";
import { useProjectRole } from "../hooks/useProjectRole";
import { useConfirmDialog } from "../hooks/use-confirm-dialog";
import {
  ScenarioDialog,
  TestCaseDialog,
  StepDialog,
  type ScenarioFormData,
  type TestCaseFormData,
  type StepFormData,
} from "./test-plan-dialogs";
import { TestPlanDocumentPDF } from "../lib/pdf-documents";
import type { Project, UseCase, TestCase, TestStep } from "../types/api";

/* ────────────────────────────────────────────────────────────────────
   Public types
   ──────────────────────────────────────────────────────────────────── */

export type ScenariosWithChildren = UseCase & {
  testCases?: (TestCase & { steps?: TestStep[] })[];
};

/* ────────────────────────────────────────────────────────────────────
   Priority + type styling
   ──────────────────────────────────────────────────────────────────── */

const PRIORITY_BADGE: Record<string, "error" | "warning" | "default"> = {
  Critical: "error",
  High: "warning",
  Medium: "warning",
  Low: "default",
};

const PRIORITY_STYLE: Record<string, string> = {
  Critical: "border-l-error",
  High: "border-l-orange-500",
  Medium: "border-l-amber-500",
  Low: "border-l-outline-variant",
};

/* ────────────────────────────────────────────────────────────────────
   TestPlanTab
   ──────────────────────────────────────────────────────────────────── */

export function TestPlanTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const role = useProjectRole(projectId);
  const canEdit = role === "TEST_LEAD" || role === "ADMIN" || role === "TEST_AUTHOR";

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => customFetch<Project>(`/projects/${projectId}`),
  });

  const invalidateProject = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }, [queryClient, projectId]);

  /* ── Dialog state ── */
  const [scenarioDialog, setScenarioDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    scenario: UseCase | null;
  }>({ open: false, mode: "create", scenario: null });

  const [testCaseDialog, setTestCaseDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    useCaseId: number | null;
    testCase: TestCase | null;
    suggestedCaseNumber: string;
  }>({ open: false, mode: "create", useCaseId: null, testCase: null, suggestedCaseNumber: "" });

  const [stepDialog, setStepDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    testCaseId: number | null;
    step: TestStep | null;
    stepNumber: number;
  }>({ open: false, mode: "create", testCaseId: null, step: null, stepNumber: 1 });

  const confirm = useConfirmDialog();

  /* ── Scenario mutations ── */
  const createScenario = useMutation({
    mutationFn: (d: ScenarioFormData) =>
      customFetch<UseCase>(`/use-cases?projectId=${projectId}`, {
        method: "POST",
        body: JSON.stringify({
          code: d.code.trim(),
          name: d.name.trim(),
          priority: d.priority || null,
          category: d.category.trim() || null,
        }),
      }),
    onSuccess: () => {
      invalidateProject();
      setScenarioDialog((s) => ({ ...s, open: false }));
      toast.success("Scenario added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateScenario = useMutation({
    mutationFn: (d: { id: number } & ScenarioFormData) =>
      customFetch<UseCase>(`/use-cases/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({
          code: d.code.trim(),
          name: d.name.trim(),
          priority: d.priority,
          category: d.category.trim(),
        }),
      }),
    onSuccess: () => {
      invalidateProject();
      setScenarioDialog((s) => ({ ...s, open: false }));
      toast.success("Scenario saved");
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

  /* ── Test Case mutations ── */
  const createTestCase = useMutation({
    mutationFn: (d: { useCaseId: number } & TestCaseFormData) =>
      customFetch<TestCase>("/test-cases", {
        method: "POST",
        body: JSON.stringify({
          use_case_id: d.useCaseId,
          case_number: d.case_number.trim(),
          title: d.title.trim(),
          test_type: d.test_type.trim() || null,
          ...(d.estimated_minutes != null ? { estimated_minutes: d.estimated_minutes } : {}),
          ...(d.acceptance_criteria.trim() ? { acceptance_criteria: d.acceptance_criteria.trim() } : {}),
        }),
      }),
    onSuccess: () => {
      invalidateProject();
      setTestCaseDialog((s) => ({ ...s, open: false }));
      toast.success("Test case added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateTestCase = useMutation({
    mutationFn: (d: { id: number } & TestCaseFormData) =>
      customFetch<TestCase>(`/test-cases/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({
          case_number: d.case_number.trim(),
          title: d.title.trim(),
          test_type: d.test_type.trim() || null,
          ...(d.estimated_minutes != null ? { estimated_minutes: d.estimated_minutes } : { estimated_minutes: null }),
          ...(d.acceptance_criteria.trim() ? { acceptance_criteria: d.acceptance_criteria.trim() } : { acceptance_criteria: null }),
        }),
      }),
    onSuccess: () => {
      invalidateProject();
      setTestCaseDialog((s) => ({ ...s, open: false }));
      toast.success("Test case saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTestCase = useMutation({
    mutationFn: (id: number) => customFetch<void>(`/test-cases/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Test case deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── Step mutations ── */
  const createStep = useMutation({
    mutationFn: (d: { testCaseId: number; stepNumber: number } & StepFormData) =>
      customFetch<TestStep>("/test-steps", {
        method: "POST",
        body: JSON.stringify({
          test_case_id: d.testCaseId,
          step_number: String(d.stepNumber),
          instruction: d.instruction.trim(),
          test_data: d.test_data.trim(),
          expected_result: d.expected_result.trim(),
        }),
      }),
    onSuccess: () => {
      invalidateProject();
      setStepDialog((s) => ({ ...s, open: false }));
      toast.success("Step added");
    },
    onError: (e: Error & { status?: number }) => {
      if (e.status === 409) toast.error("Step number already exists in this test case.");
      else toast.error(e.message);
    },
  });

  const updateStep = useMutation({
    mutationFn: (d: { id: number } & StepFormData) =>
      customFetch<TestStep>(`/test-steps/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({
          instruction: d.instruction.trim(),
          test_data: d.test_data.trim(),
          expected_result: d.expected_result.trim(),
        }),
      }),
    onSuccess: () => {
      invalidateProject();
      setStepDialog((s) => ({ ...s, open: false }));
      toast.success("Step saved");
    },
    onError: (e: Error & { status?: number }) => {
      if (e.status === 409) toast.error("Step number already exists in this test case.");
      else toast.error(e.message);
    },
  });

  const deleteStep = useMutation({
    mutationFn: (id: number) => customFetch<void>(`/test-steps/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateProject();
      toast.success("Step deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── Reorder mutations ── */
  const reorderScenarios = useMutation({
    mutationFn: async (items: { id: number; sort_order: number }[]) => {
      await Promise.all(items.map((uc) =>
        customFetch<UseCase>(`/use-cases/${uc.id}`, {
          method: "PUT",
          body: JSON.stringify({ sort_order: uc.sort_order }),
        })
      ));
    },
    onSuccess: invalidateProject,
  });

  const reorderSteps = useMutation({
    mutationFn: async (items: { id: number; step_number: string }[]) => {
      await Promise.all(items.map((s) =>
        customFetch<TestStep>(`/test-steps/${s.id}`, {
          method: "PUT",
          body: JSON.stringify({ step_number: s.step_number }),
        })
      ));
    },
    onSuccess: invalidateProject,
    onError: (e: Error & { status?: number }) => {
      if (e.status === 409) toast.error("Step number already exists in this test case.");
      else toast.error(e.message);
    },
  });

  /* ── Drag state (scenarios) ── */
  const [dragScenarioIdx, setDragScenarioIdx] = useState<number | null>(null);
  const [dragOverScenarioIdx, setDragOverScenarioIdx] = useState<number | null>(null);

  const onScenarioDragStart = (e: React.DragEvent, idx: number) => {
    if (!canEdit) return;
    setDragScenarioIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };
  const onScenarioDragOver = (e: React.DragEvent, idx: number) => {
    if (!canEdit || dragScenarioIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverScenarioIdx(idx);
  };
  const onScenarioDrop = (
    e: React.DragEvent,
    dropIdx: number,
    scenarios: ScenariosWithChildren[]
  ) => {
    e.preventDefault();
    if (dragScenarioIdx === null || dragScenarioIdx === dropIdx) {
      setDragScenarioIdx(null);
      setDragOverScenarioIdx(null);
      return;
    }
    const reordered = [...scenarios];
    const [moved] = reordered.splice(dragScenarioIdx, 1);
    reordered.splice(dropIdx, 0, moved);
    reorderScenarios.mutate(reordered.map((uc, i) => ({ id: uc.id, sort_order: i })));
    setDragScenarioIdx(null);
    setDragOverScenarioIdx(null);
  };
  const onScenarioDragEnd = () => {
    setDragScenarioIdx(null);
    setDragOverScenarioIdx(null);
  };

  /* ── Loading / empty ── */
  if (isLoading) {
    return (
      <section className="space-y-sm">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md animate-pulse"
          >
            <div className="w-3/4 h-5 skeleton rounded" />
            <div className="w-1/2 h-4 skeleton rounded mt-2" />
          </div>
        ))}
      </section>
    );
  }

  const useCases = (project as Project & { useCases?: ScenariosWithChildren[] })?.useCases ?? [];

  const totalCases = useCases.reduce((sum, uc) => sum + (uc.testCases?.length ?? 0), 0);
  const totalSteps = useCases.reduce(
    (sum, uc) => sum + (uc.testCases?.reduce((s, tc) => s + (tc.steps?.length ?? 0), 0) ?? 0),
    0
  );

  return (
    <section className="space-y-md">
      <PlanHeader
        scenarioCount={useCases.length}
        caseCount={totalCases}
        stepCount={totalSteps}
        canEdit={canEdit}
        onAddScenario={() =>
          setScenarioDialog({ open: true, mode: "create", scenario: null })
        }
      >
        <PDFDownloadLink
          document={
            <TestPlanDocumentPDF
              projectName={project?.name ?? ""}
              projectObj={project ?? undefined}
              useCases={useCases}
            />
          }
          fileName={`test-plan-${project?.project_code ?? "export"}.pdf`}
          className="flex items-center gap-sm px-md py-sm border border-outline text-on-surface rounded-lg font-label-md hover:bg-surface-container-high transition-colors"
        >
          {({ loading }) => (
            <>
              <span className="material-symbols-outlined text-sm">file_download</span>
              {loading ? "Preparing..." : "Export Full Plan"}
            </>
          )}
        </PDFDownloadLink>
      </PlanHeader>

      {useCases.length === 0 ? (
        <EmptyState
          icon="checklist"
          title="No scenarios yet"
          description={
            canEdit
              ? "Start by adding the first scenario for this test plan. Each scenario groups related test cases."
              : "Scenarios will appear here once a test lead or author adds them."
          }
          action={
            canEdit ? (
              <Button
                variant="primary"
                onClick={() =>
                  setScenarioDialog({ open: true, mode: "create", scenario: null })
                }
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add your first scenario
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-md">
          {useCases.map((uc, idx) => (
            <ScenarioCard
              key={uc.id}
              scenario={uc}
              canEdit={canEdit}
              isDragOver={dragOverScenarioIdx === idx}
              isDragging={dragScenarioIdx === idx}
              onDragStart={(e) => onScenarioDragStart(e, idx)}
              onDragOver={(e) => onScenarioDragOver(e, idx)}
              onDrop={(e) => onScenarioDrop(e, idx, useCases)}
              onDragEnd={onScenarioDragEnd}
              onEdit={() =>
                setScenarioDialog({ open: true, mode: "edit", scenario: uc })
              }
              onDelete={() =>
                confirm.ask({
                  title: "Delete scenario",
                  message: `Delete "${uc.name}" and all its test cases and steps? This cannot be undone.`,
                  confirmLabel: "Delete",
                  destructive: true,
                  onConfirm: () => deleteScenario.mutate(uc.id),
                })
              }
              onAddCase={() => {
                const existing = uc.testCases ?? [];
                const nextNum = existing.length + 1;
                const suggested = `TC-${String(nextNum).padStart(2, "0")}`;
                setTestCaseDialog({
                  open: true,
                  mode: "create",
                  useCaseId: uc.id,
                  testCase: null,
                  suggestedCaseNumber: suggested,
                });
              }}
              onEditCase={(tc) =>
                setTestCaseDialog({
                  open: true,
                  mode: "edit",
                  useCaseId: uc.id,
                  testCase: tc,
                  suggestedCaseNumber: tc.case_number,
                })
              }
              onDeleteCase={(tc) =>
                confirm.ask({
                  title: "Delete test case",
                  message: `Delete "${tc.title}" and all its steps? This cannot be undone.`,
                  confirmLabel: "Delete",
                  destructive: true,
                  onConfirm: () => deleteTestCase.mutate(tc.id),
                })
              }
              onAddStep={(tc) => {
                const nextStepNum = (tc.steps?.length ?? 0) + 1;
                setStepDialog({
                  open: true,
                  mode: "create",
                  testCaseId: tc.id,
                  step: null,
                  stepNumber: nextStepNum,
                });
              }}
              onEditStep={(s, n) =>
                setStepDialog({
                  open: true,
                  mode: "edit",
                  testCaseId: s.test_case_id,
                  step: s,
                  stepNumber: n,
                })
              }
              onDeleteStep={(s) =>
                confirm.ask({
                  title: "Delete step",
                  message: "Delete this step? This cannot be undone.",
                  confirmLabel: "Delete",
                  destructive: true,
                  onConfirm: () => deleteStep.mutate(s.id),
                })
              }
              onReorderSteps={(items) => reorderSteps.mutate(items)}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <ScenarioDialog
        open={scenarioDialog.open}
        mode={scenarioDialog.mode}
        initial={scenarioDialog.scenario}
        saving={createScenario.isPending || updateScenario.isPending}
        onClose={() => setScenarioDialog((s) => ({ ...s, open: false }))}
        onSave={(data) => {
          if (scenarioDialog.mode === "create") {
            createScenario.mutate(data);
          } else if (scenarioDialog.scenario) {
            updateScenario.mutate({ id: scenarioDialog.scenario.id, ...data });
          }
        }}
      />

      <TestCaseDialog
        open={testCaseDialog.open}
        mode={testCaseDialog.mode}
        initial={testCaseDialog.testCase}
        suggestedCaseNumber={testCaseDialog.suggestedCaseNumber}
        saving={createTestCase.isPending || updateTestCase.isPending}
        onClose={() => setTestCaseDialog((s) => ({ ...s, open: false }))}
        onSave={(data) => {
          if (testCaseDialog.mode === "create" && testCaseDialog.useCaseId) {
            createTestCase.mutate({ useCaseId: testCaseDialog.useCaseId, ...data });
          } else if (testCaseDialog.testCase) {
            updateTestCase.mutate({ id: testCaseDialog.testCase.id, ...data });
          }
        }}
      />

      <StepDialog
        open={stepDialog.open}
        mode={stepDialog.mode}
        initial={stepDialog.step}
        stepNumber={stepDialog.stepNumber}
        saving={createStep.isPending || updateStep.isPending}
        onClose={() => setStepDialog((s) => ({ ...s, open: false }))}
        onSave={(data) => {
          if (stepDialog.mode === "create" && stepDialog.testCaseId) {
            createStep.mutate({
              testCaseId: stepDialog.testCaseId,
              stepNumber: stepDialog.stepNumber,
              ...data,
            });
          } else if (stepDialog.step) {
            updateStep.mutate({ id: stepDialog.step.id, ...data });
          }
        }}
      />

      {confirm.dialog}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Plan header
   ──────────────────────────────────────────────────────────────────── */

function PlanHeader({
  scenarioCount,
  caseCount,
  stepCount,
  canEdit,
  onAddScenario,
  children,
}: {
  scenarioCount: number;
  caseCount: number;
  stepCount: number;
  canEdit: boolean;
  onAddScenario: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-md bg-surface-container-lowest border border-outline-variant rounded-xl p-md">
      <div className="space-y-1">
        <h2 className="font-title-sm text-title-sm text-on-surface">Test Plan</h2>
        <div className="flex items-center gap-md flex-wrap text-label-sm text-on-surface-variant">
          <span>
            <strong className="text-on-surface font-label-md">{scenarioCount}</strong> scenarios
          </span>
          <span className="text-outline-variant">·</span>
          <span>
            <strong className="text-on-surface font-label-md">{caseCount}</strong> test cases
          </span>
          <span className="text-outline-variant">·</span>
          <span>
            <strong className="text-on-surface font-label-md">{stepCount}</strong> steps
          </span>
        </div>
      </div>
      <div className="flex items-center gap-sm">
        {children}
        {canEdit && (
          <Button variant="primary" onClick={onAddScenario}>
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add Scenario
          </Button>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Scenario Card
   ──────────────────────────────────────────────────────────────────── */

function ScenarioCard({
  scenario,
  canEdit,
  isDragOver,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onEdit,
  onDelete,
  onAddCase,
  onEditCase,
  onDeleteCase,
  onAddStep,
  onEditStep,
  onDeleteStep,
  onReorderSteps,
}: {
  scenario: ScenariosWithChildren;
  canEdit: boolean;
  isDragOver: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddCase: () => void;
  onEditCase: (tc: TestCase) => void;
  onDeleteCase: (tc: TestCase) => void;
  onAddStep: (tc: TestCase & { steps?: TestStep[] }) => void;
  onEditStep: (s: TestStep, n: number) => void;
  onDeleteStep: (s: TestStep) => void;
  onReorderSteps: (items: { id: number; step_number: string }[]) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const testCases = scenario.testCases ?? [];
  const totalSteps = testCases.reduce((sum, tc) => sum + (tc.steps?.length ?? 0), 0);

  return (
    <article
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`bg-surface-container-lowest border border-outline-variant rounded-xl border-l-4 ${
        PRIORITY_STYLE[scenario.priority ?? ""] ?? "border-l-outline-variant"
      } transition-all ${
        isDragOver ? "ring-2 ring-secondary" : ""
      } ${isDragging ? "opacity-50" : ""}`}
    >
      <header className="flex items-center gap-md p-md">
        {canEdit && (
          <span
            className="material-symbols-outlined text-on-surface-variant/50 cursor-grab active:cursor-grabbing shrink-0"
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >
            drag_indicator
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse scenario" : "Expand scenario"}
          className="p-1 -m-1 rounded hover:bg-surface-container transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-on-surface-variant">
            {expanded ? "expand_more" : "chevron_right"}
          </span>
        </button>
        <div className="flex items-center gap-sm flex-1 min-w-0 flex-wrap">
          {scenario.priority && (
            <Badge variant={PRIORITY_BADGE[scenario.priority] ?? "default"}>
              {scenario.priority}
            </Badge>
          )}
          <code className="font-mono text-label-sm text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
            {scenario.code}
          </code>
          <h3 className="font-title-sm text-title-sm text-on-surface truncate">
            {scenario.name}
          </h3>
          {scenario.category && (
            <Badge variant="blue">{scenario.category}</Badge>
          )}
          <span className="text-label-sm text-on-surface-variant">
            {testCases.length} {testCases.length === 1 ? "case" : "cases"}
            {totalSteps > 0 ? ` · ${totalSteps} steps` : ""}
          </span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-xs shrink-0">
            <IconButton icon="add_box" label="Add test case" onClick={onAddCase} />
            <IconButton icon="edit" label="Edit scenario" onClick={onEdit} />
            <IconButton icon="delete" label="Delete scenario" onClick={onDelete} destructive />
          </div>
        )}
      </header>

      {expanded && (
        <div className="border-t border-outline-variant">
          {testCases.length === 0 ? (
            <div className="p-md">
              <button
                type="button"
                onClick={onAddCase}
                disabled={!canEdit}
                className="w-full py-md border-2 border-dashed border-outline-variant rounded-lg flex items-center justify-center gap-sm text-label-md font-label-md text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="material-symbols-outlined">add</span>
                Add the first test case to this scenario
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-outline-variant">
              {testCases.map((tc, idx) => (
                <li key={tc.id}>
                  <TestCaseItem
                    testCase={tc}
                    canEdit={canEdit}
                    onEdit={() => onEditCase(tc)}
                    onDelete={() => onDeleteCase(tc)}
                    onAddStep={() => onAddStep(tc)}
                    onEditStep={(s, n) => onEditStep(s, n)}
                    onDeleteStep={(s) => onDeleteStep(s)}
                    onReorderSteps={(items) => onReorderSteps(items)}
                    isLast={idx === testCases.length - 1}
                  />
                </li>
              ))}
            </ul>
          )}
          {testCases.length > 0 && canEdit && (
            <div className="p-md pt-sm">
              <button
                type="button"
                onClick={onAddCase}
                className="inline-flex items-center gap-sm text-label-md font-label-md text-secondary hover:underline"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add test case
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Test Case Item
   ──────────────────────────────────────────────────────────────────── */

function TestCaseItem({
  testCase,
  canEdit,
  onEdit,
  onDelete,
  onAddStep,
  onEditStep,
  onDeleteStep,
  onReorderSteps,
  isLast,
}: {
  testCase: TestCase & { steps?: TestStep[] };
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddStep: () => void;
  onEditStep: (s: TestStep, n: number) => void;
  onDeleteStep: (s: TestStep) => void;
  onReorderSteps: (items: { id: number; step_number: string }[]) => void;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [dragStepIdx, setDragStepIdx] = useState<number | null>(null);
  const [dragOverStepIdx, setDragOverStepIdx] = useState<number | null>(null);

  const steps = testCase.steps ?? [];
  const totalMinutes = testCase.estimated_minutes;

  const onStepDragStart = (e: React.DragEvent, idx: number) => {
    if (!canEdit) return;
    setDragStepIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };
  const onStepDragOver = (e: React.DragEvent, idx: number) => {
    if (!canEdit || dragStepIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStepIdx(idx);
  };
  const onStepDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragStepIdx === null || dragStepIdx === dropIdx) {
      setDragStepIdx(null);
      setDragOverStepIdx(null);
      return;
    }
    const reordered = [...steps];
    const [moved] = reordered.splice(dragStepIdx, 1);
    reordered.splice(dropIdx, 0, moved);
    onReorderSteps(reordered.map((s, i) => ({ id: s.id, step_number: String(i + 1) })));
    setDragStepIdx(null);
    setDragOverStepIdx(null);
  };
  const onStepDragEnd = () => {
    setDragStepIdx(null);
    setDragOverStepIdx(null);
  };

  return (
    <div className={isLast ? "" : ""}>
      <div className="flex items-center gap-md px-md py-sm hover:bg-surface-container-low transition-colors">
        {canEdit && (
          <span
            className="material-symbols-outlined text-on-surface-variant/40 cursor-grab active:cursor-grabbing shrink-0"
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >
            drag_indicator
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse test case" : "Expand test case"}
          className="p-1 -m-1 rounded hover:bg-surface-container transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-on-surface-variant">
            {expanded ? "expand_more" : "chevron_right"}
          </span>
        </button>
        <div className="flex items-center gap-sm flex-1 min-w-0 flex-wrap">
          <code className="font-mono text-label-sm text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
            {testCase.case_number}
          </code>
          {testCase.test_type && (
            <Badge variant="secondary">{testCase.test_type}</Badge>
          )}
          <h4 className="font-label-md text-label-md text-on-surface truncate">
            {testCase.title}
          </h4>
          <span className="text-label-sm text-on-surface-variant">
            {steps.length} {steps.length === 1 ? "step" : "steps"}
            {totalMinutes ? ` · ~${totalMinutes} min` : ""}
          </span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-xs shrink-0">
            <IconButton icon="playlist_add" label="Add step" onClick={onAddStep} />
            <IconButton icon="edit" label="Edit test case" onClick={onEdit} />
            <IconButton icon="delete" label="Delete test case" onClick={onDelete} destructive />
          </div>
        )}
      </div>

      {testCase.acceptance_criteria && (
        <div className="px-md pb-sm pl-xl">
          <p className="text-label-sm text-on-surface-variant">
            <span className="font-label-md text-on-surface">Acceptance:</span>{" "}
            {testCase.acceptance_criteria}
          </p>
        </div>
      )}

      {expanded && (
        <div className="pl-xl pr-md pb-sm">
          {steps.length === 0 ? (
            <button
              type="button"
              onClick={onAddStep}
              disabled={!canEdit}
              className="w-full py-sm border border-dashed border-outline-variant rounded-md flex items-center justify-center gap-sm text-label-sm text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add the first step
            </button>
          ) : (
            <ol className="space-y-xs">
              {steps.map((s, idx) => (
                <li
                  key={s.id}
                  draggable={canEdit}
                  onDragStart={(e) => onStepDragStart(e, idx)}
                  onDragOver={(e) => onStepDragOver(e, idx)}
                  onDrop={(e) => onStepDrop(e, idx)}
                  onDragEnd={onStepDragEnd}
                  className={`transition-all ${
                    dragOverStepIdx === idx ? "ring-2 ring-secondary rounded-lg" : ""
                  } ${dragStepIdx === idx ? "opacity-50" : ""}`}
                >
                  <StepItem
                    step={s}
                    number={idx + 1}
                    canEdit={canEdit}
                    onEdit={() => onEditStep(s, idx + 1)}
                    onDelete={() => onDeleteStep(s)}
                  />
                </li>
              ))}
            </ol>
          )}
          {steps.length > 0 && canEdit && (
            <button
              type="button"
              onClick={onAddStep}
              className="mt-sm inline-flex items-center gap-sm text-label-sm text-secondary hover:underline"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add step
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Step Item
   ──────────────────────────────────────────────────────────────────── */

function StepItem({
  step,
  number,
  canEdit,
  onEdit,
  onDelete,
}: {
  step: TestStep;
  number: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [images, setImages] = useState<string[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current || !step.id) return;
    loadedRef.current = true;
    customFetch<{ id: number; file_url: string }[]>(`/attachments/test_step/${step.id}`)
      .then((data) => setImages(data.map((a) => a.file_url)))
      .catch(() => {});
  }, [step.id]);

  return (
    <div className="group bg-surface-container-lowest border border-outline-variant rounded-lg p-sm">
      <div className="flex items-start gap-md">
        {canEdit && (
          <span
            className="material-symbols-outlined text-on-surface-variant/40 cursor-grab active:cursor-grabbing text-[18px] mt-1"
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >
            drag_indicator
          </span>
        )}
        <div
          className="w-7 h-7 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-label-md text-label-sm shrink-0 mt-0.5"
          aria-label={`Step ${number}`}
        >
          {number}
        </div>
        <div className="flex-1 min-w-0 space-y-xs">
          <p className="font-body-sm text-body-sm text-on-surface">
            {step.instruction}
          </p>
          {(step.test_data || step.expected_result) && (
            <div className="flex gap-sm flex-wrap">
              {step.test_data && (
                <Chip color="amber" label="Data" value={step.test_data} />
              )}
              {step.expected_result && (
                <Chip color="blue" label="Expected" value={step.expected_result} />
              )}
            </div>
          )}
          {images.length > 0 && (
            <div className="flex gap-xs flex-wrap pt-xs">
              {images.map((url, i) => (
                <img
                  key={i}
                  src={`${API_ORIGIN}${url}`}
                  alt="Step reference"
                  className="w-12 h-12 object-cover rounded border border-outline-variant cursor-pointer hover:opacity-80"
                  onClick={() => window.open(`${API_ORIGIN}${url}`, "_blank")}
                />
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-xs opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
            <IconButton icon="edit" label="Edit step" onClick={onEdit} />
            <IconButton icon="delete" label="Delete step" onClick={onDelete} destructive />
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Small presentational helpers
   ──────────────────────────────────────────────────────────────────── */

function IconButton({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`p-1.5 rounded-md hover:bg-surface-container transition-colors ${
        destructive
          ? "text-on-surface-variant hover:text-error"
          : "text-on-surface-variant hover:text-secondary"
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
  );
}

function Chip({
  color,
  label,
  value,
}: {
  color: "amber" | "blue" | "green" | "purple";
  label: string;
  value: string;
}) {
  const colors: Record<typeof color, string> = {
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    green: "bg-green-50 border-green-200 text-green-900",
    purple: "bg-purple-50 border-purple-200 text-purple-900",
  };
  return (
    <span
      className={`inline-flex items-center gap-xs border rounded px-sm py-0.5 text-label-sm max-w-full ${colors[color]}`}
    >
      <span className="font-label-md uppercase tracking-wider text-[10px] opacity-70">
        {label}
      </span>
      <span className="truncate">{value}</span>
    </span>
  );
}
