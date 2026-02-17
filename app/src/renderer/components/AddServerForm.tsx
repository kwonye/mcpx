import { useEffect, useState } from "react";

interface RequiredInput {
  name: string;
  description?: string;
  isSecret: boolean;
  kind: "env" | "arg" | "header";
}

interface AddServerFormProps {
  requiredInputs: RequiredInput[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export function AddServerForm({ requiredInputs, onSubmit, onCancel }: AddServerFormProps): JSX.Element | null {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (requiredInputs.length === 0) {
      onSubmit({});
    }
  }, [requiredInputs, onSubmit]);

  if (requiredInputs.length === 0) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form className="add-server-form" onSubmit={handleSubmit}>
      {requiredInputs.map((input) => (
        <div key={input.name} className="form-field">
          <label htmlFor={input.name}>{input.name}</label>
          {input.description && <p className="field-description">{input.description}</p>}
          <input
            id={input.name}
            type={input.isSecret ? "password" : "text"}
            value={values[input.name] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [input.name]: e.target.value }))}
            required
          />
        </div>
      ))}
      <div className="form-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit">Add</button>
      </div>
    </form>
  );
}
