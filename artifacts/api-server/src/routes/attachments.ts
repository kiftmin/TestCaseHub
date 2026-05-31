import express from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import * as schema from "@workspace/db";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// Allowed MIME types per spec: images, PDF, DOCX, XLSX
const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF, DOCX, XLSX"));
    }
  },
});

// POST /api/upload
router.post("/upload", upload.single("file"), (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
      originalName: req.file.originalname,
      filename: req.file.filename,
      fileUrl,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/attachments
router.post("/attachments", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        entity_type: z.string(),
        entity_id: z.number(),
        file_name: z.string(),
        file_url: z.string(),
        file_type: z.string().optional(),
        field: z.string().optional(),
      })
      .parse(req.body);

    const [inserted] = await db
      .insert(schema.attachments)
      .values(parsed)
      .returning();

    res.status(201).json(inserted);
  } catch (err) {
    next(err);
  }
});

// GET /api/attachments/:entityType/:entityId
router.get("/attachments/:entityType/:entityId", async (req, res, next) => {
  try {
    const entityType = req.params.entityType;
    const entityId = Number(req.params.entityId);

    const data = await db.query.attachments.findMany({
      where: (a, { and }) =>
        and(eq(a.entity_type, entityType), eq(a.entity_id, entityId)),
      orderBy: desc(schema.attachments.created_at),
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/attachments/:attachmentId
router.delete("/attachments/:attachmentId", async (req, res, next) => {
  try {
    const attachmentId = Number(req.params.attachmentId);

    const existing = await db.query.attachments.findFirst({
      where: eq(schema.attachments.id, attachmentId),
    });
    if (!existing) {
      res.status(404).json({ message: "Attachment not found" });
      return;
    }

    if (existing.file_url) {
      const filePath = path.join(
        __dirname,
        "../../",
        existing.file_url.replace(/^\//, "")
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await db
      .delete(schema.attachments)
      .where(eq(schema.attachments.id, attachmentId));

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
