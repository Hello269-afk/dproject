import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/labels";
import { toneDot } from "./Badge";

export function ProgressBar({ value, tone = "accent", className, label }: { value: number; tone?: Tone; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", toneDot[tone])} style={{ width: `${v}%` }} />
    </div>
  );
}
