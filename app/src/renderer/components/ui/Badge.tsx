import type { ReactNode } from "react";
import "./Badge.css";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

/** Small static label (e.g. "Built-in", "v1.2.0", "Read-only"). */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return <span className={["ui-badge", `ui-badge--${tone}`, className].filter(Boolean).join(" ")}>{children}</span>;
}

interface StatusDotProps {
  tone: Tone;
  /** Animated ring for in-progress states. */
  pulse?: boolean;
  label?: string;
}

/** Colour dot. Always pair it with text (or pass label) - colour alone is never the signal. */
export function StatusDot({ tone, pulse = false, label }: StatusDotProps) {
  return (
    <span
      className={["ui-dot", `ui-dot--${tone}`, pulse ? "ui-dot--pulse" : ""].filter(Boolean).join(" ")}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

interface StatusLabelProps {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
}

/** Dot + text: the one way a status is shown across the app. */
export function StatusLabel({ tone, children, pulse }: StatusLabelProps) {
  return (
    <span className={`ui-status ui-status--${tone}`}>
      <StatusDot tone={tone} pulse={pulse} />
      <span>{children}</span>
    </span>
  );
}
