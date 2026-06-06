import React from "react";
import { inputBaseClass, inputInvalidClass, inputValidClass } from "./field";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ invalid, className = "", ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`${inputBaseClass} resize-y min-h-[72px] ${
          invalid ? inputInvalidClass : inputValidClass
        } ${className}`}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
