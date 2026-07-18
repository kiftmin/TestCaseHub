import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { pdf } from "@react-pdf/renderer";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { DropdownMenu, DropdownMenuItem } from "./ui/dropdown-menu";
import { customFetch, uploadUrl } from "../lib/api-client";
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
import { ImportWizard } from "./import-wizard";
import { PreconditionLibrary } from "./precondition-library";
import {
  SharedStepLibrary,
  InsertSharedStepsButton,
  SaveAsSharedBlockButton,
} from "./shared-step-library";
import { TestPlanDocumentPDF } from "../lib/pdf-documents";
import type { Project, UseCase, TestCase, TestStep } from "../types/api";

type PlanView = "structure" | "libraries";

/* ────────────────────────────────────────────────────────────────────
   Public types
   ──────────────────────────────────────────────────────────────────── */

export type ScenariosWithChildren = UseCase & {
  testCases?: (TestCase & { steps?: TestStep[] })[];
};

/** Structure-only import template (CSV, Excel-compatible). */
function downloadImportTemplate() {
  const lines = [
    "Project Name,Sample UAT Project",
    "Module Name,Sample Module",
    "Test Designed By,Test Lead",
    "Test Designed Date,2026-01-15",
    "Pre-condition,User is logged into the network",
    "Objectives,Verify core happy-path flows",
    "In Scope,Login; Account view",
    "Out of Scope,Payments",
    "Entry Criteria,Test environment available",
    "Exit Criteria,All critical cases executed; no open P1 defects",
    "",
    "Use Case UC-01: Sample scenario",
    "Test Case #,Title,Steps,Test Data,Expected Result,Precondition,Actual Result,Status (Pass/Fail),Notes",
    "1,Happy path login,Open the application,,Login page loads,,,(ignored),(ignored),(ignored)",
    ",,Enter valid credentials,user@example.com / Test123!,Credentials accepted,,,,",
    ",,Click Sign in,,Dashboard is displayed,,,,",
    "",
    "Use Case UC-02: Second scenario",
    "Test Case #,Title,Steps,Test Data,Expected Result,Precondition,Actual Result,Status (Pass/Fail),Notes",
    "1,View account,Navigate to Accounts,,Accounts list visible,,,,",
  ];
  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "TestCaseHub-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Template downloaded — structure columns only; Actual/Status/Notes are ignored on import");
}

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

  /* ── PDF export ── */
  const exportPdfCore = useCallback(async (detailed: boolean) => {
    const ucs = (project as Project & { useCases?: ScenariosWithChildren[] })?.useCases ?? [];
    const toastId = toast.loading("Generating PDF…");
    try {
      const blob = await pdf(
        <TestPlanDocumentPDF
          projectName={project?.name ?? ""}
          projectObj={project ?? undefined}
          useCases={ucs}
          detailed={detailed}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const suffix = detailed ? "-detailed" : "";
      const a = document.createElement("a");
      a.href = url;
      a.download = `test-plan-${project?.project_code ?? "export"}${suffix}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.dismiss(toastId);
    } catch (e) {
      toast.error("Failed to generate PDF");
      toast.dismiss(toastId);
    }
  }, [project]);
  const handleExportPdf = useCallback(() => exportPdfCore(false), [exportPdfCore]);
  const handleExportPdfDetailed = useCallback(() => exportPdfCore(true), [exportPdfCore]);

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

  const [importOpen, setImportOpen] = useState(false);
  const [planView, setPlanView] = useState<PlanView>("structure");
  const ranQueryParam = useRef(false);

  const confirm = useConfirmDialog();

  // Handle ?import=1 and ?openScenario=1 query params on mount
  useEffect(() => {
    if (ranQueryParam.current) return;
    ranQueryParam.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("import") === "1") {
      setImportOpen(true);
    } else if (params.get("openScenario") === "1") {
      setScenarioDialog({ open: true, mode: "create", scenario: null });
    }
  }, []);

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
          ...(d.test_type.trim() ? { test_type: d.test_type.trim() } : {}),
          ...(d.estimated_minutes != null ? { estimated_minutes: d.estimated_minutes } : {}),
          ...(d.acceptance_criteria.trim() ? { acceptance_criteria: d.acceptance_criteria.trim() } : {}),
          ...(d.precondition.trim() ? { precondition: d.precondition.trim() } : {}),
          precondition_ids: d.precondition_ids ?? [],
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
          ...(d.precondition.trim() ? { precondition: d.precondition.trim() } : { precondition: null }),
          precondition_ids: d.precondition_ids ?? [],
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

  const duplicateScenario = useMutation({
    mutationFn: async (source: ScenariosWithChildren) => {
      const allCodes = new Set(
        ((project as Project & { useCases?: ScenariosWithChildren[] })?.useCases ?? []).map(
          (u) => u.code
        )
      );
      let code = `${source.code}-copy`;
      let n = 2;
      while (allCodes.has(code)) {
        code = `${source.code}-copy${n}`;
        n++;
      }
      const newUc = await customFetch<UseCase>(`/use-cases?projectId=${projectId}`, {
        method: "POST",
        body: JSON.stringify({
          code,
          name: source.name.endsWith(" (copy)") ? source.name : `${source.name} (copy)`,
          priority: source.priority || null,
          category: source.category || null,
        }),
      });
      for (const tc of source.testCases ?? []) {
        const newTc = await customFetch<TestCase>("/test-cases", {
          method: "POST",
          body: JSON.stringify({
            use_case_id: newUc.id,
            case_number: tc.case_number,
            title: tc.title,
            ...(tc.test_type ? { test_type: tc.test_type } : {}),
            ...(tc.estimated_minutes != null ? { estimated_minutes: tc.estimated_minutes } : {}),
            ...(tc.acceptance_criteria ? { acceptance_criteria: tc.acceptance_criteria } : {}),
            ...(tc.precondition ? { precondition: tc.precondition } : {}),
            precondition_ids: (tc.linkedPreconditions ?? []).map((p) => p.id),
          }),
        });
        const steps = (tc.steps ?? []).filter((s) => s.instruction?.trim());
        if (steps.length > 0) {
          await customFetch("/test-steps/bulk", {
            method: "POST",
            body: JSON.stringify({
              test_case_id: newTc.id,
              steps: steps.map((s, i) => ({
                step_number: String(i + 1),
                instruction: s.instruction,
                ...(s.test_data ? { test_data: s.test_data } : {}),
                ...(s.expected_result ? { expected_result: s.expected_result } : {}),
              })),
            }),
          });
        }
      }
      return newUc;
    },
    onSuccess: () => {
      invalidateProject();
      toast.success("Scenario duplicated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateTestCase = useMutation({
    mutationFn: async (source: TestCase & { steps?: TestStep[] }) => {
      const siblings =
        ((project as Project & { useCases?: ScenariosWithChildren[] })?.useCases ?? [])
          .find((u) => u.id === source.use_case_id)
          ?.testCases ?? [];
      const numbers = new Set(siblings.map((t) => t.case_number));
      let caseNumber = `${source.case_number}-copy`;
      let n = 2;
      while (numbers.has(caseNumber)) {
        caseNumber = `${source.case_number}-copy${n}`;
        n++;
      }
      const newTc = await customFetch<TestCase>("/test-cases", {
        method: "POST",
        body: JSON.stringify({
          use_case_id: source.use_case_id,
          case_number: caseNumber,
          title: source.title.endsWith(" (copy)") ? source.title : `${source.title} (copy)`,
          // Zod uses .optional() (not .nullable()) — omit nulls, never send null
          ...(source.test_type ? { test_type: source.test_type } : {}),
          ...(source.estimated_minutes != null
            ? { estimated_minutes: source.estimated_minutes }
            : {}),
          ...(source.acceptance_criteria
            ? { acceptance_criteria: source.acceptance_criteria }
            : {}),
          ...(source.precondition ? { precondition: source.precondition } : {}),
          precondition_ids: (source.linkedPreconditions ?? []).map((p) => p.id),
        }),
      });
      const steps = (source.steps ?? []).filter((s) => s.instruction?.trim());
      if (steps.length > 0) {
        await customFetch("/test-steps/bulk", {
          method: "POST",
          body: JSON.stringify({
            test_case_id: newTc.id,
            steps: steps.map((s, i) => ({
              step_number: String(i + 1),
              instruction: s.instruction,
              ...(s.test_data ? { test_data: s.test_data } : {}),
              ...(s.expected_result ? { expected_result: s.expected_result } : {}),
            })),
          }),
        });
      }
      return newTc;
    },
    onSuccess: () => {
      invalidateProject();
      toast.success("Test case duplicated");
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
          ...(d.test_data.trim() ? { test_data: d.test_data.trim() } : {}),
          ...(d.expected_result.trim() ? { expected_result: d.expected_result.trim() } : {}),
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

  const createStepsBulk = useMutation({
    mutationFn: (d: {
      testCaseId: number;
      startNumber: number;
      steps: { instruction: string; test_data?: string; expected_result?: string }[];
    }) =>
      customFetch<TestStep[]>("/test-steps/bulk", {
        method: "POST",
        body: JSON.stringify({
          test_case_id: d.testCaseId,
          steps: d.steps.map((s, i) => ({
            step_number: String(d.startNumber + i),
            instruction: s.instruction,
            ...(s.test_data ? { test_data: s.test_data } : {}),
            ...(s.expected_result ? { expected_result: s.expected_result } : {}),
          })),
        }),
      }),
    onSuccess: (_data, vars) => {
      invalidateProject();
      setStepDialog((s) => ({ ...s, open: false }));
      toast.success(
        vars.steps.length === 1
          ? "Step added"
          : `${vars.steps.length} steps added`
      );
    },
    onError: (e: Error & { status?: number }) => {
      if (e.status === 409) toast.error("Step number already exists in this test case.");
      else toast.error(e.message);
      invalidateProject(); // revert optimistic local ordering
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
      await customFetch<{ success: boolean }>("/test-steps/reorder", {
        method: "PUT",
        body: JSON.stringify({ steps: items }),
      });
    },
    onSuccess: invalidateProject,
    onError: (e: Error & { status?: number }) => {
      if (e.status === 409) toast.error("Step number already exists in this test case.");
      else toast.error(e.message);
      invalidateProject();
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
        onImport={() => setImportOpen(true)}
        onDownloadTemplate={downloadImportTemplate}
        onExportPdf={handleExportPdf}
        onExportPdfDetailed={handleExportPdfDetailed}
      />

      <Tabs value={planView} onValueChange={(v) => setPlanView(v as PlanView)} className="space-y-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-md">
          <TabsList>
            <TabsTrigger value="structure">
              <span className="material-symbols-outlined text-[18px]">account_tree</span>
              Plan structure
            </TabsTrigger>
            <TabsTrigger value="libraries">
              <span className="material-symbols-outlined text-[18px]">library_books</span>
              Reusable content
            </TabsTrigger>
          </TabsList>
          {planView === "structure" && canEdit && useCases.length > 0 && (
            <p className="text-label-sm text-on-surface-variant hidden sm:block">
              Tip: drag scenarios or steps to reorder · double-click a name to edit
            </p>
          )}
        </div>

        <TabsContent value="structure" className="space-y-md">
          {useCases.length === 0 ? (
            <EmptyState
              icon="checklist"
              title="No scenarios yet"
              description={
                canEdit
                  ? "A scenario is a business area or process (for example “Login” or “Create order”). Add one, then attach test cases and steps."
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
                  onDuplicate={() => duplicateScenario.mutate(uc)}
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
                  onDuplicateCase={(tc) => duplicateTestCase.mutate(tc)}
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
                  onRefresh={invalidateProject}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="libraries" className="space-y-lg">
          <div className="rounded-xl border border-outline-variant bg-surface-container-low/40 px-md py-sm">
            <p className="text-body-sm text-on-surface-variant">
              Build once, reuse often. Preconditions and shared step blocks keep wording consistent across cases without retyping.
            </p>
          </div>
          <PreconditionLibrary projectId={projectId} canEdit={canEdit} />
          <SharedStepLibrary projectId={projectId} canEdit={canEdit} />
        </TabsContent>
      </Tabs>

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
        projectId={projectId}
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
        onSaveBulk={(steps) => {
          if (stepDialog.mode === "create" && stepDialog.testCaseId) {
            createStepsBulk.mutate({
              testCaseId: stepDialog.testCaseId,
              startNumber: stepDialog.stepNumber,
              steps,
            });
          }
        }}
        savingBulk={createStepsBulk.isPending}
      />

      {/* Import from Excel */}
      <ImportWizard
        mode="existing-project"
        open={importOpen}
        projectId={projectId}
        onClose={() => setImportOpen(false)}
        onImportComplete={() => {
          setImportOpen(false);
          invalidateProject();
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
  onImport,
  onDownloadTemplate,
  onExportPdf,
  onExportPdfDetailed,
}: {
  scenarioCount: number;
  caseCount: number;
  stepCount: number;
  canEdit: boolean;
  onAddScenario: () => void;
  onImport: () => void;
  onDownloadTemplate: () => void;
  onExportPdf: () => void;
  onExportPdfDetailed: () => void;
}) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md sm:p-lg">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-md">
        <div className="space-y-sm min-w-0">
          <div>
            <h2 className="font-title-md text-title-md text-on-surface">Test plan</h2>
            <p className="text-body-sm text-on-surface-variant mt-1 max-w-xl">
              Organise scenarios, test cases, and steps for business UAT. Import from Excel or build here.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-md gap-y-xs text-label-sm text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-secondary">folder</span>
              <strong className="text-on-surface font-label-md">{scenarioCount}</strong> scenarios
            </span>
            <span className="text-outline-variant hidden sm:inline">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-secondary">description</span>
              <strong className="text-on-surface font-label-md">{caseCount}</strong> test cases
            </span>
            <span className="text-outline-variant hidden sm:inline">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-secondary">format_list_numbered</span>
              <strong className="text-on-surface font-label-md">{stepCount}</strong> steps
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-sm shrink-0">
          <DropdownMenu
            align="right"
            trigger={
              <button
                type="button"
                className="flex items-center gap-sm px-md py-sm border border-outline text-on-surface rounded-lg font-label-md hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">import_export</span>
                Import / Export
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
                  expand_more
                </span>
              </button>
            }
          >
            {canEdit && (
              <>
                <DropdownMenuItem onClick={onImport}>
                  <span className="inline-flex items-center gap-sm">
                    <span className="material-symbols-outlined text-[18px]">upload_file</span>
                    Import plan from Excel / CSV
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDownloadTemplate}>
                  <span className="inline-flex items-center gap-sm">
                    <span className="material-symbols-outlined text-[18px]">description</span>
                    Download import template
                  </span>
                </DropdownMenuItem>
                <div className="my-1 border-t border-outline-variant" />
              </>
            )}
            <DropdownMenuItem onClick={onExportPdf}>
              <span className="inline-flex items-center gap-sm">
                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                Export plan as PDF
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportPdfDetailed}>
              <span className="inline-flex items-center gap-sm">
                <span className="material-symbols-outlined text-[18px]">difference</span>
                Export plan as PDF (detailed)
              </span>
            </DropdownMenuItem>
          </DropdownMenu>
          {canEdit && (
            <Button variant="primary" onClick={onAddScenario}>
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add scenario
            </Button>
          )}
        </div>
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
  onDuplicate,
  onDelete,
  onAddCase,
  onEditCase,
  onDuplicateCase,
  onDeleteCase,
  onAddStep,
  onEditStep,
  onDeleteStep,
  onReorderSteps,
  onRefresh,
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
  onDuplicate: () => void;
  onDelete: () => void;
  onAddCase: () => void;
  onEditCase: (tc: TestCase) => void;
  onDuplicateCase: (tc: TestCase & { steps?: TestStep[] }) => void;
  onDeleteCase: (tc: TestCase) => void;
  onAddStep: (tc: TestCase & { steps?: TestStep[] }) => void;
  onEditStep: (s: TestStep, n: number) => void;
  onDeleteStep: (s: TestStep) => void;
  onReorderSteps: (items: { id: number; step_number: string }[]) => void;
  onRefresh?: () => void;
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
          <h3
            className={`font-title-sm text-title-sm text-on-surface truncate ${canEdit ? "cursor-pointer hover:underline" : ""}`}
            onDoubleClick={() => { if (canEdit) onEdit(); }}
            title={canEdit ? "Double-click to edit" : undefined}
          >
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
            <Button variant="secondary" size="sm" onClick={onAddCase}>
              <span className="material-symbols-outlined text-[16px]">add</span>
              Test case
            </Button>
            <DropdownMenu
              align="right"
              trigger={
                <button
                  type="button"
                  className="p-1.5 rounded-md text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
                  aria-label="Scenario actions"
                  title="More actions"
                >
                  <span className="material-symbols-outlined text-[20px]">more_vert</span>
                </button>
              }
            >
              <DropdownMenuItem onClick={onEdit}>
                <span className="inline-flex items-center gap-sm">
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                  Edit scenario
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <span className="inline-flex items-center gap-sm">
                  <span className="material-symbols-outlined text-[18px]">content_copy</span>
                  Duplicate scenario
                </span>
              </DropdownMenuItem>
              <div className="my-1 border-t border-outline-variant" />
              <DropdownMenuItem onClick={onDelete} className="text-error hover:text-error">
                <span className="inline-flex items-center gap-sm">
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                  Delete scenario
                </span>
              </DropdownMenuItem>
            </DropdownMenu>
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
                     projectId={scenario.project_id}
                     canEdit={canEdit}
                     onEdit={() => onEditCase(tc)}
                     onDuplicate={() => onDuplicateCase(tc)}
                     onDelete={() => onDeleteCase(tc)}
                     onAddStep={() => onAddStep(tc)}
                     onEditStep={(s, n) => onEditStep(s, n)}
                     onDeleteStep={(s) => onDeleteStep(s)}
                     onReorderSteps={(items) => onReorderSteps(items)}
                     onRefresh={onRefresh}
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
  projectId,
  canEdit,
  onEdit,
  onDuplicate,
  onDelete,
  onAddStep,
  onEditStep,
  onDeleteStep,
  onReorderSteps,
  onRefresh,
  isLast,
}: {
  testCase: TestCase & { steps?: TestStep[] };
  projectId: number;
  canEdit: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddStep: () => void;
  onEditStep: (s: TestStep, n: number) => void;
  onDeleteStep: (s: TestStep) => void;
  onReorderSteps: (items: { id: number; step_number: string }[]) => void;
  onRefresh?: () => void;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [dragStepIdx, setDragStepIdx] = useState<number | null>(null);
  const [dragOverStepIdx, setDragOverStepIdx] = useState<number | null>(null);

  const serverSteps = testCase.steps ?? [];
  const [orderedSteps, setOrderedSteps] = useState(serverSteps);
  useEffect(() => {
    setOrderedSteps(serverSteps);
  }, [serverSteps]);

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
    const reordered = [...orderedSteps];
    const [moved] = reordered.splice(dragStepIdx, 1);
    reordered.splice(dropIdx, 0, moved);
    const next = reordered.map((s, i) => ({ id: s.id, step_number: String(i + 1) }));
    setOrderedSteps(reordered);
    onReorderSteps(next);
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
          {(testCase.resolvedPrecondition || testCase.precondition) && (
            <span
              className="material-symbols-outlined text-[16px] text-secondary shrink-0"
              title={testCase.resolvedPrecondition || testCase.precondition || ""}
            >
              fact_check
            </span>
          )}
          <h4
            className={`font-label-md text-label-md text-on-surface truncate ${canEdit ? "cursor-pointer hover:underline" : ""}`}
            onDoubleClick={() => { if (canEdit) onEdit(); }}
            title={canEdit ? "Double-click to edit" : undefined}
          >
            {testCase.title}
          </h4>
          <span className="text-label-sm text-on-surface-variant">
            {orderedSteps.length} {orderedSteps.length === 1 ? "step" : "steps"}
            {totalMinutes ? ` · ~${totalMinutes} min` : ""}
          </span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-xs shrink-0">
            <button
              type="button"
              onClick={onAddStep}
              className="p-1.5 rounded-md text-on-surface-variant hover:bg-surface-container hover:text-secondary transition-colors"
              aria-label="Add step"
              title="Add step"
            >
              <span className="material-symbols-outlined text-[18px]">playlist_add</span>
            </button>
            <DropdownMenu
              align="right"
              trigger={
                <button
                  type="button"
                  className="p-1.5 rounded-md text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
                  aria-label="Test case actions"
                  title="More actions"
                >
                  <span className="material-symbols-outlined text-[20px]">more_vert</span>
                </button>
              }
            >
              <DropdownMenuItem onClick={onEdit}>
                <span className="inline-flex items-center gap-sm">
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                  Edit test case
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <span className="inline-flex items-center gap-sm">
                  <span className="material-symbols-outlined text-[18px]">content_copy</span>
                  Duplicate test case
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAddStep}>
                <span className="inline-flex items-center gap-sm">
                  <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                  Add step
                </span>
              </DropdownMenuItem>
              <div className="my-1 border-t border-outline-variant" />
              <DropdownMenuItem onClick={onDelete} className="text-error hover:text-error">
                <span className="inline-flex items-center gap-sm">
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                  Delete test case
                </span>
              </DropdownMenuItem>
            </DropdownMenu>
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
          {orderedSteps.length === 0 ? (
            <div className="space-y-sm">
              <button
                type="button"
                onClick={onAddStep}
                disabled={!canEdit}
                className="w-full py-sm border border-dashed border-outline-variant rounded-md flex items-center justify-center gap-sm text-label-sm text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add the first step
              </button>
              {canEdit && (
                <InsertSharedStepsButton
                  projectId={projectId}
                  testCaseId={testCase.id}
                  canEdit={canEdit}
                  onInserted={onRefresh}
                />
              )}
            </div>
          ) : (
            <ol className="space-y-xs">
              {orderedSteps.map((s, idx) => (
                <li
                  key={s.id}
                  draggable={canEdit}
                  onDragStart={(e) => onStepDragStart(e, idx)}
                  onDragOver={(e) => onStepDragOver(e, idx)}
                  onDrop={(e) => onStepDrop(e, idx)}
                  onDragEnd={onStepDragEnd}
                  className={`transition-all ${canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${
                    dragOverStepIdx === idx ? "ring-2 ring-secondary rounded-lg" : ""
                  } ${dragStepIdx === idx ? "opacity-50" : ""}`}
                >
                   <StepItem
                     step={s}
                     number={idx + 1}
                     canEdit={canEdit}
                     onEdit={() => onEditStep(s, idx + 1)}
                     onDelete={() => onDeleteStep(s)}
                     onUpdated={() => { onRefresh?.(); }}
                   />
                </li>
              ))}
            </ol>
          )}
          {orderedSteps.length > 0 && canEdit && (
            <div className="mt-sm flex flex-wrap items-center gap-sm">
              <button
                type="button"
                onClick={onAddStep}
                className="inline-flex items-center gap-sm text-label-sm text-secondary hover:underline"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add step
              </button>
              <span className="text-outline-variant text-label-sm">·</span>
              <InsertSharedStepsButton
                projectId={projectId}
                testCaseId={testCase.id}
                canEdit={canEdit}
                onInserted={onRefresh}
              />
              <span className="text-outline-variant text-label-sm">·</span>
              <SaveAsSharedBlockButton
                projectId={projectId}
                testCaseId={testCase.id}
                canEdit={canEdit}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepItem({
  step,
  number,
  canEdit,
  onEdit,
  onDelete,
  onUpdated,
}: {
  step: TestStep;
  number: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpdated?: () => void;
}) {
  const [images, setImages] = useState<string[]>([]);
  const loadedRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.instruction);

  useEffect(() => {
    if (loadedRef.current || !step.id) return;
    loadedRef.current = true;
    customFetch<{ id: number; file_url: string }[]>(`/attachments/test_step/${step.id}`)
      .then((data) => setImages(data.map((a) => a.file_url)))
      .catch(() => {});
  }, [step.id]);

  useEffect(() => {
    setDraft(step.instruction);
  }, [step.instruction]);

  const saveEdit = async () => {
    const next = draft.trim();
    if (!next || next === step.instruction) {
      setEditing(false);
      setDraft(step.instruction);
      return;
    }
    try {
      await customFetch(`/test-steps/${step.id}`, {
        method: "PUT",
        body: JSON.stringify({ instruction: next }),
      });
      onUpdated?.();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
      setDraft(step.instruction);
    } finally {
      setEditing(false);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(step.instruction);
  };

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
          {editing ? (
            <textarea
              className="w-full text-body-sm bg-surface border border-outline rounded p-1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
              }}
              onBlur={saveEdit}
              autoFocus
            />
          ) : (
            <p
              className="font-body-sm text-body-sm text-on-surface cursor-text"
              onDoubleClick={() => { if (canEdit) { setEditing(true); setDraft(step.instruction); } }}
              title={canEdit ? "Double-click to edit" : undefined}
            >
              {step.instruction}
            </p>
          )}
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
                   src={uploadUrl(url)}
                  alt="Step reference"
                  className="w-12 h-12 object-cover rounded border border-outline-variant cursor-pointer hover:opacity-80"
                   onClick={() => window.open(uploadUrl(url), "_blank")}
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
