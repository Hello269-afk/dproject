import { useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, ScreenShare } from "lucide-react";
import { PageHeader } from "../components/Common";
import { SessionStatusBadge } from "../components/StatusBadges";
import { Button, Card, EmptyState, Select, SkeletonRows, Table, TBody, TD, TH, THead, TR } from "../components/ui";
import { useFleet } from "../state/store";
import { useNow } from "../hooks/useNow";
import { endReasonText, isSessionTerminal, SESSION_STATUS_META } from "../lib/labels";
import { formatDateTime, formatDuration } from "../lib/format";
import { SCREEN_SESSION_STATUSES, type ScreenSessionStatus } from "../lib/types";

export function ScreenSessionsPage() {
  const map = useFleet((s) => s.sessions);
  const state = useFleet((s) => s.sessionsState);
  const load = useFleet((s) => s.loadSessions);
  const [status, setStatus] = useState<ScreenSessionStatus | "">("");
  const now = useNow(1000);

  const sessions = useMemo(
    () =>
      Object.values(map)
        .filter((s) => !status || s.status === status)
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    [map, status],
  );
  const live = Object.values(map).filter((s) => !isSessionTerminal(s.status)).length;

  return (
    <>
      <PageHeader
        title="Screen Sessions"
        description="Every screen-sharing request: who asked, why, whether the user approved, and how it ended."
        actions={
          live > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-session-soft px-3 py-1.5 text-[12.5px] font-medium text-session-fg">
              <ScreenShare className="size-3.5" /> {live} in progress
            </span>
          )
        }
      />
      <Card>
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as ScreenSessionStatus | "")} className="w-full sm:w-52">
            <option value="">All statuses</option>
            {SCREEN_SESSION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SESSION_STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <span className="tnum ml-auto text-[12px] text-muted">{sessions.length} sessions</span>
        </div>
        {state === "idle" || state === "loading" ? (
          <SkeletonRows rows={6} cols={6} />
        ) : state === "error" ? (
          <EmptyState icon={<AlertTriangle />} title="Couldn't load sessions" action={<Button onClick={() => void load()}>Retry</Button>} />
        ) : sessions.length === 0 ? (
          <EmptyState icon={<ScreenShare />} title="No screen sessions" description="Sessions started from a device's page or Remote Assistance appear here." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Device</TH>
                <TH className="hidden md:table-cell">Requested by</TH>
                <TH className="hidden lg:table-cell">Purpose</TH>
                <TH>Status</TH>
                <TH>Duration</TH>
                <TH className="hidden xl:table-cell">End reason</TH>
                <TH className="hidden sm:table-cell text-right">Requested</TH>
              </tr>
            </THead>
            <TBody>
              {sessions.map((s) => {
                const dur = s.startedAt ? new Date(s.endedAt ?? now).getTime() - new Date(s.startedAt).getTime() : null;
                return (
                  <TR key={s.id}>
                    <TD>
                      <Link to={`/devices/${s.deviceId}?tab=screen`} className="font-medium text-fg hover:text-accent">
                        {s.deviceName}
                      </Link>
                    </TD>
                    <TD className="hidden md:table-cell">{s.requestedBy.name}</TD>
                    <TD className="hidden max-w-[280px] truncate lg:table-cell" title={s.purpose}>
                      {s.purpose}
                    </TD>
                    <TD>
                      <SessionStatusBadge status={s.status} />
                    </TD>
                    <TD className="tnum">{dur != null ? formatDuration(dur) : <span className="text-subtle">—</span>}</TD>
                    <TD className="hidden max-w-[260px] truncate text-muted xl:table-cell" title={s.endReason ? endReasonText(s.endReason) : undefined}>
                      {s.endReason ? endReasonText(s.endReason) : "—"}
                    </TD>
                    <TD className="tnum hidden whitespace-nowrap text-right sm:table-cell">{formatDateTime(s.requestedAt)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
