/**
 * Access control & row-locking integration tests
 *
 * Fix 1: GET /dashboard/developer/:userId/defests
 * Fix 2: SELECT … FOR UPDATE on reject-verification / regress / defect-retests fail
 *
 * Run: npx tsx --env-file=.env src/__tests__/access-control-and-locking.test.ts
 */

import { describe, it, beforeAll, expect } from "./test-runner.js";
import { db } from "../db.js";
import { eq, and } from "drizzle-orm";
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

// ── Fix 1: Dashboard access control ─────────────────────────────────────────

describe("GET /api/dashboard/developer/:userId/defects — access control", () => {
  let developerUserId: number;
  let otherUserId: number;

  beforeAll(async () => {
    const dev = await db.query.users.findFirst({ where: eq(schema.users.role, "USER") });
    if (dev) developerUserId = dev.id;

    const other = await db.query.users.findFirst({
      where: and(eq(schema.users.role, "USER"), eq(schema.users.is_active, true)),
      orderBy: ({ id: "desc" } as any),
    });
    if (other && other.id !== developerUserId) otherUserId = other.id;
  });

  it("should return 200 for own userId (non-admin)", async () => {
    if (!developerUserId) return;
    const userToken = makeToken({ userId: developerUserId, username: "dev", role: "USER" });
    const { status } = await fetchApiAs(userToken, `/dashboard/developer/${developerUserId}/defects`);
    expect(status).toBe(200);
  });

  it("should return 403 when a different user requests another user's defects", async () => {
    if (!developerUserId || !otherUserId) return;
    const userToken = makeToken({ userId: developerUserId, username: "dev", role: "USER" });
    const { status, body } = await fetchApiAs(userToken, `/dashboard/developer/${otherUserId}/defects`);
    expect(status).toBe(403);
    expect(typeof body?.message).toBe("string");
  });

  it("should return 200 when ADMIN requests any userId", async () => {
    if (!otherUserId) return;
    const adminToken = makeToken({ userId: 1, username: "admin", role: "ADMIN" });
    const { status } = await fetchApiAs(adminToken, `/dashboard/developer/${otherUserId}/defects`);
    expect(status).toBe(200);
  });
});

// ── Fix 2: Row-locking — concurrent reject-verification ─────────────────────

describe("reject-verification row locking", () => {
  let defectId: number;
  let testLeadUser: { userId: number; username: string };

  beforeAll(async () => {
    const defect = await db.query.defects.findFirst({
      where: and(eq(schema.defects.status, "READY_FOR_VERIFICATION")),
      columns: { id: true, project_id: true, assigned_to_user_id: true, regression_index: true, rejection_log: true },
    });
    if (!defect || !defect.assigned_to_user_id) return;
    defectId = defect.id;

    const lead = await db.query.projectAssignments.findFirst({
      where: and(eq(schema.projectAssignments.project_id, defect.project_id), eq(schema.projectAssignments.role, "TEST_LEAD")),
      with: { user: true },
    });
    if (lead) {
      testLeadUser = { userId: lead.user.id, username: lead.user.username };
    }
  });

  it("should increment regression_index exactly twice and record two rejections when fired concurrently", async () => {
    if (!defectId || !testLeadUser) return;

    const reset = await db.query.defects.findFirst({
      where: eq(schema.defects.id, defectId),
      columns: { regression_index: true, rejection_log: true },
    });
    if (!reset) return;

    const leadToken = makeToken({ userId: testLeadUser.userId, username: testLeadUser.username, role: "TEST_LEAD" });
    const body = { reason: "Concurrent test rejection — verify regression_index increments twice." };

    // Fire both at the same time (not sequentially)
    const [r1, r2] = await Promise.all([
      fetchApiAs(leadToken, `/defects/${defectId}/reject-verification`, { method: "PATCH", body: JSON.stringify(body) }),
      fetchApiAs(leadToken, `/defects/${defectId}/reject-verification`, { method: "PATCH", body: JSON.stringify(body) }),
    ]);

    // Both should be accepted (not 409)
    expect([200].includes(r1.status)).toBe(true);
    expect([200].includes(r2.status)).toBe(true);

    const after = await db.query.defects.findFirst({
      where: eq(schema.defects.id, defectId),
      columns: { regression_index: true, rejection_log: true },
    });
    if (!after) return;

    // regression_index increased by exactly 2 (not 1)
    expect(after.regression_index).toBe((reset.regression_index ?? 0) + 2);

    // rejection_log contains exactly two entries
    const parsed = after.rejection_log ? JSON.parse(after.rejection_log) : {};
    expect(Array.isArray(parsed.rejections)).toBe(true);
    expect(parsed.rejections.length).toBe((reset.rejection_log ? (() => { try { return JSON.parse(reset.rejection_log!).rejections?.length ?? 0; } catch { return 0; } })() : 0) + 2);
  });
});

process.on("exit", () => {
  server?.close();
});
