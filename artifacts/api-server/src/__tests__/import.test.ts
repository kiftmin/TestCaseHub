/**
 * Import Endpoint Integration Tests
 *
 * Run: npx tsx --env-file=.env src/__tests__/import.test.ts
 *
 * NOTE: The custom test runner fires `it` blocks synchronously without
 * awaiting async results. Tests that share state must be in the same `it`
 * block or use a pattern that avoids race conditions.
 */

import { describe, it, expect } from "./test-runner.js";
import { db } from "../db.js";
import { eq } from "drizzle-orm";
import * as schema from "@workspace/db";
import jwt from "jsonwebtoken";
import { createServer } from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import app from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let server: ReturnType<typeof createServer>;
let baseUrl: string;

const adminToken = jwt.sign(
  { userId: 1, username: "admin", role: "ADMIN", iat: Math.floor(Date.now() / 1000) },
  process.env.SESSION_SECRET ?? "test-secret",
  { expiresIn: "1h" },
);

const testerToken = jwt.sign(
  { userId: 2, username: "tester", role: "USER", iat: Math.floor(Date.now() / 1000) },
  process.env.SESSION_SECRET ?? "test-secret",
  { expiresIn: "1h" },
);

const serverReady = new Promise<void>((resolve) => {
  server = createServer(app);
  server.listen(0, () => {
    const addr = server.address();
    baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
    resolve();
  });
});

async function api(path: string, token = adminToken, options: RequestInit = {}) {
  await serverReady;
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body: body as any };
}

describe("POST /api/projects/:projectId/import", () => {
  it("full import flow: creates project, imports xlsx, verifies counts + step numbers + warnings + version bump", async () => {
    // Create project
    const { status: s1, body: proj } = await api("/projects", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Import Test",
        designedBy: "Tester",
        moduleName: "Test Module",
        designDate: "2026-07-01",
        testLeadId: 1,
      }),
    });
    expect(s1).toBe(201);
    const pid = proj.id;

    // Check version before
    const versionBefore = (await db.query.projects.findFirst({
      where: eq(schema.projects.id, pid),
      columns: { version: true },
    }))?.version ?? -1;

    // Upload and import
    const fixture = readFileSync(join(__dirname, "fixtures", "valid-test-plan.xlsx"));
    const formData = new FormData();
    formData.append("file", new Blob([fixture], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), "test-plan.xlsx");

    const { status: s2, body: result } = await api(`/projects/${pid}/import`, adminToken, {
      method: "POST",
      body: formData,
    });
    expect(s2).toBe(200);
    expect(result.useCasesCreated).toBe(2);
    expect(result.testCasesCreated).toBe(4);
    expect(result.stepsCreated).toBe(6);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].useCaseCode).toBe("UC-03");

    // Verify single version bump
    const versionAfter = (await db.query.projects.findFirst({
      where: eq(schema.projects.id, pid),
      columns: { version: true },
    }))?.version ?? -1;
    expect(versionAfter - versionBefore).toBe(1);

    // Verify step_number values are clean sequential ordinals
    const { body: useCases } = await api(`/use-cases?projectId=${pid}`, adminToken);
    for (const uc of useCases) {
      if (!uc.testCases) continue;
      for (const tc of uc.testCases) {
        if (!tc.steps) continue;
        tc.steps.forEach((step: any, idx: number) => {
          expect(step.step_number).toBe(String(idx + 1));
        });
      }
    }

    // Verify original labels preserved in instruction
    const uc01 = useCases.find((uc: any) => uc.code === "UC-01");
    expect(uc01).not.toBe(undefined);
    const tc1 = uc01.testCases.find((tc: any) => tc.case_number === "1");
    expect(tc1).not.toBe(undefined);
    expect(tc1.steps[0].instruction).toBe("(i) Enter username");
    expect(tc1.steps[0].test_data).toBe("admin");
    expect(tc1.steps[0].expected_result).toBe("Login succeeds");
  });

  it("returns 400 when no file is uploaded", async () => {
    // Create temp project
    const { body: proj } = await api("/projects", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Temp", designedBy: "T", moduleName: "M", designDate: "2026-01-01", testLeadId: 1 }),
    });
    const { status } = await api(`/projects/${proj.id}/import`, adminToken, { method: "POST" });
    expect(status).toBe(400);
  });

  it("returns 403 for TESTER role", async () => {
    const { body: proj } = await api("/projects", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Temp2", designedBy: "T", moduleName: "M", designDate: "2026-01-01", testLeadId: 1 }),
    });
    const fixture = readFileSync(join(__dirname, "fixtures", "valid-test-plan.xlsx"));
    const formData = new FormData();
    formData.append("file", new Blob([fixture], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), "test-plan.xlsx");

    const { status } = await api(`/projects/${proj.id}/import`, testerToken, {
      method: "POST",
      body: formData,
    });
    expect(status).toBe(403);
  });
});

describe("Part 3 — precondition round-trip", () => {
  it("creates a test case with precondition, updates, and clears it", async () => {
    // Create project + use case
    const { body: proj } = await api("/projects", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Precond Test", designedBy: "T", moduleName: "M", designDate: "2026-01-01", testLeadId: 1 }),
    });
    const { body: uc } = await api(`/use-cases?projectId=${proj.id}`, adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "UC-PC", name: "Precondition UC" }),
    });
    expect(uc.id).not.toBe(undefined);
    const ucId = uc.id;

    // Create test case WITH precondition
    const { status: s1, body: tc1 } = await api("/test-cases", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        use_case_id: ucId,
        case_number: "TC-PC-01",
        title: "With precond",
        precondition: "Invoice must exist",
      }),
    });
    expect(s1).toBe(201);
    expect(tc1.precondition).toBe("Invoice must exist");
    const tcId = tc1.id;

    // Create test case WITHOUT precondition (optional)
    const { status: s2, body: tc2 } = await api("/test-cases", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        use_case_id: ucId,
        case_number: "TC-PC-02",
        title: "No precond",
      }),
    });
    expect(s2).toBe(201);
    expect(tc2.precondition).toBe(null);

    // Update precondition
    const { status: s3, body: updated } = await api(`/test-cases/${tcId}`, adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precondition: "Updated precondition" }),
    });
    expect(s3).toBe(200);
    expect(updated.precondition).toBe("Updated precondition");

    // Clear precondition (sends null)
    const { status: s4, body: cleared } = await api(`/test-cases/${tcId}`, adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precondition: null }),
    });
    expect(s4).toBe(200);
    expect(cleared.precondition).toBe(null);
  });
});
