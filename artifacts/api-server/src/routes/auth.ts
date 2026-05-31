import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import { authenticate, authorize } from "../middlewares/auth.js";

const router = express.Router();

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const registerSchema = z.object({
  username: z.string(),
  password: z.string().min(6),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["ADMIN", "USER"]),
});

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user = await db.query.users.findFirst({
      where: eq(schema.users.username, username),
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.is_active) {
      return res.status(403).json({ message: "Account has been suspended" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.SESSION_SECRET,
      { expiresIn: "7d" }
    );

    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
});

router.post("/register", authenticate, authorize(["ADMIN"]), async (req, res, next) => {
  try {
    const { username, password, name, email, role } = registerSchema.parse(req.body);

    const hashedPassword = await bcrypt.hash(password, 10);

    const [user] = await db
      .insert(schema.users)
      .values({ username, password_hash: hashedPassword, name, email, role })
      .returning();

    const { password_hash, ...safeUser } = user;
    res.status(201).json(safeUser);
  } catch (err) {
    next(err);
  }
});

export default router;
