import { useState, useCallback } from "react";
import { Button } from "../components/ui/button";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

type PendingConfirm = ConfirmOptions;

/**
 * Imperative confirm dialog hook. Returns:
 *  - `ask(opts)`: open a confirmation, calls `onConfirm` if user confirms.
 *  - `dialog`: JSX to render the active dialog (place once in your tree).
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const ask = useCallback((opts: ConfirmOptions) => {
    setPending({ ...opts });
  }, []);

  const close = useCallback(() => {
    setPending(null);
  }, []);

  const handleConfirm = () => {
    pending?.onConfirm();
    setPending(null);
  };

  const dialog = pending ? (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-md"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={close}
        aria-hidden="true"
      />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg space-y-md transform transition-all">
        <div className="flex items-start gap-md">
          {pending.destructive && (
            <div className="w-10 h-10 rounded-full bg-error-container text-error flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined">warning</span>
            </div>
          )}
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-primary leading-tight">
              {pending.title}
            </h2>
            <p className="text-body-sm text-on-surface-variant mt-1">
              {pending.message}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-sm pt-sm">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            className={
              pending.destructive
                ? "!bg-error !text-on-error hover:!brightness-110"
                : ""
            }
          >
            {pending.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dialog, close };
}
