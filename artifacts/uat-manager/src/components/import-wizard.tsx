import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Field, inputBaseClass, inputInvalidClass, inputValidClass } from "./ui/field";
import { Input } from "./ui/input";
import { Stepper, type Step } from "./ui/stepper";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import type { Project } from "../types/api";

/* ─────────────────────────────────────────────
   Types matching backend dry-run/preview response
   ───────────────────────────────────────────── */

interface ParsedStep {
  instruction: string;
  testData: string | null;
  expectedResult: string | null;
}

interface ParsedTestCase {
  caseNumber: string;
  title: string;
  steps: ParsedStep[];
}

interface ParsedUseCase {
  code: string;
  name: string;
  testCases: ParsedTestCase[];
}

interface ParsedResult {
  metadata: {
    projectName: string | null;
    moduleName: string | null;
    designedBy: string | null;
    designDate: string | null;
    releaseVersion: string | null;
    precondition: string | null;
    objectives: string | null;
    scope: string | null;
    outOfScope: string | null;
    entryCriteria: string | null;
    exitCriteria: string | null;
  };
  useCases: ParsedUseCase[];
  totalCases: number;
  totalSteps: number;
  warnings: { useCaseCode: string; useCaseName: string; reason: string }[];
}

/* ─────────────────────────────────────────────
   ImportWizard component
   ───────────────────────────────────────────── */

interface ImportWizardProps {
  mode: "new-project" | "existing-project";
  open: boolean;
  onClose: () => void;
  projectId?: number;
  onImportComplete?: (projectId: number) => void;
}

const STEPS: Step[] = [
  { key: "upload", label: "Upload" },
  { key: "preview", label: "Preview" },
  { key: "confirm", label: "Import" },
  { key: "result", label: "Done" },
];

export function ImportWizard({ mode, open, onClose, projectId, onImportComplete }: ImportWizardProps) {
  const [, navigate] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    useCasesCreated: number;
    testCasesCreated: number;
    stepsCreated: number;
    newProjectId?: number;
  } | null>(null);
  const [metadataForm, setMetadataForm] = useState<ParsedResult["metadata"]>({
    projectName: "", moduleName: "", designedBy: "", designDate: "", releaseVersion: "",
    precondition: "", objectives: "", scope: "", outOfScope: "", entryCriteria: "", exitCriteria: "",
  } as any);

  const handleReset = useCallback(() => {
    setStep(0);
    setCompleted([]);
    setFile(null);
    setParsed(null);
    setImporting(false);
    setImportResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);

    try {
      const formData = new FormData();
      formData.append("file", f);

      let result: ParsedResult;

      const nullMeta = {
        projectName: null, moduleName: null, designedBy: null, designDate: null,
        releaseVersion: null, precondition: null,
        objectives: null, scope: null, outOfScope: null, entryCriteria: null, exitCriteria: null,
      };

      if (mode === "existing-project" && projectId) {
        const res = await customFetch<any>(`/projects/${projectId}/import?dryRun=true`, {
          method: "POST",
          body: formData,
        });
        result = {
          metadata: res.suggestedProjectMetadata ?? { ...nullMeta },
          useCases: res.useCases ?? [],
          totalCases: res.totals?.testCases ?? 0,
          totalSteps: res.totals?.steps ?? 0,
          warnings: res.warnings ?? [],
        };
      } else {
        const res = await customFetch<any>("/import/preview", {
          method: "POST",
          body: formData,
        });
        result = {
          metadata: res.suggestedProjectMetadata ?? { ...nullMeta },
          useCases: res.useCases ?? [],
          totalCases: res.totals?.testCases ?? 0,
          totalSteps: res.totals?.steps ?? 0,
          warnings: res.warnings ?? [],
        };
      }

      setParsed(result);
      setMetadataForm({
        projectName: result.metadata.projectName ?? "",
        moduleName: result.metadata.moduleName ?? "",
        designedBy: result.metadata.designedBy ?? "",
        designDate: result.metadata.designDate ?? "",
        releaseVersion: result.metadata.releaseVersion ?? "",
        precondition: result.metadata.precondition ?? "",
        objectives: result.metadata.objectives ?? "",
        scope: result.metadata.scope ?? "",
        outOfScope: result.metadata.outOfScope ?? "",
        entryCriteria: result.metadata.entryCriteria ?? "",
        exitCriteria: result.metadata.exitCriteria ?? "",
      });
      setCompleted([0]);
      setStep(1);
    } catch (err: any) {
      toast.error(err.message || "Failed to parse file. Make sure it's a valid Excel test plan.");
    }
  };

  const handleImport = async () => {
    if (!file || !parsed) return;
    setImporting(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      if (mode === "new-project") {
        const user = getStoredUser();
        const project = await customFetch<Project>("/projects", {
          method: "POST",
          body: JSON.stringify({
            name: (metadataForm.projectName || file.name.replace(/\.\w+$/, "")).trim(),
            designedBy: metadataForm.designedBy.trim() || "Imported",
            moduleName: metadataForm.moduleName.trim() || "Imported",
            designDate: metadataForm.designDate.trim() || new Date().toISOString().slice(0, 10),
            testLink: null,
            testLeadId: user?.id ?? 1,
            objectives: metadataForm.objectives?.trim() || null,
            scope: metadataForm.scope?.trim() || null,
            outOfScope: metadataForm.outOfScope?.trim() || null,
            entryCriteria: metadataForm.entryCriteria?.trim() || metadataForm.precondition?.trim() || null,
            exitCriteria: metadataForm.exitCriteria?.trim() || null,
          }),
        });

        const result = await customFetch<any>(`/projects/${project.id}/import`, {
          method: "POST",
          body: fd,
        });

        setImportResult({
          useCasesCreated: result.useCasesCreated,
          testCasesCreated: result.testCasesCreated,
          stepsCreated: result.stepsCreated,
          newProjectId: project.id,
        });
      } else {
        const result = await customFetch<any>(`/projects/${projectId}/import`, {
          method: "POST",
          body: fd,
        });

        setImportResult({
          useCasesCreated: result.useCasesCreated,
          testCasesCreated: result.testCasesCreated,
          stepsCreated: result.stepsCreated,
        });
      }

      setCompleted([0, 1, 2]);
      setStep(3);
    } catch (err: any) {
      toast.error(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const hasWarnings = (parsed?.warnings.length ?? 0) > 0;

  return (
    <Dialog
      open={open}
      onClose={() => { handleReset(); onClose(); }}
      title="Import from Excel"
      subtitle="Parse a test plan from an .xlsx file and import it."
      size="lg"
      contentClassName={step === 1 ? "min-h-[400px]" : ""}
    >
      <Stepper steps={STEPS} currentIndex={step} completedIndices={completed} className="mb-lg" />

      {step === 0 && (
        <div className="flex flex-col items-center gap-md py-lg">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant">upload_file</span>
          <p className="text-body-sm text-on-surface-variant text-center max-w-sm">
            Select an Excel (.xlsx) test plan file to import.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="block w-full max-w-sm text-label-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-secondary file:text-on-secondary file:font-label-md file:cursor-pointer hover:file:brightness-110"
          />
        </div>
      )}

      {step === 1 && parsed && (
        <div className="space-y-md">
          {/* Counts */}
          <div className="flex items-center gap-lg flex-wrap">
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[100px]">
              <p className="font-headline-md text-headline-md text-secondary">{parsed.useCases.length}</p>
              <p className="text-label-sm text-on-surface-variant">Scenarios</p>
            </div>
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[100px]">
              <p className="font-headline-md text-headline-md text-secondary">{parsed.totalCases}</p>
              <p className="text-label-sm text-on-surface-variant">Test Cases</p>
            </div>
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[100px]">
              <p className="font-headline-md text-headline-md text-secondary">{parsed.totalSteps}</p>
              <p className="text-label-sm text-on-surface-variant">Steps</p>
            </div>
          </div>

          {/* Metadata fields (editable in new-project, read-only in existing) */}
          {mode === "new-project" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-md p-md border border-outline-variant rounded-lg bg-surface-container-lowest">
              <Field label="Project Name" required helper="A short, recognisable name shown in lists and reports.">
                <input
                  type="text"
                  value={metadataForm.projectName}
                  onChange={(e) => setMetadataForm((m) => ({ ...m, projectName: e.target.value }))}
                  placeholder="e.g. Q4 Mobile Banking UAT"
                  className={`${inputBaseClass} text-title-sm font-title-sm ${inputValidClass}`}
                />
              </Field>
              <Field label="Module Name" required helper="Feature, epic, or component under test.">
                <input
                  type="text"
                  value={metadataForm.moduleName}
                  onChange={(e) => setMetadataForm((m) => ({ ...m, moduleName: e.target.value }))}
                  placeholder="e.g. Mobile App"
                  className={`${inputBaseClass} ${inputValidClass}`}
                />
              </Field>
              <Field label="Designed By" required>
                <input
                  type="text"
                  value={metadataForm.designedBy}
                  onChange={(e) => setMetadataForm((m) => ({ ...m, designedBy: e.target.value }))}
                  className={`${inputBaseClass} ${inputValidClass}`}
                />
              </Field>
              <Field label="Design Date" required>
                <input
                  type="date"
                  value={metadataForm.designDate}
                  onChange={(e) => setMetadataForm((m) => ({ ...m, designDate: e.target.value }))}
                  className={`${inputBaseClass} ${inputValidClass}`}
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Objectives" helper="The goals this test plan aims to achieve.">
                  <textarea
                    rows={2}
                    value={metadataForm.objectives}
                    onChange={(e) => setMetadataForm((m) => ({ ...m, objectives: e.target.value }))}
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="In Scope" helper="Features, systems, or areas included.">
                  <textarea
                    rows={2}
                    value={metadataForm.scope}
                    onChange={(e) => setMetadataForm((m) => ({ ...m, scope: e.target.value }))}
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Out of Scope" helper="Features, systems, or areas explicitly excluded.">
                  <textarea
                    rows={2}
                    value={metadataForm.outOfScope}
                    onChange={(e) => setMetadataForm((m) => ({ ...m, outOfScope: e.target.value }))}
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Entry Criteria" helper="What must be true before testing can begin.">
                  <textarea
                    rows={2}
                    value={metadataForm.entryCriteria}
                    onChange={(e) => setMetadataForm((m) => ({ ...m, entryCriteria: e.target.value }))}
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Exit Criteria" helper="What must be true before this test plan can be signed off.">
                  <textarea
                    rows={2}
                    value={metadataForm.exitCriteria}
                    onChange={(e) => setMetadataForm((m) => ({ ...m, exitCriteria: e.target.value }))}
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
            </div>
          )}

          {mode === "existing-project" && parsed.metadata.precondition && (
            <div className="p-md border border-error bg-error-container rounded-lg text-body-sm text-on-error-container">
              <strong>Note:</strong> This file lists a precondition — compare with your project's existing Entry Criteria.
              {parsed.metadata.precondition && <p className="mt-1 italic">"{parsed.metadata.precondition}"</p>}
            </div>
          )}

          {/* Warnings */}
          {hasWarnings && (
            <div className="space-y-xs">
              <p className="text-label-sm font-label-sm text-on-error-container">Warnings</p>
              {parsed.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-sm p-sm bg-error-container border border-error rounded-lg text-body-sm text-on-error-container">
                  <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">warning</span>
                  <span><strong>{w.useCaseCode}</strong>: {w.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tree preview (collapsible) */}
          <details className="border border-outline-variant rounded-lg overflow-hidden">
            <summary className="px-md py-sm bg-surface-container-high text-label-sm font-label-sm cursor-pointer hover:bg-surface-container transition-colors">
              Show full plan tree ({parsed.useCases.length} scenarios)
            </summary>
            <div className="p-md space-y-sm max-h-[300px] overflow-y-auto">
              {parsed.useCases.map((uc) => (
                <div key={uc.code} className="text-body-sm">
                  <span className="font-label-md">{uc.code}: {uc.name}</span>
                  <div className="ml-lg space-y-0.5 mt-0.5">
                    {uc.testCases.map((tc) => (
                      <div key={tc.caseNumber}>
                        <span className="text-on-surface-variant">{tc.caseNumber} — {tc.title}</span>
                        <div className="ml-lg text-on-surface-variant/60 text-label-sm">
                          {tc.steps.map((s, si) => (
                            <div key={si}>{si + 1}. {s.instruction}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {step === 3 && importResult && (
        <div className="flex flex-col items-center gap-md py-lg text-center">
          <span className="material-symbols-outlined text-[48px] text-secondary">check_circle</span>
          <p className="font-title-sm text-title-sm">Import complete</p>
          <div className="flex items-center gap-lg flex-wrap justify-center">
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[80px]">
              <p className="font-headline-md text-headline-md text-secondary">{importResult.useCasesCreated}</p>
              <p className="text-label-sm text-on-surface-variant">Scenarios</p>
            </div>
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[80px]">
              <p className="font-headline-md text-headline-md text-secondary">{importResult.testCasesCreated}</p>
              <p className="text-label-sm text-on-surface-variant">Test Cases</p>
            </div>
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[80px]">
              <p className="font-headline-md text-headline-md text-secondary">{importResult.stepsCreated}</p>
              <p className="text-label-sm text-on-surface-variant">Steps</p>
            </div>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              const id = importResult.newProjectId ?? projectId!;
              onImportComplete?.(id);
              onClose();
              navigate(`/projects/${id}`);
            }}
          >
            View project
          </Button>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-md border-t border-outline-variant">
        <Button variant="ghost" onClick={() => { handleReset(); onClose(); }} disabled={importing}>
          {step === 3 ? "Close" : "Cancel"}
        </Button>
        <div className="flex items-center gap-sm">
          {step === 1 && (
            <Button variant="secondary" onClick={() => { setStep(0); setCompleted([]); }}>
              <span className="material-symbols-outlined text-sm">arrow_back</span> Back
            </Button>
          )}
          {step === 1 && (
            <Button variant="primary" onClick={handleImport} loading={importing}>
              {mode === "new-project" ? "Create Project & Import" : "Import"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
