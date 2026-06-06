import React from "react";

interface FieldProps {
  label?: React.ReactNode;
  required?: boolean;
  helper?: React.ReactNode;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  label,
  required,
  helper,
  error,
  htmlFor,
  children,
  className = "",
}: FieldProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-label-sm font-label-sm text-on-surface block flex items-center gap-1"
        >
          <span>{label}</span>
          {required && <span className="text-error">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-label-sm text-error flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      ) : helper ? (
        <p className="text-label-sm text-on-surface-variant">{helper}</p>
      ) : null}
    </div>
  );
}

export const inputBaseClass =
  "w-full bg-surface-container-lowest border rounded-lg px-md py-sm text-body-base text-on-surface placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-secondary/20 focus:border-secondary outline-none transition-all";

export const inputInvalidClass = "border-error focus:border-error focus:ring-error/20";
export const inputValidClass = "border-outline-variant";
