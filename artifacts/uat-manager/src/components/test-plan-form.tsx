import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Field, inputBaseClass, inputInvalidClass, inputValidClass } from "./ui/field";
import { Textarea } from "./ui/textarea";
import { Select } from "./ui/select";
import { Stepper, type Step } from "./ui/stepper";
import { FormSection } from "./ui/form-section";
import { SlideOver } from "./ui/slide-over";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import type { Project, User } from "../types/api";

export interface DraftStep {
  instruction: string;
  testData: string;
  expectedResult: string;
}

export interface DraftTestCase {
  caseNumber: string;
  title: string;
  precondition: string;
  steps: DraftStep[];
}

export interface DraftScenario {
  code: string;
  name: string;
  testCases: DraftTestCase[];
}

export interface TestPlanFormData {
  name: string;
  moduleName: string;
  testLink: string;
  designedBy: string;
  designDate: string;
  testLeadId: number | null;
  objectives: string;
  scope: string;
  outOfScope: string;
  entryCriteria: string;
  exitCriteria: string;
  /** Create mode only — optional initial plan structure */
  structure?: DraftScenario[];
}

interface TestPlanFormProps {
  mode: "create" | "edit";
  open: boolean;
  onClose: () => void;
  onSave: (data: TestPlanFormData) => void;
  saving: boolean;
  initial?: Project;
}

const CREATE_STEPS: Step[] = [
  { key: "overview", label: "Overview" },
  { key: "team", label: "Team & Timeline" },
  { key: "scope", label: "Scope & Criteria" },
  { key: "structure", label: "Structure" },
  { key: "review", label: "Review" },
];

const EDIT_STEPS: Step[] = [
  { key: "overview", label: "Overview" },
  { key: "team", label: "Team & Timeline" },
  { key: "scope", label: "Scope & Criteria" },
  { key: "review", label: "Review" },
];

function emptyScenario(index: number): DraftScenario {
  return {
    code: `UC-${String(index + 1).padStart(2, "0")}`,
    name: "",
    testCases: [
      {
        caseNumber: "1",
        title: "",
        precondition: "",
        steps: [{ instruction: "", testData: "", expectedResult: "" }],
      },
    ],
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function makeEmpty(): TestPlanFormData {
  return {
    name: "",
    moduleName: "",
    testLink: "",
    designedBy: "",
    designDate: todayIso(),
    testLeadId: null,
    objectives: "",
    scope: "",
    outOfScope: "",
    entryCriteria: "",
    exitCriteria: "",
  };
}

function fromProject(p: Project): TestPlanFormData {
  return {
    name: p.name,
    moduleName: p.module_name,
    testLink: p.test_link ?? "",
    designedBy: p.designed_by,
    designDate: p.design_date,
    testLeadId: p.test_lead_id,
    objectives: p.objectives ?? "",
    scope: p.scope ?? "",
    outOfScope: p.out_of_scope ?? "",
    entryCriteria: p.entry_criteria ?? "",
    exitCriteria: p.exit_criteria ?? "",
  };
}

type FormErrors = Partial<Record<keyof TestPlanFormData, string>>;

export function TestPlanForm({
  mode,
  open,
  onClose,
  onSave,
  saving,
  initial,
}: TestPlanFormProps) {
  const currentUser = getStoredUser();
  const steps = mode === "create" ? CREATE_STEPS : EDIT_STEPS;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<TestPlanFormData>(() =>
    mode === "edit" && initial ? fromProject(initial) : makeEmpty()
  );
  const [structure, setStructure] = useState<DraftScenario[]>([]);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [completed, setCompleted] = useState<number[]>([]);

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => customFetch<User[]>("/users"),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep(0);
      setErrors({});
      setStructureError(null);
      setCompleted([]);
      setStructure([]);
      setForm(
        mode === "edit" && initial
          ? fromProject(initial)
          : { ...makeEmpty(), testLeadId: currentUser?.userId ?? null }
      );
    }
  }, [open, mode, initial, currentUser?.userId]);

  const set = <K extends keyof TestPlanFormData>(
    key: K,
    value: TestPlanFormData[K]
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const activeUsers = useMemo(
    () => (users ?? []).filter((u) => u.is_active),
    [users]
  );

  /** Map create-step index to validation domain */
  const validateStep = (s: number): FormErrors => {
    const errs: FormErrors = {};
    const key = steps[s]?.key;
    if (key === "overview") {
      if (!form.name.trim()) errs.name = "Project name is required";
      if (!form.moduleName.trim()) errs.moduleName = "Module is required";
      if (form.testLink.trim() && !/^https?:\/\/\S+$/i.test(form.testLink.trim())) {
        errs.testLink = "Enter a valid URL (http:// or https://)";
      }
    } else if (key === "team") {
      if (!form.designedBy.trim()) errs.designedBy = "Designer name is required";
      if (!form.designDate) errs.designDate = "Design date is required";
      if (mode === "create" && form.testLeadId == null) {
        errs.testLeadId = "Test lead is required";
      }
    } else if (key === "structure") {
      const msg = validateStructure(structure);
      if (msg) setStructureError(msg);
      else setStructureError(null);
    }
    return errs;
  };

  const handleNext = () => {
    const errs = validateStep(step);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (steps[step]?.key === "structure") {
      const msg = validateStructure(structure);
      if (msg) {
        setStructureError(msg);
        return;
      }
      setStructureError(null);
    }
    setCompleted((c) => (c.includes(step) ? c : [...c, step]));
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const handleBack = () => {
    setErrors({});
    setStructureError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleStepClick = (idx: number) => {
    if (idx <= step || completed.includes(idx)) {
      setErrors({});
      setStructureError(null);
      setStep(idx);
    }
  };

  const handleSubmit = () => {
    for (let s = 0; s < steps.length - 1; s++) {
      const errs = validateStep(s);
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        setStep(s);
        return;
      }
      if (steps[s]?.key === "structure") {
        const msg = validateStructure(structure);
        if (msg) {
          setStructureError(msg);
          setStep(s);
          return;
        }
      }
    }
    const payload: TestPlanFormData = {
      ...form,
      ...(mode === "create" && structure.length > 0
        ? { structure: structure.filter(hasMeaningfulScenario) }
        : {}),
    };
    onSave(payload);
  };

  const title = mode === "create" ? "Create Test Plan" : "Edit Test Plan";
  const subtitle =
    mode === "create"
      ? "Define scope, ownership, criteria, and optionally seed scenarios, cases, and steps."
      : "Update this test plan's metadata. The project code cannot be changed.";
  const submitLabel =
    mode === "create"
      ? structure.filter(hasMeaningfulScenario).length > 0
        ? "Create Plan & Structure"
        : "Create Project"
      : "Save Changes";
  const submittingLabel = mode === "create" ? "Creating..." : "Saving...";

  const currentKey = steps[step]?.key;

  return (
    <SlideOver open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="p-lg space-y-lg">
        <Stepper
          steps={steps}
          currentIndex={step}
          completedIndices={completed}
          onStepClick={handleStepClick}
        />

        <div className="min-h-[360px]">
          {currentKey === "overview" && (
            <OverviewStep form={form} errors={errors} set={set} />
          )}
          {currentKey === "team" && (
            <TeamStep
              form={form}
              errors={errors}
              set={set}
              users={activeUsers}
              allowNullLead={mode === "edit"}
            />
          )}
          {currentKey === "scope" && <ScopeStep form={form} errors={errors} set={set} />}
          {currentKey === "structure" && (
            <StructureStep
              structure={structure}
              setStructure={setStructure}
              error={structureError}
            />
          )}
          {currentKey === "review" && (
            <ReviewStep
              form={form}
              users={activeUsers}
              projectCode={initial?.project_code}
              onJumpToStep={handleStepClick}
              structure={mode === "create" ? structure : undefined}
              isCreate={mode === "create"}
            />
          )}
        </div>
      </div>

      <div className="sticky bottom-0 px-lg py-md border-t border-outline-variant bg-surface flex items-center justify-between gap-md">
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <div className="flex items-center gap-sm">
          {step > 0 && (
            <Button variant="secondary" onClick={handleBack} disabled={saving}>
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back
            </Button>
          )}
          {step < steps.length - 1 ? (
            <Button variant="primary" onClick={handleNext} disabled={saving}>
              Continue
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Button>
          ) : (
            <Button variant="primary" onClick={handleSubmit} loading={saving}>
              {saving ? submittingLabel : submitLabel}
            </Button>
          )}
        </div>
      </div>
    </SlideOver>
  );
}

function hasMeaningfulScenario(s: DraftScenario): boolean {
  if (!s.code.trim() || !s.name.trim()) return false;
  return s.testCases.some(
    (tc) =>
      tc.caseNumber.trim() &&
      tc.title.trim() &&
      tc.steps.some((st) => st.instruction.trim())
  );
}

/** Empty structure is allowed (skip). Partial/invalid rows must be fixed or removed. */
function validateStructure(structure: DraftScenario[]): string | null {
  if (structure.length === 0) return null;
  for (const s of structure) {
    const empty =
      !s.code.trim() &&
      !s.name.trim() &&
      s.testCases.every(
        (tc) =>
          !tc.caseNumber.trim() &&
          !tc.title.trim() &&
          tc.steps.every((st) => !st.instruction.trim())
      );
    if (empty) continue;
    if (!s.code.trim() || !s.name.trim()) {
      return "Each scenario needs a code and name (or remove empty scenarios).";
    }
    const meaningful = s.testCases.filter(
      (tc) => tc.caseNumber.trim() || tc.title.trim() || tc.steps.some((st) => st.instruction.trim())
    );
    if (meaningful.length === 0) {
      return `Scenario ${s.code || "?"} needs at least one test case with a step.`;
    }
    for (const tc of meaningful) {
      if (!tc.caseNumber.trim() || !tc.title.trim()) {
        return `Scenario ${s.code}: each test case needs a number and title.`;
      }
      if (!tc.steps.some((st) => st.instruction.trim())) {
        return `Scenario ${s.code}, case ${tc.caseNumber}: add at least one step instruction.`;
      }
    }
  }
  return null;
}

/* ───────────── Step 1: Overview ───────────── */

function OverviewStep({
  form,
  errors,
  set,
}: {
  form: TestPlanFormData;
  errors: FormErrors;
  set: <K extends keyof TestPlanFormData>(
    key: K,
    value: TestPlanFormData[K]
  ) => void;
}) {
  return (
    <FormSection
      title="Overview"
      description="Tell us what this test plan is for. The project code is generated automatically."
    >
      <Field
        label="Project Name"
        required
        htmlFor="tp-name"
        error={errors.name}
        helper="A short, recognisable name shown in lists and reports."
      >
        <input
          id="tp-name"
          type="text"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Q4 Mobile Banking UAT"
          className={`${inputBaseClass} text-title-sm font-title-sm ${
            errors.name ? inputInvalidClass : inputValidClass
          }`}
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
        <Field
          label="Module"
          required
          htmlFor="tp-module"
          error={errors.moduleName}
          helper="Feature, epic, or component under test."
        >
          <input
            id="tp-module"
            type="text"
            value={form.moduleName}
            onChange={(e) => set("moduleName", e.target.value)}
            placeholder="e.g. Mobile App"
            className={`${inputBaseClass} ${
              errors.moduleName ? inputInvalidClass : inputValidClass
            }`}
          />
        </Field>

        <Field
          label="Test Link"
          htmlFor="tp-link"
          error={errors.testLink}
          helper="Optional. Link to Jira, ticket, or build under test."
        >
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
              link
            </span>
            <input
              id="tp-link"
              type="url"
              value={form.testLink}
              onChange={(e) => set("testLink", e.target.value)}
              placeholder="https://..."
              className={`${inputBaseClass} pl-10 ${
                errors.testLink ? inputInvalidClass : inputValidClass
              }`}
            />
          </div>
        </Field>
      </div>
    </FormSection>
  );
}

/* ───────────── Step 2: Team & Timeline ───────────── */

function TeamStep({
  form,
  errors,
  set,
  users,
  allowNullLead,
}: {
  form: TestPlanFormData;
  errors: FormErrors;
  set: <K extends keyof TestPlanFormData>(
    key: K,
    value: TestPlanFormData[K]
  ) => void;
  users: User[];
  allowNullLead: boolean;
}) {
  return (
    <FormSection
      title="Team & Timeline"
      description="Who owns this test plan and when was it designed."
    >
      <Field
        label="Designed By"
        required
        htmlFor="tp-designed-by"
        error={errors.designedBy}
        helper="The person who wrote this test plan."
      >
        <input
          id="tp-designed-by"
          type="text"
          value={form.designedBy}
          onChange={(e) => set("designedBy", e.target.value)}
          placeholder="Full name"
          className={`${inputBaseClass} ${
            errors.designedBy ? inputInvalidClass : inputValidClass
          }`}
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
        <Field
          label="Design Date"
          required
          htmlFor="tp-design-date"
          error={errors.designDate}
        >
          <input
            id="tp-design-date"
            type="date"
            value={form.designDate}
            onChange={(e) => set("designDate", e.target.value)}
            className={`${inputBaseClass} ${
              errors.designDate ? inputInvalidClass : inputValidClass
            }`}
          />
        </Field>

        <Field
          label="Test Lead"
          required={!allowNullLead}
          htmlFor="tp-test-lead"
          error={errors.testLeadId}
          helper="The user accountable for executing this test plan."
        >
          <Select
            id="tp-test-lead"
            value={form.testLeadId == null ? "" : String(form.testLeadId)}
            onChange={(e) =>
              set("testLeadId", e.target.value ? Number(e.target.value) : null)
            }
            invalid={!!errors.testLeadId}
          >
            {allowNullLead && <option value="">No test lead</option>}
            <option value="" disabled={!allowNullLead}>
              Select a user...
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.username})
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </FormSection>
  );
}

/* ───────────── Expandable Field ───────────── */

function ExpandableField({
  label,
  value,
  onChange,
  placeholder,
  rows,
  helper,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows: number;
  helper: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleOpen = () => {
    setDraft(value);
    setOpen(true);
  };

  const handleDone = () => {
    onChange(draft);
    setOpen(false);
  };

  return (
    <>
      <div className="relative group cursor-pointer" onClick={handleOpen}>
        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="material-symbols-outlined text-[18px] text-secondary">fullscreen</span>
        </div>
        <Textarea
          rows={rows}
          value={value}
          readOnly
          placeholder={placeholder}
          className="cursor-pointer pointer-events-none"
        />
      </div>
      <p className="text-label-sm text-on-surface-variant">{helper}</p>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-md"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] mx-4 p-lg flex flex-col gap-md">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="font-headline-sm text-headline-sm text-primary">{label}</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              className="w-full flex-1 min-h-[50vh] p-md rounded-lg border border-outline-variant bg-surface text-body-sm text-on-surface placeholder:text-on-surface-variant/40 resize-none focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary"
            />
            <div className="flex items-center justify-end gap-sm shrink-0">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleDone}>
                <span className="material-symbols-outlined text-[18px]">check</span>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ───────────── Step 3: Scope & Criteria ───────────── */

function ScopeStep({
  form,
  errors,
  set,
}: {
  form: TestPlanFormData;
  errors: FormErrors;
  set: <K extends keyof TestPlanFormData>(
    key: K,
    value: TestPlanFormData[K]
  ) => void;
}) {
  return (
    <div className="space-y-md">
      <FormSection
        title="Scope & Objectives"
        description="What does this test plan aim to verify, and what is in or out of scope?"
      >
        <Field
          label="Objectives"
          htmlFor="tp-objectives"
          error={errors.objectives}
        >
          <ExpandableField
            label="Objectives"
            value={form.objectives}
            onChange={(v) => set("objectives", v)}
            placeholder="e.g. Verify that the new transfer flow handles all supported account types correctly."
            rows={3}
            helper="The goals this test plan aims to achieve."
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field
            label="In Scope"
            htmlFor="tp-scope"
            error={errors.scope}
          >
            <ExpandableField
              label="In Scope"
              value={form.scope}
              onChange={(v) => set("scope", v)}
              placeholder="e.g. Mobile transfer flow, account linking, biometric login."
              rows={4}
              helper="Features, systems, or areas included."
            />
          </Field>

          <Field
            label="Out of Scope"
            htmlFor="tp-out-of-scope"
            error={errors.outOfScope}
          >
            <ExpandableField
              label="Out of Scope"
              value={form.outOfScope}
              onChange={(v) => set("outOfScope", v)}
              placeholder="e.g. Web banking, ATM flow, fraud detection."
              rows={4}
              helper="Features, systems, or areas explicitly excluded."
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Entry & Exit Criteria"
        description="Pre-conditions to start and conditions that define completion."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field
            label="Entry Criteria"
            htmlFor="tp-entry"
            error={errors.entryCriteria}
          >
            <ExpandableField
              label="Entry Criteria"
              value={form.entryCriteria}
              onChange={(v) => set("entryCriteria", v)}
              placeholder="e.g. Build deployed to staging, test accounts provisioned, test data seeded."
              rows={4}
              helper="What must be true before testing can begin (e.g. test data loaded, environment stable)."
            />
          </Field>

          <Field
            label="Exit Criteria"
            htmlFor="tp-exit"
            error={errors.exitCriteria}
          >
            <ExpandableField
              label="Exit Criteria"
              value={form.exitCriteria}
              onChange={(v) => set("exitCriteria", v)}
              placeholder="e.g. 100% of critical scenarios executed, no P1 defects open, all defects triaged."
              rows={4}
              helper="What must be true before this test plan can be signed off (e.g. 95% pass rate, no critical defects)."
            />
          </Field>
        </div>
      </FormSection>
    </div>
  );
}

/* ───────────── Step 4: Review ───────────── */

function ReviewStep({
  form,
  users,
  projectCode,
  onJumpToStep,
  structure,
  isCreate,
}: {
  form: TestPlanFormData;
  users: User[];
  projectCode?: string;
  onJumpToStep: (idx: number) => void;
  structure?: DraftScenario[];
  isCreate?: boolean;
}) {
  const display = (v: string | null | undefined) =>
    v && v.trim() ? v : "—";
  const testLead = users.find((u) => u.id === form.testLeadId);
  const designDate = form.designDate
    ? new Date(form.designDate + "T00:00:00").toLocaleDateString()
    : "—";
  const meaningful = (structure ?? []).filter(hasMeaningfulScenario);
  const caseCount = meaningful.reduce((n, s) => n + s.testCases.filter((tc) => tc.title.trim()).length, 0);
  const stepCount = meaningful.reduce(
    (n, s) =>
      n +
      s.testCases.reduce(
        (nn, tc) => nn + tc.steps.filter((st) => st.instruction.trim()).length,
        0
      ),
    0
  );

  return (
    <div className="space-y-md">
      <p className="text-body-sm text-on-surface-variant">
        Review the details below before creating the test plan. Use the
        <span className="font-label-md"> Edit </span>
        links to jump back and adjust any section.
      </p>

      <ReviewCard
        stepIndex={0}
        title="Overview"
        onJumpToStep={onJumpToStep}
        rows={[
          { label: "Project Code", value: projectCode ?? "Auto-generated" },
          { label: "Project Name", value: display(form.name) },
          { label: "Module", value: display(form.moduleName) },
          { label: "Test Link", value: display(form.testLink) },
        ]}
      />

      <ReviewCard
        stepIndex={1}
        title="Team & Timeline"
        onJumpToStep={onJumpToStep}
        rows={[
          { label: "Designed By", value: display(form.designedBy) },
          { label: "Design Date", value: designDate },
          {
            label: "Test Lead",
            value: testLead
              ? `${testLead.name} (${testLead.username})`
              : form.testLeadId == null
                ? "—"
                : `User #${form.testLeadId}`,
          },
        ]}
      />

      <ReviewCard
        stepIndex={2}
        title="Scope & Criteria"
        onJumpToStep={onJumpToStep}
        rows={[
          { label: "Objectives", value: display(form.objectives), multiline: true },
          { label: "In Scope", value: display(form.scope), multiline: true },
          { label: "Out of Scope", value: display(form.outOfScope), multiline: true },
          { label: "Entry Criteria", value: display(form.entryCriteria), multiline: true },
          { label: "Exit Criteria", value: display(form.exitCriteria), multiline: true },
        ]}
      />

      {isCreate && (
        <ReviewCard
          stepIndex={3}
          title="Initial Structure"
          onJumpToStep={onJumpToStep}
          rows={[
            {
              label: "Scenarios",
              value:
                meaningful.length === 0
                  ? "None — you can add scenarios later or import from Excel"
                  : `${meaningful.length} scenario(s), ${caseCount} case(s), ${stepCount} step(s)`,
            },
          ]}
        />
      )}
    </div>
  );
}

/* ───────────── Create: Structure step ───────────── */

function StructureStep({
  structure,
  setStructure,
  error,
}: {
  structure: DraftScenario[];
  setStructure: Dispatch<SetStateAction<DraftScenario[]>>;
  error: string | null;
}) {
  const updateScenario = (si: number, patch: Partial<DraftScenario>) => {
    setStructure((list) => list.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  };

  const updateCase = (si: number, ci: number, patch: Partial<DraftTestCase>) => {
    setStructure((list) =>
      list.map((s, i) => {
        if (i !== si) return s;
        return {
          ...s,
          testCases: s.testCases.map((tc, j) => (j === ci ? { ...tc, ...patch } : tc)),
        };
      })
    );
  };

  const updateStep = (
    si: number,
    ci: number,
    sti: number,
    patch: Partial<DraftStep>
  ) => {
    setStructure((list) =>
      list.map((s, i) => {
        if (i !== si) return s;
        return {
          ...s,
          testCases: s.testCases.map((tc, j) => {
            if (j !== ci) return tc;
            return {
              ...tc,
              steps: tc.steps.map((st, k) => (k === sti ? { ...st, ...patch } : st)),
            };
          }),
        };
      })
    );
  };

  return (
    <FormSection
      title="Initial Structure"
      description="Optionally seed scenarios, test cases, and steps now. You can skip this and import from Excel or add them later on the Test Plan tab."
    >
      {error && (
        <div className="p-sm rounded-lg border border-error bg-error-container text-body-sm text-on-error-container">
          {error}
        </div>
      )}

      {structure.length === 0 ? (
        <div className="flex flex-col items-center gap-md py-lg border border-dashed border-outline-variant rounded-xl">
          <span className="material-symbols-outlined text-[40px] text-on-surface-variant">
            account_tree
          </span>
          <p className="text-body-sm text-on-surface-variant text-center max-w-sm">
            No scenarios yet. Add one to start building the plan, or continue and leave the plan
            empty.
          </p>
          <Button
            variant="secondary"
            onClick={() => setStructure([emptyScenario(0)])}
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add scenario
          </Button>
        </div>
      ) : (
        <div className="space-y-md">
          {structure.map((sc, si) => (
            <div
              key={si}
              className="border border-outline-variant rounded-xl p-md space-y-md bg-surface-container-lowest"
            >
              <div className="flex items-start justify-between gap-sm">
                <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider">
                  Scenario {si + 1}
                </p>
                <button
                  type="button"
                  className="text-on-surface-variant hover:text-error text-label-sm"
                  onClick={() => setStructure((list) => list.filter((_, i) => i !== si))}
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
                <Field label="Code" required>
                  <input
                    type="text"
                    value={sc.code}
                    onChange={(e) => updateScenario(si, { code: e.target.value })}
                    placeholder="UC-01"
                    className={`${inputBaseClass} font-mono ${inputValidClass}`}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Scenario name" required>
                    <input
                      type="text"
                      value={sc.name}
                      onChange={(e) => updateScenario(si, { name: e.target.value })}
                      placeholder="e.g. User can log in"
                      className={`${inputBaseClass} ${inputValidClass}`}
                    />
                  </Field>
                </div>
              </div>

              {sc.testCases.map((tc, ci) => (
                <div
                  key={ci}
                  className="ml-0 md:ml-md border-l-2 border-outline-variant pl-md space-y-sm"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-label-sm text-on-surface-variant">Test case {ci + 1}</p>
                    {sc.testCases.length > 1 && (
                      <button
                        type="button"
                        className="text-label-sm text-on-surface-variant hover:text-error"
                        onClick={() =>
                          updateScenario(si, {
                            testCases: sc.testCases.filter((_, j) => j !== ci),
                          })
                        }
                      >
                        Remove case
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-sm">
                    <Field label="Case #">
                      <input
                        type="text"
                        value={tc.caseNumber}
                        onChange={(e) => updateCase(si, ci, { caseNumber: e.target.value })}
                        placeholder="1"
                        className={`${inputBaseClass} ${inputValidClass}`}
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="Title">
                        <input
                          type="text"
                          value={tc.title}
                          onChange={(e) => updateCase(si, ci, { title: e.target.value })}
                          placeholder="Happy path"
                          className={`${inputBaseClass} ${inputValidClass}`}
                        />
                      </Field>
                    </div>
                  </div>
                  <Field label="Precondition">
                    <input
                      type="text"
                      value={tc.precondition}
                      onChange={(e) => updateCase(si, ci, { precondition: e.target.value })}
                      placeholder="Optional"
                      className={`${inputBaseClass} ${inputValidClass}`}
                    />
                  </Field>

                  {tc.steps.map((st, sti) => (
                    <div key={sti} className="grid grid-cols-1 gap-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-label-sm text-on-surface-variant">
                          Step {sti + 1}
                        </span>
                        {tc.steps.length > 1 && (
                          <button
                            type="button"
                            className="text-label-sm text-on-surface-variant hover:text-error"
                            onClick={() =>
                              updateCase(si, ci, {
                                steps: tc.steps.filter((_, k) => k !== sti),
                              })
                            }
                          >
                            Remove step
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={st.instruction}
                        onChange={(e) =>
                          updateStep(si, ci, sti, { instruction: e.target.value })
                        }
                        placeholder="Instruction"
                        className={`${inputBaseClass} ${inputValidClass}`}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                        <input
                          type="text"
                          value={st.testData}
                          onChange={(e) =>
                            updateStep(si, ci, sti, { testData: e.target.value })
                          }
                          placeholder="Test data (optional)"
                          className={`${inputBaseClass} ${inputValidClass}`}
                        />
                        <input
                          type="text"
                          value={st.expectedResult}
                          onChange={(e) =>
                            updateStep(si, ci, sti, { expectedResult: e.target.value })
                          }
                          placeholder="Expected result (optional)"
                          className={`${inputBaseClass} ${inputValidClass}`}
                        />
                      </div>
                    </div>
                  ))}

                  <Button
                    variant="ghost"
                    onClick={() =>
                      updateCase(si, ci, {
                        steps: [
                          ...tc.steps,
                          { instruction: "", testData: "", expectedResult: "" },
                        ],
                      })
                    }
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Add step
                  </Button>
                </div>
              ))}

              <Button
                variant="secondary"
                onClick={() =>
                  updateScenario(si, {
                    testCases: [
                      ...sc.testCases,
                      {
                        caseNumber: String(sc.testCases.length + 1),
                        title: "",
                        precondition: "",
                        steps: [{ instruction: "", testData: "", expectedResult: "" }],
                      },
                    ],
                  })
                }
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add test case
              </Button>
            </div>
          ))}

          <Button
            variant="secondary"
            onClick={() => setStructure((list) => [...list, emptyScenario(list.length)])}
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add scenario
          </Button>
        </div>
      )}
    </FormSection>
  );
}

function ReviewCard({
  stepIndex,
  title,
  rows,
  onJumpToStep,
}: {
  stepIndex: number;
  title: string;
  rows: { label: string; value: string; multiline?: boolean }[];
  onJumpToStep: (idx: number) => void;
}) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md md:p-lg">
      <header className="flex items-center justify-between mb-md">
        <h3 className="font-title-sm text-title-sm text-on-surface">{title}</h3>
        <button
          type="button"
          onClick={() => onJumpToStep(stepIndex)}
          className="text-label-md font-label-md text-secondary hover:underline inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">edit</span>
          Edit
        </button>
      </header>
      <dl className="grid grid-cols-1 md:grid-cols-3 gap-md">
        {rows.map((r) => (
          <div
            key={r.label}
            className={r.multiline ? "md:col-span-3" : "md:col-span-1"}
          >
            <dt className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider">
              {r.label}
            </dt>
            <dd
              className={`text-body-sm text-on-surface mt-1 ${
                r.multiline ? "whitespace-pre-wrap" : ""
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
