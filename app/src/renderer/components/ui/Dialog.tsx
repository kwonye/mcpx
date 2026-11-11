import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";
import "./Dialog.css";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** "right" renders a full-height side sheet. */
  placement?: "center" | "right";
  /** When false, Escape / backdrop / close button do nothing (e.g. while saving). */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Accessible role; use "alertdialog" for confirmations. */
  role?: "dialog" | "alertdialog";
}

/**
 * The single modal primitive: portal, backdrop, focus trap, Escape to close,
 * focus restored to the trigger on close. Confirm, auth and detail overlays
 * are all built on it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  placement = "center",
  dismissible = true,
  initialFocusRef,
  role = "dialog"
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target = initialFocusRef?.current
      ?? panel?.querySelector<HTMLElement>("[data-autofocus]")
      ?? panel?.querySelector(".ui-dialog__body")?.querySelector<HTMLElement>(FOCUSABLE)
      ?? panel?.querySelector(".ui-dialog__footer")?.querySelector<HTMLElement>(FOCUSABLE)
      ?? panel;
    target?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (dismissibleRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[hidden]"));
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div
      className={`ui-dialog-backdrop ui-dialog-backdrop--${placement}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`ui-dialog ui-dialog--${size} ui-dialog--${placement}`}
      >
        <header className="ui-dialog__header">
          <div className="ui-dialog__heading">
            <h2 id={titleId} className="ui-dialog__title">{title}</h2>
            {description && <p id={descriptionId} className="ui-dialog__description">{description}</p>}
          </div>
          {dismissible && <IconButton icon={X} label="Close" size="sm" onClick={onClose} tooltip={false} />}
        </header>
        {children !== undefined && <div className="ui-dialog__body">{children}</div>}
        {footer && <footer className="ui-dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
