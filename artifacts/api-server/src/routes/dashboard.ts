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

    const recentBugs = await db.query.bugs.findMany({
      orderBy: desc(schema.bugs.created_at),
      limit,
      with: { defect: true },
    });

    res.json({
      recentExecutions,
      recentDefects,
      recentBugs,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/developer/:userId/bugs
router.get("/developer/:userId/bugs", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);

    const assignedBugs = await db.query.bugs.findMany({
      where: eq(schema.bugs.assigned_developer_id, userId),
      with: { defect: true, project: true },
      orderBy: desc(schema.bugs.created_at),
    });

    res.json(assignedBugs);
  } catch (err) {
    next(err);
  }
});

export default router;
