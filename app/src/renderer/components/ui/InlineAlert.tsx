import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from "lucide-react";
import { IconButton } from "./IconButton";
import "./InlineAlert.css";

type AlertTone = "info" | "success" | "warning" | "danger";

interface InlineAlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };

/** A persistent message placed next to the thing it is about. Errors use this, not a toast. */
export function InlineAlert({ tone = "info", title, children, action, onDismiss, className }: InlineAlertProps) {
  const Icon = ICONS[tone];
  return (
    <div className={["ui-alert", `ui-alert--${tone}`, className].filter(Boolean).join(" ")} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="ui-alert__icon" size={15} strokeWidth={1.9} aria-hidden />
      <div className="ui-alert__content">
        {title && <p className="ui-alert__title">{title}</p>}
        {children && <div className="ui-alert__body">{children}</div>}
      </div>
      {action && <div className="ui-alert__action">{action}</div>}
      {onDismiss && <IconButton icon={X} label="Dismiss" size="sm" onClick={onDismiss} tooltip={false} />}
    </div>
  );
}
