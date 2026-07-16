import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { SignOffData } from "../types/api";

const colors = {
  primary: "#1b1b1d",
  secondary: "#4648d4",
  muted: "#45464d",
  border: "#c6c6cd",
  white: "#ffffff",
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: colors.primary,
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: colors.secondary,
    paddingBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: colors.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: "row",
    gap: 20,
    marginTop: 6,
    fontSize: 9,
    color: colors.muted,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    marginTop: 16,
    marginBottom: 8,
    color: colors.secondary,
  },
  table: {
    width: "100%",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 24,
    alignItems: "center",
  },
  tableHeader: {
    backgroundColor: colors.secondary,
    borderBottomWidth: 2,
    borderBottomColor: colors.secondary,
  },
  tableHeaderCell: {
    padding: 6,
    fontSize: 9,
    fontWeight: 700,
    color: colors.white,
  },
  tableCell: {
    padding: 6,
    fontSize: 9,
    color: colors.primary,
  },
  passFailCell: {
    padding: 6,
    fontSize: 9,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  checkbox: {
    width: 10,
    height: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    marginRight: 2,
  },
  blankLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    height: 14,
    marginTop: 2,
  },
  signatureLine: {
    flexDirection: "row",
    marginTop: 30,
    gap: 40,
  },
  signatureField: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    height: 20,
    paddingTop: 4,
    fontSize: 9,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: colors.muted,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  certPage: {
    padding: 50,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: colors.primary,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  certTitle: {
    fontSize: 20,
    fontWeight: 700,
    textAlign: "center",
    marginBottom: 8,
    color: colors.primary,
  },
  certSubtitle: {
    fontSize: 11,
    textAlign: "center",
    color: colors.muted,
    marginBottom: 24,
  },
  certSection: {
    marginBottom: 16,
  },
  certLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: colors.muted,
    marginBottom: 2,
  },
  certValue: {
    fontSize: 10,
    marginBottom: 6,
  },
  metricBlock: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginVertical: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  metricItem: {
    alignItems: "center",
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 700,
    color: colors.secondary,
  },
  metricLabel: {
    fontSize: 8,
    color: colors.muted,
    marginTop: 2,
  },
  certSignatureBlock: {
    marginTop: 40,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  certSignatureField: {
    width: "40%",
  },
  certSignatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    height: 24,
    marginBottom: 4,
    justifyContent: "flex-end",
    paddingBottom: 2,
  },
  certDateLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    height: 20,
    width: "60%",
    justifyContent: "flex-end",
    paddingBottom: 2,
    marginTop: 4,
  },
  ucCode: {
    fontSize: 11,
    fontWeight: 700,
    color: colors.secondary,
    marginBottom: 4,
    marginTop: 8,
  },
  tcCode: {
    fontSize: 10,
    fontWeight: 600,
    marginTop: 6,
    marginBottom: 2,
  },
  stepItem: {
    fontSize: 9,
    marginLeft: 12,
    marginBottom: 1,
    flexDirection: "row",
  },
  stepNumber: {
    width: 20,
    fontWeight: 600,
  },
  formHeaderField: {
    flexDirection: "row",
    gap: 6,
    fontSize: 9,
  },
  formHeaderLabel: {
    fontWeight: 700,
    color: colors.muted,
  },
  formHeaderBlank: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    height: 12,
  },
  scenarioHeading: {
    backgroundColor: colors.primary,
    color: colors.white,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 12,
    fontWeight: 700,
    marginTop: 18,
    marginBottom: 6,
  },
  caseHeading: {
    backgroundColor: colors.border,
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 10,
    fontWeight: 700,
    color: colors.primary,
    marginBottom: 4,
  },
  formStepRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 8,
  },
  formStepRowAlt: {
    backgroundColor: "#f6f6f8",
  },
  formCell: {
    paddingHorizontal: 6,
    fontSize: 9,
    color: colors.primary,
  },
  formBlankArea: {
    paddingHorizontal: 6,
  },
  formRuledLine: {
    borderBottomWidth: 0.75,
    borderBottomColor: colors.muted,
    height: 13,
  },
  formFieldLabel: {
    fontSize: 7,
    color: colors.muted,
    marginBottom: 2,
  },
  formCheckboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    gap: 4,
  },
  formCheckbox: {
    width: 9,
    height: 9,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  formCheckboxLabel: {
    fontSize: 8,
    marginRight: 6,
  },
  pageNumber: {
    position: "absolute",
    bottom: 14,
    right: 40,
    fontSize: 8,
    color: colors.muted,
  },
});

type ExecFormStep = { id: number; step_number: string; instruction: string; expected_result: string | null };
type ExecFormTestCase = { case_number: string; title: string; steps?: ExecFormStep[] };
type ExecFormUseCase = { code: string; name: string; testCases?: ExecFormTestCase[] };

const FORM_COL = {
  step: "6%",
  desc: "21%",
  expected: "19%",
  actual: "19%",
  defect: "19%",
  passFail: "16%",
} as const;

function ExecFormHeaderRow() {
  return (
    <View style={[styles.tableRow, styles.tableHeader]}>
      <Text style={[styles.tableHeaderCell, { width: FORM_COL.step }]}>Step #</Text>
      <Text style={[styles.tableHeaderCell, { width: FORM_COL.desc }]}>Description</Text>
      <Text style={[styles.tableHeaderCell, { width: FORM_COL.expected }]}>Expected Result</Text>
      <Text style={[styles.tableHeaderCell, { width: FORM_COL.actual }]}>Actual Result</Text>
      <Text style={[styles.tableHeaderCell, { width: FORM_COL.defect }]}>Defect Notes / ID</Text>
      <Text style={[styles.tableHeaderCell, { width: FORM_COL.passFail }]}>Result</Text>
    </View>
  );
}

function ExecFormStepRow({ step, index }: { step: ExecFormStep; index: number }) {
  return (
    <View
      style={[styles.formStepRow, index % 2 === 1 ? styles.formStepRowAlt : {}]}
      wrap={false}
    >
      <Text style={[styles.formCell, { width: FORM_COL.step }]}>{step.step_number}</Text>
      <Text style={[styles.formCell, { width: FORM_COL.desc }]}>{step.instruction}</Text>
      <Text style={[styles.formCell, { width: FORM_COL.expected }]}>{step.expected_result || "—"}</Text>
      <View style={[styles.formBlankArea, { width: FORM_COL.actual }]}>
        <View style={styles.formRuledLine} />
        <View style={[styles.formRuledLine, { marginTop: 6 }]} />
      </View>
      <View style={[styles.formBlankArea, { width: FORM_COL.defect }]}>
        <View style={styles.formRuledLine} />
        <View style={[styles.formRuledLine, { marginTop: 6 }]} />
      </View>
      <View style={[{ width: FORM_COL.passFail }]}>
        <View style={styles.formCheckboxRow}>
          <View style={styles.formCheckbox} />
          <Text style={styles.formCheckboxLabel}>PASS</Text>
        </View>
        <View style={[styles.formCheckboxRow, { marginTop: 4 }]}>
          <View style={styles.formCheckbox} />
          <Text style={styles.formCheckboxLabel}>FAIL</Text>
        </View>
      </View>
    </View>
  );
}

export function TestRunExecutionFormPDF({
  projectName,
  testRunName,
  testRunId,
  useCases,
}: {
  projectName: string;
  testRunName: string;
  testRunId: number;
  useCases: ExecFormUseCase[];
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <Text style={styles.title}>TestCaseHub UAT Execution Form</Text>
          <Text style={styles.subtitle}>{projectName} — {testRunName}</Text>
          <Text style={styles.subtitle}>Execution ID: #{testRunId}</Text>
          <View style={{ flexDirection: "row", gap: 24, marginTop: 8 }}>
            <View style={[styles.formHeaderField, { flex: 1 }]}>
              <Text style={styles.formHeaderLabel}>Tester Name:</Text>
              <View style={styles.formHeaderBlank} />
            </View>
            <View style={[styles.formHeaderField, { flex: 1 }]}>
              <Text style={styles.formHeaderLabel}>Date:</Text>
              <View style={styles.formHeaderBlank} />
            </View>
          </View>
        </View>

        {(useCases ?? []).map((uc) => (
          <View key={uc.code} minPresenceAhead={60}>
            <Text style={styles.scenarioHeading}>Test Scenario: {uc.code} — {uc.name}</Text>

            {(uc.testCases ?? []).map((tc) => (
              <View key={tc.case_number} minPresenceAhead={60}>
                <Text style={styles.caseHeading}>Test Case: [{tc.case_number}] {tc.title}</Text>

                <View style={styles.table}>
                  <ExecFormHeaderRow />
                  {(tc.steps ?? []).length > 0 ? (
                    (tc.steps ?? []).map((step, i) => (
                      <ExecFormStepRow key={step.id} step={step} index={i} />
                    ))
                  ) : (
                    <View style={styles.formStepRow}>
                      <Text style={[styles.formCell, { width: "100%", fontStyle: "italic", color: colors.muted }]}>
                        No steps defined for this test case.
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.signatureLine} wrap={false}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, marginBottom: 4 }}>Tested By (Signature):</Text>
            <View style={styles.signatureField} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, marginBottom: 4 }}>Date:</Text>
            <View style={styles.signatureField} />
          </View>
        </View>

        <Text style={styles.footer} fixed>TestCaseHub — UAT Execution Form — Generated {new Date().toLocaleDateString()}</Text>
        <Text
          style={styles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

export function TestPlanDocumentPDF({
  projectName,
  projectObj,
  useCases,
}: {
  projectName: string;
  projectObj?: { objectives?: string | null; scope?: string | null; designed_by?: string | null; module_name?: string | null; version?: number | null };
  useCases: { code: string; name: string; testCases?: { case_number: string; title: string; acceptance_criteria?: string | null; steps?: { step_number: string; instruction: string; expected_result?: string | null }[] }[] }[];
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{projectName}</Text>
          <Text style={styles.subtitle}>Master Test Plan</Text>
          <Text style={styles.subtitle}>Generated: {new Date().toLocaleDateString()}</Text>
        </View>

        {projectObj?.objectives && (
          <View style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: 9, fontWeight: 700 }}>Objectives:</Text>
            <Text style={{ fontSize: 9, color: colors.muted }}>{projectObj.objectives}</Text>
          </View>
        )}

        {useCases.map((uc) => (
          <View key={uc.code} wrap={false} style={{ marginBottom: 12 }}>
            <Text style={styles.ucCode}>{uc.code} — {uc.name}</Text>
            {uc.testCases?.map((tc) => (
              <View key={tc.case_number} wrap={false} style={{ marginLeft: 12, marginTop: 6 }}>
                <Text style={styles.tcCode}>[{tc.case_number}] {tc.title}</Text>
                {tc.acceptance_criteria && (
                  <Text style={{ fontSize: 8, color: colors.muted, marginLeft: 12, marginBottom: 2 }}>
                    Acceptance: {tc.acceptance_criteria}
                  </Text>
                )}
                {tc.steps && tc.steps.length > 0 && (
                  <View style={{ marginLeft: 12 }}>
                    {tc.steps.map((s) => (
                      <View key={`${tc.case_number}-${s.step_number}`} style={styles.stepItem}>
                        <Text style={styles.stepNumber}>{s.step_number}.</Text>
                        <Text style={{ flex: 1 }}>{s.instruction}{s.expected_result ? ` → ${s.expected_result}` : ""}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.footer}>TestCaseHub — Master Test Plan — Generated {new Date().toLocaleDateString()}</Text>
      </Page>
    </Document>
  );
}

export function SignOffCertificatePDF({
  projectName,
  projectCode,
  moduleName,
  version,
  scope,
  objectives,
  outOfScope,
  entryCriteria,
  exitCriteria,
  totalTestRuns,
  totalScenarios,
  passRate,
  acceptedCount,
  tlSigned,
  tlName,
  tlDate,
  boSigned,
  boName,
  boDate,
  businessDecisions,
  isFullySigned,
}: {
  projectName: string;
  projectCode: string;
  moduleName: string;
  version: string;
  scope?: string;
  objectives?: string;
  outOfScope?: string;
  entryCriteria?: string;
  exitCriteria?: string;
  totalTestRuns?: number;
  totalScenarios?: number;
  passRate?: number;
  acceptedCount?: number;
  tlSigned?: boolean;
  tlName?: string;
  tlDate?: string;
  boSigned?: boolean;
  boName?: string;
  boDate?: string;
  businessDecisions?: SignOffData["businessDecisions"];
  isFullySigned?: boolean;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.certPage}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Text style={styles.certTitle}>UAT Final Sign-Off Certificate</Text>
          <Text style={styles.certSubtitle}>{projectName.toUpperCase()} — {moduleName.toUpperCase()}</Text>
          <Text style={[styles.certSubtitle, { marginBottom: 32 }]}>Document: UCH-{projectCode} | v{version}</Text>

          <View style={styles.metricBlock}>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{totalTestRuns ?? 0}</Text>
              <Text style={styles.metricLabel}>Test Runs Executed</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{totalScenarios ?? 0}</Text>
              <Text style={styles.metricLabel}>Total Scenarios</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{passRate ?? 0}%</Text>
              <Text style={styles.metricLabel}>Pass Rate</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{acceptedCount ?? 0}</Text>
              <Text style={styles.metricLabel}>Accepted / Waived</Text>
            </View>
          </View>

          <View style={styles.certSignatureBlock}>
            <View style={styles.certSignatureField}>
              <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 6 }}>Business Owner</Text>
              <View style={styles.certSignatureLine}>
                {boSigned && boName ? (
                  <Text style={{ fontSize: 11, fontFamily: "Helvetica-Oblique" }}>{boName}</Text>
                ) : null}
              </View>
              <Text style={{ fontSize: 8, color: colors.muted }}>Signature</Text>
              <View style={styles.certDateLine}>
                {boSigned && boDate ? (
                  <Text style={{ fontSize: 9 }}>{new Date(boDate).toLocaleDateString()}</Text>
                ) : null}
              </View>
              <Text style={{ fontSize: 8, color: colors.muted }}>Date</Text>
              {!boSigned && (
                <Text style={{ fontSize: 7, color: colors.muted, marginTop: 4 }}>Awaiting signature</Text>
              )}
            </View>
            <View style={styles.certSignatureField}>
              <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 6 }}>QA Lead</Text>
              <View style={styles.certSignatureLine}>
                {tlSigned && tlName ? (
                  <Text style={{ fontSize: 11, fontFamily: "Helvetica-Oblique" }}>{tlName}</Text>
                ) : null}
              </View>
              <Text style={{ fontSize: 8, color: colors.muted }}>Signature</Text>
              <View style={styles.certDateLine}>
                {tlSigned && tlDate ? (
                  <Text style={{ fontSize: 9 }}>{new Date(tlDate).toLocaleDateString()}</Text>
                ) : null}
              </View>
              <Text style={{ fontSize: 8, color: colors.muted }}>Date</Text>
              {!tlSigned && (
                <Text style={{ fontSize: 7, color: colors.muted, marginTop: 4 }}>Awaiting signature</Text>
              )}
            </View>
          </View>

          <Text style={{ fontSize: 9, fontWeight: 700, textAlign: "center", marginTop: 16, color: isFullySigned ? "#15803d" : colors.muted }}>
            {isFullySigned ? "STATUS: FULLY SIGNED OFF" : "STATUS: AWAITING SIGNATURES"}
          </Text>
        </View>

        <Text style={[styles.footer, { position: "absolute", bottom: 30, left: 50, right: 50 }]}>
          TestCaseHub — UAT Sign-Off Certificate — Generated {new Date().toLocaleDateString()}
        </Text>
      </Page>
    </Document>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TestRunResultReportPDF — completed test run results, corporate report quality
// ─────────────────────────────────────────────────────────────────────────────

const rpt = StyleSheet.create({
  page: {
    paddingTop: 52,
    paddingBottom: 52,
    paddingHorizontal: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1b1b1d",
    backgroundColor: "#ffffff",
  },
  stripe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: "#4648d4",
  },
  // ── Cover page ──────────────────────────────────────────────────────────
  coverPage: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },
  coverAccent: {
    backgroundColor: "#4648d4",
    height: 220,
    justifyContent: "flex-end",
    paddingHorizontal: 48,
    paddingBottom: 32,
  },
  coverLabel: {
    fontSize: 9,
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 2,
    marginBottom: 8,
  },
  coverTitle: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    marginBottom: 6,
  },
  coverSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
  },
  coverBody: {
    paddingHorizontal: 48,
    paddingTop: 32,
    paddingBottom: 48,
    flex: 1,
  },
  coverMetaRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  coverMetaLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#45464d",
    width: 120,
  },
  coverMetaValue: {
    fontSize: 9,
    color: "#1b1b1d",
    flex: 1,
  },
  coverDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e5",
    marginVertical: 20,
  },
  // ── KPI strip ────────────────────────────────────────────────────────────
  kpiStrip: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#e0e0e5",
    borderRadius: 6,
    marginTop: 24,
    overflow: "hidden",
  },
  kpiCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: "#e0e0e5",
  },
  kpiCellLast: {
    borderRightWidth: 0,
  },
  kpiValue: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: "#4648d4",
    marginBottom: 3,
  },
  kpiLabel: {
    fontSize: 7,
    color: "#45464d",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  kpiValuePass: { fontSize: 22, fontFamily: "Helvetica-Bold", color: "#15803d", marginBottom: 3 },
  kpiValueFail: { fontSize: 22, fontFamily: "Helvetica-Bold", color: "#b91c1c", marginBottom: 3 },
  // ── Section heading ──────────────────────────────────────────────────────
  sectionHeading: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#4648d4",
    marginTop: 22,
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1.5,
    borderBottomColor: "#4648d4",
  },
  // ── Scenario block ───────────────────────────────────────────────────────
  scenarioBlock: {
    marginBottom: 16,
  },
  scenarioHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f0f8",
    borderLeftWidth: 3,
    borderLeftColor: "#4648d4",
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  scenarioCode: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#4648d4",
    marginRight: 8,
  },
  scenarioName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1b1b1d",
    flex: 1,
  },
  scenarioBadge: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 3,
  },
  // ── Test case block ──────────────────────────────────────────────────────
  tcBlock: {
    marginBottom: 10,
    marginLeft: 8,
  },
  tcHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: "#fafafa",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e5",
    marginBottom: 0,
  },
  tcNumber: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#45464d",
    marginRight: 6,
    width: 28,
  },
  tcTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1b1b1d",
    flex: 1,
  },
  tcBadge: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
  },
  // ── Step table ───────────────────────────────────────────────────────────
  stepTable: {
    borderWidth: 1,
    borderColor: "#e0e0e5",
    marginBottom: 0,
  },
  stepHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#4648d4",
    paddingVertical: 5,
  },
  stepHeaderCell: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    paddingHorizontal: 6,
  },
  stepRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e5",
    paddingVertical: 5,
    minHeight: 22,
  },
  stepRowAlt: {
    backgroundColor: "#f7f7fb",
  },
  stepCell: {
    fontSize: 8,
    color: "#1b1b1d",
    paddingHorizontal: 6,
  },
  stepCellMuted: {
    fontSize: 8,
    color: "#45464d",
    paddingHorizontal: 6,
    fontStyle: "italic",
  },
  passText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#15803d", paddingHorizontal: 6 },
  failText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#b91c1c", paddingHorizontal: 6 },
  pbaText:  { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#7c3aed", paddingHorizontal: 6 },
  pendingText: { fontSize: 8, color: "#45464d", paddingHorizontal: 6 },
  // ── Tester meta row ──────────────────────────────────────────────────────
  tcMeta: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 20,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e5",
    backgroundColor: "#fafafa",
  },
  tcMetaLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#45464d" },
  tcMetaValue: { fontSize: 7, color: "#1b1b1d" },
  // ── Defect summary table ─────────────────────────────────────────────────
  defectTableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#1b1b1d",
    paddingVertical: 5,
  },
  defectTableRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e5",
    paddingVertical: 5,
    minHeight: 20,
  },
  defectTableRowAlt: { backgroundColor: "#f7f7fb" },
  defectTableHeaderCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#ffffff", paddingHorizontal: 6 },
  defectTableCell:       { fontSize: 8, color: "#1b1b1d", paddingHorizontal: 6 },
  // ── Page chrome ──────────────────────────────────────────────────────────
  pageHeader: {
    position: "absolute",
    top: 14,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pageHeaderText: { fontSize: 7, color: "#45464d" },
  pageFooter: {
    position: "absolute",
    bottom: 16,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e5",
    paddingTop: 5,
  },
  pageFooterText:    { fontSize: 7, color: "#45464d" },
  pageFooterPageNum: { fontSize: 7, color: "#4648d4", fontFamily: "Helvetica-Bold" },
});

const STEP_COL = { num: "6%", instruction: "24%", expected: "22%", actual: "22%", notes: "15%", result: "11%" } as const;
const DEF_COL  = { id: "10%", tc: "22%", severity: "11%", status: "13%", regression: "11%", notes: "33%" } as const;

function resultBadge(result: string | null) {
  if (result === "passed")             return { color: "#15803d", label: "PASS" };
  if (result === "failed")             return { color: "#b91c1c", label: "FAIL" };
  if (result === "passed_by_agreement") return { color: "#7c3aed", label: "PBA" };
  return { color: "#45464d", label: "—" };
}

export type RptStepResult = {
  step_id: number;
  actual_result: string | null;
  comments: string | null;
  passed: boolean | null;
  step?: { step_number: string; instruction: string; expected_result: string | null };
};
export type RptExecution = {
  test_case_id: number;
  overall_result: "passed" | "failed" | "passed_by_agreement" | null;
  notes: string | null;
  tester_name?: string | null;
  executed_at?: string | null;
  stepResults?: RptStepResult[];
  tester?: { name?: string | null };
};
export type RptTestCase = {
  id: number;
  case_number: string;
  title: string;
  steps?: { id: number; step_number: string; instruction: string; expected_result: string | null }[];
  retestRole?: "verify" | "regression" | "blocked" | string | null;
  retestExecutable?: boolean | null;
  retestBlockingReason?: string | null;
};
export type RptUseCase = {
  use_case_id: number;
  status: string;
  tester?: { name?: string | null } | null;
  free_pass?: boolean | null;
  free_pass_reason?: string | null;
  useCase?: { code: string; name: string; testCases?: RptTestCase[] };
};
export type RptDefect = {
  id: number;
  status: string;
  severity: string | null;
  regression_index: number;
  tester_notes: string | null;
  testCase?: { case_number: string; title: string };
};

export function TestRunResultReportPDF({
  projectName,
  testRunName,
  testRunId,
  scheduledAt,
  completedAt,
  preparedBy,
  useCases,
  executions,
  defects,
}: {
  projectName: string;
  testRunName: string;
  testRunId: number;
  scheduledAt?: string | null;
  completedAt?: string | null;
  preparedBy?: string | null;
  useCases: RptUseCase[];
  executions: RptExecution[];
  defects: RptDefect[];
}) {
  const generatedDate = new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });
  const fmt = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" }) : "—";

  const total       = useCases.length;
  const passed      = useCases.filter(u => u.status === "passed" || u.status === "passed_by_agreement").length;
  const failed      = useCases.filter(u => u.status === "failed").length;
  const pending     = useCases.filter(u => u.status === "pending" || u.status === "in_progress").length;
  const passRate    = total > 0 ? Math.round((passed / total) * 100) : 0;
  const openDefects = defects.filter(d => d.status !== "CLOSED" && d.status !== "PASSED_BY_AGREEMENT").length;

  const execByTcId = new Map<number, RptExecution>();
  for (const e of executions) execByTcId.set(e.test_case_id, e);

  const ucResult = (truc: RptUseCase) => {
    if (truc.status === "passed")             return "passed";
    if (truc.status === "failed")             return "failed";
    if (truc.status === "passed_by_agreement") return "passed_by_agreement";
    return null;
  };

  return (
    <Document title={`${testRunName} — UAT Results Report`} author="TestCaseHub">

      {/* ── COVER PAGE ──────────────────────────────────────────────────── */}
      <Page size="A4" style={rpt.coverPage}>
        <View style={rpt.coverAccent}>
          <Text style={rpt.coverLabel}>USER ACCEPTANCE TESTING</Text>
          <Text style={rpt.coverTitle}>Test Execution Report</Text>
          <Text style={rpt.coverSubtitle}>{testRunName}</Text>
        </View>
        <View style={rpt.coverBody}>
          {[
            ["Project",             projectName],
            ["Test Run ID",         `#${testRunId}`],
            ["Scheduled Date",      fmt(scheduledAt)],
            ["Completed Date",      fmt(completedAt)],
            ["Prepared By",         preparedBy ?? "—"],
            ["Report Generated",    generatedDate],
            ["Document Reference",  `TCH-TR-${testRunId}`],
          ].map(([label, value]) => (
            <View key={label} style={rpt.coverMetaRow}>
              <Text style={rpt.coverMetaLabel}>{label}</Text>
              <Text style={rpt.coverMetaValue}>{value}</Text>
            </View>
          ))}

          <View style={rpt.coverDivider} />

          <View style={rpt.kpiStrip}>
            {[
              { label: "Total Scenarios", value: String(total),     style: rpt.kpiValue },
              { label: "Passed",          value: String(passed),    style: rpt.kpiValuePass },
              { label: "Failed",          value: String(failed),    style: rpt.kpiValueFail },
              { label: "Pending",         value: String(pending),   style: rpt.kpiValue },
              { label: "Pass Rate",       value: `${passRate}%`,    style: passRate >= 80 ? rpt.kpiValuePass : passRate >= 50 ? rpt.kpiValue : rpt.kpiValueFail },
              { label: "Open Defects",    value: String(openDefects), style: openDefects > 0 ? rpt.kpiValueFail : rpt.kpiValuePass },
            ].map(({ label, value, style }, i, arr) => (
              <View key={label} style={[rpt.kpiCell, i === arr.length - 1 ? rpt.kpiCellLast : {}]}>
                <Text style={style}>{value}</Text>
                <Text style={rpt.kpiLabel}>{label.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </View>
      </Page>

      {/* ── RESULTS PAGES ───────────────────────────────────────────────── */}
      <Page size="A4" style={rpt.page} wrap>
        <View style={rpt.stripe} fixed />
        <View style={rpt.pageHeader} fixed>
          <Text style={rpt.pageHeaderText}>{projectName} — {testRunName}</Text>
          <Text style={rpt.pageHeaderText}>CONFIDENTIAL</Text>
        </View>

        <Text style={rpt.sectionHeading}>Test Execution Results</Text>

        {useCases.map((truc) => {
          const uc = truc.useCase;
          if (!uc) return null;
          const badge = resultBadge(ucResult(truc));

          return (
            <View key={truc.use_case_id} style={rpt.scenarioBlock} minPresenceAhead={80}>
              <View style={rpt.scenarioHeader}>
                <Text style={rpt.scenarioCode}>{uc.code}</Text>
                <Text style={rpt.scenarioName}>{uc.name}</Text>
                {truc.free_pass && (
                  <Text style={[rpt.scenarioBadge, { color: "#7c3aed", marginRight: 6 }]}>FREE PASS</Text>
                )}
                <Text style={[rpt.scenarioBadge, { color: badge.color }]}>{badge.label}</Text>
              </View>

              {(uc.testCases ?? []).map((tc) => {
                const isBlocked =
                  tc.retestRole === "blocked" || tc.retestExecutable === false;
                const exec    = execByTcId.get(tc.id);
                const tcBadge = isBlocked
                  ? { color: "#b91c1c", label: "BLOCKED" }
                  : resultBadge(exec?.overall_result ?? null);
                const testerName = exec?.tester?.name ?? exec?.tester_name ?? null;
                const executedAt = exec?.executed_at ? fmt(exec.executed_at) : null;

                return (
                  <View key={tc.id} style={rpt.tcBlock} minPresenceAhead={60} wrap={false}>
                    <View style={rpt.tcHeader}>
                      <Text style={rpt.tcNumber}>{tc.case_number}</Text>
                      <Text style={rpt.tcTitle}>{tc.title}</Text>
                      {tc.retestRole === "verify" && (
                        <Text style={[rpt.tcBadge, { color: "#15803d", marginRight: 4 }]}>VERIFY</Text>
                      )}
                      {tc.retestRole === "regression" && (
                        <Text style={[rpt.tcBadge, { color: "#1d4ed8", marginRight: 4 }]}>REGRESSION</Text>
                      )}
                      <Text style={[rpt.tcBadge, { color: tcBadge.color }]}>{tcBadge.label}</Text>
                    </View>

                    {isBlocked ? (
                      <View style={{ marginLeft: 8, marginTop: 2, marginBottom: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#fef2f2", borderLeftWidth: 2, borderLeftColor: "#b91c1c" }}>
                        <Text style={{ fontSize: 8, color: "#7f1d1d" }}>
                          Not executed in this verification run
                          {tc.retestBlockingReason ? ` — ${tc.retestBlockingReason}` : " (blocked / out of executable scope)."}
                        </Text>
                      </View>
                    ) : (
                      <>
                        {(tc.steps ?? []).length > 0 && (
                          <View style={rpt.stepTable}>
                            <View style={rpt.stepHeaderRow}>
                              <Text style={[rpt.stepHeaderCell, { width: STEP_COL.num }]}>#</Text>
                              <Text style={[rpt.stepHeaderCell, { width: STEP_COL.instruction }]}>Step</Text>
                              <Text style={[rpt.stepHeaderCell, { width: STEP_COL.expected }]}>Expected</Text>
                              <Text style={[rpt.stepHeaderCell, { width: STEP_COL.actual }]}>Actual Result</Text>
                              <Text style={[rpt.stepHeaderCell, { width: STEP_COL.notes }]}>Notes</Text>
                              <Text style={[rpt.stepHeaderCell, { width: STEP_COL.result }]}>Result</Text>
                            </View>
                            {(tc.steps ?? []).map((step, i) => {
                              // Take highest-ID result per step — matches execution engine deduplication
                              const matchingSrs = exec?.stepResults?.filter(r => r.step_id === step.id) ?? [];
                              const sr = matchingSrs.length > 0
                                ? matchingSrs.reduce((best, r) => (r.step_id > best.step_id ? r : best), matchingSrs[0])
                                : undefined;
                              // Infer when passed is null (runs recorded before the onResult fix):
                              // passed TC → all steps pass; failed TC + step has actual_result → that step failed.
                              const inferredPassed =
                                sr?.passed !== null && sr?.passed !== undefined ? sr.passed :
                                exec?.overall_result === "passed" ? true :
                                sr?.actual_result ? false : null;
                              const stepBadge =
                                inferredPassed === true  ? { color: "#15803d", label: "PASS" } :
                                inferredPassed === false ? { color: "#b91c1c", label: "FAIL" } :
                                                           { color: "#45464d", label: "—" };
                              return (
                                <View key={step.id} style={[rpt.stepRow, i % 2 === 1 ? rpt.stepRowAlt : {}]}>
                                  <Text style={[rpt.stepCell, { width: STEP_COL.num }]}>{step.step_number}</Text>
                                  <Text style={[rpt.stepCell, { width: STEP_COL.instruction }]}>{step.instruction}</Text>
                                  <Text style={[rpt.stepCellMuted, { width: STEP_COL.expected }]}>{step.expected_result ?? "—"}</Text>
                                  <Text style={[rpt.stepCell, { width: STEP_COL.actual }]}>{sr?.actual_result ?? "—"}</Text>
                                  <Text style={[rpt.stepCellMuted, { width: STEP_COL.notes }]}>{sr?.comments ?? "—"}</Text>
                                  <Text style={[rpt.stepCell, { width: STEP_COL.result, color: stepBadge.color, fontFamily: "Helvetica-Bold" }]}>
                                    {stepBadge.label}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        )}

                        {(testerName ?? executedAt ?? exec?.notes) && (
                          <View style={rpt.tcMeta}>
                            {testerName  && <View style={{ flexDirection: "row", gap: 4 }}><Text style={rpt.tcMetaLabel}>Tester:</Text><Text style={rpt.tcMetaValue}>{testerName}</Text></View>}
                            {executedAt  && <View style={{ flexDirection: "row", gap: 4 }}><Text style={rpt.tcMetaLabel}>Executed:</Text><Text style={rpt.tcMetaValue}>{executedAt}</Text></View>}
                            {exec?.notes && <View style={{ flexDirection: "row", gap: 4, flex: 1 }}><Text style={rpt.tcMetaLabel}>Notes:</Text><Text style={[rpt.tcMetaValue, { flex: 1 }]}>{exec.notes}</Text></View>}
                          </View>
                        )}
                      </>
                    )}
                  </View>
                );
              })}

              {truc.free_pass && truc.free_pass_reason && (
                <View style={{ marginLeft: 8, marginTop: 2, marginBottom: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#f3f0fc", borderLeftWidth: 2, borderLeftColor: "#7c3aed" }}>
                  <Text style={{ fontSize: 8, color: "#45464d" }}>
                    <Text style={{ fontFamily: "Helvetica-Bold" }}>Free Pass Reason: </Text>
                    {truc.free_pass_reason}
                  </Text>
                </View>
              )}
            </View>
          );
        })}

        <View style={rpt.pageFooter} fixed>
          <Text style={rpt.pageFooterText}>TestCaseHub · TCH-TR-{testRunId} · {generatedDate}</Text>
          <Text style={rpt.pageFooterPageNum} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {/* ── DEFECT SUMMARY PAGE ─────────────────────────────────────────── */}
      {defects.length > 0 && (
        <Page size="A4" style={rpt.page} wrap>
          <View style={rpt.stripe} fixed />
          <View style={rpt.pageHeader} fixed>
            <Text style={rpt.pageHeaderText}>{projectName} — {testRunName}</Text>
            <Text style={rpt.pageHeaderText}>CONFIDENTIAL</Text>
          </View>

          <Text style={rpt.sectionHeading}>Defect Summary</Text>

          <View style={{ borderWidth: 1, borderColor: "#e0e0e5" }}>
            <View style={rpt.defectTableHeaderRow}>
              <Text style={[rpt.defectTableHeaderCell, { width: DEF_COL.id }]}>DEF #</Text>
              <Text style={[rpt.defectTableHeaderCell, { width: DEF_COL.tc }]}>Test Case</Text>
              <Text style={[rpt.defectTableHeaderCell, { width: DEF_COL.severity }]}>Severity</Text>
              <Text style={[rpt.defectTableHeaderCell, { width: DEF_COL.status }]}>Status</Text>
              <Text style={[rpt.defectTableHeaderCell, { width: DEF_COL.regression }]}>Regressions</Text>
              <Text style={[rpt.defectTableHeaderCell, { width: DEF_COL.notes }]}>Tester Notes</Text>
            </View>
            {defects.map((d, i) => (
              <View key={d.id} style={[rpt.defectTableRow, i % 2 === 1 ? rpt.defectTableRowAlt : {}]} wrap={false}>
                <Text style={[rpt.defectTableCell, { width: DEF_COL.id, fontFamily: "Helvetica-Bold", color: "#4648d4" }]}>DEF-{d.id}</Text>
                <Text style={[rpt.defectTableCell, { width: DEF_COL.tc }]}>[{d.testCase?.case_number ?? "—"}] {d.testCase?.title ?? ""}</Text>
                <Text style={[rpt.defectTableCell, { width: DEF_COL.severity, color: d.severity === "Critical" ? "#b91c1c" : d.severity === "Major" ? "#b45309" : "#1b1b1d" }]}>
                  {d.severity ?? "—"}
                </Text>
                <Text style={[rpt.defectTableCell, { width: DEF_COL.status }]}>{d.status.replace(/_/g, " ")}</Text>
                <Text style={[rpt.defectTableCell, { width: DEF_COL.regression, textAlign: "center", color: d.regression_index > 0 ? "#b91c1c" : "#15803d" }]}>
                  {d.regression_index}
                </Text>
                <Text style={[rpt.defectTableCell, { width: DEF_COL.notes, color: "#45464d" }]}>{d.tester_notes ?? "—"}</Text>
              </View>
            ))}
          </View>

          <View style={rpt.pageFooter} fixed>
            <Text style={rpt.pageFooterText}>TestCaseHub · TCH-TR-{testRunId} · {generatedDate}</Text>
            <Text style={rpt.pageFooterPageNum} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      )}
    </Document>
  );
}
