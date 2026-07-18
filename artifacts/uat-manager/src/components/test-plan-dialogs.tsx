import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Field, inputBaseClass, inputInvalidClass, inputValidClass } from "./ui/field";
import { Textarea } from "./ui/textarea";
import { Select } from "./ui/select";
import { uploadUrl, customFetch } from "../lib/api-client";
import { PreconditionPicker } from "./precondition-library";
import type { TestStep, UseCase, TestCase } from "../types/api";

/* ───────────── Scenario Dialog ───────────── */

export interface ScenarioFormData {
  code: string;
  name: string;
  priority: string;
  category: string;
}

const PRIORITY_OPTIONS = [
  { value: "", label: "No priority" },
  { value: "Critical", label: "Critical" },
  { value: "High", label: "High" },
  { value: "Medium", label: "Medium" },
  { value: "Low", label: "Low" },
];

interface ScenarioDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: UseCase | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: ScenarioFormData) => void;
}

export function ScenarioDialog({
  open,
  mode,
  initial,
  saving,
  onClose,
  onSave,
}: ScenarioDialogProps) {
  const [form, setForm] = useState<ScenarioFormData>({
    code: "",
    name: "",
    priority: "",
    category: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ScenarioFormData, string>>>({});

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(
        initial
          ? {
              code: initial.code,
              name: initial.name,
              priority: initial.priority ?? "",
              category: initial.category ?? "",
            }
          : { code: "", name: "", priority: "", category: "" }
      );
      setErrors({});
    }
  }, [open, initial]);

  const set = <K extends keyof ScenarioFormData>(key: K, value: ScenarioFormData[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = () => {
    const errs: typeof errors = {};
    if (!form.code.trim()) errs.code = "Code is required";
    if (!form.name.trim()) errs.name = "Name is required";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSave(form);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add Scenario" : "Edit Scenario"}
      subtitle={
        mode === "create"
          ? "A scenario groups related test cases for a specific area of functionality."
          : "Update the scenario's name, code, priority, or category."
      }
      size="md"
      footer={
        <div className="flex items-center justify-end gap-sm">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>
            {saving
              ? mode === "create" ? "Creating..." : "Saving..."
              : mode === "create" ? "Add Scenario" : "Save Changes"}
          </Button>
        </div>
      }
    >
      <div className="space-y-md">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
          <Field
            label="Code"
            required
            htmlFor="sd-code"
            error={errors.code}
            helper="Short identifier (e.g. UC-01, REQ-12)"
          >
            <input
              id="sd-code"
              type="text"
              value={form.code}
              onChange={(e) => set("code", e.target.value)}
              placeholder="UC-01"
              className={`${inputBaseClass} font-mono ${
                errors.code ? inputInvalidClass : inputValidClass
              }`}
            />
          </Field>

          <div className="md:col-span-2">
            <Field
              label="Scenario Name"
              required
              htmlFor="sd-name"
              error={errors.name}
              helper="A clear, action-oriented name for this scenario."
            >
              <input
                id="sd-name"
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. User can transfer funds between own accounts"
                className={`${inputBaseClass} ${
                  errors.name ? inputInvalidClass : inputValidClass
                }`}
              />
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field
            label="Priority"
            htmlFor="sd-priority"
            error={errors.priority}
            helper="Optional. Drives visual emphasis in the plan."
          >
            <Select
              id="sd-priority"
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Category"
            htmlFor="sd-category"
            error={errors.category}
            helper="Optional. e.g. Functional, Regression, Smoke."
          >
            <input
              id="sd-category"
              type="text"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder="e.g. Functional"
              className={`${inputBaseClass} ${
                errors.category ? inputInvalidClass : inputValidClass
              }`}
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/* ───────────── Test Case Dialog ───────────── */

export interface TestCaseFormData {
  case_number: string;
  title: string;
  test_type: string;
  estimated_minutes: number | null;
  acceptance_criteria: string;
  precondition: string;
  precondition_ids: number[];
}

interface TestCaseDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: TestCase | null;
  suggestedCaseNumber?: string;
  projectId?: number;
  saving: boolean;
  onClose: () => void;
  onSave: (data: TestCaseFormData) => void;
}

export function TestCaseDialog({
  open,
  mode,
  initial,
  suggestedCaseNumber,
  projectId,
  saving,
  onClose,
  onSave,
}: TestCaseDialogProps) {
  const [form, setForm] = useState<TestCaseFormData>({
    case_number: "",
    title: "",
    test_type: "",
    estimated_minutes: null,
    acceptance_criteria: "",
    precondition: "",
    precondition_ids: [],
  });
  const [errors, setErrors] = useState<Partial<Record<keyof TestCaseFormData, string>>>({});

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(
        initial
          ? {
              case_number: initial.case_number,
              title: initial.title,
              test_type: initial.test_type ?? "",
              estimated_minutes: initial.estimated_minutes,
              acceptance_criteria: initial.acceptance_criteria ?? "",
              precondition: initial.precondition ?? "",
              precondition_ids: (initial.linkedPreconditions ?? []).map((p) => p.id),
            }
          : {
              case_number: suggestedCaseNumber ?? "",
              title: "",
              test_type: "",
              estimated_minutes: null,
              acceptance_criteria: "",
              precondition: "",
              precondition_ids: [],
            }
      );
      setErrors({});
    }
  }, [open, initial, suggestedCaseNumber]);

  const set = <K extends keyof TestCaseFormData>(key: K, value: TestCaseFormData[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = () => {
    const errs: typeof errors = {};
    if (!form.case_number.trim()) errs.case_number = "Case number is required";
    if (!form.title.trim()) errs.title = "Title is required";
    if (
      form.estimated_minutes != null &&
      (form.estimated_minutes < 0 || !Number.isFinite(form.estimated_minutes))
    ) {
      errs.estimated_minutes = "Must be a positive number";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSave(form);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add Test Case" : "Edit Test Case"}
      subtitle={
        mode === "create"
          ? "A test case verifies a specific behaviour with one or more executable steps."
          : "Update the test case's title, type, acceptance criteria, or precondition."
      }
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-sm">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>
            {saving
              ? mode === "create" ? "Creating..." : "Saving..."
              : mode === "create" ? "Add Test Case" : "Save Changes"}
          </Button>
        </div>
      }
    >
      <div className="space-y-md">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
          <Field
            label="Case #"
            required
            htmlFor="td-case-number"
            error={errors.case_number}
            helper="Short identifier (e.g. TC-01, 1.1, REQ-12-A)"
          >
            <input
              id="td-case-number"
              type="text"
              value={form.case_number}
              onChange={(e) => set("case_number", e.target.value)}
              placeholder="TC-01"
              className={`${inputBaseClass} font-mono ${
                errors.case_number ? inputInvalidClass : inputValidClass
              }`}
            />
          </Field>

          <div className="md:col-span-2">
            <Field
              label="Title"
              required
              htmlFor="td-title"
              error={errors.title}
              helper="A clear, action-oriented title for this test case."
            >
              <input
                id="td-title"
                type="text"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Verify successful transfer with sufficient balance"
                className={`${inputBaseClass} ${
                  errors.title ? inputInvalidClass : inputValidClass
                }`}
              />
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field
            label="Type"
            htmlFor="td-type"
            error={errors.test_type}
            helper="e.g. Functional, Regression, Smoke, Negative, E2E"
          >
            <input
              id="td-type"
              type="text"
              value={form.test_type}
              onChange={(e) => set("test_type", e.target.value)}
              placeholder="e.g. Functional"
              className={`${inputBaseClass} ${
                errors.test_type ? inputInvalidClass : inputValidClass
              }`}
            />
          </Field>

          <Field
            label="Estimated Time (minutes)"
            htmlFor="td-estimate"
            error={errors.estimated_minutes}
            helper="Optional. Used for test run planning."
          >
            <input
              id="td-estimate"
              type="number"
              min={0}
              step={1}
              value={form.estimated_minutes ?? ""}
              onChange={(e) =>
                set(
                  "estimated_minutes",
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
              placeholder="e.g. 15"
              className={`${inputBaseClass} ${
                errors.estimated_minutes ? inputInvalidClass : inputValidClass
              }`}
            />
          </Field>
        </div>

        <Field
          label="Acceptance Criteria"
          htmlFor="td-acceptance"
          error={errors.acceptance_criteria}
          helper="Optional. What must be true for this test case to pass."
        >
          <Textarea
            id="td-acceptance"
            rows={3}
            value={form.acceptance_criteria}
            onChange={(e) => set("acceptance_criteria", e.target.value)}
            placeholder="e.g. The transfer appears in the transaction history within 5 seconds."
            invalid={!!errors.acceptance_criteria}
          />
        </Field>

        {projectId != null ? (
          <PreconditionPicker
            projectId={projectId}
            selectedIds={form.precondition_ids}
            onChange={(ids) => set("precondition_ids", ids)}
            freeText={form.precondition}
            onFreeTextChange={(v) => set("precondition", v)}
          />
        ) : (
          <Field
            label="Precondition"
            htmlFor="td-precondition"
            error={errors.precondition}
            helper="Only needed if this specific test case has a precondition beyond the project's Entry Criteria."
          >
            <Textarea
              id="td-precondition"
              rows={2}
              value={form.precondition}
              onChange={(e) => set("precondition", e.target.value)}
              placeholder="e.g. Invoice Exists"
              invalid={!!errors.precondition}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/* ───────────── Step Dialog ───────────── */

export interface StepFormData {
  instruction: string;
  test_data: string;
  expected_result: string;
}

/** Split pasted text into step instructions (one non-empty line per step). */
export function parsePastedSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[\d]+[.)]\s*/, "").trim())
    .filter(Boolean);
}

interface StepDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: TestStep | null;
  stepNumber?: number;
  saving: boolean;
  savingBulk?: boolean;
  onClose: () => void;
  onSave: (data: StepFormData) => void;
  /** Create mode only: multi-line paste → bulk create */
  onSaveBulk?: (steps: { instruction: string; test_data?: string; expected_result?: string }[]) => void;
}

export function StepDialog({
  open,
  mode,
  initial,
  stepNumber,
  saving,
  savingBulk,
  onClose,
  onSave,
  onSaveBulk,
}: StepDialogProps) {
  const [form, setForm] = useState<StepFormData>({
    instruction: "",
    test_data: "",
    expected_result: "",
  });
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof StepFormData, string>>>({});
  const busy = saving || !!savingBulk;

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(
        initial
          ? {
              instruction: initial.instruction,
              test_data: initial.test_data ?? "",
              expected_result: initial.expected_result ?? "",
            }
          : { instruction: "", test_data: "", expected_result: "" }
      );
      setBulkMode(false);
      setBulkText("");
      setErrors({});
    }
  }, [open, initial]);

  const set = <K extends keyof StepFormData>(key: K, value: StepFormData[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = () => {
    if (mode === "create" && bulkMode && onSaveBulk) {
      const lines = parsePastedSteps(bulkText);
      if (lines.length === 0) {
        toast.error("Paste at least one non-empty line");
        return;
      }
      onSaveBulk(lines.map((instruction) => ({ instruction })));
      return;
    }
    const errs: typeof errors = {};
    if (!form.instruction.trim()) errs.instruction = "Instruction is required";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSave(form);
  };

  const bulkLines = bulkMode ? parsePastedSteps(bulkText) : [];
  const titlePrefix = mode === "create"
    ? bulkMode
      ? "Paste steps"
      : stepNumber != null ? `Add Step ${stepNumber}` : "Add Step"
    : `Edit Step${stepNumber != null ? ` ${stepNumber}` : ""}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={titlePrefix}
      subtitle={
        mode === "create"
          ? bulkMode
            ? "One step per line. Numbered prefixes (1. 2) are stripped automatically."
            : "A step is a single, executable action with optional test data and an expected result."
          : "Update the step's instruction, data, or expected result."
      }
      size="md"
      footer={
        <div className="flex items-center justify-between gap-sm w-full">
          {mode === "create" && onSaveBulk ? (
            <button
              type="button"
              className="text-label-sm text-secondary hover:underline"
              onClick={() => {
                setBulkMode((v) => !v);
                setErrors({});
              }}
              disabled={busy}
            >
              {bulkMode ? "Single step form" : "Paste multiple steps"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-sm">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} loading={busy}>
              {busy
                ? mode === "create" ? "Creating..." : "Saving..."
                : mode === "create"
                  ? bulkMode
                    ? bulkLines.length > 1
                      ? `Add ${bulkLines.length} steps`
                      : "Add Step"
                    : "Add Step"
                  : "Save Changes"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-md">
        {mode === "create" && bulkMode ? (
          <Field
            label="Steps (one per line)"
            required
            htmlFor="st-bulk"
            helper={
              bulkLines.length > 0
                ? `${bulkLines.length} step${bulkLines.length === 1 ? "" : "s"} will be created`
                : "Paste from Excel, Word, or a checklist — each line becomes a step."
            }
          >
            <Textarea
              id="st-bulk"
              rows={8}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"Navigate to the home page\nSelect the customer account\nClick Submit and verify success"}
            />
          </Field>
        ) : (
          <>
            <Field
              label="Instruction"
              required
              htmlFor="st-instruction"
              error={errors.instruction}
              helper="A clear, single action for the tester to perform."
            >
              <Textarea
                id="st-instruction"
                rows={3}
                value={form.instruction}
                onChange={(e) => set("instruction", e.target.value)}
                placeholder="e.g. Log in with the test account credentials"
                invalid={!!errors.instruction}
              />
            </Field>

            <Field
              label="Test Data"
              htmlFor="st-test-data"
              error={errors.test_data}
              helper="Optional. Input values, accounts, or fixtures the tester should use."
            >
              <Textarea
                id="st-test-data"
                rows={2}
                value={form.test_data}
                onChange={(e) => set("test_data", e.target.value)}
                placeholder="e.g. Account: test.user@example.com / Password: Test123!"
                invalid={!!errors.test_data}
              />
            </Field>

            <Field
              label="Expected Result"
              htmlFor="st-expected"
              error={errors.expected_result}
              helper="Optional. What the tester should see if the system behaves correctly."
            >
              <Textarea
                id="st-expected"
                rows={2}
                value={form.expected_result}
                onChange={(e) => set("expected_result", e.target.value)}
                placeholder="e.g. Dashboard loads with the user's account summary visible."
                invalid={!!errors.expected_result}
              />
            </Field>
          </>
        )}

        {mode === "edit" && initial?.id && (
          <AttachmentManager stepId={initial.id} />
        )}
      </div>
    </Dialog>
  );
}

/* ───────────── Attachment Manager (used in step edit) ───────────── */

interface AttachmentItem {
  id: number;
  file_url: string;
  file_name?: string;
  file_type?: string | null;
}

function AttachmentManager({ stepId }: { stepId: number }) {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await customFetch<AttachmentItem[]>(
        `/attachments/test_step/${stepId}`
      );
      setItems(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await customFetch<{ fileUrl: string }>("/upload", {
        method: "POST",
        body: formData,
      });
      await customFetch("/attachments", {
        method: "POST",
        body: JSON.stringify({
          entity_type: "test_step",
          entity_id: stepId,
          file_url: uploadRes.fileUrl,
          file_name: file.name,
          file_type: file.type,
        }),
      });
      await load();
      toast.success("Image attached");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await customFetch<void>(`/attachments/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((a) => a.id !== id));
      toast.success("Image removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="pt-md border-t border-outline-variant space-y-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-label-md font-label-md text-on-surface">Reference Images</p>
          <p className="text-label-sm text-on-surface-variant mt-0.5">
            Optional screenshots or diagrams for the tester.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-sm">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="aspect-square rounded-lg bg-surface-container-high animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-md text-label-sm text-on-surface-variant border border-dashed border-outline-variant rounded-lg">
          No images attached yet.
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-sm">
          {items.map((a) => (
            <div
              key={a.id}
              className="relative group aspect-square rounded-lg overflow-hidden border border-outline-variant bg-surface-container-low"
            >
              <img
                 src={uploadUrl(a.file_url)}
                alt={a.file_name ?? "Reference"}
                className="w-full h-full object-cover cursor-pointer"
                 onClick={() => window.open(uploadUrl(a.file_url), "_blank")}
              />
              <button
                type="button"
                onClick={() => handleDelete(a.id)}
                aria-label="Remove image"
                className="absolute top-1 right-1 p-1 rounded-full bg-inverse-surface text-inverse-on-surface opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
