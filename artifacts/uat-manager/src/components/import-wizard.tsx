import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Stepper, type Step } from "./ui/stepper";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import type { Project } from "../types/api";

/* ─────────────────────────────────────────────
   Parsing types (shareable with backend)
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
  };
  useCases: ParsedUseCase[];
  totalCases: number;
  totalSteps: number;
  warnings: { useCaseCode: string; useCaseName: string; reason: string }[];
}

/* ─────────────────────────────────────────────
   Client-side parsing (mirrors backend logic)
   ───────────────────────────────────────────── */

const UC_REGEX = /^Use Case\s+([\w-]+):\s*(.*)$/i;

function buildColumnIndexes(headerRow: any[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < Math.max(headerRow.length, 20); i++) {
    const cell = String(headerRow[i] ?? "")
      .trim()
      .toLowerCase()
      .replace(/[#\s]/g, "");
    if (/^testcase/.test(cell)) map.testCase = i;
    else if (/^testtitle/.test(cell) || /^title/i.test(cell)) map.title = i;
    else if (/^teststeps/.test(cell) || /^steps/i.test(cell)) map.steps = i;
    else if (/^testdata/.test(cell) || /^data/i.test(cell)) map.testData = i;
    else if (/^expectedresult/.test(cell) || /^expected/i.test(cell)) map.expectedResult = i;
  }
  return map;
}

async function parseFile(file: File): Promise<ParsedResult> {
  const buf = await file.arrayBuffer();
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const metadata: ParsedResult["metadata"] = {
    projectName: null,
    moduleName: null,
    designedBy: null,
    designDate: null,
    releaseVersion: null,
    precondition: null,
  };

  let dataStartRow = 0;
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const c0 = String(rows[i]?.[0] ?? "").trim();
    const c1 = String(rows[i]?.[1] ?? "").trim();
    if (c0.toLowerCase().startsWith("project name")) metadata.projectName = c1 || null;
    else if (c0.toLowerCase().startsWith("module name")) metadata.moduleName = c1 || null;
    else if (/^test designed by/i.test(c0)) metadata.designedBy = c1 || null;
    else if (/^test designed date/i.test(c0)) metadata.designDate = c1 || null;
    else if (/^release version/i.test(c0)) metadata.releaseVersion = c1 || null;
    else if (/^pre-?condition/i.test(c0)) metadata.precondition = c1 || null;
    if (UC_REGEX.test(c0)) { dataStartRow = i; break; }
  }

  const useCases: ParsedUseCase[] = [];
  let currentUseCase: ParsedUseCase | null = null;
  let currentTestCase: ParsedTestCase | null = null;
  let columnMap: Record<string, number> | null = null;

  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    const c0 = String(row?.[0] ?? "").trim();
    const ucMatch = c0.match(UC_REGEX);

    if (ucMatch) {
      if (currentUseCase && currentTestCase) { currentUseCase.testCases.push(currentTestCase); currentTestCase = null; }
      currentUseCase = { code: ucMatch[1], name: ucMatch[2] || ucMatch[1], testCases: [] };
      useCases.push(currentUseCase);
      columnMap = null;
      currentTestCase = null;
      continue;
    }

    if (!currentUseCase) continue;

    const clean0 = c0.toLowerCase().replace(/[#\s]/g, "");
    if (clean0 === "testcase" || clean0 === "testcase#" || /^test\s*case/i.test(c0)) {
      columnMap = buildColumnIndexes(row);
      currentTestCase = null;
      continue;
    }

    if (!columnMap) continue;

    const tcCell = columnMap.testCase != null ? String(row[columnMap.testCase] ?? "").trim() : "";
    const stCell = columnMap.steps != null ? String(row[columnMap.steps] ?? "").trim() : "";

    if (tcCell && stCell) {
      if (currentTestCase) currentUseCase.testCases.push(currentTestCase);
      const title = columnMap.title != null ? String(row[columnMap.title] ?? "").trim() : "";
      currentTestCase = {
        caseNumber: tcCell,
        title: title || tcCell,
        steps: [{
          instruction: stCell,
          testData: columnMap.testData != null ? String(row[columnMap.testData] ?? "").trim() || null : null,
          expectedResult: columnMap.expectedResult != null ? String(row[columnMap.expectedResult] ?? "").trim() || null : null,
        }],
      };
    } else if (!tcCell && stCell && currentTestCase) {
      currentTestCase.steps.push({
        instruction: stCell,
        testData: columnMap.testData != null ? String(row[columnMap.testData] ?? "").trim() || null : null,
        expectedResult: columnMap.expectedResult != null ? String(row[columnMap.expectedResult] ?? "").trim() || null : null,
      });
    }
  }

  if (currentUseCase && currentTestCase) currentUseCase.testCases.push(currentTestCase);

  // Warnings
  const warnings: ParsedResult["warnings"] = [];
  for (const uc of useCases) {
    const real = uc.testCases.filter((tc) => tc.steps.some((s) => s.instruction.trim()));
    if (real.length === 0) {
      warnings.push({ useCaseCode: uc.code, useCaseName: uc.name, reason: "Use case has no test cases with step content — likely a copy-paste leftover or empty section." });
      continue;
    }
    for (const other of useCases) {
      if (other === uc) break;
      if (other.testCases.length === 0 || uc.testCases.length === 0 || other.testCases.length !== uc.testCases.length) continue;
      const dupe = other.testCases.every((otc, idx) => {
        const utc = uc.testCases[idx];
        return utc && otc.title === utc.title && otc.steps.every((os, si) => utc.steps[si]?.instruction === os.instruction);
      });
      if (dupe) warnings.push({
        useCaseCode: uc.code, useCaseName: uc.name,
        reason: `Content is a near-exact duplicate of use case "${other.code}: ${other.name}". May be a copy-paste leftover.`,
      });
    }
  }

  return {
    metadata,
    useCases,
    totalCases: useCases.reduce((s, u) => s + u.testCases.length, 0),
    totalSteps: useCases.reduce((s, u) => s + u.testCases.reduce((ss, tc) => ss + tc.steps.length, 0), 0),
    warnings,
  };
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
    projectName: "", moduleName: "", designedBy: "", designDate: "", releaseVersion: "", precondition: "",
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
      const result = await parseFile(f);
      setParsed(result);
      setMetadataForm({
        projectName: result.metadata.projectName ?? "",
        moduleName: result.metadata.moduleName ?? "",
        designedBy: result.metadata.designedBy ?? "",
        designDate: result.metadata.designDate ?? "",
        releaseVersion: result.metadata.releaseVersion ?? "",
        precondition: result.metadata.precondition ?? "",
      });
      setCompleted([0]);
      setStep(1);
    } catch (err) {
      toast.error("Failed to parse file. Make sure it's a valid Excel test plan.");
    }
  };

  const handleImport = async () => {
    if (!file || !parsed) return;
    setImporting(true);

    try {
      if (mode === "new-project") {
        const user = getStoredUser();
        // Create the project first
        const project = await customFetch<Project>("/projects", {
          method: "POST",
          body: JSON.stringify({
            name: (metadataForm.projectName || file.name.replace(/\.\w+$/, "")).trim(),
            designedBy: metadataForm.designedBy.trim() || "Imported",
            moduleName: metadataForm.moduleName.trim() || "Imported",
            designDate: metadataForm.designDate.trim() || new Date().toISOString().slice(0, 10),
            testLink: null,
            testLeadId: user?.id ?? 1,
            objectives: null,
            scope: null,
            outOfScope: null,
            entryCriteria: metadataForm.precondition?.trim() || null,
            exitCriteria: null,
          }),
        });

        // Import into the new project
        const fd = new FormData();
        fd.append("file", file);
        const result = await customFetch<{
          useCasesCreated: number;
          testCasesCreated: number;
          stepsCreated: number;
          warnings: any[];
        }>(`/projects/${project.id}/import`, { method: "POST", body: fd });

        setImportResult({
          ...result,
          newProjectId: project.id,
        });
      } else {
        // Existing project — import directly
        const fd = new FormData();
        fd.append("file", file);
        const result = await customFetch<{
          useCasesCreated: number;
          testCasesCreated: number;
          stepsCreated: number;
          warnings: any[];
        }>(`/projects/${projectId}/import`, { method: "POST", body: fd });

        setImportResult(result);
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
      title={mode === "new-project" ? "Import from Excel" : "Import from Excel"}
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
              <div>
                <label className="text-label-sm font-label-sm">Project Name</label>
                <input
                  type="text"
                  value={metadataForm.projectName}
                  onChange={(e) => setMetadataForm((m) => ({ ...m, projectName: e.target.value }))}
                  className="w-full px-md py-sm border border-outline rounded-lg text-body-sm"
                />
              </div>
              <div>
                <label className="text-label-sm font-label-sm">Module Name</label>
                <input
                  type="text"
                  value={metadataForm.moduleName}
                  onChange={(e) => setMetadataForm((m) => ({ ...m, moduleName: e.target.value }))}
                  className="w-full px-md py-sm border border-outline rounded-lg text-body-sm"
                />
              </div>
              <div>
                <label className="text-label-sm font-label-sm">Designed By</label>
                <input
                  type="text"
                  value={metadataForm.designedBy}
                  onChange={(e) => setMetadataForm((m) => ({ ...m, designedBy: e.target.value }))}
                  className="w-full px-md py-sm border border-outline rounded-lg text-body-sm"
                />
              </div>
              <div>
                <label className="text-label-sm font-label-sm">Design Date</label>
                <input
                  type="date"
                  value={metadataForm.designDate}
                  onChange={(e) => setMetadataForm((m) => ({ ...m, designDate: e.target.value }))}
                  className="w-full px-md py-sm border border-outline rounded-lg text-body-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-label-sm font-label-sm">Entry Criteria (Precondition)</label>
                <input
                  type="text"
                  value={metadataForm.precondition}
                  onChange={(e) => setMetadataForm((m) => ({ ...m, precondition: e.target.value }))}
                  className="w-full px-md py-sm border border-outline rounded-lg text-body-sm"
                />
              </div>
            </div>
          )}

          {mode === "existing-project" && parsed.metadata.precondition && (
            <div className="p-md border border-amber-200 bg-amber-50 rounded-lg text-body-sm text-amber-800">
              <strong>Note:</strong> This file lists a precondition — compare with your project's existing Entry Criteria.
              {parsed.metadata.precondition && <p className="mt-1 italic">"{parsed.metadata.precondition}"</p>}
            </div>
          )}

          {/* Warnings */}
          {hasWarnings && (
            <div className="space-y-xs">
              <p className="text-label-sm font-label-sm text-warning">Warnings</p>
              {parsed.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-sm p-sm bg-amber-50 border border-amber-200 rounded-lg text-body-sm text-amber-800">
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
          <span className="material-symbols-outlined text-[48px] text-green-600">check_circle</span>
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
