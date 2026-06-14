import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "../lib/api-client";
import type { StatusAuditLog, User } from "../types/api";

interface AuditLogEntry extends StatusAuditLog {
  changedBy?: User;
}

const ENTITY_TYPES = [
  { label: "All Entities", value: "" },
  { label: "Project", value: "project" },
  { label: "Defect", value: "defect" },
  { label: "Bug", value: "bug" },
  { label: "Execution", value: "execution" },
] as const;

const DOT_COLORS: Record<string, string> = {
  project: "bg-blue-500",
  defect: "bg-amber-500",
  bug: "bg-red-500",
  execution: "bg-green-500",
};

function getDotColor(entityType: string): string {
  return DOT_COLORS[entityType] ?? "bg-gray-500";
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);

  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return `Yesterday, ${date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDateGroupKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDateGroupLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateOnly.getTime() === today.getTime()) return "Today";
  if (dateOnly.getTime() === yesterday.getTime()) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AuditTrailPage({ params: propParams }: { params?: { id?: string } } = {}) {
  const [, routeParams] = useRoute<{ id: string }>("/projects/:id/audit");
  const projectId = propParams?.id ?? routeParams?.id ?? undefined;
  const [entityType, setEntityType] = useState("");

  const {
    data: logs,
    isLoading,
    isError,
    refetch,
  } = useQuery<AuditLogEntry[]>({
    queryKey: ["audit-log", projectId, entityType],
    queryFn: () => {
      const query = entityType ? `?entityType=${entityType}` : "";
      return customFetch(`/projects/${projectId}/audit-log${query}`);
    },
    enabled: !!projectId,
  });

  useEffect(() => {
    document.title = "Audit Trail | TestCaseHub";
  }, []);

  const grouped = logs?.reduce<Record<string, AuditLogEntry[]>>((acc, log) => {
    const key = getDateGroupKey(log.changed_at);
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});

  const sortedGroups = grouped
    ? Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a))
    : [];

  return (
    <div className="max-w-3xl mx-auto px-gutter py-xl">
      <div className="flex items-center justify-between mb-xl">
        <h1 className="font-display-lg text-display-lg text-primary tracking-tight">
          Audit Trail
        </h1>
      </div>

      <div className="bg-surface-container-lowest/70 backdrop-filter backdrop-blur-md border border-outline-variant rounded-xl p-4 mb-xl flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="w-full appearance-none bg-surface-container-high text-on-surface rounded-lg px-3 py-2 pr-8 text-body-sm outline-none focus:ring-2 focus:ring-secondary cursor-pointer"
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-[18px]">
            expand_more
          </span>
        </div>

        {entityType && (
          <button
            onClick={() => setEntityType("")}
            className="flex items-center gap-1.5 text-label-sm text-on-surface-variant hover:text-on-surface transition-colors px-3 py-2 rounded-lg hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
            Clear filters
          </button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-surface-container-highest animate-pulse" />
                <div className="w-0.5 flex-1 bg-surface-container-highest animate-pulse mt-1" />
              </div>
              <div className="flex-1">
                <div className="bg-surface-container-lowest/70 border border-outline-variant rounded-xl p-4 space-y-2">
                  <div className="h-4 bg-surface-container-highest rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-surface-container-highest rounded animate-pulse w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-[48px] text-error mb-4">
            error_outline
          </span>
          <p className="text-body-base text-on-surface mb-4">
            Failed to load audit logs.
          </p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 bg-secondary text-on-secondary rounded-lg px-4 py-2 text-label-sm hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && sortedGroups.length === 0 && (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant/50 mb-4">
            history
          </span>
          <p className="text-body-base text-on-surface-variant">
            No audit logs found.
          </p>
        </div>
      )}

      {!isLoading && !isError && sortedGroups.length > 0 && (
        <div className="relative">
          {sortedGroups.map(([, entries]) => {
            const groupLabel = getDateGroupLabel(entries[0].changed_at);

            return (
              <div key={groupLabel} className="mb-8 last:mb-0">
                <h2 className="font-title-sm text-title-sm text-on-surface mb-4 sticky top-0 z-10 bg-surface/80 backdrop-filter backdrop-blur-md py-2">
                  {groupLabel}
                </h2>

                {entries.map((entry, idx, arr) => (
                  <div key={entry.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-3 h-3 rounded-full ${getDotColor(entry.entity_type)} ring-2 ring-white z-10`}
                      />
                      {idx < arr.length - 1 && (
                        <div className="w-0.5 flex-1 bg-outline-variant" />
                      )}
                    </div>

                    <div className={`flex-1 ${idx < arr.length - 1 ? "pb-6" : "pb-4"}`}>
                      <div className="bg-surface-container-lowest/70 backdrop-filter backdrop-blur-md border border-outline-variant rounded-xl p-4">
                        <p className="text-body-sm text-on-surface">
                          <span className="font-semibold">
                            {entry.changedBy?.name ?? "System"}
                          </span>{" "}
                          changed{" "}
                          <span className="font-medium capitalize">
                            {entry.entity_type}
                          </span>{" "}
                          #
                          {entry.entity_id}{" "}
                          {entry.from_status && (
                            <>
                              from{" "}
                              <span className="font-medium">
                                '{entry.from_status}'
                              </span>{" "}
                            </>
                          )}
                          to{" "}
                          <span className="font-medium">
                            '{entry.to_status}'
                          </span>
                        </p>

                        {entry.reason && (
                          <p className="text-body-sm text-on-surface-variant italic mt-1">
                            {entry.reason}
                          </p>
                        )}

                        {entry.justification && entry.to_status === "PASSED_BY_AGREEMENT" && (
                          <p className="text-body-sm text-on-surface-variant/70 mt-1">
                            <span className="font-medium">Justification:</span> {entry.justification}
                          </p>
                        )}

                        <p className="text-label-sm text-on-surface-variant/60 mt-1.5">
                          {formatRelativeTime(entry.changed_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
