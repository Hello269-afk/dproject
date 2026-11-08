import { useMemo } from "react";
import { Link } from "react-router";
import { Check, KeyRound, Minus, X } from "lucide-react";
import { PageHeader } from "../components/Common";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton, toneDot } from "../components/ui";
import { usePermissionCatalog } from "../state/catalog";
import { useFleet } from "../state/store";
import { PERMISSION_STATUS_META, PERMISSION_LABELS } from "../lib/labels";
import { cn } from "../lib/cn";
import { PERMISSION_STATUSES, type PermissionDefinition, type PlatformSupport } from "../lib/types";

export function PermissionsPage() {
  const catalog = usePermissionCatalog();
  return (
    <>
      <PageHeader
        title="Permissions"
        description="What the MDM app can ask for on each platform, how the OS handles it, and where every device stands today."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Android vs iOS" description="From the permission catalog. Users always approve on their own device." icon={<KeyRound />} />
          {catalog.loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : catalog.error || !catalog.permissions ? (
            <EmptyState compact icon={<KeyRound />} title="Couldn't load the catalog" action={<Button onClick={catalog.retry}>Retry</Button>} />
          ) : (
            <div className="divide-y divide-border">
              <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 bg-surface-2/70 px-5 py-2 text-[12px] font-medium text-muted md:grid">
                <span>Permission</span>
                <span>Android</span>
                <span>iOS</span>
              </div>
              {catalog.permissions.map((p) => (
                <CatalogRow key={p.key} def={p} />
              ))}
            </div>
          )}
        </Card>
        <FleetMatrix />
      </div>
    </>
  );
}

function SupportCell({ label, s }: { label: string; s: PlatformSupport }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle md:hidden">{label}</span>
        {s.supported ? <Badge tone="success">Supported</Badge> : <Badge tone="neutral">Not supported</Badge>}
        {s.supported && (s.userApproval ? <Badge tone="warning">User approval</Badge> : <Badge tone="info">No prompt</Badge>)}
      </div>
      {s.supported && <div className="text-[12.5px] text-fg-2">{s.mechanism}</div>}
      {s.notes && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{s.notes}</div>}
    </div>
  );
}

function CatalogRow({ def }: { def: PermissionDefinition }) {
  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-4">
      <div>
        <div className="text-[13.5px] font-semibold text-fg">{def.name}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{def.description}</div>
        <div className="mt-1.5 text-[12px] leading-relaxed text-fg-2">
          <span className="font-medium">Why: </span>
          {def.why}
        </div>
      </div>
      <SupportCell label="Android" s={def.android} />
      <SupportCell label="iOS" s={def.ios} />
    </div>
  );
}

function FleetMatrix() {
  const devicesMap = useFleet((s) => s.devices);
  const state = useFleet((s) => s.devicesState);
  const { byKey } = usePermissionCatalog();
  const devices = useMemo(
    () => Object.values(devicesMap).filter((d) => d.lifecycleStatus !== "revoked").sort((a, b) => a.name.localeCompare(b.name)),
    [devicesMap],
  );
  const keys = useMemo(() => {
    const set = new Set<string>();
    devices.forEach((d) => d.permissions.forEach((p) => set.add(p.key)));
    return [...set].sort() as (keyof typeof PERMISSION_LABELS)[];
  }, [devices]);

  return (
    <Card>
      <CardHeader title="Fleet matrix" description="Permission status for every active device. Outlined cells are required." />
      <div className="flex flex-wrap gap-3 border-b border-border px-5 py-3">
        {PERMISSION_STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className={cn("size-2.5 rounded-sm", toneDot[PERMISSION_STATUS_META[s].tone])} />
            {PERMISSION_STATUS_META[s].label}
          </span>
        ))}
      </div>
      {state !== "ready" ? (
        <div className="p-5">
          <Skeleton className="h-40" />
        </div>
      ) : devices.length === 0 || keys.length === 0 ? (
        <EmptyState compact icon={<KeyRound />} title="No permission data yet" description="Devices report permission states after they enroll." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-surface-2/70">
                <th className="sticky left-0 z-10 bg-surface-2 px-5 py-2 text-left font-medium text-muted">Device</th>
                {keys.map((k) => (
                  <th key={k} className="whitespace-nowrap px-2 py-2 text-center font-medium text-muted">
                    {byKey[k]?.name ?? PERMISSION_LABELS[k] ?? k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {devices.map((d) => (
                <tr key={d.id}>
                  <td className="sticky left-0 z-10 bg-surface px-5 py-2">
                    <Link to={`/devices/${d.id}?tab=permissions`} className="font-medium text-fg hover:text-accent">
                      {d.name}
                    </Link>
                  </td>
                  {keys.map((k) => {
                    const p = d.permissions.find((x) => x.key === k);
                    if (!p) {
                      return (
                        <td key={k} className="px-2 py-2 text-center text-subtle">
                          <Minus className="mx-auto size-3.5" aria-label="Not reported" />
                        </td>
                      );
                    }
                    const meta = PERMISSION_STATUS_META[p.status];
                    const Icon = p.status === "granted" ? Check : p.status === "denied" || p.status === "revoked" ? X : null;
                    return (
                      <td key={k} className="px-2 py-2 text-center">
                        <span
                          title={`${meta.label}${p.required ? " · required" : ""}`}
                          className={cn(
                            "mx-auto grid size-6 place-items-center rounded-md text-white",
                            toneDot[meta.tone],
                            p.required && "ring-2 ring-fg/70 ring-offset-1 ring-offset-surface",
                          )}
                        >
                          {Icon ? <Icon className="size-3.5" strokeWidth={3} /> : <span className="text-[10px] font-bold">•</span>}
                          <span className="sr-only">{meta.label}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
