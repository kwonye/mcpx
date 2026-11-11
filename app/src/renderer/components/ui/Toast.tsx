import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { IconButton } from "./IconButton";
import "./Toast.css";

type ToastTone = "success" | "info" | "error";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  /** Errors stay until dismissed. Prefer an InlineAlert next to the failing control when there is one. */
  error: (title: string, description?: string) => void;
  dismiss: (id: number) => void;
}

const SUCCESS_DISMISS_MS = 4000;
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, title: string, description?: string) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-3), { id, tone, title, description }]);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    success: (title, description) => push("success", title, description),
    info: (title, description) => push("info", title, description),
    error: (title, description) => push("error", title, description),
    dismiss
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toasts" aria-live="polite" aria-relevant="additions">
        {items.map((item) => <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    if (item.tone === "error") return;
    const timer = setTimeout(onDismiss, SUCCESS_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.tone, onDismiss]);

  const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? XCircle : Info;
  return (
    <div className={`ui-toast ui-toast--${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
      <Icon className="ui-toast__icon" size={15} strokeWidth={1.9} aria-hidden />
      <div className="ui-toast__text">
        <p className="ui-toast__title">{item.title}</p>
        {item.description && <p className="ui-toast__description">{item.description}</p>}
      </div>
      <IconButton icon={X} label="Dismiss notification" size="sm" onClick={onDismiss} tooltip={false} />
    </div>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
