import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import "./Tooltip.css";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: "top" | "bottom";
  align?: "center" | "start" | "end";
  /**
   * "label" when the child already has the same accessible name (icon
   * buttons): the bubble is then purely visual. "description" links it via
   * aria-describedby.
   */
  role?: "label" | "description";
}

const OPEN_DELAY_MS = 450;

export function Tooltip({ content, children, side = "top", align = "center", role = "description" }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (immediate = false) => {
    clear();
    if (immediate) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  useEffect(() => clear, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!isValidElement(children)) return children;

  const trigger = cloneElement(children, {
    "aria-describedby": role === "description" && open ? id : undefined
  });

  return (
    <span
      className="ui-tooltip-anchor"
      onPointerEnter={() => show()}
      onPointerLeave={hide}
      onFocus={(event) => {
        if ((event.target as HTMLElement).matches(":focus-visible")) show(true);
      }}
      onBlur={hide}
    >
      {trigger}
      {open && (
        <span
          id={id}
          role={role === "description" ? "tooltip" : undefined}
          aria-hidden={role === "label" ? true : undefined}
          className={`ui-tooltip ui-tooltip--${side} ui-tooltip--${align}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
