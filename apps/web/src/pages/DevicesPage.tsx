import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AlertTriangle, QrCode, Search, Smartphone, X } from "lucide-react";
import { BatteryIndicator, PageHeader, PlatformLabel, Unavailable } from "../components/Common";
import { DeviceStatusBadge } from "../components/StatusBadges";
import { EnrollmentModal } from "../components/EnrollmentModal";
import { Button, Card, EmptyState, Input, Select, SkeletonRows, Table, TBody, TD, TH, THead, TR } from "../components/ui";
import { useFleet } from "../state/store";
import { useAuth } from "../state/auth";
import { DEVICE_STATUS_META, NETWORK_LABEL } from "../lib/labels";
import { DEVICE_STATUSES, type Device, type DeviceStatus } from "../lib/types";
import { relativeTime, formatDateTime } from "../lib/format";
import { deviceSubtitle } from "../lib/devices";
import { useNow } from "../hooks/useNow";

const ATTENTION: DeviceStatus[] = ["permission_required", "suspended", "revoked", "awaiting_user_approval"];

export function DevicesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const devicesMap = useFleet((s) => s.devices);
  const state = useFleet((s) => s.devicesState);
  const error = useFleet((s) => s.devicesError);
  const loadDevices = useFleet((s) => s.loadDevices);
  const now = useNow(15_000);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const q = params.get("q") ?? "";
  const status = (params.get("status") ?? "") as DeviceStatus | "";
  const platform = params.get("platform") ?? "";
  const attention = params.get("attention") === "1";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const all = useMemo(() => Object.values(devicesMap), [devicesMap]);
  const devices = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((d) => !status || d.displayStatus === status)
      .filter((d) => !platform || d.platform === platform)
      .filter((d) => !attention || ATTENTION.includes(d.displayStatus))
      .filter(
        (d) =>
          !needle ||
          [d.name, d.model, d.manufacturer, d.assignedUser?.name, d.assignedUser?.email, d.telemetry?.ipAddress, d.osVersion]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(needle)),
      )
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }, [all, q, status, platform, attention]);

  const filtered = !!(q || status || platform || attention);

  return (
    <>
      <PageHeader
        title="Devices"
        description="Every enrolled device, live. Click a row for details, telemetry and remote assistance."
        actions={
          can("operator") && (
            <Button variant="primary" icon={<QrCode />} onClick={() => setEnrollOpen(true)}>
              Enroll device
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input
              icon={<Search />}
              placeholder="Search name, model, user, IP…"
              value={q}
              onChange={(e) => setParam("q", e.target.value)}
              aria-label="Search devices"
            />
          </div>
          <div className="flex gap-2">
            <Select aria-label="Filter by status" value={status} onChange={(e) => setParam("status", e.target.value)} className="flex-1 sm:w-48">
              <option value="">All statuses</option>
              {DEVICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DEVICE_STATUS_META[s].label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by platform" value={platform} onChange={(e) => setParam("platform", e.target.value)} className="flex-1 sm:w-36">
              <option value="">All platforms</option>
              <option value="android">Android</option>
              <option value="ios">iOS</option>
            </Select>
          </div>
        </div>
        {(filtered || state === "ready") && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-[12px] text-muted">
            <span className="tnum">
              {devices.length} of {all.length} devices
            </span>
            {attention && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-warning-fg">
                Needs attention
                <button aria-label="Clear needs-attention filter" onClick={() => setParam("attention", "")}>
                  <X className="size-3" />
                </button>
              </span>
            )}
            {filtered && (
              <button className="ml-auto font-medium text-accent hover:underline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </button>
            )}
          </div>
        )}

        {state === "idle" || state === "loading" ? (
          <SkeletonRows rows={8} cols={6} />
        ) : state === "error" ? (
          <EmptyState icon={<AlertTriangle />} title="Couldn't load devices" description={error ?? undefined} action={<Button onClick={() => void loadDevices()}>Retry</Button>} />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Smartphone />}
            title="No devices enrolled yet"
            description="Create an enrollment and scan the QR code with a phone to add your first device."
            action={
              can("operator") && (
                <Button variant="primary" icon={<QrCode />} onClick={() => setEnrollOpen(true)}>
                  Enroll device
                </Button>
              )
            }
          />
        ) : devices.length === 0 ? (
          <EmptyState icon={<Search />} title="No matching devices" description="Try a different search or clear the filters." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Device</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Platform</TH>
                <TH>Battery</TH>
                <TH className="hidden lg:table-cell">Network</TH>
                <TH className="hidden md:table-cell">Assigned to</TH>
                <TH className="text-right">Last seen</TH>
              </tr>
            </THead>
            <TBody>
              {devices.map((d) => (
                <DeviceRow key={d.id} device={d} now={now} onOpen={() => navigate(`/devices/${d.id}`)} />
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <EnrollmentModal open={enrollOpen} onClose={() => setEnrollOpen(false)} />
    </>
  );
}

function DeviceRow({ device: d, now, onOpen }: { device: Device; now: number; onOpen: () => void }) {
  const net = d.telemetry?.networkType;
  return (
    <TR onClick={onOpen} aria-label={`Open ${d.name}`}>
      <TD>
        <div className="flex items-center gap-3">
          <span className="relative grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-muted">
            <Smartphone className="size-4" />
            {d.online && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-success" />}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{d.name}</div>
            <div className="truncate text-[12px] text-muted">{deviceSubtitle(d)}</div>
          </div>
        </div>
      </TD>
      <TD>
        <DeviceStatusBadge status={d.displayStatus} />
      </TD>
      <TD className="hidden md:table-cell">
        <PlatformLabel platform={d.platform} /> <span className="text-muted">{d.osVersion}</span>
      </TD>
      <TD>
        <BatteryIndicator telemetry={d.telemetry} />
      </TD>
      <TD className="hidden lg:table-cell">
        {net ? (
          <span>
            {NETWORK_LABEL[net] ?? net}
            {d.telemetry?.wifiSsid && <span className="text-muted"> · {d.telemetry.wifiSsid}</span>}
            {!d.telemetry?.wifiSsid && d.telemetry?.carrier && <span className="text-muted"> · {d.telemetry.carrier}</span>}
          </span>
        ) : (
          <Unavailable />
        )}
      </TD>
      <TD className="hidden md:table-cell">{d.assignedUser ? d.assignedUser.name : <Unavailable>Unassigned</Unavailable>}</TD>
      <TD className="tnum whitespace-nowrap text-right" title={d.lastSeenAt ? formatDateTime(d.lastSeenAt) : undefined}>
        {d.online ? <span className="font-medium text-success-fg">Online now</span> : relativeTime(d.lastSeenAt, now)}
      </TD>
    </TR>
  );
}
