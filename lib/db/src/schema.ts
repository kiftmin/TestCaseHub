import { relations } from "drizzle-orm";
import {
  serial,
  integer,
  text,
  timestamp,
  boolean,
  pgTable,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// 1. users
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["ADMIN", "USER"] }).notNull().default("USER"),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  projectAssignments: many(projectAssignments),
  projectsAsLead: many(projects),
  auditLogs: many(statusAuditLog),
  createdDiscussions: many(teamDiscussions),
  teamDiscussionParticipants: many(teamDiscussionParticipants),
  // execution relations
  executionsAsTester: many(executions),
  testRunsConfirmed: many(testRuns),
  checklistItems: many(testRunChecklistItems),
  defectRetestsAssigned: many(defectRetests),
  defectsCreated: many(defects),
  defectNotes: many(defectNotes),
  bugsAssigned: many(bugs),
  testRunUseCasesAssigned: many(testRunUseCases),
  retestedBy: many(defectRetests),
}));

// 2. projects
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  project_code: text("project_code").notNull().unique(),
  name: text("name").notNull(),
  designed_by: text("designed_by").notNull(),
  module_name: text("module_name").notNull(),
  design_date: text("design_date").notNull(),
  test_link: text("test_link"),
  version: integer("version").notNull().default(1),
  version_date: timestamp("version_date", { withTimezone: true }).defaultNow(),
  test_lead_id: integer("test_lead_id").references(() => users.id, { onDelete: "set null" }),
  is_signed_off: integer("is_signed_off").notNull().default(0),
  sign_off_data: text("sign_off_data"),
  objectives: text("objectives"),
  scope: text("scope"),
  out_of_scope: text("out_of_scope"),
  entry_criteria: text("entry_criteria"),
  exit_criteria: text("exit_criteria"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  testLead: one(users, { fields: [projects.test_lead_id], references: [users.id] }),
  assignments: many(projectAssignments),
  testRuns: many(testRuns),
  useCases: many(useCases),
  bugs: many(bugs),
  auditLogs: many(statusAuditLog), // per spec: status_audit_log references projects
}));

// 3. project_assignments
export const projectAssignments = pgTable("project_assignments", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["TEST_LEAD", "TEST_AUTHOR", "BUSINESS_OWNER", "TESTER", "DEVELOPER", "UAT_COORDINATOR"],
  }).notNull(),
  assigned_at: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectAssignmentsRelations = relations(projectAssignments, ({ one }) => ({
  project: one(projects, { fields: [projectAssignments.project_id], references: [projects.id] }),
  user: one(users, { fields: [projectAssignments.user_id], references: [users.id] }),
}));

// 4. use_cases (Test Scenarios)
export const useCases = pgTable("use_cases", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  priority: text("priority"),
  category: text("category"),
  sort_order: integer("sort_order").default(0).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const useCasesRelations = relations(useCases, ({ one, many }) => ({
  project: one(projects, { fields: [useCases.project_id], references: [projects.id] }),
  testCases: many(testCases),
  testRunUseCases: many(testRunUseCases),
}));

// 5. test_cases
export const testCases = pgTable("test_cases", {
  id: serial("id").primaryKey(),
  use_case_id: integer("use_case_id").notNull().references(() => useCases.id, { onDelete: "cascade" }),
  case_number: text("case_number").notNull(),
  title: text("title").notNull(),
  test_type: text("test_type"),
  estimated_minutes: integer("estimated_minutes"),
  acceptance_criteria: text("acceptance_criteria"),
  sort_order: integer("sort_order").default(0).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const testCasesRelations = relations(testCases, ({ one, many }) => ({
  useCase: one(useCases, { fields: [testCases.use_case_id], references: [useCases.id] }),
  steps: many(testSteps),
  executions: many(executions),
  defects: many(defects),
}));

// 6. test_steps
export const testSteps = pgTable("test_steps", {
  id: serial("id").primaryKey(),
  test_case_id: integer("test_case_id").notNull().references(() => testCases.id, { onDelete: "cascade" }),
  step_number: text("step_number").notNull(),
  instruction: text("instruction").notNull(),
  test_data: text("test_data"),
  expected_result: text("expected_result"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const testStepsRelations = relations(testSteps, ({ one, many }) => ({
  testCase: one(testCases, { fields: [testSteps.test_case_id], references: [testCases.id] }),
  stepResults: many(stepResults),
}));

// 7. attachments
export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  entity_type: text("entity_type").notNull(),
  entity_id: integer("entity_id").notNull(),
  field: text("field"),
  file_name: text("file_name").notNull(),
  file_url: text("file_url").notNull(),
  file_type: text("file_type"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 8. test_runs
export const testRuns = pgTable("test_runs", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["scheduled", "in_progress", "completed"] }).notNull().default("scheduled"),
  scheduled_at: timestamp("scheduled_at", { withTimezone: true }),
  passed: boolean("passed"),
  source_test_run_id: integer("source_test_run_id").references(() => testRuns.id, { onDelete: "set null" }),
  entry_confirmed: boolean("entry_confirmed").notNull().default(false),
  entry_confirmed_by_user_id: integer("entry_confirmed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  entry_confirmed_at: timestamp("entry_confirmed_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const testRunsRelations = relations(testRuns, ({ one, many }) => ({
  project: one(projects, { fields: [testRuns.project_id], references: [projects.id] }),
  entryConfirmedBy: one(users, { fields: [testRuns.entry_confirmed_by_user_id], references: [users.id] }),
  useCases: many(testRunUseCases),
  checklistItems: many(testRunChecklistItems),
  executions: many(executions),
  defects: many(defects),
  teamDiscussions: many(teamDiscussions),
  sourceTestRun: one(testRuns, { fields: [testRuns.source_test_run_id], references: [testRuns.id] }),
}));

// 9. test_run_checklist_items
export const testRunChecklistItems = pgTable("test_run_checklist_items", {
  id: serial("id").primaryKey(),
  test_run_id: integer("test_run_id").notNull().references(() => testRuns.id, { onDelete: "cascade" }),
  item_text: text("item_text").notNull(),
  is_checked: boolean("is_checked").notNull().default(false),
  checked_by_user_id: integer("checked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  checked_at: timestamp("checked_at", { withTimezone: true }),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const testRunChecklistItemsRelations = relations(testRunChecklistItems, ({ one }) => ({
  testRun: one(testRuns, { fields: [testRunChecklistItems.test_run_id], references: [testRuns.id] }),
  checkedBy: one(users, { fields: [testRunChecklistItems.checked_by_user_id], references: [users.id] }),
}));

// 10. test_run_use_cases
export const testRunUseCases = pgTable("test_run_use_cases", {
  id: serial("id").primaryKey(),
  test_run_id: integer("test_run_id").notNull().references(() => testRuns.id, { onDelete: "cascade" }),
  use_case_id: integer("use_case_id").notNull().references(() => useCases.id, { onDelete: "cascade" }),
  assigned_tester_id: integer("assigned_tester_id").references(() => users.id, { onDelete: "set null" }),
  free_pass: boolean("free_pass").notNull().default(false),
  free_pass_reason: text("free_pass_reason"),
  status: text("status", {
    enum: ["pending", "in_progress", "passed", "failed", "passed_by_agreement"],
  }).notNull().default("pending"),
  tester_sign_off: boolean("tester_sign_off").notNull().default(false),
  tester_sign_off_at: timestamp("tester_sign_off_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const testRunUseCasesRelations = relations(testRunUseCases, ({ one, many }) => ({
  testRun: one(testRuns, { fields: [testRunUseCases.test_run_id], references: [testRuns.id] }),
  useCase: one(useCases, { fields: [testRunUseCases.use_case_id], references: [useCases.id] }),
  tester: one(users, { fields: [testRunUseCases.assigned_tester_id], references: [users.id] }),
}));

// 11. executions
export const executions = pgTable("executions", {
  id: serial("id").primaryKey(),
  test_case_id: integer("test_case_id").notNull().references(() => testCases.id, { onDelete: "cascade" }),
  test_run_id: integer("test_run_id").references(() => testRuns.id, { onDelete: "set null" }),
  iteration_number: integer("iteration_number").notNull().default(1),
  tester_name: text("tester_name"),
  tester_id: integer("tester_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status", { enum: ["in_progress", "completed", "failed"] }).notNull().default("in_progress"),
  overall_result: text("overall_result", { enum: ["passed", "failed", "passed_by_agreement"] }),
  notes: text("notes"),
  executed_at: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const executionsRelations = relations(executions, ({ one, many }) => ({
  testCase: one(testCases, { fields: [executions.test_case_id], references: [testCases.id] }),
  testRun: one(testRuns, { fields: [executions.test_run_id], references: [testRuns.id] }),
  tester: one(users, { fields: [executions.tester_id], references: [users.id] }),
  stepResults: many(stepResults),
  defects: many(defects),
}));

// 12. step_results
export const stepResults = pgTable("step_results", {
  id: serial("id").primaryKey(),
  execution_id: integer("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  step_id: integer("step_id").notNull().references(() => testSteps.id, { onDelete: "cascade" }),
  actual_result: text("actual_result"),
  comments: text("comments"),
  passed: boolean("passed"),
  recorded_at: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
});

export const stepResultsRelations = relations(stepResults, ({ one }) => ({
  execution: one(executions, { fields: [stepResults.execution_id], references: [executions.id] }),
  step: one(testSteps, { fields: [stepResults.step_id], references: [testSteps.id] }),
}));

// 13. defects
export const defects = pgTable("defects", {
  id: serial("id").primaryKey(),
  test_run_id: integer("test_run_id").notNull().references(() => testRuns.id, { onDelete: "cascade" }),
  test_case_id: integer("test_case_id").notNull().references(() => testCases.id, { onDelete: "cascade" }),
  execution_id: integer("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  tester_notes: text("tester_notes"),
  status: text("status", {
    enum: [
      "New Defect",
      "Submitted to Dev to Fix",
      "Ready for Testing",
      "Accepted by Business",
      "Passed by Agreement",
    ],
  }).notNull().default("New Defect"),
  retest_reason: text("retest_reason"),
  accepted_by_business_note: text("accepted_by_business_note"),
  rejection_log: text("rejection_log"),
  severity: text("severity", { enum: ["Critical", "Major", "Minor", "Cosmetic"] }),
  priority: text("priority", { enum: ["P1", "P2", "P3", "P4"] }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const defectsRelations = relations(defects, ({ one, many }) => ({
  testRun: one(testRuns, { fields: [defects.test_run_id], references: [testRuns.id] }),
  testCase: one(testCases, { fields: [defects.test_case_id], references: [testCases.id] }),
  execution: one(executions, { fields: [defects.execution_id], references: [executions.id] }),
  notes: many(defectNotes),
  retests: many(defectRetests),
  bugs: many(bugs),
}));

// 14. defect_retests
export const defectRetests = pgTable("defect_retests", {
  id: serial("id").primaryKey(),
  defect_id: integer("defect_id").notNull().references(() => defects.id, { onDelete: "cascade" }),
  test_run_id: integer("test_run_id").notNull().references(() => testRuns.id, { onDelete: "cascade" }),
  assigned_tester_id: integer("assigned_tester_id").references(() => users.id, { onDelete: "set null" }),
  retest_result: text("retest_result", { enum: ["passed", "failed"] }),
  retest_notes: text("retest_notes"),
  retested_by_user_id: integer("retested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  retested_at: timestamp("retested_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const defectRetestsRelations = relations(defectRetests, ({ one }) => ({
  defect: one(defects, { fields: [defectRetests.defect_id], references: [defects.id] }),
  testRun: one(testRuns, { fields: [defectRetests.test_run_id], references: [testRuns.id] }),
  assignedTester: one(users, { fields: [defectRetests.assigned_tester_id], references: [users.id] }),
  retestedBy: one(users, { fields: [defectRetests.retested_by_user_id], references: [users.id] }),
}));

// 15. bugs
export const bugs = pgTable("bugs", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  defect_id: integer("defect_id").notNull().references(() => defects.id, { onDelete: "cascade" }),
  bug_number: integer("bug_number").notNull(),
  support_ticket_number: text("support_ticket_number"),
  assigned_developer_id: integer("assigned_developer_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status", {
    enum: ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "TEST", "FAILED_TO_RESOLVE", "CLOSED", "REOPENED"],
  }).notNull().default("OPEN"),
  developer_notes: text("developer_notes"),
  failed_to_resolve_reason: text("failed_to_resolve_reason"),
  root_cause_category: text("root_cause_category", {
    enum: ["Requirements Gap", "Design Defect", "Coding Error", "Environment Issue", "Test Data Issue", "Configuration Error", "Third-Party Integration", "Other"],
  }),
  opened_at: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  assigned_at: timestamp("assigned_at", { withTimezone: true }),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
  test_at: timestamp("test_at", { withTimezone: true }),
  failed_to_resolve_at: timestamp("failed_to_resolve_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bugsRelations = relations(bugs, ({ one, many }) => ({
  project: one(projects, { fields: [bugs.project_id], references: [projects.id] }),
  defect: one(defects, { fields: [bugs.defect_id], references: [defects.id] }),
  developer: one(users, { fields: [bugs.assigned_developer_id], references: [users.id] }),
  notes: many(bugNotes),
}));

// 16. status_audit_log
export const statusAuditLog = pgTable("status_audit_log", {
  id: serial("id").primaryKey(),
  entity_type: text("entity_type").notNull(),
  entity_id: integer("entity_id").notNull(),
  changed_by_user_id: integer("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  from_status: text("from_status"),
  to_status: text("to_status"),
  reason: text("reason"),
  changed_at: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const statusAuditLogRelations = relations(statusAuditLog, ({ one }) => ({
  changedBy: one(users, { fields: [statusAuditLog.changed_by_user_id], references: [users.id] }),
}));

// 17. team_discussions
export const teamDiscussions = pgTable("team_discussions", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  test_run_id: integer("test_run_id").notNull().references(() => testRuns.id, { onDelete: "cascade" }),
  initiated_by_user_id: integer("initiated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  meeting_type: text("meeting_type", { enum: ["defect_review", "post_mortem"] }).notNull(),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  ended_at: timestamp("ended_at", { withTimezone: true }),
});

export const teamDiscussionsRelations = relations(teamDiscussions, ({ one, many }) => ({
  project: one(projects, { fields: [teamDiscussions.project_id], references: [projects.id] }),
  testRun: one(testRuns, { fields: [teamDiscussions.test_run_id], references: [testRuns.id] }),
  initiatedBy: one(users, { fields: [teamDiscussions.initiated_by_user_id], references: [users.id] }),
  participants: many(teamDiscussionParticipants),
  defectNotes: many(defectNotes),
}));

// 18. team_discussion_participants
export const teamDiscussionParticipants = pgTable("team_discussion_participants", {
  id: serial("id").primaryKey(),
  discussion_id: integer("discussion_id").notNull().references(() => teamDiscussions.id, { onDelete: "cascade" }),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  can_add_notes: boolean("can_add_notes").notNull().default(false),
  added_at: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teamDiscussionParticipantsRelations = relations(teamDiscussionParticipants, ({ one }) => ({
  discussion: one(teamDiscussions, { fields: [teamDiscussionParticipants.discussion_id], references: [teamDiscussions.id] }),
  user: one(users, { fields: [teamDiscussionParticipants.user_id], references: [users.id] }),
}));

// 19. defect_notes
export const defectNotes = pgTable("defect_notes", {
  id: serial("id").primaryKey(),
  defect_id: integer("defect_id").notNull().references(() => defects.id, { onDelete: "cascade" }),
  discussion_id: integer("discussion_id").references(() => teamDiscussions.id, { onDelete: "set null" }),
  added_by_user_id: integer("added_by_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const defectNotesRelations = relations(defectNotes, ({ one }) => ({
  defect: one(defects, { fields: [defectNotes.defect_id], references: [defects.id] }),
  discussion: one(teamDiscussions, { fields: [defectNotes.discussion_id], references: [teamDiscussions.id] }),
  addedBy: one(users, { fields: [defectNotes.added_by_user_id], references: [users.id] }),
}));

// 20. bug_notes
export const bugNotes = pgTable("bug_notes", {
  id: serial("id").primaryKey(),
  bug_id: integer("bug_id").notNull().references(() => bugs.id, { onDelete: "cascade" }),
  added_by_user_id: integer("added_by_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bugNotesRelations = relations(bugNotes, ({ one }) => ({
  bug: one(bugs, { fields: [bugNotes.bug_id], references: [bugs.id] }),
  addedBy: one(users, { fields: [bugNotes.added_by_user_id], references: [users.id] }),
}));
