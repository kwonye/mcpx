interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id: string;
  label?: string;
}

export function Toggle({ checked, onChange, disabled = false, id, label }: ToggleProps) {
  return (
    <div className="toggle-wrapper">
      <input
        type="checkbox"
        className="toggle-checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <label className="toggle-label" htmlFor={id} aria-label={label}>
        <span className="toggle-slider" />
      </label>
    </div>
  );
}
