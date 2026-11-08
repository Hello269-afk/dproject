import type { ReactNode } from "react";
import { Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Lock, Smartphone, TabletSmartphone } from "lucide-react";
import { cn } from "../lib/cn";
import { EmptyState } from "./ui";
import type { Platform, Telemetry } from "../lib/types";
import { PLATFORM_LABEL } from "../lib/labels";

export function Unavailable({ children = "Unavailable", className }: { children?: ReactNode; className?: string }) {
  return <span className={cn("text-subtle", className)}>{children}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[12px] font-medium text-muted">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-fg">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PlatformLabel({ platform, className }: { platform: Platform; className?: string }) {
  const Icon = platform === "ios" ? TabletSmartphone : Smartphone;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-fg-2", className)}>
      <Icon className="size-3.5 text-muted" aria-hidden />
      {PLATFORM_LABEL[platform] ?? platform}
    </span>
  );
}

export function BatteryIndicator({ telemetry, className }: { telemetry: Telemetry | null; className?: string }) {
  const pct = telemetry?.batteryPct;
  if (pct === null || pct === undefined) return <Unavailable className={className} />;
  const charging = telemetry?.charging === true;
  const Icon = charging ? BatteryCharging : pct >= 80 ? BatteryFull : pct >= 40 ? BatteryMedium : pct >= 15 ? BatteryLow : Battery;
  const color = charging ? "text-success-fg" : pct < 15 ? "text-danger-fg" : pct < 30 ? "text-warning-fg" : "text-fg-2";
  return (
    <span className={cn("tnum inline-flex items-center gap-1.5", color, className)} title={charging ? "Charging" : undefined}>
      <Icon className="size-4" aria-hidden />
      {Math.round(pct)}%
    </span>
  );
}

export function Avatar({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const letters = (name ?? "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const s = size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-sm" : "size-8 text-[11px]";
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent-soft-fg", s)} aria-hidden>
      {letters || "?"}
    </span>
  );
}

export function NoAccess({ role, what }: { role: string; what: string }) {
  return (
    <EmptyState
      icon={<Lock />}
      title="You don't have access to this"
      description={`${what} requires the ${role} role or higher. Ask an owner or admin if you need it.`}
    />
  );
}

export function KeyValue({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className={cn("min-w-0 break-words text-right text-[13px] text-fg", mono && "font-mono text-[12px]")}>{children}</dd>
    </div>
  );
}
