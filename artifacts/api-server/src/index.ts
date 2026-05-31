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
import bugRoutes from "./routes/bugs.js";
import discussionRoutes from "./routes/discussions.js";
import attachmentRoutes from "./routes/attachments.js";

const app: Express = express();
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use("/uploads", express.static("uploads"));

const api = express.Router();

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public
api.use("/auth", authLimiter, authRoutes);
api.use("/health", healthRoutes);

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
api.use("/", authenticate, bugRoutes);          // /bugs
api.use("/", authenticate, discussionRoutes);   // /discussions, /test-runs/:id/discussions
api.use("/", authenticate, attachmentRoutes);   // /upload, /attachments

app.use("/api", api);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export default app;
