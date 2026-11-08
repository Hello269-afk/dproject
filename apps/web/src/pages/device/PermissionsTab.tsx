import { Fragment, useState } from "react";
import { ChevronRight, KeyRound } from "lucide-react";
import { Badge, Card, EmptyState, Table, TBody, TD, TH, THead, TR } from "../../components/ui";
import { PermissionStatusBadge } from "../../components/StatusBadges";
import { usePermissionCatalog } from "../../state/catalog";
import { PERMISSION_LABELS } from "../../lib/labels";
import { formatDateTime, relativeTime } from "../../lib/format";
import { cn } from "../../lib/cn";
import type { Device } from "../../lib/types";

export function PermissionsTab({ device }: { device: Device }) {
  const { byKey } = usePermissionCatalog();
  const [open, setOpen] = useState<string | null>(null);
  const perms = [...device.permissions].sort((a, b) => Number(b.required) - Number(a.required) || a.key.localeCompare(b.key));
  const missing = perms.filter((p) => p.required && p.status !== "granted");

  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-warning-fg">
          {missing.length} required permission{missing.length > 1 ? "s are" : " is"} not granted:{" "}
          {missing.map((p) => byKey[p.key]?.name ?? PERMISSION_LABELS[p.key]).join(", ")}. Only the device user can grant
          permissions, from the MDM app or system settings.
        </div>
      )}
      <Card>
        {perms.length === 0 ? (
          <EmptyState icon={<KeyRound />} title="No permissions reported" description="The device reports permission states after enrollment." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-8" />
                <TH>Permission</TH>
                <TH>Status</TH>
                <TH>Required</TH>
                <TH className="text-right">Last updated</TH>
              </tr>
            </THead>
            <TBody>
              {perms.map((p) => {
                const def = byKey[p.key];
                const expanded = open === p.key;
                const platform = device.platform;
                return (
                  <Fragment key={p.key}>
                    <TR onClick={() => setOpen(expanded ? null : p.key)} aria-expanded={expanded}>
                      <TD className="pr-0">
                        <ChevronRight className={cn("size-4 text-subtle transition-transform", expanded && "rotate-90")} />
                      </TD>
                      <TD>
                        <div className="font-medium text-fg">{def?.name ?? PERMISSION_LABELS[p.key] ?? p.key}</div>
                        {def && <div className="hidden text-[12px] text-muted sm:block">{def.description}</div>}
                      </TD>
                      <TD>
                        <PermissionStatusBadge status={p.status} />
                      </TD>
                      <TD>{p.required ? <Badge tone="accent">Required</Badge> : <span className="text-muted">Optional</span>}</TD>
                      <TD className="tnum whitespace-nowrap text-right" title={formatDateTime(p.updatedAt)}>
                        {relativeTime(p.updatedAt)}
                      </TD>
                    </TR>
                    {expanded && (
                      <tr className="bg-surface-2/50">
                        <td colSpan={5} className="px-5 py-4">
                          {def ? (
                            <div className="grid gap-4 text-[13px] md:grid-cols-3">
                              <div>
                                <div className="mb-1 text-[12px] font-medium text-muted">What it is</div>
                                <p className="leading-relaxed text-fg-2">{def.description}</p>
                              </div>
                              <div>
                                <div className="mb-1 text-[12px] font-medium text-muted">Why it's requested</div>
                                <p className="leading-relaxed text-fg-2">{def.why}</p>
                              </div>
                              <div>
                                <div className="mb-1 text-[12px] font-medium text-muted">How the user manages it ({platform === "ios" ? "iOS" : "Android"})</div>
                                <p className="leading-relaxed text-fg-2">{def.manageInstructions[platform]}</p>
                                <p className="mt-2 text-[12px] text-muted">
                                  Mechanism: {def[platform].mechanism}
                                  {def[platform].notes && ` · ${def[platform].notes}`}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[13px] text-muted">No catalog entry for this permission.</p>
                          )}
                          {p.key === "screen_capture" && (
                            <p className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] text-muted">
                              Screen capture is per-session consent. "Granted" means the user allows the organisation to ask. The OS still
                              asks every time a session starts, and nothing is captured unless a session is live.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
