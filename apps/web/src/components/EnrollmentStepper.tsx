import { Check, Ban, Hourglass } from "lucide-react";
import { cn } from "../lib/cn";
import { ENROLLMENT_STEPS, enrollmentStepIndex } from "../lib/labels";
import { formatTime } from "../lib/format";
import type { Enrollment } from "../lib/types";

/** Generated → Scanned → App Opened → Permissions Approved → Authenticated → Connected */
export function EnrollmentStepper({ enrollment, expired }: { enrollment: Enrollment; expired?: boolean }) {
  const terminal = enrollment.status === "revoked" || enrollment.status === "expired" || (expired && enrollment.status !== "connected");
  // For terminal states, show progress up to the last reached step (by timestamps).
  let current = enrollmentStepIndex(enrollment.status);
  if (current < 0) {
    current = 0;
    ENROLLMENT_STEPS.forEach((s, i) => {
      if (s.atKey && (enrollment as unknown as Record<string, string | null>)[s.atKey]) current = i;
    });
  }
  const done = enrollment.status === "connected";

  return (
    <div>
      <ol className="grid gap-3 sm:grid-cols-6 sm:gap-0" aria-label="Enrollment progress">
        {ENROLLMENT_STEPS.map((step, i) => {
          const reached = i <= current;
          const isCurrent = i === current && !done && !terminal;
          const at = step.atKey ? (enrollment as unknown as Record<string, string | null>)[step.atKey] : null;
          return (
            <li key={step.status} className="relative flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2 sm:text-center" aria-current={isCurrent ? "step" : undefined}>
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute hidden h-0.5 sm:block",
                    "right-[calc(50%+18px)] left-[calc(-50%+18px)] top-[15px]",
                    reached ? "bg-accent" : "bg-border",
                  )}
                />
              )}
              <span
                className={cn(
                  "relative grid size-8 shrink-0 place-items-center rounded-full border-2 text-[12px] font-semibold transition-colors",
                  reached && !isCurrent ? "border-accent bg-accent text-accent-fg" : "",
                  isCurrent ? "border-accent bg-surface text-accent" : "",
                  !reached ? "border-border bg-surface text-subtle" : "",
                )}
              >
                {isCurrent && <span className="absolute inset-0 rounded-full bg-accent/30 animate-pulse-ring" />}
                {reached && !isCurrent ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0">
                <div className={cn("text-[12.5px] font-medium leading-tight", reached ? "text-fg" : "text-muted")}>{step.label}</div>
                <div className="tnum mt-0.5 h-4 text-[11px] text-muted">{reached && at ? formatTime(at) : isCurrent ? "Waiting…" : ""}</div>
              </div>
            </li>
          );
        })}
      </ol>
      {terminal && (
        <div
          className={cn(
            "mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]",
            enrollment.status === "revoked" ? "bg-danger-soft text-danger-fg" : "bg-neutral-soft text-neutral-fg",
          )}
        >
          {enrollment.status === "revoked" ? <Ban className="size-4" /> : <Hourglass className="size-4" />}
          {enrollment.status === "revoked"
            ? "This enrollment was revoked. The QR code and pairing code no longer work."
            : "This enrollment expired before the device finished enrolling."}
        </div>
      )}
    </div>
  );
}
