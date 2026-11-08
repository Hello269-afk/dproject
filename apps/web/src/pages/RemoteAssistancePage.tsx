import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, LifeBuoy, Search, Smartphone } from "lucide-react";
import { NoAccess, PageHeader, BatteryIndicator } from "../components/Common";
import { DeviceStatusBadge } from "../components/StatusBadges";
import { ScreenSessionConsole } from "../components/ScreenSessionConsole";
import { MessagesPanel } from "../components/MessagesPanel";
import { Badge, Card, EmptyState, Input, Skeleton } from "../components/ui";
import { useFleet } from "../state/store";
import { useAuth } from "../state/auth";
import { deviceSubtitle } from "../lib/devices";

export function RemoteAssistancePage() {
  const { can } = useAuth();
  const { id } = useParams();
  if (!can("operator")) {
    return (
      <>
        <PageHeader title="Remote Assistance" />
        <Card>
          <NoAccess role="operator" what="Remote assistance" />
        </Card>
      </>
    );
  }
  return id ? <AssistConsole id={id} /> : <DevicePicker />;
}

function DevicePicker() {
  const map = useFleet((s) => s.devices);
  const state = useFleet((s) => s.devicesState);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const devices = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(map)
      .filter((d) => d.online && d.lifecycleStatus === "authenticated")
      .filter((d) => !needle || [d.name, d.model, d.assignedUser?.name].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => Number(!!b.activeScreenSessionId) - Number(!!a.activeScreenSessionId) || a.name.localeCompare(b.name));
  }, [map, q]);

  return (
    <>
      <PageHeader
        title="Remote Assistance"
        description="Pick an online device to request screen sharing and chat with its user. Every session needs the user's approval on the device."
      />
      <Card>
        <div className="border-b border-border p-3">
          <Input icon={<Search />} placeholder="Search online devices…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search online devices" />
        </div>
        {state !== "ready" ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy />}
            title={q ? "No online devices match" : "No devices online"}
            description="Remote assistance needs the device to be connected. Devices appear here the moment they come online."
          />
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => navigate(`/assist/${d.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/70 sm:px-5"
                >
                  <span className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-muted">
                    <Smartphone className="size-4" />
                    <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-success" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-fg">{d.name}</div>
                    <div className="truncate text-[12px] text-muted">
                      {deviceSubtitle(d)} · {d.assignedUser?.name ?? "Unassigned"}
                    </div>
                  </div>
                  <div className="hidden items-center gap-3 sm:flex">
                    {d.activeScreenSessionId && <Badge tone="session">Session in progress</Badge>}
                    <BatteryIndicator telemetry={d.telemetry} />
                    <DeviceStatusBadge status={d.displayStatus} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function AssistConsole({ id }: { id: string }) {
  const device = useFleet((s) => s.devices[id]);
  const state = useFleet((s) => s.devicesState);
  if (!device) {
    if (state !== "ready") return <Skeleton className="h-[600px] rounded-card" />;
    return (
      <EmptyState
        icon={<Smartphone />}
        title="Device not found"
        action={
          <Link to="/assist" className="text-[13px] font-medium text-accent hover:underline">
            Back to device list
          </Link>
        }
      />
    );
  }
  return (
    <>
      <Link to="/assist" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All devices
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {device.name} <DeviceStatusBadge status={device.displayStatus} />
          </span>
        }
        description={`${deviceSubtitle(device)} · ${device.assignedUser?.name ?? "Unassigned"}`}
        actions={
          <Link to={`/devices/${device.id}`} className="text-[13px] font-medium text-accent hover:underline">
            Device details
          </Link>
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <ScreenSessionConsole device={device} stacked />
        <MessagesPanel device={device} className="h-[640px] xl:sticky xl:top-0 xl:h-[calc(100dvh-140px)]" />
      </div>
    </>
  );
}
