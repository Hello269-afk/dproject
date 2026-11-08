import { Link } from "react-router";
import { useWsDiagnostics } from "../state/realtime";
import { StatusDot } from "./ui";
import { useNow } from "../hooks/useNow";
import type { Tone } from "../lib/labels";

export function ConnectionIndicator() {
  const d = useWsDiagnostics();
  const now = useNow(1000, d.status === "reconnecting");
  let tone: Tone = "neutral";
  let label = "Offline";
  if (d.status === "open") {
    tone = "success";
    label = "Live";
  } else if (d.status === "connecting") {
    tone = "info";
    label = "Connecting";
  } else if (d.status === "reconnecting") {
    tone = "warning";
    const secs = d.nextRetryAt ? Math.max(0, Math.ceil((d.nextRetryAt - now) / 1000)) : null;
    label = secs ? `Reconnecting in ${secs}s` : "Reconnecting";
  }
  const title =
    d.status === "open"
      ? `Real-time connected${d.latencyMs != null ? ` · ${d.latencyMs} ms` : ""}`
      : d.lastError ?? "Real-time updates paused";
  return (
    <Link
      to="/settings#diagnostics"
      title={title}
      className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-fg-2 hover:border-border-strong"
    >
      <StatusDot tone={tone} pulse={d.status === "open"} size="sm" />
      <span className="tnum">{label}</span>
    </Link>
  );
}
