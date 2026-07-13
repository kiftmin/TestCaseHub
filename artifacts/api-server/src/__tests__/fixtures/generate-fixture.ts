/**
 * Generate test fixture .xlsx for import tests with cell styling.
 *
 * Run: node node_modules/.pnpm/tsx@4.22.3/node_modules/tsx/dist/cli.mjs
 *   artifacts/api-server/src/__tests__/fixtures/generate-fixture.ts
 */
import ExcelJS from "exceljs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wb = new ExcelJS.Workbook();
wb.creator = "TestCaseHub";
const ws = wb.addWorksheet("TestPlan");
ws.properties.defaultColWidth = 18;

// Columns: A-I widths
ws.getColumn(1).width = 14;  // Test Case#
ws.getColumn(2).width = 20;  // Test Title
ws.getColumn(3).width = 28;  // Test Steps
ws.getColumn(4).width = 18;  // Test Data
ws.getColumn(5).width = 24;  // Expected Result
ws.getColumn(6).width = 18;  // Actual Result
ws.getColumn(7).width = 18;  // Status
ws.getColumn(8).width = 16;  // Notes
ws.getColumn(9).width = 22;  // Precondition

const greyFill: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" },
};

const whiteFill: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFFFF" },
};

function addRow(cells: any[], style?: Partial<ExcelJS.Style>) {
  return ws.addRow(cells);
}

function greyCells(row: number, ...cols: number[]) {
  for (const c of cols) {
    const cell = ws.getCell(row, c);
    cell.fill = greyFill;
  }
}

let r = 1;

// Header rows
ws.getCell(r, 1).value = "Project Name:";  ws.getCell(r, 2).value = "Test Import Project"; r++;
ws.getCell(r, 1).value = "Module Name:";    ws.getCell(r, 2).value = "Imports"; r++;
ws.getCell(r, 1).value = "Test Designed by:"; ws.getCell(r, 2).value = "Tester"; r++;
ws.getCell(r, 1).value = "Test Designed date:"; ws.getCell(r, 2).value = "2026-07-01"; r++;
ws.getCell(r, 1).value = "Release Version:"; ws.getCell(r, 2).value = "1.0"; r++;
ws.getCell(r, 1).value = "Objectives:";   ws.getCell(r, 2).value = "Verify the core banking workflows for the Q4 release."; r++;
ws.getCell(r, 1).value = "In Scope:";      ws.getCell(r, 2).value = "Mobile transfer, account linking, biometric login"; r++;
ws.getCell(r, 1).value = "Out of Scope:";  ws.getCell(r, 2).value = "Web banking, ATM flow, fraud detection"; r++;
ws.getCell(r, 1).value = "Entry Criteria:"; ws.getCell(r, 2).value = "Build deployed to staging, test accounts provisioned"; r++;
ws.getCell(r, 1).value = "Exit Criteria:";  ws.getCell(r, 2).value = "100% critical scenarios passed, no P1 defects open"; r++;
r++; // blank

// Use case 1
ws.getCell(r, 1).value = "Use Case UC-01: Verify Login";
ws.getCell(r, 1).font = { bold: true }; r++;

// Column headers
const headerCells = ["Test Case#", "Test Title", "Test Steps", "Test Data", "Expected Result", "Actual Result", "Status(Pass/Fail)", "Notes", "Precondition"];
headerCells.forEach((v, i) => { ws.getCell(r, i + 1).value = v; });
// Grey Actual Result, Status, Notes, Precondition column headers
greyCells(r, 6, 7, 8);
r++;

// UC-01 data rows
const uc01Rows = [
  ["1", "Valid login",   "(i) Enter username",  "admin",   "Login succeeds"],
  ["",   "",              "(ii) Enter password", "pass123", "Password accepted"],
  ["",   "",              "(iii) Click login",   "",        "Dashboard visible"],
  ["2", "Invalid login", "Enter wrong credentials", "bad/pass", "Error shown"],
];
for (let i = 0; i < uc01Rows.length; i++) {
  const row = uc01Rows[i];
  row.forEach((v, ci) => { ws.getCell(r, ci + 1).value = v; });
  // Grey execution columns on every data row
  greyCells(r, 6, 7, 8);
  // Step continuation rows: grey Test Title and Precondition
  if (!row[0] && row[2]) {
    greyCells(r, 2, 9);
  }
  // First row of TC "1" has precondition
  if (i === 0) ws.getCell(r, 9).value = "User must be registered";
  r++;
}

r++; // blank

// Use case 2
ws.getCell(r, 1).value = "Use Case UC-02: Invoice Management";
ws.getCell(r, 1).font = { bold: true }; r++;

// Column headers
headerCells.forEach((v, i) => { ws.getCell(r, i + 1).value = v; });
greyCells(r, 6, 7, 8);
r++;

// UC-02 data rows
const uc02Rows = [
  ["1", "Create invoice",  "Fill invoice form",  "inv-001", "Invoice created"],
  ["1A", "Approve invoice", "Click approve",     "inv-001", "Status changes to approved"],
];
for (let i = 0; i < uc02Rows.length; i++) {
  const row = uc02Rows[i];
  row.forEach((v, ci) => { ws.getCell(r, ci + 1).value = v; });
  greyCells(r, 6, 7, 8);
  if (!row[0] && row[2]) {
    greyCells(r, 2, 9);
  }
  if (i === 0) ws.getCell(r, 9).value = "User logged in with billing role";
  r++;
}

r++; // blank

// Use case 3 (empty)
ws.getCell(r, 1).value = "Use Case UC-03: Empty use case";
ws.getCell(r, 1).font = { bold: true }; r++;
headerCells.forEach((v, i) => { ws.getCell(r, i + 1).value = v; });
greyCells(r, 6, 7, 8);

// Write fixtures
const fixturePath = path.join(__dirname, "valid-test-plan.xlsx");
await wb.xlsx.writeFile(fixturePath);
console.log(`Fixture written to ${fixturePath}`);

// Also write to repo root as demo
const root = path.resolve(__dirname, "../../../../../");
const demoPath = path.join(root, "demo-test-plan.xlsx");
await wb.xlsx.writeFile(demoPath);
console.log(`Written to ${demoPath}`);
