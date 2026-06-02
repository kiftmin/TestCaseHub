import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import { useProjectRole } from "../hooks/useProjectRole";
import type { Project, SignOffData } from "../types/api";

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

  const signMut = useMutation({
    mutationFn: (data: { name: string; role: string; signature: string }) =>
      customFetch(`/projects/${projectId}/sign-off`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries(); toast.success("Signature recorded"); },
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
      {/* Print Controls */}
      <div className="flex justify-end no-print">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-sm bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md hover:brightness-110 transition-all"
        >
          <span className="material-symbols-outlined text-sm">print</span>
          Download / Print Certificate
        </button>
      </div>

      {/* Certificate */}
      <div className="bg-white cert-border shadow-sm print-container relative overflow-hidden p-12 md:p-16">
        <div className="watermark">CERTIFIED</div>

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
            <div className="font-bold text-on-surface">v{project?.version}.0-stable</div>
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

        {/* 6. Certificate Status Banner */}
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

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; padding: 0 !important; }
          .print-container { border: 2px solid #000 !important; margin: 0 !important; padding: 40px !important; box-shadow: none !important; }
          .watermark { 
            display: block !important; 
            position: fixed; 
            top: 50%; 
            left: 50%; 
            transform: translate(-50%, -50%) rotate(-45deg); 
            font-size: 8rem; 
            color: rgba(0,0,0,0.05); 
            z-index: -1;
            font-weight: 900;
            pointer-events: none;
          }
          .sign-off-signatures {
            page-break-inside: avoid;
          }
          .sign-off-page .cert-border {
            border: 2px solid #000 !important;
          }
        }
        .watermark { display: none; }
        .cert-border {
          border: 1px solid #e2e8f0;
          position: relative;
        }
        .cert-border::before {
          content: '';
          position: absolute;
          top: 12px; left: 12px; right: 12px; bottom: 12px;
          border: 1px solid #c6c6cd;
          pointer-events: none;
        }
      `}</style>
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
