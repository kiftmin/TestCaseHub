/**
 * Generate test fixture .xlsx for import tests.
 *
 * Run: npx tsx artifacts/api-server/src/__tests__/fixtures/generate-fixture.ts
 */
import * as XLSX from "xlsx";
import * as fs from "fs";
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
XLSX.utils.book_append_sheet(wb, ws, "TestPlan");

const outPath = path.join(__dirname, "valid-test-plan.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`Fixture written to ${outPath}`);
