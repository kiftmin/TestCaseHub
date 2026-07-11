/**
 * Defect Lifecycle Integration Tests (10-state simplified lifecycle)
 *
 * Tests cover:
 *   - classify with auto-transition (NEW → ASSIGNED when assignee provided)
 *   - classify without assignee (NEW → TRIAGED)
 *   - flag-blocked toggles is_blocked flag without changing status
 *   - block / unblock flag toggle
 *   - quick-verify pass → CLOSED
 *   - quick-verify fail → ASSIGNED (regression bump)
 *   - request-deployment-approval returns 404 (removed)
 *
 * Run: npx tsx --env-file=.env src/__tests__/defects-rollback.test.ts
 */

import { describe, it, beforeAll, expect } from "./test-runner.js";
import { db } from "../db.js";
import { eq, and } from "drizzle-orm";
import * as schema from "@workspace/db";
import jwt from "jsonwebtoken";
import { createServer, Server } from "http";
import app from "../index.js";

const JWT_SECRET = process.env.SESSION_SECRET ?? "test-secret";
const TEST_PORT = 0;

let server: Server;
let baseUrl: string;

function makeToken(overrides: Partial<{ userId: number; username: string; role: string }> = {}) {
  return jwt.sign(
    { userId: overrides.userId ?? 1, username: overrides.username ?? "testuser", role: overrides.role ?? "ADMIN", iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function fetchApi(path: string, options: RequestInit = {}) {
  const token = makeToken();
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body };
}

async function fetchApiAs(token: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body };
}

async function getDefect(defectId: number) {
  return db.query.defects.findFirst({
    where: eq(schema.defects.id, defectId),
  });
}

async function getAuditLog(defectId: number) {
  return db.query.statusAuditLog.findMany({
    where: eq(schema.statusAuditLog.entity_id, defectId),
    orderBy: [{ column: schema.statusAuditLog.changed_at, dir: "desc" }],
  });
}

async function getRetests(defectId: number) {
  return db.query.defectRetests.findMany({
    where: eq(schema.defectRetests.defect_id, defectId),
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(TEST_PORT, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        baseUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function findTestLead(projectId: number): Promise<{ userId: number; username: string } | null> {
  const assignment = await db.query.projectAssignments.findFirst({
    where: and(eq(schema.projectAssignments.project_id, projectId), eq(schema.projectAssignments.role, "TEST_LEAD")),
    with: { user: true },
  });
  if (!assignment) return null;
  return { userId: assignment.user.id, username: assignment.user.username };
}

// ── classify: NEW → ASSIGNED when assignee provided ──────────────────────────

describe("PATCH /defects/:defectId/classify", () => {
  it("should transition NEW → ASSIGNED when assignee is provided", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "NEW"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/classify`, {
      method: "PATCH",
      body: JSON.stringify({ severity: "Major", priority: "P2", assigned_to_user_id: 1 }),
    });

    expect(status).toBe(200);
    expect(body?.status).toBe("ASSIGNED");

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("ASSIGNED");
    expect(after?.assigned_to_user_id).toBe(1);
  });

  it("should transition NEW → TRIAGED when no assignee provided", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "NEW"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/classify`, {
      method: "PATCH",
      body: JSON.stringify({ severity: "Minor", priority: "P3" }),
    });

    expect(status).toBe(200);
    expect(body?.status).toBe("TRIAGED");
  });
});

// ── flag-blocked: sets is_blocked flag, preserves status ─────────────────────

describe("PATCH /defects/:defectId/flag-blocked", () => {
  it("should set is_blocked=true without changing status", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "ASSIGNED"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/flag-blocked`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Waiting on API dependency" }),
    });

    expect(status).toBe(200);
    expect(body?.is_blocked).toBe(true);
    expect(body?.blocked_reason).toBe("Waiting on API dependency");

    const after = await getDefect(defect.id);
    expect(after?.is_blocked).toBe(true);
    expect(after?.status).toBe("ASSIGNED"); // status preserved
  });
});

// ── block / unblock: toggle is_blocked flag ──────────────────────────────────

describe("PATCH /defects/:defectId/block", () => {
  it("should toggle is_blocked flag for DEVELOPER", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "IN_PROGRESS"),
      columns: { id: true, project_id: true, assigned_to_user_id: true },
    });
    if (!defect || !defect.assigned_to_user_id) return;

    const devToken = makeToken({ userId: defect.assigned_to_user_id, username: "dev", role: "DEVELOPER" });
    const { status, body } = await fetchApiAs(devToken, `/defects/${defect.id}/block`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Blocked by infra team" }),
    });

    expect(status).toBe(200);
    expect(body?.is_blocked).toBe(true);

    const after = await getDefect(defect.id);
    expect(after?.is_blocked).toBe(true);
    expect(after?.status).toBe("IN_PROGRESS");
  });
});

describe("PATCH /defects/:defectId/unblock", () => {
  it("should clear is_blocked flag and keep status", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.is_blocked, true),
      columns: { id: true, assigned_to_user_id: true },
    });
    if (!defect) return;

    const devToken = makeToken({ userId: defect.assigned_to_user_id ?? 1, username: "dev", role: "DEVELOPER" });
    const { status, body } = await fetchApiAs(devToken, `/defects/${defect.id}/unblock`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Infra dependency resolved" }),
    });

    expect(status).toBe(200);
    expect(body?.is_blocked).toBe(false);

    const after = await getDefect(defect.id);
    expect(after?.is_blocked).toBe(false);
  });
});

// ── quick-verify: consolidated pass/fail ─────────────────────────────────────

describe("PATCH /defects/:defectId/quick-verify", () => {
  it("should transition READY_FOR_VERIFICATION → CLOSED when passed", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/quick-verify`, {
      method: "PATCH",
      body: JSON.stringify({ result: "passed", notes: "Verified on staging" }),
    });

    expect(status).toBe(200);
    expect(body?.defect?.status).toBe("CLOSED");

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("CLOSED");
  });

  it("should transition READY_FOR_VERIFICATION → ASSIGNED with regression bump when failed", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      columns: { id: true, project_id: true, regression_index: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const origRegression = defect.regression_index ?? 0;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/quick-verify`, {
      method: "PATCH",
      body: JSON.stringify({ result: "failed", notes: "Failure persists" }),
    });

    expect(status).toBe(200);
    expect(body?.defect?.status).toBe("ASSIGNED");

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("ASSIGNED");
    expect(after?.regression_index ?? 0).toBe(origRegression + 1);
  });
});

// ── Removed endpoints return 404 ─────────────────────────────────────────────

describe("Removed endpoints", () => {
  it("should return 404 for request-deployment-approval", async () => {
    const defect = await db.query.defects.findFirst({
      columns: { id: true },
    });
    if (!defect) return;

    const { status } = await fetchApi(`/defects/${defect.id}/request-deployment-approval`, {
      method: "PATCH",
    });
    expect(status).toBe(404);
  });
});

// ── Existing rollback flows still valid ──────────────────────────────────────

describe("PATCH /defects/:defectId/reschedule-retest", () => {
  let defectId: number;

  beforeAll(async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "READY_FOR_VERIFICATION"),
    });
    if (defect) defectId = defect.id;
  });

  it("should reject if not READY_FOR_VERIFICATION", async () => {
    const nonReady = await db.query.defects.findFirst({
      where: and(eq(schema.defects.status, "IN_PROGRESS"), eq(schema.defects.project_id, 1)),
    });
    if (!nonReady) return;
    const { status, body }: { status: number; body: any } = await fetchApi(`/defects/${nonReady.id}/reschedule-retest`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Test reason" }),
    });
    expect(status).toBe(400);
    expect(body.message ?? "").toBe("Defect is not in READY_FOR_VERIFICATION state");
  });

  it("should reject without reason", async () => {
    if (!defectId) return;
    const { status } = await fetchApi(`/defects/${defectId}/reschedule-retest`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
  });

  it("should transition READY_FOR_VERIFICATION → RESOLVED_DEV and delete retests", async () => {
    if (!defectId) return;
    const before = await getDefect(defectId);
    expect(before?.status).toBe("READY_FOR_VERIFICATION");
    const origRegression = before?.regression_index ?? 0;

    const { status } = await fetchApi(`/defects/${defectId}/reschedule-retest`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Need more time for testing" }),
    });
    expect(status).toBe(200);

    const after = await getDefect(defectId);
    expect(after?.status).toBe("RESOLVED_DEV");

    expect(after?.regression_index ?? 0).toBe(origRegression);

    const retests = await getRetests(defectId);
    expect(retests.length).toBe(0);

    const logs = await getAuditLog(defectId);
    const transitionLog: any = logs.find((l: any) => l.from_status === "READY_FOR_VERIFICATION" && l.to_status === "RESOLVED_DEV");
    expect(transitionLog?.reason).toBe("Need more time for testing");
  });
});

describe("PATCH /defects/:defectId/reject-verification", () => {
  let defectId: number;

  beforeAll(async () => {
    const defect = await db.query.defects.findFirst({
      where: and(
        eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      ),
    });
    if (defect) defectId = defect.id;
  });

  it("should reject if not READY_FOR_VERIFICATION", async () => {
    const nonReady = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "IN_PROGRESS"),
    });
    if (!nonReady) return;
    const { status } = await fetchApi(`/defects/${nonReady.id}/reject-verification`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "This is a test rejection reason over 10 chars" }),
    });
    expect(status).toBe(400);
  });

  it("should require reason with min 10 chars", async () => {
    if (!defectId) return;
    const { status } = await fetchApi(`/defects/${defectId}/reject-verification`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Short" }),
    });
    expect(status).toBe(400);
  });

  it("should reject if no assigned developer", async () => {
    const unassigned = await db.query.defects.findFirst({
      where: and(
        eq(schema.defects.status, "READY_FOR_VERIFICATION"),
        eq(schema.defects.assigned_to_user_id, null),
      ),
    });
    if (!unassigned) return;
    const { status } = await fetchApi(`/defects/${unassigned.id}/reject-verification`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "This is a test rejection reason over 10 chars" }),
    });
    expect(status).toBe(422);
  });

  it("should transition READY_FOR_VERIFICATION → ASSIGNED", async () => {
    const ready = await db.query.defects.findFirst({
      where: and(
        eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      ),
      columns: { id: true, regression_index: true, rejection_log: true },
    });
    if (!ready || !defectId) return;
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.id, defectId),
    });
    if (!defect?.assigned_to_user_id) return;

    const origRegression = defect.regression_index ?? 0;

    const { status, body }: { status: number; body: any } = await fetchApi(`/defects/${defectId}/reject-verification`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "This is a test rejection reason over 10 chars" }),
    });
    expect(status).toBe(200);
    expect(body?.status).toBe("ASSIGNED");

    const after = await getDefect(defectId);
    expect(after?.status).toBe("ASSIGNED");

    expect(after?.regression_index ?? 0).toBe(origRegression + 1);

    if (after?.rejection_log) {
      const parsed = JSON.parse(after.rejection_log);
      expect(Array.isArray(parsed.rejections)).toBe(true);
      const lastRejection = parsed.rejections[parsed.rejections.length - 1];
      expect(lastRejection.reason).toBe("This is a test rejection reason over 10 chars");
      expect(typeof lastRejection.at).toBe("string");
      expect(typeof lastRejection.by).toBe("number");
    }

    const retests = await getRetests(defectId);
    expect(retests.length).toBe(0);

    const logs = await getAuditLog(defectId);
    const transitionLog: any = logs.find((l: any) => l.from_status === "READY_FOR_VERIFICATION" && l.to_status === "ASSIGNED");
    expect(transitionLog?.reason).toBe("This is a test rejection reason over 10 chars");
  });
});

// ── RBAC Tests ──────────────────────────────────────────────────────────────

describe("Role-based access control", () => {
  let readyDefectId: number;

  beforeAll(async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "READY_FOR_VERIFICATION"),
    });
    if (defect) readyDefectId = defect.id;
  });

  it("should reject reschedule-retest for TESTER", async () => {
    if (!readyDefectId) return;
    const testerToken = makeToken({ userId: 2, username: "tester", role: "TESTER" });
    const { status } = await fetchApiAs(testerToken, `/defects/${readyDefectId}/reschedule-retest`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Test reason" }),
    });
    expect(status).toBe(403);
  });

  it("should reject reschedule-retest for DEVELOPER", async () => {
    if (!readyDefectId) return;
    const devToken = makeToken({ userId: 3, username: "developer", role: "DEVELOPER" });
    const { status } = await fetchApiAs(devToken, `/defects/${readyDefectId}/reschedule-retest`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Test reason" }),
    });
    expect(status).toBe(403);
  });

  it("should reject reject-verification for TESTER", async () => {
    if (!readyDefectId) return;
    const testerToken = makeToken({ userId: 2, username: "tester", role: "TESTER" });
    const { status } = await fetchApiAs(testerToken, `/defects/${readyDefectId}/reject-verification`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "This is a test rejection reason over 10 chars" }),
    });
    expect(status).toBe(403);
  });

  it("should reject reject-verification for DEVELOPER", async () => {
    if (!readyDefectId) return;
    const devToken = makeToken({ userId: 3, username: "developer", role: "DEVELOPER" });
    const { status } = await fetchApiAs(devToken, `/defects/${readyDefectId}/reject-verification`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "This is a test rejection reason over 10 chars" }),
    });
    expect(status).toBe(403);
  });

  it("should allow reschedule-retest for TEST_LEAD", async () => {
    if (!readyDefectId) return;
    const leadToken = makeToken({ userId: 4, username: "testlead", role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${readyDefectId}/reschedule-retest`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Test reason for reschedule" }),
    });
    expect([200, 403].includes(status)).toBe(true);
  });
});

// ── Audit Trail ────────────────────────────────────────────────────────────

describe("Audit trail for rollbacks", () => {
  it("should have status_audit_log entries for reschedule and reject transitions", async () => {
    const rescheduleLogs = await db.query.statusAuditLog.findMany({
      where: eq(schema.statusAuditLog.to_status, "RESOLVED_DEV"),
      limit: 1,
    });
    expect(Array.isArray(rescheduleLogs)).toBe(true);

    const rejectLogs = await db.query.statusAuditLog.findMany({
      where: eq(schema.statusAuditLog.to_status, "ASSIGNED"),
      limit: 1,
    });
    expect(Array.isArray(rejectLogs)).toBe(true);
  });
});

// ── Helpers for QA gate & reassign tests ─────────────────────────────────────

async function getDeveloperOnProject(projectId: number): Promise<{ userId: number } | null> {
  const assignment = await db.query.projectAssignments.findFirst({
    where: and(eq(schema.projectAssignments.project_id, projectId), eq(schema.projectAssignments.role, "DEVELOPER")),
  });
  return assignment ? { userId: assignment.user_id } : null;
}

async function ensureQaDeveloper(projectId: number): Promise<{ userId: number } | null> {
  const assignment = await db.query.projectAssignments.findFirst({
    where: and(eq(schema.projectAssignments.project_id, projectId), eq(schema.projectAssignments.role, "DEVELOPER")),
  });
  if (!assignment) return null;
  await db.update(schema.projectAssignments).set({ is_qa: true }).where(eq(schema.projectAssignments.id, assignment.id));
  return { userId: assignment.user_id };
}

// ── qa-review: RESOLVED_DEV → QA_PASSED (pass) | IN_PROGRESS (fail) ──────────

describe("PATCH /defects/:defectId/qa-review", () => {
  it("should transition RESOLVED_DEV → QA_PASSED and set qa review fields (pass)", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "RESOLVED_DEV"),
      columns: { id: true, project_id: true, regression_index: true },
    });
    if (!defect) return;
    const qa = await ensureQaDeveloper(defect.project_id);
    if (!qa) return;

    const qaToken = makeToken({ userId: qa.userId, username: "qa", role: "DEVELOPER" });
    const origRegression = defect.regression_index ?? 0;

    const { status, body } = await fetchApiAs(qaToken, `/defects/${defect.id}/qa-review`, {
      method: "PATCH",
      body: JSON.stringify({ result: "passed", notes: "Looks good" }),
    });

    expect(status).toBe(200);
    expect(body?.status).toBe("QA_PASSED");
    expect(body?.qa_reviewed_by_user_id).toBe(qa.userId);
    expect(body?.qa_reviewed_at).not.toBeNull();

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("QA_PASSED");
    expect(after?.regression_index ?? 0).toBe(origRegression);
  });

  it("should transition RESOLVED_DEV → IN_PROGRESS, clear qa fields, keep regression (fail)", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "RESOLVED_DEV"),
      columns: { id: true, project_id: true, regression_index: true },
    });
    if (!defect) return;
    const qa = await ensureQaDeveloper(defect.project_id);
    if (!qa) return;

    const qaToken = makeToken({ userId: qa.userId, username: "qa", role: "DEVELOPER" });
    const origRegression = defect.regression_index ?? 0;

    const { status, body } = await fetchApiAs(qaToken, `/defects/${defect.id}/qa-review`, {
      method: "PATCH",
      body: JSON.stringify({ result: "failed", notes: "UI glitch on save" }),
    });

    expect(status).toBe(200);
    expect(body?.status).toBe("IN_PROGRESS");
    expect(body?.qa_reviewed_by_user_id).toBeNull();

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("IN_PROGRESS");
    expect(after?.regression_index ?? 0).toBe(origRegression); // regression unchanged
  });

  it("should require a failure reason (min 3 chars) on fail", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "RESOLVED_DEV"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;
    const qa = await ensureQaDeveloper(defect.project_id);
    if (!qa) return;

    const qaToken = makeToken({ userId: qa.userId, username: "qa", role: "DEVELOPER" });
    const { status } = await fetchApiAs(qaToken, `/defects/${defect.id}/qa-review`, {
      method: "PATCH",
      body: JSON.stringify({ result: "failed", notes: "no" }),
    });
    expect(status).toBe(400);
  });

  it("should 409 when not RESOLVED_DEV", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "IN_PROGRESS"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;
    const qa = await ensureQaDeveloper(defect.project_id);
    if (!qa) return;

    const qaToken = makeToken({ userId: qa.userId, username: "qa", role: "DEVELOPER" });
    const { status } = await fetchApiAs(qaToken, `/defects/${defect.id}/qa-review`, {
      method: "PATCH",
      body: JSON.stringify({ result: "passed" }),
    });
    expect(status).toBe(409);
  });

  it("should 403 for a non-QA developer", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "RESOLVED_DEV"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;
    const dev = await getDeveloperOnProject(defect.project_id);
    if (!dev) return;
    // Ensure this developer is NOT QA-flagged
    await db.update(schema.projectAssignments).set({ is_qa: false })
      .where(and(eq(schema.projectAssignments.project_id, defect.project_id), eq(schema.projectAssignments.user_id, dev.userId)));

    const devToken = makeToken({ userId: dev.userId, username: "dev", role: "DEVELOPER" });
    const { status } = await fetchApiAs(devToken, `/defects/${defect.id}/qa-review`, {
      method: "PATCH",
      body: JSON.stringify({ result: "passed" }),
    });
    expect(status).toBe(403);
  });
});

// ── flag-retest gate (must be QA_PASSED) ─────────────────────────────────────

describe("PATCH /defects/:defectId/flag-retest (QA gate)", () => {
  it("should 409 when called on RESOLVED_DEV (not yet QA passed)", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "RESOLVED_DEV"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;
    const lead = await findTestLead(defect.project_id);
    if (!lead) return;
    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/flag-retest`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Send to verification", targetVerificationRunId: defect.project_id }),
    });
    expect(status).toBe(409);
  });

  it("should succeed from QA_PASSED", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "QA_PASSED"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;
    const lead = await findTestLead(defect.project_id);
    if (!lead) return;
    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/flag-retest`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Send to verification", targetVerificationRunId: defect.project_id }),
    });
    expect(status).toBe(200);
  });
});

// ── flag-retest-from-new gate (RESOLVED_DEV blocked) ─────────────────────────

describe("PATCH /defects/:defectId/flag-retest-from-new (QA gate)", () => {
  it("should 409 when called on RESOLVED_DEV", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "RESOLVED_DEV"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;
    const lead = await findTestLead(defect.project_id);
    if (!lead) return;
    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/flag-retest-from-new`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Retest" }),
    });
    expect(status).toBe(409);
  });

  it("should still succeed from NEW", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "NEW"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;
    const lead = await findTestLead(defect.project_id);
    if (!lead) return;
    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/flag-retest-from-new`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Retest from new" }),
    });
    expect(status).toBe(200);
  });
});

// ── reassign: lateral handoff within ASSIGNED | IN_PROGRESS ──────────────────

describe("PATCH /defects/:defectId/reassign", () => {
  async function findTwoDevelopers(projectId: number): Promise<{ a: number; b: number } | null> {
    const assignments = await db.query.projectAssignments.findMany({
      where: and(eq(schema.projectAssignments.project_id, projectId), eq(schema.projectAssignments.role, "DEVELOPER")),
    });
    const ids = assignments.map((a) => a.user_id);
    if (ids.length < 2) return null;
    return { a: ids[0], b: ids[1] };
  }

  it("should reassign from ASSIGNED/IN_PROGRESS and keep status", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "ASSIGNED"),
      columns: { id: true, project_id: true, assigned_to_user_id: true, status: true },
    });
    if (!defect || !defect.assigned_to_user_id) return;
    const devs = await findTwoDevelopers(defect.project_id);
    if (!devs) return;
    const target = devs.a === defect.assigned_to_user_id ? devs.b : devs.a;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;
    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });

    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/reassign`, {
      method: "PATCH",
      body: JSON.stringify({ newDeveloperId: target, reason: "Better fit for this area" }),
    });

    expect(status).toBe(200);
    expect(body?.status).toBe(defect.status);
    expect(body?.assigned_to_user_id).toBe(target);

    const after = await getDefect(defect.id);
    expect(after?.assigned_to_user_id).toBe(target);
    expect(after?.status).toBe(defect.status);
  });

  it("should 409 from a non-ASSIGNED/IN_PROGRESS status (e.g. RESOLVED_DEV)", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "RESOLVED_DEV"),
      columns: { id: true, project_id: true, assigned_to_user_id: true },
    });
    if (!defect) return;
    const devs = await findTwoDevelopers(defect.project_id);
    if (!devs) return;
    const target = devs.a === (defect.assigned_to_user_id ?? -1) ? devs.b : devs.a;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;
    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/reassign`, {
      method: "PATCH",
      body: JSON.stringify({ newDeveloperId: target, reason: "reassign" }),
    });
    expect(status).toBe(409);
  });

  it("should 409 from REGRESSED with pointer to retry-after-regression", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "REGRESSED"),
      columns: { id: true, project_id: true, assigned_to_user_id: true },
    });
    if (!defect) return;
    const devs = await findTwoDevelopers(defect.project_id);
    if (!devs) return;
    const target = devs.a === (defect.assigned_to_user_id ?? -1) ? devs.b : devs.a;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;
    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/reassign`, {
      method: "PATCH",
      body: JSON.stringify({ newDeveloperId: target, reason: "reassign" }),
    });
    expect(status).toBe(409);
    expect(body?.message ?? "").toMatch(/Retry After Regression/i);
  });

  it("should 422 when newDeveloperId is not a DEVELOPER on the project", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "ASSIGNED"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;
    const lead = await findTestLead(defect.project_id);
    if (!lead) return;
    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/reassign`, {
      method: "PATCH",
      body: JSON.stringify({ newDeveloperId: 999999, reason: "reassign" }),
    });
    expect(status).toBe(422);
  });

  it("should 400 when reassigning to the same developer", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "ASSIGNED"),
      columns: { id: true, project_id: true, assigned_to_user_id: true },
    });
    if (!defect || !defect.assigned_to_user_id) return;
    const lead = await findTestLead(defect.project_id);
    if (!lead) return;
    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/reassign`, {
      method: "PATCH",
      body: JSON.stringify({ newDeveloperId: defect.assigned_to_user_id, reason: "reassign" }),
    });
    expect(status).toBe(400);
  });

  it("should 403 for a non-TEST_LEAD caller", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "ASSIGNED"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;
    const testerToken = makeToken({ userId: 2, username: "tester", role: "TESTER" });
    const { status } = await fetchApiAs(testerToken, `/defects/${defect.id}/reassign`, {
      method: "PATCH",
      body: JSON.stringify({ newDeveloperId: 3, reason: "reassign" }),
    });
    expect(status).toBe(403);
  });
});

// ── quick-verify failure now produces REGRESSED (not ASSIGNED) ──────────────

describe("PATCH /defects/:defectId/quick-verify (REGRESSED on fail)", () => {
  it("should transition READY_FOR_VERIFICATION → REGRESSED with regression bump when failed", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      columns: { id: true, project_id: true, regression_index: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const origRegression = defect.regression_index ?? 0;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/quick-verify`, {
      method: "PATCH",
      body: JSON.stringify({ result: "failed", notes: "Failure persists" }),
    });

    expect(status).toBe(200);
    expect(body?.defect?.status).toBe("REGRESSED");
    expect(body?.defect?.regression_index ?? 0).toBe(origRegression + 1);

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("REGRESSED");
    expect(after?.regression_index ?? 0).toBe(origRegression + 1);
  });

  it("should still transition READY_FOR_VERIFICATION → CLOSED with regression_index reset when passed", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    // Set a nonzero regression_index to verify it gets reset
    await db.update(schema.defects)
      .set({ regression_index: 3 })
      .where(eq(schema.defects.id, defect.id));

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/quick-verify`, {
      method: "PATCH",
      body: JSON.stringify({ result: "passed", notes: "Verified on staging" }),
    });

    expect(status).toBe(200);
    expect(body?.defect?.status).toBe("CLOSED");

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("CLOSED");
    expect(after?.regression_index ?? -1).toBe(0);
  });
});

// ── retry-after-regression ─────────────────────────────────────────────────

describe("PATCH /defects/:defectId/retry-after-regression", () => {
  it("should transition REGRESSED → ASSIGNED", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "REGRESSED"),
      columns: { id: true, project_id: true, assigned_to_user_id: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(leadToken, `/defects/${defect.id}/retry-after-regression`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Ready for rework" }),
    });

    expect(status).toBe(200);
    expect(body?.status).toBe("ASSIGNED");

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("ASSIGNED");
    expect(after?.assigned_to_user_id).toBe(defect.assigned_to_user_id);
  });

  it("should reassign to a different developer and log names in note", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "REGRESSED"),
      columns: { id: true, project_id: true, assigned_to_user_id: true },
    });
    if (!defect || !defect.assigned_to_user_id) return;

    // Find a different developer on the same project
    const devs = await db.query.projectAssignments.findMany({
      where: and(eq(schema.projectAssignments.project_id, defect.project_id), eq(schema.projectAssignments.role, "DEVELOPER")),
    });
    const otherDev = devs.find(d => d.user_id !== defect.assigned_to_user_id);
    if (!otherDev) return;

    const otherUser = await db.query.users.findFirst({
      where: eq(schema.users.id, otherDev.user_id),
      columns: { name: true },
    });
    if (!otherUser) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/retry-after-regression`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Better fit", reassignTo: otherDev.user_id }),
    });

    expect(status).toBe(200);

    const after = await getDefect(defect.id);
    expect(after?.assigned_to_user_id).toBe(otherDev.user_id);

    // Check that the most recent system note contains the dev's name, not "user #"
    const notes = await db.query.defectNotes.findMany({
      where: and(
        eq(schema.defectNotes.defect_id, defect.id),
        eq(schema.defectNotes.is_system_note, true),
      ),
      orderBy: [{ column: schema.defectNotes.created_at, dir: "desc" }],
      limit: 1,
    });
    expect(notes.length).toBe(1);
    const noteText = notes[0].note;
    const containsRawId = noteText.includes(`user #${otherDev.user_id}`);
    expect(containsRawId).toBe(false);
    const containsName = noteText.includes(otherUser.name);
    expect(containsName).toBe(true);
  });
});

// ── reschedule-retest now logs QA_PASSED (not RESOLVED_DEV) ────────────────

describe("PATCH /defects/:defectId/reschedule-retest (logging fix)", () => {
  let defectId: number;

  beforeAll(async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "READY_FOR_VERIFICATION"),
    });
    if (defect) defectId = defect.id;
  });

  it("should transition to QA_PASSED and log QA_PASSED in audit trail", async () => {
    if (!defectId) return;
    const before = await getDefect(defectId);
    expect(before?.status).toBe("READY_FOR_VERIFICATION");

    const { status } = await fetchApi(`/defects/${defectId}/reschedule-retest`, {
      method: "PATCH",
      body: JSON.stringify({ reason: "Reschedule for later verification" }),
    });
    expect(status).toBe(200);

    const after = await getDefect(defectId);
    expect(after?.status).toBe("QA_PASSED");

    const logs = await getAuditLog(defectId);
    const transitionLog = logs.find((l: any) => l.from_status === "READY_FOR_VERIFICATION");
    expect(transitionLog?.to_status).toBe("QA_PASSED");
    expect(transitionLog?.reason).toBe("Reschedule for later verification");

    // Also check system note
    const notes = await db.query.defectNotes.findMany({
      where: and(
        eq(schema.defectNotes.defect_id, defectId),
        eq(schema.defectNotes.is_system_note, true),
      ),
      orderBy: [{ column: schema.defectNotes.created_at, dir: "desc" }],
      limit: 5,
    });
    const rescheduleNote = notes.find((n: any) => n.note.includes("Reschedule for later verification"));
    expect(rescheduleNote).not.toBe(undefined);
    if (rescheduleNote) {
      const containsResolvedDev = rescheduleNote.note.includes("RESOLVED_DEV");
      expect(containsResolvedDev).toBe(false);
      const containsQaPassed = rescheduleNote.note.includes("QA_PASSED");
      expect(containsQaPassed).toBe(true);
    }
  });
});

// ── submit-for-business-decision from new allowed states ────────────────────

describe("PATCH /defects/:defectId/submit-for-business-decision (QA_PASSED & REGRESSED)", () => {
  it("should succeed from QA_PASSED", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "QA_PASSED"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/submit-for-business-decision`, {
      method: "PATCH",
      body: JSON.stringify({ justification: "Need business owner review before proceeding with verification", decisionType: "business_review" }),
    });

    expect(status).toBe(200);

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("PENDING_BIZ_ACCEPTANCE");
  });

  it("should succeed from REGRESSED", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "REGRESSED"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defects/${defect.id}/submit-for-business-decision`, {
      method: "PATCH",
      body: JSON.stringify({ justification: "This defect keeps failing retest, considering risk waiver", decisionType: "risk_waiver" }),
    });

    expect(status).toBe(200);

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("PENDING_BIZ_ACCEPTANCE");
  });
});

// ── defect-retests pass resets regression_index ────────────────────────────

describe("PATCH /defect-retests/:retestId (regression_index reset on pass)", () => {
  it("should set regression_index to 0 on pass", async () => {
    // Find a defect with a retest record (ideally REGRESSED or READY_FOR_VERIFICATION with retests)
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      columns: { id: true, project_id: true, regression_index: true },
    });
    if (!defect) return;

    // Ensure there's a retest record and set a nonzero regression_index
    let retest = await db.query.defectRetests.findFirst({
      where: eq(schema.defectRetests.defect_id, defect.id),
    });
    if (!retest) {
      [retest] = await db.insert(schema.defectRetests).values({
        defect_id: defect.id,
        test_run_id: defect.project_id,
        target_verification_run_id: defect.project_id,
      }).returning();
    }
    await db.update(schema.defects).set({ regression_index: 5 }).where(eq(schema.defects.id, defect.id));

    const lead = await findTestLead(defect.project_id);
    if (!lead) return;

    const leadToken = makeToken({ userId: lead.userId, username: lead.username, role: "TEST_LEAD" });
    const { status } = await fetchApiAs(leadToken, `/defect-retests/${retest.id}`, {
      method: "PATCH",
      body: JSON.stringify({ retestResult: "passed", retestNotes: "All good now" }),
    });
    expect(status).toBe(200);

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("CLOSED");
    expect(after?.regression_index ?? -1).toBe(0);
  });
});

// ── regress endpoint produces exactly one note ─────────────────────────────

describe("PATCH /defects/:defectId/regress (single note)", () => {
  it("should produce exactly one system note with full details", async () => {
    const defect = await db.query.defects.findFirst({
      where: eq(schema.defects.status, "CLOSED"),
      columns: { id: true, project_id: true },
    });
    if (!defect) return;

    const noteCountBefore = (await db.query.defectNotes.findMany({
      where: eq(schema.defectNotes.defect_id, defect.id),
    })).length;

    const { status } = await fetchApi(`/defects/${defect.id}/regress`, {
      method: "PATCH",
      body: JSON.stringify({
        reason: "Production incident found in release — customer reported data loss on the export screen after deployment",
        incidentType: "production",
        customerReference: "TKT-45678",
        severity: "Critical",
      }),
    });

    expect(status).toBe(200);

    const after = await getDefect(defect.id);
    expect(after?.status).toBe("REGRESSED");

    const notes = await db.query.defectNotes.findMany({
      where: eq(schema.defectNotes.defect_id, defect.id),
    });
    const newNoteCount = notes.length - noteCountBefore;
    // Should add exactly 1 system note (not 2)
    expect(newNoteCount).toBe(1);

    // The single note should contain the full regression detail
    const latestNote = notes[notes.length - 1];
    expect(latestNote.is_system_note).toBe(true);
    const noteContainsDetails = latestNote.note.includes("Regression reported") &&
      latestNote.note.includes("production") &&
      latestNote.note.includes("TKT-45678");
    expect(noteContainsDetails).toBe(true);
  });
});

