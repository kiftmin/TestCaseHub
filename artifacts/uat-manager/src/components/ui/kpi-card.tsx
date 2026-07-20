import React from "react";

interface KpiCardProps {
  icon: string;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "success" | "warning" | "info" | "danger";
  className?: string;
  onClick?: () => void;
}

const toneStyles: Record<NonNullable<KpiCardProps["tone"]>, { bg: string; icon: string; ring: string }> = {
  default: {
    bg: "bg-surface-container-low",
    icon: "text-secondary",
    ring: "ring-outline-variant/40",
  },
  success: {
    bg: "bg-green-50",
    icon: "text-green-700",
    ring: "ring-green-200",
  },
  warning: {
    bg: "bg-amber-50",
    icon: "text-amber-700",
    ring: "ring-amber-200",
  },
  info: {
    bg: "bg-blue-50",
    icon: "text-blue-700",
    ring: "ring-blue-200",
  },
  danger: {
    bg: "bg-red-50",
    icon: "text-red-700",
    ring: "ring-red-200",
  },
};

export function KpiCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
  className = "",
  onClick,
}: KpiCardProps) {
  const toneStyle = toneStyles[tone];
  const interactive = !!onClick;
  const classNames = `relative overflow-hidden rounded-xl border border-outline-variant ${toneStyle.bg} p-md flex items-start gap-md text-left w-full ${
    interactive ? "hover:shadow-md hover:border-secondary/40 cursor-pointer transition-all active:scale-[0.99]" : ""
  } ${className}`;
  const body = (
    <>
      <div
        className={`shrink-0 w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center ${toneStyle.icon}`}
      >
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-label-sm uppercase tracking-wider text-on-surface-variant font-bold">
          {label}
        </p>
        <p className="font-headline-sm text-headline-sm text-on-surface leading-tight mt-0.5">
          {value}
        </p>
        {hint && (
          <p className="text-label-sm text-on-surface-variant mt-1">{hint}</p>
        )}
      </div>
      {interactive && (
        <span className="material-symbols-outlined text-on-surface-variant text-[18px] opacity-50 self-center">chevron_right</span>
      )}
    </>
  );
  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={classNames}>
        {body}
      </button>
    );
  }
  return <div className={classNames}>{body}</div>;
}
