import { Bot, Cpu, User as UserIcon } from "lucide-react";
import { Link } from "react-router";
import type { AuditLog } from "../lib/types";
import { humanize, relativeTime, formatDateTime } from "../lib/format";
import { useNow } from "../hooks/useNow";
import { cn } from "../lib/cn";

const actorIcon = { user: UserIcon, device: Cpu, system: Bot };

export function auditTargetLink(log: AuditLog): string | null {
  if (!log.targetId) return null;
  if (log.targetType === "device") return `/devices/${log.targetId}`;
  return null;
}

export function ActivityList({ logs, dense }: { logs: AuditLog[]; dense?: boolean }) {
  const now = useNow(30_000);
  return (
    <ul className="divide-y divide-border">
      {logs.map((log) => {
        const Icon = actorIcon[log.actorType] ?? Bot;
        const link = auditTargetLink(log);
        return (
          <li key={log.id} className={cn("flex items-start gap-3", dense ? "px-4 py-2.5" : "px-5 py-3")}>
            <span
              className={cn(
                "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg",
                log.actorType === "user" ? "bg-accent-soft text-accent-soft-fg" : log.actorType === "device" ? "bg-info-soft text-info-fg" : "bg-neutral-soft text-neutral-fg",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] leading-snug text-fg">
                <span className="font-medium">{log.actorName ?? humanize(log.actorType)}</span>{" "}
                <span className="text-fg-2">{humanize(log.action).toLowerCase()}</span>
                {log.targetType && (
                  <>
                    {" "}
                    {link ? (
                      <Link to={link} className="text-muted underline decoration-border underline-offset-2 hover:text-fg">
                        {log.targetType}
                      </Link>
                    ) : (
                      <span className="text-muted">{log.targetType}</span>
                    )}
                  </>
                )}
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted" title={formatDateTime(log.createdAt)}>
                {relativeTime(log.createdAt, now)}
                {log.ip && <span className="font-mono"> · {log.ip}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
