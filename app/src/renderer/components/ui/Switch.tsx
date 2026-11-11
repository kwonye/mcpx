import type { ButtonHTMLAttributes } from "react";
import "./Switch.css";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name when there is no visible <label htmlFor>. */
  label?: string;
  size?: "sm" | "md";
  busy?: boolean;
}

/** A toggle with role="switch", keyboard support (Space/Enter) and a visible focus ring. */
export function Switch({ checked, onCheckedChange, label, size = "md", busy = false, disabled, className, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      className={["ui-switch", `ui-switch--${size}`, className].filter(Boolean).join(" ")}
      onClick={(event) => {
        event.stopPropagation();
        if (!busy) onCheckedChange(!checked);
      }}
      {...rest}
    >
      <span className="ui-switch__thumb" aria-hidden />
    </button>
  );
}
