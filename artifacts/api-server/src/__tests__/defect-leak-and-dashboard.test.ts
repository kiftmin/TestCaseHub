/**
 * Integration tests for:
 *   Fix 1 — Removal of unprotected GET /discussions/:discussionId/defects/:defectId
 *   Fix 2 — Scoped GET /dashboard/summary per-user
 *
 * Run: npx tsx --env-file=.env src/__tests__/defect-leak-and-dashboard.test.ts
 */

import { describe, it, beforeAll, expect } from "./test-runner.js";
import { db } from "../db.js";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@workspace/db";
import jwt from "jsonwebtoken";
import { createServer } from "http";
import app from "../index.js";

const JWT_SECRET = process.env.SESSION_SECRET ?? "test-secret";

let server: ReturnType<typeof createServer>;
let baseUrl: string;

function makeToken(overrides: Partial<{ userId: number; username: string; role: string }> = {}) {
  return jwt.sign(
    { userId: overrides.userId ?? 1, username: overrides.username ?? "testuser", role: overrides.role ?? "ADMIN", iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function fetchApiAs(token: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body: body as any };
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

// ── Fix 1: Removed unprotected defect-leak endpoint ───────────────────────

describe("GET /discussions/:discussionId/defects/:defectId — removed", () => {
  let anyDefectId: number;

  beforeAll(async () => {
    const defect = await db.query.defects.findFirst({ columns: { id: true } });
    if (defect) anyDefectId = defect.id;
  });

  it("should return 404 (route no longer exists) for any authenticated user", async () => {
    if (!anyDefectId) return;
    const adminToken = makeToken();
    const { status } = await fetchApiAs(adminToken, `/discussions/1/defects/${anyDefectId}`);
    expect(status).toBe(404);
  });

  it("should return 404 even without a valid token (route does not exist)", async () => {
    if (!anyDefectId) return;
    const res = await fetch(`${baseUrl}/api/discussions/1/defects/${anyDefectId}`);
    expect(res.status).toBe(404);
  });
});

// ── Fix 1 regression: canonical GET /defects/:defectId still works ────────

describe("GET /defects/:defectId — canonical endpoint still works", () => {
  let existingDefect: { id: number; project_id: number } | undefined;
  let projectMember: { userId: number; username: string; role: string } | undefined;
  let unrelatedUser: { userId: number; username: string; role: string } | undefined;

  beforeAll(async () => {
    existingDefect = await db.query.defects.findFirst({
      columns: { id: true, project_id: true },
    });
    if (!existingDefect) return;

    // Find a user assigned to this defect's project
    const assignment = await db.query.projectAssignments.findFirst({
      where: eq(schema.projectAssignments.project_id, existingDefect.project_id),
      with: { user: { columns: { id: true, username: true, role: true } } },
    });
    if (assignment?.user) {
      projectMember = { userId: assignment.user.id, username: assignment.user.username, role: assignment.user.role };
    }

    // Find a user with ZERO overlap with this defect's project
    const allUsers = await db.query.users.findMany({
      where: eq(schema.users.is_active, true),
      columns: { id: true, username: true, role: true },
    });
    for (const u of allUsers) {
      const pa = await db.query.projectAssignments.findFirst({
        where: and(eq(schema.projectAssignments.user_id, u.id), eq(schema.projectAssignments.project_id, existingDefect.project_id)),
      });
      if (!pa && u.role !== "ADMIN") {
        unrelatedUser = u;
        break;
      }
    }
  });

  it("should return 200 for a project member", async () => {
    if (!existingDefect || !projectMember) return;
    const token = makeToken({ userId: projectMember.userId, username: projectMember.username, role: projectMember.role });
    const { status } = await fetchApiAs(token, `/defects/${existingDefect.id}`);
    expect(status).toBe(200);
  });

  it("should return 403 for a user unrelated to the project", async () => {
    if (!existingDefect || !unrelatedUser) return;
    const token = makeToken({ userId: unrelatedUser.userId, username: unrelatedUser.username, role: unrelatedUser.role });
    const { status } = await fetchApiAs(token, `/defects/${existingDefect.id}`);
    expect(status).toBe(403);
  });
});

// ── Fix 2: Dashboard summary scoped per-user ──────────────────────────────

describe("GET /dashboard/summary — scoped per-user", () => {
  // We'll find a project with at least one test run, one test case, and one defect,
  // and a non-ADMIN user who is assigned to it.
  let scopedProjectId: number | undefined;
  let scopedUser: { userId: number; username: string; role: string } | undefined;
  let expectedTestRuns = 0;
  let expectedTestCases = 0;
  let expectedDefects = 0;

  // Also track a separate project that the scoped user does NOT have access to,
  // so that "scoped to 1" is distinguishable from "there is only 1 project".
  let secondProjectId: number | undefined;

  beforeAll(async () => {
    // Find a project that has at least 1 test run, 1 test case, and 1 defect
    // that also has a non-ADMIN user assigned to it.
    const projects = await db.query.projects.findMany({ columns: { id: true } });
    for (const p of projects) {
      if (scopedUser) break;

      const [runCount, defectCount] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.testRuns)
          .where(eq(schema.testRuns.project_id, p.id))
          .then((r) => Number(r[0]?.count ?? 0)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.defects)
          .where(eq(schema.defects.project_id, p.id))
          .then((r) => Number(r[0]?.count ?? 0)),
      ]);

      // Count test cases through use_cases for this project
      const tcResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.testCases)
        .innerJoin(schema.useCases, eq(schema.testCases.use_case_id, schema.useCases.id))
        .where(eq(schema.useCases.project_id, p.id))
        .then((r) => Number(r[0]?.count ?? 0));

      if (runCount === 0 || defectCount === 0 || tcResult === 0) continue;

      // Find a non-ADMIN user assigned to this project
      const assignment = await db.query.projectAssignments.findFirst({
        where: and(
          eq(schema.projectAssignments.project_id, p.id),
        ),
        with: { user: { columns: { id: true, username: true, role: true } } },
      });
      if (assignment?.user && assignment.user.role !== "ADMIN") {
        scopedProjectId = p.id;
        scopedUser = { userId: assignment.user.id, username: assignment.user.username, role: assignment.user.role };
        expectedTestRuns = runCount;
        expectedTestCases = tcResult;
        expectedDefects = defectCount;
      }
    }

    // Find a second project (unrelated) to ensure the scoping test is meaningful
    if (scopedProjectId) {
      const all = await db.query.projects.findMany({ columns: { id: true } });
      for (const p2 of all) {
        if (p2.id !== scopedProjectId) {
          secondProjectId = p2.id;
          break;
        }
      }
    }
  });

  it("should return 0 for a brand-new user with no project assignments", async () => {
    // Use userId that doesn't exist or has no assignments
    const nobodyToken = makeToken({ userId: 999999, username: "nobody", role: "DEVELOPER" });
    const { status, body } = await fetchApiAs(nobodyToken, "/dashboard/summary");
    expect(status).toBe(200);
    expect(body.totalProjects).toBe(0);
    expect(body.totalTestRuns).toBe(0);
    expect(body.totalTestCases).toBe(0);
    expect(body.totalDefects).toBe(0);
  });

  it("should return scoped counts for a non-ADMIN user", async () => {
    if (!scopedUser || !scopedProjectId) return;
    const token = makeToken({ userId: scopedUser.userId, username: scopedUser.username, role: scopedUser.role });
    const { status, body } = await fetchApiAs(token, "/dashboard/summary");
    expect(status).toBe(200);

    // The scoped user's project count is how many projects they are assigned to
    // (not necessarily 1 — a user could be on multiple projects)

    // Check test run count matches what we expect from this project
    expect(body.totalTestRuns).toBe(expectedTestRuns);

    expect(body.totalTestCases).toBe(expectedTestCases);
    expect(body.totalDefects).toBe(expectedDefects);

    // Sanity: scoped counts should not equal system-wide ADMIN counts
    const adminToken = makeToken();
    const { body: adminBody } = await fetchApiAs(adminToken, "/dashboard/summary");
    // If there's a second project, scoped counts must be strictly less
    if (secondProjectId) {
      expect(body.totalTestRuns < adminBody.totalTestRuns ||
             body.totalTestCases < adminBody.totalTestCases ||
             body.totalDefects < adminBody.totalDefects).toBe(true);
    }
  });

  it("should return system-wide totals for ADMIN", async () => {
    const adminToken = makeToken();
    const { status, body } = await fetchApiAs(adminToken, "/dashboard/summary");

    // Cross-check with DB
    const actualProjects = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.projects)
      .then((r) => Number(r[0]?.count ?? 0));
    const actualTestRuns = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.testRuns)
      .then((r) => Number(r[0]?.count ?? 0));
    const actualTestCases = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.testCases)
      .then((r) => Number(r[0]?.count ?? 0));
    const actualDefects = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.defects)
      .then((r) => Number(r[0]?.count ?? 0));

    expect(status).toBe(200);
    expect(body.totalProjects).toBe(actualProjects);
    expect(body.totalTestRuns).toBe(actualTestRuns);
    expect(body.totalTestCases).toBe(actualTestCases);
    expect(body.totalDefects).toBe(actualDefects);
  });
});

process.on("exit", () => {
  server?.close();
});
