import React from "react";

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({
  title,
  description,
  children,
  className = "",
}: FormSectionProps) {
  return (
    <section
      className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-md md:p-lg space-y-md ${className}`}
    >
      <header className="space-y-1">
        <h3 className="font-title-sm text-title-sm text-on-surface">{title}</h3>
        {description && (
          <p className="text-body-sm text-on-surface-variant">{description}</p>
        )}
      </header>
      <div className="space-y-md">{children}</div>
    </section>
  );
}
