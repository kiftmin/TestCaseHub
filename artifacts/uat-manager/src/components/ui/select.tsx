import React from "react";
import { inputBaseClass, inputInvalidClass, inputValidClass } from "./field";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ invalid, className = "", children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={`${inputBaseClass} appearance-none pr-10 ${
            invalid ? inputInvalidClass : inputValidClass
          } ${className}`}
          {...props}
        >
          {children}
        </select>
        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
          expand_more
        </span>
      </div>
    );
  }
);

Select.displayName = "Select";
