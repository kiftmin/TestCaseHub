/**
 * UAT Sign-Off Certificate Integration Tests
 *
 * Tests that:
 *   - ADMIN with no project role gets 403 on POST sign-off
 *   - Genuinely assigned TEST_LEAD can sign (populates testLead)
 *   - BUSINESS_OWNER can sign afterward (populates businessOwner, preserves testLead)
 *   - User with neither role gets 403
 *
 * Run: npx tsx --env-file=.env src/__tests__/sign-off.test.ts
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

async function getSignOffStatus(projectId: number) {
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { is_signed_off: true, sign_off_data: true },
  });
  return project;
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

describe("POST /api/projects/:projectId/sign-off", () => {
  let projectId: number;
  let testLeadUser: { userId: number; username: string };
  let businessOwnerUser: { userId: number; username: string };
  let adminUserId: number;

  beforeAll(async () => {
    // Find a project with a TEST_LEAD assignment
    const tlAssignment = await db.query.projectAssignments.findFirst({
      where: eq(schema.projectAssignments.role, "TEST_LEAD"),
      with: { user: true, project: true },
    });
    if (!tlAssignment) return;
    projectId = tlAssignment.project_id;
    testLeadUser = { userId: tlAssignment.user.id, username: tlAssignment.user.username };

    // Find or verify a BUSINESS_OWNER on the same project
    let boAssignment = await db.query.projectAssignments.findFirst({
      where: and(
        eq(schema.projectAssignments.project_id, projectId),
        eq(schema.projectAssignments.role, "BUSINESS_OWNER"),
      ),
      with: { user: true },
    });
    if (boAssignment) {
      businessOwnerUser = { userId: boAssignment.user.id, username: boAssignment.user.username };
    } else {
      // Use the admin user's id but assign them as BUSINESS_OWNER
      const adminUser = await db.query.users.findFirst({ where: eq(schema.users.role, "ADMIN") });
      if (!adminUser) return;
      await db.insert(schema.projectAssignments).values({
        project_id: projectId,
        user_id: adminUser.id,
        role: "BUSINESS_OWNER",
      });
      businessOwnerUser = { userId: adminUser.id, username: adminUser.username };
    }

    // Find an admin user who is NOT on this project
    const admin = await db.query.users.findFirst({
      where: eq(schema.users.role, "ADMIN"),
    });
    adminUserId = admin?.id ?? 1;
  });

  it("should return 403 when ADMIN with no project role attempts to sign", async () => {
    if (!projectId) return;

    // Verify the admin isn't assigned to this project
    const adminAssignment = await db.query.projectAssignments.findFirst({
      where: and(
        eq(schema.projectAssignments.project_id, projectId),
        eq(schema.projectAssignments.user_id, adminUserId),
      ),
    });
    if (adminAssignment) return; // skip if admin happens to have a role

    // Also ensure admin isn't the implicit test_lead
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { test_lead_id: true },
    });
    if (project?.test_lead_id === adminUserId) return;

    const before = await getSignOffStatus(projectId);

    const adminToken = makeToken({ userId: adminUserId, username: "admin", role: "ADMIN" });
    const { status, body } = await fetchApiAs(adminToken, `/projects/${projectId}/sign-off`, {
      method: "POST",
      body: JSON.stringify({ name: "Admin", role: "ADMIN", signature: "Admin" }),
    });

    expect(status).toBe(403);
    expect(body?.message ?? "").toMatch(/Only the assigned/);

    // Verify sign_off_data is unchanged
    const after = await getSignOffStatus(projectId);
    expect(after?.sign_off_data).toBe(before?.sign_off_data);
  });

  it("should allow TEST_LEAD to sign and populate testLead", async () => {
    if (!projectId) return;

    const tlToken = makeToken({ userId: testLeadUser.userId, username: testLeadUser.username, role: "TEST_LEAD" });
    const { status, body } = await fetchApiAs(tlToken, `/projects/${projectId}/sign-off`, {
      method: "POST",
      body: JSON.stringify({ name: testLeadUser.username, role: "Test Lead", signature: testLeadUser.username }),
    });

    expect(status).toBe(200);
    expect(body?.sign_off_data?.testLead).toBeDefined();
    expect(body?.sign_off_data?.testLead?.name).toBe(testLeadUser.username);
    expect(body?.sign_off_data?.businessOwner).toBeUndefined();

    // Verify in database
    const after = await getSignOffStatus(projectId);
    const parsed = after?.sign_off_data ? JSON.parse(after.sign_off_data) : {};
    expect(parsed.testLead).toBeDefined();
    expect(parsed.testLead.name).toBe(testLeadUser.username);
    expect(parsed.businessOwner).toBeUndefined();
  });

  it("should allow BUSINESS_OWNER to sign afterward without overwriting testLead", async () => {
    if (!projectId) return;

    const boToken = makeToken({ userId: businessOwnerUser.userId, username: businessOwnerUser.username, role: "BUSINESS_OWNER" });
    const { status, body } = await fetchApiAs(boToken, `/projects/${projectId}/sign-off`, {
      method: "POST",
      body: JSON.stringify({ name: businessOwnerUser.username, role: "Business Owner", signature: businessOwnerUser.username }),
    });

    expect(status).toBe(200);
    expect(body?.sign_off_data?.testLead).toBeDefined();
    expect(body?.sign_off_data?.testLead?.name).toBe(testLeadUser.username);
    expect(body?.sign_off_data?.businessOwner).toBeDefined();
    expect(body?.sign_off_data?.businessOwner?.name).toBe(businessOwnerUser.username);
    expect(body?.is_signed_off).toBe(1);

    // Verify in database - testLead from previous step is still intact
    const after = await getSignOffStatus(projectId);
    const parsed = after?.sign_off_data ? JSON.parse(after.sign_off_data) : {};
    expect(parsed.testLead).toBeDefined();
    expect(parsed.testLead.name).toBe(testLeadUser.username);
    expect(parsed.businessOwner).toBeDefined();
    expect(parsed.businessOwner.name).toBe(businessOwnerUser.username);
  });

  it("should return 403 for a user with neither TEST_LEAD nor BUSINESS_OWNER role", async () => {
    if (!projectId) return;

    const randomToken = makeToken({ userId: 99999, username: "random", role: "TESTER" });
    const { status, body } = await fetchApiAs(randomToken, `/projects/${projectId}/sign-off`, {
      method: "POST",
      body: JSON.stringify({ name: "Random", role: "TESTER", signature: "Random" }),
    });

    expect(status).toBe(403);
    expect(body?.message ?? "").toMatch(/Only the assigned/);
  });
});

process.on("exit", () => {
  server?.close();
});
