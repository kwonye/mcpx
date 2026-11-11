import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  secondaryLabel?: string;
  destructive?: boolean;
  initialFocus?: "cancel" | "confirm";
  onConfirm: () => void;
  onSecondary?: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  secondaryLabel,
  destructive,
  initialFocus,
  onConfirm,
  onSecondary,
  onCancel
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ((initialFocus ?? (destructive ? "cancel" : "confirm")) === "cancel" ? cancelRef.current : confirmRef.current)?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = [cancelRef.current, secondaryRef.current, confirmRef.current].filter(
        (element): element is HTMLButtonElement => element !== null
      );
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
      if (currentIndex === -1) {
        e.preventDefault();
        focusable[0].focus();
        return;
      }
      const nextIndex = e.shiftKey
        ? (currentIndex === 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      if (nextIndex !== currentIndex) {
        e.preventDefault();
        focusable[nextIndex].focus();
      }
    }
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    };
  }, [open, destructive]);

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">{title}</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          {secondaryLabel && onSecondary && (
            <button ref={secondaryRef} type="button" className="btn btn-danger" onClick={onSecondary}>{secondaryLabel}</button>
          )}
          <button ref={confirmRef} className={`btn ${destructive ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
