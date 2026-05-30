import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";
import { ZodError } from "zod";

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

  logger.error(err, "Unhandled error");
  res.status(500).json({ message: "Internal server error" });
}
