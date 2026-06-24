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
  },
  certDateLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    height: 20,
    width: "60%",
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
});

export function TestRunExecutionFormPDF({
  projectName,
  testRunName,
  testRunId,
  steps,
}: {
  projectName: string;
  testRunName: string;
  testRunId: number;
  steps: { id: number; step_number: string; instruction: string; expected_result: string | null }[];
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>TestCaseHub UAT Execution Form</Text>
          <Text style={styles.subtitle}>{projectName} — {testRunName}</Text>
          <Text style={styles.subtitle}>Execution ID: #{testRunId}</Text>
        </View>

        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableHeaderCell, { width: "8%" }]}>Step #</Text>
            <Text style={[styles.tableHeaderCell, { width: "27%" }]}>Description</Text>
            <Text style={[styles.tableHeaderCell, { width: "25%" }]}>Expected Result</Text>
            <Text style={[styles.tableHeaderCell, { width: "25%" }]}>Actual Result</Text>
            <Text style={[styles.tableHeaderCell, { width: "15%" }]}>Pass/Fail</Text>
          </View>

          {steps.map((step) => (
            <View key={step.id} style={styles.tableRow} wrap={false}>
              <Text style={[styles.tableCell, { width: "8%" }]}>{step.step_number}</Text>
              <Text style={[styles.tableCell, { width: "27%" }]}>{step.instruction}</Text>
              <Text style={[styles.tableCell, { width: "25%" }]}>{step.expected_result ?? ""}</Text>
              <View style={[{ width: "25%", padding: 6 }]}>
                <View style={styles.blankLine} />
                <View style={styles.blankLine} />
              </View>
              <View style={[styles.passFailCell, { width: "15%" }]}>
                <View style={styles.checkbox} />
                <Text>Pass</Text>
                <View style={[styles.checkbox, { marginLeft: 4 }]} />
                <Text>Fail</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.signatureLine}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, marginBottom: 4 }}>Tested By:</Text>
            <View style={styles.signatureField} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, marginBottom: 4 }}>Date:</Text>
            <View style={styles.signatureField} />
          </View>
        </View>

        <Text style={styles.footer}>TestCaseHub — UAT Execution Form — Generated {new Date().toLocaleDateString()}</Text>
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
              <View style={styles.certSignatureLine} />
              <Text style={{ fontSize: 8, color: colors.muted }}>Signature</Text>
              <View style={styles.certDateLine} />
              <Text style={{ fontSize: 8, color: colors.muted }}>Date</Text>
            </View>
            <View style={styles.certSignatureField}>
              <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 6 }}>QA Lead</Text>
              <View style={styles.certSignatureLine} />
              <Text style={{ fontSize: 8, color: colors.muted }}>Signature</Text>
              <View style={styles.certDateLine} />
              <Text style={{ fontSize: 8, color: colors.muted }}>Date</Text>
            </View>
          </View>
        </View>

        <Text style={[styles.footer, { position: "absolute", bottom: 30, left: 50, right: 50 }]}>
          TestCaseHub — UAT Sign-Off Certificate — Generated {new Date().toLocaleDateString()}
        </Text>
      </Page>
    </Document>
  );
}
