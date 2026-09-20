import { eq, and, ne, inArray, notInArray, desc } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@workspace/db";

/** Terminal defect statuses that do not block a sibling case. */
export const TERMINAL_DEFECT_STATUSES = [
  "CLOSED",
  "PASSED_BY_AGREEMENT",
] as const;

/** Statuses that mean "fix is ready to verify" — case is VERIFY. */
export const VERIFY_DEFECT_STATUSES = ["READY_FOR_VERIFICATION"] as const;

export type CaseRole = "verify" | "regression" | "blocked" | "re-attempt";

export type SiblingCasePreview = {
  testCaseId: number;
  caseNumber: string | null;
  caseTitle: string | null;
  useCaseId: number;
  useCaseCode: string | null;
  useCaseName: string | null;
  role: CaseRole;
  defectId: number | null;
  bugNumber: number | null;
  defectStatus: string | null;
  blockingReason: string | null;
};

export type RetestScopeItem = {
  defectId: number | null;
  bugNumber: number | null;
  testCaseId: number;
  caseNumber: string | null;
  caseTitle: string | null;
  useCaseId: number | null;
  useCaseCode: string | null;
  useCaseName: string | null;
  defectStatus: string | null;
  role: CaseRole;
  executable: boolean;
};

export type RetestScope = {
  defectIds: number[];
  /** Executable cases only (verify + regression + re-attempt). */
  testCaseIds: number[];
  /** All scoped cases including blocked. */
  allTestCaseIds: number[];
  useCaseIds: number[];
  items: RetestScopeItem[];
  verifyCaseIds: number[];
  regressionCaseIds: number[];
  blockedCaseIds: number[];
  reAttemptCaseIds: number[];
};

/**
 * Classify sibling test cases in scenarios that contain RFV defects.
 * - verify: has READY_FOR_VERIFICATION defect
 * - blocked: has open non-RFV, non-terminal defect
 * - regression: no open blocking defects (safe opt-in)
 */
export async function classifySiblingCases(
  projectId: number,
  rfvDefects: Array<{
    id: number;
    bug_number: number | null;
    status: string;
    test_case_id: number;
    testCase?: {
      id: number;
      case_number: string;
      title: string;
      use_case_id: number;
    } | null;
  }>,
): Promise<SiblingCasePreview[]> {
  const useCaseIds = new Set<number>();
  const verifyByCase = new Map<
    number,
    { defectId: number; bugNumber: number | null; status: string }
  >();

  for (const d of rfvDefects) {
    if (!d.testCase) continue;
    useCaseIds.add(d.testCase.use_case_id);
    // Prefer first RFV defect per case if multiple
    if (!verifyByCase.has(d.test_case_id)) {
      verifyByCase.set(d.test_case_id, {
        defectId: d.id,
        bugNumber: d.bug_number,
        status: d.status,
      });
    }
  }

  if (useCaseIds.size === 0) return [];

  const scenarios = await db.query.useCases.findMany({
    where: inArray(schema.useCases.id, Array.from(useCaseIds)),
    columns: { id: true, code: true, name: true },
    with: {
      testCases: {
        columns: { id: true, case_number: true, title: true, use_case_id: true },
        orderBy: (tc, { asc }) => [asc(tc.sort_order)],
      },
    },
  });

  const allCaseIds = scenarios.flatMap((s) => s.testCases.map((tc) => tc.id));
  if (allCaseIds.length === 0) return [];

  // Open (non-terminal) defects for these cases, excluding RFV (those are verify)
  const openDefects = await db.query.defects.findMany({
    where: and(
      eq(schema.defects.project_id, projectId),
      inArray(schema.defects.test_case_id, allCaseIds),
      notInArray(schema.defects.status, [...TERMINAL_DEFECT_STATUSES]),
    ),
    columns: {
      id: true,
      bug_number: true,
      status: true,
      test_case_id: true,
    },
  });

  // Group open non-RFV defects by case (blocking)
  const blockingByCase = new Map<
    number,
    { defectId: number; bugNumber: number | null; status: string }
  >();
  for (const d of openDefects) {
    if (d.status === "READY_FOR_VERIFICATION") continue;
    if (!blockingByCase.has(d.test_case_id)) {
      blockingByCase.set(d.test_case_id, {
        defectId: d.id,
        bugNumber: d.bug_number,
        status: d.status,
      });
    }
  }

  const previews: SiblingCasePreview[] = [];
  for (const scenario of scenarios) {
    for (const tc of scenario.testCases) {
      const verify = verifyByCase.get(tc.id);
      const blocking = blockingByCase.get(tc.id);

      let role: CaseRole;
      let defectId: number | null = null;
      let bugNumber: number | null = null;
      let defectStatus: string | null = null;
      let blockingReason: string | null = null;

      if (verify) {
        role = "verify";
        defectId = verify.defectId;
        bugNumber = verify.bugNumber;
        defectStatus = verify.status;
      } else if (blocking) {
        role = "blocked";
        defectId = blocking.defectId;
        bugNumber = blocking.bugNumber;
        defectStatus = blocking.status;
        blockingReason = `Open defect #${blocking.bugNumber ?? blocking.defectId} (${blocking.status})`;
      } else {
        role = "regression";
      }

      previews.push({
        testCaseId: tc.id,
        caseNumber: tc.case_number,
        caseTitle: tc.title,
        useCaseId: scenario.id,
        useCaseCode: scenario.code,
        useCaseName: scenario.name,
        role,
        defectId,
        bugNumber,
        defectStatus,
        blockingReason,
      });
    }
  }

  return previews;
}

/**
 * Scope of a verification/retest run.
 * Prefer test_run_case_scope (Phase B); fall back to defect_retests enrollment (Phase A).
 */
export async function getRetestScope(testRunId: number): Promise<RetestScope> {
  const scopeRows = await db.query.testRunCaseScope.findMany({
    where: eq(schema.testRunCaseScope.test_run_id, testRunId),
    with: {
      testCase: {
        with: {
          useCase: { columns: { id: true, code: true, name: true } },
        },
      },
      defect: {
        columns: { id: true, bug_number: true, status: true },
      },
    },
  });

  if (scopeRows.length > 0) {
    return buildScopeFromRows(
      scopeRows.map((r) => ({
        role: r.role as CaseRole,
        testCaseId: r.test_case_id,
        caseNumber: r.testCase?.case_number ?? null,
        caseTitle: r.testCase?.title ?? null,
        useCaseId: r.testCase?.useCase?.id ?? r.testCase?.use_case_id ?? null,
        useCaseCode: r.testCase?.useCase?.code ?? null,
        useCaseName: r.testCase?.useCase?.name ?? null,
        defectId: r.defect_id,
        bugNumber: r.defect?.bug_number ?? null,
        defectStatus: r.defect?.status ?? null,
      })),
    );
  }

  // Legacy Phase A fallback: defect_retests only → all verify
  const enrollments = await db.query.defectRetests.findMany({
    where: eq(schema.defectRetests.target_verification_run_id, testRunId),
    with: {
      defect: {
        with: {
          testCase: {
            with: {
              useCase: { columns: { id: true, code: true, name: true } },
            },
          },
        },
      },
    },
  });

  return buildScopeFromRows(
    enrollments
      .filter((row) => row.defect)
      .map((row) => {
        const d = row.defect!;
        const uc = d.testCase?.useCase;
        return {
          role: "verify" as CaseRole,
          testCaseId: d.test_case_id,
          caseNumber: d.testCase?.case_number ?? null,
          caseTitle: d.testCase?.title ?? null,
          useCaseId: uc?.id ?? d.testCase?.use_case_id ?? null,
          useCaseCode: uc?.code ?? null,
          useCaseName: uc?.name ?? null,
          defectId: d.id,
          bugNumber: d.bug_number,
          defectStatus: d.status,
        };
      }),
  );
}

function buildScopeFromRows(
  rows: Array<{
    role: CaseRole;
    testCaseId: number;
    caseNumber: string | null;
    caseTitle: string | null;
    useCaseId: number | null;
    useCaseCode: string | null;
    useCaseName: string | null;
    defectId: number | null;
    bugNumber: number | null;
    defectStatus: string | null;
  }>,
): RetestScope {
  const items: RetestScopeItem[] = [];
  const defectIds: number[] = [];
  const allTestCaseIds = new Set<number>();
  const verifyCaseIds = new Set<number>();
  const regressionCaseIds = new Set<number>();
  const blockedCaseIds = new Set<number>();
  const reAttemptCaseIds = new Set<number>();
  const useCaseIds = new Set<number>();

  for (const r of rows) {
    allTestCaseIds.add(r.testCaseId);
    if (r.useCaseId) useCaseIds.add(r.useCaseId);
    if (r.role === "verify") {
      verifyCaseIds.add(r.testCaseId);
      if (r.defectId) defectIds.push(r.defectId);
    } else if (r.role === "regression") {
      regressionCaseIds.add(r.testCaseId);
    } else if (r.role === "re-attempt") {
      reAttemptCaseIds.add(r.testCaseId);
    } else {
      blockedCaseIds.add(r.testCaseId);
    }

    items.push({
      defectId: r.defectId,
      bugNumber: r.bugNumber,
      testCaseId: r.testCaseId,
      caseNumber: r.caseNumber,
      caseTitle: r.caseTitle,
      useCaseId: r.useCaseId,
      useCaseCode: r.useCaseCode,
      useCaseName: r.useCaseName,
      defectStatus: r.defectStatus,
      role: r.role,
      executable: r.role === "verify" || r.role === "regression" || r.role === "re-attempt",
    });
  }

  const executableIds = [
    ...Array.from(verifyCaseIds),
    ...Array.from(regressionCaseIds),
    ...Array.from(reAttemptCaseIds),
  ];

  return {
    defectIds,
    testCaseIds: executableIds,
    allTestCaseIds: Array.from(allTestCaseIds),
    useCaseIds: Array.from(useCaseIds),
    items,
    verifyCaseIds: Array.from(verifyCaseIds),
    regressionCaseIds: Array.from(regressionCaseIds),
    blockedCaseIds: Array.from(blockedCaseIds),
    reAttemptCaseIds: Array.from(reAttemptCaseIds),
  };
}

/**
 * True if this test case may be executed in the run.
 * Standard runs: always true.
 * Retest: only verify + regression (not blocked).
 */
export async function isTestCaseInRetestScope(
  testRunId: number,
  testCaseId: number,
  runType: string | null | undefined,
): Promise<boolean> {
  if (runType !== "retest") return true;

  const scopeRow = await db.query.testRunCaseScope.findFirst({
    where: and(
      eq(schema.testRunCaseScope.test_run_id, testRunId),
      eq(schema.testRunCaseScope.test_case_id, testCaseId),
    ),
    columns: { role: true },
  });
  if (scopeRow) {
    return scopeRow.role === "verify" || scopeRow.role === "regression" || scopeRow.role === "re-attempt";
  }

  // Legacy: enrolled via defect_retests
  const rows = await db
    .select({ test_case_id: schema.defects.test_case_id })
    .from(schema.defectRetests)
    .innerJoin(schema.defects, eq(schema.defectRetests.defect_id, schema.defects.id))
    .where(
      and(
        eq(schema.defectRetests.target_verification_run_id, testRunId),
        eq(schema.defects.test_case_id, testCaseId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Why a case cannot be executed (null if allowed). */
export async function getRetestCaseBlockReason(
  testRunId: number,
  testCaseId: number,
  runType: string | null | undefined,
): Promise<string | null> {
  if (runType !== "retest") return null;

  const scopeRow = await db.query.testRunCaseScope.findFirst({
    where: and(
      eq(schema.testRunCaseScope.test_run_id, testRunId),
      eq(schema.testRunCaseScope.test_case_id, testCaseId),
    ),
    with: {
      defect: { columns: { bug_number: true, status: true } },
    },
  });

  if (scopeRow) {
    if (scopeRow.role === "blocked") {
      const bn = scopeRow.defect?.bug_number;
      const st = scopeRow.defect?.status;
      return `Blocked — open defect${bn != null ? ` #${bn}` : ""}${st ? ` (${st})` : ""} still in development`;
    }
    if (scopeRow.role === "verify" || scopeRow.role === "regression" || scopeRow.role === "re-attempt") return null;
  }

  const inScope = await isTestCaseInRetestScope(testRunId, testCaseId, runType);
  if (!inScope) {
    return "This test case is not in retest scope";
  }
  return null;
}

/**
 * Finds test cases that were marked blocked_dependency in completed runs for
 * this project and whose scenarios overlap with the given useCaseIds.
 * These are candidates for re-attempt in a verification run.
 *
 * Excludes cases that:
 * - Already appear in alreadyClassifiedIds (avoid double-counting)
 * - Have an open (non-terminal) defect of their own
 */
export async function fetchBlockedDependencyCases(
  projectId: number,
  useCaseIds: number[],
  alreadyClassifiedIds: Set<number>,
): Promise<Array<{
  testCaseId: number;
  caseNumber: string | null;
  caseTitle: string | null;
  useCaseId: number;
  useCaseCode: string | null;
  useCaseName: string | null;
  sourceRunId: number;
  sourceRunName: string | null;
  blockedByNotes: string | null;
}>> {
  if (useCaseIds.length === 0) return [];

  // Find all test cases in the relevant scenarios
  const scenarios = await db.query.useCases.findMany({
    where: inArray(schema.useCases.id, useCaseIds),
    columns: { id: true, code: true, name: true },
    with: {
      testCases: {
        columns: { id: true, case_number: true, title: true, use_case_id: true },
      },
    },
  });

  const candidateCaseIds = scenarios
    .flatMap((s) => s.testCases.map((tc) => ({ ...tc, useCaseCode: s.code, useCaseName: s.name })))
    .filter((tc) => !alreadyClassifiedIds.has(tc.id));

  if (candidateCaseIds.length === 0) return [];

  const caseIdList = candidateCaseIds.map((tc) => tc.id);

  // Find completed runs for this project that have blocked_dependency executions
  const completedRuns = await db.query.testRuns.findMany({
    where: and(
      eq(schema.testRuns.project_id, projectId),
      eq(schema.testRuns.status, "completed"),
    ),
    columns: { id: true, name: true },
  });

  if (completedRuns.length === 0) return [];

  const runIds = completedRuns.map((r) => r.id);

  // Find blocked_dependency executions for these cases in those runs
  const blockedExecs = await db.query.executions.findMany({
    where: and(
      inArray(schema.executions.test_run_id, runIds),
      inArray(schema.executions.test_case_id, caseIdList),
      eq(schema.executions.overall_result, "blocked_dependency"),
    ),
    columns: {
      test_case_id: true,
      test_run_id: true,
      notes: true,
    },
    orderBy: [desc(schema.executions.executed_at)],
  });

  if (blockedExecs.length === 0) return [];

  // Deduplicate — one entry per test case (most recent block)
  const seenCaseIds = new Set<number>();
  const uniqueBlockedExecs = blockedExecs.filter((e) => {
    if (seenCaseIds.has(e.test_case_id)) return false;
    seenCaseIds.add(e.test_case_id);
    return true;
  });

  // Exclude cases that have their own open (non-terminal) defects
  const openDefects = await db.query.defects.findMany({
    where: and(
      eq(schema.defects.project_id, projectId),
      inArray(schema.defects.test_case_id, uniqueBlockedExecs.map((e) => e.test_case_id)),
      notInArray(schema.defects.status, [...TERMINAL_DEFECT_STATUSES]),
    ),
    columns: { test_case_id: true },
  });
  const hasOpenDefect = new Set(openDefects.map((d) => d.test_case_id));

  const runMap = new Map(completedRuns.map((r) => [r.id, r.name]));
  const caseMap = new Map(
    candidateCaseIds.map((tc) => [tc.id, tc]),
  );

  return uniqueBlockedExecs
    .filter((e) => !hasOpenDefect.has(e.test_case_id))
    .map((e) => {
      const tc = caseMap.get(e.test_case_id)!;
      return {
        testCaseId: e.test_case_id,
        caseNumber: tc.case_number,
        caseTitle: tc.title,
        useCaseId: tc.use_case_id,
        useCaseCode: tc.useCaseCode,
        useCaseName: tc.useCaseName,
        sourceRunId: e.test_run_id!,
        sourceRunName: runMap.get(e.test_run_id!) ?? null,
        blockedByNotes: e.notes,
      };
    });
}

/** Defect IDs enrolled in any incomplete retest run for this project. */
export async function defectIdsInActiveRetestRuns(projectId: number): Promise<Set<number>> {
  const activeRuns = await db.query.testRuns.findMany({
    where: and(
      eq(schema.testRuns.project_id, projectId),
      eq(schema.testRuns.run_type, "retest"),
      ne(schema.testRuns.status, "completed"),
    ),
    columns: { id: true },
  });
  if (activeRuns.length === 0) return new Set();
  const enrollments = await db.query.defectRetests.findMany({
    where: inArray(
      schema.defectRetests.target_verification_run_id,
      activeRuns.map((r) => r.id),
    ),
    columns: { defect_id: true },
  });
  return new Set(enrollments.map((e) => e.defect_id));
}
