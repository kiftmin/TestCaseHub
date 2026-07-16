import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
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
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: colors.primary,
    backgroundColor: colors.white,
  },
  certTopBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: "#1a2744",
  },
  certHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 22,
    paddingBottom: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: "#1a2744",
  },
  certDocLabel: {
    fontSize: 8,
    color: colors.muted,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  certTitle: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    marginBottom: 4,
  },
  certSubtitle: {
    fontSize: 10,
    color: colors.muted,
  },
  certMetaBox: {
    alignItems: "flex-end",
  },
  certMetaLabel: {
    fontSize: 7,
    color: colors.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 1,
  },
  certMetaValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginBottom: 6,
  },
  certSection: {
    marginBottom: 14,
  },
  certSectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: "#d0d0d6",
  },
  certBody: {
    fontSize: 9.5,
    lineHeight: 1.45,
    color: colors.primary,
  },
  certMuted: {
    fontSize: 9,
    color: colors.muted,
    lineHeight: 1.4,
  },
  certInfoGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 14,
  },
  certInfoCard: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: "#d0d0d6",
    padding: 8,
    backgroundColor: "#fafafa",
  },
  certInfoLabel: {
    fontSize: 7,
    color: colors.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  certInfoValue: {
    fontSize: 9,
    color: colors.primary,
    lineHeight: 1.35,
  },
  certStatement: {
    borderWidth: 0.75,
    borderColor: "#1a2744",
    backgroundColor: "#f7f8fb",
    padding: 12,
    marginBottom: 16,
  },
  certStatementTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  certStatementBody: {
    fontSize: 9,
    lineHeight: 1.5,
    color: colors.primary,
  },
  certTable: {
    width: "100%",
    borderWidth: 0.75,
    borderColor: "#d0d0d6",
    marginBottom: 12,
  },
  certTableHeader: {
    flexDirection: "row",
    backgroundColor: "#1a2744",
  },
  certTableHeaderCell: {
    padding: 5,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
  },
  certTableRow: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderTopColor: "#e0e0e5",
  },
  certTableCell: {
    padding: 5,
    fontSize: 8,
    color: colors.primary,
  },
  certSignatureBlock: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 28,
  },
  certSignatureField: {
    width: "46%",
  },
  certSigRole: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  certSignaturePad: {
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: "#1a2744",
    justifyContent: "flex-end",
    marginBottom: 4,
    paddingBottom: 2,
  },
  certSigImage: {
    height: 42,
    width: 160,
    objectFit: "contain",
  },
  certSigText: {
    fontSize: 14,
    fontFamily: "Helvetica-Oblique",
    color: colors.primary,
  },
  certSigMeta: {
    fontSize: 8,
    color: colors.muted,
    marginTop: 2,
  },
  certSigName: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginTop: 6,
  },
  certStatusBanner: {
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  certFooter: {
    position: "absolute",
    bottom: 22,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.75,
    borderTopColor: "#d0d0d6",
    paddingTop: 6,
  },
  certFooterText: {
    fontSize: 7,
    color: colors.muted,
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

function fmtDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

function SignatureBlock({
  roleLabel,
  signed,
  name,
  title,
  date,
  signatureText,
  signatureImage,
}: {
  roleLabel: string;
  signed?: boolean;
  name?: string;
  title?: string;
  date?: string;
  signatureText?: string;
  signatureImage?: string | null;
}) {
  const hasImage = !!signatureImage && signatureImage.startsWith("data:image/");
  return (
    <View style={styles.certSignatureField}>
      <Text style={styles.certSigRole}>{roleLabel}</Text>
      <View style={styles.certSignaturePad}>
        {signed && hasImage ? (
          <Image src={signatureImage!} style={styles.certSigImage} />
        ) : signed && (signatureText || name) ? (
          <Text style={styles.certSigText}>{signatureText || name}</Text>
        ) : (
          <Text style={{ fontSize: 8, color: colors.muted }}>Awaiting authorised signature</Text>
        )}
      </View>
      <Text style={styles.certSigMeta}>Authorised electronic signature</Text>
      {signed ? (
        <>
          <Text style={styles.certSigName}>{name || "—"}</Text>
          <Text style={styles.certSigMeta}>{title || roleLabel}</Text>
          <Text style={styles.certSigMeta}>Date signed: {fmtDate(date)}</Text>
        </>
      ) : (
        <>
          <Text style={[styles.certSigName, { color: colors.muted }]}>Name: ________________________</Text>
          <Text style={styles.certSigMeta}>Title: ________________________</Text>
          <Text style={styles.certSigMeta}>Date: ________________________</Text>
        </>
      )}
    </View>
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
  designedBy,
  designDate,
  openDefects = 0,
  openBySeverity = {},
  acceptedCount = 0,
  recommendation,
  exitCriteriaStatus,
  tlSigned,
  tlName,
  tlRole,
  tlDate,
  tlSignature,
  tlSignatureImage,
  boSigned,
  boName,
  boRole,
  boDate,
  boSignature,
  boSignatureImage,
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
  designedBy?: string;
  designDate?: string;
  openDefects?: number;
  openBySeverity?: Record<string, number>;
  acceptedCount?: number;
  /** Formal go-live stance shown to management */
  recommendation?: string;
  /** Exit criteria assessment label */
  exitCriteriaStatus?: string;
  tlSigned?: boolean;
  tlName?: string;
  tlRole?: string;
  tlDate?: string;
  tlSignature?: string;
  tlSignatureImage?: string | null;
  boSigned?: boolean;
  boName?: string;
  boRole?: string;
  boDate?: string;
  boSignature?: string;
  boSignatureImage?: string | null;
  businessDecisions?: SignOffData["businessDecisions"];
  isFullySigned?: boolean;
}) {
  const generatedOn = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const accepted = businessDecisions?.accepted ?? [];
  const waiverCount = acceptedCount || accepted.length;
  const hasConditions = openDefects > 0 || waiverCount > 0;
  const statusColor = isFullySigned ? (hasConditions ? "#b45309" : "#15803d") : "#b45309";
  const statusBg = isFullySigned ? (hasConditions ? "#fffbeb" : "#f0fdf4") : "#fffbeb";
  const statusBorder = isFullySigned ? (hasConditions ? "#fcd34d" : "#86efac") : "#fcd34d";
  const statusLabel = isFullySigned
    ? hasConditions
      ? "ACCEPTED WITH CONDITIONS — SEE RESIDUAL RISK"
      : "FORMALLY ACCEPTED — UAT COMPLETE"
    : "PENDING AUTHORISED SIGNATURES";

  const severityOrder = ["Critical", "Major", "Minor", "Cosmetic", "Unspecified"];
  const severityRows = severityOrder
    .filter((s) => (openBySeverity[s] ?? 0) > 0)
    .map((s) => ({ severity: s, count: openBySeverity[s] ?? 0 }));
  // Include any other severity keys not in the standard list
  for (const [sev, count] of Object.entries(openBySeverity)) {
    if (!severityOrder.includes(sev) && count > 0) {
      severityRows.push({ severity: sev, count });
    }
  }

  const recText =
    recommendation ||
    (isFullySigned
      ? hasConditions
        ? "Accepted with conditions — residual risks and/or open defects are recorded below and in Annex A where applicable."
        : "Accepted — UAT exit criteria confirmed; no open defects or residual waivers at sign-off."
      : "Pending — formal acceptance requires authorised Business Owner and QA / Test Lead signatures.");

  const exitStatusText =
    exitCriteriaStatus ||
    (isFullySigned
      ? hasConditions
        ? "Met with conditions"
        : "Met"
      : "Subject to confirmation by authorised signatories");

  return (
    <Document>
      <Page size="A4" style={styles.certPage}>
        <View style={styles.certTopBar} fixed />

        {/* Document header */}
        <View style={styles.certHeaderRow}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={styles.certDocLabel}>User Acceptance Testing</Text>
            <Text style={styles.certTitle}>Final Sign-Off Certificate</Text>
            <Text style={styles.certSubtitle}>
              Formal acceptance of UAT deliverables for production readiness
            </Text>
          </View>
          <View style={styles.certMetaBox}>
            <Text style={styles.certMetaLabel}>Document ID</Text>
            <Text style={styles.certMetaValue}>UCH-{projectCode}</Text>
            <Text style={styles.certMetaLabel}>Release / Version</Text>
            <Text style={styles.certMetaValue}>v{version || "—"}</Text>
            <Text style={styles.certMetaLabel}>Generated</Text>
            <Text style={styles.certMetaValue}>{generatedOn}</Text>
          </View>
        </View>

        {/* Project identification */}
        <View style={styles.certSection}>
          <Text style={styles.certSectionTitle}>1. Project Identification</Text>
          <View style={styles.certInfoGrid}>
            <View style={styles.certInfoCard}>
              <Text style={styles.certInfoLabel}>Project / Application</Text>
              <Text style={styles.certInfoValue}>{projectName || "—"}</Text>
            </View>
            <View style={styles.certInfoCard}>
              <Text style={styles.certInfoLabel}>Module / Workstream</Text>
              <Text style={styles.certInfoValue}>{moduleName || "—"}</Text>
            </View>
          </View>
          <View style={styles.certInfoGrid}>
            <View style={styles.certInfoCard}>
              <Text style={styles.certInfoLabel}>Prepared By</Text>
              <Text style={styles.certInfoValue}>{designedBy || "—"}</Text>
            </View>
            <View style={styles.certInfoCard}>
              <Text style={styles.certInfoLabel}>Design / Plan Date</Text>
              <Text style={styles.certInfoValue}>{fmtDate(designDate)}</Text>
            </View>
          </View>
        </View>

        {/* Scope of acceptance */}
        <View style={styles.certSection}>
          <Text style={styles.certSectionTitle}>2. Scope of Acceptance</Text>
          <View style={styles.certInfoGrid}>
            <View style={styles.certInfoCard}>
              <Text style={styles.certInfoLabel}>In Scope</Text>
              <Text style={styles.certInfoValue}>{scope?.trim() || "As defined in the approved UAT plan."}</Text>
            </View>
            <View style={styles.certInfoCard}>
              <Text style={styles.certInfoLabel}>Out of Scope</Text>
              <Text style={styles.certInfoValue}>{outOfScope?.trim() || "As defined in the approved UAT plan."}</Text>
            </View>
          </View>
          {objectives?.trim() && (
            <Text style={[styles.certMuted, { marginTop: 4 }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", color: colors.primary }}>Objectives: </Text>
              {objectives}
            </Text>
          )}
          {entryCriteria?.trim() && (
            <Text style={[styles.certMuted, { marginTop: 4 }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", color: colors.primary }}>Entry criteria: </Text>
              {entryCriteria}
            </Text>
          )}
        </View>

        {/* Decision-oriented outcome — not operational KPIs */}
        <View style={styles.certSection}>
          <Text style={styles.certSectionTitle}>3. Exit Criteria, Residual Risk &amp; Recommendation</Text>

          <View style={styles.certInfoCard}>
            <Text style={styles.certInfoLabel}>Exit criteria (from approved UAT plan)</Text>
            <Text style={styles.certInfoValue}>
              {exitCriteria?.trim() || "As defined in the approved UAT plan / project entry-exit criteria."}
            </Text>
            <Text style={[styles.certMuted, { marginTop: 6 }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", color: colors.primary }}>Assessment: </Text>
              {exitStatusText}
            </Text>
          </View>

          <View style={[styles.certTable, { marginTop: 10 }]}>
            <View style={styles.certTableHeader}>
              <Text style={[styles.certTableHeaderCell, { width: "55%" }]}>Residual risk item</Text>
              <Text style={[styles.certTableHeaderCell, { width: "20%" }]}>Count</Text>
              <Text style={[styles.certTableHeaderCell, { width: "25%" }]}>Disposition</Text>
            </View>
            <View style={styles.certTableRow}>
              <Text style={[styles.certTableCell, { width: "55%" }]}>Open defects at sign-off</Text>
              <Text style={[styles.certTableCell, { width: "20%", fontFamily: "Helvetica-Bold" }]}>{openDefects}</Text>
              <Text style={[styles.certTableCell, { width: "25%", color: colors.muted }]}>
                {openDefects === 0 ? "None" : "Carried forward"}
              </Text>
            </View>
            {severityRows.map((row) => (
              <View key={row.severity} style={styles.certTableRow}>
                <Text style={[styles.certTableCell, { width: "55%", paddingLeft: 12 }]}>
                  — {row.severity} severity
                </Text>
                <Text style={[styles.certTableCell, { width: "20%" }]}>{row.count}</Text>
                <Text style={[styles.certTableCell, { width: "25%", color: colors.muted }]}>Open</Text>
              </View>
            ))}
            <View style={styles.certTableRow}>
              <Text style={[styles.certTableCell, { width: "55%" }]}>Accepted / waived defects</Text>
              <Text style={[styles.certTableCell, { width: "20%", fontFamily: "Helvetica-Bold" }]}>{waiverCount}</Text>
              <Text style={[styles.certTableCell, { width: "25%", color: colors.muted }]}>
                {waiverCount === 0 ? "None" : "Annex A"}
              </Text>
            </View>
          </View>

          <View style={[styles.certStatement, { marginTop: 10, marginBottom: 0 }]}>
            <Text style={styles.certStatementTitle}>Management recommendation</Text>
            <Text style={styles.certStatementBody}>{recText}</Text>
          </View>
        </View>

        {/* Formal acceptance statement */}
        <View style={[styles.certStatement, { marginTop: 14 }]}>
          <Text style={styles.certStatementTitle}>4. Declaration of Acceptance</Text>
          <Text style={styles.certStatementBody}>
            By signing below, the undersigned confirm that User Acceptance Testing for the project and module identified
            above has been completed in accordance with the approved UAT plan and exit criteria. The Business Owner
            accepts the system as fit for the intended business purpose, subject to any residual risks explicitly recorded
            in this certificate. The QA / Test Lead confirms that testing was planned, executed, and recorded under
            controlled conditions and that results are available for audit.
          </Text>
          <Text style={[styles.certStatementBody, { marginTop: 6 }]}>
            This certificate constitutes formal business acceptance for the purposes of go-live / production readiness
            decisions. Detailed test evidence remains available in TestCaseHub and associated project records.
          </Text>
        </View>

        {/* Authorised signatures */}
        <View style={styles.certSection}>
          <Text style={styles.certSectionTitle}>5. Authorised Signatures</Text>
          <View style={styles.certSignatureBlock}>
            <SignatureBlock
              roleLabel="Business Owner"
              signed={boSigned}
              name={boName}
              title={boRole}
              date={boDate}
              signatureText={boSignature || boName}
              signatureImage={boSignatureImage}
            />
            <SignatureBlock
              roleLabel="QA / Test Lead"
              signed={tlSigned}
              name={tlName}
              title={tlRole}
              date={tlDate}
              signatureText={tlSignature || tlName}
              signatureImage={tlSignatureImage}
            />
          </View>
        </View>

        {/* Status */}
        <View style={[styles.certStatusBanner, { backgroundColor: statusBg, borderColor: statusBorder }]}>
          <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: statusColor, letterSpacing: 1 }}>
            STATUS: {statusLabel}
          </Text>
        </View>

        <View style={styles.certFooter} fixed>
          <Text style={styles.certFooterText}>TestCaseHub · UAT Final Sign-Off Certificate · UCH-{projectCode}</Text>
          <Text style={styles.certFooterText}>Confidential · For management &amp; audit use</Text>
        </View>
      </Page>

      {/* Annex — accepted residual risks (only when present) */}
      {accepted.length > 0 && (
        <Page size="A4" style={styles.certPage}>
          <View style={styles.certTopBar} fixed />
          <View style={styles.certHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.certDocLabel}>Annex A</Text>
              <Text style={styles.certTitle}>Accepted Residual Risks &amp; Waivers</Text>
              <Text style={styles.certSubtitle}>
                Defects accepted by the Business Owner and carried as known residual risk
              </Text>
            </View>
            <View style={styles.certMetaBox}>
              <Text style={styles.certMetaLabel}>Document ID</Text>
              <Text style={styles.certMetaValue}>UCH-{projectCode}</Text>
              <Text style={styles.certMetaLabel}>Items</Text>
              <Text style={styles.certMetaValue}>{accepted.length}</Text>
            </View>
          </View>

          <View style={styles.certTable}>
            <View style={styles.certTableHeader}>
              <Text style={[styles.certTableHeaderCell, { width: "12%" }]}>ID</Text>
              <Text style={[styles.certTableHeaderCell, { width: "12%" }]}>Severity</Text>
              <Text style={[styles.certTableHeaderCell, { width: "14%" }]}>Type</Text>
              <Text style={[styles.certTableHeaderCell, { width: "28%" }]}>Test Case</Text>
              <Text style={[styles.certTableHeaderCell, { width: "34%" }]}>Justification / Decision</Text>
            </View>
            {accepted.map((d) => (
              <View key={d.defectId} style={styles.certTableRow} wrap={false}>
                <Text style={[styles.certTableCell, { width: "12%" }]}>
                  {d.bugNumber != null ? `BUG-${d.bugNumber}` : `DEF-${d.defectId}`}
                </Text>
                <Text style={[styles.certTableCell, { width: "12%" }]}>{d.severity}</Text>
                <Text style={[styles.certTableCell, { width: "14%" }]}>
                  {d.decisionType === "risk_waiver" ? "Risk Waiver" : "Biz Review"}
                </Text>
                <Text style={[styles.certTableCell, { width: "28%" }]}>{d.testCaseName || "—"}</Text>
                <Text style={[styles.certTableCell, { width: "34%" }]}>{d.justification || "—"}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.certMuted, { marginTop: 10 }]}>
            Each decision is immutably recorded in the project audit log. Acceptance of residual risk does not waive
            future remediation obligations unless expressly stated in the justification.
          </Text>

          <View style={styles.certFooter} fixed>
            <Text style={styles.certFooterText}>TestCaseHub · Annex A — Residual Risks · UCH-{projectCode}</Text>
            <Text style={styles.certFooterText}>Confidential · For management &amp; audit use</Text>
          </View>
        </Page>
      )}
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

// ─────────────────────────────────────────────────────────────────────────────
// Defect Log PDFs — rolled-up board report + Test Lead historical tracking
// ─────────────────────────────────────────────────────────────────────────────

const defRpt = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1b1b1d",
    backgroundColor: "#ffffff",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: "#1a2744",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: "#1a2744",
  },
  docLabel: {
    fontSize: 8,
    color: "#45464d",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 9,
    color: "#45464d",
  },
  metaBox: { alignItems: "flex-end" },
  metaLabel: {
    fontSize: 7,
    color: "#45464d",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 1,
  },
  metaValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1b1b1d",
    marginBottom: 5,
  },
  summaryStrip: {
    flexDirection: "row",
    borderWidth: 0.75,
    borderColor: "#d0d0d6",
    marginBottom: 14,
  },
  summaryCell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRightWidth: 0.5,
    borderRightColor: "#e0e0e5",
    alignItems: "center",
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
  },
  summaryLabel: {
    fontSize: 7,
    color: "#45464d",
    marginTop: 2,
    textAlign: "center",
  },
  scenarioHeader: {
    backgroundColor: "#1a2744",
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scenarioTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    flex: 1,
  },
  scenarioCount: {
    fontSize: 8,
    color: "rgba(255,255,255,0.75)",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#eef0f5",
    borderLeftWidth: 0.75,
    borderRightWidth: 0.75,
    borderBottomWidth: 0.75,
    borderColor: "#d0d0d6",
  },
  tableHeaderCell: {
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    borderLeftWidth: 0.75,
    borderRightWidth: 0.75,
    borderBottomWidth: 0.5,
    borderColor: "#e0e0e5",
    minHeight: 18,
  },
  tableRowAlt: {
    backgroundColor: "#fafafa",
  },
  tableCell: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontSize: 7.5,
    color: "#1b1b1d",
  },
  muted: { color: "#45464d" },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.75,
    borderTopColor: "#d0d0d6",
    paddingTop: 5,
  },
  footerText: { fontSize: 7, color: "#45464d" },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 12,
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: "#d0d0d6",
  },
  infoGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  infoCard: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: "#d0d0d6",
    padding: 7,
    backgroundColor: "#fafafa",
  },
  infoLabel: {
    fontSize: 7,
    color: "#45464d",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 8.5,
    color: "#1b1b1d",
    lineHeight: 1.35,
  },
  timelineHeader: {
    flexDirection: "row",
    backgroundColor: "#1a2744",
  },
  timelineHeaderCell: {
    padding: 5,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  timelineRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e0e0e5",
    borderLeftWidth: 0.75,
    borderRightWidth: 0.75,
    borderColor: "#d0d0d6",
  },
  timelineCell: {
    padding: 5,
    fontSize: 7.5,
    color: "#1b1b1d",
  },
  noteBlock: {
    borderWidth: 0.75,
    borderColor: "#e0e0e5",
    padding: 7,
    marginBottom: 5,
    backgroundColor: "#fafafa",
  },
  filterNote: {
    fontSize: 8,
    color: "#45464d",
    marginBottom: 10,
    fontStyle: "italic",
  },
});

function fmtShortDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

function fmtDateTime(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function prettyStatus(status?: string | null) {
  if (!status) return "—";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type DefectLogReportRow = {
  id: number;
  bug_number?: number | null;
  status: string;
  severity?: string | null;
  priority?: string | null;
  is_blocked?: boolean;
  blocked_reason?: string | null;
  regression_index?: number;
  created_at: string;
  tester_notes?: string | null;
  case_number?: string | null;
  case_title?: string | null;
  scenario_code?: string | null;
  scenario_name?: string | null;
  developer_name?: string | null;
  origin_run_name?: string | null;
  origin_run_id?: number | null;
};

export type DefectLogScenarioGroup = {
  key: string;
  label: string;
  defects: DefectLogReportRow[];
};

export function DefectLogRolledUpPDF({
  projectName,
  projectCode,
  preparedBy,
  filterSummary,
  groups,
  includeLeadFields,
  totalDefects,
}: {
  projectName: string;
  projectCode?: string;
  preparedBy?: string | null;
  filterSummary?: string | null;
  groups: DefectLogScenarioGroup[];
  /** When true (Test Lead / Admin), include Developer + Originating Test Run columns */
  includeLeadFields: boolean;
  totalDefects: number;
}) {
  const generatedOn = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const critical = groups.reduce(
    (n, g) => n + g.defects.filter((d) => d.severity === "Critical").length,
    0,
  );
  const open = groups.reduce(
    (n, g) =>
      n +
      g.defects.filter(
        (d) => !["CLOSED", "PASSED_BY_AGREEMENT", "REJECTED", "DUPLICATE"].includes(d.status),
      ).length,
    0,
  );
  const blocked = groups.reduce((n, g) => n + g.defects.filter((d) => d.is_blocked).length, 0);

  // Column widths depend on whether lead-only fields are shown
  const cols = includeLeadFields
    ? {
        id: "8%",
        tc: "18%",
        sev: "8%",
        pri: "6%",
        status: "14%",
        created: "10%",
        dev: "14%",
        run: "22%",
      }
    : {
        id: "10%",
        tc: "32%",
        sev: "10%",
        pri: "8%",
        status: "22%",
        created: "18%",
        dev: "0%",
        run: "0%",
      };

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={defRpt.page}>
        <View style={defRpt.topBar} fixed />

        <View style={defRpt.headerRow}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={defRpt.docLabel}>Defect Management</Text>
            <Text style={defRpt.title}>Defect Log — Rolled-Up Report</Text>
            <Text style={defRpt.subtitle}>
              Test-case level register, grouped by test scenario
            </Text>
          </View>
          <View style={defRpt.metaBox}>
            <Text style={defRpt.metaLabel}>Project</Text>
            <Text style={defRpt.metaValue}>{projectName || "—"}</Text>
            {projectCode ? (
              <>
                <Text style={defRpt.metaLabel}>Document ID</Text>
                <Text style={defRpt.metaValue}>UCH-{projectCode}-DEF</Text>
              </>
            ) : null}
            <Text style={defRpt.metaLabel}>Generated</Text>
            <Text style={defRpt.metaValue}>{generatedOn}</Text>
            {preparedBy ? (
              <>
                <Text style={defRpt.metaLabel}>Prepared By</Text>
                <Text style={defRpt.metaValue}>{preparedBy}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={defRpt.summaryStrip}>
          <View style={defRpt.summaryCell}>
            <Text style={defRpt.summaryValue}>{totalDefects}</Text>
            <Text style={defRpt.summaryLabel}>Defects in report</Text>
          </View>
          <View style={defRpt.summaryCell}>
            <Text style={defRpt.summaryValue}>{groups.length}</Text>
            <Text style={defRpt.summaryLabel}>Scenarios</Text>
          </View>
          <View style={defRpt.summaryCell}>
            <Text style={defRpt.summaryValue}>{open}</Text>
            <Text style={defRpt.summaryLabel}>Open</Text>
          </View>
          <View style={defRpt.summaryCell}>
            <Text style={defRpt.summaryValue}>{critical}</Text>
            <Text style={defRpt.summaryLabel}>Critical</Text>
          </View>
          <View style={[defRpt.summaryCell, { borderRightWidth: 0 }]}>
            <Text style={defRpt.summaryValue}>{blocked}</Text>
            <Text style={defRpt.summaryLabel}>Blocked</Text>
          </View>
        </View>

        {filterSummary ? (
          <Text style={defRpt.filterNote}>Filters applied: {filterSummary}</Text>
        ) : null}

        {groups.length === 0 ? (
          <Text style={defRpt.muted}>No defects match the current filters.</Text>
        ) : (
          groups.map((group) => (
            <View key={group.key} wrap={false}>
              <View style={defRpt.scenarioHeader}>
                <Text style={defRpt.scenarioTitle}>{group.label}</Text>
                <Text style={defRpt.scenarioCount}>
                  {group.defects.length} defect{group.defects.length === 1 ? "" : "s"}
                </Text>
              </View>
              <View style={defRpt.tableHeader}>
                <Text style={[defRpt.tableHeaderCell, { width: cols.id }]}>ID</Text>
                <Text style={[defRpt.tableHeaderCell, { width: cols.tc }]}>Test Case</Text>
                <Text style={[defRpt.tableHeaderCell, { width: cols.sev }]}>Sev</Text>
                <Text style={[defRpt.tableHeaderCell, { width: cols.pri }]}>Pri</Text>
                <Text style={[defRpt.tableHeaderCell, { width: cols.status }]}>Status</Text>
                <Text style={[defRpt.tableHeaderCell, { width: cols.created }]}>Created</Text>
                {includeLeadFields && (
                  <>
                    <Text style={[defRpt.tableHeaderCell, { width: cols.dev }]}>Developer</Text>
                    <Text style={[defRpt.tableHeaderCell, { width: cols.run }]}>Originating Run</Text>
                  </>
                )}
              </View>
              {group.defects.map((d, i) => {
                const statusLabel = d.is_blocked
                  ? `Blocked${d.blocked_reason ? `: ${d.blocked_reason}` : ""}`
                  : prettyStatus(d.status);
                return (
                  <View
                    key={d.id}
                    style={[defRpt.tableRow, i % 2 === 1 ? defRpt.tableRowAlt : {}]}
                    wrap={false}
                  >
                    <Text style={[defRpt.tableCell, { width: cols.id, fontFamily: "Helvetica-Bold", color: "#1a2744" }]}>
                      DEF-{d.id}
                      {d.bug_number != null ? `\nBUG-${d.bug_number}` : ""}
                    </Text>
                    <Text style={[defRpt.tableCell, { width: cols.tc }]}>
                      {d.case_number ? `[${d.case_number}] ` : ""}
                      {d.case_title || "—"}
                      {(d.regression_index ?? 0) > 0 ? `  (REJ×${d.regression_index})` : ""}
                    </Text>
                    <Text
                      style={[
                        defRpt.tableCell,
                        {
                          width: cols.sev,
                          color:
                            d.severity === "Critical"
                              ? "#b91c1c"
                              : d.severity === "Major"
                                ? "#b45309"
                                : "#1b1b1d",
                          fontFamily: "Helvetica-Bold",
                        },
                      ]}
                    >
                      {d.severity || "—"}
                    </Text>
                    <Text style={[defRpt.tableCell, { width: cols.pri }]}>{d.priority || "—"}</Text>
                    <Text style={[defRpt.tableCell, { width: cols.status }]}>{statusLabel}</Text>
                    <Text style={[defRpt.tableCell, { width: cols.created }]}>
                      {fmtShortDate(d.created_at)}
                    </Text>
                    {includeLeadFields && (
                      <>
                        <Text style={[defRpt.tableCell, { width: cols.dev }]}>
                          {d.developer_name || "—"}
                        </Text>
                        <Text style={[defRpt.tableCell, { width: cols.run }]}>
                          {d.origin_run_name
                            ? d.origin_run_name
                            : d.origin_run_id
                              ? `Run #${d.origin_run_id}`
                              : "—"}
                        </Text>
                      </>
                    )}
                  </View>
                );
              })}
            </View>
          ))
        )}

        <View style={defRpt.footer} fixed>
          <Text style={defRpt.footerText}>
            TestCaseHub · Defect Log (Rolled-Up){projectCode ? ` · UCH-${projectCode}` : ""} · Confidential
          </Text>
          <Text
            style={defRpt.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

export type DefectTrackingAuditEntry = {
  changed_at: string;
  from_status?: string | null;
  to_status?: string | null;
  reason?: string | null;
  justification?: string | null;
  changed_by_name?: string | null;
};

export type DefectTrackingNote = {
  created_at: string;
  note: string;
  is_system_note?: boolean;
  is_internal?: boolean;
  added_by_name?: string | null;
};

export function DefectHistoricalTrackingPDF({
  projectName,
  projectCode,
  preparedBy,
  defect,
}: {
  projectName: string;
  projectCode?: string;
  preparedBy?: string | null;
  defect: {
    id: number;
    bug_number?: number | null;
    status: string;
    severity?: string | null;
    priority?: string | null;
    is_blocked?: boolean;
    blocked_reason?: string | null;
    regression_index?: number;
    created_at: string;
    updated_at?: string | null;
    resolved_at?: string | null;
    closed_at?: string | null;
    tester_notes?: string | null;
    support_ticket_number?: string | null;
    root_cause_category?: string | null;
    case_number?: string | null;
    case_title?: string | null;
    scenario_code?: string | null;
    scenario_name?: string | null;
    developer_name?: string | null;
    origin_run_name?: string | null;
    origin_run_id?: number | null;
    tester_name?: string | null;
    auditTrail: DefectTrackingAuditEntry[];
    notes: DefectTrackingNote[];
  };
}) {
  const generatedOn = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const audit = [...(defect.auditTrail ?? [])].sort(
    (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime(),
  );
  const notes = [...(defect.notes ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  return (
    <Document>
      <Page size="A4" style={defRpt.page}>
        <View style={defRpt.topBar} fixed />

        <View style={defRpt.headerRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={defRpt.docLabel}>Defect Management · Audit Trail</Text>
            <Text style={defRpt.title}>
              Historical Tracking Report — DEF-{defect.id}
              {defect.bug_number != null ? ` / BUG-${defect.bug_number}` : ""}
            </Text>
            <Text style={defRpt.subtitle}>
              Full lifecycle audit for management and compliance review
            </Text>
          </View>
          <View style={defRpt.metaBox}>
            <Text style={defRpt.metaLabel}>Project</Text>
            <Text style={defRpt.metaValue}>{projectName || "—"}</Text>
            {projectCode ? (
              <>
                <Text style={defRpt.metaLabel}>Document ID</Text>
                <Text style={defRpt.metaValue}>UCH-{projectCode}-DEF-{defect.id}</Text>
              </>
            ) : null}
            <Text style={defRpt.metaLabel}>Generated</Text>
            <Text style={defRpt.metaValue}>{generatedOn}</Text>
            {preparedBy ? (
              <>
                <Text style={defRpt.metaLabel}>Prepared By</Text>
                <Text style={defRpt.metaValue}>{preparedBy}</Text>
              </>
            ) : null}
          </View>
        </View>

        <Text style={defRpt.sectionTitle}>1. Defect Identification</Text>
        <View style={defRpt.infoGrid}>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Current Status</Text>
            <Text style={defRpt.infoValue}>
              {defect.is_blocked ? "Blocked" : prettyStatus(defect.status)}
              {defect.is_blocked && defect.blocked_reason ? ` — ${defect.blocked_reason}` : ""}
            </Text>
          </View>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Severity / Priority</Text>
            <Text style={defRpt.infoValue}>
              {defect.severity || "—"} / {defect.priority || "—"}
            </Text>
          </View>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Regressions</Text>
            <Text style={defRpt.infoValue}>{defect.regression_index ?? 0}</Text>
          </View>
        </View>
        <View style={defRpt.infoGrid}>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Test Scenario</Text>
            <Text style={defRpt.infoValue}>
              {defect.scenario_code
                ? `${defect.scenario_code} — ${defect.scenario_name || ""}`
                : defect.scenario_name || "—"}
            </Text>
          </View>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Test Case</Text>
            <Text style={defRpt.infoValue}>
              {defect.case_number ? `[${defect.case_number}] ` : ""}
              {defect.case_title || "—"}
            </Text>
          </View>
        </View>
        <View style={defRpt.infoGrid}>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Assigned Developer</Text>
            <Text style={defRpt.infoValue}>{defect.developer_name || "—"}</Text>
          </View>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Originating Test Run</Text>
            <Text style={defRpt.infoValue}>
              {defect.origin_run_name ||
                (defect.origin_run_id ? `Run #${defect.origin_run_id}` : "—")}
            </Text>
          </View>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Reported By (Tester)</Text>
            <Text style={defRpt.infoValue}>{defect.tester_name || "—"}</Text>
          </View>
        </View>
        <View style={defRpt.infoGrid}>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Created</Text>
            <Text style={defRpt.infoValue}>{fmtDateTime(defect.created_at)}</Text>
          </View>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Resolved</Text>
            <Text style={defRpt.infoValue}>{fmtDateTime(defect.resolved_at)}</Text>
          </View>
          <View style={defRpt.infoCard}>
            <Text style={defRpt.infoLabel}>Closed</Text>
            <Text style={defRpt.infoValue}>{fmtDateTime(defect.closed_at)}</Text>
          </View>
        </View>
        {(defect.support_ticket_number || defect.root_cause_category) && (
          <View style={defRpt.infoGrid}>
            <View style={defRpt.infoCard}>
              <Text style={defRpt.infoLabel}>Support Ticket</Text>
              <Text style={defRpt.infoValue}>{defect.support_ticket_number || "—"}</Text>
            </View>
            <View style={defRpt.infoCard}>
              <Text style={defRpt.infoLabel}>Root Cause Category</Text>
              <Text style={defRpt.infoValue}>{defect.root_cause_category || "—"}</Text>
            </View>
          </View>
        )}
        {defect.tester_notes ? (
          <View style={[defRpt.infoCard, { marginBottom: 6 }]}>
            <Text style={defRpt.infoLabel}>Original Tester Notes</Text>
            <Text style={defRpt.infoValue}>{defect.tester_notes}</Text>
          </View>
        ) : null}

        <Text style={defRpt.sectionTitle}>2. Status Audit Trail</Text>
        {audit.length === 0 ? (
          <Text style={defRpt.muted}>No status transitions recorded for this defect.</Text>
        ) : (
          <View>
            <View style={defRpt.timelineHeader}>
              <Text style={[defRpt.timelineHeaderCell, { width: "18%" }]}>Date / Time</Text>
              <Text style={[defRpt.timelineHeaderCell, { width: "16%" }]}>From</Text>
              <Text style={[defRpt.timelineHeaderCell, { width: "16%" }]}>To</Text>
              <Text style={[defRpt.timelineHeaderCell, { width: "18%" }]}>Changed By</Text>
              <Text style={[defRpt.timelineHeaderCell, { width: "32%" }]}>Reason / Justification</Text>
            </View>
            {audit.map((entry, i) => (
              <View
                key={`${entry.changed_at}-${i}`}
                style={[defRpt.timelineRow, i % 2 === 1 ? { backgroundColor: "#fafafa" } : {}]}
                wrap={false}
              >
                <Text style={[defRpt.timelineCell, { width: "18%" }]}>
                  {fmtDateTime(entry.changed_at)}
                </Text>
                <Text style={[defRpt.timelineCell, { width: "16%" }]}>
                  {prettyStatus(entry.from_status)}
                </Text>
                <Text style={[defRpt.timelineCell, { width: "16%", fontFamily: "Helvetica-Bold" }]}>
                  {prettyStatus(entry.to_status)}
                </Text>
                <Text style={[defRpt.timelineCell, { width: "18%" }]}>
                  {entry.changed_by_name || "—"}
                </Text>
                <Text style={[defRpt.timelineCell, { width: "32%", color: "#45464d" }]}>
                  {[entry.reason, entry.justification].filter(Boolean).join(" · ") || "—"}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={defRpt.sectionTitle}>3. Notes &amp; Commentary</Text>
        {notes.length === 0 ? (
          <Text style={defRpt.muted}>No notes recorded against this defect.</Text>
        ) : (
          notes.map((n, i) => (
            <View key={`${n.created_at}-${i}`} style={defRpt.noteBlock} wrap={false}>
              <Text style={{ fontSize: 7, color: "#45464d", marginBottom: 3 }}>
                {fmtDateTime(n.created_at)}
                {" · "}
                {n.added_by_name || (n.is_system_note ? "System" : "—")}
                {n.is_system_note ? " · System note" : ""}
                {n.is_internal ? " · Internal" : ""}
              </Text>
              <Text style={{ fontSize: 8, lineHeight: 1.4 }}>{n.note}</Text>
            </View>
          ))
        )}

        <View style={defRpt.footer} fixed>
          <Text style={defRpt.footerText}>
            TestCaseHub · Historical Tracking · DEF-{defect.id}
            {projectCode ? ` · UCH-${projectCode}` : ""} · Confidential · Test Lead
          </Text>
          <Text
            style={defRpt.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
