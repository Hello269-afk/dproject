import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, ChevronRight, Search, ShieldCheck } from "lucide-react";
import { NoAccess, PageHeader } from "../components/Common";
import { Badge, Button, Card, EmptyState, Input, Select, SkeletonRows, Table, TBody, TD, TH, THead, TR } from "../components/ui";
import { auditTargetLink } from "../components/ActivityList";
import { api, errorMessage } from "../lib/api";
import { cn } from "../lib/cn";
import { formatDateTime, humanize } from "../lib/format";
import type { AuditLog } from "../lib/types";
import { useAuth } from "../state/auth";
import { useRealtimeEvent } from "../state/realtime";

const PAGE = 50;
type ActorType = "" | "user" | "device" | "system";

export function AuditPage() {
  const { can } = useAuth();
  if (!can("admin")) {
    return (
      <>
        <PageHeader title="Security & Audit" />
        <Card>
          <NoAccess role="admin" what="The audit log" />
        </Card>
      </>
    );
  }
  return <AuditLogView />;
}

function AuditLogView() {
  const [actionInput, setActionInput] = useState("");
  const [action, setAction] = useState("");
  const [actorType, setActorType] = useState<ActorType>("");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setAction(actionInput.trim()), 350);
    return () => clearTimeout(t);
  }, [actionInput]);

  const fetchPage = useCallback(
    async (before: string | null) => {
      const id = ++reqId.current;
      const res = await api.get<{ logs: AuditLog[]; nextBefore: string | null }>("/api/audit-logs", {
        query: { action: action || undefined, actorType: actorType || undefined, before: before ?? undefined, limit: PAGE },
      });
      return { res, stale: id !== reqId.current };
    },
    [action, actorType],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(null)
      .then(({ res, stale }) => {
        if (cancelled || stale) return;
        setLogs(res.logs);
        setNextBefore(res.nextBefore);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const { res } = await fetchPage(nextBefore);
      setLogs((prev) => [...prev, ...res.logs.filter((l) => !prev.some((p) => p.id === l.id))]);
      setNextBefore(res.nextBefore);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  useRealtimeEvent("audit.created", ({ log }) => {
    if (actorType && log.actorType !== actorType) return;
    if (action && !log.action.toLowerCase().includes(action.toLowerCase())) return;
    setLogs((prev) => (prev.some((l) => l.id === log.id) ? prev : [log, ...prev]));
    setFresh((prev) => new Set(prev).add(log.id));
    setTimeout(
      () =>
        setFresh((prev) => {
          const n = new Set(prev);
          n.delete(log.id);
          return n;
        }),
      2500,
    );
  });

  return (
    <>
      <PageHeader title="Security & Audit" description="An append-only record of every admin, device and system action, streamed live." />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
          <Input
            icon={<Search />}
            placeholder="Filter by action, e.g. device.revoked"
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            aria-label="Filter by action"
            className="sm:w-80"
          />
          <Select aria-label="Filter by actor type" value={actorType} onChange={(e) => setActorType(e.target.value as ActorType)} className="sm:w-44">
            <option value="">All actors</option>
            <option value="user">Users</option>
            <option value="device">Devices</option>
            <option value="system">System</option>
          </Select>
        </div>
        {loading ? (
          <SkeletonRows rows={10} cols={5} />
        ) : error && logs.length === 0 ? (
          <EmptyState icon={<AlertTriangle />} title="Couldn't load the audit log" description={error} />
        ) : logs.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="No matching events" description={action || actorType ? "Try a different filter." : "Events appear here as soon as anything happens."} />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH className="w-8" />
                  <TH>Time</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH className="hidden md:table-cell">Target</TH>
                  <TH className="hidden lg:table-cell">IP</TH>
                </tr>
              </THead>
              <TBody>
                {logs.map((l) => {
                  const open = expanded === l.id;
                  const link = auditTargetLink(l);
                  return (
                    <Fragment key={l.id}>
                      <TR onClick={() => setExpanded(open ? null : l.id)} aria-expanded={open} className={cn(fresh.has(l.id) && "bg-accent-soft/50")}>
                        <TD className="pr-0">
                          <ChevronRight className={cn("size-4 text-subtle transition-transform", open && "rotate-90")} />
                        </TD>
                        <TD className="tnum whitespace-nowrap">{formatDateTime(l.createdAt)}</TD>
                        <TD>
                          <div className="flex items-center gap-2">
                            <Badge tone={l.actorType === "user" ? "accent" : l.actorType === "device" ? "info" : "neutral"}>{humanize(l.actorType)}</Badge>
                            <span className="truncate text-fg">{l.actorName ?? "—"}</span>
                          </div>
                        </TD>
                        <TD>
                          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg">{l.action}</code>
                        </TD>
                        <TD className="hidden md:table-cell">
                          {l.targetType ? (
                            link ? (
                              <Link to={link} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
                                {l.targetType}
                              </Link>
                            ) : (
                              <span>{l.targetType}</span>
                            )
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </TD>
                        <TD className="hidden font-mono text-[12px] lg:table-cell">{l.ip ?? <span className="text-subtle">—</span>}</TD>
                      </TR>
                      {open && (
                        <tr className="bg-surface-2/50">
                          <td colSpan={6} className="px-5 py-4">
                            <dl className="grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
                              <div>
                                <dt className="text-muted">Event ID</dt>
                                <dd className="break-all font-mono text-[11.5px] text-fg">{l.id}</dd>
                              </div>
                              <div>
                                <dt className="text-muted">Actor ID</dt>
                                <dd className="break-all font-mono text-[11.5px] text-fg">{l.actorId ?? "—"}</dd>
                              </div>
                              <div>
                                <dt className="text-muted">Target ID</dt>
                                <dd className="break-all font-mono text-[11.5px] text-fg">{l.targetId ?? "—"}</dd>
                              </div>
                              <div>
                                <dt className="text-muted">IP</dt>
                                <dd className="font-mono text-[11.5px] text-fg">{l.ip ?? "—"}</dd>
                              </div>
                            </dl>
                            <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[11.5px] leading-relaxed text-fg-2">
                              {JSON.stringify(l.metadata ?? {}, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <span className="tnum text-[12px] text-muted">{logs.length} events loaded</span>
              {nextBefore ? (
                <Button size="sm" onClick={loadMore} loading={loadingMore}>
                  Load more
                </Button>
              ) : (
                <span className="text-[12px] text-subtle">End of log</span>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
