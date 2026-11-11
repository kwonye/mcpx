import type { InputHTMLAttributes, ReactNode } from "react";
import "./Checkbox.css";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  description?: ReactNode;
}

/** A native checkbox with its label; the whole row is the hit target. */
export function Checkbox({ checked, onCheckedChange, children, description, disabled, className, ...rest }: CheckboxProps) {
  return (
    <label className={["ui-checkbox", disabled ? "ui-checkbox--disabled" : "", className].filter(Boolean).join(" ")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onCheckedChange(event.target.checked)} {...rest} />
      <span className="ui-checkbox__text">
        <span className="ui-checkbox__label">{children}</span>
        {description && <span className="ui-checkbox__description">{description}</span>}
      </span>
    </label>
  );
}
