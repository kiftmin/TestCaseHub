import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";
import { bumpProjectVersion, logAudit } from "../utils/project.js";

const router = express.Router();

function generateProjectCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "PRJ-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /api/projects - List all projects
router.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.user!.role === "ADMIN") {
      const projects = await db.query.projects.findMany({
        with: { testLead: true },
        orderBy: desc(schema.projects.created_at),
      });
      res.json(projects);
    } else {
      const assignments = await db.query.projectAssignments.findMany({
        where: eq(schema.projectAssignments.user_id, req.user!.userId),
        with: { project: { with: { testLead: true } } },
      });
      const projects = assignments.map(a => a.project);
      res.json(projects);
    }
  } catch (err) { next(err); }
});

// POST /api/projects - Create project (Admin only)
router.post("/", authenticate, authorize(["ADMIN"]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const bodySchema = z.object({
      name: z.string(),
      designedBy: z.string(),
      moduleName: z.string(),
      designDate: z.string(),
      testLink: z.string().nullable().optional(),
      testLeadId: z.number(),
      objectives: z.string().nullable().optional(),
      scope: z.string().nullable().optional(),
      outOfScope: z.string().nullable().optional(),
      entryCriteria: z.string().nullable().optional(),
      exitCriteria: z.string().nullable().optional(),
    });
    const data = bodySchema.parse(req.body);

    const projectCode = generateProjectCode();

    const [project] = await db.insert(schema.projects)
      .values({
        project_code: projectCode,
        name: data.name,
        designed_by: data.designedBy,
        module_name: data.moduleName,
        design_date: data.designDate,
        test_link: data.testLink ?? null,
        test_lead_id: data.testLeadId,
        objectives: data.objectives ?? null,
        scope: data.scope ?? null,
        out_of_scope: data.outOfScope ?? null,
        entry_criteria: data.entryCriteria ?? null,
        exit_criteria: data.exitCriteria ?? null,
      })
      .returning();

    await db.insert(schema.projectAssignments)
      .values({
        project_id: project.id,
        user_id: data.testLeadId,
        role: "TEST_LEAD",
      });

    await logAudit({
      entityType: "project",
      entityId: project.id,
      changedByUserId: req.user!.userId,
      toStatus: "created",
    });

    res.status(201).json(project);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId - Full project detail
router.get("/:projectId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      with: {
        testLead: true,
        useCases: {
          orderBy: schema.useCases.sort_order,
          with: {
            testCases: {
              orderBy: schema.testCases.sort_order,
              with: {
                steps: {
                  orderBy: sql`CAST(${schema.testSteps.step_number} AS INTEGER)`,
                },
              },
            },
          },
        },
      },
    });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }
    res.json(project);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/test-runs
router.get("/:projectId/test-runs", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const data = await db.query.testRuns.findMany({
      where: eq(schema.testRuns.project_id, projectId),
      orderBy: desc(schema.testRuns.scheduled_at),
    });
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/projects/:projectId/test-runs/retest — TEST_LEAD / ADMIN only
router.post("/:projectId/test-runs/retest", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ message: "projectId is required" });
      return;
    }

    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed && req.user!.role !== "ADMIN") {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const parsed = z.object({
      name: z.string(),
      scheduled_at: z.string().optional(),
    }).parse(req.body);

    // 1. Find all READY_FOR_VERIFICATION defects for this project
    const defects = await db.query.defects.findMany({
      where: and(
        eq(schema.defects.project_id, projectId),
        eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      ),
      with: {
        testCase: true,
      },
    });

    if (defects.length === 0) {
      res.status(400).json({
        message: "No defects are currently at READY_FOR_VERIFICATION",
      });
      return;
    }

    // 2. Extract unique use case IDs
    const useCaseIdSet = new Set<number>();
    for (const defect of defects) {
      if (defect.testCase?.use_case_id) {
        useCaseIdSet.add(defect.testCase.use_case_id);
      }
    }
    const useCaseIds = Array.from(useCaseIdSet);

    if (useCaseIds.length === 0) {
      res.status(400).json({
        message: "Could not resolve use case IDs from the linked defects",
      });
      return;
    }

    // 3. Create the retest run
    const [newRun] = await db.insert(schema.testRuns).values({
      project_id: projectId,
      name: parsed.name,
      scheduled_at: parsed.scheduled_at ? new Date(parsed.scheduled_at) : null,
      run_type: "retest",
    }).returning();

    // 4. Insert test_run_use_cases
    for (const useCaseId of useCaseIds) {
      await db.insert(schema.testRunUseCases).values({
        test_run_id: newRun.id,
        use_case_id: useCaseId,
      });
    }

    // 5. Seed standard entry checklist
    const defaultItems = [
      "Fixes have been deployed to the test environment",
      "Test data has been refreshed as required",
      "All testers have been notified of the retest scope",
      "Defects to be retested have been communicated to the team",
      "Test environment is accessible to all assigned testers",
    ];
    await db.insert(schema.testRunChecklistItems).values(
      defaultItems.map((item_text, sort_order) => ({
        test_run_id: newRun.id,
        item_text,
        sort_order: sort_order + 1,
      })),
    );

    await logAudit({
      entityType: "test_run",
      entityId: newRun.id,
      changedByUserId: req.user!.userId,
      toStatus: "created_retest",
    });

    res.status(201).json({
      ...newRun,
      defect_count: defects.length,
      use_case_count: useCaseIds.length,
    });
  } catch (err) { next(err); }
});

// PUT /api/projects/:projectId - Update project (with Zod validation — no mass assignment)
router.put("/:projectId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const bodySchema = z.object({
      name: z.string().optional(),
      designed_by: z.string().optional(),
      module_name: z.string().optional(),
      design_date: z.string().optional(),
      test_link: z.string().nullable().optional(),
      test_lead_id: z.number().nullable().optional(),
      objectives: z.string().nullable().optional(),
      scope: z.string().nullable().optional(),
      out_of_scope: z.string().nullable().optional(),
      entry_criteria: z.string().nullable().optional(),
      exit_criteria: z.string().nullable().optional(),
    });
    const data = bodySchema.parse(req.body);

    const [project] = await db.update(schema.projects)
      .set({ ...data, updated_at: new Date() })
      .where(eq(schema.projects.id, projectId))
      .returning();

    // Sync project_assignments when test_lead_id changes
    if (data.test_lead_id !== undefined) {
      // Remove existing TEST_LEAD assignment for this project
      await db.delete(schema.projectAssignments)
        .where(and(
          eq(schema.projectAssignments.project_id, projectId),
          eq(schema.projectAssignments.role, "TEST_LEAD"),
        ));
      // Add new TEST_LEAD assignment if a user was selected
      if (data.test_lead_id !== null) {
        await db.insert(schema.projectAssignments).values({
          project_id: projectId,
          user_id: data.test_lead_id,
          role: "TEST_LEAD",
        });
      }
    }

    await bumpProjectVersion(projectId);
    await logAudit({
      entityType: "project",
      entityId: projectId,
      changedByUserId: req.user!.userId,
      toStatus: "updated",
    });

    const updatedProject = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      with: { testLead: true },
    });

    res.json(updatedProject);
  } catch (err) { next(err); }
});

// DELETE /api/projects/:projectId
router.delete("/:projectId", authenticate, authorize(["ADMIN"]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { id: true, name: true, project_code: true },
    });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await logAudit({
      entityType: "project",
      entityId: projectId,
      changedByUserId: req.user!.userId,
      toStatus: "deleted",
      reason: `Project "${project.name}" (${project.project_code}) deleted by admin`,
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/projects/code/:projectCode
router.get("/code/:projectCode", async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.project_code, req.params.projectCode),
      with: {
        testLead: true,
        useCases: {
          with: {
            testCases: {
              with: { steps: true },
            },
          },
        },
      },
    });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }
    res.json(project);
  } catch (err) { next(err); }
});

// POST /api/projects/:projectId/sign-off — TEST_LEAD or BUSINESS_OWNER dual signature
router.post("/:projectId/sign-off", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD", "BUSINESS_OWNER"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }

    let signOffData: any = {};
    try { signOffData = JSON.parse(project.sign_off_data || "{}"); } catch { signOffData = {}; }

    // Fix sign-off role key assignment (spec §8.15)
    // ADMIN or TEST_LEAD → "testLead", BUSINESS_OWNER → "businessOwner"
    const isAdminOrTestLead = req.user!.role === "ADMIN" || (await checkProjectRole(req, projectId, ["TEST_LEAD"]));
    const isBusinessOwner = await checkProjectRole(req, projectId, ["BUSINESS_OWNER"]);

    let key: string;
    if (isAdminOrTestLead) {
      key = "testLead";
    } else if (isBusinessOwner) {
      key = "businessOwner";
    } else {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    signOffData[key] = {
      name: req.body.name || "",
      role: req.body.role || "",
      date: new Date().toISOString(),
      signature: req.body.signature || "",
    };

    // Merge any additional business decision data if provided
    if (req.body.businessDecisions) {
      signOffData.businessDecisions = req.body.businessDecisions;
    }

    const signedOff = signOffData.testLead && signOffData.businessOwner ? 1 : 0;

    await db.update(schema.projects)
      .set({
        sign_off_data: JSON.stringify(signOffData),
        is_signed_off: signedOff,
        updated_at: new Date(),
      })
      .where(eq(schema.projects.id, projectId));

    await logAudit({
      entityType: "project",
      entityId: projectId,
      changedByUserId: req.user!.userId,
      toStatus: signedOff ? "fully_signed_off" : "partially_signed_off",
    });

    res.json({ is_signed_off: signedOff, sign_off_data: signOffData });
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/sign-off-status
router.get("/:projectId/sign-off-status", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { is_signed_off: true, sign_off_data: true },
    });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }
    res.json(project);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/uat-summary
router.get("/:projectId/uat-summary", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);

    const testRuns = await db.query.testRuns.findMany({
      where: eq(schema.testRuns.project_id, projectId),
      with: {
        useCases: true,
        defects: true,
      },
    });

    const totalScenarios = testRuns.reduce((sum, r) => sum + r.useCases.length, 0);
    const passed = testRuns.filter(r => r.passed === true).length;
    const total = testRuns.length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    const defectsByStatus: Record<string, number> = {};
    const defectsBySeverity: Record<string, number> = {};
    for (const run of testRuns) {
      for (const defect of run.defects) {
        defectsByStatus[defect.status] = (defectsByStatus[defect.status] || 0) + 1;
        if (defect.severity) defectsBySeverity[defect.severity] = (defectsBySeverity[defect.severity] || 0) + 1;
      }
    }

    res.json({ totalScenarios, totalTestRuns: total, passRate, defectsByStatus, defectsBySeverity });
  } catch (err) { next(err); }
});

function escapeCsvField(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  const dangerousFirstChar = /^[=+\-@]/;
  const needsQuoting = /[,"\n\r]/;
  let escaped = str;
  if (dangerousFirstChar.test(escaped)) escaped = "'" + escaped;
  if (needsQuoting.test(escaped)) escaped = '"' + escaped.replace(/"/g, '""') + '"';
  return escaped;
}

// GET /api/projects/:projectId/audit-log/csv — full audit log CSV download
router.get("/:projectId/audit-log/csv", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }

    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;

    const conditions: any[] = [];
    if (entityType) conditions.push(eq(schema.statusAuditLog.entity_type, entityType));
    if (entityId) {
      conditions.push(eq(schema.statusAuditLog.entity_id, entityId));
    } else {
      conditions.push(eq(schema.statusAuditLog.entity_id, projectId));
    }

    const logs = await db.query.statusAuditLog.findMany({
      where: and(...conditions),
      with: { changedBy: true },
      orderBy: desc(schema.statusAuditLog.changed_at),
    });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `audit-ledger-${date}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const headers = ["Timestamp", "User", "Action Type", "Entity Affected", "Prior State", "Post State"];
    const rows = logs.map((log) => [
      log.changed_at,
      log.changedBy?.name ?? log.changedBy?.username ?? `User #${log.changed_by_user_id}`,
      log.from_status && log.to_status ? `${log.from_status} → ${log.to_status}` : (log.to_status ?? ""),
      `${log.entity_type} #${log.entity_id}`,
      log.from_status ?? "",
      log.to_status ?? "",
    ]);

    let csv = headers.map(escapeCsvField).join(",") + "\r\n";
    for (const row of rows) {
      csv += row.map(escapeCsvField).join(",") + "\r\n";
    }
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/audit-log
router.get("/:projectId/audit-log", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);

    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }

    const limit = Number(req.query.limit) || 200;
    const offset = Number(req.query.offset) || 0;
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;

    // Resolve the set of entity IDs that belong to this project.
    // Defects are linked to a project via their test execution → test run → project.
    // We first collect all defect IDs for this project, then query audit logs for those.
    const defectRows = await db.query.defects.findMany({
      where: eq(schema.defects.project_id, projectId),
      columns: { id: true },
    });
    const projectDefectIds = defectRows.map((d) => d.id);

    const conditions: any[] = [];

    if (entityId) {
      // Specific entity requested — trust the caller
      conditions.push(eq(schema.statusAuditLog.entity_id, entityId));
    } else if (projectDefectIds.length > 0) {
      // Filter to logs whose entity_id is one of this project's defects
      conditions.push(
        sql`${schema.statusAuditLog.entity_id} IN (${sql.join(projectDefectIds.map((id) => sql`${id}`), sql`, `)})`
      );
    } else {
      // Project has no defects yet — return empty
      res.json([]);
      return;
    }

    if (entityType) {
      conditions.push(eq(schema.statusAuditLog.entity_type, entityType));
    }

    const logs = await db.query.statusAuditLog.findMany({
      where: and(...conditions),
      with: { changedBy: true },
      orderBy: desc(schema.statusAuditLog.changed_at),
      limit,
      offset,
    });
    res.json(logs);
  } catch (err) { next(err); }
});

export default router;
