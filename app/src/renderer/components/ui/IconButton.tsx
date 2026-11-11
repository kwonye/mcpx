import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";
import "./IconButton.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** Accessible name; also shown as a tooltip. Required: icon-only controls must be named. */
  label: string;
  size?: "sm" | "md";
  variant?: "ghost" | "secondary";
  loading?: boolean;
  tooltip?: boolean;
  tooltipSide?: "top" | "bottom";
  tooltipAlign?: "center" | "start" | "end";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = "md", variant = "ghost", loading = false, tooltip = true, tooltipSide = "top", tooltipAlign = "center", disabled, className, type = "button", ...rest },
  ref
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={["ui-icon-button", `ui-icon-button--${size}`, `ui-icon-button--${variant}`, className].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === "sm" ? 12 : 14} /> : <Icon size={size === "sm" ? 14 : 16} strokeWidth={1.75} aria-hidden />}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} role="label" side={tooltipSide} align={tooltipAlign}>
      {button}
    </Tooltip>
  );
});
