import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { InlineAlert } from "./InlineAlert";
import { errorMessage } from "../../lib/errors";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * May return a promise; the dialog shows progress until it settles. If it
   * rejects, the error is shown inside the dialog and the dialog stays open.
   */
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      size="sm"
      role="alertdialog"
      dismissible={!busy}
      initialFocusRef={destructive ? cancelRef : undefined}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={() => void confirm()} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : undefined}
    </Dialog>
  );
}
