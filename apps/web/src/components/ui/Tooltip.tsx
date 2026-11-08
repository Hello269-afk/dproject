import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Lightweight CSS tooltip. Works on disabled children because hover is tracked
 * on the wrapper. When `content` is empty the children render unwrapped.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
  focusable,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
  /** Make the wrapper focusable (use when the child is disabled). */
  focusable?: boolean;
}) {
  const id = useId();
  if (!content) return <>{children}</>;
  return (
    <span
      className={cn("group/tt relative inline-flex", className)}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={id}
    >
      {children}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute left-1/2 z-40 w-max max-w-64 -translate-x-1/2 rounded-lg bg-fg px-2.5 py-1.5 text-[12px] font-medium leading-snug text-bg opacity-0 shadow-card transition-opacity duration-150",
          "group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
        )}
      >
        {content}
      </span>
    </span>
  );
}
