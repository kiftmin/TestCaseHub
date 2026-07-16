import express from "express";
import { eq, desc, and, or, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, checkProjectRole, denyUnlessProjectAccess, AuthenticatedRequest } from "../middlewares/auth.js";
import { bumpProjectVersion, logAudit } from "../utils/project.js";
import { classifySiblingCases } from "../utils/retest-scope.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

function generateProjectCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "PRJ-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function getAttachmentCounts(projectIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (projectIds.length === 0) return map;

  const defectAttachments = await db
    .select({
      projectId: schema.defects.project_id,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(schema.attachments)
    .innerJoin(schema.defects, and(
      eq(schema.attachments.entity_type, "defect"),
      eq(schema.attachments.entity_id, schema.defects.id),
      inArray(schema.defects.project_id, projectIds),
    ))
    .groupBy(schema.defects.project_id);

  const runAttachments = await db
    .select({
      projectId: schema.testRuns.project_id,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(schema.attachments)
    .innerJoin(schema.testRuns, and(
      or(eq(schema.attachments.entity_type, "test_run"), eq(schema.attachments.entity_type, "test-run")),
      eq(schema.attachments.entity_id, schema.testRuns.id),
      inArray(schema.testRuns.project_id, projectIds),
    ))
    .groupBy(schema.testRuns.project_id);

  for (const row of defectAttachments) {
    map.set(row.projectId, (map.get(row.projectId) ?? 0) + row.count);
  }
  for (const row of runAttachments) {
    map.set(row.projectId, (map.get(row.projectId) ?? 0) + row.count);
  }
  return map;
}

async function getSingleAttachmentCount(projectId: number): Promise<number> {
  const map = await getAttachmentCounts([projectId]);
  return map.get(projectId) ?? 0;
}

// GET /api/projects - List all projects
router.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.user!.role === "ADMIN") {
      const rows = await db.query.projects.findMany({
        with: {
          testLead: true,
          useCases: { columns: { id: true } },
          testRuns: { columns: { id: true } },
        },
        orderBy: desc(schema.projects.created_at),
      });
      const rowsWithCounts = rows.map(({ useCases, testRuns, ...p }) => ({
        ...p, useCaseCount: useCases.length, testRunCount: testRuns.length,
      }));
      const attachmentCounts = await getAttachmentCounts(rowsWithCounts.map(p => p.id));
      res.json(rowsWithCounts.map(p => ({ ...p, attachmentCount: attachmentCounts.get(p.id) ?? 0 })));
    } else {
      const assignments = await db.query.projectAssignments.findMany({
        where: eq(schema.projectAssignments.user_id, req.user!.userId),
        with: {
          project: {
            with: {
              testLead: true,
              useCases: { columns: { id: true } },
              testRuns: { columns: { id: true } },
            },
          },
        },
      });
      const rowsWithCounts = assignments.map(a => {
        const { useCases, testRuns, ...p } = a.project;
        return { ...p, useCaseCount: useCases.length, testRunCount: testRuns.length };
      });
      const attachmentCounts = await getAttachmentCounts(rowsWithCounts.map(p => p.id));
      res.json(rowsWithCounts.map(p => ({ ...p, attachmentCount: attachmentCounts.get(p.id) ?? 0 })));
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
    if (!(await denyUnlessProjectAccess(req, res, projectId))) return;
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
        testRuns: { columns: { id: true } },
      },
    });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }
    const { testRuns, ...rest } = project;
    const attachmentCount = await getSingleAttachmentCount(projectId);
    res.json({ ...rest, useCaseCount: project.useCases.length, testRunCount: testRuns.length, attachmentCount });
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/test-runs
router.get("/:projectId/test-runs", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!(await denyUnlessProjectAccess(req, res, projectId))) return;
    const data = await db.query.testRuns.findMany({
      where: eq(schema.testRuns.project_id, projectId),
      orderBy: desc(schema.testRuns.scheduled_at),
    });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/test-runs/retest-preview — sibling classification for UI
router.get("/:projectId/test-runs/retest-preview", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!(await denyUnlessProjectAccess(req, res, projectId))) return;

    const defects = await db.query.defects.findMany({
      where: and(
        eq(schema.defects.project_id, projectId),
        eq(schema.defects.status, "READY_FOR_VERIFICATION"),
      ),
      with: { testCase: true },
    });

    const activeRetestRuns = await db.query.testRuns.findMany({
      where: and(
        eq(schema.testRuns.project_id, projectId),
        eq(schema.testRuns.run_type, "retest"),
        ne(schema.testRuns.status, "completed"),
      ),
      columns: { id: true },
    });
    const activeRunIds = activeRetestRuns.map((r) => r.id);
    let alreadyEnrolled = new Set<number>();
    if (activeRunIds.length > 0) {
      const enrollments = await db.query.defectRetests.findMany({
        where: inArray(schema.defectRetests.target_verification_run_id, activeRunIds),
        columns: { defect_id: true },
      });
      alreadyEnrolled = new Set(enrollments.map((e) => e.defect_id));
    }

    const eligible = defects.filter((d) => !alreadyEnrolled.has(d.id) && d.testCase);
    const siblings = await classifySiblingCases(projectId, eligible);

    const summary = {
      verify: siblings.filter((s) => s.role === "verify").length,
      blocked: siblings.filter((s) => s.role === "blocked").length,
      regression: siblings.filter((s) => s.role === "regression").length,
      rfvDefects: eligible.length,
      skippedAlreadyEnrolled: defects.length - eligible.length,
      scenarios: new Set(siblings.map((s) => s.useCaseId)).size,
    };

    res.json({ summary, cases: siblings });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:projectId/test-runs/retest — TEST_LEAD / ADMIN only
// Phase A+B: RFV cases (verify) + optional regression siblings; blocked listed but not executable.
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
      /** Phase B: include safe sibling cases as regression */
      includeRegression: z.boolean().optional().default(false),
      /** Optional subset of regression case IDs; if omitted and includeRegression, all regression candidates */
      regressionTestCaseIds: z.array(z.number()).optional(),
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

    // Skip defects already enrolled in an incomplete retest run
    const activeRetestRuns = await db.query.testRuns.findMany({
      where: and(
        eq(schema.testRuns.project_id, projectId),
        eq(schema.testRuns.run_type, "retest"),
        ne(schema.testRuns.status, "completed"),
      ),
      columns: { id: true },
    });
    const activeRunIds = activeRetestRuns.map((r) => r.id);
    let alreadyEnrolled = new Set<number>();
    if (activeRunIds.length > 0) {
      const enrollments = await db.query.defectRetests.findMany({
        where: inArray(schema.defectRetests.target_verification_run_id, activeRunIds),
        columns: { defect_id: true },
      });
      alreadyEnrolled = new Set(enrollments.map((e) => e.defect_id));
    }

    const eligible = defects.filter((d) => !alreadyEnrolled.has(d.id) && d.testCase);
    if (eligible.length === 0) {
      res.status(400).json({
        message: "All READY_FOR_VERIFICATION defects are already enrolled in an active retest run",
      });
      return;
    }

    // 2. Classify siblings
    const siblings = await classifySiblingCases(projectId, eligible);
    const verifyCases = siblings.filter((s) => s.role === "verify");
    const blockedCases = siblings.filter((s) => s.role === "blocked");
    const regressionCandidates = siblings.filter((s) => s.role === "regression");

    let regressionToInclude = regressionCandidates;
    if (!parsed.includeRegression) {
      regressionToInclude = [];
    } else if (parsed.regressionTestCaseIds && parsed.regressionTestCaseIds.length > 0) {
      const allowedIds = new Set(parsed.regressionTestCaseIds);
      // Only allow IDs that are actual regression candidates (never blocked/verify via this path)
      regressionToInclude = regressionCandidates.filter((c) => allowedIds.has(c.testCaseId));
    }

    const useCaseIds = Array.from(
      new Set([
        ...verifyCases.map((c) => c.useCaseId),
        ...regressionToInclude.map((c) => c.useCaseId),
        // Keep blocked scenarios for visibility when they share a scenario with verify
        ...blockedCases
          .filter((b) => verifyCases.some((v) => v.useCaseId === b.useCaseId))
          .map((c) => c.useCaseId),
      ]),
    );

    // 3. Create the retest run + scope + enrollments
    const newRun = await db.transaction(async (tx) => {
      const [run] = await tx.insert(schema.testRuns).values({
        project_id: projectId,
        name: parsed.name,
        scheduled_at: parsed.scheduled_at ? new Date(parsed.scheduled_at) : null,
        run_type: "retest",
      }).returning();

      for (const useCaseId of useCaseIds) {
        await tx.insert(schema.testRunUseCases).values({
          test_run_id: run.id,
          use_case_id: useCaseId,
        });
      }

      // Enroll RFV defects
      for (const defect of eligible) {
        await tx.insert(schema.defectRetests).values({
          defect_id: defect.id,
          test_run_id: defect.test_run_id,
          target_verification_run_id: run.id,
        });
      }

      // Persist case scope
      const scopeRows: Array<{
        test_run_id: number;
        test_case_id: number;
        role: "verify" | "regression" | "blocked";
        defect_id: number | null;
      }> = [];

      for (const c of verifyCases) {
        scopeRows.push({
          test_run_id: run.id,
          test_case_id: c.testCaseId,
          role: "verify",
          defect_id: c.defectId,
        });
      }
      for (const c of regressionToInclude) {
        scopeRows.push({
          test_run_id: run.id,
          test_case_id: c.testCaseId,
          role: "regression",
          defect_id: null,
        });
      }
      // Blocked siblings in same scenarios (visibility only)
      for (const c of blockedCases) {
        if (!useCaseIds.includes(c.useCaseId)) continue;
        scopeRows.push({
          test_run_id: run.id,
          test_case_id: c.testCaseId,
          role: "blocked",
          defect_id: c.defectId,
        });
      }

      if (scopeRows.length > 0) {
        await tx.insert(schema.testRunCaseScope).values(scopeRows);
      }

      const defaultItems = [
        "Fixes have been deployed to the test environment",
        "Test data has been refreshed as required",
        "All testers have been notified of the retest scope",
        "Verify cases: only Ready-for-Verification defects; blocked cases must not be executed",
        "Test environment is accessible to all assigned testers",
      ];
      await tx.insert(schema.testRunChecklistItems).values(
        defaultItems.map((item_text, sort_order) => ({
          test_run_id: run.id,
          item_text,
          sort_order: sort_order + 1,
        })),
      );

      return run;
    });

    await logAudit({
      entityType: "test_run",
      entityId: newRun.id,
      changedByUserId: req.user!.userId,
      toStatus: "created_retest",
      reason: `verify=${verifyCases.length} regression=${regressionToInclude.length} blocked=${blockedCases.length} scenarios=${useCaseIds.length}`,
    });

    res.status(201).json({
      ...newRun,
      defect_count: eligible.length,
      verify_case_count: verifyCases.length,
      regression_case_count: regressionToInclude.length,
      blocked_case_count: blockedCases.filter((b) => useCaseIds.includes(b.useCaseId)).length,
      use_case_count: useCaseIds.length,
      skipped_already_enrolled: defects.length - eligible.length,
      verification_items: verifyCases.map((c) => ({
        defect_id: c.defectId,
        bug_number: c.bugNumber,
        test_case_id: c.testCaseId,
        case_number: c.caseNumber,
        case_title: c.caseTitle,
        use_case_id: c.useCaseId,
        role: "verify" as const,
      })),
      regression_items: regressionToInclude.map((c) => ({
        test_case_id: c.testCaseId,
        case_number: c.caseNumber,
        case_title: c.caseTitle,
        use_case_id: c.useCaseId,
        role: "regression" as const,
      })),
      blocked_items: blockedCases
        .filter((b) => useCaseIds.includes(b.useCaseId))
        .map((c) => ({
          defect_id: c.defectId,
          bug_number: c.bugNumber,
          test_case_id: c.testCaseId,
          case_number: c.caseNumber,
          case_title: c.caseTitle,
          use_case_id: c.useCaseId,
          role: "blocked" as const,
          blocking_reason: c.blockingReason,
        })),
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

    const deleteSchema = z.object({ confirmName: z.string() });
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "confirmName is required" });
      return;
    }

    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { id: true, name: true, project_code: true },
    });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }

    if (parsed.data.confirmName !== project.name) {
      res.status(400).json({ message: "confirmName does not match project name" });
      return;
    }

    // Collect defect and test-run IDs for attachment cleanup
    const defectIds = (await db.query.defects.findMany({
      where: eq(schema.defects.project_id, projectId),
      columns: { id: true },
    })).map(d => d.id);

    const testRunIds = (await db.query.testRuns.findMany({
      where: eq(schema.testRuns.project_id, projectId),
      columns: { id: true },
    })).map(r => r.id);

    // Collect file URLs before deleting rows
    const attachmentFilter = defectIds.length === 0 && testRunIds.length === 0
      ? sql`1=0`
      : or(
          and(eq(schema.attachments.entity_type, "defect"), inArray(schema.attachments.entity_id, defectIds.length > 0 ? defectIds : [-1])),
          and(eq(schema.attachments.entity_type, "test_run"), inArray(schema.attachments.entity_id, testRunIds.length > 0 ? testRunIds : [-1])),
          and(eq(schema.attachments.entity_type, "test-run"), inArray(schema.attachments.entity_id, testRunIds.length > 0 ? testRunIds : [-1])),
        );

    const attachmentsToDelete = await db.query.attachments.findMany({
      where: attachmentFilter,
      columns: { file_url: true },
    });

    // Transaction for DB cleanup
    await db.transaction(async (tx) => {
      if (defectIds.length > 0 || testRunIds.length > 0) {
        await tx.delete(schema.attachments).where(attachmentFilter);
      }
      await tx.delete(schema.projects).where(eq(schema.projects.id, projectId));
    });

    // Best-effort filesystem cleanup after transaction
    for (const att of attachmentsToDelete) {
      if (!att.file_url) continue;
      try {
        const filePath = path.join(__dirname, "../../", att.file_url.replace(/^\//, ""));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch { /* best-effort */ }
    }

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
    if (!(await denyUnlessProjectAccess(req, res, project.id))) return;
    res.json(project);
  } catch (err) { next(err); }
});

// POST /api/projects/:projectId/sign-off — TEST_LEAD or BUSINESS_OWNER dual signature
router.post("/:projectId/sign-off", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);

    const isTestLead = await checkProjectRole(req, projectId, ["TEST_LEAD"], { allowAdminBypass: false });
    const isBusinessOwner = await checkProjectRole(req, projectId, ["BUSINESS_OWNER"], { allowAdminBypass: false });

    let key: string;
    if (isTestLead) {
      key = "testLead";
    } else if (isBusinessOwner) {
      key = "businessOwner";
    } else {
      res.status(403).json({ message: "Only the assigned Test Lead or Business Owner can sign this certificate." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .for("update");
      if (!project) {
        throw Object.assign(new Error("Project not found"), { status: 404 });
      }

      let signOffData: Record<string, unknown> = {};
      try {
        signOffData = JSON.parse(project.sign_off_data || "{}") as Record<string, unknown>;
      } catch {
        signOffData = {};
      }

      const signatureImage =
        typeof req.body.signatureImage === "string" && req.body.signatureImage.startsWith("data:image/")
          ? req.body.signatureImage
          : undefined;

      signOffData[key] = {
        name: req.body.name || "",
        role: req.body.role || "",
        date: new Date().toISOString(),
        signature: req.body.signature || "",
        ...(signatureImage ? { signatureImage } : {}),
      };

      if (req.body.businessDecisions) {
        signOffData.businessDecisions = req.body.businessDecisions;
      }

      const signedOff = signOffData.testLead && signOffData.businessOwner ? 1 : 0;

      await tx
        .update(schema.projects)
        .set({
          sign_off_data: JSON.stringify(signOffData),
          is_signed_off: signedOff,
          updated_at: new Date(),
        })
        .where(eq(schema.projects.id, projectId));

      return { is_signed_off: signedOff, sign_off_data: signOffData };
    });

    await logAudit({
      entityType: "project",
      entityId: projectId,
      changedByUserId: req.user!.userId,
      toStatus: result.is_signed_off ? "fully_signed_off" : "partially_signed_off",
    });

    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status && err instanceof Error) {
      res.status(status).json({ message: err.message });
      return;
    }
    next(err);
  }
});

// GET /api/projects/:projectId/sign-off-status
router.get("/:projectId/sign-off-status", async (req: AuthenticatedRequest, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!(await denyUnlessProjectAccess(req, res, projectId))) return;
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
    if (!(await denyUnlessProjectAccess(req, res, projectId))) return;

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

    const TERMINAL = new Set(["CLOSED", "PASSED_BY_AGREEMENT", "REJECTED", "DUPLICATE"]);
    const defectsByStatus: Record<string, number> = {};
    const defectsBySeverity: Record<string, number> = {};
    const openBySeverity: Record<string, number> = {};
    let openDefects = 0;
    let acceptedByAgreement = 0;

    for (const run of testRuns) {
      for (const defect of run.defects) {
        defectsByStatus[defect.status] = (defectsByStatus[defect.status] || 0) + 1;
        if (defect.severity) {
          defectsBySeverity[defect.severity] = (defectsBySeverity[defect.severity] || 0) + 1;
        }
        if (defect.status === "PASSED_BY_AGREEMENT") {
          acceptedByAgreement += 1;
        }
        if (!TERMINAL.has(defect.status)) {
          openDefects += 1;
          const sev = defect.severity || "Unspecified";
          openBySeverity[sev] = (openBySeverity[sev] || 0) + 1;
        }
      }
    }

    res.json({
      totalScenarios,
      totalTestRuns: total,
      passRate,
      defectsByStatus,
      defectsBySeverity,
      openDefects,
      openBySeverity,
      acceptedByAgreement,
    });
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
    if (!(await denyUnlessProjectAccess(req, res, projectId))) return;
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }

    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;

    const conditions: any[] = [];
    if (entityType) conditions.push(eq(schema.statusAuditLog.entity_type, entityType));
    if (entityId) {
      // Only allow entity IDs that belong to this project (defects or the project itself)
      const defect = await db.query.defects.findFirst({
        where: and(eq(schema.defects.id, entityId), eq(schema.defects.project_id, projectId)),
        columns: { id: true },
      });
      if (!defect && entityId !== projectId) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
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
    if (!(await denyUnlessProjectAccess(req, res, projectId))) return;

    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) { res.status(404).json({ message: "Project not found" }); return; }

    const limit = Number(req.query.limit) || 200;
    const offset = Number(req.query.offset) || 0;
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;

    // Resolve the set of entity IDs that belong to this project.
    const defectRows = await db.query.defects.findMany({
      where: eq(schema.defects.project_id, projectId),
      columns: { id: true },
    });
    const projectDefectIds = defectRows.map((d) => d.id);

    const conditions: any[] = [];

    if (entityId) {
      if (!projectDefectIds.includes(entityId) && entityId !== projectId) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
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
