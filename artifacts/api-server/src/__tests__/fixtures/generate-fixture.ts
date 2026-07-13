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
  ["Pre-condition :", "User is logged in"],
  [],
  ["Use Case UC-01: Verify Login"],
  ["Test Case#", "Test Title", "Test Steps", "Test Data", "Expected Result", "Actual Result", "Status(Pass/Fail)", "Notes"],
  ["1", "Valid login", "(i) Enter username", "admin", "Login succeeds", "", "", ""],
  ["", "", "(ii) Enter password", "pass123", "Password accepted", "", "", ""],
  ["", "", "(iii) Click login", "", "Dashboard visible", "", "", ""],
  ["2", "Invalid login", "Enter wrong credentials", "bad/pass", "Error shown", "", "", ""],
  [],
  ["Use Case UC-02: Invoice Management"],
  ["Test Case#", "Test Title", "Test Steps", "Test Data", "Expected Result", "Actual Result", "Status(Pass/Fail)", "Notes"],
  ["1", "Create invoice", "Fill invoice form", "inv-001", "Invoice created", "", "", ""],
  ["1A", "Approve invoice", "Click approve", "inv-001", "Status changes to approved", "", "", ""],
  [],
  ["Use Case UC-03: Empty use case"],
  ["Test Case#", "Test Title", "Test Steps", "Test Data", "Expected Result", "Actual Result", "Status(Pass/Fail)", "Notes"],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(wb, ws, "TestPlan");

const outPath = path.join(__dirname, "valid-test-plan.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`Fixture written to ${outPath}`);
