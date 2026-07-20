import express from "express";
import { eq, desc, and, or, sql, inArray, notInArray } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { AuthenticatedRequest } from "../middlewares/auth.js";

const router = express.Router();

const TERMINAL_DEFECT = new Set(["CLOSED", "PASSED_BY_AGREEMENT"]);
const HIGH_SEV = new Set(["Critical", "Major", "High"]);
const SCENARIO_DONE = new Set(["passed", "failed", "passed_by_agreement"]);

const PROJECT_ROLES = new Set([
  "TEST_LEAD", "TEST_AUTHOR", "BUSINESS_OWNER", "TESTER", "DEVELOPER", "UAT_COORDINATOR", "ADMIN",
]);

function ageDays(date: Date | string | null | undefined): number {
  if (!date) return 0;
  const t = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

function parseSignOff(raw: string | null | undefined): {
  testLead?: unknown;
  businessOwner?: unknown;
} {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { testLead?: unknown; businessOwner?: unknown };
  } catch {
    return {};
  }
}

type Readiness = "ready" | "at_risk" | "not_ready";

function computeReadiness(input: {
  executionPct: number;
  openCritical: number;
  openHigh: number;
  isSignedOff: boolean;
}): { readiness: Readiness; reasons: string[] } {
  const reasons: string[] = [];
  if (input.isSignedOff) {
    return { readiness: "ready", reasons: ["Fully signed off"] };
  }
  if (input.openCritical > 0) {
    reasons.push(`${input.openCritical} open Critical defect${input.openCritical === 1 ? "" : "s"}`);
  }
  if (input.executionPct < 80) {
    reasons.push(`Execution at ${input.executionPct}% (below 80%)`);
  }
  if (input.openCritical > 0 || input.executionPct < 80) {
    return { readiness: "not_ready", reasons: reasons.slice(0, 3) };
  }
  if (input.openHigh > 0) {
    reasons.push(`${input.openHigh} open High/Major defect${input.openHigh === 1 ? "" : "s"}`);
  }
  if (input.executionPct < 95) {
    reasons.push(`Execution at ${input.executionPct}% (below 95%)`);
  }
  if (reasons.length > 0) {
    return { readiness: "at_risk", reasons: reasons.slice(0, 3) };
  }
  reasons.push("Exit criteria on track");
  return { readiness: "ready", reasons };
}

async function getProjectIdsForUser(userId: number, role: string): Promise<number[]> {
  if (role === "ADMIN") {
    const all = await db.query.projects.findMany({ columns: { id: true } });
    return all.map((p) => p.id);
  }

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

  const assignments = await db.query.projectAssignments.findMany({
    where: and(
      eq(schema.projectAssignments.user_id, userId),
      eq(schema.projectAssignments.role, role as "TEST_LEAD" | "TEST_AUTHOR" | "BUSINESS_OWNER" | "TESTER" | "DEVELOPER" | "UAT_COORDINATOR"),
    ),
    columns: { project_id: true },
  });
  return assignments.map((a) => a.project_id);
}

/** All projects the user can see (any assignment or test_lead_id), used when no project role is passed. */
async function getAllAccessibleProjectIds(userId: number, systemRole: string): Promise<number[]> {
  if (systemRole === "ADMIN") {
    const all = await db.query.projects.findMany({ columns: { id: true } });
    return all.map((p) => p.id);
  }
  const [led, assigned] = await Promise.all([
    db.query.projects.findMany({
      where: eq(schema.projects.test_lead_id, userId),
      columns: { id: true },
    }),
    db.query.projectAssignments.findMany({
      where: eq(schema.projectAssignments.user_id, userId),
      columns: { project_id: true },
    }),
  ]);
  return [...new Set([...led.map((p) => p.id), ...assigned.map((a) => a.project_id)])];
}

function resolveScopeRole(req: AuthenticatedRequest): string {
  const q = (req.query.role as string | undefined)?.toUpperCase();
  if (q && PROJECT_ROLES.has(q)) {
    if (q === "ADMIN" && req.user!.role !== "ADMIN") return req.user!.role;
    return q;
  }
  return req.user!.role;
}

// GET /api/dashboard/summary?role=
router.get("/summary", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const role = resolveScopeRole(req);

    let projectIds: number[];
    if (role === "ADMIN" || req.user!.role === "ADMIN" && !req.query.role) {
      if (role === "ADMIN" || (req.user!.role === "ADMIN" && !req.query.role)) {
        projectIds = await getAllAccessibleProjectIds(userId, "ADMIN");
      } else {
        projectIds = await getProjectIdsForUser(userId, role);
      }
    } else if (PROJECT_ROLES.has(role) && role !== "ADMIN") {
      projectIds = await getProjectIdsForUser(userId, role);
    } else {
      projectIds = await getAllAccessibleProjectIds(userId, req.user!.role);
    }

    if (projectIds.length === 0) {
      res.json({ totalProjects: 0, totalTestRuns: 0, totalTestCases: 0, totalDefects: 0, openDefects: 0 });
      return;
    }

    const isAdminGlobal = role === "ADMIN" && req.user!.role === "ADMIN";

    const runCountQ = isAdminGlobal
      ? db.select({ count: sql<number>`count(*)` }).from(schema.testRuns)
      : db.select({ count: sql<number>`count(*)` }).from(schema.testRuns)
          .where(inArray(schema.testRuns.project_id, projectIds));
    const defectCountQ = isAdminGlobal
      ? db.select({ count: sql<number>`count(*)` }).from(schema.defects)
      : db.select({ count: sql<number>`count(*)` }).from(schema.defects)
          .where(inArray(schema.defects.project_id, projectIds));
    const openDefectQ = isAdminGlobal
      ? db.select({ count: sql<number>`count(*)` }).from(schema.defects)
          .where(notInArray(schema.defects.status, ["CLOSED", "PASSED_BY_AGREEMENT"]))
      : db.select({ count: sql<number>`count(*)` }).from(schema.defects)
          .where(and(
            inArray(schema.defects.project_id, projectIds),
            notInArray(schema.defects.status, ["CLOSED", "PASSED_BY_AGREEMENT"]),
          ));

    const [totalProjects, totalTestRuns, totalTestCases, totalDefects, openDefects] = await Promise.all([
      Promise.resolve(isAdminGlobal
        ? db.select({ count: sql<number>`count(*)` }).from(schema.projects).then((r) => Number(r[0].count))
        : projectIds.length),
      runCountQ.then((r) => Number(r[0].count)),
      isAdminGlobal
        ? db.select({ count: sql<number>`count(*)` }).from(schema.testCases).then((r) => Number(r[0].count))
        : db.select({ count: sql<number>`count(*)` })
            .from(schema.testCases)
            .innerJoin(schema.useCases, eq(schema.testCases.use_case_id, schema.useCases.id))
            .where(inArray(schema.useCases.project_id, projectIds))
            .then((r) => Number(r[0].count)),
      defectCountQ.then((r) => Number(r[0].count)),
      openDefectQ.then((r) => Number(r[0].count)),
    ]);

    res.json({ totalProjects, totalTestRuns, totalTestCases, totalDefects, openDefects });
  } catch (err) {
    next(err);
  }
});

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

    const myTrucs = await db.query.testRunUseCases.findMany({
      where: eq(schema.testRunUseCases.assigned_tester_id, userId),
      columns: { test_run_id: true },
    });
    const runIds = [...new Set(myTrucs.map((t) => t.test_run_id))];

    const recentExecutions = runIds.length > 0
      ? await db.query.executions.findMany({
          where: and(
            inArray(schema.executions.test_run_id, runIds),
            eq(schema.executions.tester_id, userId),
            sql`${schema.executions.overall_result} IS NOT NULL`,
          ),
          orderBy: desc(schema.executions.executed_at),
          limit,
          with: { testCase: true, testRun: true, tester: true },
        })
      : [];

    const recentDefects = runIds.length > 0
      ? await db.query.defects.findMany({
          where: and(
            inArray(schema.defects.test_run_id, runIds),
          ),
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

// GET /api/dashboard/sign-off-status?role=
router.get("/sign-off-status", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const role = resolveScopeRole(req);
    const scopeRole = role === "UAT_COORDINATOR" ? "UAT_COORDINATOR"
      : role === "BUSINESS_OWNER" ? "BUSINESS_OWNER"
      : role === "TEST_LEAD" ? "TEST_LEAD"
      : role === "ADMIN" ? "ADMIN"
      : role;

    const projectIds = scopeRole === "ADMIN" && req.user!.role === "ADMIN"
      ? await getAllAccessibleProjectIds(userId, "ADMIN")
      : await getProjectIdsForUser(userId, scopeRole === "ADMIN" ? "BUSINESS_OWNER" : scopeRole);

    if (projectIds.length === 0) {
      res.json([]);
      return;
    }

    const projects = await db.query.projects.findMany({
      where: inArray(schema.projects.id, projectIds),
      columns: { id: true, name: true, is_signed_off: true, sign_off_data: true },
      orderBy: desc(schema.projects.updated_at),
    });

    res.json(projects.map((p) => {
      const so = parseSignOff(p.sign_off_data);
      return {
        projectId: p.id,
        name: p.name,
        signedOff: p.is_signed_off === 1,
        testLeadSigned: !!so.testLead,
        businessOwnerSigned: !!so.businessOwner,
      };
    }));
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/developer/:userId/defects
router.get("/developer/:userId/defects", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = Number(req.params.userId);
    if (req.user!.role !== "ADMIN" && req.user!.userId !== userId) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

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

// GET /api/dashboard/role-overview?role=
router.get("/role-overview", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const role = resolveScopeRole(req);

    if (role === "TESTER") {
      res.json(await buildTesterOverview(userId));
      return;
    }
    if (role === "DEVELOPER") {
      res.json(await buildDeveloperOverview(userId));
      return;
    }
    if (role === "BUSINESS_OWNER" || role === "UAT_COORDINATOR") {
      const projectIds = await getProjectIdsForUser(userId, role);
      res.json(await buildBusinessOverview(projectIds));
      return;
    }
    // TEST_LEAD, TEST_AUTHOR, ADMIN, default
    const projectIds = role === "ADMIN" && req.user!.role === "ADMIN"
      ? await getAllAccessibleProjectIds(userId, "ADMIN")
      : await getProjectIdsForUser(userId, role === "ADMIN" ? "TEST_LEAD" : role);
    res.json(await buildTestLeadOverview(projectIds));
  } catch (err) {
    next(err);
  }
});

async function loadActiveProjectContext(projectIds: number[]) {
  if (projectIds.length === 0) {
    return { projects: [] as Awaited<ReturnType<typeof db.query.projects.findMany>>, runs: [] as Awaited<ReturnType<typeof db.query.testRuns.findMany>>, defects: [] as Awaited<ReturnType<typeof db.query.defects.findMany>>, trucs: [] as Awaited<ReturnType<typeof db.query.testRunUseCases.findMany>> };
  }

  const projects = await db.query.projects.findMany({
    where: and(
      inArray(schema.projects.id, projectIds),
      eq(schema.projects.is_signed_off, 0),
    ),
    columns: { id: true, name: true, is_signed_off: true, sign_off_data: true },
  });

  // Include signed-off only if no active; still show signed for BO
  const activeIds = projects.length > 0 ? projects.map((p) => p.id) : projectIds;
  const scopeIds = projects.length > 0 ? activeIds : projectIds;

  const allProjects = await db.query.projects.findMany({
    where: inArray(schema.projects.id, projectIds),
    columns: { id: true, name: true, is_signed_off: true, sign_off_data: true },
  });

  const runs = await db.query.testRuns.findMany({
    where: inArray(schema.testRuns.project_id, scopeIds),
    columns: {
      id: true, name: true, status: true, project_id: true,
      scheduled_at: true, passed: true, updated_at: true,
    },
  });

  const runIds = runs.map((r) => r.id);
  const [defects, trucs] = await Promise.all([
    db.query.defects.findMany({
      where: inArray(schema.defects.project_id, projectIds),
      with: {
        project: { columns: { id: true, name: true } },
        testCase: { columns: { id: true, title: true } },
      },
      orderBy: desc(schema.defects.created_at),
    }),
    runIds.length > 0
      ? db.query.testRunUseCases.findMany({
          where: inArray(schema.testRunUseCases.test_run_id, runIds),
          columns: {
            id: true, test_run_id: true, use_case_id: true, status: true,
            assigned_tester_id: true, updated_at: true,
            tester_sign_off: true, tester_sign_off_at: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return { projects: allProjects, runs, defects, trucs };
}

async function buildTestLeadOverview(projectIds: number[]) {
  const { projects, runs, defects, trucs } = await loadActiveProjectContext(projectIds);

  const totalScenarios = trucs.length;
  const doneScenarios = trucs.filter((t) => SCENARIO_DONE.has(t.status)).length;
  const executionPct = totalScenarios > 0 ? Math.round((doneScenarios / totalScenarios) * 100) : 0;

  const executed = trucs.filter((t) => SCENARIO_DONE.has(t.status));
  const passed = executed.filter((t) => t.status === "passed" || t.status === "passed_by_agreement").length;
  const passRate = executed.length > 0 ? Math.round((passed / executed.length) * 100) : null;

  const openDefects = defects.filter((d) => !TERMINAL_DEFECT.has(d.status));
  const triageBacklog = openDefects.filter((d) => d.status === "NEW");
  const blockedCritical = openDefects.filter(
    (d) => d.is_blocked || (d.severity && HIGH_SEV.has(d.severity)),
  );
  const needsRetest = openDefects.filter(
    (d) => d.status === "READY_FOR_VERIFICATION" || d.status === "QA_PASSED",
  );

  const openCritical = openDefects.filter((d) => d.severity === "Critical").length;
  const openHigh = openDefects.filter((d) => d.severity === "Major" || d.severity === "High").length;
  const readiness = computeReadiness({
    executionPct,
    openCritical,
    openHigh,
    isSignedOff: projects.length > 0 && projects.every((p) => p.is_signed_off === 1),
  });

  const progressByProject: Array<{
    projectId: number;
    name: string;
    done: number;
    inProgress: number;
    notStarted: number;
    total: number;
  }> = [];

  for (const p of projects) {
    const pRunIds = new Set(runs.filter((r) => r.project_id === p.id).map((r) => r.id));
    const pTrucs = trucs.filter((t) => pRunIds.has(t.test_run_id));
    const done = pTrucs.filter((t) => SCENARIO_DONE.has(t.status)).length;
    const inProgress = pTrucs.filter((t) => t.status === "in_progress").length;
    const notStarted = pTrucs.filter((t) => t.status === "pending").length;
    progressByProject.push({
      projectId: p.id,
      name: p.name,
      done,
      inProgress,
      notStarted,
      total: pTrucs.length,
    });
  }

  // At-risk runs: in_progress with low completion or high fail rate
  const atRiskRuns = runs
    .filter((r) => r.status !== "completed")
    .map((r) => {
      const rTrucs = trucs.filter((t) => t.test_run_id === r.id);
      const total = rTrucs.length;
      const done = rTrucs.filter((t) => SCENARIO_DONE.has(t.status)).length;
      const failed = rTrucs.filter((t) => t.status === "failed").length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const failPct = done > 0 ? Math.round((failed / done) * 100) : 0;
      const project = projects.find((p) => p.id === r.project_id);
      let reason = "";
      if (failPct >= 30 && done >= 3) reason = `${failPct}% fail rate`;
      else if (r.status === "in_progress" && pct < 40 && total >= 3) reason = `Only ${pct}% complete`;
      else if (r.scheduled_at && new Date(r.scheduled_at) < new Date() && r.status !== "completed") {
        reason = "Past scheduled date";
      }
      return reason
        ? {
            id: r.id,
            name: r.name,
            status: r.status,
            projectId: r.project_id,
            projectName: project?.name ?? "",
            progressPct: pct,
            reason,
          }
        : null;
    })
    .filter(Boolean)
    .slice(0, 8);

  const triageQueue = triageBacklog.slice(0, 10).map((d) => ({
    id: d.id,
    severity: d.severity,
    status: d.status,
    projectId: d.project_id,
    projectName: d.project?.name ?? "",
    title: d.testCase?.title ?? `Defect #${d.id}`,
    ageDays: ageDays(d.created_at),
    created_at: d.created_at,
  }));

  const retestQueue = needsRetest.slice(0, 10).map((d) => ({
    id: d.id,
    severity: d.severity,
    status: d.status,
    projectId: d.project_id,
    projectName: d.project?.name ?? "",
    title: d.testCase?.title ?? `Defect #${d.id}`,
    ageDays: ageDays(d.updated_at ?? d.created_at),
  }));

  return {
    role: "TEST_LEAD",
    kpis: {
      executionProgress: executionPct,
      passRate,
      triageBacklog: triageBacklog.length,
      blockedOrCritical: blockedCritical.length,
      readiness: readiness.readiness,
      readinessReasons: readiness.reasons,
      totalScenarios,
      doneScenarios,
      openDefects: openDefects.length,
    },
    progressByProject,
    triageQueue,
    retestQueue,
    atRiskRuns,
  };
}

async function buildBusinessOverview(projectIds: number[]) {
  const { projects, runs, defects, trucs } = await loadActiveProjectContext(projectIds);

  const openDefects = defects.filter((d) => !TERMINAL_DEFECT.has(d.status));
  const criticalOpen = openDefects.filter((d) => d.severity === "Critical");
  const highOpen = openDefects.filter((d) => d.severity === "Major" || d.severity === "High" || d.severity === "Critical");
  const pendingBiz = openDefects.filter((d) => d.status === "PENDING_BIZ_ACCEPTANCE");

  const totalScenarios = trucs.length;
  const doneScenarios = trucs.filter((t) => SCENARIO_DONE.has(t.status)).length;
  const executionPct = totalScenarios > 0 ? Math.round((doneScenarios / totalScenarios) * 100) : 0;

  const projectReadiness = projects.map((p) => {
    const pRunIds = new Set(runs.filter((r) => r.project_id === p.id).map((r) => r.id));
    const pTrucs = trucs.filter((t) => pRunIds.has(t.test_run_id));
    const pDone = pTrucs.filter((t) => SCENARIO_DONE.has(t.status)).length;
    const pPct = pTrucs.length > 0 ? Math.round((pDone / pTrucs.length) * 100) : 0;
    const pDefects = openDefects.filter((d) => d.project_id === p.id);
    const pCrit = pDefects.filter((d) => d.severity === "Critical").length;
    const pHigh = pDefects.filter((d) => d.severity === "Major" || d.severity === "High").length;
    const so = parseSignOff(p.sign_off_data);
    const r = computeReadiness({
      executionPct: pPct,
      openCritical: pCrit,
      openHigh: pHigh,
      isSignedOff: p.is_signed_off === 1,
    });
    return {
      projectId: p.id,
      name: p.name,
      readiness: r.readiness,
      reasons: r.reasons,
      executionPct: pPct,
      openCritical: pCrit,
      openHigh: pHigh,
      signedOff: p.is_signed_off === 1,
      testLeadSigned: !!so.testLead,
      businessOwnerSigned: !!so.businessOwner,
    };
  });

  const overall = computeReadiness({
    executionPct,
    openCritical: criticalOpen.length,
    openHigh: highOpen.filter((d) => d.severity !== "Critical").length,
    isSignedOff: projects.length > 0 && projects.every((p) => p.is_signed_off === 1),
  });

  const pendingSignOff = projectReadiness.filter((p) => !p.signedOff && p.testLeadSigned && !p.businessOwnerSigned);
  const decisionsNeeded = pendingBiz.slice(0, 10).map((d) => ({
    id: d.id,
    severity: d.severity,
    status: d.status,
    projectId: d.project_id,
    projectName: d.project?.name ?? "",
    title: d.testCase?.title ?? `Defect #${d.id}`,
    ageDays: ageDays(d.created_at),
  }));

  const residualRisk = highOpen.slice(0, 10).map((d) => ({
    id: d.id,
    severity: d.severity,
    status: d.status,
    projectId: d.project_id,
    projectName: d.project?.name ?? "",
    title: d.testCase?.title ?? `Defect #${d.id}`,
    ageDays: ageDays(d.created_at),
  }));

  return {
    role: "BUSINESS_OWNER",
    kpis: {
      readiness: overall.readiness,
      readinessReasons: overall.reasons,
      criticalOpen: criticalOpen.length,
      uatCompletion: executionPct,
      pendingMyDecision: pendingBiz.length + pendingSignOff.length,
      signedOffCount: projects.filter((p) => p.is_signed_off === 1).length,
      totalProjects: projects.length,
    },
    projectReadiness,
    pendingSignOff,
    decisionsNeeded,
    residualRisk,
  };
}

async function buildDeveloperOverview(userId: number) {
  const assigned = await db.query.defects.findMany({
    where: eq(schema.defects.assigned_to_user_id, userId),
    with: {
      project: { columns: { id: true, name: true } },
      testCase: { columns: { id: true, title: true } },
    },
    orderBy: desc(schema.defects.updated_at),
  });

  const open = assigned.filter((d) => !TERMINAL_DEFECT.has(d.status));
  const inProgress = open.filter((d) =>
    d.status === "IN_PROGRESS" || d.status === "ASSIGNED" || d.status === "TRIAGED",
  );
  const awaitingQa = open.filter((d) =>
    d.status === "RESOLVED_DEV" || d.status === "QA_PASSED" || d.status === "READY_FOR_VERIFICATION",
  );
  const blocked = open.filter((d) => d.is_blocked);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const resolvedThisMonth = assigned.filter((d) => {
    if (d.status !== "RESOLVED_DEV" && d.status !== "CLOSED" && d.status !== "PASSED_BY_AGREEMENT" && d.status !== "QA_PASSED") {
      return false;
    }
    const ts = d.resolved_at ?? d.closed_at ?? d.updated_at;
    return ts && new Date(ts) >= monthStart;
  }).length;

  const aging = open.filter((d) => ageDays(d.created_at) > 7);

  const bySeverity: Record<string, number> = {};
  for (const d of open) {
    const sev = d.severity || "Unspecified";
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
  }

  const ageBuckets = { "0-2": 0, "3-7": 0, "8-14": 0, "14+": 0 };
  for (const d of open) {
    const a = ageDays(d.created_at);
    if (a <= 2) ageBuckets["0-2"]++;
    else if (a <= 7) ageBuckets["3-7"]++;
    else if (a <= 14) ageBuckets["8-14"]++;
    else ageBuckets["14+"]++;
  }

  const sevOrder = (s: string | null) => {
    if (s === "Critical") return 0;
    if (s === "Major" || s === "High") return 1;
    if (s === "Minor") return 2;
    return 3;
  };

  const inbox = [...open]
    .sort((a, b) => {
      const sev = sevOrder(a.severity) - sevOrder(b.severity);
      if (sev !== 0) return sev;
      return ageDays(b.created_at) - ageDays(a.created_at);
    })
    .slice(0, 20)
    .map((d) => ({
      id: d.id,
      severity: d.severity,
      status: d.status,
      is_blocked: d.is_blocked,
      projectId: d.project_id,
      projectName: d.project?.name ?? "",
      title: d.testCase?.title ?? `Defect #${d.id}`,
      ageDays: ageDays(d.created_at),
      created_at: d.created_at,
    }));

  const blockedQueue = blocked.slice(0, 10).map((d) => ({
    id: d.id,
    severity: d.severity,
    status: d.status,
    projectId: d.project_id,
    projectName: d.project?.name ?? "",
    title: d.testCase?.title ?? `Defect #${d.id}`,
    blocked_reason: d.blocked_reason,
    ageDays: ageDays(d.created_at),
  }));

  const returnedQueue = assigned
    .filter((d) => d.status === "REGRESSED" || (d.rejection_log && !TERMINAL_DEFECT.has(d.status)))
    .slice(0, 10)
    .map((d) => ({
      id: d.id,
      severity: d.severity,
      status: d.status,
      projectId: d.project_id,
      projectName: d.project?.name ?? "",
      title: d.testCase?.title ?? `Defect #${d.id}`,
      ageDays: ageDays(d.updated_at ?? d.created_at),
    }));

  return {
    role: "DEVELOPER",
    kpis: {
      myOpen: open.length,
      inProgress: inProgress.length,
      awaitingQa: awaitingQa.length,
      aging: aging.length,
      resolvedThisMonth,
    },
    bySeverity,
    ageBuckets,
    inbox,
    blockedQueue,
    returnedQueue,
  };
}

async function buildTesterOverview(userId: number) {
  const myTrucs = await db.query.testRunUseCases.findMany({
    where: eq(schema.testRunUseCases.assigned_tester_id, userId),
    with: {
      testRun: {
        columns: { id: true, name: true, status: true, scheduled_at: true, project_id: true, updated_at: true },
        with: { project: { columns: { id: true, name: true } } },
      },
      useCase: { columns: { id: true, code: true, name: true } },
    },
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const remaining = myTrucs.filter((t) => !SCENARIO_DONE.has(t.status) && !t.tester_sign_off);
  const completedToday = myTrucs.filter((t) => {
    if (!SCENARIO_DONE.has(t.status) && !t.tester_sign_off) return false;
    const u = t.updated_at ?? t.tester_sign_off_at;
    return u && new Date(u) >= todayStart;
  });

  const dueToday = myTrucs.filter((t) => {
    const sched = t.testRun?.scheduled_at;
    if (!sched) return t.status === "in_progress" || t.status === "pending";
    const d = new Date(sched);
    return d.getFullYear() === todayStart.getFullYear()
      && d.getMonth() === todayStart.getMonth()
      && d.getDate() === todayStart.getDate();
  });

  const activeScenarios = myTrucs.filter(
    (t) => t.status === "in_progress" || (t.status === "pending" && t.testRun?.status !== "completed"),
  );

  // Pass rate from executions by this tester
  const myExecs = await db.query.executions.findMany({
    where: and(
      eq(schema.executions.tester_id, userId),
      sql`${schema.executions.overall_result} IS NOT NULL`,
    ),
    columns: { id: true, overall_result: true },
    with: { stepResults: { columns: { passed: true } } },
  });
  const steps = myExecs.flatMap((e) => e.stepResults ?? []);
  const recorded = steps.filter((s) => s.passed != null);
  const passRate = recorded.length > 0
    ? Math.round((recorded.filter((s) => s.passed === true).length / recorded.length) * 100)
    : null;

  // Defects linked to executions by this tester (open)
  const execIds = myExecs.map((e) => e.id);
  let openDefectsFound = 0;
  if (execIds.length > 0) {
    const found = await db.query.defects.findMany({
      where: and(
        inArray(schema.defects.execution_id, execIds),
        notInArray(schema.defects.status, ["CLOSED", "PASSED_BY_AGREEMENT"]),
      ),
      columns: { id: true },
    });
    openDefectsFound = found.length;
  }

  const todo = remaining.filter((t) => t.status === "pending").length;
  const inProg = remaining.filter((t) => t.status === "in_progress").length;
  const done = myTrucs.filter((t) => SCENARIO_DONE.has(t.status) || t.tester_sign_off).length;

  const continueQueue = myTrucs
    .filter((t) => t.status === "in_progress")
    .slice(0, 8)
    .map((t) => ({
      trucId: t.id,
      runId: t.test_run_id,
      runName: t.testRun?.name ?? `Run #${t.test_run_id}`,
      scenarioCode: t.useCase?.code ?? "",
      scenarioName: t.useCase?.name ?? "",
      projectName: t.testRun?.project?.name ?? "",
      status: t.status,
    }));

  const upNext = myTrucs
    .filter((t) => t.status === "pending" && t.testRun?.status !== "completed")
    .slice(0, 8)
    .map((t) => ({
      trucId: t.id,
      runId: t.test_run_id,
      runName: t.testRun?.name ?? `Run #${t.test_run_id}`,
      scenarioCode: t.useCase?.code ?? "",
      scenarioName: t.useCase?.name ?? "",
      projectName: t.testRun?.project?.name ?? "",
      scheduled_at: t.testRun?.scheduled_at ?? null,
      status: t.status,
    }));

  // Retests: defects READY_FOR_VERIFICATION on runs where tester is assigned
  const runIds = [...new Set(myTrucs.map((t) => t.test_run_id))];
  let retestQueue: Array<{
    id: number;
    severity: string | null;
    status: string;
    projectId: number;
    projectName: string;
    title: string;
    runId: number;
  }> = [];
  if (runIds.length > 0) {
    const retestDefects = await db.query.defects.findMany({
      where: and(
        inArray(schema.defects.test_run_id, runIds),
        inArray(schema.defects.status, ["READY_FOR_VERIFICATION", "QA_PASSED"]),
      ),
      with: {
        project: { columns: { id: true, name: true } },
        testCase: { columns: { id: true, title: true } },
      },
      limit: 10,
    });
    retestQueue = retestDefects.map((d) => ({
      id: d.id,
      severity: d.severity,
      status: d.status,
      projectId: d.project_id,
      projectName: d.project?.name ?? "",
      title: d.testCase?.title ?? `Defect #${d.id}`,
      runId: d.test_run_id,
    }));
  }

  return {
    role: "TESTER",
    kpis: {
      dueToday: dueToday.length || activeScenarios.length,
      myRemaining: remaining.length,
      completedToday: completedToday.length,
      passRate,
      openDefectsFound,
    },
    todayProgress: { todo, inProgress: inProg, done },
    continueQueue,
    upNext,
    retestQueue,
  };
}

export default router;
