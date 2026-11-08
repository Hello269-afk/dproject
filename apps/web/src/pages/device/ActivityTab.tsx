import { Activity, History } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { Card, CardHeader, EmptyState, Skeleton, Button } from "../../components/ui";
import { ActivityList } from "../../components/ActivityList";
import { PermissionStatusBadge } from "../../components/StatusBadges";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { PERMISSION_LABELS } from "../../lib/labels";
import type { AuditLog, Device, PermissionHistoryEntry } from "../../lib/types";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useRealtimeEvent } from "../../state/realtime";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { usePermissionCatalog } from "../../state/catalog";

export function ActivityTab({ device }: { device: Device }) {
  const { byKey } = usePermissionCatalog();
  const logs = useApiQuery(
    (signal) => api.get<{ logs: AuditLog[] }>(`/api/devices/${device.id}/activity`, { signal }).then((r) => r.logs),
    [device.id],
  );
  const history = useApiQuery(
    (signal) => api.get<{ history: PermissionHistoryEntry[] }>(`/api/devices/${device.id}/permission-history`, { signal }).then((r) => r.history),
    [device.id],
  );

  useRealtimeEvent("audit.created", ({ log }) => {
    if (log.targetId !== device.id) return;
    logs.setData((prev) => (prev ? [log, ...prev.filter((l) => l.id !== log.id)] : prev));
  });
  // Permission changes arrive as device.updated; refresh the history then.
  const reloadHistory = useDebouncedCallback(() => void history.reload(), 800);
  useRealtimeEvent("device.updated", ({ device: d }) => {
    if (d.id === device.id) reloadHistory();
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="Activity" description="Audit events for this device" icon={<Activity />} />
        {logs.loading && !logs.data ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : logs.error ? (
          <EmptyState compact icon={<Activity />} title="Couldn't load activity" description={errorMessage(logs.error)} action={<Button onClick={() => void logs.reload()}>Retry</Button>} />
        ) : !logs.data?.length ? (
          <EmptyState compact icon={<Activity />} title="No activity yet" />
        ) : (
          <ActivityList logs={logs.data} />
        )}
      </Card>
      <Card>
        <CardHeader title="Permission history" description="Every permission change reported by the device" icon={<History />} />
        {history.loading && !history.data ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : history.error ? (
          <EmptyState compact icon={<History />} title="Couldn't load history" description={errorMessage(history.error)} />
        ) : !history.data?.length ? (
          <EmptyState compact icon={<History />} title="No permission changes yet" />
        ) : (
          <ul className="divide-y divide-border">
            {[...history.data]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((h, i) => (
                <li key={`${h.key}-${h.at}-${i}`} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-fg">{byKey[h.key]?.name ?? PERMISSION_LABELS[h.key] ?? h.key}</span>
                    <span className="tnum text-[11.5px] text-muted">{formatDateTime(h.at)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {h.from ? <PermissionStatusBadge status={h.from} /> : <span className="text-[12px] text-muted">Initial</span>}
                    <ArrowRight className="size-3.5 text-subtle" />
                    <PermissionStatusBadge status={h.to} />
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
