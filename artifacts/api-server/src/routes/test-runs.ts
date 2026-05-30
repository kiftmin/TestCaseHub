import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";

const router = express.Router();

// GET /api/test-runs - list all (filter by projectId query param)
router.get("/", async (req, res, next) => {
  try {
    const projectId = Number(req.query.projectId);
    if (!projectId) {
      res.status(400).json({ message: "projectId query parameter is required" });
      return;
    }
    const data = await db.query.testRuns.findMany({
      where: eq(schema.testRuns.project_id, projectId),
      orderBy: desc(schema.testRuns.scheduled_at),
    });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/test-runs/:testRunId
router.get("/:testRunId", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRun = await db.query.testRuns.findFirst({
      where: eq(schema.testRuns.id, testRunId),
      with: {
        checklistItems: true,
        executions: true,
        useCases: { with: { useCase: true, tester: true } },
        project: true,
      },
    });
    if (!testRun) { res.status(404).json({ message: "Test run not found" }); return; }
    res.json(testRun);
  } catch (err) { next(err); }
});

// POST /api/projects/:projectId/test-runs
router.post("/", async (req, res, next) => {
  try {
    const projectId = Number(req.body.project_id);
    if (!projectId) { res.status(400).json({ message: "project_id is required in body" }); return; }

    const parsed = z.object({
      project_id: z.number(),
      name: z.string(),
      scheduled_at: z.string().optional(),
    }).parse(req.body);

    const [testRun] = await db.insert(schema.testRuns).values({
      project_id: parsed.project_id,
      name: parsed.name,
      scheduled_at: parsed.scheduled_at ? new Date(parsed.scheduled_at) : null,
    }).returning();

    // Auto-seed 5 checklist items
    const defaultItems = [
      "Test environment is deployed and accessible",
      "Test data has been loaded and verified",
      "All testers have been granted system access",
      "Test scenarios and cases have been reviewed and approved",
      "Defect tracking process has been communicated to the team",
    ];
    const checklistValues = defaultItems.map((itemText, index) => ({
      test_run_id: testRun.id,
      item_text: itemText,
      sort_order: index + 1,
    }));
    await db.insert(schema.testRunChecklistItems).values(checklistValues);

    // Bump project version
    await db.update(schema.projects)
      .set({ version: sql`${schema.projects.version} + 1`, version_date: new Date() })
      .where(eq(schema.projects.id, projectId));

    res.status(201).json(testRun);
  } catch (err) { next(err); }
});

// PATCH /api/test-runs/:testRunId
router.patch("/:testRunId", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const [updated] = await db.update(schema.testRuns)
      .set({ ...req.body, updated_at: new Date() })
      .where(eq(schema.testRuns.id, testRunId))
      .returning();
    if (!updated) { res.status(404).json({ message: "Not found" }); return; }
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/test-runs/:testRunId (scheduled only)
router.delete("/:testRunId", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const existing = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }
    if (existing.status !== "scheduled") { res.status(400).json({ message: "Only scheduled runs can be deleted" }); return; }
    await db.delete(schema.testRuns).where(eq(schema.testRuns.id, testRunId));
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/test-runs/:testRunId/re-run
router.post("/:testRunId/re-run", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const source = await db.query.testRuns.findFirst({
      where: eq(schema.testRuns.id, testRunId),
      with: { useCases: true },
    });
    if (!source) { res.status(404).json({ message: "Source test run not found" }); return; }

    const parsed = z.object({ name: z.string(), scheduled_at: z.string().optional(), failedOnly: z.boolean().optional().default(false) }).parse(req.body);

    const [newRun] = await db.insert(schema.testRuns).values({
      project_id: source.project_id,
      name: parsed.name,
      scheduled_at: parsed.scheduled_at ? new Date(parsed.scheduled_at) : null,
      source_test_run_id: testRunId,
    }).returning();

    const useCasesToCopy = parsed.failedOnly
      ? source.useCases.filter(uc => uc.status === "failed")
      : source.useCases;

    for (const uc of useCasesToCopy) {
      await db.insert(schema.testRunUseCases).values({
        test_run_id: newRun.id,
        use_case_id: uc.use_case_id,
      });
    }

    // Auto-seed checklist items
    const defaultItems = [
      "Test environment is deployed and accessible",
      "Test data has been loaded and verified",
      "All testers have been granted system access",
      "Test scenarios and cases have been reviewed and approved",
      "Defect tracking process has been communicated to the team",
    ];
    const checklistValues = defaultItems.map((itemText, index) => ({
      test_run_id: newRun.id,
      item_text: itemText,
      sort_order: index + 1,
    }));
    await db.insert(schema.testRunChecklistItems).values(checklistValues);

    res.status(201).json(newRun);
  } catch (err) { next(err); }
});

// POST /api/test-runs/:testRunId/confirm-entry
router.post("/:testRunId/confirm-entry", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const userId = (req as any).user?.userId;
    const [updated] = await db.update(schema.testRuns)
      .set({
        entry_confirmed: true,
        entry_confirmed_by_user_id: userId,
        entry_confirmed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(schema.testRuns.id, testRunId))
      .returning();
    if (!updated) { res.status(404).json({ message: "Not found" }); return; }
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/test-runs/:testRunId/confirm-entry (alternative)
router.patch("/:testRunId/confirm-entry", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const userId = (req as any).user?.userId;
    const [updated] = await db.update(schema.testRuns)
      .set({
        entry_confirmed: true,
        entry_confirmed_by_user_id: userId,
        entry_confirmed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(schema.testRuns.id, testRunId))
      .returning();
    if (!updated) { res.status(404).json({ message: "Not found" }); return; }
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/test-runs/:testRunId/access-qr
router.get("/:testRunId/access-qr", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRun = await db.query.testRuns.findFirst({ where: eq(schema.testRuns.id, testRunId) });
    if (!testRun) { res.status(404).json({ message: "Not found" }); return; }

    const accessUrl = `${req.protocol}://${req.get("host")}/tester/run/${testRunId}`;

    let qrDataUrl = "";
    try {
      const QRCode = (await import("qrcode")).default;
      qrDataUrl = await QRCode.toDataURL(accessUrl, { width: 256, margin: 2 });
    } catch {
      qrDataUrl = "";
    }

    res.json({ accessUrl, qrDataUrl });
  } catch (err) { next(err); }
});

// GET /api/test-runs/:testRunId/full-report
router.get("/:testRunId/full-report", async (req, res, next) => {
  try {
    const testRunId = Number(req.params.testRunId);
    const testRun = await db.query.testRuns.findFirst({
      where: eq(schema.testRuns.id, testRunId),
      with: {
        project: true,
        useCases: {
          with: {
            useCase: { with: { testCases: { with: { steps: true } } } },
            tester: true,
          },
        },
        executions: { with: { testCase: true, stepResults: true } },
        defects: { with: { testCase: true, retests: true } },
      },
    });
    if (!testRun) { res.status(404).json({ message: "Not found" }); return; }
    res.json(testRun);
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/test-runs/analytics
router.get("/analytics", async (req, res, next) => {
  try {
    const projectId = Number(req.query.projectId);
    if (!projectId) { res.status(400).json({ message: "projectId required" }); return; }

    const runs = await db.query.testRuns.findMany({
      where: eq(schema.testRuns.project_id, projectId),
    });

    const total = runs.length;
    const passed = runs.filter(r => r.passed === true).length;
    const failed = runs.filter(r => r.passed === false).length;
    const inProgress = runs.filter(r => r.status === "in_progress").length;
    const scheduled = runs.filter(r => r.status === "scheduled").length;

    res.json({ total, passed, failed, inProgress, scheduled, passRate: total > 0 ? Math.round((passed / total) * 100) : 0 });
  } catch (err) { next(err); }
});

export default router;
