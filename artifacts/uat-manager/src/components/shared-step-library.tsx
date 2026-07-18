import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Field, inputBaseClass, inputValidClass } from "./ui/field";
import { customFetch } from "../lib/api-client";
import type { SharedStepBlock } from "../types/api";

interface SharedStepLibraryProps {
  projectId: number;
  canEdit: boolean;
}

type DraftStep = { instruction: string; test_data: string; expected_result: string };

const emptyStep = (): DraftStep => ({
  instruction: "",
  test_data: "",
  expected_result: "",
});

export function SharedStepLibrary({ projectId, canEdit }: SharedStepLibraryProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([emptyStep()]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editSteps, setEditSteps] = useState<DraftStep[]>([]);

  const { data: blocks = [], isLoading } = useQuery({
    queryKey: ["shared-step-blocks", projectId],
    queryFn: () =>
      customFetch<SharedStepBlock[]>(`/projects/${projectId}/shared-step-blocks`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["shared-step-blocks", projectId] });
  };

  const createMut = useMutation({
    mutationFn: (body: { name: string; steps: DraftStep[] }) =>
      customFetch<SharedStepBlock>(`/projects/${projectId}/shared-step-blocks`, {
        method: "POST",
        body: JSON.stringify({
          name: body.name,
          steps: body.steps
            .filter((s) => s.instruction.trim())
            .map((s) => ({
              instruction: s.instruction.trim(),
              ...(s.test_data.trim() ? { test_data: s.test_data.trim() } : {}),
              ...(s.expected_result.trim()
                ? { expected_result: s.expected_result.trim() }
                : {}),
            })),
        }),
      }),
    onSuccess: () => {
      setName("");
      setSteps([emptyStep()]);
      invalidate();
      toast.success("Shared step block added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (d: { id: number; name: string; steps: DraftStep[] }) =>
      customFetch<SharedStepBlock>(`/shared-step-blocks/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: d.name,
          steps: d.steps
            .filter((s) => s.instruction.trim())
            .map((s) => ({
              instruction: s.instruction.trim(),
              ...(s.test_data.trim() ? { test_data: s.test_data.trim() } : {}),
              ...(s.expected_result.trim()
                ? { expected_result: s.expected_result.trim() }
                : {}),
            })),
        }),
      }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
      toast.success("Shared step block updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/shared-step-blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Shared step block removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (b: SharedStepBlock) => {
    setEditingId(b.id);
    setEditName(b.name);
    const next = (b.items ?? []).map((i) => ({
      instruction: i.instruction,
      test_data: i.test_data ?? "",
      expected_result: i.expected_result ?? "",
    }));
    setEditSteps(next.length > 0 ? next : [emptyStep()]);
  };

  return (
    <section className="border border-outline-variant rounded-xl p-md bg-surface-container-lowest space-y-md">
      <header className="flex items-start justify-between gap-md">
        <div>
          <h3 className="font-title-sm text-title-sm text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-secondary text-[20px]">
              view_list
            </span>
            Shared step blocks
          </h3>
          <p className="text-body-sm text-on-surface-variant mt-1">
            Multi-step templates (for example a login sequence). Insert into a case from the plan structure; copies are independent.
          </p>
        </div>
        <span className="text-label-sm text-on-surface-variant shrink-0">
          {blocks.length} block{blocks.length !== 1 ? "s" : ""}
        </span>
      </header>

      {isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Loading…</p>
      ) : blocks.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant border border-dashed border-outline-variant rounded-lg p-md">
          No shared step blocks yet.
          {canEdit
            ? " Create common sequences (e.g. “Login flow”) so authors insert them in one click."
            : ""}
        </p>
      ) : (
        <ul className="space-y-sm">
          {blocks.map((b) => {
            const open = expandedId === b.id;
            const items = b.items ?? [];
            return (
              <li
                key={b.id}
                className="rounded-lg border border-outline-variant bg-surface overflow-hidden"
              >
                <div className="flex items-center gap-sm p-sm">
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-surface-container"
                    onClick={() => setExpandedId(open ? null : b.id)}
                    aria-label={open ? "Collapse" : "Expand"}
                  >
                    <span className="material-symbols-outlined text-on-surface-variant">
                      {open ? "expand_more" : "chevron_right"}
                    </span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-label-md text-label-md text-on-surface truncate">
                      {b.name}
                    </p>
                    <p className="text-label-sm text-on-surface-variant">
                      {items.length} step{items.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-xs shrink-0">
                      <button
                        type="button"
                        className="text-on-surface-variant hover:text-secondary p-1"
                        title="Edit block"
                        onClick={() => startEdit(b)}
                      >
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button
                        type="button"
                        className="text-on-surface-variant hover:text-error p-1"
                        title="Delete block"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete shared block "${b.name}"? Existing test cases keep their copied steps.`,
                            )
                          ) {
                            deleteMut.mutate(b.id);
                          }
                        }}
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  )}
                </div>
                {open && items.length > 0 && (
                  <ol className="border-t border-outline-variant px-md py-sm space-y-xs">
                    {items.map((it, i) => (
                      <li key={it.id} className="text-body-sm text-on-surface flex gap-sm">
                        <span className="text-on-surface-variant font-mono shrink-0">
                          {i + 1}.
                        </span>
                        <span className="min-w-0">
                          {it.instruction}
                          {it.expected_result ? (
                            <span className="block text-label-sm text-on-surface-variant mt-0.5">
                              Expected: {it.expected_result}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {editingId === b.id && (
                  <div className="border-t border-outline-variant p-md space-y-sm bg-surface-container-low">
                    <Field label="Block name">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className={`${inputBaseClass} ${inputValidClass}`}
                      />
                    </Field>
                    <StepDraftList steps={editSteps} onChange={setEditSteps} />
                    <div className="flex gap-sm">
                      <Button
                        variant="primary"
                        loading={updateMut.isPending}
                        onClick={() => {
                          if (!editName.trim()) {
                            toast.error("Name is required");
                            return;
                          }
                          if (!editSteps.some((s) => s.instruction.trim())) {
                            toast.error("At least one step is required");
                            return;
                          }
                          updateMut.mutate({
                            id: b.id,
                            name: editName.trim(),
                            steps: editSteps,
                          });
                        }}
                      >
                        Save
                      </Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <div className="space-y-sm pt-sm border-t border-outline-variant">
          <Field label="New block name" helper="e.g. Login and open Accounts">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Block name"
              className={`${inputBaseClass} ${inputValidClass}`}
            />
          </Field>
          <StepDraftList steps={steps} onChange={setSteps} />
          <Button
            variant="secondary"
            loading={createMut.isPending}
            onClick={() => {
              if (!name.trim()) {
                toast.error("Enter a block name");
                return;
              }
              if (!steps.some((s) => s.instruction.trim())) {
                toast.error("Add at least one step with an instruction");
                return;
              }
              createMut.mutate({ name: name.trim(), steps });
            }}
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add shared block
          </Button>
        </div>
      )}
    </section>
  );
}

function StepDraftList({
  steps,
  onChange,
}: {
  steps: DraftStep[];
  onChange: (s: DraftStep[]) => void;
}) {
  const set = (i: number, patch: Partial<DraftStep>) => {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  return (
    <div className="space-y-sm">
      <p className="text-label-sm font-label-md text-on-surface">Steps</p>
      {steps.map((s, i) => (
        <div
          key={i}
          className="border border-outline-variant rounded-lg p-sm space-y-xs bg-surface"
        >
          <div className="flex items-center justify-between">
            <span className="text-label-sm text-on-surface-variant">Step {i + 1}</span>
            {steps.length > 1 && (
              <button
                type="button"
                className="text-on-surface-variant hover:text-error text-label-sm"
                onClick={() => onChange(steps.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </div>
          <textarea
            rows={2}
            value={s.instruction}
            onChange={(e) => set(i, { instruction: e.target.value })}
            placeholder="Instruction"
            className={`${inputBaseClass} resize-y ${inputValidClass}`}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
            <input
              value={s.test_data}
              onChange={(e) => set(i, { test_data: e.target.value })}
              placeholder="Test data (optional)"
              className={`${inputBaseClass} ${inputValidClass}`}
            />
            <input
              value={s.expected_result}
              onChange={(e) => set(i, { expected_result: e.target.value })}
              placeholder="Expected result (optional)"
              className={`${inputBaseClass} ${inputValidClass}`}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-sm text-label-sm text-secondary hover:underline"
        onClick={() => onChange([...steps, emptyStep()])}
      >
        <span className="material-symbols-outlined text-[16px]">add</span>
        Add step row
      </button>
    </div>
  );
}

/** Save the current test case's steps as a new library block. */
export function SaveAsSharedBlockButton({
  projectId,
  testCaseId,
  canEdit,
}: {
  projectId: number;
  testCaseId: number;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const saveMut = useMutation({
    mutationFn: () =>
      customFetch<SharedStepBlock>(
        `/projects/${projectId}/shared-step-blocks/from-test-case`,
        {
          method: "POST",
          body: JSON.stringify({ test_case_id: testCaseId }),
        },
      ),
    onSuccess: (block) => {
      queryClient.invalidateQueries({ queryKey: ["shared-step-blocks", projectId] });
      toast.success(`Saved as shared block: ${block.name}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canEdit) return null;

  return (
    <button
      type="button"
      disabled={saveMut.isPending}
      onClick={() => saveMut.mutate()}
      className="inline-flex items-center gap-sm text-label-sm text-on-surface-variant hover:text-secondary hover:underline"
      title="Save this case’s steps as a reusable shared block"
    >
      <span className="material-symbols-outlined text-[16px]">bookmark_add</span>
      Save as shared block
    </button>
  );
}

/** Insert a shared block into a test case (copy-on-insert). */
export function InsertSharedStepsButton({
  projectId,
  testCaseId,
  canEdit,
  onInserted,
}: {
  projectId: number;
  testCaseId: number;
  canEdit: boolean;
  onInserted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: blocks = [] } = useQuery({
    queryKey: ["shared-step-blocks", projectId],
    queryFn: () =>
      customFetch<SharedStepBlock[]>(`/projects/${projectId}/shared-step-blocks`),
    enabled: open && canEdit,
  });

  const insertMut = useMutation({
    mutationFn: (blockId: number) =>
      customFetch(`/test-cases/${testCaseId}/insert-shared-steps`, {
        method: "POST",
        body: JSON.stringify({ block_id: blockId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      setOpen(false);
      toast.success("Shared steps inserted");
      onInserted?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canEdit) return null;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-sm text-label-sm text-secondary hover:underline"
        title="Insert shared step block"
      >
        <span className="material-symbols-outlined text-[16px]">playlist_add</span>
        Insert shared steps
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 min-w-[240px] max-w-sm bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg p-sm space-y-xs">
          {blocks.length === 0 ? (
            <p className="text-label-sm text-on-surface-variant p-sm">
              No shared blocks yet. Create one under Shared step blocks.
            </p>
          ) : (
            blocks.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={insertMut.isPending}
                className="w-full text-left px-sm py-1.5 rounded-md text-label-sm text-on-surface hover:bg-surface-container transition-colors"
                onClick={() => insertMut.mutate(b.id)}
              >
                <span className="font-label-md">{b.name}</span>
                <span className="text-on-surface-variant ml-1">
                  ({(b.items ?? []).length} steps)
                </span>
              </button>
            ))
          )}
          <button
            type="button"
            className="w-full text-label-sm text-on-surface-variant hover:underline pt-xs"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
