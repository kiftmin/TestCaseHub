# TestCaseHub — Product Description

## Overview

TestCaseHub is a full-stack **User Acceptance Testing (UAT) Test Case Management System** that enables teams to plan, execute, and track acceptance testing through a structured workflow. It bridges the gap between test planning and defect resolution, providing end-to-end traceability from test scenarios through execution to defect lifecycle management.

The system is designed for teams running formal UAT cycles — typically involving Test Leads, Business Owners, Testers, Developers, and QA reviewers — with a strong emphasis on governance, auditability, and collaborative workflows.

---

## Key Features

### Project Management

- **Structured Test Plans** — Organize testing into a three-level hierarchy: Scenarios → Test Cases → Test Steps, with drag-and-drop reordering at every level.
- **Release Versioning** — Each project tracks a `version` field, incremented automatically on significant changes.
- **Dual Sign-Off** — Projects support a formal two-party sign-off process (Test Lead + Business Owner), recorded as structured JSON with signatures and timestamps. Once signed off, the project is locked.
- **UAT Summary Reports** — Generate comprehensive summary reports with pass/fail metrics, coverage statistics, and defect counts.
- **Audit Trail** — Full audit log of all status changes across defects and project milestones, exportable to CSV.
- **QR Code Access** — Generate QR codes for test run URLs to simplify tester access.

### Test Execution

- **Two Execution Modes:**
  - **Guided Mode** — Step-by-step wizard, one step at a time, with pass/fail recording per step.
  - **Quick Mode** — Scrollable list of all steps for faster execution.
- **Tester Assignment** — Assign testers to specific scenarios within a run, with per-scenario status tracking.
- **Offline Draft Support** — Execution progress is saved to `sessionStorage` and auto-submits when the browser comes back online.
- **Retest Runs** — Create retest runs linked to defects, with auto-resolution: test case passes → defect CLOSED, test case fails → defect ASSIGNED with regression counter incremented.
- **Entry Criteria** — Pre-flight checklist with mandatory items that must be completed before execution begins.
- **Free Pass** — Allow scenarios to pass without full execution, with mandatory reason.
- **Tester Sign-Off** — Testers can sign off on individual scenarios within a run.
- **Progress Tracking** — Real-time progress bars and scenario-level status indicators.

### Defect Lifecycle

TestCaseHub implements a comprehensive 11-state defect lifecycle:

```
NEW → TRIAGED → ASSIGNED → IN_PROGRESS → RESOLVED_DEV → QA_PASSED → READY_FOR_VERIFICATION → CLOSED
                                       ↓                        ↓ (fail)         ↓ (fail)
                                     REGRESSED (←─────────────←─┘                ↓
                                       ↓                                         ↓
                                       └────────→ ASSIGNED (retry)    ASSIGNED (reject-verification)
                                                                       or QA_PASSED (reschedule-retest)
```

Additional states: `PENDING_BIZ_ACCEPTANCE`, `PASSED_BY_AGREEMENT`.

**Key lifecycle features:**

| Phase | Actions | Who |
|---|---|---|
| **Triage** | Classify (set severity/priority), Assign to developer, Flag as blocked, Submit for business decision | TEST_LEAD |
| **Development** | Start work, Block/Unblock, Resolve (with root cause category) | DEVELOPER, TEST_LEAD |
| **QA Review** | Pass (→QA_PASSED) or Fail (→IN_PROGRESS) | QA-flagged DEVELOPER |
| **Verification** | Flag retest, Quick verify (pass/fail), Accept, Reject verification | TEST_LEAD, TESTER, BUSINESS_OWNER |
| **Business** | Accept by agreement, Reject (rollback) | BUSINESS_OWNER |
| **Rollback** | Resume work, Reschedule retest, Regress (production), Retry after regression | TEST_LEAD, DEVELOPER |

### Team Collaboration

- **Team Discussions** — Structured meetings for defect reviews and post-mortems, with participant management and note-taking permissions.
- **Defect Notes** — Rich commenting on defects including system-generated notes (audit trail) and internal developer notes.
- **File Attachments** — Upload screenshots, logs, and documents to defects and test runs (10 MB limit, validated MIME types).

### Reporting & Compliance

- **Full Test Run Reports** — Detailed PDF reports with execution results, step-level pass/fail, and defect cross-references.
- **Sign-Off Certificates** — Printable sign-off certificates with dual signatures.
- **UAT Summary Dashboard** — High-level metrics including pass rates, defect density, and coverage.
- **Defect Aging Matrix** — View defects grouped by age and severity.
- **Audit Log** — Every status change is logged with user, timestamp, and reason for full traceability.
- **CSV/Excel Export** — Export defect logs and audit trails for external reporting.

---

## User Roles & Permissions

### System-Level Roles

| Role | Privileges |
|---|---|
| **ADMIN** | Full system access. Bypasses all project-level permission checks. Can create/edit/delete users and projects. |
| **USER** | Standard user. Requires project-level assignment for access to project resources. |

### Project-Level Roles

| Role | Responsibilities |
|---|---|
| **TEST_LEAD** | Manages test runs, triages defects, assigns testers, signs off projects, manages team membership, performs all developer actions on any defect. |
| **DEVELOPER** | Works on assigned defects (start, resolve, block/unblock). Can be flagged with `is_qa = true` to also perform QA reviews. |
| **QA (is_qa flag)** | Not a separate role — a boolean flag on a DEVELOPER assignment. Can perform QA pass/fail on defects they do not own. |
| **TESTER** | Executes test cases, records step results, submits runs, performs quick verification on defects. |
| **TEST_AUTHOR** | Creates and edits scenarios, test cases, and test steps within the project. |
| **BUSINESS_OWNER** | Signs off projects, accepts/rejects business decisions on defects, performs acceptance-by-agreement. |
| **UAT_COORDINATOR** | General project access with oversight capabilities. |

### Authorization Model

- **ADMIN** always passes all checks (global bypass).
- **Project-level checks** query the `project_assignments` table and also consider implicit TEST_LEAD assignment via `projects.test_lead_id`.
- **Own-defect enforcement** — DEVELOPER actions (start, resolve, block, unblock) are restricted to the assigned developer, with TEST_LEAD bypass.
- **QA self-review guard** — A QA-flagged developer cannot review their own defect.

---

## Architecture

### Monorepo Structure

```
├── artifacts/
│   ├── api-server/          # Backend — Express 5 REST API
│   │   └── src/
│   │       ├── routes/      # 17 route modules (all HTTP endpoints)
│   │       ├── middlewares/ # Auth (JWT, role-based, QA check)
│   │       ├── utils/       # Auditing, logging (Pino), system notes
│   │       ├── db.ts        # PostgreSQL connection pool
│   │       └── index.ts     # Express app setup
│   └── uat-manager/         # Frontend — React 19 SPA
│       └── src/
│           ├── pages/       # 17 page components
│           ├── components/  # Reusable UI components
│           ├── hooks/       # Custom React hooks
│           ├── lib/         # API client, helpers
│           └── types/       # TypeScript interfaces
├── lib/
│   ├── db/                  # Drizzle ORM schema, migrations, seed data
│   ├── api-zod/             # Shared Zod validation schemas
│   ├── api-client-react/    # Shared fetch wrapper with JWT injection
│   └── api-spec/            # OpenAPI specification generation
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend Framework** | React 19, Vite 8, TypeScript |
| **Routing** | Wouter (lightweight) |
| **Server State** | TanStack React Query v5 |
| **Styling** | Tailwind CSS v3 |
| **Charts** | Recharts |
| **PDF Generation** | @react-pdf/renderer |
| **Spreadsheet Export** | xlsx |
| **Backend Framework** | Express 5, TypeScript |
| **Database** | PostgreSQL (via Drizzle ORM) |
| **ORM** | Drizzle ORM + drizzle-kit |
| **Validation** | Zod |
| **Authentication** | JWT (jsonwebtoken) + bcryptjs |
| **Security** | helmet, express-rate-limit, cors |
| **Logging** | Pino |
| **File Uploads** | multer (10 MB, typed MIME validation) |
| **Package Manager** | pnpm (workspaces) |

### Database

**17 tables** covering the full domain:

- **Users & Access** — `users`, `project_assignments`
- **Test Planning** — `projects`, `use_cases`, `test_cases`, `test_steps`
- **Test Execution** — `test_runs`, `test_run_use_cases`, `executions`, `step_results`, `test_run_checklist_items`
- **Defect Management** — `defects`, `defect_retests`, `defect_notes`
- **Collaboration** — `team_discussions`, `team_discussion_participants`
- **Audit** — `status_audit_log`, `attachments`

### API Design

RESTful JSON API with JWT Bearer authentication. Key design patterns:

- All mutations return the updated entity
- DELETE endpoints return 204 with no body
- Consistent error responses with descriptive messages
- Validation via Zod schemas on every endpoint
- Full audit logging on every status-changing operation

---

## Test Execution Flow

1. **Create a test run** — Select scenarios, assign testers, set schedule.
2. **Complete entry criteria** — Check off pre-flight checklist items.
3. **Execute test cases** — Testers open the run, choose Guided or Quick mode, record pass/fail per step with optional comments.
4. **Submit and auto-create defects** — On submission, every step with `passed = false` generates a NEW defect linked to the test run.
5. **(Optional) Retest run** — Create a retest run linked to specific defects. On submission, defects are auto-resolved based on execution results.
6. **Generate reports** — Full test run report PDF, UAT summary, sign-off certificate.

---

## Defect Detail — Lifecycle States

| Status | Meaning | Entry Conditions | Exit Actions |
|---|---|---|---|
| **NEW** | Auto-created from failed test step | Created by system on test run submission | Classify (→TRIAGED or →ASSIGNED) |
| **TRIAGED** | Severity/priority set, awaiting assignment | Classify without assignee | Assign (→ASSIGNED), Flag blocked |
| **ASSIGNED** | Developer assigned, not yet started | Classify or Assign with assignee | Start (→IN_PROGRESS), Flag blocked, Reassign |
| **IN_PROGRESS** | Developer actively working | Start by assigned dev or TEST_LEAD | Resolve (→RESOLVED_DEV), Block |
| **RESOLVED_DEV** | Developer marked as fixed | Resolve by assigned dev or TEST_LEAD | QA review (→QA_PASSED or →IN_PROGRESS) |
| **QA_PASSED** | QA verified the fix | QA review pass | Flag retest (→READY_FOR_VERIFICATION), Resume work (→IN_PROGRESS) |
| **READY_FOR_VERIFICATION** | Awaiting tester verification | Flag retest or Flag retest from NEW | Quick verify (→CLOSED or →ASSIGNED), Accept (→CLOSED), Reject verification (→ASSIGNED), Reschedule retest (→QA_PASSED) |
| **REGRESSED** | Fix failed or production regression | Retest fail or Regress action | Retry (→ASSIGNED), Block |
| **CLOSED** | Verified as fixed or accepted | Quick verify pass, Accept, Retest pass | Regress (→REGRESSED) |
| **PENDING_BIZ_ACCEPTANCE** | Awaiting business decision | Submit for business decision | Accept by agreement (→PASSED_BY_AGREEMENT), Reject (rollback) |
| **PASSED_BY_AGREEMENT** | Accepted by business without full verification | Accept by agreement | Regress (→REGRESSED) |

---

## Deployment

- **Node.js** runtime for both frontend and backend
- **PostgreSQL** database (compatible with Neon serverless)
- Frontend serves as an SPA, backend as a REST API
- Connection keepalive and idle timeout configured for serverless database environments
