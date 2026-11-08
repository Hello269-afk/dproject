import type { ReactNode } from "react";
import { MonitorSmartphone, ShieldCheck, ScreenShare, Activity } from "lucide-react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-accent text-accent-fg">
            <MonitorSmartphone className="size-4" />
          </div>
          <span className="text-[14px] font-semibold text-fg">MDM Console</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[380px] animate-pop-in">{children}</div>
        </div>
        <p className="text-[12px] text-subtle">Access is logged. Only authorised administrators may sign in.</p>
      </div>
      <div className="relative hidden overflow-hidden border-l border-border bg-surface-2 lg:block">
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, var(--border-strong) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="absolute -right-24 -top-24 size-[420px] rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex h-full flex-col justify-center px-14">
          <h2 className="max-w-md text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg">
            Manage every device with consent built in.
          </h2>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted">
            Enroll by QR, watch fleet health in real time and help users with screen sharing they approve on their own device.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              { icon: ShieldCheck, t: "Transparent permissions", d: "Users see exactly what's requested and why." },
              { icon: Activity, t: "Live telemetry", d: "Battery, network and status stream in as they change." },
              { icon: ScreenShare, t: "Consent-first screen sharing", d: "Encrypted WebRTC, approved per session." },
            ].map((f) => (
              <li key={f.t} className="flex max-w-md items-start gap-3 rounded-xl border border-border bg-surface/80 p-3.5 backdrop-blur">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-soft-fg">
                  <f.icon className="size-4" />
                </span>
                <div>
                  <div className="text-[13px] font-semibold text-fg">{f.t}</div>
                  <div className="text-[12.5px] text-muted">{f.d}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
