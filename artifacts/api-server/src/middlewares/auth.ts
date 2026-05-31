import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { eq } from "drizzle-orm";
import * as schema from "@workspace/db";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback_secret";

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

export function authorizeProjectRole(allowedRoles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const projectId = Number(req.params.projectId);
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (req.user.role === "ADMIN") {
      next();
      return;
    }

    const assignment = await db.query.projectAssignments.findFirst({
      where: (pa, { and }) =>
        and(
          eq(pa.project_id, projectId),
          eq(pa.user_id, req!.user!.userId)
        ),
    });

    if (!assignment || !allowedRoles.includes(assignment.role)) {
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

  return !!assignment && allowedRoles.includes(assignment.role);
}
