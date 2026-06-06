import React from "react";

interface BackBarProps {
  back: { label: string; href: string };
  current: string;
  context?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

export function BackBar({ back, current, context, onBack, right }: BackBarProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center justify-between gap-md text-body-sm"
    >
      <div className="flex items-center gap-xs min-w-0">
        <a
          href={back.href}
          onClick={(e) => {
            e.preventDefault();
            onBack?.();
          }}
          className="inline-flex items-center gap-xs text-on-surface-variant hover:text-on-surface transition-colors font-label-md shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {back.label}
        </a>
        <span className="material-symbols-outlined text-[16px] text-outline-variant">chevron_right</span>
        <span className="font-label-md text-on-surface truncate">{current}</span>
        {context && (
          <>
            <span className="material-symbols-outlined text-[16px] text-outline-variant">chevron_right</span>
            <span className="text-on-surface-variant truncate">{context}</span>
          </>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </nav>
  );
}
