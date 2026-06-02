import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "secondary" | "success" | "warning" | "error" | "purple" | "blue";
  className?: string;
}

const badgeVariants: Record<string, string> = {
  default: "bg-surface-container-high text-on-surface-variant",
  secondary: "bg-secondary/10 text-secondary",
  success: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-700",
  error: "bg-error-container text-on-error-container",
  purple: "bg-purple-100 text-purple-700",
  blue: "bg-blue-100 text-blue-700",
};

export function Badge({
  children,
  variant = "default",
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeVariants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
