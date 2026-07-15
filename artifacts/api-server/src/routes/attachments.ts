import express from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import * as schema from "@workspace/db";
import {
  authenticate,
  checkProjectRole,
  denyUnlessProjectAccess,
  AuthenticatedRequest,
} from "../middlewares/auth.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.resolve(path.join(__dirname, "../../uploads"));
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/** Resolve a stored file_url to an absolute path under uploadsDir, or null if unsafe. */
function resolveSafeUploadPath(fileUrl: string): string | null {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  // Only allow /uploads/<basename> form
  const match = fileUrl.match(/^\/uploads\/([^/\\]+)$/);
  if (!match) return null;
  const basename = match[1];
  if (!basename || basename.includes("..") || path.isAbsolute(basename)) return null;
  const resolved = path.resolve(uploadsDir, basename);
  if (!resolved.startsWith(uploadsDir + path.sep) && resolved !== uploadsDir) return null;
  return resolved;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).slice(0, 20);
    cb(null, uniqueSuffix + ext);
  },
});

const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

async function resolveProjectId(entityType: string, entityId: number): Promise<number | null> {
  switch (entityType) {
    case "defect": {
      const defect = await db.query.defects.findFirst({
        where: eq(schema.defects.id, entityId),
        columns: { project_id: true },
      });
      return defect?.project_id ?? null;
    }
    case "test_run":
    case "test-run": {
      const run = await db.query.testRuns.findFirst({
        where: eq(schema.testRuns.id, entityId),
        columns: { project_id: true },
      });
      return run?.project_id ?? null;
    }
    default:
      return null;
  }
}

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF, DOCX, XLSX"));
    }
  },
});

// POST /api/upload — authenticated; returns server-issued path only
router.post("/upload", authenticate, upload.single("file"), (req, res, next) => {
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

/**
 * Authenticate for file download: Bearer header OR ?token= (for <img src> / window.open).
 */
function authenticateUploadAccess(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction): void {
  if (!req.headers.authorization && typeof req.query.token === "string" && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  authenticate(req, res, next);
}

// GET /api/uploads/:filename — authenticated file download (replaces public static)
router.get("/uploads/:filename", authenticateUploadAccess, async (req: AuthenticatedRequest, res, next) => {
  try {
    const rawName = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
    const filename = path.basename(String(rawName ?? ""));
    if (!filename || filename !== rawName || filename.includes("..")) {
      res.status(400).json({ message: "Invalid filename" });
      return;
    }

    const fileUrl = `/uploads/${filename}`;
    const attachment = await db.query.attachments.findFirst({
      where: eq(schema.attachments.file_url, fileUrl),
      columns: { entity_type: true, entity_id: true },
    });

    if (attachment) {
      const projectId = await resolveProjectId(attachment.entity_type, attachment.entity_id);
      if (!(await denyUnlessProjectAccess(req, res, projectId))) return;
    }

    const filePath = resolveSafeUploadPath(fileUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ message: "File not found" });
      return;
    }

    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

// POST /api/attachments
router.post("/attachments", async (req: AuthenticatedRequest, res, next) => {
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

    // Only accept server-issued upload URLs
    if (!resolveSafeUploadPath(parsed.file_url)) {
      res.status(400).json({ message: "Invalid file_url — must be a server-issued /uploads/ path" });
      return;
    }

    const projectId = await resolveProjectId(parsed.entity_type, parsed.entity_id);
    if (!projectId) {
      res.status(400).json({ message: "Could not resolve project from entity" });
      return;
    }
    const allowed = await checkProjectRole(req, projectId, [
      "TEST_LEAD",
      "TEST_AUTHOR",
      "TESTER",
      "DEVELOPER",
      "BUSINESS_OWNER",
    ]);
    if (!allowed) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const [inserted] = await db.insert(schema.attachments).values(parsed).returning();

    res.status(201).json(inserted);
  } catch (err) {
    next(err);
  }
});

// GET /api/attachments/:entityType/:entityId
router.get("/attachments/:entityType/:entityId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const entityType = req.params.entityType;
    const entityId = Number(req.params.entityId);

    const projectId = await resolveProjectId(entityType, entityId);
    if (!(await denyUnlessProjectAccess(req, res, projectId))) return;

    const data = await db.query.attachments.findMany({
      where: (a, { and: andOp }) =>
        andOp(eq(a.entity_type, entityType), eq(a.entity_id, entityId)),
      orderBy: desc(schema.attachments.created_at),
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/attachments/:attachmentId
router.delete("/attachments/:attachmentId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const attachmentId = Number(req.params.attachmentId);

    const existing = await db.query.attachments.findFirst({
      where: eq(schema.attachments.id, attachmentId),
    });
    if (!existing) {
      res.status(404).json({ message: "Attachment not found" });
      return;
    }

    const projectId = await resolveProjectId(existing.entity_type, existing.entity_id);
    if (!projectId) {
      res.status(404).json({ message: "Attachment not found" });
      return;
    }
    const allowed = await checkProjectRole(req, projectId, [
      "TEST_LEAD",
      "TEST_AUTHOR",
      "TESTER",
      "DEVELOPER",
      "BUSINESS_OWNER",
    ]);
    if (!allowed) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    if (existing.file_url) {
      const filePath = resolveSafeUploadPath(existing.file_url);
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await db.delete(schema.attachments).where(eq(schema.attachments.id, attachmentId));

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
