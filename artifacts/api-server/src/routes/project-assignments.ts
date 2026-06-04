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

    // Include projects where user is set as test_lead_id but has no TEST_LEAD assignment
    const existingProjectIds = new Set(assignments.map(a => a.project_id));
    const leadProjects = await db.query.projects.findMany({
      where: eq(schema.projects.test_lead_id, userId),
      columns: { id: true, name: true, project_code: true },
    });

    const synthetic = leadProjects
      .filter(p => !existingProjectIds.has(p.id))
      .map(p => ({
        id: -p.id,
        project_id: p.id,
        user_id: userId,
        role: "TEST_LEAD" as const,
        assigned_at: new Date().toISOString(),
        project: { id: p.id, name: p.name, project_code: p.project_code },
      }));

    res.json([...assignments, ...synthetic]);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/my-role — returns current user's role for a project
// Includes implicit TEST_LEAD from projects.test_lead_id
router.get("/projects/:projectId/my-role", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);

    const assignment = await db.query.projectAssignments.findFirst({
      where: and(
        eq(schema.projectAssignments.project_id, projectId),
        eq(schema.projectAssignments.user_id, req.user!.userId),
      ),
      columns: { role: true },
    });

    if (assignment) {
      res.json({ role: assignment.role });
      return;
    }

    // Implicit TEST_LEAD: check if user is set as test_lead_id on the project
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { test_lead_id: true },
    });

    if (project?.test_lead_id === req.user!.userId) {
      res.json({ role: "TEST_LEAD" });
      return;
    }

    res.json({ role: null });
  } catch (err) { next(err); }
});

export default router;
