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
  role: "TEST_LEAD" | "TEST_AUTHOR" | "BUSINESS_OWNER" | "TESTER" | "DEVELOPER" | "UAT_COORDINATOR";
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
  is_signed_off: number; // 0 or 1
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
  testLead?: { name: string; role: string; date: string; signature: string };
  businessOwner?: { name: string; role: string; date: string; signature: string };
}

export interface UseCase {
  id: number;
  project_id: number;
  code: string;
  name: string;
  priority: string | null;
  category: string | null;
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
  project?: Project;
}

export interface TestRunUseCase {
  id: number;
  test_run_id: number;
  use_case_id: number;
  status: "pending" | "in_progress" | "passed" | "failed" | "passed_by_agreement";
  assigned_tester_id: number | null;
  tester_sign_off: boolean;
  tester_sign_off_at: string | null;
  free_pass: boolean | null;
  free_pass_reason: string | null;
  useCase?: UseCase;
  tester?: User;
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
}

export interface Defect {
  id: number;
  test_run_id: number;
  test_case_id: number;
  execution_id: number;
  tester_notes: string | null;
  status: "New Defect" | "Submitted to Dev to Fix" | "Ready for Testing" | "Closed - Passed" | "Closed - Accepted by Business" | "Closed - Rejected";
  severity: "Critical" | "Major" | "Minor" | "Cosmetic" | null;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  created_at: string;
  updated_at: string;
  testCase?: TestCase;
}

export interface Bug {
  id: number;
  project_id: number;
  defect_id: number;
  bug_number: number;
  support_ticket_number: string | null;
  assigned_developer_id: number | null;
  status: "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "FAILED_TO_RESOLVE" | "CLOSED" | "REOPENED";
  opened_at: string;
  created_at: string;
  updated_at: string;
  defect?: Defect;
  project?: Project;
  developer?: User;
}

export interface DashboardSummary {
  totalProjects: number;
  totalTestRuns: number;
  totalTestCases: number;
  totalDefects: number;
}
