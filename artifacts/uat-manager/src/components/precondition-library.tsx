import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Field, inputBaseClass, inputValidClass } from "./ui/field";
import { customFetch } from "../lib/api-client";
import type { ProjectPrecondition } from "../types/api";

interface PreconditionLibraryProps {
  projectId: number;
  canEdit: boolean;
}

export function PreconditionLibrary({ projectId, canEdit }: PreconditionLibraryProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["project-preconditions", projectId],
    queryFn: () =>
      customFetch<ProjectPrecondition[]>(`/projects/${projectId}/preconditions`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["project-preconditions", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const createMut = useMutation({
    mutationFn: (text: string) =>
      customFetch<ProjectPrecondition>(`/projects/${projectId}/preconditions`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      setDraft("");
      invalidate();
      toast.success("Precondition added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (d: { id: number; text: string }) =>
      customFetch<ProjectPrecondition>(`/preconditions/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({ text: d.text }),
      }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
      toast.success("Precondition updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/preconditions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Precondition removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="border border-outline-variant rounded-xl p-md bg-surface-container-lowest space-y-md">
      <header className="flex items-start justify-between gap-md">
        <div>
          <h3 className="font-title-sm text-title-sm text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-secondary text-[20px]">
              fact_check
            </span>
            Preconditions
          </h3>
          <p className="text-body-sm text-on-surface-variant mt-1">
            Shared setup notes for this project. Attach them when you create or edit a test case.
          </p>
        </div>
        <span className="text-label-sm text-on-surface-variant shrink-0">
          {items.length} snippet{items.length !== 1 ? "s" : ""}
        </span>
      </header>

      {isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant border border-dashed border-outline-variant rounded-lg p-md">
          No shared preconditions yet.
          {canEdit
            ? " Add common setup notes (e.g. “User has Manager role”) so authors don’t retype them."
            : ""}
        </p>
      ) : (
        <ul className="space-y-sm">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-sm p-sm rounded-lg border border-outline-variant bg-surface"
            >
              {editingId === item.id ? (
                <div className="flex-1 space-y-sm">
                  <textarea
                    rows={2}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className={`${inputBaseClass} resize-y ${inputValidClass}`}
                    autoFocus
                  />
                  <div className="flex gap-sm">
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (!editText.trim()) {
                          toast.error("Text is required");
                          return;
                        }
                        updateMut.mutate({ id: item.id, text: editText.trim() });
                      }}
                      loading={updateMut.isPending}
                    >
                      Save
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="flex-1 text-body-sm text-on-surface whitespace-pre-wrap">
                    {item.text}
                  </p>
                  {canEdit && (
                    <div className="flex items-center gap-xs shrink-0">
                      <button
                        type="button"
                        className="text-on-surface-variant hover:text-secondary p-1"
                        title="Edit"
                        onClick={() => {
                          setEditingId(item.id);
                          setEditText(item.text);
                        }}
                      >
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button
                        type="button"
                        className="text-on-surface-variant hover:text-error p-1"
                        title="Delete"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Remove this precondition from the library? It will be unlinked from all test cases."
                            )
                          ) {
                            deleteMut.mutate(item.id);
                          }
                        }}
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="space-y-sm pt-sm border-t border-outline-variant">
          <Field label="Add precondition" helper="Short, reusable setup note for this project.">
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder='e.g. User is logged into the VW network'
              className={`${inputBaseClass} resize-y ${inputValidClass}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draft.trim()) {
                  createMut.mutate(draft.trim());
                }
              }}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={() => {
              if (!draft.trim()) {
                toast.error("Enter precondition text");
                return;
              }
              createMut.mutate(draft.trim());
            }}
            loading={createMut.isPending}
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add to library
          </Button>
        </div>
      )}
    </section>
  );
}

/** Multi-select chips for attaching library preconditions to a test case. */
export function PreconditionPicker({
  projectId,
  selectedIds,
  onChange,
  freeText,
  onFreeTextChange,
}: {
  projectId: number;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  freeText: string;
  onFreeTextChange: (v: string) => void;
}) {
  const { data: items = [] } = useQuery({
    queryKey: ["project-preconditions", projectId],
    queryFn: () =>
      customFetch<ProjectPrecondition[]>(`/projects/${projectId}/preconditions`),
  });

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="space-y-sm">
      <Field
        label="Library preconditions"
        helper="Select shared setup notes from this project’s library."
      >
        {items.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            No library items yet. Add them on the Test Plan tab under Precondition library.
          </p>
        ) : (
          <div className="flex flex-wrap gap-sm">
            {items.map((item) => {
              const on = selectedIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.id)}
                  className={`text-left text-label-sm px-sm py-1.5 rounded-lg border max-w-full transition-colors ${
                    on
                      ? "border-secondary bg-secondary/10 text-on-surface"
                      : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
                  }`}
                  title={item.text}
                >
                  <span className="material-symbols-outlined text-[14px] align-middle mr-1">
                    {on ? "check_box" : "check_box_outline_blank"}
                  </span>
                  <span className="line-clamp-2">{item.text}</span>
                </button>
              );
            })}
          </div>
        )}
      </Field>
      <Field
        label="Precondition (free text)"
        helper="Optional. A case-specific precondition not already in the library."
      >
        <textarea
          rows={2}
          value={freeText}
          onChange={(e) => onFreeTextChange(e.target.value)}
          placeholder="e.g. This case only — invoice #123 exists"
          className={`${inputBaseClass} resize-y ${inputValidClass}`}
        />
      </Field>
    </div>
  );
}
