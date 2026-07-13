/**
 * Generate test fixture .xlsx for import tests with cell styling.
 *
 * Run: node node_modules/.pnpm/tsx@4.22.3/node_modules/tsx/dist/cli.mjs
 *   artifacts/api-server/src/__tests__/fixtures/generate-fixture.ts
 */
import * as XLSX from "xlsx";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wb = XLSX.utils.book_new();

const rows: any[][] = [
  ["Project Name:", "Test Import Project"],
  ["Module Name:", "Imports"],
  ["Test Designed by:", "Tester"],
  ["Test Designed date:", "2026-07-01"],
  ["Release Version:", "1.0"],
  ["Objectives:", "Verify the core banking workflows for the Q4 release."],
  ["In Scope:", "Mobile transfer, account linking, biometric login"],
  ["Out of Scope:", "Web banking, ATM flow, fraud detection"],
  ["Entry Criteria:", "Build deployed to staging, test accounts provisioned"],
  ["Exit Criteria:", "100% critical scenarios passed, no P1 defects open"],
  [],
  ["Use Case UC-01: Verify Login"],
  ["Test Case#", "Test Title", "Test Steps", "Test Data", "Expected Result", "Actual Result", "Status(Pass/Fail)", "Notes", "Precondition"],
  ["1", "Valid login", "(i) Enter username", "admin", "Login succeeds", "", "", "", "User must be registered"],
  ["", "", "(ii) Enter password", "pass123", "Password accepted", "", "", "", ""],
  ["", "", "(iii) Click login", "", "Dashboard visible", "", "", "", ""],
  ["2", "Invalid login", "Enter wrong credentials", "bad/pass", "Error shown", "", "", "", ""],
  [],
  ["Use Case UC-02: Invoice Management"],
  ["Test Case#", "Test Title", "Test Steps", "Test Data", "Expected Result", "Actual Result", "Status(Pass/Fail)", "Notes", "Precondition"],
  ["1", "Create invoice", "Fill invoice form", "inv-001", "Invoice created", "", "", "", "User logged in with billing role"],
  ["1A", "Approve invoice", "Click approve", "inv-001", "Status changes to approved", "", "", "", ""],
  [],
  ["Use Case UC-03: Empty use case"],
  ["Test Case#", "Test Title", "Test Steps", "Test Data", "Expected Result", "Actual Result", "Status(Pass/Fail)", "Notes", "Precondition"],
];

const ws = XLSX.utils.aoa_to_sheet(rows);

// Apply styling
const greyFill = { patternType: "solid", fgColor: { rgb: "F2F2F2" } };

function styleCell(r: number, c: number, fill: typeof greyFill) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (ws[addr]) {
    ws[addr].s = { fill };
  }
}

// Helper: find rows containing test case data (used for styling step continuations)
// Step continuation rows have empty col 0 ("Test Case#") but non-empty col 2 ("Test Steps")
const dataStartRow = rows.findIndex((r) => /^Use Case\s+/i.test(String(r[0] ?? "")));
for (let i = dataStartRow; i < rows.length; i++) {
  const r = rows[i];
  const testCaseCell = String(r[0] ?? "").trim();
  const stepsCell = String(r[2] ?? "").trim();

  // Detect column header row
  const clean0 = testCaseCell.toLowerCase().replace(/[#\s]/g, "");
  const isHeader = clean0 === "testcase" || clean0 === "testcase#" || /^test\s*case/i.test(testCaseCell);

  if (isHeader) {
    // Grey out "Actual Result", "Status", "Notes", "Precondition" column headers
    styleCell(i, 5, greyFill);
    styleCell(i, 6, greyFill);
    styleCell(i, 7, greyFill);
    continue;
  }

  // Grey out "Actual Result", "Status", "Notes" entirely (not imported)
  styleCell(i, 5, greyFill);
  styleCell(i, 6, greyFill);
  styleCell(i, 7, greyFill);

  // If this is a step continuation row (no Test Case#, has steps), grey out
  // "Test Title" and "Precondition" — these are set at the test case level only
  if (!testCaseCell && stepsCell) {
    styleCell(i, 1, greyFill);
    styleCell(i, 8, greyFill);
  }
}

XLSX.utils.book_append_sheet(wb, ws, "TestPlan");

const outPath = path.join(__dirname, "valid-test-plan.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`Fixture written to ${outPath}`);

// Also write to repo root
const root = path.resolve(__dirname, "../../../../../");
XLSX.writeFile(wb, path.join(root, "demo-test-plan.xlsx"));
console.log(`Written to ${path.join(root, "demo-test-plan.xlsx")}`);
