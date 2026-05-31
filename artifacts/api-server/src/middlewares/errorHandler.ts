import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";
import { ZodError } from "zod";
import multer from "multer";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      message: "Validation error",
      errors: err.errors,
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ message: "File too large. Maximum size is 10MB." });
      return;
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      res.status(400).json({ message: "Unexpected file field." });
      return;
    }
    res.status(400).json({ message: err.message });
    return;
  }

  // Handle multer fileFilter errors (thrown as regular errors)
  if (err.message && err.message.includes("Invalid file type")) {
    res.status(400).json({ message: err.message });
    return;
  }

  // Handle PostgreSQL unique constraint violations
  if (err.message && err.message.includes("duplicate key value")) {
    res.status(409).json({ message: "A record with this value already exists." });
    return;
  }

  logger.error(err, "Unhandled error");
  res.status(500).json({ message: "Internal server error" });
}
