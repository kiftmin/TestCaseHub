import React, { useEffect } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
  contentClassName?: string;
}

const sizeMap: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  contentClassName = "",
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open && typeof window !== "undefined" && !document.body.style.overflow) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-md ${open ? "" : "invisible"}`}
      style={{ pointerEvents: open ? "auto" : "none" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        className={`relative bg-surface-container-lowest rounded-xl shadow-2xl w-full ${sizeMap[size]} mx-4 flex flex-col max-h-[90vh] transform transition-all duration-200 ${
          open ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <div className="flex items-start justify-between px-lg py-md border-b border-outline-variant gap-md shrink-0">
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-primary leading-tight">
              {title}
            </h2>
            {subtitle && (
              <p className="text-body-sm text-on-surface-variant mt-1">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 hover:bg-surface-container-high rounded-full transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-on-surface-variant">close</span>
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto p-lg ${contentClassName}`}>{children}</div>
        {footer && (
          <div className="px-lg py-md border-t border-outline-variant bg-surface shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
