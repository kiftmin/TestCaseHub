import React from "react";

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode;
}

export function Label({ children, className = "", ...props }: LabelProps) {
  return (
    <label
      className={`font-label-md text-on-surface-variant block ${className}`}
      {...props}
    >
      {children}
    </label>
  );
}
