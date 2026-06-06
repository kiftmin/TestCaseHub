import React from "react";

interface PageHeaderProps {
  icon?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  icon,
  eyebrow,
  title,
  description,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`flex items-start justify-between gap-md ${className}`}>
      <div className="min-w-0 flex items-start gap-md">
        {icon && (
          <div className="shrink-0 w-12 h-12 rounded-xl bg-secondary-container text-on-secondary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px]">{icon}</span>
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-label-sm uppercase tracking-widest font-bold text-on-surface-variant">
              {eyebrow}
            </p>
          )}
          <h1 className="font-display-md text-display-md text-primary leading-tight">
            {title}
          </h1>
          {description && (
            <p className="text-body-base text-on-surface-variant mt-1 max-w-2xl">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="shrink-0 flex items-center gap-sm">{actions}</div>}
    </header>
  );
}
