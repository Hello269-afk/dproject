import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { LogOut, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { Avatar, KeyValue, PageHeader } from "../components/Common";
import { Badge, Button, Card, CardHeader, Segmented, StatusDot } from "../components/ui";
import { useTheme, type ThemePref } from "../state/theme";
import { useAuth, useCurrentUser } from "../state/auth";
import { useWsDiagnostics } from "../state/realtime";
import { realtime } from "../lib/ws";
import { api, errorMessage } from "../lib/api";
import { formatDateTime, relativeTime } from "../lib/format";
import { ROLE_META } from "../lib/labels";
import { useNow } from "../hooks/useNow";

export function SettingsPage() {
  const { preference, setPreference } = useTheme();
  const user = useCurrentUser();
  const { organization, logout } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (location.hash === "#diagnostics") document.getElementById("diagnostics")?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash]);

  return (
    <>
      <PageHeader title="Settings" description="Your preferences, account and connection health." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Appearance" description="Theme for this browser." />
          <div className="p-5">
            <Segmented<ThemePref>
              ariaLabel="Theme"
              value={preference}
              onChange={setPreference}
              options={[
                { value: "light", label: <><Sun /> Light</> },
                { value: "dark", label: <><Moon /> Dark</> },
                { value: "system", label: <><Monitor /> System</> },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Account"
            actions={
              <Button size="sm" variant="danger-soft" icon={<LogOut />} onClick={() => void logout()}>
                Sign out
              </Button>
            }
          />
          <div className="flex items-center gap-3 px-5 pt-4">
            <Avatar name={user.name} size="lg" />
            <div className="min-w-0">
              <div className="truncate font-semibold text-fg">{user.name}</div>
              <div className="truncate text-[12.5px] text-muted">{user.email}</div>
            </div>
            <Badge tone="accent" className="ml-auto">
              {ROLE_META[user.role].label}
            </Badge>
          </div>
          <dl className="divide-y divide-border px-5 pb-2 pt-2">
            <KeyValue label="Organisation">{organization?.name ?? "—"}</KeyValue>
            <KeyValue label="Permissions">{ROLE_META[user.role].description}</KeyValue>
            <KeyValue label="Last sign-in">{formatDateTime(user.lastLoginAt)}</KeyValue>
            <KeyValue label="Member since">{formatDateTime(user.createdAt)}</KeyValue>
          </dl>
        </Card>
        <Diagnostics />
      </div>
    </>
  );
}

function Diagnostics() {
  const d = useWsDiagnostics();
  const now = useNow(1000);
  const [health, setHealth] = useState<{ ok: boolean; ms: number; at: number; error?: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    const t0 = performance.now();
    try {
      const res = await api.get<{ ok: boolean }>("/api/health", { anonymous: true });
      setHealth({ ok: !!res?.ok, ms: Math.round(performance.now() - t0), at: Date.now() });
    } catch (err) {
      setHealth({ ok: false, ms: Math.round(performance.now() - t0), at: Date.now(), error: errorMessage(err) });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void check();
  }, []);

  const wsTone = d.status === "open" ? "success" : d.status === "reconnecting" ? "warning" : d.status === "connecting" ? "info" : "neutral";
  const webrtc = typeof RTCPeerConnection !== "undefined";

  return (
    <Card id="diagnostics" className="lg:col-span-2 scroll-mt-6">
      <CardHeader
        title="Connection diagnostics"
        description="Live state of the API and the real-time WebSocket."
        actions={
          <>
            <Button size="sm" icon={<RefreshCw />} loading={checking} onClick={check}>
              Check API
            </Button>
            <Button size="sm" onClick={() => realtime.reconnectNow()}>
              Reconnect WebSocket
            </Button>
          </>
        }
      />
      <div className="grid gap-0 md:grid-cols-2 md:divide-x divide-border">
        <dl className="divide-y divide-border px-5 py-1">
          <KeyValue label="API base">
            <span className="font-mono text-[12px]">{location.origin}/api</span>
          </KeyValue>
          <KeyValue label="Health">
            {health ? (
              <span className="inline-flex items-center gap-2">
                <StatusDot tone={health.ok ? "success" : "danger"} size="sm" />
                {health.ok ? `OK · ${health.ms} ms` : `Failed${health.error ? ` · ${health.error}` : ""}`}
              </span>
            ) : (
              "Checking…"
            )}
          </KeyValue>
          <KeyValue label="Last checked">{health ? relativeTime(health.at, now) : "—"}</KeyValue>
          <KeyValue label="WebRTC support">{webrtc ? "Available" : <span className="text-danger-fg">Not available in this browser</span>}</KeyValue>
        </dl>
        <dl className="divide-y divide-border border-t border-border px-5 py-1 md:border-t-0">
          <KeyValue label="WebSocket">
            <span className="inline-flex items-center gap-2 capitalize">
              <StatusDot tone={wsTone} pulse={d.status === "open"} size="sm" />
              {d.status}
            </span>
          </KeyValue>
          <KeyValue label="Endpoint">
            <span className="font-mono text-[12px]">{d.url}</span>
          </KeyValue>
          <KeyValue label="Connected for">{d.connectedAt ? relativeTime(d.connectedAt, now).replace(" ago", "") : "—"}</KeyValue>
          <KeyValue label="Round-trip latency">{d.latencyMs != null ? `${d.latencyMs} ms` : "—"}</KeyValue>
          <KeyValue label="Last message">{d.lastMessageAt ? relativeTime(d.lastMessageAt, now) : "—"}</KeyValue>
          <KeyValue label="Reconnect attempts">
            <span className="tnum">{d.reconnectAttempts}</span>
          </KeyValue>
          {d.lastCloseCode != null && <KeyValue label="Last close code">{closeCodeText(d.lastCloseCode)}</KeyValue>}
          {d.lastError && <KeyValue label="Last error">{d.lastError}</KeyValue>}
        </dl>
      </div>
    </Card>
  );
}

function closeCodeText(code: number) {
  const map: Record<number, string> = {
    1000: "Normal closure",
    1001: "Going away",
    1006: "Abnormal closure (network)",
    4001: "Bad or expired ticket",
    4003: "Forbidden",
    4008: "Replaced by a newer connection",
  };
  return `${code}${map[code] ? ` · ${map[code]}` : ""}`;
}
