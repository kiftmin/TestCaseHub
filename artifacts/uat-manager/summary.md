# TestCaseHub Frontend — Summary

## Goal
Build the full TestCaseHub frontend: auth, user management, projects list, project detail with test plan tree, team, test runs tabs, and the test run detail page with tester execution flow.

## Constraints & Preferences
- All API response fields are snake_case; JWT role is "ADMIN" or "USER" only
- Public endpoints: POST /api/auth/login, GET /api/health; all others require Bearer token
- DELETE endpoints return 204 with no body
- Login rate limit: 20/15min; handle 429 with "Too many login attempts. Please wait."
- Backend Zod schemas must be read before writing frontend payloads (camelCase vs snake_case, null vs optional vs nullable)
- Pixel-perfect replication of HTML design references in testcasehub_frontend_scaffold/
- Vite + React 18 + TS + Wouter + TanStack Query v5 + Tailwind v3 + shadcn/ui-like components + sonner

## Progress
### Done
- Scaffolded Vite + React + TS project at artifacts/uat-manager/
- Installed all dependencies: wouter, @tanstack/react-query, lucide-react, sonner, tailwindcss@3, postcss, autoprefixer
- Configured Tailwind with all color tokens, typography, spacing, borderRadius from DESIGN.md
- Created lib/api-client.ts (customFetch wrapper), lib/auth.ts (token/user storage), lib/query-client.ts
- Created types/api.ts with all 21+ interfaces (snake_case fields, including TestRun, TestRunUseCase, TestRunChecklistItem, Execution, StepResult, Defect)
- Created hooks/useAuth.ts and hooks/useProjectRole.ts
- Built shadcn/ui-like components: Button, Input, Label, Card, Badge, Avatar, DropdownMenu, Separator, Skeleton
- Built Sidebar (Dashboard / Projects / Users for ADMIN), TopBar (avatar, role badge, sign-out dropdown), AppShell (auth guard)
- Built LoginPage (split layout, show/hide password, 429 handling, redirect after login)
- Built UsersPage (table with search, slide-over, password dialog, suspend/delete confirmations, ADMIN-only)
- Built ProjectsPage (3-column card grid, filters, New Project slide-over with 11 fields, ADMIN-only create)
- Built ProjectDetailPage (~1550 lines, 3 tabs: test plan tree with inline editing, Team with role badges, Test Runs with card list and dialogs)
- Built TestRunDetailPage (~1100 lines, entry criteria banner, pre-flight checklist with PATCH, scenarios panel with expand/collapse, tester assignment, execution modal with Guided/Quick modes, step wizard, pass/fail, offline draft support, completion summary)
- Built TesterDashboardPage with run cards, progress bars, status badges, overdue label, "Start Testing" navigation
- Fixed multiple API contract mismatches: use-cases POST needs ?projectId, project-assignments POST needs userId (camelCase), test-cases POST rejects null estimated_minutes, projects POST expects camelCase (designedBy, moduleName, designDate, testLeadId)
- Changed backend DB from pg Client to Pool with error handler + 2min keepalive to prevent Neon idle connection crashes
- Created AGENTS.md documenting API contract rules
- Fixed step numbering bug: backend project detail query now orders by numeric step_number, test cases by sort_order, use cases by sort_order
- Added HTML5 drag-and-drop reordering for scenarios, test cases, and steps with auto-renumbering
- Added sort_order column to use_cases and test_cases tables via migration SQL
- Fixed React hooks order violation (useState before early return in TestPlanTab)
- Fixed 500 error /api/users/undefined/projects: LoginResponse type had userId but backend returns id; useProjectRole now uses safe userId check
- Fixed Test Runs page loading: backend /api/use-cases no longer wraps response in { testScenarios: result }
- Increased DB pool idleTimeoutMillis from 30s to 300s to prevent connection gaps between keepalive pings
- Added /test-runs/:id and /tester routes to App.tsx
- Added "My Runs" link to Sidebar (visible for all logged-in users)
- Fixed all TS build errors: removed unused imports/vars (useCallback, useRef, StepResult, Defect, sortConfig, qrRef, entryConfirmed, execCount, stepIndex, getStoredUser, execs, testRunId), fixed navigator.share type check

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Import type interfaces with `import type` due to tsconfig `verbatimModuleSyntax: true`
- AGENTS.md at artifacts/uat-manager/ documents known API Zod mismatches (null vs optional, camelCase vs snake_case, query params vs body)
- ProjectDetailPage and TestRunDetailPage built as single large files with well-named inner components to avoid cross-file import complexity
- DnD uses HTML5 native Drag and Drop API (no external library) with PUT calls per item on drop
- Offline draft support uses sessionStorage with key `draft_execution_{executionId}` and auto-submits on navigator.online event
- Execution modal uses "Guided" (1 step at a time) and "Quick" (scrollable list) modes with segmented toggle
- Post-execution sync uses POST /api/test-runs/:id/use-cases/:useCaseId/sync to update scenario status
- TesterDashboardPage groups use cases by test_run_id, shows progress bar per run, shows overdue indicator

## Next Steps
- Build Dashboard page with summary statistics
- Possibly refactor large pages into smaller components

## Critical Context
- Backend DB connection to Neon free-tier drops idle connections after ~5min; Pool + keepalive SELECT 1 every 2min + idleTimeoutMillis 300s prevents crashes
- Key API field gotchas documented in AGENTS.md
- Backend server runs on localhost:3000, frontend dev server on localhost:5173
- All 14 test-run endpoints exist: GET/PATCH/DELETE test-run, GET/PATCH checklist, POST confirm-entry, GET access-qr, PATCH test-run-use-case, POST sync, POST execute, PATCH execution, POST step-result, GET defects, GET tester dashboard
- The `useProjectRole` hook now safely guards against missing userId by extracting it before the query

## Relevant Files
- artifacts/uat-manager/src/pages/ProjectDetailPage.tsx: main project detail page (~1750 lines, 3 tabs, 3-level tree with inline editing, DnD reordering)
- artifacts/uat-manager/src/pages/TestRunDetailPage.tsx: test run detail page (~1100 lines, entry criteria, checklist, scenarios panel, execution modal with Guided/Quick modes, offline draft support)
- artifacts/uat-manager/src/pages/TesterDashboardPage.tsx: tester dashboard with run cards, progress bars, status badges
- artifacts/uat-manager/src/pages/UsersPage.tsx: user management with table, slide-over, dialogs
- artifacts/uat-manager/src/pages/ProjectsPage.tsx: project card grid with New Project slide-over
- artifacts/uat-manager/src/pages/LoginPage.tsx: split layout login page
- artifacts/uat-manager/src/lib/api-client.ts: base fetch wrapper (token, JSON/FormData, 204, error parsing)
- artifacts/uat-manager/src/lib/auth.ts: localStorage token/user helpers
- artifacts/uat-manager/src/types/api.ts: all snake_case interfaces including Execution, StepResult, Defect, TestRun types
- artifacts/uat-manager/src/hooks/useProjectRole.ts: resolves project-specific role via /api/users/:userId/projects (now safely guards userId)
- artifacts/uat-manager/tailwind.config.ts: full color/token config from DESIGN.md
- artifacts/uat-manager/AGENTS.md: API contract rules for future code generation
- artifacts/api-server/src/db.ts: pg Pool with 300s idleTimeoutMillis + 2min keepalive
- artifacts/api-server/src/routes/projects.ts: project detail query with proper orderBy for useCases, testCases, steps
- artifacts/api-server/src/routes/use-cases.ts: now returns plain array, accepts sort_order on PUT, auto-assigns sort_order on POST
- artifacts/api-server/src/routes/test-cases.ts: similar sort_order support, accepts sort_order on PUT
- lib/db/src/schema.ts: sort_order column on use_cases and test_cases
- lib/db/drizzle/0001_add_sort_order.sql: migration adding sort_order columns
- testcasehub_frontend_scaffold/test_run_detail_testcasehub/code.html: reference design for test run detail
- testcasehub_frontend_scaffold/execution_flow_testcasehub/code.html: reference design for execution modal
- testcasehub_frontend_scaffold/tester_dashboard_testcasehub/code.html: reference design for tester dashboard
