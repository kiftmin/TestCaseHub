import express from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";

const router = express.Router();

// GET /api/projects/:projectId/users
router.get("/projects/:projectId/users", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const assignments = await db.query.projectAssignments.findMany({
      where: eq(schema.projectAssignments.project_id, projectId),
      with: { user: true },
    });
    res.json(assignments);
  } catch (err) { next(err); }
});

// POST /api/projects/:projectId/users
router.post("/projects/:projectId/users", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const bodySchema = z.object({
      userId: z.number(),
      role: z.enum(["TEST_LEAD", "TEST_AUTHOR", "BUSINESS_OWNER", "TESTER", "DEVELOPER", "UAT_COORDINATOR"]),
    });
    const data = bodySchema.parse(req.body);

    const [assignment] = await db.insert(schema.projectAssignments)
      .values({ project_id: projectId, user_id: data.userId, role: data.role })
      .returning();

    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

// DELETE /api/projects/:projectId/users/:userId
router.delete("/projects/:projectId/users/:userId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const userId = Number(req.params.userId);
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    if (req.user!.userId === userId) {
      res.status(400).json({ message: "Cannot remove yourself" });
      return;
    }

    await db.delete(schema.projectAssignments)
      .where(and(
        eq(schema.projectAssignments.project_id, projectId),
        eq(schema.projectAssignments.user_id, userId)
      ));

    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/users/:userId/projects
router.get("/users/:userId/projects", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const assignments = await db.query.projectAssignments.findMany({
      where: eq(schema.projectAssignments.user_id, userId),
      with: { project: true },
    });
    const projects = assignments.map(a => a.project);
    res.json(projects);
  } catch (err) { next(err); }
});

export default router;
