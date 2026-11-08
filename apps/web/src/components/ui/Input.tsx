import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

const control =
  "w-full rounded-lg border border-border bg-surface text-fg placeholder:text-subtle shadow-xs transition-colors outline-none hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(function Input(
  { className, icon, ...rest },
  ref,
) {
  if (icon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle [&_svg]:size-4">{icon}</span>
        <input ref={ref} className={cn(control, "h-9 pl-9 pr-3 text-sm", className)} {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cn(control, "h-9 px-3 text-sm", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(control, "min-h-[72px] resize-y px-3 py-2 text-sm leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className={cn("relative", className)}>
      <select ref={ref} className={cn(control, "h-9 appearance-none pl-3 pr-9 text-sm")} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
    </div>
  );
});

/** Label + control + hint/error. Pass `htmlFor` matching the control's id. */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const fallback = useId();
  const Tag = htmlFor ? "label" : "div";
  return (
    <div className={cn("space-y-1.5", className)}>
      <Tag
        htmlFor={htmlFor}
        id={fallback}
        className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-fg-2"
      >
        <span className="flex flex-wrap items-center gap-1">{label}</span>
        {optional && <span className="text-[12px] font-normal text-subtle">Optional</span>}
      </Tag>
      {children}
      {error ? <p className="text-[12px] text-danger-fg">{error}</p> : hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  size = "md",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors disabled:opacity-50",
        size === "sm" ? "h-4 w-7" : "h-5 w-9",
        checked ? "bg-accent" : "bg-surface-3 border-border-strong",
      )}
    >
      <span
        className={cn(
          "inline-block rounded-full bg-white shadow-sm transition-transform",
          size === "sm" ? "size-3" : "size-4",
          checked ? (size === "sm" ? "translate-x-3" : "translate-x-4") : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 shrink-0 cursor-pointer rounded border-border-strong accent-[var(--accent)] disabled:cursor-not-allowed"
    />
  );
}
