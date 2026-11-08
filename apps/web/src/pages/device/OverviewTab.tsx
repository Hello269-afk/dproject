import type { ReactNode } from "react";
import { AlertTriangle, Battery, Building2, CheckCircle2, Cpu, HardDrive, Info, MapPin, MemoryStick, Monitor, Network, ShieldCheck } from "lucide-react";
import { Badge, Card, CardHeader, ProgressBar } from "../../components/ui";
import { KeyValue, Unavailable } from "../../components/Common";
import { formatBytes, formatDateTime, relativeTime } from "../../lib/format";
import { CAPABILITY_LABEL, MANAGEMENT_MODE_META, NETWORK_LABEL, OWNERSHIP_META, PLATFORM_LABEL } from "../../lib/labels";
import { deviceCapabilities, deviceManagementMode, deviceOwnership } from "../../lib/devices";
import { cn } from "../../lib/cn";
import { CAPABILITIES } from "../../lib/types";
import { SecurityActionsCard } from "./SecurityActions";
import type { Device } from "../../lib/types";
import { useNow } from "../../hooks/useNow";

function V({ children }: { children: ReactNode | null | undefined }) {
  return children === null || children === undefined || children === "" ? <Unavailable /> : <>{children}</>;
}

function UsageCard({
  title,
  icon,
  total,
  free,
  freeLabel,
}: {
  title: string;
  icon: ReactNode;
  total: number | null | undefined;
  free: number | null | undefined;
  freeLabel: string;
}) {
  const known = total != null && free != null && total > 0;
  const used = known ? total - free : null;
  const pct = known ? (used! / total) * 100 : 0;
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      <div className="p-5">
        {known ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="tnum text-[22px] font-semibold tracking-[-0.01em] text-fg">{Math.round(pct)}%</span>
              <span className="tnum text-[12.5px] text-muted">
                {formatBytes(used)} of {formatBytes(total)}
              </span>
            </div>
            <ProgressBar className="mt-3 h-2" value={pct} tone={pct > 90 ? "danger" : pct > 75 ? "warning" : "accent"} label={`${title} used`} />
            <div className="tnum mt-2 text-[12px] text-muted">
              {formatBytes(free)} {freeLabel}
            </div>
          </>
        ) : (
          <div className="py-3 text-[13px]">
            <Unavailable>Unavailable</Unavailable>
            <p className="mt-1 text-[12px] text-subtle">The device hasn't reported this value.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export function OverviewTab({ device }: { device: Device }) {
  const t = device.telemetry;
  const now = useNow(15_000);
  const metadata = Object.entries(device.metadata ?? {});

  return (
    <div className="space-y-4">
      {!t && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-[13px] text-muted">
          <Info className="size-4 shrink-0" /> This device hasn't reported any telemetry yet. Values appear as soon as it connects.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <ManagementCard device={device} />
        <ComplianceCard device={device} now={now} />
        <SecurityActionsCard device={device} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader title="Battery" icon={<Battery />} />
          <div className="p-5">
            {t?.batteryPct != null ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="tnum text-[22px] font-semibold tracking-[-0.01em] text-fg">{Math.round(t.batteryPct)}%</span>
                  <span className="text-[12.5px] text-muted">
                    {t.charging === true ? "Charging" : t.charging === false ? "On battery" : <Unavailable>Charging state unavailable</Unavailable>}
                  </span>
                </div>
                <ProgressBar
                  className="mt-3 h-2"
                  value={t.batteryPct}
                  tone={t.charging ? "success" : t.batteryPct < 15 ? "danger" : t.batteryPct < 30 ? "warning" : "success"}
                  label="Battery level"
                />
              </>
            ) : (
              <div className="py-3 text-[13px]">
                <Unavailable />
              </div>
            )}
          </div>
        </Card>
        <UsageCard title="Storage" icon={<HardDrive />} total={t?.storageTotalBytes} free={t?.storageFreeBytes} freeLabel="free" />
        <UsageCard title="Memory" icon={<MemoryStick />} total={t?.memoryTotalBytes} free={t?.memoryAvailBytes} freeLabel="available" />
        <Card>
          <CardHeader title="Display" icon={<Monitor />} />
          <dl className="divide-y divide-border px-5">
            <KeyValue label="Resolution">
              <V>{t?.screenWidth && t?.screenHeight ? <span className="tnum">{`${t.screenWidth} × ${t.screenHeight}`}</span> : null}</V>
            </KeyValue>
            <KeyValue label="Orientation">
              <V>{t?.orientation ? (t.orientation === "portrait" ? "Portrait" : "Landscape") : null}</V>
            </KeyValue>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Device" icon={<Cpu />} />
          <dl className="divide-y divide-border px-5">
            <KeyValue label="Name">{device.name}</KeyValue>
            <KeyValue label="Manufacturer">
              <V>{device.manufacturer}</V>
            </KeyValue>
            <KeyValue label="Model">
              <V>{device.model}</V>
            </KeyValue>
            <KeyValue label="Platform">
              {PLATFORM_LABEL[device.platform]} {device.osVersion}
            </KeyValue>
            <KeyValue label="MDM app version">
              <V>{device.appVersion}</V>
            </KeyValue>
            <KeyValue label="Assigned user">{device.assignedUser ? `${device.assignedUser.name} · ${device.assignedUser.email}` : <Unavailable>Unassigned</Unavailable>}</KeyValue>
            <KeyValue label="Enrolled">{formatDateTime(device.enrolledAt)}</KeyValue>
            {device.suspendedAt && <KeyValue label="Suspended">{formatDateTime(device.suspendedAt)}</KeyValue>}
            {device.revokedAt && <KeyValue label="Revoked">{formatDateTime(device.revokedAt)}</KeyValue>}
            <KeyValue label="Installation ID" mono>
              {device.installationId}
            </KeyValue>
            <KeyValue label="Device ID" mono>
              {device.id}
            </KeyValue>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Network" icon={<Network />} />
          <dl className="divide-y divide-border px-5">
            <KeyValue label="Status">{device.online ? <span className="text-success-fg">Online</span> : "Offline"}</KeyValue>
            <KeyValue label="Last seen">{device.online ? "Now" : relativeTime(device.lastSeenAt, now)}</KeyValue>
            <KeyValue label="Connection">
              <V>{t?.networkType ? NETWORK_LABEL[t.networkType] ?? t.networkType : null}</V>
            </KeyValue>
            <KeyValue label="Wi-Fi network">
              <V>{t?.wifiSsid}</V>
            </KeyValue>
            <KeyValue label="Carrier">
              <V>{t?.carrier}</V>
            </KeyValue>
            <KeyValue label="IP address" mono>
              <V>{t?.ipAddress}</V>
            </KeyValue>
            <KeyValue label="Telemetry reported">{t ? relativeTime(t.reportedAt, now) : <Unavailable>Never</Unavailable>}</KeyValue>
          </dl>
          <p className="border-t border-border px-5 py-3 text-[12px] text-muted">
            Wi-Fi network name is only reported when the OS allows it (Android requires location access).
          </p>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Location" icon={<MapPin />} />
            <div className="p-5">
              {t?.location ? (
                <dl className="-my-2.5 divide-y divide-border">
                  <KeyValue label="Coordinates" mono>
                    {t.location.lat.toFixed(5)}, {t.location.lng.toFixed(5)}
                  </KeyValue>
                  <KeyValue label="Accuracy">
                    <V>{t.location.accuracyM != null ? `± ${Math.round(t.location.accuracyM)} m` : null}</V>
                  </KeyValue>
                  <KeyValue label="Fixed">{relativeTime(t.location.at, now)}</KeyValue>
                  <div className="pt-3">
                    <a
                      className="text-[12.5px] font-medium text-accent hover:underline"
                      href={`https://www.openstreetmap.org/?mlat=${t.location.lat}&mlon=${t.location.lng}#map=16/${t.location.lat}/${t.location.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in OpenStreetMap
                    </a>
                  </div>
                </dl>
              ) : (
                <div className="text-[13px]">
                  <Unavailable>No location reported</Unavailable>
                </div>
              )}
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                Location is only shown when the device user has granted the location permission.
              </p>
            </div>
          </Card>
          {metadata.length > 0 && (
            <Card>
              <CardHeader title="Metadata" />
              <dl className="divide-y divide-border px-5">
                {metadata.map(([k, v]) => (
                  <KeyValue key={k} label={k}>
                    {v}
                  </KeyValue>
                ))}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ManagementCard({ device }: { device: Device }) {
  const ownership = deviceOwnership(device);
  const mode = deviceManagementMode(device);
  const modeMeta = MANAGEMENT_MODE_META[mode];
  const caps = deviceCapabilities(device);
  const reported = Array.isArray(device.capabilities);
  return (
    <Card>
      <CardHeader title="Management" icon={<Building2 />} />
      <dl className="divide-y divide-border px-5">
        <KeyValue label="Ownership">
          <span title={OWNERSHIP_META[ownership].description}>{OWNERSHIP_META[ownership].label}</span>
        </KeyValue>
        <div className="py-2.5">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[13px] text-muted">Management mode</dt>
            <dd>
              <Badge tone={modeMeta.tone}>{modeMeta.label}</Badge>
            </dd>
          </div>
          <p className="mt-2 flex gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {modeMeta.explanation}
            {ownership === "company" && mode !== "device_owner" && " Company-owned phones get full management only when set up from a factory reset."}
          </p>
        </div>
        <div className="py-2.5">
          <dt className="text-[13px] text-muted">Capabilities</dt>
          <dd className="mt-2 flex flex-wrap gap-1.5">
            {!reported ? (
              <Unavailable>Not reported (older MDM app)</Unavailable>
            ) : (
              CAPABILITIES.map((c) => {
                const on = caps.includes(c);
                return (
                  <span
                    key={c}
                    title={on ? `The device can ${CAPABILITY_LABEL[c].toLowerCase()} right now` : `Not available on this device right now`}
                    className={cn(
                      "inline-flex h-[22px] items-center rounded-md px-1.5 text-[12px] font-medium",
                      on ? "bg-success-soft text-success-fg" : "bg-neutral-soft text-neutral-fg line-through decoration-1",
                    )}
                  >
                    {CAPABILITY_LABEL[c]}
                  </span>
                );
              })
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function ComplianceCard({ device, now }: { device: Device; now: number }) {
  const c = device.compliance ?? null;
  const yesNo = (v: boolean | null | undefined, yes = "Yes", no = "No") =>
    v === true ? <span className="text-success-fg">{yes}</span> : v === false ? <span className="text-caution-fg">{no}</span> : <Unavailable>Unknown</Unavailable>;
  return (
    <Card>
      <CardHeader title="Compliance" icon={<ShieldCheck />} />
      {!c ? (
        <div className="p-5 text-[13px]">
          <Unavailable>Not reported yet</Unavailable>
          <p className="mt-1 text-[12px] text-subtle">The device reports compliance when it connects and every 6 hours.</p>
        </div>
      ) : (
        <>
          <div className="px-5 pt-4">
            {c.issues.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-[13px] font-medium text-success-fg">
                <CheckCircle2 className="size-4" /> Compliant
              </div>
            ) : (
              <div className="rounded-lg border border-caution/30 bg-caution-soft px-3 py-2 text-caution-fg">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <AlertTriangle className="size-4" /> {c.issues.length} {c.issues.length === 1 ? "issue" : "issues"}
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-[12.5px] leading-relaxed">
                  {c.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <dl className="divide-y divide-border px-5">
            <KeyValue label="Policy applied">
              <V>{c.policyVersion != null ? `Version ${c.policyVersion}` : null}</V>
            </KeyValue>
            <KeyValue label="Enforcement">{c.enforced ? "Enforced (device owner)" : "Reported only"}</KeyValue>
            <KeyValue label="Screen lock strong enough">{yesNo(c.passcodeSufficient)}</KeyValue>
            <KeyValue label="Encrypted">{yesNo(c.encrypted)}</KeyValue>
            <KeyValue label="Security patch">
              <V>{c.securityPatch}</V>
            </KeyValue>
            <KeyValue label="Checked">{relativeTime(c.checkedAt, now)}</KeyValue>
          </dl>
        </>
      )}
    </Card>
  );
}
