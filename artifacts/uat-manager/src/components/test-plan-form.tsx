import { useEffect, useMemo, useState } from "react";
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
}

interface TestPlanFormProps {
  mode: "create" | "edit";
  open: boolean;
  onClose: () => void;
  onSave: (data: TestPlanFormData) => void;
  saving: boolean;
  initial?: Project;
}

const STEPS: Step[] = [
  { key: "overview", label: "Overview" },
  { key: "team", label: "Team & Timeline" },
  { key: "scope", label: "Scope & Criteria" },
  { key: "review", label: "Review" },
];

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
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<TestPlanFormData>(() =>
    mode === "edit" && initial ? fromProject(initial) : makeEmpty()
  );
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
      setCompleted([]);
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

  const validateStep = (s: number): FormErrors => {
    const errs: FormErrors = {};
    if (s === 0) {
      if (!form.name.trim()) errs.name = "Project name is required";
      if (!form.moduleName.trim()) errs.moduleName = "Module is required";
      if (form.testLink.trim() && !/^https?:\/\/\S+$/i.test(form.testLink.trim())) {
        errs.testLink = "Enter a valid URL (http:// or https://)";
      }
    } else if (s === 1) {
      if (!form.designedBy.trim()) errs.designedBy = "Designer name is required";
      if (!form.designDate) errs.designDate = "Design date is required";
      if (mode === "create" && form.testLeadId == null) {
        errs.testLeadId = "Test lead is required";
      }
    }
    return errs;
  };

  const handleNext = () => {
    const errs = validateStep(step);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setCompleted((c) => (c.includes(step) ? c : [...c, step]));
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleStepClick = (idx: number) => {
    if (idx <= step || completed.includes(idx)) {
      setErrors({});
      setStep(idx);
    }
  };

  const handleSubmit = () => {
    for (let s = 0; s < STEPS.length - 1; s++) {
      const errs = validateStep(s);
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        setStep(s);
        return;
      }
    }
    onSave(form);
  };

  const title = mode === "create" ? "Create Test Plan" : "Edit Test Plan";
  const subtitle =
    mode === "create"
      ? "Define the scope, ownership, and entry/exit criteria for this test plan."
      : "Update this test plan's metadata. The project code cannot be changed.";
  const submitLabel = mode === "create" ? "Create Project" : "Save Changes";
  const submittingLabel = mode === "create" ? "Creating..." : "Saving...";

  return (
    <SlideOver open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="p-lg space-y-lg">
        <Stepper
          steps={STEPS}
          currentIndex={step}
          completedIndices={completed}
          onStepClick={handleStepClick}
        />

        <div className="min-h-[360px]">
          {step === 0 && <OverviewStep form={form} errors={errors} set={set} />}
          {step === 1 && (
            <TeamStep
              form={form}
              errors={errors}
              set={set}
              users={activeUsers}
              allowNullLead={mode === "edit"}
            />
          )}
          {step === 2 && <ScopeStep form={form} errors={errors} set={set} />}
          {step === 3 && (
            <ReviewStep
              form={form}
              users={activeUsers}
              projectCode={initial?.project_code}
              onJumpToStep={handleStepClick}
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
          {step < STEPS.length - 1 ? (
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
          helper="The goals this test plan aims to achieve."
        >
          <Textarea
            id="tp-objectives"
            rows={3}
            value={form.objectives}
            onChange={(e) => set("objectives", e.target.value)}
            placeholder="e.g. Verify that the new transfer flow handles all supported account types correctly."
            invalid={!!errors.objectives}
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field
            label="In Scope"
            htmlFor="tp-scope"
            error={errors.scope}
            helper="Features, systems, or areas included."
          >
            <Textarea
              id="tp-scope"
              rows={4}
              value={form.scope}
              onChange={(e) => set("scope", e.target.value)}
              placeholder="e.g. Mobile transfer flow, account linking, biometric login."
              invalid={!!errors.scope}
            />
          </Field>

          <Field
            label="Out of Scope"
            htmlFor="tp-out-of-scope"
            error={errors.outOfScope}
            helper="Features, systems, or areas explicitly excluded."
          >
            <Textarea
              id="tp-out-of-scope"
              rows={4}
              value={form.outOfScope}
              onChange={(e) => set("outOfScope", e.target.value)}
              placeholder="e.g. Web banking, ATM flow, fraud detection."
              invalid={!!errors.outOfScope}
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
            helper="What must be true before testing can begin (e.g. test data loaded, environment stable)."
          >
            <Textarea
              id="tp-entry"
              rows={4}
              value={form.entryCriteria}
              onChange={(e) => set("entryCriteria", e.target.value)}
              placeholder="e.g. Build deployed to staging, test accounts provisioned, test data seeded."
              invalid={!!errors.entryCriteria}
            />
          </Field>

          <Field
            label="Exit Criteria"
            htmlFor="tp-exit"
            error={errors.exitCriteria}
            helper="What must be true before this test plan can be signed off (e.g. 95% pass rate, no critical defects)."
          >
            <Textarea
              id="tp-exit"
              rows={4}
              value={form.exitCriteria}
              onChange={(e) => set("exitCriteria", e.target.value)}
              placeholder="e.g. 100% of critical scenarios executed, no P1 defects open, all defects triaged."
              invalid={!!errors.exitCriteria}
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
}: {
  form: TestPlanFormData;
  users: User[];
  projectCode?: string;
  onJumpToStep: (idx: number) => void;
}) {
  const display = (v: string | null | undefined) =>
    v && v.trim() ? v : "—";
  const testLead = users.find((u) => u.id === form.testLeadId);
  const designDate = form.designDate
    ? new Date(form.designDate + "T00:00:00").toLocaleDateString()
    : "—";

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
    </div>
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
