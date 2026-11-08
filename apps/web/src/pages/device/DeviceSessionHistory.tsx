import { useMemo } from "react";
import { History } from "lucide-react";
import { Card, CardHeader, EmptyState, Table, TBody, TD, TH, THead, TR } from "../../components/ui";
import { SessionStatusBadge } from "../../components/StatusBadges";
import { useFleet } from "../../state/store";
import { formatDateTime, formatDuration } from "../../lib/format";
import { endReasonText } from "../../lib/labels";

export function DeviceSessionHistory({ deviceId }: { deviceId: string }) {
  const sessionsMap = useFleet((s) => s.sessions);
  const sessions = useMemo(
    () =>
      Object.values(sessionsMap)
        .filter((s) => s.deviceId === deviceId)
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
        .slice(0, 10),
    [sessionsMap, deviceId],
  );
  return (
    <Card>
      <CardHeader title="Recent sessions" description="Last 10 screen sessions for this device" icon={<History />} />
      {sessions.length === 0 ? (
        <EmptyState compact icon={<History />} title="No screen sessions yet" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Requested</TH>
              <TH>By</TH>
              <TH className="hidden md:table-cell">Purpose</TH>
              <TH>Status</TH>
              <TH>Duration</TH>
              <TH className="hidden lg:table-cell">Outcome</TH>
            </tr>
          </THead>
          <TBody>
            {sessions.map((s) => (
              <TR key={s.id}>
                <TD className="tnum whitespace-nowrap">{formatDateTime(s.requestedAt)}</TD>
                <TD>{s.requestedBy.name}</TD>
                <TD className="hidden max-w-xs truncate md:table-cell" title={s.purpose}>
                  {s.purpose}
                </TD>
                <TD>
                  <SessionStatusBadge status={s.status} />
                </TD>
                <TD className="tnum">
                  {s.startedAt ? formatDuration(new Date(s.endedAt ?? Date.now()).getTime() - new Date(s.startedAt).getTime()) : "—"}
                </TD>
                <TD className="hidden text-muted lg:table-cell">{s.endReason ? endReasonText(s.endReason) : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
