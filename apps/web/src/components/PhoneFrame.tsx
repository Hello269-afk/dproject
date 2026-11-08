import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * A realistic CSS phone. `aspect` is the screen's width/height ratio; when
 * landscape the frame rotates (dimensions swap with a smooth transition).
 */
export function PhoneFrame({
  children,
  orientation = "portrait",
  aspect,
  size = "md",
  className,
  label,
  highlight,
}: {
  children: ReactNode;
  orientation?: "portrait" | "landscape";
  aspect?: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
  /** Accent ring around the body, e.g. while the admin is remote-controlling the device. */
  highlight?: boolean;
}) {
  const landscape = orientation === "landscape";
  const fallback = landscape ? 19.5 / 9 : 9 / 19.5;
  let ratio = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : fallback;
  // Keep the frame consistent with the declared orientation.
  if (landscape && ratio < 1) ratio = 1 / ratio;
  if (!landscape && ratio > 1) ratio = 1 / ratio;

  const portraitW = size === "sm" ? 220 : size === "lg" ? 320 : 280;
  const landscapeW = size === "sm" ? 420 : size === "lg" ? 680 : 600;

  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      className={cn("relative mx-auto transition-[width] duration-500 ease-out", className)}
      style={{ width: `min(${landscape ? landscapeW : portraitW}px, 100%)` }}
    >
      {/* side buttons */}
      <span
        aria-hidden
        className={cn(
          "absolute rounded-full bg-[var(--phone-edge)]",
          landscape ? "-top-[3px] left-[22%] h-[3px] w-[12%]" : "-right-[3px] top-[24%] h-[14%] w-[3px]",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute rounded-full bg-[var(--phone-edge)]",
          landscape ? "-bottom-[3px] left-[18%] h-[3px] w-[8%]" : "-left-[3px] top-[18%] h-[7%] w-[3px]",
        )}
      />
      <div
        className={cn(
          "relative rounded-[42px] bg-[var(--phone-body)] p-[9px] shadow-pop ring-1 ring-[var(--phone-edge)] transition-shadow duration-300",
          size === "sm" && "rounded-[34px] p-[7px]",
          highlight && "ring-[3px] ring-accent ring-offset-4 ring-offset-surface-2",
        )}
      >
        <div
          className={cn(
            "relative overflow-hidden bg-black transition-[aspect-ratio] duration-500 ease-out",
            size === "sm" ? "rounded-[28px]" : "rounded-[34px]",
          )}
          style={{ aspectRatio: String(ratio) }}
        >
          {children}
          {/* camera island */}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute z-20 rounded-full bg-black/90 ring-1 ring-white/5",
              landscape ? "left-2.5 top-1/2 h-[22%] w-[18px] -translate-y-1/2" : "left-1/2 top-2.5 h-[18px] w-[28%] -translate-x-1/2",
            )}
          />
        </div>
      </div>
    </div>
  );
}
