import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { IconButton } from "../components/ui";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Renders a back button before the title (detail pages). */
  onBack?: () => void;
  backLabel?: string;
  /** Inline elements after the title (e.g. a status). */
  titleAccessory?: ReactNode;
}

/** Top of every page. On macOS it doubles as the window drag region. */
export function PageHeader({ title, description, actions, onBack, backLabel = "Back", titleAccessory }: PageHeaderProps) {
  return (
    <header className="page-header drag-region">
      <div className="page-header__inner">
        {onBack && <IconButton icon={ArrowLeft} label={backLabel} onClick={onBack} tooltipSide="bottom" tooltipAlign="start" />}
        <div className="page-header__titles">
          <div className="page-header__title-row">
            <h1 className="page-header__title">{title}</h1>
            {titleAccessory}
          </div>
          {description && <p className="page-header__description">{description}</p>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </header>
  );
}

/** Scrollable page body with the standard max width. */
export function PageBody({ children, width = "default" }: { children: ReactNode; width?: "default" | "wide" }) {
  return (
    <div className="page-body">
      <div className={`page-body__inner page-body__inner--${width}`}>{children}</div>
    </div>
  );
}
