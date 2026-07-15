import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { eq, and } from "drizzle-orm";
import * as schema from "@workspace/db";

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) throw new Error("SESSION_SECRET environment variable is required");
const JWT_SECRET = SESSION_SECRET;

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: number;
    username: string;
    role: string;
  };
}

/** Short-lived cache so every request does not hit users table under load. */
const userCache = new Map<number, { role: string; username: string; is_active: boolean; expires: number }>();
const USER_CACHE_TTL_MS = 30_000;

export function invalidateUserCache(userId: number): void {
  userCache.delete(userId);
}

async function loadActiveUser(userId: number): Promise<{ role: string; username: string } | null> {
  const now = Date.now();
  const cached = userCache.get(userId);
  if (cached && cached.expires > now) {
    if (!cached.is_active) return null;
    return { role: cached.role, username: cached.username };
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { id: true, username: true, role: true, is_active: true },
  });

  if (!user) {
    userCache.delete(userId);
    return null;
  }

  userCache.set(userId, {
    role: user.role,
    username: user.username,
    is_active: user.is_active,
    expires: now + USER_CACHE_TTL_MS,
  });

  if (!user.is_active) return null;
  return { role: user.role, username: user.username };
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  let decoded: { userId: number; username: string; role: string };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
      username: string;
      role: string;
    };
  } catch {
    res.status(401).json({ message: "Invalid token" });
    return;
  }

  loadActiveUser(decoded.userId)
    .then((user) => {
      if (!user) {
        res.status(401).json({ message: "Account suspended or not found" });
        return;
      }
      // Always use live role from DB so demotions take effect immediately
      req.user = {
        userId: decoded.userId,
        username: user.username,
        role: user.role,
      };
      next();
    })
    .catch(next);
}

export function authorize(roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    next();
  };
}

/**
 * True if the caller may read project-scoped resources:
 * ADMIN, any project assignment, or implicit test lead via projects.test_lead_id.
 */
export async function hasProjectAccess(
  req: AuthenticatedRequest,
  projectId: number,
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "ADMIN") return true;

  const assignment = await db.query.projectAssignments.findFirst({
    where: and(
      eq(schema.projectAssignments.project_id, projectId),
      eq(schema.projectAssignments.user_id, req.user.userId),
    ),
    columns: { id: true },
  });
  if (assignment) return true;

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { test_lead_id: true },
  });
  return project?.test_lead_id === req.user.userId;
}

/** Express middleware factory: require membership on :projectId (or custom param). */
export function requireProjectAccess(paramName = "projectId") {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.params[paramName] ?? req.query[paramName];
      const projectId = Number(raw);
      if (!projectId || Number.isNaN(projectId)) {
        res.status(400).json({ message: "projectId is required" });
        return;
      }
      const ok = await hasProjectAccess(req, projectId);
      if (!ok) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export async function assertProjectAccess(
  req: AuthenticatedRequest,
  projectId: number,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; message: string }> {
  if (!projectId || Number.isNaN(projectId)) {
    return { ok: false, status: 404, message: "Not found" };
  }
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { id: true },
  });
  if (!project) {
    return { ok: false, status: 404, message: "Not found" };
  }
  const ok = await hasProjectAccess(req, projectId);
  if (!ok) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  return { ok: true };
}

export async function checkProjectRole(
  req: AuthenticatedRequest,
  projectId: number,
  allowedRoles: string[],
  options: { allowAdminBypass?: boolean } = {},
): Promise<boolean> {
  const { allowAdminBypass = true } = options;
  if (!req.user) return false;
  if (allowAdminBypass && req.user.role === "ADMIN") return true;

  const assignment = await db.query.projectAssignments.findFirst({
    where: and(
      eq(schema.projectAssignments.project_id, projectId),
      eq(schema.projectAssignments.user_id, req.user.userId),
    ),
  });

  if (assignment && allowedRoles.includes(assignment.role)) return true;

  if (allowedRoles.includes("TEST_LEAD")) {
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { test_lead_id: true },
    });
    if (project?.test_lead_id === req.user.userId) return true;
  }

  return false;
}

/**
 * Returns true when the caller is ADMIN, or has a project_assignment on this
 * project with role === "DEVELOPER" and is_qa === true, or role === "TEST_LEAD"
 * and is_qa === true.
 */
export async function checkProjectQa(
  req: AuthenticatedRequest,
  projectId: number,
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "ADMIN") return true;

  const assignment = await db.query.projectAssignments.findFirst({
    where: and(
      eq(schema.projectAssignments.project_id, projectId),
      eq(schema.projectAssignments.user_id, req.user.userId),
    ),
    columns: { role: true, is_qa: true },
  });

  return (
    !!assignment &&
    (assignment.role === "DEVELOPER" || assignment.role === "TEST_LEAD") &&
    assignment.is_qa === true
  );
}

// ── Entity → projectId resolvers (for nested resource IDOR checks) ──────────

export async function projectIdFromUseCase(useCaseId: number): Promise<number | null> {
  const row = await db.query.useCases.findFirst({
    where: eq(schema.useCases.id, useCaseId),
    columns: { project_id: true },
  });
  return row?.project_id ?? null;
}

export async function projectIdFromTestCase(testCaseId: number): Promise<number | null> {
  const row = await db.query.testCases.findFirst({
    where: eq(schema.testCases.id, testCaseId),
    columns: { use_case_id: true },
  });
  if (!row) return null;
  return projectIdFromUseCase(row.use_case_id);
}

export async function projectIdFromTestStep(stepId: number): Promise<number | null> {
  const row = await db.query.testSteps.findFirst({
    where: eq(schema.testSteps.id, stepId),
    columns: { test_case_id: true },
  });
  if (!row) return null;
  return projectIdFromTestCase(row.test_case_id);
}

export async function projectIdFromTestRun(testRunId: number): Promise<number | null> {
  const row = await db.query.testRuns.findFirst({
    where: eq(schema.testRuns.id, testRunId),
    columns: { project_id: true },
  });
  return row?.project_id ?? null;
}

export async function projectIdFromExecution(executionId: number): Promise<number | null> {
  const row = await db.query.executions.findFirst({
    where: eq(schema.executions.id, executionId),
    columns: { test_run_id: true },
  });
  if (!row?.test_run_id) return null;
  return projectIdFromTestRun(row.test_run_id);
}

export async function projectIdFromDefect(defectId: number): Promise<number | null> {
  const row = await db.query.defects.findFirst({
    where: eq(schema.defects.id, defectId),
    columns: { project_id: true },
  });
  return row?.project_id ?? null;
}

export async function projectIdFromDiscussion(discussionId: number): Promise<number | null> {
  const row = await db.query.teamDiscussions.findFirst({
    where: eq(schema.teamDiscussions.id, discussionId),
    columns: { project_id: true },
  });
  return row?.project_id ?? null;
}

/** Deny with 403/404 if caller cannot access the project. Returns false if response already sent. */
export async function denyUnlessProjectAccess(
  req: AuthenticatedRequest,
  res: Response,
  projectId: number | null,
): Promise<boolean> {
  if (projectId == null) {
    res.status(404).json({ message: "Not found" });
    return false;
  }
  const result = await assertProjectAccess(req, projectId);
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return false;
  }
  return true;
}
