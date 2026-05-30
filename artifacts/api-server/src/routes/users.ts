import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize, AuthenticatedRequest } from "../middlewares/auth.js";

const router = express.Router();

router.use(authenticate);
router.use(authorize(["ADMIN"]));

const createUserSchema = z.object({
  username: z.string(),
  password: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
});

const updateUserSchema = z.object({
  name: z.string(),
  email: z.string(),
  role: z.string(),
});

const updatePasswordSchema = z.object({
  password: z.string().min(6),
});

router.get("/", async (req, res, next) => {
  try {
    const users = await db.query.users.findMany();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { username, password, name, email, role } = createUserSchema.parse(req.body);
    const hashedPassword = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(schema.users)
      .values({ username, password: hashedPassword, name, email, role })
      .returning();
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

router.put("/:userId", async (req, res, next) => {
  try {
    const { name, email, role } = updateUserSchema.parse(req.body);
    const [user] = await db
      .update(schema.users)
      .set({ name, email, role })
      .where(eq(schema.users.id, req.params.userId))
      .returning();
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.put("/:userId/suspend", async (req, res, next) => {
  try {
    const [user] = await db
      .update(schema.users)
      .set({ is_active: sql`NOT is_active` })
      .where(eq(schema.users.id, req.params.userId))
      .returning();
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.put("/:userId/password", async (req, res, next) => {
  try {
    const { password } = updatePasswordSchema.parse(req.body);
    const hashedPassword = await bcrypt.hash(password, 10);
    const [user] = await db
      .update(schema.users)
      .set({ password: hashedPassword })
      .where(eq(schema.users.id, req.params.userId))
      .returning();
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.delete("/:userId", async (req, res, next) => {
  try {
    const targetUser = await db.query.users.findFirst({
      where: eq(schema.users.id, req.params.userId),
    });

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const [adminCountResult] = await db
      .select({ count: sql`COUNT(*)` })
      .from(schema.users)
      .where(eq(schema.users.role, "ADMIN"));

    const adminCount = Number(adminCountResult.count);

    if (adminCount === 1 && targetUser.role === "ADMIN") {
      return res.status(403).json({ message: "Cannot delete last admin" });
    }

    const [assignmentCountResult] = await db
      .select({ count: sql`COUNT(*)` })
      .from(schema.project_assignments)
      .where(eq(schema.project_assignments.user_id, req.params.userId));

    const assignmentCount = Number(assignmentCountResult.count);

    if (assignmentCount > 0) {
      return res.status(409).json({ message: "User has project assignments" });
    }

    await db.delete(schema.users).where(eq(schema.users.id, req.params.userId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
