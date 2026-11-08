import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/labels";

export const toneSoft: Record<Tone, string> = {
  success: "bg-success-soft text-success-fg",
  warning: "bg-warning-soft text-warning-fg",
  caution: "bg-caution-soft text-caution-fg",
  danger: "bg-danger-soft text-danger-fg",
  neutral: "bg-neutral-soft text-neutral-fg",
  session: "bg-session-soft text-session-fg",
  info: "bg-info-soft text-info-fg",
  accent: "bg-accent-soft text-accent-soft-fg",
};

export const toneDot: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  caution: "bg-caution",
  danger: "bg-danger",
  neutral: "bg-neutral",
  session: "bg-session",
  info: "bg-info",
  accent: "bg-accent",
};

export function Badge({
  tone = "neutral",
  children,
  dot,
  pulse,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium leading-none",
        toneSoft[tone],
        className,
      )}
    >
      {dot && <StatusDotInner tone={tone} pulse={pulse} size="sm" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

function StatusDotInner({ tone, pulse, size }: { tone: Tone; pulse?: boolean; size: "sm" | "md" }) {
  const s = size === "sm" ? "size-1.5" : "size-2";
  return (
    <span className={cn("relative inline-flex shrink-0", s)}>
      {pulse && <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", toneDot[tone])} />}
      <span className={cn("relative inline-flex rounded-full", s, toneDot[tone])} />
    </span>
  );
}

export function StatusDot({ tone, pulse, size = "md", label }: { tone: Tone; pulse?: boolean; size?: "sm" | "md"; label?: string }) {
  return (
    <span role={label ? "img" : undefined} aria-label={label} className="inline-flex items-center">
      <StatusDotInner tone={tone} pulse={pulse} size={size} />
    </span>
  );
}
