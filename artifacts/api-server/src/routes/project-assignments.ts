import express from "express";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";

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
      isQa: z.boolean().optional().default(false),
    });
    const data = bodySchema.parse(req.body);

    // Enforce single role per user on a project
    const existing = await db.query.projectAssignments.findFirst({
      where: and(
        eq(schema.projectAssignments.project_id, projectId),
        eq(schema.projectAssignments.user_id, data.userId),
      ),
      columns: { id: true, role: true },
    });
    if (existing) {
      res.status(409).json({ message: `User already has the role "${existing.role}" on this project. Use the role update (PATCH) to change it.` });
      return;
    }

    // is_qa is only meaningful on DEVELOPER assignments — force it to false otherwise.
    const isQa = data.role === "DEVELOPER" ? (data.isQa ?? false) : false;

    const [assignment] = await db.insert(schema.projectAssignments)
      .values({ project_id: projectId, user_id: data.userId, role: data.role, is_qa: isQa })
      .returning();

    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

// PATCH /api/projects/:projectId/users/:userId — TEST_LEAD only
// Update role and/or QA flag on an existing assignment without a remove+re-add round trip.
// is_qa is forced to false unless the resulting role is DEVELOPER.
router.patch("/projects/:projectId/users/:userId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const userId = Number(req.params.userId);
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const bodySchema = z.object({
      role: z.enum(["TEST_LEAD", "TEST_AUTHOR", "BUSINESS_OWNER", "TESTER", "DEVELOPER", "UAT_COORDINATOR"]).optional(),
      isQa: z.boolean().optional(),
    });
    const data = bodySchema.parse(req.body);

    const existing = await db.query.projectAssignments.findFirst({
      where: and(
        eq(schema.projectAssignments.project_id, projectId),
        eq(schema.projectAssignments.user_id, userId),
      ),
    });
    if (!existing) { res.status(404).json({ message: "Assignment not found" }); return; }

    const resultingRole = data.role ?? existing.role;
    const isQa = resultingRole === "DEVELOPER" ? (data.isQa ?? existing.is_qa ?? false) : false;

    const updateValues: Record<string, unknown> = { is_qa: isQa };
    if (data.role !== undefined) updateValues.role = data.role;

    const [updated] = await db.update(schema.projectAssignments)
      .set(updateValues)
      .where(and(
        eq(schema.projectAssignments.project_id, projectId),
        eq(schema.projectAssignments.user_id, userId),
      ))
      .returning();

    res.json(updated);
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

    // Find the assignment to check the user's role
    const assignment = await db.query.projectAssignments.findFirst({
      where: and(
        eq(schema.projectAssignments.project_id, projectId),
        eq(schema.projectAssignments.user_id, userId),
      ),
      columns: { role: true },
    });
    if (!assignment) { res.status(404).json({ message: "Assignment not found" }); return; }

    // Prevent removing a TEST_LEAD
    if (assignment.role === "TEST_LEAD") {
      res.status(400).json({ message: "Cannot remove a test lead. Reassign the test lead role first." });
      return;
    }

    // Check active defects assigned to this user
    const activeDefect = await db.query.defects.findFirst({
      where: and(
        eq(schema.defects.project_id, projectId),
        eq(schema.defects.assigned_to_user_id, userId),
        notInArray(schema.defects.status, ["CLOSED", "PASSED_BY_AGREEMENT"]),
      ),
      columns: { id: true },
    });
    if (activeDefect) {
      res.status(409).json({ message: "Cannot remove a user with active defects. Reassign or close their defects first." });
      return;
    }

    // Check test run use cases assigned to this user in this project
    const projectTestRunIds = db.select({ id: schema.testRuns.id })
      .from(schema.testRuns)
      .where(eq(schema.testRuns.project_id, projectId));

    const activeTestRunAssignment = await db.query.testRunUseCases.findFirst({
      where: and(
        eq(schema.testRunUseCases.assigned_tester_id, userId),
        inArray(schema.testRunUseCases.test_run_id, projectTestRunIds),
        notInArray(schema.testRunUseCases.status, ["passed", "passed_by_agreement", "failed"]),
      ),
      columns: { id: true },
    });
    if (activeTestRunAssignment) {
      res.status(409).json({ message: "Cannot remove a user with active test run assignments. Reassign or complete their test runs first." });
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
      columns: { role: true, is_qa: true },
    });

    if (assignment) {
      const isQa = (assignment.role === "DEVELOPER" || assignment.role === "TEST_LEAD") && assignment.is_qa === true;
      res.json({ role: assignment.role, isQa });
      return;
    }

    // Implicit TEST_LEAD: check if user is set as test_lead_id on the project
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { test_lead_id: true },
    });

    if (project?.test_lead_id === req.user!.userId) {
      res.json({ role: "TEST_LEAD", isQa: false });
      return;
    }

    res.json({ role: null, isQa: false });
  } catch (err) { next(err); }
});

export default router;
