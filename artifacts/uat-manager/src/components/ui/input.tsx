import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", ...props }, ref) => {
    return (
      <div className="space-y-xs">
        {label && (
          <label className="font-label-md text-on-surface-variant block">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full px-md py-sm rounded-lg border bg-surface-container-lowest focus:ring-2 focus:ring-secondary/20 focus:border-secondary transition-all outline-none font-body-base text-on-surface ${
            error ? "border-error" : "border-outline-variant"
          } ${className}`}
          {...props}
        />
        {error && (
          <p className="text-label-sm text-error mt-1">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
