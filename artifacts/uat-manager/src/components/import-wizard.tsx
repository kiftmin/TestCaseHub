import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Field, inputBaseClass, inputValidClass } from "./ui/field";
import { Select } from "./ui/select";
import { Stepper, type Step } from "./ui/stepper";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import type { Project } from "../types/api";

const PARSE_STAGES = [
  "Uploading file…",
  "Reading spreadsheet…",
  "Detecting columns…",
  "Building plan preview…",
];

const IMPORT_STAGES = [
  "Preparing import…",
  "Creating scenarios…",
  "Writing test cases & steps…",
  "Finalising…",
];

/** Staged progress while a single long request is in flight (no server % available). */
function useStagedProgress(active: boolean, stages: readonly string[]) {
  const [percent, setPercent] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const stageCount = stages.length;

  useEffect(() => {
    if (!active) {
      setPercent(0);
      setStageIndex(0);
      return;
    }
    setPercent(4);
    setStageIndex(0);
    const started = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - started;
      // Asymptotic approach toward ~92% so large files still feel alive
      const next = Math.min(92, 4 + (1 - Math.exp(-elapsed / 12000)) * 88);
      setPercent(next);
      if (stageCount > 1) {
        const idx = Math.min(
          stageCount - 1,
          Math.floor((elapsed / 9000) * stageCount)
        );
        setStageIndex(idx);
      }
    }, 200);
    return () => window.clearInterval(tick);
  }, [active, stageCount]);

  return {
    percent,
    stageLabel: stages[stageIndex] ?? stages[0] ?? "Working…",
  };
}

function ImportProgressBar({
  percent,
  label,
  detail,
}: {
  percent: number;
  label: string;
  detail?: string;
}) {
  return (
    <div className="w-full max-w-md mx-auto space-y-sm py-md" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-sm text-body-sm">
        <span className="font-label-md text-on-surface">{label}</span>
        <span className="text-on-surface-variant tabular-nums">{Math.round(percent)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-container-high overflow-hidden border border-outline-variant">
        <div
          className="h-full rounded-full bg-secondary transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      </div>
      {detail && (
        <p className="text-label-sm text-on-surface-variant text-center">{detail}</p>
      )}
      <p className="text-label-sm text-on-surface-variant/80 text-center">
        Large files can take a minute — please keep this window open.
      </p>
    </div>
  );
}

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

interface DetectedHeader {
  index: number;
  label: string;
  autoKey: string | null;
}

interface MappableField {
  key: string;
  label: string;
  required: boolean;
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
  detectedHeaders: DetectedHeader[];
  columnMap: Record<string, number>;
  structureOnly: boolean;
  ignoredExecutionColumns: string[];
  mappableFields: MappableField[];
  note?: string;
}

type ColumnMapState = Record<string, number | "">;

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
  { key: "mapping", label: "Map Columns" },
  { key: "preview", label: "Preview" },
  { key: "result", label: "Done" },
];

const DEFAULT_MAPPABLE: MappableField[] = [
  { key: "testCase", label: "Test Case #", required: true },
  { key: "title", label: "Title", required: false },
  { key: "steps", label: "Steps", required: true },
  { key: "testData", label: "Test Data", required: false },
  { key: "expectedResult", label: "Expected Result", required: false },
  { key: "precondition", label: "Precondition", required: false },
];

export function ImportWizard({ mode, open, onClose, projectId, onImportComplete }: ImportWizardProps) {
  const [, navigate] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMapState>({});
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progressMode, setProgressMode] = useState<"idle" | "parse" | "import">("idle");
  const [importResult, setImportResult] = useState<{
    useCasesCreated: number;
    testCasesCreated: number;
    stepsCreated: number;
    newProjectId?: number;
  } | null>(null);
  const [metadataForm, setMetadataForm] = useState({
    projectName: "",
    moduleName: "",
    designedBy: "",
    designDate: "",
    releaseVersion: "",
    precondition: "",
    objectives: "",
    scope: "",
    outOfScope: "",
    entryCriteria: "",
    exitCriteria: "",
  });

  const parseProgress = useStagedProgress(progressMode === "parse", PARSE_STAGES);
  const importProgress = useStagedProgress(progressMode === "import", IMPORT_STAGES);
  const activeProgress =
    progressMode === "parse"
      ? parseProgress
      : progressMode === "import"
        ? importProgress
        : null;

  const handleReset = useCallback(() => {
    setStep(0);
    setCompleted([]);
    setFile(null);
    setParsed(null);
    setColumnMap({});
    setParsing(false);
    setImporting(false);
    setProgressMode("idle");
    setImportResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const parseFile = async (f: File, mapOverride?: ColumnMapState) => {
    setParsing(true);
    setProgressMode("parse");
    try {
      const formData = new FormData();
      formData.append("file", f);
      if (mapOverride) {
        const payload: Record<string, number | null> = {};
        for (const [k, v] of Object.entries(mapOverride)) {
          payload[k] = v === "" ? null : Number(v);
        }
        formData.append("columnMap", JSON.stringify(payload));
      }

      const nullMeta = {
        projectName: null,
        moduleName: null,
        designedBy: null,
        designDate: null,
        releaseVersion: null,
        precondition: null,
        objectives: null,
        scope: null,
        outOfScope: null,
        entryCriteria: null,
        exitCriteria: null,
      };

      let res: any;
      if (mode === "existing-project" && projectId) {
        res = await customFetch<any>(`/projects/${projectId}/import?dryRun=true`, {
          method: "POST",
          body: formData,
        });
      } else {
        res = await customFetch<any>("/import/preview", {
          method: "POST",
          body: formData,
        });
      }

      const result: ParsedResult = {
        metadata: res.suggestedProjectMetadata ?? { ...nullMeta },
        useCases: res.useCases ?? [],
        totalCases: res.totals?.testCases ?? 0,
        totalSteps: res.totals?.steps ?? 0,
        warnings: res.warnings ?? [],
        detectedHeaders: res.detectedHeaders ?? [],
        columnMap: res.columnMap ?? {},
        structureOnly: res.structureOnly !== false,
        ignoredExecutionColumns: res.ignoredExecutionColumns ?? [],
        mappableFields: res.mappableFields ?? DEFAULT_MAPPABLE,
        note: res.note,
      };

      setParsed(result);
      if (!mapOverride) {
        const initial: ColumnMapState = {};
        for (const field of result.mappableFields) {
          initial[field.key] =
            result.columnMap[field.key] != null ? result.columnMap[field.key] : "";
        }
        setColumnMap(initial);
      }
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
      return result;
    } finally {
      setParsing(false);
      setProgressMode("idle");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    try {
      await parseFile(f);
      setCompleted([0]);
      setStep(1);
    } catch (err: any) {
      toast.error(err.message || "Failed to parse file. Use a valid .xlsx, .xls, or .csv test plan.");
    }
  };

  const handleApplyMapping = async () => {
    if (!file) return;
    const fields = parsed?.mappableFields ?? DEFAULT_MAPPABLE;
    for (const f of fields) {
      if (f.required && (columnMap[f.key] === "" || columnMap[f.key] == null)) {
        toast.error(`Map a column for "${f.label}" (required).`);
        return;
      }
    }
    try {
      await parseFile(file, columnMap);
      setCompleted([0, 1]);
      setStep(2);
    } catch (err: any) {
      toast.error(err.message || "Failed to re-parse with column mapping.");
    }
  };

  const handleImport = async () => {
    if (!file || !parsed) return;
    setImporting(true);
    setProgressMode("import");

    try {
      const fd = new FormData();
      fd.append("file", file);
      const payload: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(columnMap)) {
        payload[k] = v === "" ? null : Number(v);
      }
      fd.append("columnMap", JSON.stringify(payload));

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
            testLeadId: user?.userId ?? 1,
            objectives: metadataForm.objectives?.trim() || null,
            scope: metadataForm.scope?.trim() || null,
            outOfScope: metadataForm.outOfScope?.trim() || null,
            entryCriteria:
              metadataForm.entryCriteria?.trim() || metadataForm.precondition?.trim() || null,
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
      setProgressMode("idle");
    }
  };

  const hasWarnings = (parsed?.warnings.length ?? 0) > 0;
  const mappableFields = parsed?.mappableFields ?? DEFAULT_MAPPABLE;
  const headers = parsed?.detectedHeaders ?? [];

  return (
    <Dialog
      open={open}
      onClose={() => {
        handleReset();
        onClose();
      }}
      title="Import Test Plan"
      subtitle="Import scenarios, test cases, and steps from Excel or CSV. Execution results are never imported."
      size="lg"
      contentClassName={step === 1 || step === 2 ? "min-h-[400px]" : ""}
    >
      <Stepper steps={STEPS} currentIndex={step} completedIndices={completed} className="mb-lg" />

      {activeProgress && (
        <ImportProgressBar
          percent={activeProgress.percent}
          label={activeProgress.stageLabel}
          detail={
            file
              ? `${file.name}${file.size ? ` · ${(file.size / 1024).toFixed(0)} KB` : ""}`
              : undefined
          }
        />
      )}

      {step === 0 && !parsing && (
        <div className="flex flex-col items-center gap-md py-lg">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant">
            upload_file
          </span>
          <p className="text-body-sm text-on-surface-variant text-center max-w-md">
            Select an Excel (.xlsx / .xls) or CSV (.csv) file. Only plan structure is imported —
            Actual Result, Status, and Notes columns are ignored.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            disabled={parsing}
            className="block w-full max-w-sm text-label-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-secondary file:text-on-secondary file:font-label-md file:cursor-pointer hover:file:brightness-110"
          />
          <p className="text-label-sm text-on-surface-variant text-center max-w-sm">
            Need a blank file? Use <strong>Template</strong> on the Test Plan tab — it matches the
            expected headers and structure-only columns.
          </p>
        </div>
      )}

      {step === 1 && parsed && !parsing && (
        <div className="space-y-md">
          <div className="flex items-start gap-sm p-md rounded-lg border border-secondary/30 bg-secondary/5 text-body-sm">
            <span className="material-symbols-outlined text-secondary text-[20px] shrink-0">
              info
            </span>
            <div>
              <p className="font-label-md text-on-surface">Structure-only import</p>
              <p className="text-on-surface-variant mt-0.5">
                Columns for Actual Result, Status (Pass/Fail), and Notes are never written. Map only
                the plan structure fields below.
              </p>
              {(parsed.ignoredExecutionColumns?.length ?? 0) > 0 && (
                <p className="text-on-surface-variant mt-1">
                  Detected and ignored:{" "}
                  <strong>{parsed.ignoredExecutionColumns.join(", ")}</strong>
                </p>
              )}
            </div>
          </div>

          {headers.length === 0 ? (
            <div className="p-md border border-error bg-error-container rounded-lg text-body-sm text-on-error-container">
              No test-case header row was detected (need at least Test Case # and Steps columns).
              You can still try mapping if columns were partially detected, or go back and fix the
              file.
            </div>
          ) : (
            <div className="space-y-sm">
              <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider">
                Column mapping
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                {mappableFields.map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    required={field.required}
                    helper={
                      field.required
                        ? "Required for import"
                        : "Optional — leave unmapped to skip"
                    }
                  >
                    <Select
                      value={
                        columnMap[field.key] === "" || columnMap[field.key] == null
                          ? ""
                          : String(columnMap[field.key])
                      }
                      onChange={(e) =>
                        setColumnMap((m) => ({
                          ...m,
                          [field.key]: e.target.value === "" ? "" : Number(e.target.value),
                        }))
                      }
                    >
                      <option value="">— Not mapped —</option>
                      {headers.map((h) => (
                        <option key={h.index} value={h.index}>
                          Col {h.index + 1}: {h.label}
                          {h.autoKey === field.key ? " (auto)" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-lg flex-wrap text-body-sm text-on-surface-variant">
            <span>
              Preview counts after mapping:{" "}
              <strong className="text-on-surface">{parsed.useCases.length}</strong> scenarios ·{" "}
              <strong className="text-on-surface">{parsed.totalCases}</strong> cases ·{" "}
              <strong className="text-on-surface">{parsed.totalSteps}</strong> steps
            </span>
          </div>
        </div>
      )}

      {step === 2 && parsed && !importing && (
        <div className="space-y-md">
          <div className="flex items-center gap-lg flex-wrap">
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[100px]">
              <p className="font-headline-md text-headline-md text-secondary">
                {parsed.useCases.length}
              </p>
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

          {mode === "new-project" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-md p-md border border-outline-variant rounded-lg bg-surface-container-lowest">
              <Field label="Project Name" required helper="Shown in lists and reports.">
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
                <Field label="Objectives">
                  <textarea
                    rows={2}
                    value={metadataForm.objectives}
                    onChange={(e) => setMetadataForm((m) => ({ ...m, objectives: e.target.value }))}
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="In Scope">
                  <textarea
                    rows={2}
                    value={metadataForm.scope}
                    onChange={(e) => setMetadataForm((m) => ({ ...m, scope: e.target.value }))}
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Out of Scope">
                  <textarea
                    rows={2}
                    value={metadataForm.outOfScope}
                    onChange={(e) => setMetadataForm((m) => ({ ...m, outOfScope: e.target.value }))}
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Entry Criteria">
                  <textarea
                    rows={2}
                    value={metadataForm.entryCriteria}
                    onChange={(e) =>
                      setMetadataForm((m) => ({ ...m, entryCriteria: e.target.value }))
                    }
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Exit Criteria">
                  <textarea
                    rows={2}
                    value={metadataForm.exitCriteria}
                    onChange={(e) =>
                      setMetadataForm((m) => ({ ...m, exitCriteria: e.target.value }))
                    }
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                  />
                </Field>
              </div>
            </div>
          )}

          {mode === "existing-project" && parsed.metadata.precondition && (
            <div className="p-md border border-error bg-error-container rounded-lg text-body-sm text-on-error-container">
              <strong>Note:</strong> This file lists a precondition — compare with your project&apos;s
              existing Entry Criteria.
              <p className="mt-1 italic">&quot;{parsed.metadata.precondition}&quot;</p>
            </div>
          )}

          {hasWarnings && (
            <div className="space-y-xs">
              <p className="text-label-sm font-label-sm text-on-error-container">Warnings</p>
              {parsed.warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-sm p-sm bg-error-container border border-error rounded-lg text-body-sm text-on-error-container"
                >
                  <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">warning</span>
                  <span>
                    <strong>{w.useCaseCode}</strong>: {w.reason}
                  </span>
                </div>
              ))}
            </div>
          )}

          <details className="border border-outline-variant rounded-lg overflow-hidden">
            <summary className="px-md py-sm bg-surface-container-high text-label-sm font-label-sm cursor-pointer hover:bg-surface-container transition-colors">
              Show full plan tree ({parsed.useCases.length} scenarios)
            </summary>
            <div className="p-md space-y-sm max-h-[300px] overflow-y-auto">
              {parsed.useCases.map((uc) => (
                <div key={uc.code} className="text-body-sm">
                  <span className="font-label-md">
                    {uc.code}: {uc.name}
                  </span>
                  <div className="ml-lg space-y-0.5 mt-0.5">
                    {uc.testCases.map((tc) => (
                      <div key={tc.caseNumber}>
                        <span className="text-on-surface-variant">
                          {tc.caseNumber} — {tc.title}
                        </span>
                        <div className="ml-lg text-on-surface-variant/60 text-label-sm">
                          {tc.steps.map((s, si) => (
                            <div key={si}>
                              {si + 1}. {s.instruction}
                            </div>
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
          <p className="text-body-sm text-on-surface-variant">
            Structure imported only — no execution results were written.
          </p>
          <div className="flex items-center gap-lg flex-wrap justify-center">
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[80px]">
              <p className="font-headline-md text-headline-md text-secondary">
                {importResult.useCasesCreated}
              </p>
              <p className="text-label-sm text-on-surface-variant">Scenarios</p>
            </div>
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[80px]">
              <p className="font-headline-md text-headline-md text-secondary">
                {importResult.testCasesCreated}
              </p>
              <p className="text-label-sm text-on-surface-variant">Test Cases</p>
            </div>
            <div className="bg-surface-container-high rounded-lg px-md py-sm text-center min-w-[80px]">
              <p className="font-headline-md text-headline-md text-secondary">
                {importResult.stepsCreated}
              </p>
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

      <div className="flex items-center justify-between pt-md border-t border-outline-variant">
        <Button
          variant="ghost"
          onClick={() => {
            handleReset();
            onClose();
          }}
          disabled={importing || parsing}
        >
          {step === 3 ? "Close" : "Cancel"}
        </Button>
        <div className="flex items-center gap-sm">
          {step === 1 && !parsing && (
            <Button
              variant="secondary"
              onClick={() => {
                setStep(0);
                setCompleted([]);
              }}
              disabled={parsing}
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span> Back
            </Button>
          )}
          {step === 2 && !importing && (
            <Button
              variant="secondary"
              onClick={() => {
                setStep(1);
                setCompleted([0]);
              }}
              disabled={importing}
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span> Back
            </Button>
          )}
          {step === 1 && (
            <Button variant="primary" onClick={handleApplyMapping} loading={parsing} disabled={parsing}>
              {parsing ? "Building preview…" : "Continue to Preview"}
              {!parsing && (
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              )}
            </Button>
          )}
          {step === 2 && (
            <Button variant="primary" onClick={handleImport} loading={importing} disabled={importing}>
              {importing
                ? "Importing…"
                : mode === "new-project"
                  ? "Create Project & Import"
                  : "Import Structure"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
