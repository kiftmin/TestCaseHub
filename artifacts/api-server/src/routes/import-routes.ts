import express from "express";
import { eq, sql } from "drizzle-orm";
import multer from "multer";
import * as XLSX from "xlsx";
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
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only .xlsx and .xls are allowed."));
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
}

interface Warning {
  useCaseCode: string;
  useCaseName: string;
  reason: string;
}

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

      // Parse workbook
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        res.status(400).json({ message: "Spreadsheet has no sheets" });
        return;
      }
      const sheet = workbook.Sheets[sheetName];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      if (rows.length === 0) {
        res.status(400).json({ message: "Spreadsheet is empty" });
        return;
      }

      // Phase 1: Extract header-block metadata
      const suggestedMetadata: SuggestedMetadata = {
        projectName: null,
        moduleName: null,
        designedBy: null,
        designDate: null,
        releaseVersion: null,
        precondition: null,
      };

      let dataStartRow = 0;
      for (let i = 0; i < Math.min(rows.length, 50); i++) {
        const row = rows[i] as any;
        const cell0 = String(row[0] ?? "").trim();
        const cell1 = String(row[1] ?? "").trim();

        if (cell0.toLowerCase().startsWith("project name")) {
          suggestedMetadata.projectName = cell1 || null;
        } else if (cell0.toLowerCase().startsWith("module name")) {
          suggestedMetadata.moduleName = cell1 || null;
        } else if (/^test designed by/i.test(cell0)) {
          suggestedMetadata.designedBy = cell1 || null;
        } else if (/^test designed date/i.test(cell0)) {
          suggestedMetadata.designDate = cell1 || null;
        } else if (/^release version/i.test(cell0)) {
          suggestedMetadata.releaseVersion = cell1 || null;
        } else if (
          cell0.toLowerCase().startsWith("pre-condition") ||
          cell0.toLowerCase().startsWith("precondition")
        ) {
          suggestedMetadata.precondition = cell1 || null;
        }

        if (/^Use Case\s+/i.test(cell0)) {
          dataStartRow = i;
          break;
        }
      }

      // Phase 2: Parse use cases, test cases, steps
      const parsedUseCases: ParsedUseCase[] = [];
      let currentUseCase: ParsedUseCase | null = null;
      let currentTestCase: ParsedTestCase | null = null;
      let columnMap: Record<string, number> | null = null;

      const UC_REGEX = /^Use Case\s+([\w-]+):\s*(.*)$/i;

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

        if (!currentUseCase) continue;

        const clean0 = cell0.toLowerCase().replace(/[#\s]/g, "");
        if (clean0 === "testcase" || clean0 === "testcase#" || /^test\s*case/i.test(cell0)) {
          columnMap = buildColumnMap(row);
          currentTestCase = null;
          continue;
        }

        if (!columnMap) continue;

        const tcIdx = columnMap["testCase"];
        const titleIdx = columnMap["title"];
        const stepsIdx = columnMap["steps"];
        const dataIdx = columnMap["testData"];
        const expectedIdx = columnMap["expectedResult"];

        const testCaseCell = tcIdx != null ? String(row[tcIdx] ?? "").trim() : "";
        const stepsCell = stepsIdx != null ? String(row[stepsIdx] ?? "").trim() : "";

        if (testCaseCell && stepsCell) {
          if (currentTestCase) {
            currentUseCase.testCases.push(currentTestCase);
          }
          const titleCell = titleIdx != null ? String(row[titleIdx] ?? "").trim() : "";
          currentTestCase = {
            caseNumber: testCaseCell,
            title: titleCell || testCaseCell,
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

      // Phase 3: Detect warnings
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

      // Phase 4: Dry-run
      if (dryRun) {
        res.json({
          useCasesCreated: 0,
          testCasesCreated: 0,
          stepsCreated: 0,
          warnings,
          suggestedProjectMetadata: suggestedMetadata,
          detected: {
            useCases: parsedUseCases.length,
            testCases: parsedUseCases.reduce((s, uc) => s + uc.testCases.length, 0),
            steps: parsedUseCases.reduce(
              (s, uc) => s + uc.testCases.reduce((ss, tc) => ss + tc.steps.length, 0),
              0
            ),
          },
        });
        return;
      }

      // Phase 5: Transactional import
      let useCasesCreated = 0;
      let testCasesCreated = 0;
      let stepsCreated = 0;

      await db.transaction(async (tx) => {
        for (const uc of parsedUseCases) {
          const warning = warnings.find(
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
      });

      await bumpProjectVersion(projectId);
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
        warnings,
        suggestedProjectMetadata: null,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Invalid file type")) {
        res.status(400).json({ message: err.message });
        return;
      }
      next(err);
    }
  }
);

function buildColumnMap(headerRow: Record<string, string>): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < 20; i++) {
    const cell = String((headerRow as any)[i] ?? "")
      .trim()
      .toLowerCase()
      .replace(/[#\s]/g, "");

    if (/^testcase/.test(cell)) map["testCase"] = i;
    else if (/^testtitle/.test(cell) || /^title/i.test(cell)) map["title"] = i;
    else if (/^teststeps/.test(cell) || /^steps/i.test(cell)) map["steps"] = i;
    else if (/^testdata/.test(cell) || /^data/i.test(cell)) map["testData"] = i;
    else if (/^expectedresult/.test(cell) || /^expected/i.test(cell)) map["expectedResult"] = i;
    else if (/^actualresult/.test(cell) || /^actual/i.test(cell)) map["actualResult"] = i;
    else if (/^status/.test(cell)) map["status"] = i;
    else if (/^notes?$/.test(cell)) map["notes"] = i;
  }
  return map;
}

export default router;
