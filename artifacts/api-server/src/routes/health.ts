import express from "express";
import { db } from "../db.js";
import { sql } from "drizzle-orm";

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ok", database: "up" });
  } catch (err) {
    res.status(503).json({ status: "degraded", database: "down", message: (err as Error).message });
  }
});

export default router;
