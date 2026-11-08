import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Building2,
  Hourglass,
  ListChecks,
  PlugZap,
  QrCode,
  ScreenShare,
  ShieldAlert,
  Smartphone,
  WifiOff,
} from "lucide-react";
import { PageHeader } from "../components/Common";
import { ActivityList } from "../components/ActivityList";
import { EnrollmentModal } from "../components/EnrollmentModal";
import { Button, Card, CardHeader, EmptyState, Skeleton, toneDot } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { cn } from "../lib/cn";
import { formatNumber, shortDay } from "../lib/format";
import { DEVICE_STATUS_META, PLATFORM_LABEL } from "../lib/labels";
import type { OverviewResponse } from "../lib/types";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { useRealtimeEvent } from "../state/realtime";
import { useAuth } from "../state/auth";
import { useFleet } from "../state/store";
import { deviceOwnership } from "../lib/devices";

export function OverviewPage() {
  const { can, organization } = useAuth();
  const q = useApiQuery((signal) => api.get<OverviewResponse>("/api/overview", { signal }), []);
  const [enrollOpen, setEnrollOpen] = useState(false);

  // Live refresh: any fleet-changing event triggers a debounced refetch.
  const refetch = useDebouncedCallback(() => void q.reload(), 1200);
  useRealtimeEvent("device.updated", refetch);
  useRealtimeEvent("enrollment.updated", refetch);
  useRealtimeEvent("screen.session.updated", refetch);
  useRealtimeEvent("command.updated", refetch);
  useRealtimeEvent("audit.created", ({ log }) => {
    q.setData((prev) => (prev ? { ...prev, recentActivity: [log, ...prev.recentActivity.filter((l) => l.id !== log.id)].slice(0, 12) } : prev));
    refetch();
  });

  const data = q.data;
  const c = data?.counts;
  // Company-owned share comes from the live fleet store (not part of /api/overview).
  const fleet = useFleet((s) => s.devices);
  const fleetReady = useFleet((s) => s.devicesState === "ready");
  const companyOwned = fleetReady
    ? Object.values(fleet).filter((d) => d.lifecycleStatus !== "revoked" && deviceOwnership(d) === "company").length
    : undefined;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Live health of ${organization?.name ?? "your"} fleet. Updates in real time.`}
        actions={
          can("operator") && (
            <Button variant="primary" icon={<QrCode />} onClick={() => setEnrollOpen(true)}>
              Enroll device
            </Button>
          )
        }
      />

      {q.error && !data ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle />}
            title="Couldn't load the overview"
            description={errorMessage(q.error)}
            action={<Button onClick={() => void q.reload()}>Retry</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <Kpi label="Total devices" value={c?.total} icon={<Smartphone />} to="/devices" />
            <Kpi label="Authenticated" value={c?.authenticated} icon={<BadgeCheck />} />
            <Kpi label="Online" value={c?.online} icon={<PlugZap />} tone="success" to="/monitoring" />
            <Kpi label="Offline" value={c?.offline} icon={<WifiOff />} tone="neutral" />
            <Kpi label="Awaiting approval" value={c?.awaitingApproval} icon={<Hourglass />} tone="warning" to="/enrollment" />
            <Kpi label="Live screen sessions" value={c?.activeScreenSessions} icon={<ScreenShare />} tone="session" to="/sessions" />
            <Kpi
              label="Needs attention"
              value={c?.needsAttention}
              icon={<AlertTriangle />}
              tone={c && c.needsAttention > 0 ? "danger" : "neutral"}
              to="/devices?attention=1"
              footnote={c ? `${c.suspended} suspended · ${c.revoked} revoked` : undefined}
            />
            <Kpi
              label="Non-compliant"
              value={c ? c.nonCompliant ?? 0 : undefined}
              icon={<ShieldAlert />}
              tone={c && (c.nonCompliant ?? 0) > 0 ? "caution" : "neutral"}
              to="/devices?status=non_compliant"
            />
            <Kpi
              label="Pending commands"
              value={c ? c.pendingCommands ?? 0 : undefined}
              icon={<ListChecks />}
              tone={c && (c.pendingCommands ?? 0) > 0 ? "warning" : "neutral"}
              footnote="Queued for offline devices"
            />
            <Kpi label="Company-owned" value={companyOwned} icon={<Building2 />} to="/policies" footnote="Fully manageable fleet" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Enrollments" description="New devices enrolled per day" loading={!data}>
              {data && data.enrollmentsByDay.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.enrollmentsByDay} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="enrFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={44} />
                    <Tooltip content={<ChartTooltip unit="enrollments" />} cursor={{ stroke: "var(--border-strong)" }} />
                    <Area type="monotone" dataKey="count" stroke="var(--chart-1)" strokeWidth={2} fill="url(#enrFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty text="No enrollments in this period" />
              )}
            </ChartCard>

            <ChartCard title="Activity" description="Audit events per day" loading={!data}>
              {data && data.activityByDay.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.activityByDay} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={44} />
                    <Tooltip content={<ChartTooltip unit="events" />} cursor={{ fill: "var(--surface-2)" }} />
                    <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty text="No activity in this period" />
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard title="Status" description="Devices by current status" loading={!data}>
              {data && data.statusSplit.some((s) => s.count > 0) ? (
                <SplitBars
                  rows={data.statusSplit
                    .filter((s) => s.count > 0)
                    .sort((a, b) => b.count - a.count)
                    .map((s) => {
                      const m = DEVICE_STATUS_META[s.status];
                      return { key: s.status, label: m?.label ?? s.status, count: s.count, color: toneDot[m?.tone ?? "neutral"] };
                    })}
                  to={(key) => `/devices?status=${key}`}
                />
              ) : (
                <ChartEmpty text="No devices yet" />
              )}
            </ChartCard>

            <ChartCard title="Platforms" description="Devices by operating system" loading={!data}>
              {data && data.platformSplit.some((s) => s.count > 0) ? (
                <SplitBars
                  rows={data.platformSplit
                    .filter((s) => s.count > 0)
                    .map((s, i) => ({
                      key: s.platform,
                      label: PLATFORM_LABEL[s.platform] ?? s.platform,
                      count: s.count,
                      style: { background: i === 0 ? "var(--chart-1)" : "var(--chart-2)" },
                    }))}
                  to={(key) => `/devices?platform=${key}`}
                />
              ) : (
                <ChartEmpty text="No devices yet" />
              )}
            </ChartCard>

            <Card className="flex flex-col">
              <CardHeader
                title="Recent activity"
                icon={<Activity />}
                actions={
                  can("admin") && (
                    <Link to="/audit" className="text-[12.5px] font-medium text-accent hover:underline">
                      View all
                    </Link>
                  )
                }
              />
              <div className="max-h-[300px] min-h-[200px] flex-1 overflow-y-auto">
                {!data ? (
                  <div className="space-y-3 p-5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-9" />
                    ))}
                  </div>
                ) : data.recentActivity.length === 0 ? (
                  <EmptyState compact icon={<Activity />} title="No activity yet" description="Actions by admins and devices show up here." />
                ) : (
                  <ActivityList logs={data.recentActivity} dense />
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      <EnrollmentModal open={enrollOpen} onClose={() => setEnrollOpen(false)} />
    </>
  );
}

const axisTick = { fontSize: 11, fill: "var(--muted)" };

const toneText = {
  success: "text-success-fg bg-success-soft",
  warning: "text-warning-fg bg-warning-soft",
  caution: "text-caution-fg bg-caution-soft",
  danger: "text-danger-fg bg-danger-soft",
  neutral: "text-neutral-fg bg-neutral-soft",
  session: "text-session-fg bg-session-soft",
  accent: "text-accent-soft-fg bg-accent-soft",
};

function Kpi({
  label,
  value,
  icon,
  tone = "accent",
  to,
  footnote,
}: {
  label: string;
  value: number | undefined;
  icon: ReactNode;
  tone?: keyof typeof toneText;
  to?: string;
  footnote?: string;
}) {
  const body = (
    <Card className={cn("h-full p-4 transition-colors", to && "hover:border-border-strong")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        <span className={cn("grid size-7 place-items-center rounded-lg [&_svg]:size-3.5", toneText[tone])}>{icon}</span>
      </div>
      {value === undefined ? (
        <Skeleton className="mt-3 h-7 w-14" />
      ) : (
        <div className="tnum mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg">{formatNumber(value)}</div>
      )}
      {footnote && <div className="tnum mt-1 text-[11.5px] text-muted">{footnote}</div>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-card">
      {body}
    </Link>
  ) : (
    body
  );
}

function ChartCard({ title, description, loading, children }: { title: string; description: string; loading: boolean; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="px-3 pb-4 pt-4 sm:px-4">{loading ? <Skeleton className="mx-2 h-[220px]" /> : children}</div>
    </Card>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return <div className="grid h-[220px] place-items-center text-[13px] text-muted">{text}</div>;
}

interface TooltipPayloadItem {
  value?: number | string;
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: readonly TooltipPayloadItem[]; label?: string | number; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-card">
      <div className="text-muted">{typeof label === "string" ? shortDay(label) : label}</div>
      <div className="tnum mt-0.5 font-semibold text-fg">
        {formatNumber(Number(payload[0].value ?? 0))} <span className="font-normal text-muted">{unit}</span>
      </div>
    </div>
  );
}

function SplitBars({
  rows,
  to,
}: {
  rows: { key: string; label: string; count: number; color?: string; style?: React.CSSProperties }[];
  to: (key: string) => string;
}) {
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-3 px-2 py-1">
      {rows.map((r) => (
        <li key={r.key}>
          <Link to={to(r.key)} className="group block rounded-md" title={`${r.label}: ${r.count} (${Math.round((r.count / total) * 100)}%)`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="truncate text-fg-2 group-hover:text-fg">{r.label}</span>
              <span className="tnum shrink-0 text-muted">
                <span className="font-semibold text-fg">{r.count}</span> · {Math.round((r.count / total) * 100)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className={cn("h-full rounded-full transition-[width] duration-500", r.color)} style={{ width: `${(r.count / max) * 100}%`, ...r.style }} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
