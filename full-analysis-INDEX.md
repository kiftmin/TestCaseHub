# TestCaseHub — Full Codebase Analysis

## Repository Metadata

- **Origin**: `https://github.com/kiftmin/TestCaseHub.git`
- **Branch**: `main`
- **Commit**: `d35e443`
- **Architecture**: Monorepo with pnpm workspaces (pnpm-workspace.yaml)
- **TypeScript**: Strict mode, ESNext target, NodeNext module resolution
- **Database**: PostgreSQL via Drizzle ORM
- **Frontend**: React 18 + Vite + TanStack Query + Wouter + Tailwind CSS
- **Backend**: Express.js + Drizzle ORM + Zod validation

## Monorepo Structure

```
TestCaseHub/
├── package.json              # Root scripts: db:*, api:*, build
├── pnpm-workspace.yaml       # Workspaces: lib/*, artifacts/*
├── tsconfig.json             # Base TS config
├── .gitignore
├── lib/                      # Shared libraries
│   ├── db/                   # Database schema, migrations, seeds
│   ├── api-spec/             # OpenAPI 3.1 spec + Orval config
│   ├── api-client-react/     # JWT-bearing fetch wrapper
│   └── api-zod/              # Shared Zod schemas
├── artifacts/                # Applications
│   ├── api-server/           # Express backend (port 3000)
│   └── uat-manager/          # React SPA (port 5173)
├── BUG_REPORT.md             # Bug #1: Test run auto-completes early
├── BUG_REPORT_execution_engine_stale_data.md  # Bug #2: Stale step_results
└── fix-*.patch               # 7 pending fix patches
```

## Analysis Documents (split into parts)

| Part | File | Contents |
|------|------|----------|
| **Index** | `full-analysis-INDEX.md` | This file — master index and architectural overview |
| **1** | `full-analysis-part1.txt` | Root configs, DB layer (schema, seed, migrate, fix-status), API client (custom-fetch), API spec (orval.config), API server entry + middleware |
| **2** | `full-analysis-part2.txt` | All 17 API route files (auth, users, projects, use-cases, test-cases, test-steps, test-runs, executions, dashboard, defects, project-assignments, checklist, discussions, attachments, health, bugs) + utilities |
| **3** | `full-analysis-part3.txt` | Frontend config (package.json, vite, tailwind, postcss, tsconfigs) + core lib files (api-client, auth, query-client, types, hooks) |
| **4** | `full-analysis-part4.txt` | All 22 UI components (button, input, card, badge, avatar, dropdown-menu, stepper, dialog, etc.) |
| **5a** | `full-analysis-part5a.txt` | Frontend pages: Login, Dashboard, Projects, ProjectDetail, TestRunDetail, TestRunReport, TesterDashboard, TesterScenario, TesterProjectRedirect, DefectLog, BugList, SignOff, UatSummary, AuditTrail, Users, NotFound |
| **5b** | `full-analysis-part5b.txt` | TesterCasePage (1711 lines) + Layout components (AppShell, Sidebar, TopBar) + Domain components (test-plan-form, test-plan-tab, test-plan-dialogs, TeamDiscussionModal, CameraCapture) |
| **6** | `full-analysis-part6.txt` | All 8 SQL migration files (0000-0007) + migration journal |
| **7** | `full-analysis-part7.txt` | All 7 pending fix patches |

## Database Schema Overview

**20+ tables** defined in `lib/db/src/schema.ts` (~1500 lines):

- `users` — Authentication + role (ADMIN/USER)
- `projects` — Projects with test plan, sign-off, versioning
- `use_cases` — Scenarios within a project (with sort_order)
- `test_cases` — Test cases within scenarios (with sort_order)
- `test_steps` — Steps within test cases (step_number ordering)
- `test_runs` — Test runs per project (scheduled/in_progress/completed)
- `test_run_use_cases` — Many-to-many: runs to scenarios, status tracking, tester assignment, free pass, sign-off
- `test_run_checklist_items` — Entry criteria checklist per run
- `executions` — Per test-case execution tracking (status, overall_result)
- `step_results` — Per-step pass/fail + actual result + comments
- `defects` — Unified defect tracking (NEW -> TRIAGED -> ASSIGNED -> IN_PROGRESS -> RESOLVED_DEV -> READY_FOR_VERIFICATION -> CLOSED/PASSED_BY_AGREEMENT)
- `defect_notes` — Activity feed per defect (system + user notes)
- `defect_retests` — Retest cycle tracking
- `bugs` — Legacy bug tracking (deprecated in favor of unified defects)
- `project_assignments` — User roles per project (TEST_LEAD, TESTER, TEST_AUTHOR, BUSINESS_OWNER, DEVELOPER, UAT_COORDINATOR)
- `team_discussions` — Defect review / post mortem meetings
- `team_discussion_participants` — Participants with can_add_notes
- `status_audit_log` — Entity-level audit trail
- `attachments` — File uploads (JPEG/PNG/GIF/WebP/PDF/DOCX/XLSX)
- `recently_viewed` — User browsing history
- `user_activity_log` — Audit trail for user actions

## API Endpoints Summary

All endpoints mounted under `/api` in `artifacts/api-server/src/index.ts`:

| Route file | Endpoints |
|---|---|
| `health.ts` | `GET /api/health` |
| `auth.ts` | `POST /api/auth/login` (rate-limited 20/15min), `POST /api/auth/register` |
| `users.ts` | Full CRUD + password reset + suspend/unsuspend + delete |
| `projects.ts` | CRUD + sign-off + project-level audit + code lookup |
| `use-cases.ts` | CRUD with eager-loaded test cases |
| `test-cases.ts` | CRUD with steps |
| `test-steps.ts` | CRUD with step_number ordering |
| `test-runs.ts` | CRUD + use case assignment + entry criteria + auto-completion + syncUseCaseStatus |
| `executions.ts` | Start/PATCH status + step result CRUD + defect auto-create on fail |
| `dashboard.ts` | Admin/tester per-project KPI queries + recent activity + user log |
| `defects.ts` | Full lifecycle: classify, assign, start, resolve, block, unblock, flag-retest, accept-by-agreement, reject, notes |
| `project-assignments.ts` | Assign/unassign users to projects |
| `checklist.ts` | CRUD + check/uncheck toggle |
| `discussions.ts` | CRUD + participants + end discussion |
| `attachments.ts` | File upload (10MB max, image/doc types) |
| `bugs.ts` | DEPRECATED stub — returns 410 |

## Auth Architecture

- **JWT in localStorage**: key `tch_token`, user info in `tch_user`, 7-day expiry
- **Middleware chain**: `authenticate` (JWT extraction) -> `authorize(roles)` (user.role check) -> `authorizeProjectRole(allowedRoles)` (project-level assignment check)
- **Global rate limit**: 200 req/15min, login: 20 req/15min

## Frontend Routes

Defined in `App.tsx`:

| Path | Component | Access |
|---|---|---|
| `/login` | LoginPage | Public |
| `/` | DashboardPage | Authenticated |
| `/projects` | ProjectsPage | Authenticated |
| `/projects/:id` | ProjectDetailPage | Authenticated |
| `/projects/:id/runs/:runId` | TestRunDetailPage | Authenticated |
| `/projects/:id/runs/:runId/report` | TestRunReportPage | Authenticated |
| `/testers` | TesterDashboardPage | Authenticated |
| `/tester` | TesterDashboardPage | Authenticated |
| `/tester/project/:projectCode` | TesterProjectRedirect | Authenticated |
| `/tester/run/:testRunId` | TesterScenarioPage | Authenticated |
| `/tester/run/:testRunId/scenario/:scenarioId` | TestCaseSelector | Authenticated |
| `/tester/run/:testRunId/scenario/:scenarioId/case/:caseId` | TesterCasePage (orchestrator) | Authenticated |
| `/projects/:id/defects` | DefectLogPage | Authenticated |
| `/projects/:id/bugs` | BugListPage | Authenticated |
| `/projects/:id/signoff` | SignOffCertificatePage | Authenticated |
| `/projects/:id/uat-summary` | UatSummaryPage | Authenticated |
| `/projects/:id/audit` | AuditTrailPage | Authenticated |
| `/admin/users` | UsersPage | ADMIN |
| `*` | NotFoundPage | Public |

## TesterCasePage Architecture

3-level component hierarchy:
1. **TesterCasePage** (orchestrator) — reads testRunId/scenarioId/testCaseId from URL, fetches test case + execution, manages mode (guided/quick), sessionStorage drafts, beforeunload guard
2. **TestCaseSelector** — shows test case cards grouped by scenario with progress (Not Started/In Progress/Completed), filter tabs + mode toggle
3a. **StepWizard** (Guided mode) — one step at a time with sidebar, Pass/Fail radio, Next/Submit Case
3b. **QuickWizard** (Quick mode) — all steps on one scrollable page, per-step Pass/Fail buttons, bulk submit

Key state management:
- `entries: Map<number, ExecutionEntry>` — in-memory drafts per step
- `localResults: Map<number, boolean>` — optimistic pass/fail
- `persistedStepResults` — from API response
- `pendingMutations` — ref counter to block navigation during saves
- `sessionStorage` drafts with isFromToday check

## Known Open Bugs

### Bug #1 (HIGH): Test run auto-completes early
- File: `BUG_REPORT.md`
- Root cause: `syncUseCaseStatus()` in `test-runs.ts` auto-completes test runs before all scenarios are done
- Two suspects: (1) stale `syncUseCaseStatus` call order, (2) duplicate PATCH from Guided mode auto-save

### Bug #2 (HIGH): Execution engine loads stale step_results
- File: `BUG_REPORT_execution_engine_stale_data.md`
- Root cause: Data in DB reverts between sessions
- Primary suspect: `db.ts` lines 35-62 deduplication keeps oldest instead of most recently updated

## Pending Fix Patches (chronological order)

1. `fix-progress-tracking.patch` — Correct test case progress + execution submit flow + prevent duplicate defect creation
2. `fix-submit-flow.patch` — Fix submit flow race conditions + staleTime=0 for fresh data
3. `fix-scenario-progress.patch` — Use backend status as authoritative for scenario progress
4. `fix-step-numbers.patch` — Display step numbers using array index, not DB field
5. `fix-kpi-progress.patch` — Handle partial completion edge cases + scenario-level counting
6. `fix-dashboard-kpis.patch` — Correct scenario count, run card totals, pass rate formula
7. `fix-scope-access-kpis.patch` — Scope My Runs to assigned scenarios, fix KPIs and pass rate

## Critical API Contract Rules (from AGENTS.md)

1. **Check Zod schema first** — Frontend payload MUST match Zod types exactly
2. **Null vs undefined**: `.optional()` rejects `null`; `.nullable().optional()` accepts both
3. **CamelCase vs snake_case**: POST `/api/projects` = camelCase, PUT `/api/projects/:id` = snake_case
4. **Query parameters**: Some endpoints use query params (e.g., `?projectId=X`), not body
5. **204 responses**: DELETE endpoints return 204 with no body
6. **Enum values**: Must be exact match, case-sensitive

## Dev Scripts

```bash
pnpm db:generate    # Generate Drizzle migrations
pnpm db:migrate     # Run migrations + seed
pnpm api:dev        # Start API server (nodemon)
pnpm api:build      # Build API server
pnpm frontend:dev   # Start Vite dev server
pnpm build          # Build all packages
```
