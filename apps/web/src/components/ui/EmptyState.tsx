import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Icon composition: soft concentric rings behind a glyph. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", compact ? "py-8" : "py-14", className)}>
      <div className="relative mb-5 grid place-items-center">
        <div className="absolute size-24 rounded-full border border-border opacity-60" />
        <div className="absolute size-16 rounded-full border border-border" />
        <div className="relative grid size-11 place-items-center rounded-xl border border-border bg-surface text-muted shadow-xs [&_svg]:size-5">
          {icon}
        </div>
      </div>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
