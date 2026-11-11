import { useId, type ReactNode } from "react";
import "./Section.css";

interface SectionProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** "card" wraps children in a bordered surface; "plain" leaves layout to the children. */
  variant?: "card" | "plain";
}

/** A titled block within a page (detail pages, settings groups). */
export function Section({ title, description, actions, children, variant = "card" }: SectionProps) {
  const id = useId();
  return (
    <section className="ui-section" aria-labelledby={id}>
      <div className="ui-section__header">
        <div className="ui-section__heading">
          <h2 id={id} className="ui-section__title">{title}</h2>
          {description && <p className="ui-section__description">{description}</p>}
        </div>
        {actions && <div className="ui-section__actions">{actions}</div>}
      </div>
      {variant === "card" ? <div className="ui-section__card">{children}</div> : children}
    </section>
  );
}

interface SettingRowProps {
  label: string;
  description?: ReactNode;
  control: ReactNode;
  /** id of the control so the visible label names it. */
  htmlFor?: string;
  children?: ReactNode;
}

/** Label + description on the left, a control on the right. */
export function SettingRow({ label, description, control, htmlFor, children }: SettingRowProps) {
  return (
    <div className="ui-setting">
      <div className="ui-setting__line">
        <div className="ui-setting__text">
          {htmlFor ? (
            <label className="ui-setting__label" htmlFor={htmlFor}>{label}</label>
          ) : (
            <span className="ui-setting__label">{label}</span>
          )}
          {description && <p className="ui-setting__description">{description}</p>}
        </div>
        <div className="ui-setting__control">{control}</div>
      </div>
      {children}
    </div>
  );
}
