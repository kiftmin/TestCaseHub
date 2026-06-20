import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useProjectRole } from "../hooks/useProjectRole";
import { SignOffCertificatePDF } from "../lib/pdf-documents";
import type { Project, SignOffData, Defect, StatusAuditLog } from "../types/api";

export function SignOffCertificatePage({ params }: { params: { id: string } }) {
  const projectId = Number(params.id);
  const user = getStoredUser();
  const role = useProjectRole(projectId);
  const queryClient = useQueryClient();
  useEffect(() => { document.title = "Sign-off | TestCaseHub"; }, []);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => customFetch<Project>(`/projects/${projectId}`),
  });

  const { data: uatSummary } = useQuery({
    queryKey: ["uat-summary", projectId],
    queryFn: () => customFetch<{
      totalScenarios: number;
      totalTestRuns: number;
      passRate: number;
      defectsByStatus: Record<string, number>;
      defectsBySeverity: Record<string, number>;
    }>(`/projects/${projectId}/uat-summary`),
  });

  const { data: signOff } = useQuery({
    queryKey: ["sign-off", projectId],
    queryFn: () => customFetch<{ is_signed_off: number; sign_off_data: string }>(`/projects/${projectId}/sign-off-status`),
  });

  const isFullySigned = signOff?.is_signed_off === 1;
  let signOffData: SignOffData = {};
  try {
    if (signOff?.sign_off_data) signOffData = JSON.parse(signOff.sign_off_data);
  } catch { /* ignore */ }

  const canSignTL = role === "TEST_LEAD" || user?.role === "ADMIN";
  const canSignBO = role === "BUSINESS_OWNER" || user?.role === "ADMIN";

  const tlSigned = !!signOffData.testLead;
  const boSigned = !!signOffData.businessOwner;
  const collected = [tlSigned, boSigned].filter(Boolean).length;

  const fetchBusinessDecisions = async () => {
    const defects = await customFetch<Defect[]>(`/projects/${projectId}/defects`);
    const accepted: SignOffData["businessDecisions"]["accepted"] = [];
    const rejected: SignOffData["businessDecisions"]["rejected"] = [];

    for (const defect of defects) {
      if (defect.status === "PASSED_BY_AGREEMENT" && defect.accepted_by_business_note) {
        const auditLog = await customFetch<StatusAuditLog[]>(
          `/projects/${projectId}/audit-log?entityType=defect&entityId=${defect.id}`
        );

        const acceptanceEntry = auditLog.find(
          (e) => e.from_status === "PENDING_BIZ_ACCEPTANCE" && e.to_status === "PASSED_BY_AGREEMENT"
        );
        const submissionEntry = auditLog.find((e) => e.to_status === "PENDING_BIZ_ACCEPTANCE");

        if (submissionEntry && acceptanceEntry) {
          const reason = submissionEntry.reason || "";
          const decisionType = reason.startsWith("[RISK WAIVER]") ? ("risk_waiver" as const) : ("business_review" as const);
          const justification = reason.replace(/^\[(RISK WAIVER|BUSINESS REVIEW)\]\s*/, "");
          const changedBy = (submissionEntry as any).changedBy;
          const acceptedBy = (acceptanceEntry as any).changedBy;

          accepted.push({
            defectId: defect.id,
            bugNumber: defect.bug_number ?? undefined,
            severity: defect.severity || "Unknown",
            justification,
            submittedBy: changedBy?.name || `User #${submissionEntry.changed_by_user_id}`,
            submittedAt: submissionEntry.changed_at,
            acceptedBy: acceptedBy?.name || `User #${acceptanceEntry.changed_by_user_id}`,
            acceptedAt: acceptanceEntry.changed_at,
            decisionType,
            testCaseName: defect.testCase?.title,
          });
        }
      }
    }

    return {
      count: accepted.length + rejected.length,
      accepted,
      rejected,
    };
  };

  const signMut = useMutation({
    mutationFn: async (data: { name: string; role: string; signature: string }) => {
      const businessDecisions = await fetchBusinessDecisions();
      return customFetch(`/projects/${projectId}/sign-off`, {
        method: "POST",
        body: JSON.stringify({ ...data, businessDecisions }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sign-off", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Signature recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-lg animate-pulse">
        <div className="w-1/2 h-8 skeleton rounded" />
        <div className="w-full h-64 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-lg sign-off-page">
      {/* PDF Export */}
      <div className="flex justify-end no-print">
        <PDFDownloadLink
          document={
            <SignOffCertificatePDF
              projectName={project?.name ?? ""}
              projectCode={project?.project_code ?? ""}
              moduleName={project?.module_name ?? ""}
              version={project?.version ?? ""}
              scope={project?.scope ?? ""}
              objectives={project?.objectives ?? ""}
              outOfScope={project?.out_of_scope ?? ""}
              entryCriteria={project?.entry_criteria ?? ""}
              exitCriteria={project?.exit_criteria ?? ""}
              totalTestRuns={uatSummary?.totalTestRuns ?? 0}
              totalScenarios={uatSummary?.totalScenarios ?? 0}
              passRate={uatSummary?.passRate ?? 0}
              acceptedCount={signOffData?.businessDecisions?.accepted?.length ?? 0}
              tlSigned={tlSigned}
              tlName={signOffData?.testLead?.name ?? ""}
              tlDate={signOffData?.testLead?.date ?? ""}
              boSigned={boSigned}
              boName={signOffData?.businessOwner?.name ?? ""}
              boDate={signOffData?.businessOwner?.date ?? ""}
              businessDecisions={signOffData?.businessDecisions}
              isFullySigned={isFullySigned}
            />
          }
          fileName={`sign-off-certificate-${project?.project_code ?? "export"}.pdf`}
          className="flex items-center gap-sm bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md hover:brightness-110 transition-all"
        >
          {({ loading }) => (
            <>
              <span className="material-symbols-outlined text-sm">file_download</span>
              {loading ? "Preparing Certificate..." : "Download Certificate (PDF)"}
            </>
          )}
        </PDFDownloadLink>
      </div>

      {/* Certificate */}
      <div className="bg-white border border-gray-200 shadow-sm relative overflow-hidden p-12 md:p-16">
        <div className="hidden">CERTIFIED</div>

        {/* 1. Header */}
        <div className="flex flex-col md:flex-row justify-between items-start border-b border-outline-variant pb-lg mb-xl">
          <div className="mb-md md:mb-0">
            <h1 className="font-display-lg text-display-lg text-primary mb-xs">UAT Sign-Off Certificate</h1>
            <p className="text-secondary font-semibold font-label-md text-label-md tracking-wider">
              {project?.name?.toUpperCase()} &bull; {project?.module_name?.toUpperCase()}
            </p>
          </div>
          <div className="text-right space-y-1">
            <div className="text-on-surface-variant font-label-sm text-label-sm uppercase tracking-tighter">Document ID</div>
            <div className="font-mono font-bold text-on-surface">UCH-{project?.project_code}</div>
            <div className="text-on-surface-variant font-label-sm text-label-sm uppercase tracking-tighter mt-sm">Release Version</div>
            <div className="font-bold text-on-surface">v{project?.version}</div>
          </div>
        </div>

        {/* 2. Objectives & Scope */}
        <section className="mb-xl">
          <h2 className="font-title-sm text-title-sm text-primary mb-md flex items-center gap-sm">
            <span className="material-symbols-outlined text-secondary">target</span>
            Objectives &amp; Scope
          </h2>
          <div className="grid md:grid-cols-2 gap-lg">
            <div className="bg-surface-container-low p-md rounded-lg">
              <h3 className="font-label-md text-label-md font-bold mb-xs">Scope</h3>
              <p className="text-body-sm text-body-sm leading-relaxed">{project?.scope ?? "Not specified"}</p>
            </div>
            <div className="space-y-md">
              <h3 className="font-label-md text-label-md font-bold mb-xs">Objectives</h3>
              <p className="text-body-sm text-body-sm text-on-surface-variant leading-relaxed">
                {project?.objectives ?? "Not specified"}
              </p>
            </div>
          </div>
        </section>

        {/* 3. Out of Scope */}
        <section className="mb-xl">
          <h2 className="font-title-sm text-title-sm text-primary mb-md flex items-center gap-sm">
            <span className="material-symbols-outlined text-outline">visibility_off</span>
            Out of Scope
          </h2>
          <div className="border border-outline-variant p-md rounded-lg bg-surface-bright">
            <p className="text-body-sm text-body-sm text-on-surface-variant">
              {project?.out_of_scope ?? "Not specified"}
            </p>
          </div>
        </section>

        {/* 4. Entry & Exit Criteria */}
        <section className="mb-xl">
          <div className="grid md:grid-cols-2 gap-xl">
            <div>
              <h2 className="font-label-md text-label-md font-bold text-primary mb-sm uppercase tracking-widest">Entry Criteria</h2>
              <div className="border border-outline-variant p-md rounded-lg">
                <p className="text-body-sm text-body-sm">{project?.entry_criteria ?? "Not specified"}</p>
              </div>
            </div>
            <div>
              <h2 className="font-label-md text-label-md font-bold text-primary mb-sm uppercase tracking-widest">Exit Criteria</h2>
              <div className="border border-outline-variant p-md rounded-lg">
                <p className="text-body-sm text-body-sm">{project?.exit_criteria ?? "Not specified"}</p>
              </div>
            </div>
          </div>
        </section>

        {/* 4.5 Executive Metrics */}
        <section className="mb-xl">
          <h2 className="font-title-sm text-title-sm text-primary mb-md flex items-center gap-sm">
            <span className="material-symbols-outlined text-secondary">insights</span>
            Executive Summary
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-md">
            <div className="bg-surface-container-low p-md rounded-lg text-center">
              <div className="text-display-lg-mobile font-bold text-primary">{uatSummary?.totalTestRuns ?? 0}</div>
              <div className="text-label-sm text-on-surface-variant">Test Runs Executed</div>
            </div>
            <div className="bg-surface-container-low p-md rounded-lg text-center">
              <div className="text-display-lg-mobile font-bold text-green-700">{uatSummary?.totalScenarios ?? 0}</div>
              <div className="text-label-sm text-on-surface-variant">Total Scenarios</div>
            </div>
            <div className="bg-surface-container-low p-md rounded-lg text-center">
              <div className="text-display-lg-mobile font-bold text-primary">{uatSummary?.passRate ?? 0}%</div>
              <div className="text-label-sm text-on-surface-variant">Pass Rate</div>
            </div>
            <div className="bg-surface-container-low p-md rounded-lg text-center">
              <div className="text-display-lg-mobile font-bold text-amber-700">
                {signOffData?.businessDecisions?.accepted?.length ?? 0}
              </div>
              <div className="text-label-sm text-on-surface-variant">Accepted / Waived</div>
            </div>
          </div>
        </section>

        {/* 5. Dual Signature Section */}
        <section className="mb-xl grid md:grid-cols-2 gap-lg sign-off-signatures">
          {/* Test Lead Signature */}
          <div className={`relative p-lg border-2 rounded-xl transition-all ${
            tlSigned
              ? "border-outline-variant bg-surface-container-lowest"
              : "border-dashed border-outline-variant bg-surface-container-lowest"
          }`}>
            {tlSigned && (
              <div className="absolute top-2 right-2 rotate-12 border-4 border-secondary text-secondary font-bold px-md py-sm rounded-lg opacity-80 select-none">
                SIGNED
              </div>
            )}
            <div className="mb-lg">
              <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-xs">Test Lead Approval</div>
              {tlSigned ? (
                <div className="italic font-serif text-display-lg-mobile text-primary opacity-60">{signOffData.testLead!.name}</div>
              ) : (
                <div className="flex items-center justify-center h-16 border-b border-on-surface">
                  <span className="text-on-surface-variant font-label-md text-label-md">Awaiting signature</span>
                </div>
              )}
              <div className="h-px bg-on-surface w-full mt-xs" />
            </div>
            {tlSigned ? (
              <div className="flex justify-between items-end">
                <div>
                  <div className="font-label-md text-label-md font-bold">{signOffData.testLead!.name}</div>
                  <div className="text-body-sm text-body-sm text-on-surface-variant">{signOffData.testLead!.role}</div>
                </div>
                <div className="text-right">
                  <div className="text-body-sm text-body-sm text-on-surface-variant">Signed On</div>
                  <div className="font-label-md text-label-md">{new Date(signOffData.testLead!.date).toLocaleDateString()}</div>
                </div>
              </div>
            ) : canSignTL ? (
              <SignForm
                roleLabel="Test Lead"
                onSave={(data) => signMut.mutate(data)}
                loading={signMut.isPending}
              />
            ) : (
              <p className="text-body-sm text-on-surface-variant italic">Awaiting Test Lead signature</p>
            )}
          </div>

          {/* Business Owner Signature */}
          <div className={`relative p-lg border-2 rounded-xl transition-all ${
            boSigned
              ? "border-outline-variant bg-surface-container-lowest"
              : "border-secondary bg-secondary-container/5"
          }`}>
            {boSigned && (
              <div className="absolute top-2 right-2 rotate-12 border-4 border-secondary text-secondary font-bold px-md py-sm rounded-lg opacity-80 select-none">
                SIGNED
              </div>
            )}
            <div className="mb-lg">
              <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-xs">Business Owner Approval</div>
              {boSigned ? (
                <div className="italic font-serif text-display-lg-mobile text-primary opacity-60">{signOffData.businessOwner!.name}</div>
              ) : (
                <div className="flex items-center justify-center h-16 border-b border-on-surface">
                  <span className="text-on-surface-variant font-label-md text-label-md">Awaiting signature</span>
                </div>
              )}
              <div className="h-px bg-on-surface w-full mt-xs" />
            </div>
            {boSigned ? (
              <div className="flex justify-between items-end">
                <div>
                  <div className="font-label-md text-label-md font-bold">{signOffData.businessOwner!.name}</div>
                  <div className="text-body-sm text-body-sm text-on-surface-variant">{signOffData.businessOwner!.role}</div>
                </div>
                <div className="text-right">
                  <div className="text-body-sm text-body-sm text-on-surface-variant">Signed On</div>
                  <div className="font-label-md text-label-md">{new Date(signOffData.businessOwner!.date).toLocaleDateString()}</div>
                </div>
              </div>
            ) : canSignBO ? (
              <SignForm
                roleLabel="Business Owner"
                onSave={(data) => signMut.mutate(data)}
                loading={signMut.isPending}
              />
            ) : (
              <p className="text-body-sm text-on-surface-variant italic">Awaiting Business Owner signature</p>
            )}
          </div>
        </section>

        {/* 6. Business Decisions & Risk Waivers */}
        {signOffData?.businessDecisions && signOffData.businessDecisions.count > 0 && (
          <section className="mb-xl">
            <h2 className="font-title-sm text-title-sm text-primary mb-md flex items-center gap-sm">
              <span className="material-symbols-outlined text-secondary">gavel</span>
              Business Decisions &amp; Risk Waivers
            </h2>

            {signOffData.businessDecisions.accepted.length > 0 && (
              <div className="mb-lg">
                <h3 className="font-label-md text-label-md font-bold text-green-700 mb-md">Accepted Decisions</h3>
                <div className="space-y-md">
                  {signOffData.businessDecisions.accepted.map((decision) => (
                    <div key={decision.defectId} className="border border-green-300 bg-green-50 rounded-lg p-md">
                      <div className="grid grid-cols-2 gap-md mb-sm">
                        <div>
                          <p className="text-xs font-semibold text-outline uppercase">Defect ID</p>
                          <p className="font-label-md text-label-md font-bold">DEF-{decision.defectId}{decision.bugNumber ? ` (BUG-${decision.bugNumber})` : ""}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-outline uppercase">Type</p>
                          <p className="font-label-md text-label-md font-bold flex items-center gap-1">
                            <span>{decision.decisionType === "risk_waiver" ? "⚠️" : "📋"}</span>
                            {decision.decisionType === "risk_waiver" ? "Risk Waiver" : "Business Review"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-outline uppercase">Severity</p>
                          <p className="font-label-md text-label-md font-bold">{decision.severity}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-outline uppercase">Test Case</p>
                          <p className="text-body-sm text-body-sm">{decision.testCaseName || "N/A"}</p>
                        </div>
                      </div>
                      <div className="bg-white p-sm rounded border border-green-200 mb-sm">
                        <p className="text-xs font-semibold text-outline uppercase mb-xs">Justification</p>
                        <p className="text-body-sm text-body-sm whitespace-pre-wrap">{decision.justification}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-md text-body-sm text-body-sm">
                        <div>
                          <p className="font-semibold text-on-surface-variant">Submitted By</p>
                          <p className="text-on-surface">{decision.submittedBy}</p>
                          <p className="text-xs text-on-surface-variant">{new Date(decision.submittedAt).toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-on-surface-variant">Approved By</p>
                          <p className="text-on-surface">{decision.acceptedBy}</p>
                          <p className="text-xs text-on-surface-variant">{new Date(decision.acceptedAt).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-lg text-body-sm text-body-sm text-on-surface-variant italic">
              All business decisions are immutably recorded in the project audit log and are subject to governance review.
            </p>
          </section>
        )}

        {/* 7. Certificate Status Banner */}
        <footer className={`p-md rounded-lg flex flex-col md:flex-row justify-between items-center gap-md ${
          isFullySigned ? "bg-primary text-white" : "bg-amber-500 text-white"
        }`}>
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-secondary-fixed">verified_user</span>
            <span className="font-label-md text-label-md uppercase tracking-widest">
              {isFullySigned
                ? "Document Status: FULLY SIGNED OFF"
                : `Document Status: AWAITING SIGNATURES — ${collected} of 2 signatures collected`}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SignForm({
  roleLabel,
  onSave,
  loading,
}: {
  roleLabel: string;
  onSave: (data: { name: string; role: string; signature: string }) => void;
  loading: boolean;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [signature, setSignature] = useState("");
  const user = getStoredUser();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: name.trim() || user?.username || "",
          role: role.trim() || roleLabel,
          signature: signature.trim() || user?.username || "",
        });
      }}
      className="space-y-md mt-md"
    >
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm text-on-surface-variant">Full Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm"
          placeholder={user?.username ?? ""}
        />
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm text-on-surface-variant">Role / Title</label>
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full bg-surface border border-outline-variant rounded-lg p-2 text-sm"
          placeholder={roleLabel}
        />
      </div>
      <div className="space-y-sm">
        <label className="font-label-sm text-label-sm text-on-surface-variant">Signature (type your name)</label>
        <textarea
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          className="w-full h-16 bg-surface border border-outline-variant rounded-lg p-2 text-sm resize-none font-serif italic"
          placeholder="Type your full name as signature..."
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 disabled:opacity-50"
      >
        {loading ? "Signing..." : `Sign as ${roleLabel}`}
      </button>
    </form>
  );
}
