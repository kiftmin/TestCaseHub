import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "../lib/api-client";
import type { TestRun } from "../types/api";

const statusColors: Record<string, string> = {
  pending: "bg-surface-container-high text-on-surface-variant",
  in_progress: "bg-amber-100 text-amber-800",
  passed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  passed_by_agreement: "bg-purple-100 text-purple-800",
};

export function TesterScenarioPage({ params }: { params: { testRunId: string } }) {
  const [, navigate] = useLocation();
  const testRunId = Number(params.testRunId);

  useEffect(() => { document.title = "Scenarios | TestCaseHub"; }, []);

  const { data: testRun } = useQuery({
    queryKey: ["test-run", testRunId],
    queryFn: () => customFetch<TestRun>(`/test-runs/${testRunId}`),
    enabled: !!testRunId,
  });

  const useCases = testRun?.useCases ?? [];

  const isBlocked = !!testRun && !testRun.entry_confirmed;

  const summary = useMemo(() => {
    const total = useCases.length;
    const done = useCases.filter((uc) => uc.status === "passed" || uc.status === "passed_by_agreement" || uc.status === "failed").length;
    return { total, done };
  }, [useCases]);

  if (isBlocked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface p-lg text-center">
        <span className="material-symbols-outlined text-error text-5xl mb-md">lock</span>
        <h1 className="font-title-md text-title-md text-on-surface mb-sm">Test run not cleared</h1>
        <p className="font-body-base text-on-surface-variant">This test run has not been cleared to start. Contact your Test Lead.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-primary text-on-primary px-md py-sm flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined">fact_check</span>
          <h1 className="font-title-md text-title-md">TestCaseHub</h1>
        </div>
        <button onClick={() => navigate("/tester")} className="font-label-sm text-label-sm opacity-80 hover:opacity-100">
          ← My Runs
        </button>
      </header>

      <div className="flex-1 p-md max-w-[480px] w-full mx-auto space-y-md">
        <section className="bg-surface-container-lowest p-md rounded-xl border border-outline-variant">
          <h2 className="font-title-sm text-title-sm mb-xs">{testRun?.name ?? "Test Run"}</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant mb-sm">
            {testRun?.project?.name ?? ""}
          </p>
          <div className="flex justify-between text-label-sm text-label-sm">
            <span>Progress</span>
            <span className="font-bold text-primary">{summary.done} / {summary.total} scenarios</span>
          </div>
        </section>

        <h3 className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant px-xs">
          Test Scenarios
        </h3>

        <div className="space-y-sm">
          {useCases.map((uc) => {
            const ucDone = uc.status === "passed" || uc.status === "passed_by_agreement" || uc.status === "failed";
            return (
              <button
                key={uc.id}
                onClick={() => navigate(`/tester/run/${testRunId}/scenario/${uc.use_case_id}`)}
                className="w-full text-left bg-surface-container-lowest border border-outline-variant rounded-xl p-md hover:shadow-md transition-shadow flex items-center gap-md"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-sm mb-xs">
                    <span className="font-label-sm text-label-sm font-bold text-secondary">{uc.useCase?.code ?? `#${uc.use_case_id}`}</span>
                    {uc.useCase?.priority && (
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        uc.useCase.priority === "Critical" ? "bg-error-container text-error" :
                        uc.useCase.priority === "High" ? "bg-orange-100 text-orange-800" :
                        uc.useCase.priority === "Medium" ? "bg-blue-100 text-blue-800" :
                        "bg-surface-container text-on-surface-variant"
                      }`}>{uc.useCase.priority}</span>
                    )}
                  </div>
                  <p className="font-label-md text-label-md text-on-surface">{uc.useCase?.name ?? `Scenario #${uc.use_case_id}`}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${statusColors[uc.status] ?? ""}`}>
                  {uc.status.replace(/_/g, " ")}
                </span>
                {ucDone ? (
                  <span className="material-symbols-outlined text-green-600" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                ) : (
                  <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
                )}
              </button>
            );
          })}

          {useCases.length === 0 && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg text-center text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl mb-md block">inbox</span>
              <p className="font-body-sm">No test scenarios assigned to you in this run.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
