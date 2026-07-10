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

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
      username: string;
      role: string;
    };
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
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

export async function checkProjectRole(
  req: AuthenticatedRequest,
  projectId: number,
  allowedRoles: string[]
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "ADMIN") return true;

  const assignment = await db.query.projectAssignments.findFirst({
    where: (pa, { and }) =>
      and(
        eq(pa.project_id, projectId),
        eq(pa.user_id, req.user!.userId)
      ),
  });

  if (assignment && allowedRoles.includes(assignment.role)) return true;

  // Implicit TEST_LEAD via projects.test_lead_id
  if (allowedRoles.includes("TEST_LEAD")) {
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { test_lead_id: true },
    });
    if (project?.test_lead_id === req.user!.userId) return true;
  }

  return false;
}

/**
 * Returns true when the caller is ADMIN, or has a project_assignment on this
 * project with role === "DEVELOPER" and is_qa === true. Used to gate the QA
 * review action — a QA person is modelled as a DEVELOPER with the is_qa flag.
 */
export async function checkProjectQa(
  req: AuthenticatedRequest,
  projectId: number,
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "ADMIN") return true;

  const assignment = await db.query.projectAssignments.findFirst({
    where: (pa, { and }) =>
      and(
        eq(pa.project_id, projectId),
        eq(pa.user_id, req.user!.userId),
      ),
    columns: { role: true, is_qa: true },
  });

  return !!assignment && assignment.role === "DEVELOPER" && assignment.is_qa === true;
}
