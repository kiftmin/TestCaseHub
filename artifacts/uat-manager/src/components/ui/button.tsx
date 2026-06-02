import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const variants: Record<string, string> = {
  primary:
    "bg-secondary text-on-secondary hover:opacity-90 active:scale-[0.98]",
  secondary:
    "border border-outline-variant text-on-surface hover:bg-surface-container-low",
  ghost: "text-on-surface-variant hover:bg-surface-container-high",
};

const sizes: Record<string, string> = {
  sm: "px-md py-1.5 text-label-sm",
  md: "px-lg py-sm text-label-md",
  lg: "px-xl py-md text-label-md",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-md rounded-lg font-label-md transition-all ${variants[variant]} ${sizes[size]} ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            fill="currentColor"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
