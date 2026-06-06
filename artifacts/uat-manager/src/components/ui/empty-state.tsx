import React from "react";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-xl px-md bg-surface-container-lowest border border-dashed border-outline-variant rounded-xl ${className}`}
    >
      <div className="w-14 h-14 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center mb-md">
        <span className="material-symbols-outlined text-[28px]">{icon}</span>
      </div>
      <h3 className="font-title-sm text-title-sm text-on-surface mb-xs">{title}</h3>
      {description && (
        <p className="text-body-sm text-on-surface-variant max-w-md mb-md">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
