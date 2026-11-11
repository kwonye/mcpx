import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./Tabs.css";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Extra controls aligned to the right of the tab strip. */
  trailing?: ReactNode;
  /** Content of the selected tab; rendered inside the matching role="tabpanel". */
  children?: ReactNode;
}

/** WAI-ARIA tabs with roving focus (arrow keys, Home/End). */
export function Tabs<T extends string>({ items, value, onChange, label, trailing, children }: TabsProps<T>) {
  const baseId = useId();
  const refs = useRef(new Map<T, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.id === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    const target = items[next];
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  }

  return (
    <div className="ui-tabs">
      <div className="ui-tabs__bar">
        <div role="tablist" aria-label={label} className="ui-tabs__list" onKeyDown={onKeyDown}>
          {items.map((item) => {
            const selected = item.id === value;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  if (node) refs.current.set(item.id, node);
                  else refs.current.delete(item.id);
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                className="ui-tabs__tab"
                onClick={() => onChange(item.id)}
              >
                {item.label}
                {item.count !== undefined && item.count > 0 && <span className="ui-tabs__count">{item.count}</span>}
              </button>
            );
          })}
        </div>
        {trailing && <div className="ui-tabs__trailing">{trailing}</div>}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${value}`} className="ui-tabs__panel">
        {children}
      </div>
    </div>
  );
}
