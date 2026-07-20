export type Readiness = "ready" | "at_risk" | "not_ready";

export interface DashboardSummary {
  totalProjects: number;
  totalTestRuns: number;
  totalTestCases: number;
  totalDefects: number;
  openDefects?: number;
}

export interface QueueDefectItem {
  id: number;
  severity: string | null;
  status: string;
  projectId: number;
  projectName: string;
  title: string;
  ageDays: number;
  created_at?: string;
  is_blocked?: boolean;
  blocked_reason?: string | null;
  runId?: number;
}

export interface ProgressByProject {
  projectId: number;
  name: string;
  done: number;
  inProgress: number;
  notStarted: number;
  total: number;
}

export interface AtRiskRun {
  id: number;
  name: string;
  status: string;
  projectId: number;
  projectName: string;
  progressPct: number;
  reason: string;
}

export interface TestLeadOverview {
  role: "TEST_LEAD";
  kpis: {
    executionProgress: number;
    passRate: number | null;
    triageBacklog: number;
    blockedOrCritical: number;
    readiness: Readiness;
    readinessReasons: string[];
    totalScenarios: number;
    doneScenarios: number;
    openDefects: number;
  };
  progressByProject: ProgressByProject[];
  triageQueue: QueueDefectItem[];
  retestQueue: QueueDefectItem[];
  atRiskRuns: AtRiskRun[];
}

export interface ProjectReadiness {
  projectId: number;
  name: string;
  readiness: Readiness;
  reasons: string[];
  executionPct: number;
  openCritical: number;
  openHigh: number;
  signedOff: boolean;
  testLeadSigned: boolean;
  businessOwnerSigned: boolean;
}

export interface BusinessOverview {
  role: "BUSINESS_OWNER";
  kpis: {
    readiness: Readiness;
    readinessReasons: string[];
    criticalOpen: number;
    uatCompletion: number;
    pendingMyDecision: number;
    signedOffCount: number;
    totalProjects: number;
  };
  projectReadiness: ProjectReadiness[];
  pendingSignOff: ProjectReadiness[];
  decisionsNeeded: QueueDefectItem[];
  residualRisk: QueueDefectItem[];
}

export interface DeveloperOverview {
  role: "DEVELOPER";
  kpis: {
    myOpen: number;
    inProgress: number;
    awaitingQa: number;
    aging: number;
    resolvedThisMonth: number;
  };
  bySeverity: Record<string, number>;
  ageBuckets: Record<string, number>;
  inbox: QueueDefectItem[];
  blockedQueue: QueueDefectItem[];
  returnedQueue: QueueDefectItem[];
}

export interface TesterScenarioItem {
  trucId: number;
  runId: number;
  runName: string;
  scenarioCode: string;
  scenarioName: string;
  projectName: string;
  status: string;
  scheduled_at?: string | null;
}

export interface TesterOverview {
  role: "TESTER";
  kpis: {
    dueToday: number;
    myRemaining: number;
    completedToday: number;
    passRate: number | null;
    openDefectsFound: number;
  };
  todayProgress: { todo: number; inProgress: number; done: number };
  continueQueue: TesterScenarioItem[];
  upNext: TesterScenarioItem[];
  retestQueue: QueueDefectItem[];
}

export interface AdminProjectFlag {
  projectId: number;
  name: string;
  projectCode?: string;
}

export interface AdminSignOffItem {
  projectId: number;
  name: string;
  testLeadSigned: boolean;
  businessOwnerSigned: boolean;
  signedOff: boolean;
  testLeadName: string | null;
}

export interface AdminAtRiskRun {
  id: number;
  name: string;
  status: string;
  projectId: number;
  projectName: string;
  idleDays: number;
  reason: string;
}

export interface AdminOverview {
  role: "ADMIN";
  kpis: {
    totalProjects: number;
    activeUsers: number;
    inactiveUsers: number;
    totalUsers: number;
    adminUsers: number;
    openDefects: number;
    newDefects: number;
    criticalOpen: number;
    activeRuns: number;
    totalTestRuns: number;
    projectsWithoutLead: number;
    incompleteSignOff: number;
    stalledRuns: number;
  };
  projectsWithoutLead: AdminProjectFlag[];
  projectsWithNoTeam: AdminProjectFlag[];
  incompleteSignOff: AdminSignOffItem[];
  atRiskRuns: AdminAtRiskRun[];
  agingDefects: QueueDefectItem[];
  openByStatus: Record<string, number>;
  openBySeverity: Record<string, number>;
}

export type RoleOverview =
  | TestLeadOverview
  | BusinessOverview
  | DeveloperOverview
  | TesterOverview
  | AdminOverview;

export interface SignOffStatusItem {
  projectId: number;
  name: string;
  signedOff: boolean;
  testLeadSigned: boolean;
  businessOwnerSigned: boolean;
}
