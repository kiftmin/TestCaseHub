import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, authorizeProjectRole, checkProjectRole, AuthenticatedRequest } from "../middlewares/auth.js";

const router = express.Router();

function generateProjectCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "PRJ-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function bumpProjectVersion(projectId: number): Promise<void> {
  await db
    .update(schema.projects)
    .set({
      version: sql`${schema.projects.version} + 1`,
      version_date: new Date(),
    })
    .where(eq(schema.projects.id, projectId));
}

async function logAudit(params: {
  entityType: string;
  entityId: number;
  changedByUserId: number | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
}): Promise<void> {
  await db.insert(schema.statusAuditLog).values({
    entity_type: params.entityType,
    entity_id: params.entityId,
    changed_by_user_id: params.changedByUserId,
    from_status: params.fromStatus ?? null,
    to_status: params.toStatus ?? null,
    reason: params.reason ?? null,
  });
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
      test_lead_id: z.number().optional(),
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

    await bumpProjectVersion(projectId);
    await logAudit({
      entityType: "project",
      entityId: projectId,
      changedByUserId: req.user!.userId,
      toStatus: "updated",
    });

    res.json(project);
  } catch (err) { next(err); }
});

// DELETE /api/projects/:projectId
router.delete("/:projectId", authenticate, authorize(["ADMIN"]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
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
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD", "BUSINESS_OWNER", "UAT_COORDINATOR"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

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

// GET /api/projects/:projectId/audit-log
router.get("/:projectId/audit-log", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const allowed = await checkProjectRole(req, projectId, ["TEST_LEAD", "ADMIN"]);
    if (!allowed) { res.status(403).json({ message: "Forbidden" }); return; }

    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }

    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const entityType = req.query.entityType as string | undefined;

    const whereConditions = entityType
      ? and(eq(schema.statusAuditLog.entity_type, entityType), eq(schema.statusAuditLog.entity_id, projectId))
      : eq(schema.statusAuditLog.entity_id, projectId);

    const logs = await db.query.statusAuditLog.findMany({
      where: whereConditions,
      with: { changedBy: true },
      orderBy: desc(schema.statusAuditLog.changed_at),
      limit,
      offset,
    });
    res.json(logs);
  } catch (err) { next(err); }
});

export default router;
