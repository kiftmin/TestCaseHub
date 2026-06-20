import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { customFetch, API_ORIGIN } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useProjectRole } from "../hooks/useProjectRole";
import { TeamDiscussionModal } from "../components/TeamDiscussionModal";
import { TestRunExecutionFormPDF } from "../lib/pdf-documents";
import type {
  TestRun,
  TestRunUseCase,
  TestRunChecklistItem,
  Execution,
  TestStep,
  TeamDiscussion,
  TestCase,
  UseCase,
  ProjectAssignment,
} from "../types/api";

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700 border-blue-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-green-100 text-green-700 border-green-200",
};

const ucStatusColors: Record<string, string> = {
  passed: "bg-green-100 text-green-700 border-green-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  pending: "bg-surface-container-high text-on-surface-variant border-outline-variant",
  passed_by_agreement: "bg-purple-100 text-purple-700 border-purple-200",
};

interface TestRunFullReport {
  executions?: Array<{
    id: number;
    test_case_id: number;
    test_run_id: number;
    tester_id: number;
    executed_at: string | null;
    overall_result: "passed" | "failed" | "passed_by_agreement" | null;
    notes?: string | null;
    stepResults?: Array<{
      id: number;
      step_id: number;
      actual_result: string | null;
      comments: string | null;
      passed: boolean | null;
    }>;
  }>;
}

export function TestRunDetailPage({ params }: { params: { id: string } }) {
  const testRunId = Number(params.id);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: testRun, isLoading, isError } = useQuery({
    queryKey: ["test-run", testRunId],
    queryFn: () => customFetch<TestRun>(`/test-runs/${testRunId}`),
  });

  const { data: checklist } = useQuery({
    queryKey: ["checklist", testRunId],
    queryFn: () => customFetch<TestRunChecklistItem[]>(`/test-runs/${testRunId}/checklist`),
  });

  const { data: qrData } = useQuery({
    queryKey: ["qr", testRunId],
    queryFn: () => customFetch<{ accessUrl: string; qrDataUrl: string }>(`/test-runs/${testRunId}/access-qr`),
    enabled: false,
  });

  const role = useProjectRole(testRun?.project_id ?? null);
  const isCompleted = testRun?.status === "completed";
  const canViewAll = role === "TEST_LEAD" || role === "ADMIN";
  const canManage = canViewAll && !isCompleted;

  useEffect(() => {
    document.title = `${testRun?.name ?? "Test Run"} | TestCaseHub`;
  }, [testRun?.name]);

  const { data: discussions } = useQuery({
    queryKey: ["discussions", testRunId],
    queryFn: () => customFetch<TeamDiscussion[]>(`/test-runs/${testRunId}/discussions`),
  });

  const activeDiscussion = discussions?.find((d) => d.is_active) ?? null;

  const [checklistItems, setChecklistItems] = useState<TestRunChecklistItem[]>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [execModal, setExecModal] = useState<{ testCase: TestCase; testRunUseCase: TestRunUseCase } | null>(null);
  const [discussionOpen, setDiscussionOpen] = useState(false);

  useEffect(() => {
    if (checklist) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from query
      setChecklistItems(checklist);
    }
  }, [checklist]);

  const checkedCount = checklistItems.filter((i) => i.is_checked).length;

  const checkMutation = useMutation({
    mutationFn: (d: { itemId: number; is_checked: boolean }) =>
      customFetch(`/test-runs/${testRunId}/checklist/${d.itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ isChecked: d.is_checked }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist", testRunId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      customFetch(`/test-runs/${testRunId}/confirm-entry`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
      toast.success("Entry criteria confirmed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchRunMutation = useMutation({
    mutationFn: (d: { name?: string; status?: string }) =>
      customFetch(`/test-runs/${testRunId}`, {
        method: "PATCH",
        body: JSON.stringify(d),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRunMutation = useMutation({
    mutationFn: () =>
      customFetch<void>(`/test-runs/${testRunId}`, { method: "DELETE" }),
    onSuccess: () => {
      navigate("/projects");
      toast.success("Test run deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignTesterMutation = useMutation({
    mutationFn: (d: { testRunUseCaseId: number; assigned_tester_id: number | null }) =>
      customFetch(`/test-runs/${testRunId}/use-cases/${d.testRunUseCaseId}`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_tester_id: d.assigned_tester_id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
      toast.success("Tester assigned");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState("");

  if (isLoading) {
    return (
      <div className="space-y-lg animate-pulse">
        <div className="w-3/4 h-8 skeleton rounded" />
        <div className="w-1/2 h-4 skeleton rounded" />
        <div className="w-full h-32 skeleton rounded-lg" />
      </div>
    );
  }

  if (isError || !testRun) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-md">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant">search_off</span>
        <p className="font-body-lg text-body-lg text-on-surface">Test run not found</p>
        <p className="font-body-sm text-body-sm text-on-surface-variant max-w-xs">
          The test run you're looking for could not be loaded. It may have been deleted or you may not have access.
        </p>
        <button
          onClick={() => navigate("/projects")}
          className="bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md hover:brightness-110 transition-all"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  const allUseCases = (testRun as TestRun & { useCases?: TestRunUseCase[] })?.useCases ?? [];
  const myUserId = getStoredUser()?.userId;
  const filteredUseCases = canViewAll
    ? allUseCases
    : allUseCases.filter((uc) => uc.assigned_tester_id === myUserId);
  const useCases = canViewAll
    ? [...filteredUseCases].sort((a, b) => {
        const aUnassigned = a.assigned_tester_id == null ? 0 : 1;
        const bUnassigned = b.assigned_tester_id == null ? 0 : 1;
        return aUnassigned - bUnassigned;
      })
    : filteredUseCases;

  const handleDownloadQR = () => {
    if (qrData?.qrDataUrl) {
      const a = document.createElement("a");
      a.href = qrData.qrDataUrl;
      a.download = `test-run-${testRunId}-qr.png`;
      a.click();
    }
  };

  const handleShareQR = async () => {
    if (qrData?.accessUrl && typeof navigator.share !== "undefined") {
      try {
        await navigator.share({ title: testRun.name, url: qrData.accessUrl });
      } catch { /* user cancelled */ }
    }
  };

  return (
    <div className="space-y-lg">
      {/* Section 1: Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-sm text-on-surface-variant text-label-sm mb-xs">
            <button
              onClick={() => navigate(`/projects/${testRun.project_id}`)}
              className="flex items-center gap-1 text-on-surface-variant hover:text-on-surface transition-colors mr-1"
              title="Back to Project"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              <span className="text-xs font-medium">Back</span>
            </button>
            <span className="material-symbols-outlined text-[14px] text-outline-variant">chevron_right</span>
            <a
              onClick={(e) => { e.preventDefault(); navigate(`/projects/${testRun.project_id}`); }}
              href={`/projects/${testRun.project_id}`}
              className="hover:underline cursor-pointer"
            >
              {testRun.project?.name ?? `Project #${testRun.project_id}`}
            </a>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-secondary font-bold">{testRun.name}</span>
          </div>
          <div className="flex items-center gap-md">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  className="font-display-lg text-display-lg border border-secondary rounded px-1 py-0.5"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      patchRunMutation.mutate({ name: editName });
                      setEditingName(false);
                    }
                    if (e.key === "Escape") setEditingName(false);
                  }}
                />
                <button
                  onClick={() => { patchRunMutation.mutate({ name: editName }); setEditingName(false); }}
                  className="material-symbols-outlined text-secondary"
                >
                  check_circle
                </button>
                <button onClick={() => setEditingName(false)} className="material-symbols-outlined text-on-surface-variant">
                  close
                </button>
              </div>
            ) : (
              <h1 className="font-display-lg text-display-lg text-primary">{testRun.name}</h1>
            )}
            <span className={`inline-flex items-center gap-xs px-sm py-xs rounded-full text-label-sm font-bold border ${statusColors[testRun.status] ?? ""}`}>
              <span className={`w-2 h-2 rounded-full ${testRun.status === "in_progress" ? "bg-amber-500 animate-pulse" : ""}`} />
              {testRun.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </span>
            {isCompleted && (
              <span className="inline-flex items-center gap-1 px-sm py-xs rounded-full bg-surface-container-high text-on-surface-variant text-label-sm font-bold border border-outline-variant">
                <span className="material-symbols-outlined text-[14px]">lock</span>
                Read Only
              </span>
            )}
          </div>
          <div className="flex items-center gap-md mt-sm text-body-sm text-on-surface-variant">
            {testRun.scheduled_at && (
              <span>Scheduled: {new Date(testRun.scheduled_at).toLocaleDateString()}</span>
            )}
            <span>Created {new Date(testRun.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-md">
            {activeDiscussion && (
              <button
                onClick={() => setDiscussionOpen(true)}
                className="flex items-center gap-sm px-md py-sm border border-amber-300 text-amber-800 bg-amber-50 rounded-lg font-label-md hover:bg-amber-100 transition-colors"
              >
                <span className="material-symbols-outlined">bolt</span>
                Discussion Active
              </button>
            )}
            {!activeDiscussion && canManage && (
              <button
                onClick={() => setDiscussionOpen(true)}
                className="flex items-center gap-sm px-md py-sm border border-outline text-on-surface rounded-lg font-label-md hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined">groups</span>
                Team Discussion
              </button>
            )}
            {canManage && (
              <button
                onClick={async () => {
                  setQrOpen(true);
                  await queryClient.fetchQuery({ queryKey: ["qr", testRunId] });
                }}
                className="flex items-center gap-sm px-md py-sm border border-outline text-on-surface rounded-lg font-label-md hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined">qr_code_2</span>
                Share with Testers
              </button>
            )}
            <PDFDownloadLink
              document={
                <TestRunExecutionFormPDF
                  projectName={testRun.project?.name ?? `Project #${testRun.project_id}`}
                  testRunName={testRun.name}
                  testRunId={testRunId}
                  steps={(() => {
                    const allSteps = filteredUseCases.flatMap((truc) =>
                      (truc.useCase as UseCase & { testCases?: (TestCase & { steps?: TestStep[] })[] })?.testCases?.flatMap((tc) => tc.steps ?? []) ?? []
                    );
                    return allSteps.map((s) => ({
                      id: s.id,
                      step_number: s.step_number,
                      instruction: s.instruction,
                      expected_result: s.expected_result,
                    }));
                  })()}
                />
              }
              fileName={`execution-form-${testRunId}.pdf`}
              className="flex items-center gap-sm px-md py-sm border border-outline text-on-surface rounded-lg font-label-md hover:bg-surface-container-high transition-colors"
            >
              {({ loading }) => (
                <>
                  <span className="material-symbols-outlined text-sm">file_download</span>
                  {loading ? "Preparing..." : "Download PDF"}
                </>
              )}
            </PDFDownloadLink>
            {canManage && (
              <button
                onClick={() => { setEditingName(true); setEditName(testRun.name); }}
                className="material-symbols-outlined text-on-surface-variant hover:text-secondary"
              >
                edit
              </button>
            )}
            {canManage && (
              <button
                onClick={() => setDeleting(true)}
                className="material-symbols-outlined text-on-surface-variant hover:text-error"
              >
                delete
              </button>
            )}
        </div>
      </div>

      {/* Active Discussion Banner */}
      {activeDiscussion && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-lg flex items-start gap-md">
          <span className="material-symbols-outlined text-amber-600" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
          <div className="flex-1">
            <p className="font-label-md font-bold text-amber-900">
              Active team discussion in progress — {activeDiscussion.meeting_type === "defect_review" ? "Defect Review" : "Post Mortem"}
            </p>
          </div>
        </div>
      )}

      {/* Section 2: Entry Criteria Banner */}
      {testRun.entry_confirmed ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-lg flex items-start gap-md">
          <span className="material-symbols-outlined text-green-600" style={{ fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
          <div className="flex-1">
            <h3 className="font-title-sm text-title-sm text-green-900 mb-base">Entry criteria confirmed — execution is open</h3>
            <p className="text-body-sm text-green-800">All prerequisites have been signed off. Testers can proceed with execution.</p>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-lg flex items-start gap-md">
          <span className="material-symbols-outlined text-amber-600" style={{ fontVariationSettings: "'FILL' 1" }}>
            warning
          </span>
          <div className="flex-1">
            <h3 className="font-title-sm text-title-sm text-amber-900 mb-base">Entry criteria not yet confirmed — execution is locked</h3>
            <p className="text-body-sm text-amber-800">Complete the pre-flight checklist below to unlock execution.</p>
          </div>
        </div>
      )}

      {/* Section 3: Pre-flight Checklist + Scenarios */}
      <div className="grid grid-cols-12 gap-lg items-start">
        {/* Left: Scenarios */}
        <div className="col-span-8 space-y-lg">
          <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden shadow-sm">
            <div className="px-lg py-md border-b border-outline-variant flex items-center justify-between">
              <div>
                <h2 className="font-title-sm text-title-sm">
                  {canViewAll ? "All Scenarios" : "Execution Scenarios"}
                </h2>
                <p className="text-label-sm text-on-surface-variant mt-0.5">
                  {canViewAll
                    ? "All scenarios for this test run."
                    : "Scenarios assigned to you for this run."}
                </p>
              </div>
              <div className="flex items-center gap-sm">
                <span className="px-sm py-xs bg-surface-container-high rounded text-label-sm text-on-surface-variant">
                  {useCases.length} {canViewAll ? "of " + allUseCases.length + " Total" : "Total"}
                </span>
              </div>
            </div>
            <div className="divide-y divide-outline-variant">
              {useCases.map((truc) => (
                <ScenarioPanel
                  key={truc.id}
                  truc={truc}
                  projectId={testRun.project_id}
                  canManage={canManage}
                  onAssign={(testerId) =>
                    assignTesterMutation.mutate({ testRunUseCaseId: truc.id, assigned_tester_id: testerId })
                  }
                  onExec={(tc) => setExecModal({ testCase: tc, testRunUseCase: truc })}
                />
              ))}
              {useCases.length === 0 && (
                <div className="p-lg text-center text-on-surface-variant font-body-sm">
                  No scenarios in this test run.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Checklist */}
        <div className="col-span-4 space-y-lg">
          <div className="bg-surface border border-outline-variant rounded-xl p-lg shadow-sm">
            <div className="flex items-center justify-between mb-lg">
              <h2 className="font-title-sm text-title-sm">Pre-flight Checklist</h2>
              <span className="text-label-sm font-bold text-secondary">
                {checkedCount}/{checklistItems.length} Done
              </span>
            </div>
            <ul className="space-y-md">
              {checklistItems.map((item) => (
                <li key={item.id} className="flex items-start gap-md group">
                  <div
                    className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
                      item.is_checked
                        ? "bg-secondary border-secondary text-on-secondary"
                        : "border-outline-variant hover:border-secondary"
                    }`}
                    onClick={() => {
                      if (!canManage) return;
                      checkMutation.mutate({ itemId: item.id, is_checked: !item.is_checked });
                      setChecklistItems((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, is_checked: !i.is_checked } : i))
                      );
                    }}
                  >
                    {item.is_checked && (
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    )}
                  </div>
                  <span
                    className={`text-body-sm ${
                      item.is_checked ? "text-on-surface-variant line-through" : "text-on-surface"
                    }`}
                  >
                    {item.item_text}
                  </span>
                </li>
              ))}
            </ul>
            {!testRun.entry_confirmed && canManage && (
              <button
                disabled={checkedCount < checklistItems.length || checklistItems.length === 0}
                onClick={() => confirmMutation.mutate()}
                className="mt-lg w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md text-label-md hover:brightness-110 transition-all disabled:opacity-40"
              >
                {confirmMutation.isPending ? "Confirming..." : "Confirm Entry Criteria"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* QR Modal */}
      {qrOpen && qrData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setQrOpen(false)} />
          <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-sm mx-4 p-lg text-center space-y-md">
            <h3 className="font-title-sm text-title-sm">Tester Invite Code</h3>
            <div className="bg-gradient-to-br from-[#6063ee] to-[#4648d4] p-md rounded-lg inline-block mx-auto">
              <img src={qrData.qrDataUrl} alt="QR Code" className="bg-white p-base rounded w-48 h-48" />
            </div>
            <p className="text-body-sm text-on-surface-variant">
              Scan to join '{testRun.name}' as an active tester.
            </p>
            <div className="flex items-center gap-sm bg-surface-container-low p-sm rounded border border-outline-variant">
              <input
                className="flex-1 bg-transparent text-xs font-mono outline-none"
                value={qrData.accessUrl}
                readOnly
              />
              <button
                onClick={() => { navigator.clipboard.writeText(qrData.accessUrl); toast.success("URL copied"); }}
                className="material-symbols-outlined text-secondary text-sm"
              >
                content_copy
              </button>
            </div>
            <div className="flex gap-md justify-center">
              <button
                onClick={handleDownloadQR}
                className="px-lg py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 transition-all"
              >
                Download QR
              </button>
              {typeof navigator.share !== "undefined" && (
                <button
                  onClick={handleShareQR}
                  className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-all"
                >
                  Share
                </button>
              )}
            </div>
            <button
              onClick={() => setQrOpen(false)}
              className="text-label-sm text-on-surface-variant hover:underline"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleting(false)} />
          <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-sm mx-4 p-lg space-y-md">
            <h3 className="font-title-sm text-title-sm">Delete Test Run?</h3>
            <p className="text-body-sm text-on-surface-variant">
              Are you sure you want to delete "{testRun.name}"? This action cannot be undone.
            </p>
            <div className="flex gap-md justify-end">
              <button
                onClick={() => setDeleting(false)}
                className="px-lg py-sm border border-outline-variant rounded-lg font-label-md"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteRunMutation.mutate()}
                className="px-lg py-sm bg-error text-on-error rounded-lg font-label-md hover:brightness-110 transition-all"
              >
                {deleteRunMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Execution Modal */}
      {execModal && (
        <ExecutionModal
          key={execModal.testCase.id}
          testRunId={testRunId}
          testCase={execModal.testCase}
          testRunUseCase={execModal.testRunUseCase}
          entryConfirmed={testRun.entry_confirmed}
          readOnly={isCompleted}
          onClose={() => setExecModal(null)}
        />
      )}

      {discussionOpen && (
        <TeamDiscussionModal
          testRunId={testRunId}
          onClose={() => setDiscussionOpen(false)}
        />
      )}
    </div>
  );
}

/* ───────── Scenario Panel ───────── */

function ScenarioPanel({
  truc,
  projectId,
  canManage,
  onAssign,
  onExec,
}: {
  truc: TestRunUseCase;
  projectId: number;
  canManage: boolean;
  onAssign: (testerId: number | null) => void;
  onExec: (tc: TestCase) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        className="px-lg py-md hover:bg-surface-container-low transition-colors flex items-center gap-lg cursor-pointer"
      >
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            truc.status === "passed" || truc.status === "passed_by_agreement"
              ? "bg-green-100 text-green-700"
              : truc.status === "failed"
              ? "bg-red-100 text-red-700"
              : "bg-surface-container-highest text-outline"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
            {truc.status === "passed" || truc.status === "passed_by_agreement"
              ? "check_circle"
              : truc.status === "failed"
              ? "cancel"
              : "schedule"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-body-base font-semibold truncate">
            {truc.useCase?.code} - {truc.useCase?.name ?? `Scenario #${truc.use_case_id}`}
          </h4>
          <div className="flex items-center gap-md mt-xs">
            <span
              className={`px-sm py-xs rounded text-label-sm font-bold border ${ucStatusColors[truc.status] ?? ""}`}
            >
              {truc.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </span>
            {truc.tester && (
              <div className="flex items-center gap-xs">
                <div className="w-5 h-5 rounded-full bg-secondary-fixed flex items-center justify-center text-[8px] font-bold text-on-secondary-fixed">
                  {truc.tester.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?"}
                </div>
                <span className="text-label-sm text-on-surface-variant">{truc.tester.name}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-xl">
          <span className="material-symbols-outlined text-on-surface-variant transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "" }}>
            expand_more
          </span>
        </div>
      </div>

      {expanded && (
        <div className="ml-xl pl-lg border-l border-outline-variant space-y-[1px] pb-md">
          {canManage && (
            <AssignTester
              projectId={projectId}
              currentTesterId={truc.assigned_tester_id}
              onAssign={onAssign}
            />
          )}
          {(truc.useCase as UseCase & { testCases?: TestCase[] })?.testCases?.map((tc) => (
            <div
              key={tc.id}
              onClick={() => onExec(tc)}
              className="px-md py-sm hover:bg-surface-container-low transition-colors flex items-center gap-md cursor-pointer rounded"
            >
              <span className="material-symbols-outlined text-on-surface-variant text-sm">play_circle</span>
              <span className="flex-1 font-body-sm">[{tc.case_number}] {tc.title}</span>
              <span className="material-symbols-outlined text-on-surface-variant text-sm">chevron_right</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────── Assign Tester ───────── */

function AssignTester({
  projectId,
  currentTesterId,
  onAssign,
}: {
  projectId: number;
  currentTesterId: number | null;
  onAssign: (testerId: number | null) => void;
}) {
  const { data: assignments } = useQuery({
    queryKey: ["project-users", projectId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/projects/${projectId}/users`),
  });
  const [open, setOpen] = useState(false);

  const eligibleUsers = (assignments ?? [])
    .filter((a) => a.role === "TEST_LEAD" || a.role === "TESTER")
    .map((a) => ({ id: a.user_id, name: a.user.name }));

  const currentUser = assignments?.find((a) => a.user_id === currentTesterId);
  if (currentUser && !eligibleUsers.some((u) => u.id === currentUser.user_id)) {
    eligibleUsers.push({ id: currentUser.user_id, name: currentUser.user.name });
  }

  return (
    <div className="px-md py-sm">
      {open ? (
        <select
          className="w-full border border-outline-variant rounded px-sm py-1 text-label-sm"
          value={currentTesterId ?? ""}
          onChange={(e) => {
            onAssign(e.target.value ? Number(e.target.value) : null);
            setOpen(false);
          }}
          autoFocus
        >
          <option value="">Unassign</option>
          {eligibleUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="text-label-sm text-secondary hover:underline"
        >
          {currentTesterId ? "Change Tester" : "+ Assign Tester"}
        </button>
      )}
    </div>
  );
}

/* ───────── EXECUTION MODAL ───────── */

// Module-level cache to persist execution session data across component remounts
const executionSessionCache = new Map<number, {
  execution: Execution | null;
  results: Record<number, { passed: boolean | null; actual_result: string; comments: string }>;
  overallResult: string;
  testerNotes: string;
  currentStep: number;
  proofImages: Record<number, string>;
}>();

function ExecutionModal({
  testRunId,
  testCase,
  testRunUseCase,
  entryConfirmed,
  readOnly,
  onClose,
}: {
  testRunId: number;
  testCase: TestCase;
  testRunUseCase: TestRunUseCase;
  entryConfirmed: boolean;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"guided" | "quick">("guided");
  const [currentStep, setCurrentStep] = useState(0);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [results, setResults] = useState<Record<number, { passed: boolean | null; actual_result: string; comments: string }>>({});
  const [overallResult, setOverallResult] = useState<string>("");
  const [testerNotes, setTesterNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [offlineBanner, setOfflineBanner] = useState(false);
  const [proofImages, setProofImages] = useState<Record<number, string>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClose = useCallback(() => {
    executionSessionCache.delete(testCase.id);
    onClose();
  }, [testCase.id, onClose]);

  const handleProofUpload = async (stepId: number, file: File) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await customFetch<{ fileUrl: string }>("/upload", {
        method: "POST",
        body: formData,
      });

      if (execution?.id) {
        await customFetch("/attachments", {
          method: "POST",
          body: JSON.stringify({
            entity_type: "execution",
            entity_id: execution.id,
            file_name: file.name,
            file_url: uploadRes.fileUrl,
            file_type: file.type,
            field: `step_${stepId}`,
          }),
        });
      }

      setProofImages((prev) => ({ ...prev, [stepId]: `${API_ORIGIN}${uploadRes.fileUrl}` }));
      toast.success("Proof uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "An error occurred");
    }
  };

  const { data: steps } = useQuery({
    queryKey: ["steps", testCase.id],
    queryFn: () => customFetch<TestStep[]>(`/test-cases/${testCase.id}/steps`),
  });

  useEffect(() => {
    // Restore from cache if available (handles component remount mid-session)
    const cached = executionSessionCache.get(testCase.id);
    if (cached) {
      setExecution(cached.execution);
      setResults(cached.results);
      setOverallResult(cached.overallResult);
      setTesterNotes(cached.testerNotes);
      setCurrentStep(cached.currentStep);
      setProofImages(cached.proofImages);
      setInitialLoading(false);
      return;
    }

    if (!entryConfirmed) { setInitialLoading(false); return; }
    let cancelled = false;

    const initExec = async () => {
      try {
        const user = getStoredUser();
        if (!user) { toast.error("User not found"); setInitialLoading(false); return; }

        const created = await customFetch<Execution>(`/test-runs/${testRunId}/test-cases/${testCase.id}/execute`, {
          method: "POST",
          body: JSON.stringify({ tester_id: user.userId }),
        });
        if (!cancelled) setExecution(created);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.log(`[exec] initExec error: "${errMsg}"`);
        if (errMsg.toLowerCase().includes("already been executed") || errMsg.toLowerCase().includes("completed test run")) {
          try {
            const fullReport = await customFetch<TestRunFullReport>(`/test-runs/${testRunId}/full-report`, {
              cache: "no-store",
            });
            if (cancelled) return;
            const matches = fullReport.executions?.filter((ex) => ex.test_case_id === testCase.id) ?? [];
            const existing = matches.sort((a, b) => b.id - a.id)[0];
            console.log(`[exec] full-report executions for case ${testCase.id}: ${JSON.stringify(matches.map(m => ({ id: m.id, stepResultsCount: m.stepResults?.length ?? 0, stepResultIds: m.stepResults?.map(sr => sr.id) })))}`);
            console.log(`[exec] Selected execution id=${existing?.id}, stepResults=`, JSON.stringify(existing?.stepResults?.map(sr => ({ id: sr.id, step_id: sr.step_id, passed: sr.passed, actual_result: sr.actual_result }))));
            if (existing) {
              setExecution(existing as Execution);
              if (existing.overall_result) setOverallResult(existing.overall_result);
              if (existing.notes) setTesterNotes(existing.notes);
              if (existing.stepResults) {
                const map: Record<number, { passed: boolean | null; actual_result: string; comments: string }> = {};
                const sorted = [...existing.stepResults].sort((a, b) => a.id - b.id);
                sorted.forEach((sr) => {
                  map[sr.step_id] = { passed: sr.passed, actual_result: sr.actual_result ?? "", comments: sr.comments ?? "" };
                });
                setResults(map);
              }
              // Load attachment/proof images independently
              const attachments = await customFetch<{ id: number; field: string; file_url: string }[]>(
                `/attachments/execution/${existing.id}`
              ).catch(() => [] as { id: number; field: string; file_url: string }[]);
              if (cancelled) return;
              if (attachments.length > 0) {
                const imgMap: Record<number, string> = {};
                attachments.forEach((a) => {
                  if (a.field?.startsWith("step_")) {
                    const stepId = Number(a.field.replace("step_", ""));
                    if (!isNaN(stepId)) imgMap[stepId] = `${API_ORIGIN}${a.file_url}`;
                  }
                });
                if (Object.keys(imgMap).length > 0) setProofImages(imgMap);
              }
            }
          } catch (e2) {
            const msg = e2 instanceof Error ? e2.message : "An error occurred";
            toast.error(msg);
          }
        } else {
          toast.error(errMsg);
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    };
    initExec();
    return () => { cancelled = true; };
  }, [entryConfirmed, testRunId, testCase.id, readOnly]);

  // Sync state to cache whenever execution data changes (survives component remounts)
  useEffect(() => {
    if (execution) {
      executionSessionCache.set(testCase.id, {
        execution,
        results,
        overallResult,
        testerNotes,
        currentStep,
        proofImages,
      });
    }
  }, [testCase.id, execution, results, overallResult, testerNotes, currentStep, proofImages]);

  const stepList = steps ?? [];
  const totalSteps = stepList.length;

  /* Offline draft support */
  const draftKey = `draft_step_${testRunId}_${testCase.id}_${execution?.id ?? "pending"}`;

  useEffect(() => {
    if (!execution?.id) return;
    const stored = sessionStorage.getItem(draftKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- reading from external session storage
          setOfflineBanner(true);
        }
      } catch { /* ignore */ }
    }
  }, [execution?.id, draftKey]);

  useEffect(() => {
    const handleOnline = async () => {
      if (!execution?.id) return;
      const stored = sessionStorage.getItem(draftKey);
      if (!stored) return;
      try {
        const pending = JSON.parse(stored);
        for (const r of pending) {
          await customFetch(`/executions/${execution.id}/steps/${r.stepId}/result`, {
            method: "POST",
            body: JSON.stringify({ passed: r.passed, actual_result: r.actual_result ?? "", comments: r.comments ?? "" }),
          });
        }
        sessionStorage.removeItem(draftKey);
        setOfflineBanner(false);
        toast.success("Draft submitted successfully");
        queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
      } catch { /* ignore */ }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [execution?.id, draftKey, queryClient, testRunId]);

  const submitStepResult = async (stepId: number, passed: boolean, actual_result: string, comments: string) => {
    if (!execution?.id) return;

    if (!navigator.onLine) {
      const stored = sessionStorage.getItem(draftKey);
      const pending = stored ? JSON.parse(stored) : [];
      pending.push({ stepId, passed, actual_result, comments });
      sessionStorage.setItem(draftKey, JSON.stringify(pending));
      setOfflineBanner(true);
      setResults((prev) => ({ ...prev, [stepId]: { passed, actual_result, comments } }));
      return;
    }

    try {
      const hasExisting = results[stepId]?.passed != null;
      console.log(`[exec] submitStepResult step=${stepId} method=${hasExisting ? "PUT" : "POST"} passed=${passed} body=${JSON.stringify({ passed, actual_result, comments })} executionId=${execution.id}`);
      await customFetch(`/executions/${execution.id}/steps/${stepId}/result`, {
        method: hasExisting ? "PUT" : "POST",
        body: JSON.stringify({ passed, actual_result, comments }),
      });
      console.log(`[exec] submitStepResult step=${stepId} SUCCESS`);
      setResults((prev) => ({ ...prev, [stepId]: { passed, actual_result, comments } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "An error occurred");
    }
  };

  const completeExecution = async () => {
    if (!execution?.id || !totalSteps) return;

    const allHaveResults = stepList.every((step) => results[step.id]?.passed !== null);
    if (!allHaveResults) {
      toast.error("All steps must have a pass/fail result before completing");
      return;
    }

    setSubmitting(true);

    const result = overallResult || (Object.values(results).every((r) => r.passed === true) ? "passed" : "failed");

    try {
      const res = await customFetch<Execution & { defect?: { id: number } }>(`/executions/${execution.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          overall_result: result === "passed_by_agreement" ? "passed_by_agreement" : result,
          notes: testerNotes || undefined,
        }),
      });

      if (result === "failed" && res.defect) {
        toast.error(`Execution marked failed — defect #DEF-${res.defect.id} created automatically`);
      } else {
        toast.success("Execution completed");
      }

      await customFetch(`/test-runs/${testRunId}/use-cases/${testRunUseCase.use_case_id}/sync`, {
        method: "POST",
      });

      queryClient.invalidateQueries({ queryKey: ["test-run", testRunId] });
      executionSessionCache.delete(testCase.id);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  if (!entryConfirmed) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose}
 />
        <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg space-y-md">
          <div className="flex items-start gap-md">
            <span className="material-symbols-outlined text-error">lock</span>
            <div>
              <h3 className="font-title-sm text-title-sm">Execution locked</h3>
              <p className="text-body-sm text-on-surface-variant">
                Entry criteria for this sequence have not been confirmed.
              </p>
            </div>
          </div>
          <button onClick={handleClose}
 className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md">
            Close
          </button>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
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
            disabled={loading}
            className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-colors disabled:opacity-30"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-lg py-sm rounded-lg bg-secondary text-on-secondary font-label-md hover:brightness-110 transition-all disabled:opacity-50"
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose}
 />
      <div className="relative bg-surface-container-lowest w-full max-w-[800px] border border-outline-variant rounded-xl shadow-xl flex flex-col overflow-hidden max-h-[90vh]">
        {/* Offline banner */}
        {offlineBanner && (
          <div className="bg-red-500 text-white px-lg py-sm text-label-sm flex items-center gap-md">
            <span className="material-symbols-outlined text-sm">cloud_off</span>
            Offline — results saved locally
          </div>
        )}

        {/* Modal Header */}
        <div className="px-lg py-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <div className="flex items-center gap-md">
            <div className="w-10 h-10 rounded-lg bg-secondary-container flex items-center justify-center">
              <span className="material-symbols-outlined text-on-secondary-container">play_circle</span>
            </div>
            <div>
              <h2 className="font-title-sm text-title-sm">Execution Engine</h2>
              <p className="font-label-sm text-label-sm text-on-surface-variant">[{testCase.case_number}] {testCase.title}</p>
            </div>
          </div>
          <button onClick={handleClose}
 className="w-8 h-8 rounded-full hover:bg-surface-variant flex items-center justify-center">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Mode toggle + step progress */}
        <div className="px-lg py-sm flex justify-between items-center bg-surface-container-lowest">
          <div className="bg-surface-container-high p-1 rounded-lg flex gap-1">
            <button
              onClick={() => setMode("guided")}
              className={`px-md py-1.5 rounded-md font-label-md text-label-md transition-all ${
                mode === "guided" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Guided
            </button>
            <button
              onClick={() => setMode("quick")}
              className={`px-md py-1.5 rounded-md font-label-md text-label-md transition-all ${
                mode === "quick" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Quick
            </button>
          </div>
          <div className="flex items-center gap-xs">
            <div className="flex gap-1">
              {stepList.map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full ${
                    i <= currentStep ? "bg-secondary" : "bg-outline-variant"
                  }`}
                />
              ))}
            </div>
            {mode === "guided" && totalSteps > 0 && (
              <span className="font-label-sm text-label-sm text-on-surface-variant ml-sm">
                Step {currentStep + 1} of {totalSteps}
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-lg">
          {(() => {
            if (initialLoading) {
              return (
                <div className="flex flex-col items-center justify-center h-full text-on-surface-variant gap-sm">
                  <div className="w-8 h-8 border-4 border-secondary border-t-transparent rounded-full animate-spin" />
                  <p className="text-body-sm">Loading execution data...</p>
                </div>
              );
            }
            return (
              <div className="contents">
              {readOnly && !execution && totalSteps > 0 && (
                <div className="mb-md bg-surface-container-high border border-outline-variant rounded-lg p-md flex items-center gap-md">
                  <span className="material-symbols-outlined text-on-surface-variant">info</span>
                  <p className="text-body-sm text-on-surface-variant">This test case was not executed during this run.</p>
                </div>
              )}
              {mode === "guided" ? (
                <GuidedMode
                  step={stepList[currentStep]}
                  totalSteps={totalSteps}
                  result={results[stepList[currentStep]?.id] ?? { passed: null, actual_result: "", comments: "" }}
                  readOnly={readOnly}
                  onResult={(r) => {
                    const s = stepList[currentStep];
                    if (!s) return;
                    setResults((prev) => ({ ...prev, [s.id]: { ...prev[s.id], ...r } }));
                    if (r.passed !== undefined && r.passed !== null) {
                      submitStepResult(s.id, r.passed, r.actual_result ?? "", r.comments ?? "");
                    }
                  }}
                  onSubmit={(passed, actual_result, comments) => {
                    const s = stepList[currentStep];
                    if (!s) return;
                    submitStepResult(s.id, passed, actual_result, comments);
                  }}
                  proofImage={stepList[currentStep] ? proofImages[stepList[currentStep].id] : undefined}
                  onProofUpload={(file) => {
                    if (stepList[currentStep]) {
                      handleProofUpload(stepList[currentStep].id, file);
                    }
                  }}
                />
              ) : (
                <QuickMode
                  steps={stepList}
                  results={results}
                  readOnly={readOnly}
                  onResult={(stepId, r) => {
                    setResults((prev) => ({ ...prev, [stepId]: { ...prev[stepId], ...r } }));
                    submitStepResult(stepId, r.passed ?? false, r.actual_result ?? "", r.comments ?? "");
                  }}
                  overallResult={overallResult}
                  onOverallResult={readOnly ? undefined : setOverallResult}
                  testerNotes={testerNotes}
                  onTesterNotes={readOnly ? undefined : setTesterNotes}
                />
              )}
              </div>
            );
          })()}
        </div>

        {/* Guided mode footer */}
        {mode === "guided" && !readOnly && (
          <div className="px-lg py-md border-t border-outline-variant flex items-center justify-between bg-surface-container-low">
            <button
              disabled={currentStep === 0}
              onClick={() => {
                const s = stepList[currentStep];
                const r = results[s.id];
                // Persist current step result before navigating back
                if (r?.passed !== undefined && r?.passed !== null) {
                  submitStepResult(s.id, r.passed, r.actual_result ?? "", r.comments ?? "");
                }
                setCurrentStep((s) => Math.max(0, s - 1));
              }}
              className="px-lg py-sm rounded-lg border border-outline-variant font-label-md text-label-md text-on-surface flex items-center gap-sm hover:bg-surface-container-high transition-all disabled:opacity-30"
            >
              <span className="material-symbols-outlined">arrow_back</span>
              Previous
            </button>
            <div className="flex gap-md">
              {currentStep < totalSteps - 1 ? (
                <>
                  <button
                    onClick={() => {
                      const s = stepList[currentStep];
                      const r = results[s.id];
                      if (r?.passed === null) { toast.error("Record a result first"); return; }
                      if (r?.passed === false && !r?.actual_result) { toast.error("Actual result is required when failing"); return; }
                      // Persist current step result before navigating
                      if (r) submitStepResult(s.id, r.passed ?? false, r.actual_result ?? "", r.comments ?? "");
                      setCurrentStep((s) => s + 1);
                    }}
                    className="px-lg py-sm rounded-lg bg-secondary text-on-secondary font-label-md text-label-md flex items-center gap-sm hover:brightness-110 transition-all"
                  >
                    Next
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={async () => {
                    const s = stepList[currentStep];
                    const r = results[s.id];
                    // Persist current step result before prompting for completion
                    if (r?.passed !== undefined && r?.passed !== null) {
                      await submitStepResult(s.id, r.passed, r.actual_result ?? "", r.comments ?? "");
                    }
                    setShowConfirm(true);
                  }}
                  disabled={submitting}
                  className="px-lg py-sm rounded-lg bg-secondary text-on-secondary font-label-md text-label-md hover:brightness-110 transition-all disabled:opacity-50"
                >
                  {submitting ? "Completing..." : "Complete"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Guided mode footer — read-only navigation */}
        {mode === "guided" && readOnly && totalSteps > 1 && (
          <div className="px-lg py-md border-t border-outline-variant flex items-center justify-between bg-surface-container-low">
            <button
              disabled={currentStep === 0}
              onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
              className="px-lg py-sm rounded-lg border border-outline-variant font-label-md text-label-md text-on-surface flex items-center gap-sm hover:bg-surface-container-high transition-all disabled:opacity-30"
            >
              <span className="material-symbols-outlined">arrow_back</span>
              Previous
            </button>
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              Step {currentStep + 1} of {totalSteps}
            </span>
            <button
              disabled={currentStep >= totalSteps - 1}
              onClick={() => setCurrentStep((s) => s + 1)}
              className="px-lg py-sm rounded-lg border border-outline-variant font-label-md text-label-md text-on-surface flex items-center gap-sm hover:bg-surface-container-high transition-all disabled:opacity-30"
            >
              Next
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
        )}

        {/* Quick mode footer */}
        {mode === "quick" && !readOnly && (
          <div className="px-lg py-md border-t border-outline-variant flex items-center justify-between bg-surface-container-low">
            <div />
            <button
              onClick={() => setShowConfirm(true)}
              disabled={submitting}
              className="px-lg py-sm rounded-lg bg-secondary text-on-secondary font-label-md text-label-md hover:brightness-110 transition-all disabled:opacity-50"
            >
              {submitting ? "Completing..." : "Complete Execution"}
            </button>
          </div>
        )}
      </div>

      {showConfirm && (
        <ConfirmDialog
          title="Complete Execution"
          message="Are you sure you want to complete this execution? The results will be final and no further changes can be made."
          confirmLabel="Complete Execution"
          onConfirm={() => { setShowConfirm(false); completeExecution(); }}
          onCancel={() => setShowConfirm(false)}
          loading={submitting}
        />
      )}
    </div>
  );
}

/* ───────── Guided Mode ───────── */

function GuidedMode({
  step,
  totalSteps,
  result,
  readOnly,
  onResult,
  onSubmit,
  proofImage,
  onProofUpload,
}: {
  step: TestStep | undefined;
  totalSteps: number;
  result: { passed: boolean | null; actual_result: string; comments: string };
  readOnly?: boolean;
  onResult: (r: { passed?: boolean | null; actual_result?: string; comments?: string }) => void;
  onSubmit: (passed: boolean, actual_result: string, comments: string) => void;
  proofImage: string | undefined;
  onProofUpload: (file: File) => void;
}) {
  if (!step) {
    return (
      <div className="text-center text-on-surface-variant py-xl">
        {totalSteps === 0 ? "No steps defined for this test case." : "Step not found."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-lg">
      <div className="md:col-span-7 space-y-md">
        <div>
          <span className="font-label-sm text-label-sm text-secondary uppercase tracking-widest font-bold">Action Description</span>
          <p className="font-title-sm text-title-sm mt-xs">{step.instruction}</p>
        </div>
        <div className="grid grid-cols-2 gap-md">
          <div className="bg-surface p-md border border-outline-variant rounded-lg">
            <span className="font-label-sm text-label-sm text-on-surface-variant">Test Data</span>
            <p className="font-body-base text-body-base mt-xs font-medium">
              {step.test_data || <span className="text-on-surface-variant italic">N/A</span>}
            </p>
          </div>
          <div className="bg-surface p-md border border-outline-variant rounded-lg">
            <span className="font-label-sm text-label-sm text-on-surface-variant">Expected Result</span>
            <p className="font-body-base text-body-base mt-xs font-medium">
              {step.expected_result || <span className="text-on-surface-variant italic">N/A</span>}
            </p>
          </div>
        </div>
        {/* Pass/Fail buttons */}
        {readOnly ? (
          <div className="flex gap-md">
            <div className={`flex-1 py-md rounded-xl font-label-md text-label-md font-bold flex items-center justify-center gap-sm ${
              result.passed === true
                ? "bg-green-100 text-green-800 border border-green-300"
                : "bg-surface-container-low text-on-surface-variant border border-outline-variant"
            }`}>
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              Pass
            </div>
            <div className={`flex-1 py-md rounded-xl font-label-md text-label-md font-bold flex items-center justify-center gap-sm ${
              result.passed === false
                ? "bg-red-100 text-red-800 border border-red-300"
                : "bg-surface-container-low text-on-surface-variant border border-outline-variant"
            }`}>
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>cancel</span>
              Fail
            </div>
          </div>
        ) : (
          <div className="flex gap-md">
            <button
              onClick={() => onSubmit(true, result.actual_result, result.comments)}
              className={`flex-1 py-md rounded-xl font-label-md text-label-md font-bold flex items-center justify-center gap-sm transition-all ${
                result.passed === true
                  ? "bg-green-600 text-white shadow-md"
                  : "bg-surface border border-outline-variant text-on-surface hover:bg-green-50 hover:border-green-300"
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              Pass
            </button>
            <button
              onClick={() => onSubmit(false, result.actual_result, result.comments)}
              className={`flex-1 py-md rounded-xl font-label-md text-label-md font-bold flex items-center justify-center gap-sm transition-all ${
                result.passed === false
                  ? "bg-red-600 text-white shadow-md"
                  : "bg-surface border border-outline-variant text-on-surface hover:bg-red-50 hover:border-red-300"
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>cancel</span>
              Fail
            </button>
          </div>
        )}
        <div className="space-y-sm">
          <label className="font-label-md text-label-md text-on-surface">Actual Result</label>
          {readOnly ? (
            <p className="w-full min-h-[6rem] bg-surface-container-low border border-outline-variant rounded-lg p-md font-body-sm text-body-sm">
              {result.actual_result || <span className="text-on-surface-variant italic">No result recorded</span>}
            </p>
          ) : (
            <textarea
              className="w-full h-24 bg-surface border border-outline-variant focus:border-secondary focus:ring-0 rounded-lg p-md font-body-sm text-body-sm resize-none transition-all"
              placeholder="Document any observed deviations or notes here..."
              value={result.actual_result}
              onChange={(e) => onResult({ actual_result: e.target.value })}
            />
          )}
        </div>
        <div className="space-y-sm">
          <label className="font-label-md text-label-md text-on-surface">Comments (optional)</label>
          {readOnly ? (
            <p className="w-full min-h-[5rem] bg-surface-container-low border border-outline-variant rounded-lg p-md font-body-sm text-body-sm">
              {result.comments || <span className="text-on-surface-variant italic">No comments</span>}
            </p>
          ) : (
            <textarea
              className="w-full h-20 bg-surface border border-outline-variant focus:border-secondary focus:ring-0 rounded-lg p-md font-body-sm text-body-sm resize-none transition-all"
              placeholder="Additional notes..."
              value={result.comments}
              onChange={(e) => onResult({ comments: e.target.value })}
            />
          )}
        </div>
      </div>
      <div className="md:col-span-5 space-y-md">
        <div className="aspect-video bg-surface-container rounded-lg border border-outline-variant flex items-center justify-center overflow-hidden relative">
          {proofImage ? (
            <img src={proofImage} alt="Proof" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-xs text-on-surface-variant">
              <span className="material-symbols-outlined text-[48px]">image</span>
              <span className="font-label-sm">Screenshot preview</span>
            </div>
          )}
        </div>
        {!readOnly && (
          <div className="space-y-sm">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              id={`proof-${step.id}`}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onProofUpload(file);
              }}
            />
            <label
              htmlFor={`proof-${step.id}`}
              className="w-full py-md rounded-xl border border-outline-variant hover:bg-surface-container-high flex flex-col items-center justify-center transition-all group cursor-pointer"
            >
              <span className="material-symbols-outlined text-on-surface-variant mb-xs">cloud_upload</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Attach Proof (Image/Logs)</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── Quick Mode ───────── */

function QuickMode({
  steps,
  results,
  readOnly,
  onResult,
  overallResult,
  onOverallResult,
  testerNotes,
  onTesterNotes,
}: {
  steps: TestStep[];
  results: Record<number, { passed: boolean | null; actual_result: string; comments: string }>;
  readOnly?: boolean;
  onResult: (stepId: number, r: { passed?: boolean | null; actual_result?: string; comments?: string }) => void;
  overallResult: string;
  onOverallResult: ((v: string) => void) | undefined;
  testerNotes: string;
  onTesterNotes: ((v: string) => void) | undefined;
}) {
  return (
    <div className="space-y-md">
      <p className="font-label-sm text-label-sm text-on-surface-variant">
        All steps — toggle Pass/Fail for each, then set the overall result below.
      </p>
      {steps.map((step) => {
        const r = results[step.id] ?? { passed: null, actual_result: "", comments: "" };
        return (
          <div key={step.id} className="bg-surface border border-outline-variant rounded-lg p-md">
            <div className="flex items-start justify-between gap-md">
              <div className="flex-1">
                <p className="font-body-sm font-semibold">{step.instruction}</p>
                {step.test_data && (
                  <p className="text-label-sm text-on-surface-variant mt-xs">Data: {step.test_data}</p>
                )}
                {step.expected_result && (
                  <p className="text-label-sm text-on-surface-variant">Expected: {step.expected_result}</p>
                )}
              </div>
              <div className="flex gap-sm shrink-0">
                {readOnly ? (
                  <>
                    <span className={`px-md py-1 rounded-lg text-label-sm font-bold ${
                      r.passed === true
                        ? "bg-green-100 text-green-800 border border-green-300"
                        : "bg-surface-container-low text-on-surface-variant border border-outline-variant"
                    }`}>Pass</span>
                    <span className={`px-md py-1 rounded-lg text-label-sm font-bold ${
                      r.passed === false
                        ? "bg-red-100 text-red-800 border border-red-300"
                        : "bg-surface-container-low text-on-surface-variant border border-outline-variant"
                    }`}>Fail</span>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => onResult(step.id, { passed: true })}
                      className={`px-md py-1 rounded-lg text-label-sm font-bold transition-all ${
                        r.passed === true
                          ? "bg-green-600 text-white"
                          : "bg-surface border border-outline-variant text-on-surface hover:bg-green-50"
                      }`}
                    >
                      Pass
                    </button>
                    <button
                      onClick={() => onResult(step.id, { passed: false })}
                      className={`px-md py-1 rounded-lg text-label-sm font-bold transition-all ${
                        r.passed === false
                          ? "bg-red-600 text-white"
                          : "bg-surface border border-outline-variant text-on-surface hover:bg-red-50"
                      }`}
                    >
                      Fail
                    </button>
                  </>
                )}
              </div>
            </div>
            {r.passed === false && (
              readOnly ? (
                <p className="w-full mt-sm bg-surface-container-low border border-outline-variant rounded p-sm text-body-sm">
                  {r.actual_result || <span className="text-on-surface-variant italic">No result recorded</span>}
                </p>
              ) : (
                <textarea
                  className="w-full mt-sm bg-surface border border-outline-variant rounded p-sm text-body-sm resize-none"
                  rows={2}
                  placeholder="Actual result (required if failed)..."
                  value={r.actual_result}
                  onChange={(e) => onResult(step.id, { actual_result: e.target.value })}
                />
              )
            )}
          </div>
        );
      })}

      <div className="border-t border-outline-variant pt-md space-y-sm">
        <div>
          <label className="font-label-md text-label-md text-on-surface">Overall Result</label>
          {readOnly ? (
            <p className="mt-xs bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm font-body-base">
              {overallResult || <span className="text-on-surface-variant italic">Not set</span>}
            </p>
          ) : (
            <select
              className="w-full mt-xs bg-surface border border-outline-variant rounded-lg px-md py-sm font-body-base"
              value={overallResult}
              onChange={(e) => onOverallResult?.(e.target.value)}
            >
              <option value="">Select result...</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="passed_by_agreement">Passed by Agreement</option>
            </select>
          )}
        </div>
        <div>
          <label className="font-label-md text-label-md text-on-surface">Notes</label>
          {readOnly ? (
            <p className="w-full mt-xs bg-surface-container-low border border-outline-variant rounded-lg p-md font-body-sm text-body-sm">
              {testerNotes || <span className="text-on-surface-variant italic">No notes</span>}
            </p>
          ) : (
            <textarea
              className="w-full mt-xs bg-surface border border-outline-variant rounded-lg p-md font-body-sm text-body-sm resize-none"
              rows={3}
              placeholder="Execution notes..."
              value={testerNotes}
              onChange={(e) => onTesterNotes?.(e.target.value)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
