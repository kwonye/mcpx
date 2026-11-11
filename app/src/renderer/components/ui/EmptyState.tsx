import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import "./EmptyState.css";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "md";
}

export function EmptyState({ icon: Icon, title, description, actions, size = "md" }: EmptyStateProps) {
  return (
    <div className={`ui-empty ui-empty--${size}`}>
      {Icon && (
        <span className="ui-empty__icon" aria-hidden>
          <Icon size={size === "sm" ? 18 : 22} strokeWidth={1.6} />
        </span>
      )}
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__description">{description}</p>}
      {actions && <div className="ui-empty__actions">{actions}</div>}
    </div>
  );
}
