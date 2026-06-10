import express from "express";
import { eq, desc, and, or, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { AuthenticatedRequest } from "../middlewares/auth.js";

const router = express.Router();

// GET /api/dashboard/summary
router.get("/summary", async (req, res, next) => {
  try {
    const totalProjects = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.projects)
      .then((row) => row[0].count);

    const totalTestRuns = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.testRuns)
      .then((row) => row[0].count);

    const totalTestCases = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.testCases)
      .then((row) => row[0].count);

    const totalDefects = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.defects)
      .then((row) => row[0].count);

    res.json({
      totalProjects,
      totalTestRuns,
      totalTestCases,
      totalDefects,
    });
  } catch (err) {
    next(err);
  }
});

async function getProjectIdsForUser(userId: number, role: string): Promise<number[]> {
  // Determine project IDs based on role
  if (role === "TEST_LEAD") {
    const [ledProjects, assignedProjects] = await Promise.all([
      db.query.projects.findMany({
        where: eq(schema.projects.test_lead_id, userId),
        columns: { id: true },
      }),
      db.query.projectAssignments.findMany({
        where: and(
          eq(schema.projectAssignments.user_id, userId),
          eq(schema.projectAssignments.role, "TEST_LEAD"),
        ),
        columns: { project_id: true },
      }),
    ]);
    return [...new Set([
      ...ledProjects.map((p) => p.id),
      ...assignedProjects.map((a) => a.project_id),
    ])];
  }

  // Other roles (DEVELOPER, BUSINESS_OWNER, UAT_COORDINATOR, etc.):
  // find projects where user has that specific role assignment
  const assignments = await db.query.projectAssignments.findMany({
    where: and(
      eq(schema.projectAssignments.user_id, userId),
      eq(schema.projectAssignments.role, role),
    ),
    columns: { project_id: true },
  });
  return assignments.map((a) => a.project_id);
}

async function getProjectAuditLogs(projectIds: number[], limit: number) {
  const testRunIds = await db.query.testRuns.findMany({
    where: inArray(schema.testRuns.project_id, projectIds),
    columns: { id: true },
  }).then((rows) => rows.map((r) => r.id));

  if (testRunIds.length === 0) {
    return { auditLogs: [], recentExecutions: [], recentDefects: [] };
  }

  const [executionIds, defectIds, useCaseIds] = await Promise.all([
    db.query.executions.findMany({
      where: inArray(schema.executions.test_run_id, testRunIds),
      columns: { id: true },
    }).then((rows) => rows.map((r) => r.id)),
    db.query.defects.findMany({
      where: inArray(schema.defects.test_run_id, testRunIds),
      columns: { id: true },
    }).then((rows) => rows.map((r) => r.id)),
    db.query.useCases.findMany({
      where: inArray(schema.useCases.project_id, projectIds),
      columns: { id: true },
    }).then((rows) => rows.map((r) => r.id)),
  ]);

  let testCaseIds: number[] = [];
  if (useCaseIds.length > 0) {
    testCaseIds = await db.query.testCases.findMany({
      where: inArray(schema.testCases.use_case_id, useCaseIds),
      columns: { id: true },
    }).then((rows) => rows.map((r) => r.id));
  }

  // Build audit log conditions for each entity type
  const conditions: ReturnType<typeof and>[] = [];

  if (testRunIds.length > 0) {
    conditions.push(and(
      eq(schema.statusAuditLog.entity_type, "test_run"),
      inArray(schema.statusAuditLog.entity_id, testRunIds),
    ));
  }
  if (executionIds.length > 0) {
    conditions.push(and(
      eq(schema.statusAuditLog.entity_type, "execution"),
      inArray(schema.statusAuditLog.entity_id, executionIds),
    ));
  }
  if (defectIds.length > 0) {
    conditions.push(and(
      eq(schema.statusAuditLog.entity_type, "defect"),
      inArray(schema.statusAuditLog.entity_id, defectIds),
    ));
  }
  if (useCaseIds.length > 0) {
    conditions.push(and(
      eq(schema.statusAuditLog.entity_type, "test_scenario"),
      inArray(schema.statusAuditLog.entity_id, useCaseIds),
    ));
  }
  if (testCaseIds.length > 0) {
    conditions.push(and(
      eq(schema.statusAuditLog.entity_type, "test_case"),
      inArray(schema.statusAuditLog.entity_id, testCaseIds),
    ));
  }

  const [auditLogs, recentExecutions, recentDefects] = await Promise.all([
    conditions.length > 0
      ? db.query.statusAuditLog.findMany({
          where: or(...conditions),
          orderBy: desc(schema.statusAuditLog.changed_at),
          limit,
          with: { changedBy: true },
        })
      : Promise.resolve([]),
    db.query.executions.findMany({
      where: inArray(schema.executions.test_run_id, testRunIds),
      orderBy: desc(schema.executions.executed_at),
      limit,
      with: { testCase: true, testRun: true, tester: true },
    }),
    db.query.defects.findMany({
      where: inArray(schema.defects.test_run_id, testRunIds),
      orderBy: desc(schema.defects.created_at),
      limit,
      with: { testCase: true, testRun: true },
    }),
  ]);

  return { auditLogs, recentExecutions, recentDefects };
}

// GET /api/dashboard/recent-activity
router.get("/recent-activity", async (req: AuthenticatedRequest, res, next) => {
  try {
    const role = (req.query.role as string) || req.user!.role;
    const userId = req.user!.userId;
    const limit = Number(req.query.limit) || 10;

    // Admin: administrative changes only — no project test noise
    if (role === "ADMIN") {
      if (req.user!.role !== "ADMIN") {
        res.json({ auditLogs: [] });
        return;
      }
      const auditLogs = await db.query.statusAuditLog.findMany({
        where: inArray(schema.statusAuditLog.entity_type, ["user", "project"]),
        orderBy: desc(schema.statusAuditLog.changed_at),
        limit,
        with: { changedBy: true },
      });
      res.json({ auditLogs });
      return;
    }

    // Test Lead / Business Owner / UAT Coordinator / Developer:
    // all project-level changes scoped to their projects (all roles, all entity types)
    if (role !== "TESTER") {
      const projectIds = await getProjectIdsForUser(userId, role);
      if (projectIds.length === 0) {
        res.json({ auditLogs: [], recentExecutions: [], recentDefects: [] });
        return;
      }
      const result = await getProjectAuditLogs(projectIds, limit);
      res.json(result);
      return;
    }

    // Tester / My Runs: only submitted activity — no in-progress noise
    const submittedRunIds = await db.query.testRuns.findMany({
      where: inArray(schema.testRuns.status, ["in_progress", "completed"]),
      columns: { id: true },
    }).then((rows) => rows.map((r) => r.id));

    const recentExecutions = submittedRunIds.length > 0
      ? await db.query.executions.findMany({
          where: and(
            inArray(schema.executions.test_run_id, submittedRunIds),
            sql`${schema.executions.overall_result} IS NOT NULL`,
          ),
          orderBy: desc(schema.executions.executed_at),
          limit,
          with: { testCase: true, testRun: true, tester: true },
        })
      : [];

    const recentDefects = submittedRunIds.length > 0
      ? await db.query.defects.findMany({
          where: inArray(schema.defects.test_run_id, submittedRunIds),
          orderBy: desc(schema.defects.created_at),
          limit,
          with: { testCase: true, testRun: true },
        })
      : [];

    res.json({ recentExecutions, recentDefects });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/developer/:userId/defects
router.get("/developer/:userId/defects", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);

    const assignedDefects = await db.query.defects.findMany({
      where: eq(schema.defects.assigned_to_user_id, userId),
      with: { project: true, testCase: true },
      orderBy: desc(schema.defects.created_at),
    });

    res.json(assignedDefects);
  } catch (err) {
    next(err);
  }
});

export default router;
