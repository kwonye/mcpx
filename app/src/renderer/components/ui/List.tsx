import { Children, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import "./List.css";

interface ListProps {
  children: ReactNode;
  label?: string;
  className?: string;
}

/** A bordered group of rows separated by hairlines. */
export function List({ children, label, className }: ListProps) {
  return <ul className={["ui-list", className].filter(Boolean).join(" ")} aria-label={label}>{children}</ul>;
}

interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  /** Status / metadata shown between the title block and the trailing controls. */
  meta?: ReactNode;
  /** Controls (switches, menus). Clicks here never trigger onOpen. */
  trailing?: ReactNode;
  /** Makes the title block a button that opens the item. */
  onOpen?: () => void;
  openLabel?: string;
  selected?: boolean;
  tone?: "default" | "muted";
  children?: ReactNode;
}

export function ListRow({ title, subtitle, leading, meta, trailing, onOpen, openLabel, selected, tone = "default", children }: ListRowProps) {
  const body = (
    <>
      {leading && <span className="ui-row__leading">{leading}</span>}
      <span className="ui-row__text">
        <span className="ui-row__title">{title}</span>
        {subtitle && <span className="ui-row__subtitle">{subtitle}</span>}
      </span>
      {meta && <span className="ui-row__meta">{meta}</span>}
    </>
  );

  return (
    <li className={["ui-row", selected ? "ui-row--selected" : "", tone === "muted" ? "ui-row--muted" : "", onOpen ? "ui-row--interactive" : ""].filter(Boolean).join(" ")}>
      <div className="ui-row__line">
        {onOpen ? (
          <button type="button" className="ui-row__main" onClick={onOpen} aria-label={openLabel} aria-current={selected || undefined}>
            {body}
            <ChevronRight className="ui-row__chevron" size={14} strokeWidth={1.75} aria-hidden />
          </button>
        ) : (
          <div className="ui-row__main">{body}</div>
        )}
        {trailing && <div className="ui-row__trailing">{trailing}</div>}
      </div>
      {Children.toArray(children).length > 0 && <div className="ui-row__extra">{children}</div>}
    </li>
  );
}
