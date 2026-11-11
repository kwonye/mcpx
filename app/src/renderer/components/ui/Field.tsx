import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import "./Field.css";

interface FieldChrome {
  label: string;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Element rendered at the right edge of the label row (e.g. a link). */
  labelAction?: ReactNode;
  className?: string;
}

function FieldShell({ id, label, hideLabel, hint, error, labelAction, className, children }: FieldChrome & { id: string; children: ReactNode }) {
  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      {(!hideLabel || labelAction) && (
        <div className="ui-field__label-row">
          <label htmlFor={id} className={hideLabel ? "visually-hidden" : "ui-field__label"}>{label}</label>
          {labelAction}
        </div>
      )}
      {hideLabel && !labelAction && <label htmlFor={id} className="visually-hidden">{label}</label>}
      {children}
      {error ? (
        <p id={`${id}-error`} className="ui-field__error" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="ui-field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string | null, hint?: ReactNode): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export type InputProps = FieldChrome & Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { mono?: boolean; leading?: ReactNode; inputClassName?: string };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hideLabel, hint, error, labelAction, className, mono, leading, inputClassName, id: idProp, ...rest },
  ref
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} labelAction={labelAction} className={className}>
      <div className={["ui-control", leading ? "ui-control--leading" : "", error ? "ui-control--invalid" : ""].filter(Boolean).join(" ")}>
        {leading && <span className="ui-control__leading" aria-hidden>{leading}</span>}
        <input
          ref={ref}
          id={id}
          className={["ui-control__input", mono ? "mono" : "", inputClassName].filter(Boolean).join(" ")}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          spellCheck={false}
          autoComplete="off"
          {...rest}
        />
      </div>
    </FieldShell>
  );
});

export type TextareaProps = FieldChrome & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & { mono?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hideLabel, hint, error, labelAction, className, mono, id: idProp, ...rest },
  ref
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} labelAction={labelAction} className={className}>
      <textarea
        ref={ref}
        id={id}
        className={["ui-textarea", mono ? "mono" : "", error ? "ui-control--invalid" : ""].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        spellCheck={false}
        {...rest}
      />
    </FieldShell>
  );
});

export type SelectProps = FieldChrome & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hideLabel, hint, error, labelAction, className, id: idProp, children, ...rest },
  ref
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} labelAction={labelAction} className={className}>
      <div className={["ui-control", "ui-control--select", error ? "ui-control--invalid" : ""].filter(Boolean).join(" ")}>
        <select
          ref={ref}
          id={id}
          className="ui-control__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          {...rest}
        >
          {children}
        </select>
        <svg className="ui-control__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </FieldShell>
  );
});
