import React from "react";
import type { StatusVariant } from "./status-variants";

interface StatusChipProps {
  variant: StatusVariant;
  children: React.ReactNode;
  icon?: string;
  size?: "sm" | "md";
  className?: string;
}

const variantStyles: Record<StatusVariant, string> = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  info: "bg-blue-100 text-blue-800",
  warning: "bg-amber-100 text-amber-800",
  success: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  purple: "bg-purple-100 text-purple-800",
};

const iconColor: Record<StatusVariant, string> = {
  neutral: "text-on-surface-variant",
  info: "text-blue-700",
  warning: "text-amber-700",
  success: "text-green-700",
  error: "text-red-700",
  purple: "text-purple-700",
};

export function StatusChip({
  variant,
  children,
  icon,
  size = "sm",
  className = "",
}: StatusChipProps) {
  const sizeClass = size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1";
  const iconSize = size === "sm" ? "text-[12px]" : "text-[14px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-wider ${variantStyles[variant]} ${sizeClass} ${className}`}
    >
      {icon && <span className={`material-symbols-outlined ${iconSize} ${iconColor[variant]}`}>{icon}</span>}
      {children}
    </span>
  );
}
