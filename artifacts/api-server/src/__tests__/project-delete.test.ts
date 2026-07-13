/**
 * Project Deletion Endpoint Integration Tests
 *
 * Run: npx tsx --env-file=.env src/__tests__/project-delete.test.ts
 *
 * Tests:
 * - confirmName validation (missing, mismatch → 400)
 * - correct confirmName → 204
 * - non-ADMIN role → 403
 * - attachment cleanup (DB rows and files)
 */

import { describe, it, expect } from "./test-runner.js";
import { db } from "../db.js";
import { eq } from "drizzle-orm";
import * as schema from "@workspace/db";
import jwt from "jsonwebtoken";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import app from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function createProject(name: string) {
  const { body } = await api("/projects", adminToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      designedBy: "Tester",
      moduleName: "Test Module",
      designDate: "2026-07-01",
      testLeadId: 1,
    }),
  });
  return body;
}

describe("DELETE /api/projects/:projectId — confirmName validation", () => {
  it("returns 400 when confirmName is missing", async () => {
    const proj = await createProject("Delete No Confirm");
    const { status, body } = await api(`/projects/${proj.id}`, adminToken, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.message).toBe("confirmName is required");
  });

  it("returns 400 when confirmName does not match", async () => {
    const proj = await createProject("Delete Mismatch");
    const { status, body } = await api(`/projects/${proj.id}`, adminToken, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "wrong name" }),
    });
    expect(status).toBe(400);
    expect(body.message).toBe("confirmName does not match project name");
  });

  it("returns 204 when confirmName matches (case-sensitive)", async () => {
    const proj = await createProject("Delete Correct Match");
    const { status } = await api(`/projects/${proj.id}`, adminToken, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "Delete Correct Match" }),
    });
    expect(status).toBe(204);

    // Verify project is actually gone
    const { status: getStatus } = await api(`/projects/${proj.id}`, adminToken);
    expect(getStatus).toBe(404);
  });

  it("returns 204 when confirmName matches on a project with use cases and test runs", async () => {
    const proj = await createProject("Delete With Data");
    // Create a use case and test run so the project has data
    await api(`/use-cases?projectId=${proj.id}`, adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "UC-DEL", name: "Delete UC" }),
    });
    await api("/test-runs", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: proj.id, name: "Delete Run" }),
    });

    const { status } = await api(`/projects/${proj.id}`, adminToken, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "Delete With Data" }),
    });
    expect(status).toBe(204);
  });
});

describe("DELETE /api/projects/:projectId — authorization", () => {
  it("returns 403 for non-ADMIN role", async () => {
    const proj = await createProject("Delete Auth Test");
    const { status } = await api(`/projects/${proj.id}`, testerToken, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "Delete Auth Test" }),
    });
    expect(status).toBe(403);
  });
});

describe("DELETE /api/projects/:projectId — attachment cleanup", () => {
  it("removes attachment rows and files when deleting a project with defects and test runs", async () => {
    const proj = await createProject("Delete Attachments Test");

    // Create a use case (needed for test run creation)
    await api(`/use-cases?projectId=${proj.id}`, adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "UC-ATT", name: "Attach UC" }),
    });

    // Create a test run via API
    const { body: run } = await api("/test-runs", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: proj.id, name: "Attach Run" }),
    });
    expect(run.id).not.toBe(undefined);

    // Insert a defect directly (test_run_id is required, test_case_id must reference a real test case)
    const firstUseCase = await db.query.useCases.findFirst({ where: eq(schema.useCases.project_id, proj.id) });
    const [tc] = await db.insert(schema.testCases).values({
      use_case_id: firstUseCase!.id,
      case_number: "1",
      title: "Attach TC",
    }).returning();
    const [defect] = await db.insert(schema.defects).values({
      project_id: proj.id,
      test_run_id: run.id,
      test_case_id: tc.id,
      ticket_type: "defect",
      status: "NEW",
    }).returning();

    // Insert attachment rows for both defect and test_run
    await db.insert(schema.attachments).values([
      {
        entity_type: "defect",
        entity_id: defect.id,
        file_name: "defect-report.pdf",
        file_url: "/uploads/delete-test-defect.pdf",
        file_type: "application/pdf",
      },
      {
        entity_type: "test_run",
        entity_id: run.id,
        file_name: "run-log.xlsx",
        file_url: "/uploads/delete-test-run.xlsx",
        file_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ]);

    // Create dummy files on disk
    const uploadsDir = path.join(__dirname, "../../uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, "delete-test-defect.pdf"), "dummy");
    fs.writeFileSync(path.join(uploadsDir, "delete-test-run.xlsx"), "dummy");

    // Confirm attachments exist before delete
    const beforeAttachments = await db.query.attachments.findMany({
      where: eq(schema.attachments.file_name, "defect-report.pdf"),
    });
    expect(beforeAttachments.length).toBe(1);

    const { status } = await api(`/projects/${proj.id}`, adminToken, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "Delete Attachments Test" }),
    });
    expect(status).toBe(204);

    // Verify attachment rows are gone (query by known file names)
    const afterDefectAtt = await db.query.attachments.findMany({
      where: eq(schema.attachments.file_name, "defect-report.pdf"),
    });
    expect(afterDefectAtt.length).toBe(0);
    const afterRunAtt = await db.query.attachments.findMany({
      where: eq(schema.attachments.file_name, "run-log.xlsx"),
    });
    expect(afterRunAtt.length).toBe(0);

    // Verify project is gone
    const { status: getStatus } = await api(`/projects/${proj.id}`, adminToken);
    expect(getStatus).toBe(404);

    // Verify files are cleaned up from disk (best-effort)
    expect(fs.existsSync(path.join(uploadsDir, "delete-test-defect.pdf"))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir, "delete-test-run.xlsx"))).toBe(false);
  });
});

process.on("exit", () => {
  server.close();
});
