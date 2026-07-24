import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { logger } from "./utils/logger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { authenticate } from "./middlewares/auth.js";

import authRoutes from "./routes/auth.js";
import healthRoutes from "./routes/health.js";
import userRoutes from "./routes/users.js";
import projectRoutes from "./routes/projects.js";
import useCaseRoutes from "./routes/use-cases.js";
import testCaseRoutes from "./routes/test-cases.js";
import testStepRoutes from "./routes/test-steps.js";
import testRunRoutes from "./routes/test-runs.js";
import checklistRoutes from "./routes/checklist.js";
import dashboardRoutes from "./routes/dashboard.js";

// Routers that embed full paths - mount at root API level
import assignmentRoutes from "./routes/project-assignments.js";
import executionRoutes from "./routes/executions.js";
import defectRoutes from "./routes/defects.js";
// bugRoutes deprecated — bugs consolidated into defects
import discussionRoutes from "./routes/discussions.js";
import attachmentRoutes from "./routes/attachments.js";
import importRoutes from "./routes/import-routes.js";
import preconditionRoutes from "./routes/preconditions.js";
import sharedStepRoutes from "./routes/shared-steps.js";

const app: Express = express();
app.set('trust proxy', 1);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:5173", "http://localhost:3001"],
    credentials: true,
    maxAge: 86400,
  }),
);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "1mb" }));
app.use((pinoHttp as unknown as (opts: object) => express.RequestHandler)({
  logger,
  redact: {
    paths: ["req.headers.authorization", "req.body.password", "req.body.signature"],
    remove: true,
  },
}));
// Uploads are served only via authenticated GET /api/uploads/:filename

const api = express.Router();

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
});

// Public
api.use("/auth", authLimiter, authRoutes);
api.use("/health", healthRoutes);
api.use(apiLimiter);

// Uploads must be mounted BEFORE any api.use("/", authenticate, ...) mounts.
// Those catch-all mounts run authenticate for every path under /, which would
// 401 <img src="...?token=..."> requests before this router can accept ?token=.
api.use("/", attachmentRoutes); // /upload, /uploads/:file, /attachments

// Protected — specific mounts first
api.use("/users", authenticate, userRoutes);
api.use("/projects", authenticate, projectRoutes);
api.use("/use-cases", authenticate, useCaseRoutes);
api.use("/test-cases", authenticate, testCaseRoutes);
api.use("/test-steps", authenticate, testStepRoutes);
api.use("/test-runs", authenticate, testRunRoutes);
api.use("/test-runs/:testRunId/checklist", authenticate, checklistRoutes);
api.use("/dashboard", authenticate, dashboardRoutes);

// Mount routers with full embedded paths at root level
api.use("/", authenticate, executionRoutes);   // /test-runs/:id/test-cases/:id/execute, /executions/:id, /tester/:id/test-runs
api.use("/", authenticate, assignmentRoutes);  // /projects/:id/users, /users/:id/projects
api.use("/", authenticate, defectRoutes);      // /defects, /test-runs/:id/defects
// api.use("/", authenticate, bugRoutes);        // /bugs — deprecated
api.use("/", authenticate, discussionRoutes);   // /discussions, /test-runs/:id/discussions
api.use("/", authenticate, importRoutes);       // /projects/:projectId/import
api.use("/", authenticate, preconditionRoutes); // /projects/:id/preconditions, /preconditions/:id
api.use("/", authenticate, sharedStepRoutes);   // /projects/:id/shared-step-blocks, insert-shared-steps

app.use("/api", api);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export default app;
