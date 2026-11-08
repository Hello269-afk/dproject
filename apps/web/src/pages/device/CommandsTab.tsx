import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ListChecks, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton, Table, TBody, TD, TH, THead, TR } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime, relativeTime } from "../../lib/format";
import { COMMAND_ACTION_LABEL, COMMAND_STATUS_META, isCommandOpen } from "../../lib/labels";
import { realtime } from "../../lib/ws";
import type { Device, DeviceCommand } from "../../lib/types";
import { useFleet } from "../../state/store";
import { useAuth } from "../../state/auth";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useNow } from "../../hooks/useNow";
import { SecurityActionsCard } from "./SecurityActions";

function When({ at, now }: { at: string | null; now: number }) {
  if (!at) return <span className="text-subtle">—</span>;
  return (
    <span className="whitespace-nowrap" title={formatDateTime(at)}>
      {relativeTime(at, now)}
    </span>
  );
}

export function CommandsTab({ device }: { device: Device }) {
  const { can } = useAuth();
  const now = useNow(30_000);
  const upsertCommands = useFleet((s) => s.upsertCommands);
  const all = useFleet((s) => s.commands);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const q = useApiQuery(
    (signal) => api.get<{ commands: DeviceCommand[] }>(`/api/devices/${device.id}/commands`, { signal }),
    [device.id],
  );

  // REST seeds the store; command.updated (handled by RealtimeProvider) keeps it live.
  useEffect(() => {
    if (q.data) upsertCommands(q.data.commands);
  }, [q.data, upsertCommands]);
  // Refetch after a WebSocket reconnect to cover any missed updates.
  const reload = q.reload;
  useEffect(
    () =>
      realtime.onOpen((isReconnect) => {
        if (isReconnect) void reload();
      }),
    [reload],
  );

  const commands = useMemo(
    () => Object.values(all).filter((c) => c.deviceId === device.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [all, device.id],
  );

  const cancel = async (c: DeviceCommand) => {
    setCancelling(c.id);
    try {
      const { command } = await api.post<{ command: DeviceCommand }>(`/api/commands/${c.id}/cancel`);
      upsertCommands([command]);
      toast.success(`${COMMAND_ACTION_LABEL[c.action] ?? c.action} cancelled`);
    } catch (err) {
      toast.error("Could not cancel the command", { description: errorMessage(err) });
    } finally {
      setCancelling(null);
    }
  };

  const isAdmin = can("admin");

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="min-w-0">
        <CardHeader
          title="Commands"
          icon={<ListChecks />}
          description="Remote actions sent to this device. Queued commands are delivered the next time it connects."
        />
        {q.loading && !q.data && commands.length === 0 ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : q.error && !q.data && commands.length === 0 ? (
          <EmptyState
            compact
            icon={<AlertTriangle />}
            title="Couldn't load commands"
            description={errorMessage(q.error)}
            action={<Button onClick={() => void q.reload()}>Retry</Button>}
          />
        ) : commands.length === 0 ? (
          <EmptyState compact icon={<ListChecks />} title="No commands yet" description="Lock, reboot, wipe and policy updates appear here." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Action</TH>
                <TH>Status</TH>
                <TH>Requested by</TH>
                <TH>Reason</TH>
                <TH>Created</TH>
                <TH>Sent</TH>
                <TH>Completed</TH>
                <TH>Error</TH>
                {isAdmin && (
                  <TH className="text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                )}
              </tr>
            </THead>
            <TBody>
              {commands.map((c) => {
                const meta = COMMAND_STATUS_META[c.status] ?? { label: c.status, tone: "neutral" as const };
                return (
                  <TR key={c.id}>
                    <TD className="whitespace-nowrap font-medium text-fg">{COMMAND_ACTION_LABEL[c.action] ?? c.action}</TD>
                    <TD>
                      <Badge tone={meta.tone} dot pulse={c.status === "sent"} title={meta.description}>
                        {meta.label}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap">{c.requestedBy?.name ?? <span className="text-subtle">System</span>}</TD>
                    <TD className="max-w-[240px]">
                      <span className="line-clamp-2 break-words" title={c.reason}>
                        {c.reason || <span className="text-subtle">—</span>}
                      </span>
                    </TD>
                    <TD>
                      <When at={c.createdAt} now={now} />
                    </TD>
                    <TD>
                      <When at={c.sentAt} now={now} />
                    </TD>
                    <TD>
                      <When at={c.completedAt} now={now} />
                    </TD>
                    <TD className="max-w-[220px]">
                      {c.error ? (
                        <span className="line-clamp-2 break-words text-danger-fg" title={c.error}>
                          {c.error}
                        </span>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </TD>
                    {isAdmin && (
                      <TD className="text-right">
                        {isCommandOpen(c.status) && (
                          <Button size="sm" variant="ghost" icon={<X />} loading={cancelling === c.id} onClick={() => void cancel(c)}>
                            Cancel
                          </Button>
                        )}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      <SecurityActionsCard device={device} />
    </div>
  );
}
