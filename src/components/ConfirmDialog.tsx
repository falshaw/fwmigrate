"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

/**
 * Glass confirm dialog on the native <dialog> element: focus moves into it
 * and is trapped, Esc and the backdrop cancel, the page behind is inert.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Start on the safe choice
      cancelRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself
        if (e.target === ref.current && !busy) onCancel();
      }}
      className="confirm-dialog glass m-auto w-[calc(100%-32px)] max-w-md p-0 text-ink"
    >
      <div className="p-5 sm:p-6">
        <h2 id={titleId} className="!text-lg">
          {title}
        </h2>
        <div id={bodyId} className="mt-2 text-[13.5px] leading-relaxed text-ink-65">
          {children}
        </div>
        {error && (
          <div className="alert alert-error mt-4" role="alert">
            {error}
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
