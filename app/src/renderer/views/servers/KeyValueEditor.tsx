import { Lock, LockOpen, Plus, X } from "lucide-react";
import { Button, IconButton, Tooltip } from "../../components/ui";
import { emptyRow, looksSecret, type BindingKind, type KeyValueRow } from "../../lib/serverSpec";
import "./KeyValueEditor.css";

interface KeyValueEditorProps {
  kind: BindingKind;
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  errors?: Record<string, string>;
}

const COPY: Record<BindingKind, { title: string; keyLabel: string; keyPlaceholder: string; add: string; empty: string }> = {
  env: { title: "Environment variables", keyLabel: "Variable name", keyPlaceholder: "API_KEY", add: "Add variable", empty: "No environment variables." },
  header: { title: "Headers", keyLabel: "Header name", keyPlaceholder: "X-Api-Key", add: "Add header", empty: "No custom headers." }
};

/**
 * Rows of name/value pairs. Each row is either a secret (stored encrypted;
 * blank keeps the current value) or plain text.
 */
export function KeyValueEditor({ kind, rows, onChange, errors = {} }: KeyValueEditorProps) {
  const copy = COPY[kind];

  const update = (id: string, patch: Partial<KeyValueRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  return (
    <fieldset className="kv">
      <legend className="kv__legend">{copy.title}</legend>
      {rows.length === 0 ? (
        <p className="kv__empty">{copy.empty}</p>
      ) : (
        <ul className="kv__rows">
          {rows.map((row, index) => {
            const error = errors[row.id];
            const keepsExisting = row.secret && Boolean(row.originalRef);
            return (
              <li key={row.id} className="kv__row">
                <div className="kv__line">
                  <input
                    className="kv__input kv__input--key mono"
                    aria-label={`${copy.keyLabel} ${index + 1}`}
                    placeholder={copy.keyPlaceholder}
                    value={row.key}
                    disabled={row.managedByOAuth}
                    spellCheck={false}
                    onChange={(event) => {
                      const key = event.target.value;
                      // Until the user decides, follow the name: API_KEY -> secret.
                      const touchedSecret = row.value !== "" || row.originalRef !== undefined;
                      update(row.id, touchedSecret ? { key } : { key, secret: kind === "header" || looksSecret(key) });
                    }}
                  />
                  {row.managedByOAuth ? (
                    <span className="kv__managed">Managed by browser sign-in</span>
                  ) : (
                    <input
                      className="kv__input kv__input--value mono"
                      aria-label={`Value for ${row.key || `${copy.keyLabel.toLowerCase()} ${index + 1}`}`}
                      type={row.secret ? "password" : "text"}
                      placeholder={keepsExisting ? "Saved — leave blank to keep" : "Value"}
                      value={row.value}
                      spellCheck={false}
                      aria-invalid={error ? true : undefined}
                      onChange={(event) => update(row.id, { value: event.target.value })}
                    />
                  )}
                  {!row.managedByOAuth && (
                    <Tooltip content={row.secret ? "Secret: stored encrypted, never shown" : "Plain text: stored as typed"} role="label">
                      <button
                        type="button"
                        className="kv__secret"
                        aria-pressed={row.secret}
                        aria-label={`Store ${row.key || "value"} as a secret`}
                        onClick={() => update(row.id, { secret: !row.secret })}
                      >
                        {row.secret ? <Lock size={14} strokeWidth={1.75} aria-hidden /> : <LockOpen size={14} strokeWidth={1.75} aria-hidden />}
                        <span>{row.secret ? "Secret" : "Plain"}</span>
                      </button>
                    </Tooltip>
                  )}
                  <IconButton icon={X} size="sm" label={`Remove ${row.key || "row"}`} onClick={() => onChange(rows.filter((item) => item.id !== row.id))} />
                </div>
                {error && <p className="kv__error" role="alert">{error}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...rows, emptyRow(kind)])}>{copy.add}</Button>
      </div>
    </fieldset>
  );
}
