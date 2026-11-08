import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { AlertTriangle, Building2, Check, Copy, Download, KeyRound, Link2, QrCode, RotateCcw, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Checkbox, Dialog, Field, Input, Segmented, Select, Skeleton, Toggle } from "./ui";
import { EnrollmentStepper } from "./EnrollmentStepper";
import { PhoneFrame } from "./PhoneFrame";
import { api, errorMessage } from "../lib/api";
import { cn } from "../lib/cn";
import { formatCountdown, formatPairingCode } from "../lib/format";
import { OWNERSHIP_META, ROLE_META } from "../lib/labels";
import type { CreateEnrollmentBody, CreateEnrollmentResponse, Enrollment, Ownership, PermissionDefinition, PermissionKey } from "../lib/types";
import { usePermissionCatalog } from "../state/catalog";
import { useAuth } from "../state/auth";
import { useFleet } from "../state/store";
import { useRealtimeEvent } from "../state/realtime";
import { useAssignableUsers } from "../hooks/useAssignableUsers";
import { useCopy } from "../hooks/useCopy";
import { useNow } from "../hooks/useNow";

const EXPIRY_OPTIONS = [
  { value: "15", label: "15 min" },
  { value: "60", label: "1 h" },
  { value: "1440", label: "24 h" },
  { value: "10080", label: "7 d" },
] as const;
type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]["value"];

const DEFAULT_REQUESTED: PermissionKey[] = ["screen_capture", "notifications"];

export function EnrollmentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [result, setResult] = useState<CreateEnrollmentResponse | null>(null);

  useEffect(() => {
    if (open) setResult(null);
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={result ? "xl" : "lg"}
      title={result ? "Scan to enroll" : "Enroll a device"}
      description={
        result
          ? result.enrollment.ownership === "company" || result.androidProvisioning !== undefined
            ? "Choose how this company phone will be set up: on a factory-reset phone for full management, or on a phone that's already in use."
            : "Scan the QR code with the device's camera, or enter the pairing code in the MDM app."
          : "Create a one-time enrollment. The device user reviews every permission before anything is granted."
      }
      icon={
        <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent-soft-fg">
          <QrCode />
        </span>
      }
    >
      {result ? (
        <EnrollmentResult result={result} onDone={onClose} onAnother={() => setResult(null)} />
      ) : (
        <EnrollmentForm onCreated={setResult} onCancel={onClose} />
      )}
    </Dialog>
  );
}

// ---- Step 1 ---------------------------------------------------------------

function EnrollmentForm({ onCreated, onCancel }: { onCreated: (r: CreateEnrollmentResponse) => void; onCancel: () => void }) {
  const catalog = usePermissionCatalog();
  const users = useAssignableUsers();
  const upsertEnrollment = useFleet((s) => s.upsertEnrollment);
  const [assignedUserId, setAssignedUserId] = useState("");
  const [nameHint, setNameHint] = useState("");
  const [expiry, setExpiry] = useState<ExpiryValue>("60");
  const [ownership, setOwnership] = useState<Ownership>("personal");
  const [requested, setRequested] = useState<Set<PermissionKey>>(new Set(DEFAULT_REQUESTED));
  const [required, setRequired] = useState<Set<PermissionKey>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggleRequested = (key: PermissionKey, on: boolean) => {
    setRequested((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
    if (!on)
      setRequired((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
  };
  const toggleRequired = (key: PermissionKey, on: boolean) =>
    setRequired((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const members = (users.data ?? []).filter((u) => u.role === "member");
  const others = (users.data ?? []).filter((u) => u.role !== "member");

  const submit = async () => {
    setBusy(true);
    const body: CreateEnrollmentBody = {
      expiresInMinutes: Number(expiry),
      requestedPermissions: [...requested],
      requiredPermissions: [...required].filter((k) => requested.has(k)),
      ownership,
    };
    if (assignedUserId) body.assignedUserId = assignedUserId;
    if (nameHint.trim()) body.deviceNameHint = nameHint.trim();
    try {
      const res = await api.post<CreateEnrollmentResponse>("/api/enrollments", body);
      upsertEnrollment(res.enrollment);
      toast.success("Enrollment created");
      onCreated(res);
    } catch (err) {
      toast.error("Could not create enrollment", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assign to user" htmlFor="enr-user" optional hint={users.error ? `Could not load users: ${errorMessage(users.error)}` : undefined}>
          <Select id="enr-user" value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} disabled={users.loading && !users.data}>
            <option value="">No assigned user</option>
            {members.length > 0 && (
              <optgroup label="Members (device users)">
                {members.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.email}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Other users">
                {others.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {ROLE_META[u.role].label}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field label="Device name hint" htmlFor="enr-name" optional hint="Pre-fills the device name on enrollment.">
          <Input id="enr-name" value={nameHint} maxLength={80} onChange={(e) => setNameHint(e.target.value)} placeholder="e.g. Warehouse scanner 12" />
        </Field>
      </div>

      <Field label="Ownership" hint={OWNERSHIP_META[ownership].description}>
        <Segmented<Ownership>
          ariaLabel="Ownership"
          options={[
            { value: "company", label: <><Building2 /> Company-owned</> },
            { value: "personal", label: <><UserRound /> Personal (BYOD)</> },
          ]}
          value={ownership}
          onChange={setOwnership}
        />
      </Field>

      <Field label="Link expires after">
        <Segmented ariaLabel="Expiry" options={EXPIRY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} value={expiry} onChange={setExpiry} />
      </Field>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13px] font-medium text-fg-2">Permissions</span>
          <span className="tnum text-[12px] text-muted">
            {requested.size} requested · {required.size} required
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          {catalog.loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : catalog.error || !catalog.permissions ? (
            <div className="flex items-center justify-between gap-3 p-4 text-[13px] text-danger-fg">
              Could not load the permission catalog.
              <Button size="sm" onClick={catalog.retry}>
                Retry
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {catalog.permissions.map((p) => (
                <PermissionRow
                  key={p.key}
                  def={p}
                  requested={requested.has(p.key)}
                  required={required.has(p.key)}
                  onRequested={(v) => toggleRequested(p.key, v)}
                  onRequired={(v) => toggleRequired(p.key, v)}
                />
              ))}
            </ul>
          )}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          Required permissions must be granted for the device to show as Connected. Otherwise it shows as Permission required.
        </p>
      </div>

      <div className="-mx-5 -mb-5 flex flex-col-reverse gap-2 border-t border-border bg-surface-2/60 px-5 py-3.5 sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} icon={<QrCode />}>
          Generate enrollment
        </Button>
      </div>
    </form>
  );
}

function PlatformChip({ label, supported }: { label: string; supported: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium",
        supported ? "bg-success-soft text-success-fg" : "bg-neutral-soft text-neutral-fg line-through decoration-1",
      )}
      title={supported ? `Supported on ${label}` : `Not supported on ${label}`}
    >
      {label}
    </span>
  );
}

function PermissionRow({
  def,
  requested,
  required,
  onRequested,
  onRequired,
}: {
  def: PermissionDefinition;
  requested: boolean;
  required: boolean;
  onRequested: (v: boolean) => void;
  onRequired: (v: boolean) => void;
}) {
  const unsupported = !def.android.supported && !def.ios.supported;
  const id = `perm-${def.key}`;
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", requested && "bg-accent-soft/40")}>
      <div className="pt-0.5">
        <Checkbox id={id} checked={requested} onChange={onRequested} disabled={unsupported} />
      </div>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium text-fg">{def.name}</span>
          <PlatformChip label="Android" supported={def.android.supported} />
          <PlatformChip label="iOS" supported={def.ios.supported} />
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{def.description}</p>
      </label>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <span className={cn("text-[12px]", requested ? "text-fg-2" : "text-subtle")}>Required</span>
        <Toggle size="sm" label={`${def.name} required`} checked={required} disabled={!requested} onChange={onRequired} />
      </div>
    </li>
  );
}

// ---- Step 2 ---------------------------------------------------------------

type SetupMode = "standard" | "factory";

function EnrollmentResult({ result, onDone, onAnother }: { result: CreateEnrollmentResponse; onDone: () => void; onAnother: () => void }) {
  const isCompany = result.enrollment.ownership === "company" || result.androidProvisioning !== undefined;
  const [mode, setMode] = useState<SetupMode>(isCompany && result.androidProvisioning ? "factory" : "standard");
  const { organization } = useAuth();
  const catalog = usePermissionCatalog();
  const now = useNow(1000);
  const { copied, copy } = useCopy();
  const [enrollment, setEnrollment] = useState<Enrollment>(result.enrollment);
  const [qr, setQr] = useState<string | null>(null);

  // Progress is driven only by enrollment.updated events for this enrollment.
  useRealtimeEvent("enrollment.updated", ({ enrollment: e }) => {
    if (e.id === result.enrollment.id) setEnrollment(e);
  });

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(result.enrollmentUrl, { width: 640, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f1729", light: "#ffffff" } })
      .then((url) => !cancelled && setQr(url))
      .catch(() => toast.error("Could not render the QR code"));
    return () => {
      cancelled = true;
    };
  }, [result.enrollmentUrl]);

  const download = async () => {
    try {
      const url = await QRCode.toDataURL(result.enrollmentUrl, { width: 1024, margin: 2, errorCorrectionLevel: "M" });
      const a = document.createElement("a");
      const slug = (enrollment.deviceNameHint ?? "device").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "device";
      a.href = url;
      a.download = `enroll-${slug}-${enrollment.id.slice(0, 8)}.png`;
      a.click();
    } catch {
      toast.error("Could not generate the PNG");
    }
  };

  const expiresMs = new Date(enrollment.expiresAt).getTime() - now;
  const expired = expiresMs <= 0;
  const code = formatPairingCode(result.pairingCode);
  const requestedDefs = useMemo(
    () => enrollment.requestedPermissions.map((k) => catalog.byKey[k]).filter(Boolean) as PermissionDefinition[],
    [enrollment.requestedPermissions, catalog.byKey],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface-2/50 p-4 sm:p-5">
        <EnrollmentStepper enrollment={enrollment} expired={expired} />
      </div>

      {isCompany && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Segmented<SetupMode>
            ariaLabel="Setup method"
            options={[
              {
                value: "factory",
                label: (
                  <>
                    <RotateCcw />
                    <span className="sm:hidden">Factory reset</span>
                    <span className="hidden sm:inline">Factory-reset setup (Android Enterprise)</span>
                  </>
                ),
              },
              {
                value: "standard",
                label: (
                  <>
                    <Smartphone />
                    <span className="sm:hidden">Already set up</span>
                    <span className="hidden sm:inline">Already set-up phone</span>
                  </>
                ),
              },
            ]}
            value={mode}
            onChange={setMode}
          />
          <span className="text-[12px] text-muted">
            {mode === "factory"
              ? "Full management (device owner): lock, reboot, wipe and enforced policy."
              : "No reset needed, but only limited management (no wipe, policy not enforced)."}
          </span>
        </div>
      )}

      {isCompany && mode === "factory" ? (
        <FactoryResetSetup result={result} expired={expired} expiresAt={enrollment.expiresAt} now={now} />
      ) : (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
        {/* QR */}
        <div className="flex flex-col items-center rounded-xl border border-border p-5">
          <div className={cn("relative rounded-2xl border border-border bg-white p-3 shadow-xs", expired && "opacity-30 grayscale")}>
            {qr ? (
              <img src={qr} alt="Enrollment QR code" className="size-56 sm:size-64" />
            ) : (
              <Skeleton className="size-56 sm:size-64" />
            )}
          </div>
          <div className="mt-4 flex items-center gap-2 text-[13px]">
            <span className="text-muted">Expires in</span>
            <span className={cn("tnum font-semibold", expired ? "text-danger-fg" : expiresMs < 5 * 60_000 ? "text-warning-fg" : "text-fg")}>
              {formatCountdown(enrollment.expiresAt, now)}
            </span>
          </div>
          <div className="mt-4 flex w-full gap-2">
            <Button className="flex-1" icon={<Download />} onClick={download}>
              Download PNG
            </Button>
          </div>
        </div>

        {/* Codes */}
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <KeyRound className="size-3.5" /> One-time pairing code
            </div>
            <div className="flex items-center gap-2">
              <div className="tnum flex-1 rounded-xl border border-border bg-surface-2 px-4 py-3 text-center font-mono text-[26px] font-semibold tracking-[0.18em] text-fg">
                {code}
              </div>
              <Button size="icon" aria-label="Copy pairing code" onClick={() => copy(result.pairingCode, "Pairing code copied", "code")}>
                {copied === "code" ? <Check /> : <Copy />}
              </Button>
            </div>
            <p className="mt-1.5 text-[12px] text-muted">For devices that can't scan: open the MDM app and enter this code.</p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <Link2 className="size-3.5" /> Enrollment link
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={result.enrollmentUrl} className="font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} aria-label="Enrollment URL" />
              <Button size="icon" aria-label="Copy enrollment link" onClick={() => copy(result.enrollmentUrl, "Enrollment link copied", "url")}>
                {copied === "url" ? <Check /> : <Copy />}
              </Button>
            </div>
          </div>

          <div className="flex gap-2.5 rounded-xl border border-warning/30 bg-warning-soft p-3 text-[12.5px] leading-relaxed text-warning-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              The link token and pairing code are shown <strong>only once</strong>. Copy or download them now. If you lose them,
              revoke this enrollment and create a new one.
            </div>
          </div>

          <div className="rounded-xl border border-border p-3 text-[12.5px] text-muted">
            <div className="mb-1 font-medium text-fg-2">Requesting</div>
            <div className="flex flex-wrap gap-1.5">
              {enrollment.requestedPermissions.length === 0 && <span>No permissions</span>}
              {enrollment.requestedPermissions.map((k) => (
                <Badge key={k} tone={enrollment.requiredPermissions.includes(k) ? "accent" : "neutral"}>
                  {catalog.byKey[k]?.name ?? k}
                  {enrollment.requiredPermissions.includes(k) && " · required"}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="hidden lg:block">
          <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Preview · what the phone shows</div>
          <PhoneFrame size="sm" label="Preview of the enrollment page on the device">
            <div className="absolute inset-0 flex flex-col bg-[#f7f8fa] px-3.5 pb-4 pt-9 text-left text-[#0f1729]">
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md bg-[#4f46e5] text-white">
                  <ShieldCheck className="size-3.5" />
                </span>
                <span className="truncate text-[11px] font-semibold">{organization?.name ?? "Your organisation"}</span>
              </div>
              <div className="mt-4 text-[14px] font-semibold leading-tight">Enroll this device</div>
              <div className="mt-1 text-[9.5px] leading-snug text-[#667085]">
                {organization?.name ?? "Your organisation"} is asking to manage this device. Review what's requested and why.
              </div>
              <div className="mt-3 flex-1 space-y-1.5 overflow-hidden">
                {requestedDefs.slice(0, 5).map((d) => (
                  <div key={d.key} className="rounded-lg border border-[#e3e6ec] bg-white px-2 py-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[9.5px] font-semibold">{d.name}</span>
                      <span className="shrink-0 text-[8px] text-[#667085]">
                        {enrollment.requiredPermissions.includes(d.key) ? "Required" : "Optional"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 rounded-lg bg-[#4f46e5] py-2 text-center text-[10px] font-semibold text-white">Open in the MDM app</div>
              <div className="mt-1.5 rounded-lg border border-[#e3e6ec] bg-white py-1.5 text-center text-[9.5px] font-medium">Install the app</div>
            </div>
          </PhoneFrame>
          <p className="mt-3 text-center text-[11px] leading-snug text-subtle">
            Illustration only. Opening the link here would mark the enrollment as scanned.
          </p>
        </div>
      </div>
      )}

      <div className="-mx-5 -mb-5 flex flex-col-reverse gap-2 border-t border-border bg-surface-2/60 px-5 py-3.5 sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
        <Button onClick={onAnother}>Enroll another device</Button>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

// ---- Company-owned: factory-reset (6-tap) provisioning QR (§8) --------------

const FACTORY_STEPS: { title: string; body: string }[] = [
  { title: "Factory reset the phone", body: "Settings → System → Reset → Erase all data. Skip if it's brand new or already on the welcome screen." },
  { title: "Tap the welcome screen 6 times", body: "On the first \"Welcome\" / \"Hi there\" screen, tap the same blank spot six times. A QR scanner opens." },
  { title: "Connect to Wi-Fi", body: "Join a Wi-Fi network when asked. The phone needs internet to download the MDM app." },
  { title: "Scan this QR code", body: "The phone downloads and installs the MDM app as device owner, then shows the organisation, the permissions and why." },
];

function FactoryResetSetup({
  result,
  expired,
  expiresAt,
  now,
}: {
  result: CreateEnrollmentResponse;
  expired: boolean;
  expiresAt: string;
  now: number;
}) {
  const prov = result.androidProvisioning ?? null;
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    if (!prov) return;
    let cancelled = false;
    setQrError(false);
    // Long JSON payload: bigger canvas, error correction "M" (as Android's setup wizard expects).
    QRCode.toDataURL(prov.qrPayload, { width: 900, margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQrError(true));
    return () => {
      cancelled = true;
    };
  }, [prov]);

  const download = () => {
    if (!qr) return;
    const a = document.createElement("a");
    a.href = qr;
    a.download = `factory-setup-${result.enrollment.id.slice(0, 8)}.png`;
    a.click();
  };

  if (!prov) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning-soft p-5 text-[13px] leading-relaxed text-warning-fg">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-2">
            <div className="font-semibold">Factory-reset setup isn't available on this server</div>
            <p>{result.androidProvisioningUnavailableReason ?? "The server did not return a provisioning payload."}</p>
            <p>To enable it, an administrator of the API server must set:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <code className="font-mono text-[12px]">APP_DOWNLOAD_URL</code>: a public HTTPS link to the MDM app APK that the phone can
                download during setup.
              </li>
              <li>
                <code className="font-mono text-[12px]">APP_SIGNATURE_CHECKSUM</code>: the URL-safe base64 SHA-256 checksum of the APK's
                signing certificate, so Android can verify the download.
              </li>
            </ul>
            <p>
              Then create a new company-owned enrollment. Until then, use <strong>Already set-up phone</strong>: the device enrolls with
              limited management.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col items-center rounded-xl border border-border p-5">
        <div className={cn("relative rounded-2xl border border-border bg-white p-3 shadow-xs", expired && "opacity-30 grayscale")}>
          {qr ? (
            <img src={qr} alt="Android Enterprise provisioning QR code" className="size-72 sm:size-80" />
          ) : qrError ? (
            <div className="grid size-72 place-items-center p-6 text-center text-[13px] text-danger-fg sm:size-80">
              The payload is too large to fit in a QR code.
            </div>
          ) : (
            <Skeleton className="size-72 sm:size-80" />
          )}
        </div>
        <div className="mt-4 flex items-center gap-2 text-[13px]">
          <span className="text-muted">Expires in</span>
          <span className={cn("tnum font-semibold", expired ? "text-danger-fg" : "text-fg")}>{formatCountdown(expiresAt, now)}</span>
        </div>
        <Button className="mt-4 w-full" icon={<Download />} onClick={download} disabled={!qr}>
          Download PNG
        </Button>
      </div>

      <div className="space-y-4">
        <ol className="space-y-3">
          {FACTORY_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="tnum grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent-soft-fg">
                {i + 1}
              </span>
              <div>
                <div className="text-[13.5px] font-medium text-fg">{step.title}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        {prov.instructions && (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-[12.5px] leading-relaxed text-fg-2 whitespace-pre-line">
            {prov.instructions}
          </div>
        )}
        <div className="flex gap-2.5 rounded-xl border border-warning/30 bg-warning-soft p-3 text-[12.5px] leading-relaxed text-warning-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            This only works on a phone showing its first setup screen. A phone that's already in use must be factory reset first, which
            erases everything on it. The code contains a one-time enrollment token: treat it like a password.
          </div>
        </div>
      </div>
    </div>
  );
}
