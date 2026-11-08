import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number | null;
  hidden?: boolean;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const visible = items.filter((i) => !i.hidden);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % visible.length;
    if (e.key === "ArrowLeft") next = (idx - 1 + visible.length) % visible.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = visible.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(visible[next].id);
      refs.current[next]?.focus();
    }
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("-mb-px flex gap-1 overflow-x-auto border-b border-border", className)}>
      {visible.map((item, idx) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${item.id}`}
            aria-selected={active}
            aria-controls={`panel-${item.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKey(e, idx)}
            className={cn(
              "relative inline-flex h-10 shrink-0 items-center gap-2 px-3 text-[13px] font-medium transition-colors [&_svg]:size-4",
              active ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {item.icon}
            {item.label}
            {item.count != null && (
              <span className={cn("tnum rounded-full px-1.5 text-[11px]", active ? "bg-accent-soft text-accent-soft-fg" : "bg-surface-2 text-muted")}>
                {item.count}
              </span>
            )}
            <span className={cn("absolute inset-x-2 -bottom-px h-0.5 rounded-full", active ? "bg-accent" : "bg-transparent")} />
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={className}>
      {children}
    </div>
  );
}

/** Compact pill-style segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn("inline-flex rounded-lg border border-border bg-surface-2 p-0.5", disabled && "opacity-70")}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors [&_svg]:size-3.5",
            o.value === value ? "bg-surface text-fg shadow-xs" : "text-muted enabled:hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
