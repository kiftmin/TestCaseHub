import express from "express";
import { eq, sql } from "drizzle-orm";
import multer from "multer";
import XLSX from "xlsx";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";
import { bumpProjectVersion, logAudit } from "../utils/project.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/csv",
      "text/plain",
      "application/vnd.ms-excel",
    ];
    const name = (file.originalname || "").toLowerCase();
    const extOk = name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
    if (allowed.includes(file.mimetype) || extOk) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only .xlsx, .xls, and .csv are allowed."));
    }
  },
});

interface ParsedUseCase {
  code: string;
  name: string;
  testCases: ParsedTestCase[];
}

interface ParsedTestCase {
  caseNumber: string;
  title: string;
  precondition: string | null;
  steps: ParsedStep[];
}

interface ParsedStep {
  instruction: string;
  testData: string | null;
  expectedResult: string | null;
}

interface SuggestedMetadata {
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
}

interface Warning {
  useCaseCode: string;
  useCaseName: string;
  reason: string;
}

/** Logical fields the importer can bind to spreadsheet columns. */
export type ImportColumnKey =
  | "testCase"
  | "title"
  | "steps"
  | "testData"
  | "expectedResult"
  | "precondition"
  | "actualResult"
  | "status"
  | "notes";

const STRUCTURE_KEYS: ImportColumnKey[] = [
  "testCase",
  "title",
  "steps",
  "testData",
  "expectedResult",
  "precondition",
];

const EXECUTION_KEYS: ImportColumnKey[] = ["actualResult", "status", "notes"];

function autoDetectColumnKey(raw: string): ImportColumnKey | null {
  const cell = raw.trim().toLowerCase().replace(/[#\s]/g, "");
  if (!cell) return null;
  if (/^testcase/.test(cell)) return "testCase";
  if (/^testtitle/.test(cell) || /^title/.test(cell)) return "title";
  if (/^teststeps/.test(cell) || /^steps/.test(cell)) return "steps";
  if (/^testdata/.test(cell) || /^data/.test(cell)) return "testData";
  if (/^expectedresult/.test(cell) || /^expected/.test(cell)) return "expectedResult";
  if (/^actualresult/.test(cell) || /^actual/.test(cell)) return "actualResult";
  if (/^status/.test(cell)) return "status";
  if (/^notes?$/.test(cell)) return "notes";
  if (/^precondition/.test(cell)) return "precondition";
  return null;
}

function buildColumnMap(
  headerRow: unknown[],
  overrides?: Partial<Record<ImportColumnKey, number | null>>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < Math.min(headerRow.length, 30); i++) {
    const key = autoDetectColumnKey(String((headerRow as any)[i] ?? ""));
    if (key && map[key] == null) map[key] = i;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v == null || v === -1) {
        delete map[k];
      } else if (typeof v === "number" && v >= 0) {
        map[k] = v;
      }
    }
  }
  return map;
}

function detectHeaderRow(rows: unknown[][]): {
  headers: { index: number; label: string; autoKey: ImportColumnKey | null }[];
  autoMap: Record<string, number>;
  rowIndex: number;
} | null {
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const row = rows[i] as any[];
    if (!row) continue;
    const labels: { index: number; label: string; autoKey: ImportColumnKey | null }[] = [];
    let hasTestCase = false;
    let hasSteps = false;
    for (let c = 0; c < Math.min(row.length, 30); c++) {
      const label = String(row[c] ?? "").trim();
      if (!label) continue;
      const autoKey = autoDetectColumnKey(label);
      labels.push({ index: c, label, autoKey });
      if (autoKey === "testCase") hasTestCase = true;
      if (autoKey === "steps") hasSteps = true;
    }
    if (hasTestCase && hasSteps && labels.length >= 2) {
      return {
        headers: labels,
        autoMap: buildColumnMap(row),
        rowIndex: i,
      };
    }
  }
  return null;
}

/**
 * Parse a spreadsheet/CSV buffer and extract metadata + use-case/test-case/step data.
 * Execution columns (Actual Result, Status, Notes) are never imported.
 */
function parseImportFile(
  buffer: Buffer,
  columnOverrides?: Partial<Record<ImportColumnKey, number | null>>,
): {
  suggestedMetadata: SuggestedMetadata;
  parsedUseCases: ParsedUseCase[];
  warnings: Warning[];
  detectedHeaders: { index: number; label: string; autoKey: ImportColumnKey | null }[];
  columnMap: Record<string, number>;
  structureOnly: true;
  ignoredExecutionColumns: string[];
} {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Spreadsheet has no sheets");
  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rows.length === 0) throw new Error("Spreadsheet is empty");

  const suggestedMetadata: SuggestedMetadata = {
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

  function extractMetadata(label: string, value: string) {
    const lc = label.toLowerCase();
    if (lc.startsWith("project name")) suggestedMetadata.projectName = value || null;
    else if (lc.startsWith("module name")) suggestedMetadata.moduleName = value || null;
    else if (/^test designed by/i.test(label)) suggestedMetadata.designedBy = value || null;
    else if (/^test designed date/i.test(label)) {
      if (value && /^\d+(\.\d+)?$/.test(value)) {
        const parsed = XLSX.SSF.parse_date_code(Number(value));
        if (parsed) {
          const y = parsed.y ?? 1900;
          const m = String(parsed.m ?? 1).padStart(2, "0");
          const d = String(parsed.d ?? 1).padStart(2, "0");
          suggestedMetadata.designDate = `${y}-${m}-${d}`;
        }
      } else {
        suggestedMetadata.designDate = value || null;
      }
    } else if (/^release version/i.test(label)) suggestedMetadata.releaseVersion = value || null;
    else if (lc.startsWith("pre-condition") || lc.startsWith("precondition"))
      suggestedMetadata.precondition = value || null;
    else if (lc.startsWith("objectives") || lc.startsWith("objective"))
      suggestedMetadata.objectives = value || null;
    else if (lc.startsWith("in scope") || lc === "scope")
      suggestedMetadata.scope = value || null;
    else if (lc.startsWith("out of scope"))
      suggestedMetadata.outOfScope = value || null;
    else if (lc.startsWith("entry criteria") || lc.startsWith("entry"))
      suggestedMetadata.entryCriteria = value || null;
    else if (lc.startsWith("exit criteria") || lc.startsWith("exit"))
      suggestedMetadata.exitCriteria = value || null;
  }

  let dataStartRow = 0;
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const row = rows[i] as any;
    const cell0 = String(row[0] ?? "").trim();
    const cell1 = String(row[1] ?? "").trim();
    const cell3 = String(row[3] ?? "").trim();
    const cell4 = String(row[4] ?? "").trim();

    extractMetadata(cell0, cell1);
    if (cell3) extractMetadata(cell3, cell4);

    if (/^Use Case\s+/i.test(cell0)) {
      dataStartRow = i;
      break;
    }
  }

  const headerInfo = detectHeaderRow(rows);
  const detectedHeaders = headerInfo?.headers ?? [];
  let defaultMap = headerInfo?.autoMap ?? {};

  const parsedUseCases: ParsedUseCase[] = [];
  let currentUseCase: ParsedUseCase | null = null;
  let currentTestCase: ParsedTestCase | null = null;
  let columnMap: Record<string, number> | null = null;
  let lastAppliedMap: Record<string, number> = {};

  const UC_REGEX = /^Use Case\s+([\w-]+):\s*(.*)$/i;

  // Flat CSV without "Use Case" headers: create a single default scenario
  const hasUseCaseHeaders = rows.some((r) => /^Use Case\s+/i.test(String((r as any)?.[0] ?? "").trim()));

  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i] as any;
    const cell0 = String(row[0] ?? "").trim();

    const ucMatch = cell0.match(UC_REGEX);
    if (ucMatch) {
      if (currentUseCase && currentTestCase) {
        currentUseCase.testCases.push(currentTestCase);
        currentTestCase = null;
      }
      currentUseCase = {
        code: ucMatch[1],
        name: ucMatch[2] || ucMatch[1],
        testCases: [],
      };
      parsedUseCases.push(currentUseCase);
      columnMap = null;
      currentTestCase = null;
      continue;
    }

    if (!currentUseCase) {
      if (!hasUseCaseHeaders && headerInfo && i === headerInfo.rowIndex) {
        // Fall through to header detection below after creating default UC
        currentUseCase = {
          code: "UC-01",
          name: suggestedMetadata.moduleName || suggestedMetadata.projectName || "Imported Scenarios",
          testCases: [],
        };
        parsedUseCases.push(currentUseCase);
      } else if (!hasUseCaseHeaders && headerInfo && i > headerInfo.rowIndex) {
        if (!currentUseCase) {
          currentUseCase = {
            code: "UC-01",
            name: suggestedMetadata.moduleName || suggestedMetadata.projectName || "Imported Scenarios",
            testCases: [],
          };
          parsedUseCases.push(currentUseCase);
        }
      } else {
        continue;
      }
    }

    const clean0 = cell0.toLowerCase().replace(/[#\s]/g, "");
    if (clean0 === "testcase" || clean0 === "testcase#" || /^test\s*case/i.test(cell0)) {
      columnMap = buildColumnMap(row, columnOverrides);
      lastAppliedMap = columnMap;
      currentTestCase = null;
      continue;
    }

    // Flat file: first header row already detected — apply map once
    if (!columnMap && headerInfo && i === headerInfo.rowIndex) {
      columnMap = buildColumnMap(row, columnOverrides);
      lastAppliedMap = columnMap;
      currentTestCase = null;
      continue;
    }

    if (!columnMap && headerInfo && !hasUseCaseHeaders && i > headerInfo.rowIndex) {
      columnMap = buildColumnMap(
        rows[headerInfo.rowIndex] as unknown[],
        columnOverrides,
      );
      lastAppliedMap = columnMap;
    }

    if (!columnMap) continue;

    const tcIdx = columnMap["testCase"];
    const titleIdx = columnMap["title"];
    const stepsIdx = columnMap["steps"];
    const dataIdx = columnMap["testData"];
    const expectedIdx = columnMap["expectedResult"];
    const precondIdx = columnMap["precondition"];

    const testCaseCell = tcIdx != null ? String(row[tcIdx] ?? "").trim() : "";
    const stepsCell = stepsIdx != null ? String(row[stepsIdx] ?? "").trim() : "";

    if (testCaseCell && stepsCell) {
      if (currentTestCase) {
        currentUseCase!.testCases.push(currentTestCase);
      }
      const titleCell = titleIdx != null ? String(row[titleIdx] ?? "").trim() : "";
      currentTestCase = {
        caseNumber: testCaseCell,
        title: titleCell || testCaseCell,
        precondition: precondIdx != null ? String(row[precondIdx] ?? "").trim() || null : null,
        steps: [
          {
            instruction: stepsCell,
            testData: dataIdx != null ? String(row[dataIdx] ?? "").trim() || null : null,
            expectedResult: expectedIdx != null ? String(row[expectedIdx] ?? "").trim() || null : null,
          },
        ],
      };
    } else if (!testCaseCell && stepsCell && currentTestCase) {
      currentTestCase.steps.push({
        instruction: stepsCell,
        testData: dataIdx != null ? String(row[dataIdx] ?? "").trim() || null : null,
        expectedResult: expectedIdx != null ? String(row[expectedIdx] ?? "").trim() || null : null,
      });
    }
  }

  if (currentUseCase && currentTestCase) {
    currentUseCase.testCases.push(currentTestCase);
  }

  // If overrides provided but no per-section header was hit, ensure map reflects overrides
  if (columnOverrides && Object.keys(lastAppliedMap).length === 0 && headerInfo) {
    lastAppliedMap = buildColumnMap(rows[headerInfo.rowIndex] as unknown[], columnOverrides);
  }
  if (Object.keys(lastAppliedMap).length === 0) {
    lastAppliedMap = defaultMap;
    if (columnOverrides) {
      lastAppliedMap = buildColumnMap(
        headerInfo ? (rows[headerInfo.rowIndex] as unknown[]) : [],
        columnOverrides,
      );
    }
  }

  const warnings: Warning[] = [];
  for (const uc of parsedUseCases) {
    const realCases = uc.testCases.filter((tc) =>
      tc.steps.some((s) => s.instruction.trim())
    );
    if (realCases.length === 0) {
      warnings.push({
        useCaseCode: uc.code,
        useCaseName: uc.name,
        reason:
          "Use case has no test cases with step content — likely a copy-paste leftover or empty section.",
      });
      continue;
    }

    for (const other of parsedUseCases) {
      if (other === uc) break;
      if (other.testCases.length === 0 || uc.testCases.length === 0) continue;
      if (other.testCases.length !== uc.testCases.length) continue;

      const isDuplicate = other.testCases.every((otc, idx) => {
        const utc = uc.testCases[idx];
        if (!utc) return false;
        if (otc.title !== utc.title) return false;
        return otc.steps.every((os, si) => {
          const us = utc.steps[si];
          return us && os.instruction === us.instruction;
        });
      });

      if (isDuplicate) {
        warnings.push({
          useCaseCode: uc.code,
          useCaseName: uc.name,
          reason: `Content is a near-exact duplicate of use case "${other.code}: ${other.name}". May be a copy-paste leftover.`,
        });
      }
    }
  }

  const ignoredExecutionColumns = detectedHeaders
    .filter((h) => h.autoKey && EXECUTION_KEYS.includes(h.autoKey))
    .map((h) => h.label);

  return {
    suggestedMetadata,
    parsedUseCases,
    warnings,
    detectedHeaders,
    columnMap: lastAppliedMap,
    structureOnly: true,
    ignoredExecutionColumns,
  };
}

function parseColumnOverrides(raw: unknown): Partial<Record<ImportColumnKey, number | null>> | undefined {
  if (raw == null || raw === "") return undefined;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== "object") return undefined;
  const out: Partial<Record<ImportColumnKey, number | null>> = {};
  for (const key of [...STRUCTURE_KEYS, ...EXECUTION_KEYS]) {
    if (key in (obj as object)) {
      const v = (obj as any)[key];
      if (v === null || v === "" || v === -1) out[key] = null;
      else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
      else if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) out[key] = Number(v);
    }
  }
  return out;
}

function previewPayload(parsed: ReturnType<typeof parseImportFile>) {
  return {
    suggestedProjectMetadata: parsed.suggestedMetadata,
    useCases: parsed.parsedUseCases,
    warnings: parsed.warnings,
    totals: {
      useCases: parsed.parsedUseCases.length,
      testCases: parsed.parsedUseCases.reduce((s, uc) => s + uc.testCases.length, 0),
      steps: parsed.parsedUseCases.reduce(
        (s, uc) => s + uc.testCases.reduce((ss, tc) => ss + tc.steps.length, 0),
        0,
      ),
    },
    detectedHeaders: parsed.detectedHeaders,
    columnMap: parsed.columnMap,
    structureOnly: true as const,
    ignoredExecutionColumns: parsed.ignoredExecutionColumns,
    mappableFields: [
      { key: "testCase", label: "Test Case #", required: true },
      { key: "title", label: "Title", required: false },
      { key: "steps", label: "Steps", required: true },
      { key: "testData", label: "Test Data", required: false },
      { key: "expectedResult", label: "Expected Result", required: false },
      { key: "precondition", label: "Precondition", required: false },
    ],
    note: "Import is structure-only. Actual Result, Status (Pass/Fail), and Notes columns are never imported.",
  };
}

// POST /api/import/preview — dry-run parse without requiring a project
router.post(
  "/import/preview",
  authenticate,
  upload.single("file"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No file uploaded" });
        return;
      }

      const overrides = parseColumnOverrides((req.body as any)?.columnMap);
      const parsed = parseImportFile(req.file.buffer, overrides);
      res.json(previewPayload(parsed));
    } catch (err) {
      if (err instanceof Error && (err.message.includes("Invalid file type") || err.message.includes("Spreadsheet") || err.message.includes("empty"))) {
        res.status(400).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// POST /api/projects/:projectId/import
router.post(
  "/projects/:projectId/import",
  authenticate,
  upload.single("file"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No file uploaded" });
        return;
      }

      const projectId = Number(req.params.projectId);
      if (!projectId) {
        res.status(400).json({ message: "projectId is required" });
        return;
      }

      const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD", "TEST_AUTHOR"]);
      if (!allowed && req.user!.role !== "ADMIN") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const dryRun = req.query.dryRun === "true";
      const overrides = parseColumnOverrides((req.body as any)?.columnMap);
      const parsed = parseImportFile(req.file.buffer, overrides);

      if (dryRun) {
        res.json(previewPayload(parsed));
        return;
      }

      let useCasesCreated = 0;
      let testCasesCreated = 0;
      let stepsCreated = 0;

      await db.transaction(async (tx) => {
        for (const uc of parsed.parsedUseCases) {
          const warning = parsed.warnings.find(
            (w) =>
              w.useCaseCode === uc.code &&
              w.reason.includes("no test cases with step content")
          );
          if (warning) continue;

          const maxSort = await tx
            .select({ max: sql<number>`MAX(${schema.useCases.sort_order})` })
            .from(schema.useCases)
            .where(eq(schema.useCases.project_id, projectId));
          const nextSort = (maxSort[0]?.max ?? -1) + 1;

          const [insertedUseCase] = await tx
            .insert(schema.useCases)
            .values({
              project_id: projectId,
              code: uc.code,
              name: uc.name,
              sort_order: nextSort,
            })
            .returning();

          useCasesCreated++;

          for (const tc of uc.testCases) {
            const maxTcSort = await tx
              .select({ max: sql<number>`MAX(${schema.testCases.sort_order})` })
              .from(schema.testCases)
              .where(eq(schema.testCases.use_case_id, insertedUseCase.id));
            const nextTcSort = (maxTcSort[0]?.max ?? -1) + 1;

            const [insertedTestCase] = await tx
              .insert(schema.testCases)
              .values({
                use_case_id: insertedUseCase.id,
                case_number: tc.caseNumber,
                title: tc.title,
                precondition: tc.precondition,
                sort_order: nextTcSort,
              })
              .returning();

            testCasesCreated++;

            for (let si = 0; si < tc.steps.length; si++) {
              const step = tc.steps[si];
              const stepNumber = String(si + 1);

              await tx.insert(schema.testSteps).values({
                test_case_id: insertedTestCase.id,
                step_number: stepNumber,
                instruction: step.instruction,
                test_data: step.testData,
                expected_result: step.expectedResult,
              });

              stepsCreated++;
            }
          }
        }

        await bumpProjectVersion(projectId, tx);
      });
      await logAudit({
        entityType: "project",
        entityId: projectId,
        changedByUserId: req.user!.userId,
        toStatus: "imported_test_cases",
      });

      res.json({
        useCasesCreated,
        testCasesCreated,
        stepsCreated,
        warnings: parsed.warnings,
        suggestedProjectMetadata: null,
        structureOnly: true,
      });
    } catch (err) {
      if (err instanceof Error && (err.message.includes("Invalid file type") || err.message.includes("Spreadsheet") || err.message.includes("empty"))) {
        res.status(400).json({ message: err.message });
        return;
      }
      next(err);
    }
  }
);

export default router;
