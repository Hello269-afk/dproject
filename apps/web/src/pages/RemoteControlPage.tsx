import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Accessibility, Check, Hand, MousePointerClick, Search, ShieldCheck, UserCheck, X } from "lucide-react";
import { PageHeader, PlatformLabel } from "../components/Common";
import { DeviceStatusBadge } from "../components/StatusBadges";
import { Badge, Card, CardHeader, EmptyState, Input, Segmented, Skeleton, Table, TBody, TD, TH, THead, TR } from "../components/ui";
import { cn } from "../lib/cn";
import { remoteControlReadiness } from "../lib/devices";
import { useFleet } from "../state/store";
import { useAuth } from "../state/auth";

const YESES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <MousePointerClick />,
    title: "1. You ask for it",
    body: "When starting a screen session, tick \"Request remote control\". This is only offered when the device has the accessibility service on.",
  },
  {
    icon: <UserCheck />,
    title: "2. The user approves it",
    body: "The consent screen on the phone shows your name, the purpose and that you want control. The user can allow control, or approve view-only.",
  },
  {
    icon: <Accessibility />,
    title: "3. Android allows it",
    body: "The MDM app's accessibility service must be switched on in Android settings. Without it, the app can't perform taps or typing at all.",
  },
];

type Filter = "all" | "ready";

export function RemoteControlPage() {
  const { can } = useAuth();
  const map = useFleet((s) => s.devices);
  const state = useFleet((s) => s.devicesState);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const isOperator = can("operator");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(map)
      .filter((d) => d.lifecycleStatus !== "revoked")
      .filter((d) => !needle || [d.name, d.model, d.assignedUser?.name].some((v) => v?.toLowerCase().includes(needle)))
      .map((d) => ({ device: d, r: remoteControlReadiness(d) }))
      .filter((x) => filter === "all" || x.r.ready)
      .sort((a, b) => Number(b.r.ready) - Number(a.r.ready) || Number(b.device.online) - Number(a.device.online) || a.device.name.localeCompare(b.device.name));
  }, [map, q, filter]);

  const readyCount = useMemo(() => Object.values(map).filter((d) => remoteControlReadiness(d).ready).length, [map]);

  return (
    <>
      <PageHeader
        title="Remote Control"
        description="Tap, swipe and type on an Android phone during a screen session, for hands-on support. It always runs inside a visible, consented screen share."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Three yeses, every time"
            icon={<ShieldCheck />}
            description="Control is only possible when all three are true. Any one of them can be withdrawn at any moment."
          />
          <div className="grid gap-0 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
            {YESES.map((y) => (
              <div key={y.title} className="p-5">
                <div className="mb-3 grid size-9 place-items-center rounded-lg bg-accent-soft text-accent-soft-fg [&_svg]:size-4">{y.icon}</div>
                <div className="text-[13.5px] font-semibold text-fg">{y.title}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{y.body}</p>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-border bg-surface-2/50 px-5 py-4 text-[12.5px] leading-relaxed text-muted">
            <p>
              <Hand className="mr-1.5 inline size-3.5 align-[-2px]" />
              The phone shows a persistent "Remote control active" indicator, and the user can switch control off while the share continues
              view-only.
            </p>
            <p>
              Only the admin who started the session can send input. Each input is counted, and granting, revoking and the total count are
              written to the audit log. Typed text is never logged.
            </p>
            <p>iOS doesn't allow any app to control the screen, so iPhones support view-only sharing only.</p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Device readiness"
            icon={<MousePointerClick />}
            description={`${readyCount} of ${Object.values(map).filter((d) => d.lifecycleStatus !== "revoked").length} devices can be controlled right now.`}
          />
          <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
            <Input
              icon={<Search />}
              placeholder="Search devices…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search devices"
              className="sm:w-72"
            />
            <Segmented<Filter>
              ariaLabel="Filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All devices" },
                { value: "ready", label: `Ready (${readyCount})` },
              ]}
            />
          </div>
          {state !== "ready" ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              icon={<MousePointerClick />}
              title={filter === "ready" ? "No devices ready" : "No devices match"}
              description="A device is ready when it's online, its accessibility service is on and the MDM app reports remote-control support."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Device</TH>
                  <TH>Status</TH>
                  <TH>Online</TH>
                  <TH>Accessibility</TH>
                  <TH>App support</TH>
                  <TH>Readiness</TH>
                  <TH className="text-right">
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {rows.map(({ device: d, r }) => (
                  <TR key={d.id}>
                    <TD>
                      <Link to={`/devices/${d.id}`} className="font-medium text-fg hover:text-accent hover:underline">
                        {d.name}
                      </Link>
                      <div className="text-[12px] text-muted">
                        <PlatformLabel platform={d.platform} className="text-muted" /> · {d.assignedUser?.name ?? "Unassigned"}
                      </div>
                    </TD>
                    <TD>
                      <DeviceStatusBadge status={d.displayStatus} />
                    </TD>
                    <TD>
                      <YesNo ok={r.online} />
                    </TD>
                    <TD>
                      <YesNo ok={r.accessibility} yes="Granted" no="Not granted" />
                    </TD>
                    <TD>
                      <YesNo ok={r.capability} yes="Supported" no="Not reported" />
                    </TD>
                    <TD className="max-w-[280px]">
                      {r.ready ? (
                        <Badge tone="success" dot>
                          Ready
                        </Badge>
                      ) : (
                        <span className="text-[12.5px] leading-snug text-muted">{r.reason}</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      <Link
                        to={isOperator ? `/assist/${d.id}` : `/devices/${d.id}?tab=screen`}
                        className="text-[13px] font-medium text-accent hover:underline"
                      >
                        Open console
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function YesNo({ ok, yes = "Yes", no = "No" }: { ok: boolean; yes?: string; no?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[13px]", ok ? "text-success-fg" : "text-muted")}>
      {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      {ok ? yes : no}
    </span>
  );
}
