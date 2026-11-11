import "./Spinner.css";

interface SpinnerProps {
  size?: number;
  label?: string;
}

/** Indeterminate progress. Decorative unless given a label. */
export function Spinner({ size = 14, label }: SpinnerProps) {
  return (
    <span
      className="ui-spinner"
      style={{ width: size, height: size }}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
