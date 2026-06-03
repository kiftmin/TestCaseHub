import express from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "@workspace/db";

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

// GET /api/dashboard/recent-activity
router.get("/recent-activity", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 10;

    const recentExecutions = await db.query.executions.findMany({
      orderBy: desc(schema.executions.executed_at),
      limit,
      with: { testCase: true, testRun: true, tester: true },
    });

    const recentDefects = await db.query.defects.findMany({
      orderBy: desc(schema.defects.created_at),
      limit,
      with: { testCase: true, testRun: true },
    });

    res.json({
      recentExecutions,
      recentDefects,
    });
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
