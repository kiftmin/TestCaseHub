import React from "react";

interface KpiCardProps {
  icon: string;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "success" | "warning" | "info";
  className?: string;
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
};

export function KpiCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
  className = "",
}: KpiCardProps) {
  const toneStyle = toneStyles[tone];
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-outline-variant ${toneStyle.bg} p-md flex items-start gap-md ${className}`}
    >
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
    </div>
  );
}
