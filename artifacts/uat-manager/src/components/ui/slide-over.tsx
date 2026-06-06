import React, { useEffect } from "react";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  size?: "md" | "lg";
  closeOnBackdrop?: boolean;
  contentClassName?: string;
}

export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "lg",
  closeOnBackdrop = true,
  contentClassName = "",
}: SlideOverProps) {
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

  const widthClass = size === "lg" ? "max-w-2xl" : "max-w-md";

  return (
    <div
      className={`fixed inset-0 z-[100] ${open ? "" : "invisible"}`}
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
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div
          className={`w-screen ${widthClass} transform transition-transform duration-500 ease-in-out bg-surface-container-lowest shadow-2xl flex flex-col ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between px-lg py-md border-b border-outline-variant bg-surface gap-md shrink-0">
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
          <div className={`flex-1 overflow-y-auto ${contentClassName}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}
