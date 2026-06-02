import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "../lib/api-client";

interface ReportTestCase {
  id: number;
  case_number: string;
  title: string;
  test_type: string | null;
  estimated_minutes: number | null;
  steps?: Array<{
    id: number;
    step_number: string;
    instruction: string;
    expected_result: string | null;
  }>;
}

interface ReportUseCase {
  id: number;
  code: string;
  name: string;
  priority: string | null;
  testCases?: ReportTestCase[];
}

interface ReportTestRunUseCase {
  id: number;
  status: string;
  useCase?: ReportUseCase;
  tester?: { id: number; name: string | null };
}

interface FullReport {
  id: number;
  name: string;
  status: string;
  scheduled_at: string | null;
  entry_confirmed: boolean | null;
  entry_confirmed_at: string | null;
  useCases?: ReportTestRunUseCase[];
  executions: Array<{
    id: number;
    test_case_id: number;
    testCase?: { id: number; title: string; case_number: string; test_type: string | null; estimated_minutes: number | null };
    stepResults: Array<{ id: number; step_id: number; actual_result: string | null; comments: string | null; passed: boolean | null }>;
    overall_result: "passed" | "failed" | "passed_by_agreement" | null;
  }>;
  defects: Array<{ id: number; test_case_id: number; severity: string | null; priority: string | null; status: string }>;
}

const resultColors: Record<string, string> = {
  passed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  passed_by_agreement: "bg-purple-100 text-purple-800",
  pending: "bg-surface-container-high text-on-surface-variant",
  in_progress: "bg-amber-100 text-amber-800",
};

export function TestRunReportPage({ params }: { params: { runId: string } }) {
  const runId = Number(params.runId);

  useEffect(() => { document.title = "Run Report | TestCaseHub"; }, []);

  const { data: report, isLoading } = useQuery({
    queryKey: ["test-run-report", runId],
    queryFn: () => customFetch<FullReport>(`/test-runs/${runId}/full-report`),
    enabled: !!runId,
  });

  if (isLoading) {
    return (
      <div className="space-y-lg animate-pulse">
        <div className="w-1/2 h-8 skeleton rounded" />
        <div className="w-full h-64 skeleton rounded-xl" />
      </div>
    );
  }

  if (!report) {
    return <div className="text-on-surface-variant">Report not found.</div>;
  }

  return (
    <div className="space-y-lg report-page">
      <div className="flex justify-end no-print">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-sm bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md hover:brightness-110"
        >
          <span className="material-symbols-outlined text-sm">print</span>
          Print Report
        </button>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg print-container">
        <header className="border-b border-outline-variant pb-md mb-lg">
          <h1 className="font-display-lg text-display-lg text-primary">Test Run Execution Report</h1>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-md mt-md text-sm">
            <div>
              <p className="text-xs uppercase text-on-surface-variant">Run Name</p>
              <p className="font-bold">{report.name}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-on-surface-variant">Status</p>
              <p className="font-bold">{report.status}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-on-surface-variant">Scheduled</p>
              <p className="font-bold">{report.scheduled_at ? new Date(report.scheduled_at).toLocaleString() : "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-on-surface-variant">Entry Confirmed</p>
              <p className="font-bold">{report.entry_confirmed ? `Yes — ${report.entry_confirmed_at ? new Date(report.entry_confirmed_at).toLocaleString() : ""}` : "No"}</p>
            </div>
          </div>
        </header>

        <section className="space-y-lg">
          {report.useCases?.map((uc) => {
            const executions = report.executions?.filter((e) => uc.useCase?.testCases?.some((tc) => tc.id === e.test_case_id)) ?? [];
            return (
              <div key={uc.id} className="border border-outline-variant rounded-lg overflow-hidden">
                <div className="bg-surface-container-low p-md flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-secondary uppercase">{uc.useCase?.code}</span>
                    <h2 className="font-title-sm text-title-sm">{uc.useCase?.name}</h2>
                    <p className="text-xs text-on-surface-variant">Priority: {uc.useCase?.priority ?? "—"} • Assigned: {uc.tester?.name ?? "—"}</p>
                  </div>
                  <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${resultColors[uc.status] ?? ""}`}>{uc.status.replace(/_/g, " ")}</span>
                </div>
                <div className="divide-y divide-outline-variant">
                  {uc.useCase?.testCases?.map((tc) => {
                    const execution = executions.find((e) => e.test_case_id === tc.id);
                    return (
                      <div key={tc.id} className="p-md">
                        <div className="flex items-center justify-between mb-sm">
                          <h3 className="font-label-md text-label-md font-bold">[{tc.case_number}] {tc.title}</h3>
                          <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${resultColors[execution?.overall_result ?? "pending"] ?? ""}`}>
                            {execution?.overall_result?.replace(/_/g, " ") ?? "Not Executed"}
                          </span>
                        </div>
                        <table className="w-full text-xs mt-sm">
                          <thead className="bg-surface-container-lowest text-on-surface-variant">
                            <tr>
                              <th className="text-left p-xs">Step</th>
                              <th className="text-left p-xs">Instruction</th>
                              <th className="text-left p-xs">Expected</th>
                              <th className="text-left p-xs">Actual</th>
                              <th className="text-left p-xs">Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tc.steps?.map((s) => {
                              const sr = execution?.stepResults?.find((r) => r.step_id === s.id);
                              return (
                                <tr key={s.id} className="border-t border-outline-variant">
                                  <td className="p-xs font-mono">{s.step_number}</td>
                                  <td className="p-xs">{s.instruction}</td>
                                  <td className="p-xs text-on-surface-variant">{s.expected_result ?? "—"}</td>
                                  <td className="p-xs">{sr?.actual_result ?? "—"}</td>
                                  <td className="p-xs">
                                    {sr?.passed === true && <span className="text-green-700 font-bold">PASS</span>}
                                    {sr?.passed === false && <span className="text-red-700 font-bold">FAIL</span>}
                                    {sr?.passed == null && "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <section className="mt-lg">
          <h2 className="font-title-sm text-title-sm mb-md">Defects</h2>
          {report.defects?.length ? (
            <table className="w-full text-sm">
              <thead className="bg-surface-container-low">
                <tr>
                  <th className="text-left p-xs">ID</th>
                  <th className="text-left p-xs">Severity</th>
                  <th className="text-left p-xs">Priority</th>
                  <th className="text-left p-xs">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.defects.map((d) => (
                  <tr key={d.id} className="border-t border-outline-variant">
                    <td className="p-xs font-bold">DEF-{d.id}</td>
                    <td className="p-xs">{d.severity ?? "—"}</td>
                    <td className="p-xs">{d.priority ?? "—"}</td>
                    <td className="p-xs">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-on-surface-variant text-sm">No defects raised in this run.</p>
          )}
        </section>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-container { border: none !important; box-shadow: none !important; }
          .report-page { background: white !important; }
        }
      `}</style>
    </div>
  );
}
