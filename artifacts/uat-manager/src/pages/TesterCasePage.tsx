import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { CameraCapture } from "../components/CameraCapture";
import type { TestRun, TestCase, TestStep, Execution } from "../types/api";

interface Draft {
  stepId: number;
  passed: boolean | null;
  actual_result: string;
  comments: string;
  savedAt: string;
}

function draftKey(testRunId: number, testCaseId: number, stepId: number) {
  return `draft_step_${testRunId}_${testCaseId}_${stepId}`;
}

function isFromToday(savedAt: string): boolean {
  const d = new Date(savedAt);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

const statusColors: Record<string, string> = {
  "Not Started": "bg-surface-container-high text-on-surface-variant",
  "In Progress": "bg-amber-100 text-amber-800",
  "Pass": "bg-green-100 text-green-800",
  "Fail": "bg-red-100 text-red-800",
};

export function TesterCasePage({ params }: { params: { testRunId: string; scenarioId: string; testCaseId?: string } }) {
  const [, navigate] = useLocation();
  const testRunId = Number(params.testRunId);
  const scenarioId = Number(params.scenarioId);
  const testCaseId = params.testCaseId ? Number(params.testCaseId) : null;
  const queryClient = useQueryClient();

  useEffect(() => { document.title = testCaseId ? "Test Case" : "Test Cases"; }, [testCaseId]);

  // Level 2: Test Case Selector (no testCaseId)
  if (!testCaseId) {
    return <TestCaseSelector testRunId={testRunId} scenarioId={scenarioId} />;
  }
  return <StepWizard testRunId={testRunId} scenarioId={scenarioId} testCaseId={testCaseId} queryClient={queryClient} navigate={navigate} />;
}

function TestCaseSelector({ testRunId, scenarioId }: { testRunId: number; scenarioId: number }) {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"guided" | "quick">(() => {
    const stored = sessionStorage.getItem(`tester_mode_${getStoredUser()?.userId}`);
    return stored === "quick" ? "quick" : "guided";
  });

  const { data: testRun } = useQuery({
    queryKey: ["test-run", testRunId],
    queryFn: () => customFetch<TestRun>(`/test-runs/${testRunId}`),
  });

  const { data: useCase } = useQuery({
    queryKey: ["use-case", scenarioId],
    queryFn: () => customFetch<{ id: number; name: string; code: string; testCases: TestCase[] }>(`/use-cases/${scenarioId}`),
  });

  useEffect(() => {
    sessionStorage.setItem(`tester_mode_${getStoredUser()?.userId}`, mode);
  }, [mode]);

  const testCases = useCase?.testCases ?? [];
  const completedCount = useMemo(() => {
    return testCases.filter((tc) => {
      const status = (tc as TestCase & { _status?: string })._status;
      return status === "Pass" || status === "Fail";
    }).length;
  }, [testCases]);

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-primary text-on-primary px-md py-sm flex items-center justify-between sticky top-0 z-10">
        <button onClick={() => navigate(`/tester/run/${testRunId}`)} className="font-label-sm text-label-sm opacity-80 hover:opacity-100 flex items-center gap-xs">
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Scenarios
        </button>
        <h1 className="font-label-md text-label-md">{useCase?.code ?? `Scenario #${scenarioId}`}</h1>
        <div className="w-12" />
      </header>

      <div className="flex-1 p-md max-w-[480px] w-full mx-auto space-y-md">
        <section className="bg-surface-container-lowest p-md rounded-xl border border-outline-variant">
          <h2 className="font-title-sm text-title-sm">{useCase?.name ?? "Test Scenario"}</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs">
            {testRun?.project?.name ?? ""}
          </p>
          <div className="mt-md flex gap-sm">
            <button
              onClick={() => setMode("guided")}
              className={`flex-1 py-2 rounded-lg font-label-md text-label-sm transition-all ${
                mode === "guided" ? "bg-secondary text-on-secondary" : "bg-surface-container text-on-surface-variant"
              }`}
            >
              Guided Mode
            </button>
            <button
              onClick={() => setMode("quick")}
              className={`flex-1 py-2 rounded-lg font-label-md text-label-sm transition-all ${
                mode === "quick" ? "bg-secondary text-on-secondary" : "bg-surface-container text-on-surface-variant"
              }`}
            >
              Quick Mode
            </button>
          </div>
        </section>

        <h3 className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant px-xs">
          Test Cases ({completedCount} / {testCases.length})
        </h3>

        <div className="space-y-sm">
          {testCases.map((tc) => {
            const status = (tc as TestCase & { _status?: string })._status ?? "Not Started";
            return (
              <button
                key={tc.id}
                onClick={() => navigate(`/tester/run/${testRunId}/scenario/${scenarioId}/case/${tc.id}`)}
                className="w-full text-left bg-surface-container-lowest border border-outline-variant rounded-xl p-md hover:shadow-md transition-shadow flex items-center gap-md"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-sm mb-xs">
                    <span className="font-label-sm text-label-sm font-bold text-secondary">[{tc.case_number}]</span>
                    {tc.test_type && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-secondary-container text-on-secondary-container">
                        {tc.test_type}
                      </span>
                    )}
                    {tc.estimated_minutes != null && (
                      <span className="text-[10px] text-on-surface-variant">(~{tc.estimated_minutes}m)</span>
                    )}
                  </div>
                  <p className="font-label-md text-label-md text-on-surface">{tc.title}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${statusColors[status] ?? ""}`}>
                  {status}
                </span>
                <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
              </button>
            );
          })}
          {testCases.length === 0 && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg text-center text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl mb-md block">inbox</span>
              <p className="font-body-sm">No test cases in this scenario.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepWizard({
  testRunId,
  scenarioId,
  testCaseId,
  queryClient,
  navigate,
}: {
  testRunId: number;
  scenarioId: number;
  testCaseId: number;
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: (path: string) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const user = getStoredUser();

  const { data: testCase } = useQuery({
    queryKey: ["test-case", testCaseId],
    queryFn: async () => {
      return customFetch<TestCase & { steps: TestStep[] }>(`/test-cases/${testCaseId}`);
    },
    enabled: !!testCaseId,
  });

  // Find or create execution for this test case
  const { data: execution } = useQuery({
    queryKey: ["tester-execution", testRunId, testCaseId],
    queryFn: async () => {
      const run = await customFetch<{ executions?: Execution[] }>(`/test-runs/${testRunId}`);
      const existing = run.executions?.find((e) => e.test_case_id === testCaseId);
      if (existing) return existing;
      return customFetch<Execution>(`/test-runs/${testRunId}/test-cases/${testCaseId}/execute`, {
        method: "POST",
        body: JSON.stringify({ tester_id: user!.userId, tester_name: user!.username }),
      });
    },
    enabled: !!testCaseId && !!user,
  });

  const steps = useMemo(() => testCase?.steps ?? [], [testCase]);
  const currentStep = steps[stepIndex];

  useEffect(() => {
    if (!currentStep) return;
    const key = draftKey(testRunId, testCaseId, currentStep.id);
    const stored = sessionStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Draft;
        if (parsed.savedAt && isFromToday(parsed.savedAt)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- reading from external session storage
          setDraft(parsed);
        } else {
          sessionStorage.removeItem(key);
        }
      } catch {
        sessionStorage.removeItem(key);
      }
    } else {
      setDraft(null);
    }
  }, [currentStep?.id, testRunId, testCaseId]);

  useEffect(() => {
    if (!currentStep || !draft) return;
    const key = draftKey(testRunId, testCaseId, currentStep.id);
    const timeoutId = setTimeout(() => {
      sessionStorage.setItem(key, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
    }, 800);
    return () => clearTimeout(timeoutId);
  }, [draft, currentStep?.id, testRunId, testCaseId]);

  const submitStepMut = useMutation({
    mutationFn: (data: { passed: boolean; actual_result: string; comments: string }) =>
      customFetch(`/executions/${execution!.id}/steps/${currentStep!.id}/result`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      const key = draftKey(testRunId, testCaseId, currentStep!.id);
      sessionStorage.removeItem(key);
      toast.success(`Step ${stepIndex + 1} recorded`);
      queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
      if (stepIndex < steps.length - 1) {
        setStepIndex((i) => i + 1);
      } else {
        navigate(`/tester/run/${testRunId}/scenario/${scenarioId}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!testCase) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-4 border-secondary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!currentStep) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface p-lg text-center">
        <p className="font-body-base text-on-surface-variant">This test case has no steps.</p>
        <button onClick={() => navigate(`/tester/run/${testRunId}/scenario/${scenarioId}`)} className="mt-md bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-primary text-on-primary px-md py-sm sticky top-0 z-10">
        <div className="flex items-center justify-between mb-sm">
          <button onClick={() => navigate(`/tester/run/${testRunId}/scenario/${scenarioId}`)} className="font-label-sm text-label-sm opacity-80 hover:opacity-100 flex items-center gap-xs">
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Cases
          </button>
          <span className="font-label-sm text-label-sm">Step {stepIndex + 1} of {steps.length}</span>
        </div>
        <h1 className="font-title-sm text-title-sm truncate">[{testCase.case_number}] {testCase.title}</h1>
        <div className="mt-sm h-1 bg-on-primary/20 rounded-full overflow-hidden">
          <div className="bg-secondary h-full transition-all" style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
        </div>
      </header>

      <div className="flex-1 p-md max-w-[480px] w-full mx-auto space-y-md pb-32">
        {testCase.acceptance_criteria && (
          <div className="bg-secondary-container border-l-4 border-secondary rounded-lg p-md">
            <p className="text-xs font-bold text-on-secondary-container uppercase tracking-wider mb-xs">Acceptance Criteria</p>
            <p className="font-body-sm text-body-sm text-on-secondary-container">{testCase.acceptance_criteria}</p>
          </div>
        )}

        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md space-y-sm">
          <span className="text-xs font-bold text-on-surface-variant uppercase">Step {currentStep.step_number}</span>
          <p className="font-body-base text-body-base text-on-surface" style={{ fontSize: "16px" }}>{currentStep.instruction}</p>
          {currentStep.test_data && (
            <div className="bg-amber-50 border border-amber-200 rounded p-sm">
              <p className="text-[10px] font-bold text-amber-800 uppercase mb-xs">Test Data</p>
              <p className="font-body-sm text-body-sm text-amber-900 whitespace-pre-wrap">{currentStep.test_data}</p>
            </div>
          )}
          {currentStep.expected_result && (
            <div className="bg-blue-50 border border-blue-200 rounded p-sm">
              <p className="text-[10px] font-bold text-blue-800 uppercase mb-xs">Expected Result</p>
              <p className="font-body-sm text-body-sm text-blue-900 whitespace-pre-wrap">{currentStep.expected_result}</p>
            </div>
          )}
        </div>

        {draft && (
          <div className="bg-amber-100 border border-amber-300 rounded-lg p-sm flex items-center justify-between">
            <span className="text-xs text-amber-900">Draft restored — last saved at {new Date(draft.savedAt).toLocaleTimeString()}</span>
            <button
              onClick={() => {
                const key = draftKey(testRunId, testCaseId, currentStep.id);
                sessionStorage.removeItem(key);
                setDraft(null);
              }}
              className="text-xs font-bold text-amber-900 underline"
            >
              Clear
            </button>
          </div>
        )}

        <div>
          <label className="font-label-md text-label-md text-on-surface mb-xs block">What actually happened?</label>
          <textarea
            value={draft?.actual_result ?? ""}
            onChange={(e) => setDraft((d) => ({ stepId: currentStep.id, passed: d?.passed ?? null, actual_result: e.target.value, comments: d?.comments ?? "", savedAt: new Date().toISOString() }))}
            className="w-full bg-surface border border-outline-variant rounded-lg p-md text-sm resize-none focus:ring-2 focus:ring-secondary focus:border-secondary"
            style={{ minHeight: "48px" }}
            rows={3}
            placeholder="Describe what happened…"
          />
        </div>

        <CameraCapture
          onUploaded={(url) => {
            setDraft((d) => ({ stepId: currentStep.id, passed: d?.passed ?? null, actual_result: d?.actual_result ?? "", comments: `${d?.comments ?? ""}\n[photo: ${url}]`, savedAt: new Date().toISOString() }));
          }}
        />
      </div>

      <div className="sticky bottom-0 left-0 right-0 bg-surface border-t border-outline-variant p-md flex gap-sm max-w-[480px] w-full mx-auto">
        <button
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          className="flex-1 py-3 rounded-lg bg-surface-container text-on-surface font-label-md disabled:opacity-30"
        >
          ← Previous
        </button>
        <button
          onClick={() => {
            submitStepMut.mutate({ passed: false, actual_result: draft?.actual_result ?? "", comments: draft?.comments ?? "" });
          }}
          disabled={submitStepMut.isPending}
          className="flex-1 py-3 rounded-lg bg-error text-on-error font-label-md disabled:opacity-50"
        >
          ✗ Fail
        </button>
        <button
          onClick={() => {
            submitStepMut.mutate({ passed: true, actual_result: draft?.actual_result ?? "", comments: draft?.comments ?? "" });
          }}
          disabled={submitStepMut.isPending}
          className="flex-1 py-3 rounded-lg bg-green-600 text-white font-label-md disabled:opacity-50"
        >
          ✓ Pass
        </button>
      </div>
    </div>
  );
}
