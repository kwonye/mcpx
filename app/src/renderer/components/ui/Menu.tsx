import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { IconButton } from "./IconButton";
import "./Menu.css";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a separator above this item. */
  separated?: boolean;
}

interface MenuProps {
  /** Accessible name of the trigger, e.g. "More actions for github". */
  label: string;
  items: Array<MenuItem | false | null | undefined>;
  icon?: LucideIcon;
  size?: "sm" | "md";
}

/** An overflow menu: keyboard navigable, closes on Escape / outside click, restores focus. */
export function Menu({ label, items, icon = MoreHorizontal, size = "md" }: MenuProps) {
  const visible = items.filter(Boolean) as MenuItem[];
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = 200;
    const estimatedHeight = visible.length * 30 + 12;
    const below = rect.bottom + 4;
    const top = below + estimatedHeight > window.innerHeight ? Math.max(8, rect.top - estimatedHeight - 4) : below;
    setPosition({ top, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) });
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']:not([disabled])")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onBlur = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [open, position]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([disabled])") ?? []);
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      nodes[(index + 1) % nodes.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      nodes[(index - 1 + nodes.length) % nodes.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      nodes[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      nodes[nodes.length - 1]?.focus();
    }
  }

  if (visible.length === 0) return null;

  return (
    <>
      <IconButton
        ref={triggerRef}
        icon={icon}
        label={label}
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        tooltip={false}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open && position && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="ui-menu"
          style={{ top: position.top, left: position.left }}
          onKeyDown={onKeyDown}
        >
          {visible.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} role="none" className={item.separated ? "ui-menu__group ui-menu__group--separated" : "ui-menu__group"}>
                <button
                  type="button"
                  role="menuitem"
                  className={["ui-menu__item", item.danger ? "ui-menu__item--danger" : ""].filter(Boolean).join(" ")}
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  {Icon ? <Icon size={14} strokeWidth={1.75} aria-hidden /> : <span className="ui-menu__spacer" />}
                  <span>{item.label}</span>
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
