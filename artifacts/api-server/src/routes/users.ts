import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, invalidateUserCache, AuthenticatedRequest } from "../middlewares/auth.js";
import { logAudit } from "../utils/project.js";

const router = express.Router();

router.use(authenticate);
// Most endpoints require ADMIN; GET / is open to all authenticated users (for user selection dropdowns)
router.get("/", async (req, res, next) => {
  try {
    const users = await db.query.users.findMany({
      columns: { password_hash: false },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

const createUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["ADMIN", "USER"]),
});

const updateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["ADMIN", "USER"]),
});

const updatePasswordSchema = z.object({
  password: z.string().min(8),
});

router.post("/", authorize(["ADMIN"]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { username, password, name, email, role } = createUserSchema.parse(req.body);
    const hashedPassword = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(schema.users)
      .values({ username, password_hash: hashedPassword, name, email, role })
      .returning();
    const { password_hash, ...safeUser } = user;
    await logAudit({ entityType: "user", entityId: user.id, changedByUserId: req.user!.userId, toStatus: "created", reason: username });
    res.status(201).json(safeUser);
  } catch (err) {
    next(err);
  }
});

router.put("/:userId", authorize(["ADMIN"]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name, email, role } = updateUserSchema.parse(req.body);
    const userId = Number(req.params.userId);
    const [user] = await db
      .update(schema.users)
      .set({ name, email, role })
      .where(eq(schema.users.id, userId))
      .returning();
    invalidateUserCache(userId);
    const { password_hash, ...safeUser } = user;
    await logAudit({ entityType: "user", entityId: user.id, changedByUserId: req.user!.userId, toStatus: "updated", reason: user.username });
    res.json(safeUser);
  } catch (err) {
    next(err);
  }
});

router.put("/:userId/suspend", authorize(["ADMIN"]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const [user] = await db
      .update(schema.users)
      .set({ is_active: sql`NOT is_active` })
      .where(eq(schema.users.id, userId))
      .returning();
    invalidateUserCache(userId);
    const { password_hash, ...safeUser } = user;
    await logAudit({ entityType: "user", entityId: userId, changedByUserId: req.user!.userId, toStatus: user.is_active ? "activated" : "suspended", reason: user.username });
    res.json(safeUser);
  } catch (err) {
    next(err);
  }
});

router.put("/:userId/password", authorize(["ADMIN"]), async (req, res, next) => {
  try {
    const { password } = updatePasswordSchema.parse(req.body);
    const hashedPassword = await bcrypt.hash(password, 12);
    const [user] = await db
      .update(schema.users)
      .set({ password_hash: hashedPassword })
      .where(eq(schema.users.id, Number(req.params.userId)))
      .returning();
    const { password_hash, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    next(err);
  }
});

router.delete("/:userId", authorize(["ADMIN"]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const targetUser = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const adminResult = await pool.query("SELECT COUNT(*) FROM users WHERE role = $1", ["ADMIN"]);
    const adminCount = Number(adminResult.rows[0].count);

    if (adminCount === 1 && targetUser.role === "ADMIN") {
      return res.status(403).json({ message: "Cannot delete last admin" });
    }

    const assignmentResult = await pool.query("SELECT COUNT(*) FROM project_assignments WHERE user_id = $1", [userId]);
    const assignmentCount = Number(assignmentResult.rows[0].count);

    if (assignmentCount > 0) {
      return res.status(409).json({ message: "User has project assignments" });
    }

    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await logAudit({ entityType: "user", entityId: userId, changedByUserId: req.user!.userId, toStatus: "deleted", reason: targetUser.username });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
