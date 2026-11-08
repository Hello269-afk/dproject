import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { AlertCircle, Ban, Clock, Download, ExternalLink, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { formatCountdown } from "../lib/format";
import type { PermissionDefinition, PublicScanResponse } from "../lib/types";
import { useNow } from "../hooks/useNow";
import { cn } from "../lib/cn";

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: PublicScanResponse }
  | { kind: "error"; code: string; message: string };

export function PublicEnrollPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<State>({ kind: "loading" });
  const now = useNow(1000);

  useEffect(() => {
    let cancelled = false;
    api
      .post<PublicScanResponse>("/api/public/enroll/scan", { token }, { anonymous: true })
      .then((data) => !cancelled && setState({ kind: "ok", data }))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) setState({ kind: "error", code: err.code, message: err.message });
        else setState({ kind: "error", code: "unknown", message: "Something went wrong." });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-8 pt-6">
        {state.kind === "loading" && (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="size-6 animate-spin text-muted" aria-label="Loading" />
          </div>
        )}
        {state.kind === "error" && <ErrorView code={state.code} message={state.message} />}
        {state.kind === "ok" && <Landing data={state.data} now={now} />}
      </div>
    </div>
  );
}

function ErrorView({ code, message }: { code: string; message: string }) {
  const map: Record<string, { icon: typeof Ban; title: string; body: string }> = {
    enrollment_expired: { icon: Clock, title: "This enrollment link has expired", body: "Ask your IT administrator for a new QR code." },
    enrollment_revoked: { icon: Ban, title: "This enrollment link was revoked", body: "Your administrator cancelled it. Ask them for a new QR code." },
    enrollment_used: { icon: ShieldCheck, title: "This link has already been used", body: "A device has already enrolled with it. Ask your administrator for a new one if you need to enroll another device." },
    enrollment_not_found: { icon: AlertCircle, title: "Enrollment not found", body: "The link is invalid or incomplete. Try scanning the QR code again." },
  };
  const v = map[code] ?? { icon: AlertCircle, title: "We couldn't open this enrollment", body: message };
  const Icon = v.icon;
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="mb-5 grid size-14 place-items-center rounded-2xl border border-border bg-surface text-muted shadow-xs">
        <Icon className="size-6" />
      </div>
      <h1 className="text-[20px] font-semibold text-fg">{v.title}</h1>
      <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-muted">{v.body}</p>
    </div>
  );
}

function Landing({ data, now }: { data: PublicScanResponse; now: number }) {
  const expired = new Date(data.expiresAt).getTime() <= now;
  if (expired) return <ErrorView code="enrollment_expired" message="" />;
  const required = data.requestedPermissions.filter((p) => data.requiredPermissions.includes(p.key));
  const optional = data.requestedPermissions.filter((p) => !data.requiredPermissions.includes(p.key));
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  return (
    <>
      <header className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-accent text-accent-fg">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-fg">{data.organization.name}</div>
          <div className="text-[12px] text-muted">Device enrollment</div>
        </div>
      </header>

      <h1 className="mt-8 text-[24px] font-semibold leading-tight tracking-[-0.01em] text-fg">Enroll this device</h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
        {data.organization.name} wants to manage this device with its MDM app. Here's exactly what it will ask for and why.
        You approve each permission on your device, and you can change them later.
      </p>
      <div className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full bg-surface-2 px-3 py-1 text-[12.5px] text-fg-2">
        <Clock className="size-3.5" /> Link expires in <span className="tnum font-semibold">{formatCountdown(data.expiresAt, now)}</span>
      </div>

      {required.length > 0 && <PermissionGroup title="Required" hint="Needed for this device to be fully managed." items={required} required platform={isIOS ? "ios" : "android"} />}
      {optional.length > 0 && <PermissionGroup title="Optional" hint="You can decline these." items={optional} platform={isIOS ? "ios" : "android"} />}
      {data.requestedPermissions.length === 0 && (
        <p className="mt-6 rounded-xl border border-border bg-surface p-4 text-[13.5px] text-muted">No device permissions are requested.</p>
      )}

      <div className="sticky bottom-0 -mx-4 mt-8 space-y-2.5 border-t border-border bg-bg/95 px-4 pb-4 pt-4 backdrop-blur">
        <a
          href={data.appLink}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-accent-fg shadow-xs hover:bg-accent-hover"
        >
          <ExternalLink className="size-4" /> Open in the MDM app
        </a>
        {data.appDownloadUrl ? (
          <a
            href={data.appDownloadUrl}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface text-[15px] font-semibold text-fg hover:bg-surface-2"
          >
            <Download className="size-4" /> Install the app
          </a>
        ) : (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted">
            <Smartphone className="mr-1 inline size-4" />
            Don't have the MDM app yet? A download link hasn't been configured. Ask your administrator to send you the app.
          </p>
        )}
        <p className="text-center text-[12px] text-subtle">If the app doesn't open, install it first and scan the QR code again.</p>
      </div>
    </>
  );
}

function PermissionGroup({
  title,
  hint,
  items,
  required,
  platform,
}: {
  title: string;
  hint: string;
  items: PermissionDefinition[];
  required?: boolean;
  platform: "android" | "ios";
}) {
  return (
    <section className="mt-7">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{title}</h2>
        <span className="text-[12px] text-subtle">{hint}</span>
      </div>
      <ul className="space-y-2.5">
        {items.map((p) => {
          const support = p[platform];
          return (
            <li key={p.key} className={cn("rounded-xl border bg-surface p-4", required ? "border-accent/30" : "border-border")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold text-fg">{p.name}</span>
                {!support.supported && <span className="rounded-md bg-neutral-soft px-1.5 py-0.5 text-[11px] text-neutral-fg">Not available on this phone</span>}
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-fg-2">{p.description}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                <span className="font-medium text-fg-2">Why: </span>
                {p.why}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
