import { useState, useEffect, useRef, useCallback, type MouseEvent, type TouchEvent, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useProjectRole } from "../hooks/useProjectRole";
import { SignOffCertificatePDF } from "../lib/pdf-documents";
import type { Project, SignOffData, Defect, StatusAuditLog } from "../types/api";

const MAX_SIGNATURE_BYTES = 400_000; // ~300KB image after base64 expansion

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
      openDefects?: number;
      openBySeverity?: Record<string, number>;
      acceptedByAgreement?: number;
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

  const isAdminViewer = user?.role === "ADMIN";
  const canSignTL = role === "TEST_LEAD";
  const canSignBO = role === "BUSINESS_OWNER";

  const tlSigned = !!signOffData.testLead;
  const boSigned = !!signOffData.businessOwner;
  const collected = [tlSigned, boSigned].filter(Boolean).length;

  const openDefects =
    uatSummary?.openDefects ??
    (uatSummary?.defectsByStatus
      ? Object.entries(uatSummary.defectsByStatus)
          .filter(([status]) => !["CLOSED", "PASSED_BY_AGREEMENT", "REJECTED", "DUPLICATE"].includes(status))
          .reduce((sum, [, n]) => sum + n, 0)
      : 0);

  const openBySeverity = uatSummary?.openBySeverity ?? {};
  const acceptedCount =
    signOffData?.businessDecisions?.accepted?.length ??
    uatSummary?.acceptedByAgreement ??
    0;
  const hasConditions = openDefects > 0 || acceptedCount > 0;

  const severityOrder = ["Critical", "Major", "Minor", "Cosmetic", "Unspecified"];
  const severityRows = [
    ...severityOrder
      .filter((s) => (openBySeverity[s] ?? 0) > 0)
      .map((s) => ({ severity: s, count: openBySeverity[s] ?? 0 })),
    ...Object.entries(openBySeverity)
      .filter(([s, n]) => !severityOrder.includes(s) && n > 0)
      .map(([severity, count]) => ({ severity, count })),
  ];

  const exitCriteriaStatus = isFullySigned
    ? hasConditions
      ? "Met with conditions"
      : "Met"
    : "Subject to confirmation by authorised signatories";

  const recommendation = isFullySigned
    ? hasConditions
      ? "Accepted with conditions — residual risks and/or open defects are recorded below and in Annex A where applicable."
      : "Accepted — UAT exit criteria confirmed; no open defects or residual waivers at sign-off."
    : "Pending — formal acceptance requires authorised Business Owner and QA / Test Lead signatures.";

  const fetchBusinessDecisions = async () => {
    const defects = await customFetch<Defect[]>(`/projects/${projectId}/defects`);
    const accepted: NonNullable<SignOffData["businessDecisions"]>["accepted"] = [];
    const rejected: NonNullable<SignOffData["businessDecisions"]>["rejected"] = [];

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
          const changedBy = (submissionEntry as { changedBy?: { name?: string } }).changedBy;
          const acceptedBy = (acceptanceEntry as { changedBy?: { name?: string } }).changedBy;

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
    mutationFn: async (data: { name: string; role: string; signature: string; signatureImage?: string }) => {
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

  const pdfDoc = (
    <SignOffCertificatePDF
      projectName={project?.name ?? ""}
      projectCode={project?.project_code ?? ""}
      moduleName={project?.module_name ?? ""}
      version={project?.version != null ? String(project.version) : ""}
      scope={project?.scope ?? ""}
      objectives={project?.objectives ?? ""}
      outOfScope={project?.out_of_scope ?? ""}
      entryCriteria={project?.entry_criteria ?? ""}
      exitCriteria={project?.exit_criteria ?? ""}
      designedBy={project?.designed_by ?? ""}
      designDate={project?.design_date ?? ""}
      openDefects={openDefects}
      openBySeverity={openBySeverity}
      acceptedCount={acceptedCount}
      recommendation={recommendation}
      exitCriteriaStatus={exitCriteriaStatus}
      tlSigned={tlSigned}
      tlName={signOffData?.testLead?.name ?? ""}
      tlRole={signOffData?.testLead?.role ?? ""}
      tlDate={signOffData?.testLead?.date ?? ""}
      tlSignature={signOffData?.testLead?.signature ?? ""}
      tlSignatureImage={signOffData?.testLead?.signatureImage}
      boSigned={boSigned}
      boName={signOffData?.businessOwner?.name ?? ""}
      boRole={signOffData?.businessOwner?.role ?? ""}
      boDate={signOffData?.businessOwner?.date ?? ""}
      boSignature={signOffData?.businessOwner?.signature ?? ""}
      boSignatureImage={signOffData?.businessOwner?.signatureImage}
      businessDecisions={signOffData?.businessDecisions}
      isFullySigned={isFullySigned}
    />
  );

  return (
    <div className="space-y-lg sign-off-page max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-md no-print">
        <div>
          <p className="text-label-sm text-on-surface-variant uppercase tracking-widest mb-xs">User Acceptance Testing</p>
          <h1 className="font-display-lg text-display-lg text-primary">Final Sign-Off Certificate</h1>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Formal business acceptance for production readiness decisions
          </p>
        </div>
        <PDFDownloadLink
          document={pdfDoc}
          fileName={`UAT-Sign-Off-${project?.project_code ?? "export"}.pdf`}
          className="inline-flex items-center justify-center gap-sm bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md hover:brightness-110 transition-all shrink-0"
        >
          {({ loading }) => (
            <>
              <span className="material-symbols-outlined text-sm">picture_as_pdf</span>
              {loading ? "Preparing PDF…" : "Download PDF"}
            </>
          )}
        </PDFDownloadLink>
      </div>

      {/* Certificate body */}
      <div className="bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="h-1.5 bg-[#1a2744]" />

        <div className="p-8 md:p-12">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between gap-lg border-b-2 border-[#1a2744] pb-lg mb-xl">
            <div>
              <p className="text-[11px] uppercase tracking-[0.15em] text-on-surface-variant mb-1">Document</p>
              <h2 className="text-2xl font-bold text-[#1a2744] tracking-tight">Final Sign-Off Certificate</h2>
              <p className="text-sm text-on-surface-variant mt-1">
                Formal acceptance of UAT deliverables
              </p>
            </div>
            <div className="text-left md:text-right space-y-2 min-w-[10rem]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-on-surface-variant">Document ID</div>
                <div className="font-mono font-semibold text-on-surface">UCH-{project?.project_code}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-on-surface-variant">Release / Version</div>
                <div className="font-semibold text-on-surface">v{project?.version ?? "—"}</div>
              </div>
            </div>
          </div>

          {/* 1. Project identification */}
          <section className="mb-xl">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#1a2744] border-b border-outline-variant pb-1 mb-md">
              1. Project Identification
            </h3>
            <div className="grid md:grid-cols-2 gap-md">
              <InfoCell label="Project / Application" value={project?.name} />
              <InfoCell label="Module / Workstream" value={project?.module_name} />
              <InfoCell label="Prepared By" value={project?.designed_by} />
              <InfoCell
                label="Design / Plan Date"
                value={project?.design_date ? new Date(project.design_date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null}
              />
            </div>
          </section>

          {/* 2. Scope */}
          <section className="mb-xl">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#1a2744] border-b border-outline-variant pb-1 mb-md">
              2. Scope of Acceptance
            </h3>
            <div className="grid md:grid-cols-2 gap-md mb-md">
              <InfoCell label="In Scope" value={project?.scope} multiline />
              <InfoCell label="Out of Scope" value={project?.out_of_scope} multiline />
            </div>
            {(project?.objectives || project?.entry_criteria || project?.exit_criteria) && (
              <div className="space-y-sm text-sm text-on-surface-variant">
                {project?.objectives && (
                  <p><span className="font-semibold text-on-surface">Objectives: </span>{project.objectives}</p>
                )}
                {project?.entry_criteria && (
                  <p><span className="font-semibold text-on-surface">Entry criteria: </span>{project.entry_criteria}</p>
                )}
                {project?.exit_criteria && (
                  <p><span className="font-semibold text-on-surface">Exit criteria: </span>{project.exit_criteria}</p>
                )}
              </div>
            )}
          </section>

          {/* 3. Decision-oriented outcome — exit criteria, residual risk, recommendation */}
          <section className="mb-xl">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#1a2744] border-b border-outline-variant pb-1 mb-md">
              3. Exit Criteria, Residual Risk &amp; Recommendation
            </h3>

            <div className="border border-outline-variant bg-slate-50/80 p-md rounded-sm mb-md">
              <div className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">
                Exit criteria (from approved UAT plan)
              </div>
              <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">
                {project?.exit_criteria?.trim() || "As defined in the approved UAT plan / project entry-exit criteria."}
              </p>
              <p className="text-sm mt-sm">
                <span className="font-semibold text-on-surface">Assessment: </span>
                <span className="text-on-surface-variant">{exitCriteriaStatus}</span>
              </p>
            </div>

            <div className="border border-outline-variant overflow-hidden rounded-sm mb-md">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1a2744] text-white text-left">
                    <th className="px-md py-sm font-semibold text-xs uppercase tracking-wide">Residual risk item</th>
                    <th className="px-md py-sm font-semibold text-xs uppercase tracking-wide w-20">Count</th>
                    <th className="px-md py-sm font-semibold text-xs uppercase tracking-wide hidden sm:table-cell">Disposition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  <tr className="bg-white">
                    <td className="px-md py-sm text-on-surface">Open defects at sign-off</td>
                    <td className="px-md py-sm font-semibold text-on-surface">{openDefects}</td>
                    <td className="px-md py-sm text-on-surface-variant text-xs hidden sm:table-cell">
                      {openDefects === 0 ? "None" : "Carried forward"}
                    </td>
                  </tr>
                  {severityRows.map((row) => (
                    <tr key={row.severity} className="bg-white">
                      <td className="px-md py-sm pl-8 text-on-surface-variant">— {row.severity} severity</td>
                      <td className="px-md py-sm text-on-surface">{row.count}</td>
                      <td className="px-md py-sm text-on-surface-variant text-xs hidden sm:table-cell">Open</td>
                    </tr>
                  ))}
                  <tr className="bg-white">
                    <td className="px-md py-sm text-on-surface">Accepted / waived defects</td>
                    <td className="px-md py-sm font-semibold text-on-surface">{acceptedCount}</td>
                    <td className="px-md py-sm text-on-surface-variant text-xs hidden sm:table-cell">
                      {acceptedCount === 0 ? "None" : "Annex A"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="border border-[#1a2744] bg-slate-50 p-md rounded-sm">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#1a2744] mb-sm">
                Management recommendation
              </div>
              <p className="text-sm leading-relaxed text-on-surface">{recommendation}</p>
            </div>
          </section>

          {/* 4. Declaration */}
          <section className="mb-xl border border-[#1a2744]/bg-slate-50 p-md rounded-sm">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#1a2744] mb-sm">
              4. Declaration of Acceptance
            </h3>
            <p className="text-sm leading-relaxed text-on-surface">
              By signing below, the undersigned confirm that User Acceptance Testing for the project and module identified
              above has been completed in accordance with the approved UAT plan and exit criteria. The Business Owner
              accepts the system as fit for the intended business purpose, subject to any residual risks explicitly recorded
              in this certificate. The QA / Test Lead confirms that testing was planned, executed, and recorded under
              controlled conditions and that results are available for audit.
            </p>
            <p className="text-sm leading-relaxed text-on-surface mt-sm">
              This certificate constitutes formal business acceptance for the purposes of go-live / production readiness
              decisions. Detailed test evidence remains available in TestCaseHub and associated project records.
            </p>
          </section>

          {/* 5. Signatures */}
          <section className="mb-xl">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#1a2744] border-b border-outline-variant pb-1 mb-md">
              5. Authorised Signatures
            </h3>
            <div className="grid md:grid-cols-2 gap-lg sign-off-signatures">
              <SignatureCard
                roleLabel="Business Owner"
                signed={boSigned}
                record={signOffData.businessOwner}
                canSign={canSignBO}
                isAdminViewer={isAdminViewer}
                onSign={(data) => signMut.mutate(data)}
                loading={signMut.isPending}
              />
              <SignatureCard
                roleLabel="QA / Test Lead"
                signed={tlSigned}
                record={signOffData.testLead}
                canSign={canSignTL}
                isAdminViewer={isAdminViewer}
                onSign={(data) => signMut.mutate(data)}
                loading={signMut.isPending}
              />
            </div>
          </section>

          {/* Residual risks */}
          {signOffData?.businessDecisions && signOffData.businessDecisions.accepted.length > 0 && (
            <section className="mb-xl">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#1a2744] border-b border-outline-variant pb-1 mb-md">
                Annex A — Accepted Residual Risks &amp; Waivers
              </h3>
              <div className="space-y-md">
                {signOffData.businessDecisions.accepted.map((decision) => (
                  <div key={decision.defectId} className="border border-outline-variant rounded-sm p-md bg-surface-container-lowest">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-md mb-sm text-sm">
                      <div>
                        <p className="text-[10px] font-semibold text-outline uppercase">Defect</p>
                        <p className="font-semibold">
                          {decision.bugNumber != null ? `BUG-${decision.bugNumber}` : `DEF-${decision.defectId}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-outline uppercase">Type</p>
                        <p className="font-semibold">
                          {decision.decisionType === "risk_waiver" ? "Risk Waiver" : "Business Review"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-outline uppercase">Severity</p>
                        <p className="font-semibold">{decision.severity}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-outline uppercase">Test Case</p>
                        <p className="text-sm">{decision.testCaseName || "N/A"}</p>
                      </div>
                    </div>
                    <div className="bg-white p-sm rounded border border-outline-variant mb-sm">
                      <p className="text-[10px] font-semibold text-outline uppercase mb-xs">Justification</p>
                      <p className="text-sm whitespace-pre-wrap">{decision.justification}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-md text-sm text-on-surface-variant">
                      <div>
                        <p className="font-semibold text-on-surface">Submitted by</p>
                        <p>{decision.submittedBy}</p>
                        <p className="text-xs">{new Date(decision.submittedAt).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-on-surface">Approved by</p>
                        <p>{decision.acceptedBy}</p>
                        <p className="text-xs">{new Date(decision.acceptedAt).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-md text-xs text-on-surface-variant italic">
                Each decision is immutably recorded in the project audit log.
              </p>
            </section>
          )}

          {/* Status footer */}
          <footer
            className={`px-md py-sm rounded-sm border flex flex-col sm:flex-row justify-between items-center gap-sm ${
              isFullySigned
                ? hasConditions
                  ? "bg-amber-50 border-amber-200 text-amber-900"
                  : "bg-green-50 border-green-200 text-green-800"
                : "bg-amber-50 border-amber-200 text-amber-900"
            }`}
          >
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-base">
                {isFullySigned ? (hasConditions ? "gavel" : "verified_user") : "pending"}
              </span>
              <span className="text-xs font-bold uppercase tracking-widest">
                {isFullySigned
                  ? hasConditions
                    ? "Accepted with conditions — see residual risk"
                    : "Formally accepted — UAT complete"
                  : `Pending authorised signatures — ${collected} of 2 collected`}
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-wide opacity-70">
              Confidential · Management &amp; audit use
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

function InfoCell({
  label,
  value,
  multiline,
}: {
  label: string;
  value?: string | null;
  multiline?: boolean;
}) {
  return (
    <div className="border border-outline-variant bg-slate-50/80 p-md rounded-sm">
      <div className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">{label}</div>
      <div className={`text-sm text-on-surface ${multiline ? "leading-relaxed whitespace-pre-wrap" : "font-medium"}`}>
        {value?.trim() || "—"}
      </div>
    </div>
  );
}

function SignatureCard({
  roleLabel,
  signed,
  record,
  canSign,
  isAdminViewer,
  onSign,
  loading,
}: {
  roleLabel: string;
  signed: boolean;
  record?: SignOffData["testLead"] | SignOffData["businessOwner"];
  canSign: boolean;
  isAdminViewer: boolean;
  onSign: (data: { name: string; role: string; signature: string; signatureImage?: string }) => void;
  loading: boolean;
}) {
  return (
    <div
      className={`relative p-lg border rounded-sm transition-all ${
        signed
          ? "border-outline-variant bg-white"
          : "border-dashed border-outline-variant bg-slate-50/50"
      }`}
    >
      {signed && (
        <div className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest text-green-700 border border-green-300 bg-green-50 px-2 py-0.5 rounded-sm">
          Signed
        </div>
      )}
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#1a2744] mb-md">
        {roleLabel}
      </div>

      {signed && record ? (
        <div>
          <div className="h-16 flex items-end border-b border-[#1a2744] mb-sm pb-1">
            {record.signatureImage ? (
              <img
                src={record.signatureImage}
                alt={`${record.name} signature`}
                className="max-h-14 max-w-[200px] object-contain"
              />
            ) : (
              <span className="font-serif italic text-2xl text-primary opacity-80">
                {record.signature || record.name}
              </span>
            )}
          </div>
          <p className="text-[10px] text-on-surface-variant mb-sm">Authorised electronic signature</p>
          <div className="flex justify-between items-end gap-md">
            <div>
              <div className="font-semibold text-sm">{record.name}</div>
              <div className="text-xs text-on-surface-variant">{record.role}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-on-surface-variant uppercase">Date signed</div>
              <div className="text-sm font-medium">
                {new Date(record.date).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
          </div>
        </div>
      ) : canSign ? (
        <SignForm roleLabel={roleLabel} onSave={onSign} loading={loading} />
      ) : isAdminViewer ? (
        <p className="text-sm text-on-surface-variant italic">
          Only the assigned {roleLabel} can sign this certificate.
        </p>
      ) : (
        <div>
          <div className="h-16 flex items-center justify-center border-b border-outline-variant mb-sm">
            <span className="text-sm text-on-surface-variant">Awaiting authorised signature</span>
          </div>
          <p className="text-xs text-on-surface-variant">Name / title / date will appear once signed.</p>
        </div>
      )}
    </div>
  );
}

type SigMode = "draw" | "upload" | "type";

function SignForm({
  roleLabel,
  onSave,
  loading,
}: {
  roleLabel: string;
  onSave: (data: { name: string; role: string; signature: string; signatureImage?: string }) => void;
  loading: boolean;
}) {
  const user = getStoredUser();
  const [name, setName] = useState(user?.username || "");
  const [title, setTitle] = useState(roleLabel);
  const [mode, setMode] = useState<SigMode>("draw");
  const [typedSig, setTypedSig] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a2744";
      ctx.lineWidth = 2;
    }
  }, []);

  useEffect(() => {
    if (mode !== "draw") return;
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [mode, resizeCanvas]);

  const pos = (e: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const moveDraw = (e: MouseEvent | TouchEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  };

  const endDraw = () => {
    drawing.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasInk(false);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload a PNG or JPEG image of your signature");
      return;
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      toast.error("Signature image must be under 400 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (!result.startsWith("data:image/")) {
        toast.error("Could not read signature image");
        return;
      }
      setImageData(result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const fullName = name.trim() || user?.username || "";
    if (!fullName) {
      toast.error("Please enter your full name");
      return;
    }

    let signatureImage: string | undefined;
    let signature = fullName;

    if (mode === "draw") {
      if (!hasInk || !canvasRef.current) {
        toast.error("Please draw your signature");
        return;
      }
      signatureImage = canvasRef.current.toDataURL("image/png");
      signature = fullName;
    } else if (mode === "upload") {
      if (!imageData) {
        toast.error("Please upload a signature image");
        return;
      }
      signatureImage = imageData;
      signature = fullName;
    } else {
      if (!typedSig.trim()) {
        toast.error("Please type your signature");
        return;
      }
      signature = typedSig.trim();
    }

    onSave({
      name: fullName,
      role: title.trim() || roleLabel,
      signature,
      ...(signatureImage ? { signatureImage } : {}),
    });
  };

  const tabClass = (m: SigMode) =>
    `px-3 py-1.5 text-xs font-semibold rounded-sm border transition-colors ${
      mode === m
        ? "bg-[#1a2744] text-white border-[#1a2744]"
        : "bg-white text-on-surface-variant border-outline-variant hover:border-[#1a2744]"
    }`;

  return (
    <form onSubmit={handleSubmit} className="space-y-md mt-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">Full name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-white border border-outline-variant rounded-sm px-2 py-1.5 text-sm"
            placeholder="As it should appear on the certificate"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">Title / role</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-white border border-outline-variant rounded-sm px-2 py-1.5 text-sm"
            placeholder={roleLabel}
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1.5">
          Electronic signature
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button type="button" className={tabClass("draw")} onClick={() => setMode("draw")}>
            Draw
          </button>
          <button type="button" className={tabClass("upload")} onClick={() => setMode("upload")}>
            Upload image
          </button>
          <button type="button" className={tabClass("type")} onClick={() => setMode("type")}>
            Type name
          </button>
        </div>

        {mode === "draw" && (
          <div>
            <div className="border border-outline-variant rounded-sm bg-white touch-none">
              <canvas
                ref={canvasRef}
                className="w-full cursor-crosshair block"
                onMouseDown={startDraw}
                onMouseMove={moveDraw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={moveDraw}
                onTouchEnd={endDraw}
              />
            </div>
            <div className="flex justify-between items-center mt-1">
              <p className="text-[10px] text-on-surface-variant">Sign in the box above with mouse or touch</p>
              <button
                type="button"
                onClick={clearCanvas}
                className="text-[10px] uppercase tracking-wide text-on-surface-variant hover:text-on-surface"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {mode === "upload" && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            {imageData ? (
              <div className="border border-outline-variant rounded-sm bg-white p-md flex flex-col items-center gap-sm">
                <img src={imageData} alt="Signature preview" className="max-h-20 max-w-full object-contain" />
                <button
                  type="button"
                  className="text-xs text-on-surface-variant underline"
                  onClick={() => {
                    setImageData(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  Remove and choose another
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border border-dashed border-outline-variant rounded-sm py-8 text-sm text-on-surface-variant hover:border-[#1a2744] hover:text-on-surface transition-colors"
              >
                Click to upload a PNG or JPEG of your signature
              </button>
            )}
          </div>
        )}

        {mode === "type" && (
          <input
            value={typedSig}
            onChange={(e) => setTypedSig(e.target.value)}
            className="w-full h-16 bg-white border border-outline-variant rounded-sm px-3 text-2xl font-serif italic"
            placeholder="Type your full name as signature"
          />
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 bg-[#1a2744] text-white rounded-sm text-sm font-semibold tracking-wide hover:brightness-110 disabled:opacity-50"
      >
        {loading ? "Recording signature…" : `Sign as ${roleLabel}`}
      </button>
      <p className="text-[10px] text-on-surface-variant text-center leading-snug">
        Your signature is stored with this certificate and appears on the PDF download.
      </p>
    </form>
  );
}
