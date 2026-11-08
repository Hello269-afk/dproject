import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, CheckCircle2, Info, RotateCcw, Save, ShieldCheck, ShieldHalf } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Unavailable } from "../components/Common";
import { Badge, Button, Card, CardHeader, EmptyState, Segmented, Select, Skeleton, Table, TBody, TD, TH, THead, Toggle, TR } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { cn } from "../lib/cn";
import { relativeTime } from "../lib/format";
import { MANAGEMENT_MODE_META, OWNERSHIP_META, PASSCODE_META } from "../lib/labels";
import { deviceManagementMode, deviceOwnership } from "../lib/devices";
import type { Device, PasscodeLevel, Policy, PolicyInput } from "../lib/types";
import { useApiQuery } from "../hooks/useApiQuery";
import { useNow } from "../hooks/useNow";
import { useAuth } from "../state/auth";
import { useFleet } from "../state/store";

const LOCK_TIMEOUTS: { value: number; label: string }[] = [
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 1800, label: "30 minutes" },
];

const PATCH_AGES = [30, 60, 90, 180, 365];

function toInput(p: Policy): PolicyInput {
  return {
    passcode: p.passcode,
    maxScreenLockTimeoutSec: p.maxScreenLockTimeoutSec,
    disableCamera: p.disableCamera,
    disallowUsbDebugging: p.disallowUsbDebugging,
    disallowFactoryResetByUser: p.disallowFactoryResetByUser,
    minAndroidPatchAgeDays: p.minAndroidPatchAgeDays,
  };
}

function sameInput(a: PolicyInput, b: PolicyInput) {
  return (Object.keys(a) as (keyof PolicyInput)[]).every((k) => a[k] === b[k]);
}

export function PoliciesPage() {
  const { can } = useAuth();
  const isAdmin = can("admin");
  const now = useNow(30_000);
  const q = useApiQuery((signal) => api.get<{ policy: Policy }>("/api/policy", { signal }), []);
  const policy = q.data?.policy;
  const [draft, setDraft] = useState<PolicyInput | null>(null);
  const [saving, setSaving] = useState(false);
  const devices = useFleet((s) => s.devices);

  useEffect(() => {
    if (policy) setDraft(toInput(policy));
  }, [policy]);

  const companyCount = useMemo(
    () => Object.values(devices).filter((d) => deviceOwnership(d) === "company" && d.lifecycleStatus !== "revoked").length,
    [devices],
  );

  const dirty = !!policy && !!draft && !sameInput(draft, toInput(policy));
  const set = <K extends keyof PolicyInput>(k: K, v: PolicyInput[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft || !isAdmin) return;
    setSaving(true);
    try {
      const res = await api.put<{ policy: Policy; queuedToDevices: number }>("/api/policy", draft);
      q.setData(() => ({ policy: res.policy }));
      const queued = res.queuedToDevices;
      toast.success(`Policy saved (version ${res.policy.version})`, {
        description:
          queued > 0
            ? `Queued to ${queued} company-owned ${queued === 1 ? "device" : "devices"}. Offline devices apply it when they reconnect.`
            : "No company-owned devices to apply it to yet. Personal devices report compliance against it.",
      });
    } catch (err) {
      toast.error("Could not save the policy", { description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Device Policies"
        description="One security policy for the whole organisation. Company-owned phones enforce it; personal phones report whether they meet it."
        actions={
          isAdmin &&
          draft && (
            <>
              <Button icon={<RotateCcw />} disabled={!dirty || saving} onClick={() => policy && setDraft(toInput(policy))}>
                Discard changes
              </Button>
              <Button variant="primary" icon={<Save />} loading={saving} disabled={!dirty} onClick={() => void save()}>
                Save policy
              </Button>
            </>
          )
        }
      />

      <div className="space-y-6">
        <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info-soft p-4 text-[13px] leading-relaxed text-info-fg">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong className="font-semibold">Enforced on company-owned phones, reported on personal ones.</strong> Phones set up from a
            factory reset (device owner) apply these rules: Android itself requires the screen lock, disables the camera and so on. Personal
            (BYOD) phones apply nothing; they only report whether they meet the policy, and show as Non-compliant when they don't. Saving
            sends an apply-policy command to every company-owned device.
          </div>
        </div>

        {q.error && !policy ? (
          <Card>
            <EmptyState
              icon={<AlertTriangle />}
              title="Couldn't load the policy"
              description={errorMessage(q.error)}
              action={<Button onClick={() => void q.reload()}>Retry</Button>}
            />
          </Card>
        ) : !policy || !draft ? (
          <Card className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </Card>
        ) : (
          <Card>
            <CardHeader
              title="Security policy"
              icon={<ShieldHalf />}
              description={
                <>
                  Version {policy.version} · updated {relativeTime(policy.updatedAt, now)}
                  {policy.updatedBy && ` by ${policy.updatedBy.name}`}
                </>
              }
              actions={!isAdmin && <Badge tone="neutral">Read only · admin role required to edit</Badge>}
            />
            <div className="divide-y divide-border">
              <Row
                title="Screen lock strength"
                help={
                  <>
                    The minimum screen-lock complexity. {PASSCODE_META[draft.passcode].help} Personal phones are flagged if their lock is
                    weaker.
                  </>
                }
              >
                <Segmented<PasscodeLevel>
                  ariaLabel="Screen lock strength"
                  options={(Object.keys(PASSCODE_META) as PasscodeLevel[]).map((k) => ({ value: k, label: PASSCODE_META[k].label }))}
                  value={draft.passcode}
                  disabled={!isAdmin}
                  onChange={(v) => set("passcode", v)}
                />
              </Row>
              <Row
                title="Auto-lock after"
                help="The longest the screen may stay on while idle before it locks itself. Users can still choose a shorter time."
              >
                <Select
                  aria-label="Auto-lock after"
                  className="w-full sm:w-48"
                  disabled={!isAdmin}
                  value={draft.maxScreenLockTimeoutSec == null ? "" : String(draft.maxScreenLockTimeoutSec)}
                  onChange={(e) => set("maxScreenLockTimeoutSec", e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">Not enforced</option>
                  {draft.maxScreenLockTimeoutSec != null && !LOCK_TIMEOUTS.some((o) => o.value === draft.maxScreenLockTimeoutSec) && (
                    <option value={draft.maxScreenLockTimeoutSec}>{draft.maxScreenLockTimeoutSec} seconds</option>
                  )}
                  {LOCK_TIMEOUTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Row>
              <Row title="Disable camera" help="Turns off every camera on company-owned phones. Useful for secure sites.">
                <Toggle label="Disable camera" checked={draft.disableCamera} disabled={!isAdmin} onChange={(v) => set("disableCamera", v)} />
              </Row>
              <Row
                title="Block USB debugging"
                help="Stops developer-mode USB debugging, which can be used to copy data off the phone or install unvetted apps."
              >
                <Toggle
                  label="Block USB debugging"
                  checked={draft.disallowUsbDebugging}
                  disabled={!isAdmin}
                  onChange={(v) => set("disallowUsbDebugging", v)}
                />
              </Row>
              <Row
                title="Block factory reset by the user"
                help="Company-owned phones only. Stops someone resetting a lost or stolen phone to get around management. Admins can still wipe it remotely."
              >
                <Toggle
                  label="Block factory reset by the user"
                  checked={draft.disallowFactoryResetByUser}
                  disabled={!isAdmin}
                  onChange={(v) => set("disallowFactoryResetByUser", v)}
                />
              </Row>
              <Row
                title="Maximum security-patch age"
                help="A compliance check only, never enforced: phones whose Android security patch is older than this are flagged as Non-compliant."
              >
                <Select
                  aria-label="Maximum security-patch age"
                  className="w-full sm:w-48"
                  disabled={!isAdmin}
                  value={draft.minAndroidPatchAgeDays == null ? "" : String(draft.minAndroidPatchAgeDays)}
                  onChange={(e) => set("minAndroidPatchAgeDays", e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">Not checked</option>
                  {draft.minAndroidPatchAgeDays != null && !PATCH_AGES.includes(draft.minAndroidPatchAgeDays) && (
                    <option value={draft.minAndroidPatchAgeDays}>{draft.minAndroidPatchAgeDays} days</option>
                  )}
                  {PATCH_AGES.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </Select>
              </Row>
            </div>
            {isAdmin && dirty && (
              <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2/60 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-end">
                <span className="text-[12.5px] text-muted sm:mr-auto">
                  Unsaved changes. Saving queues the policy to {companyCount} company-owned {companyCount === 1 ? "device" : "devices"}.
                </span>
                <Button onClick={() => setDraft(toInput(policy))} disabled={saving}>
                  Discard
                </Button>
                <Button variant="primary" icon={<Save />} loading={saving} onClick={() => void save()}>
                  Save policy
                </Button>
              </div>
            )}
          </Card>
        )}

        <ComplianceTable policy={policy ?? null} now={now} />
      </div>
    </>
  );
}

function Row({ title, help, children }: { title: string; help: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0 max-w-2xl">
        <div className="text-[13.5px] font-medium text-fg">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{help}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function patchAgeDays(patch: string | null, now: number): number | null {
  if (!patch) return null;
  const t = new Date(`${patch}T00:00:00Z`).getTime();
  return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : null;
}

type Filter = "all" | "issues";

function ComplianceTable({ policy, now }: { policy: Policy | null; now: number }) {
  const map = useFleet((s) => s.devices);
  const state = useFleet((s) => s.devicesState);
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    const score = (d: Device) => (d.compliance == null ? 1 : d.compliance.issues.length > 0 ? 0 : 2);
    return Object.values(map)
      .filter((d) => d.lifecycleStatus !== "revoked")
      .filter((d) => filter === "all" || (d.compliance?.issues.length ?? 0) > 0)
      .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  }, [map, filter]);

  const issueCount = useMemo(
    () => Object.values(map).filter((d) => d.lifecycleStatus !== "revoked" && (d.compliance?.issues.length ?? 0) > 0).length,
    [map],
  );

  return (
    <Card>
      <CardHeader
        title="Compliance"
        icon={<ShieldCheck />}
        description="What each device last reported against the policy. Devices report on connect, after applying a policy, and every 6 hours."
        actions={
          <Segmented<Filter>
            ariaLabel="Filter devices"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "issues", label: `With issues (${issueCount})` },
            ]}
          />
        }
      />
      {state !== "ready" ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={<ShieldCheck />}
          title={filter === "issues" ? "No compliance issues" : "No devices yet"}
          description={filter === "issues" ? "Every device that reported meets the policy." : "Enrolled devices appear here."}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Device</TH>
              <TH>Ownership</TH>
              <TH>Management</TH>
              <TH>Policy version</TH>
              <TH>Compliance</TH>
              <TH>Security patch</TH>
              <TH>Encrypted</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((d) => {
              const c = d.compliance ?? null;
              const mode = MANAGEMENT_MODE_META[deviceManagementMode(d)];
              const applied = c?.policyVersion ?? null;
              const age = patchAgeDays(c?.securityPatch ?? null, now);
              const tooOld = age != null && policy?.minAndroidPatchAgeDays != null && age > policy.minAndroidPatchAgeDays;
              return (
                <TR key={d.id}>
                  <TD>
                    <Link to={`/devices/${d.id}`} className="font-medium text-fg hover:text-accent hover:underline">
                      {d.name}
                    </Link>
                    <div className="text-[12px] text-muted">{d.online ? "Online" : `Last seen ${relativeTime(d.lastSeenAt, now)}`}</div>
                  </TD>
                  <TD className="whitespace-nowrap">{OWNERSHIP_META[deviceOwnership(d)].short}</TD>
                  <TD>
                    <Badge tone={mode.tone} title={mode.explanation}>
                      {mode.label}
                    </Badge>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {applied == null ? (
                      <Unavailable>Not applied</Unavailable>
                    ) : policy && applied < policy.version ? (
                      <Badge tone="warning" title="The device hasn't applied the latest policy yet">
                        v{applied} of v{policy.version}
                      </Badge>
                    ) : (
                      <span className="tnum">
                        v{applied}
                        {policy && applied === policy.version && <span className="text-muted"> · current</span>}
                      </span>
                    )}
                    {c && <div className="text-[11.5px] text-muted">{c.enforced ? "Enforced" : "Reported only"}</div>}
                  </TD>
                  <TD className="min-w-[220px]">
                    {!c ? (
                      <Unavailable>Not reported</Unavailable>
                    ) : c.issues.length === 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-success-fg">
                        <CheckCircle2 className="size-3.5" /> Compliant
                      </span>
                    ) : (
                      <ul className="space-y-0.5 text-[12.5px] text-caution-fg">
                        {c.issues.map((i) => (
                          <li key={i} className="flex gap-1.5">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            {i}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {c?.securityPatch ? (
                      <>
                        <span className={cn("tnum", tooOld && "font-medium text-caution-fg")}>{c.securityPatch}</span>
                        {age != null && <div className={cn("text-[11.5px]", tooOld ? "text-caution-fg" : "text-muted")}>{age} days old</div>}
                      </>
                    ) : (
                      <Unavailable />
                    )}
                  </TD>
                  <TD>
                    {c?.encrypted === true ? (
                      <span className="text-success-fg">Yes</span>
                    ) : c?.encrypted === false ? (
                      <span className="font-medium text-caution-fg">No</span>
                    ) : (
                      <Unavailable>Unknown</Unavailable>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
