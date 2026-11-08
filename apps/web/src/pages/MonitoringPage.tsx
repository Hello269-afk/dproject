import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Activity, AlertTriangle, ScreenShare, Signal, Smartphone, Wifi, WifiOff } from "lucide-react";
import { PageHeader, Unavailable } from "../components/Common";
import { DeviceStatusBadge } from "../components/StatusBadges";
import { Button, Card, EmptyState, ProgressBar, Segmented, Skeleton, StatusDot } from "../components/ui";
import { useFleet } from "../state/store";
import { useNow } from "../hooks/useNow";
import { relativeTime } from "../lib/format";
import { NETWORK_LABEL } from "../lib/labels";
import { deviceSubtitle } from "../lib/devices";
import { cn } from "../lib/cn";
import type { Device } from "../lib/types";

type Filter = "all" | "online" | "attention";

export function MonitoringPage() {
  const map = useFleet((s) => s.devices);
  const state = useFleet((s) => s.devicesState);
  const load = useFleet((s) => s.loadDevices);
  const now = useNow(5000);
  const [filter, setFilter] = useState<Filter>("all");

  const all = useMemo(() => Object.values(map).filter((d) => d.lifecycleStatus !== "revoked"), [map]);
  const devices = useMemo(
    () =>
      all
        .filter((d) => (filter === "online" ? d.online : filter === "attention" ? d.displayStatus === "permission_required" || d.displayStatus === "suspended" || (d.telemetry?.batteryPct ?? 100) < 15 : true))
        .sort(
          (a, b) =>
            Number(b.online) - Number(a.online) ||
            (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "") ||
            a.name.localeCompare(b.name),
        ),
    [all, filter],
  );
  const online = all.filter((d) => d.online).length;

  return (
    <>
      <PageHeader
        title="Live Monitoring"
        description="Battery, network and presence for every active device, streamed in real time."
        actions={
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <span className="inline-flex items-center gap-2">
              <StatusDot tone="success" pulse size="sm" />
              <span className="tnum">
                <span className="font-semibold text-fg">{online}</span> online
              </span>
            </span>
            <span className="tnum">
              <span className="font-semibold text-fg">{all.length - online}</span> offline
            </span>
          </div>
        }
      />
      <div className="mb-4">
        <Segmented<Filter>
          ariaLabel="Filter devices"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "online", label: "Online" },
            { value: "attention", label: "Needs attention" },
          ]}
        />
      </div>
      {state === "idle" || state === "loading" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[188px] rounded-card" />
          ))}
        </div>
      ) : state === "error" ? (
        <Card>
          <EmptyState icon={<AlertTriangle />} title="Couldn't load devices" action={<Button onClick={() => void load()}>Retry</Button>} />
        </Card>
      ) : devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Activity />}
            title={all.length === 0 ? "No devices to monitor" : "Nothing matches this filter"}
            description={all.length === 0 ? "Enrolled devices appear here with live telemetry." : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {devices.map((d) => (
            <MonitorCard key={d.id} device={d} now={now} />
          ))}
        </div>
      )}
    </>
  );
}

function MonitorCard({ device: d, now }: { device: Device; now: number }) {
  const t = d.telemetry;
  const pct = t?.batteryPct;
  const NetIcon = !d.online ? WifiOff : t?.networkType === "cellular" ? Signal : Wifi;
  return (
    <Link to={`/devices/${d.id}`} className="group block rounded-card">
      <Card className={cn("h-full p-4 transition-colors group-hover:border-border-strong", !d.online && "bg-surface/70")}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-muted">
              <Smartphone className="size-4" />
              {d.online && (
                <span className="absolute -right-1 -top-1">
                  <StatusDot tone="success" pulse />
                </span>
              )}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold text-fg">{d.name}</div>
              <div className="truncate text-[12px] text-muted">{deviceSubtitle(d)}</div>
            </div>
          </div>
          {d.activeScreenSessionId && (
            <span className="grid size-6 place-items-center rounded-md bg-session-soft text-session-fg" title="Screen session in progress">
              <ScreenShare className="size-3.5" />
            </span>
          )}
        </div>
        <div className="mt-3">
          <DeviceStatusBadge status={d.displayStatus} />
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="text-muted">Battery{t?.charging ? " · charging" : ""}</span>
              {pct != null ? <span className="tnum font-medium text-fg">{Math.round(pct)}%</span> : <Unavailable />}
            </div>
            <ProgressBar value={pct ?? 0} tone={pct == null ? "neutral" : t?.charging ? "success" : pct < 15 ? "danger" : pct < 30 ? "warning" : "success"} label="Battery" />
          </div>
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-fg-2">
              <NetIcon className="size-3.5 shrink-0 text-muted" />
              <span className="truncate">
                {t?.networkType ? NETWORK_LABEL[t.networkType] : <Unavailable />}
                {t?.wifiSsid && <span className="text-muted"> · {t.wifiSsid}</span>}
              </span>
            </span>
            <span className={cn("tnum shrink-0", d.online ? "font-medium text-success-fg" : "text-muted")}>
              {d.online ? "Live" : relativeTime(d.lastSeenAt, now)}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
