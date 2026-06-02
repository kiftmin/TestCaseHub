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
  role:
    | "TEST_LEAD"
    | "TEST_AUTHOR"
    | "BUSINESS_OWNER"
    | "TESTER"
    | "DEVELOPER"
    | "UAT_COORDINATOR";
  assigned_at: string;
  user?: User;
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
  tester_notes: string | null;
  testCase?: TestCase;
  stepResults?: StepResult[];
}

export interface StepResult {
  id: number;
  execution_id: number;
  step_id: number;
  actual_result: string | null;
  comments: string | null;
  passed: boolean;
}

export interface Defect {
  id: number;
  test_run_id: number;
  test_case_id: number;
  execution_id: number;
  tester_notes: string | null;
  status:
    | "New Defect"
    | "Submitted to Dev to Fix"
    | "Ready for Testing"
    | "Accepted by Business"
    | "Passed by Agreement";
  retest_reason: string | null;
  accepted_by_business_note: string | null;
  rejection_log: string | null;
  severity: "Critical" | "Major" | "Minor" | "Cosmetic" | null;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  created_at: string;
  updated_at: string;
  testCase?: TestCase;
  retests?: DefectRetest[];
  bugs?: Bug[];
  notes?: DefectNote[];
}

export interface DefectRetest {
  id: number;
  defect_id: number;
  test_run_id: number;
  assigned_tester_id: number | null;
  retest_result: "passed" | "failed" | null;
  retest_notes: string | null;
  retested_by_user_id: number | null;
  retested_at: string | null;
  created_at: string;
}

export interface Bug {
  id: number;
  project_id: number;
  defect_id: number;
  bug_number: number;
  support_ticket_number: string | null;
  assigned_developer_id: number | null;
  status:
    | "OPEN"
    | "ASSIGNED"
    | "IN_PROGRESS"
    | "RESOLVED"
    | "TEST"
    | "FAILED_TO_RESOLVE"
    | "CLOSED"
    | "REOPENED";
  developer_notes: string | null;
  failed_to_resolve_reason: string | null;
  root_cause_category: string | null;
  opened_at: string;
  assigned_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  defect?: Defect;
  project?: Project;
  developer?: User;
}

export interface StatusAuditLog {
  id: number;
  entity_type: string;
  entity_id: number;
  changed_by_user_id: number | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
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
  created_at: string;
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
