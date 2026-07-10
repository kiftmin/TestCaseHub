export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  is_active: boolean;
  created_at: string;
}

export interface ProjectAssignment {
  id: number;
  project_id: number;
  user_id: number;
  role: string;
  is_qa?: boolean;
  assigned_at: string;
  user: {
    id: number;
    username: string;
    name: string;
    email: string;
  };
}

export interface Project {
  id: number;
  project_code: string;
  name: string;
  designed_by: string;
  module_name: string;
  design_date: string;
  test_link: string | null;
  version: number;
  version_date: string;
  test_lead_id: number | null;
  is_signed_off: number;
  sign_off_data: string | null;
  objectives: string | null;
  scope: string | null;
  out_of_scope: string | null;
  entry_criteria: string | null;
  exit_criteria: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignOffData {
  testLead?: {
    name: string;
    role: string;
    date: string;
    signature: string;
  };
  businessOwner?: {
    name: string;
    role: string;
    date: string;
    signature: string;
  };
  businessDecisions?: {
    count: number;
    accepted: Array<{
      defectId: number;
      bugNumber?: number;
      severity: string;
      justification: string;
      submittedBy: string;
      submittedAt: string;
      acceptedBy: string;
      acceptedAt: string;
      decisionType: "risk_waiver" | "business_review";
      testCaseName?: string;
    }>;
    rejected: Array<{
      defectId: number;
      rejectionReason: string;
      rejectedBy: string;
      rejectedAt: string;
    }>;
  };
}

export interface UseCase {
  id: number;
  project_id: number;
  code: string;
  name: string;
  priority: string | null;
  category: string | null;
  sort_order?: number;
  created_at: string;
  testCases?: (TestCase & { steps?: TestStep[] })[];
}

export interface TestCase {
  id: number;
  use_case_id: number;
  case_number: string;
  title: string;
  test_type: string | null;
  estimated_minutes: number | null;
  acceptance_criteria: string | null;
  sort_order?: number;
  created_at: string;
  steps?: TestStep[];
  useCase?: UseCase;
}

export interface TestStep {
  id: number;
  test_case_id: number;
  step_number: string;
  instruction: string;
  test_data: string | null;
  expected_result: string | null;
  created_at: string;
}

export interface TestRun {
  id: number;
  project_id: number;
  name: string;
  status: "scheduled" | "in_progress" | "completed";
  scheduled_at: string | null;
  passed: boolean | null;
  run_type: "standard" | "retest";
  entry_confirmed: boolean;
  entry_confirmed_by_user_id: number | null;
  created_at: string;
  checklistItems?: TestRunChecklistItem[];
  useCases?: TestRunUseCase[];
  executions?: Execution[];
  project?: Project;
}

export interface TestRunUseCase {
  id: number;
  test_run_id: number;
  use_case_id: number;
  status:
    | "pending"
    | "in_progress"
    | "passed"
    | "failed"
    | "passed_by_agreement";
  assigned_tester_id: number | null;
  tester_sign_off: boolean;
  tester_sign_off_at: string | null;
  free_pass: boolean | null;
  free_pass_reason: string | null;
  created_at: string;
  updated_at: string;
  useCase?: UseCase;
  tester?: User;
}

export interface TestRunChecklistItem {
  id: number;
  test_run_id: number;
  item_text: string;
  is_checked: boolean;
  checked_by_user_id: number | null;
  checked_at: string | null;
}

export interface Execution {
  id: number;
  test_run_id: number;
  test_case_id: number;
  tester_id: number | null;
  overall_result: "passed" | "failed" | "passed_by_agreement" | null;
  executed_at: string | null;
  notes: string | null;
  tester_name: string | null;
  status: string;
  iteration_number: number;
  testCase?: TestCase;
  stepResults?: StepResult[];
  tester?: User;
}

export interface StepResult {
  id: number;
  execution_id: number;
  step_id: number;
  actual_result: string | null;
  comments: string | null;
  passed: boolean | null;
  step?: TestStep;
}

export interface Defect {
  id: number;
  bug_number: number | null;
  project_id: number;
  test_run_id: number | null;
  test_case_id: number;
  execution_id: number | null;
  ticket_type: string;
  status: string;
  severity: "Critical" | "Major" | "Minor" | "Cosmetic" | null;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  assigned_to_user_id: number | null;
  support_ticket_number: string | null;
  root_cause_category: string | null;
  regression_index: number;
  tester_notes: string | null;
  retest_reason: string | null;
  accepted_by_business_note: string | null;
  rejection_log: string | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  testCase?: TestCase;
  execution?: Execution;
  retests?: DefectRetest[];
  notes?: DefectNote[];
  project?: Project;
  decision_type?: "risk_waiver" | "business_review";
  inActiveRetestRun?: boolean;
}

export interface DefectRetest {
  id: number;
  defect_id: number;
  test_run_id: number;
  target_verification_run_id: number | null;
  assigned_tester_id: number | null;
  retest_result: "passed" | "failed" | null;
  retest_notes: string | null;
  retested_by_user_id: number | null;
  retested_at: string | null;
  created_at: string;
}

// Bug and BugNote types removed — consolidated into Defect and DefectNote

export interface StatusAuditLog {
  id: number;
  entity_type: string;
  entity_id: number;
  changed_by_user_id: number | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  justification: string | null;
  changed_at: string;
}

export interface TeamDiscussion {
  id: number;
  project_id: number;
  test_run_id: number;
  initiated_by_user_id: number | null;
  meeting_type: "defect_review" | "post_mortem";
  is_active: boolean;
  created_at: string;
  ended_at: string | null;
  participants?: TeamDiscussionParticipant[];
}

export interface TeamDiscussionParticipant {
  id: number;
  discussion_id: number;
  user_id: number;
  can_add_notes: boolean;
  added_at: string;
  user?: User;
}

export interface DefectNote {
  id: number;
  defect_id: number;
  discussion_id: number | null;
  added_by_user_id: number | null;
  note: string;
  is_system_note: boolean;
  is_internal: boolean;
  created_at: string;
  addedBy?: User;
}

export interface DashboardSummary {
  totalProjects: number;
  totalTestRuns: number;
  totalTestCases: number;
  totalDefects: number;
}

export interface Attachment {
  id: number;
  entity_type: string;
  entity_id: number;
  field: string | null;
  file_name: string;
  file_url: string;
  file_type: string | null;
  created_at: string;
}
