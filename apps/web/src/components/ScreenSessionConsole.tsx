import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Ban,
  Clock,
  Gauge,
  Hourglass,
  Loader2,
  Eye,
  Lock,
  MonitorOff,
  MousePointerClick,
  RefreshCw,
  RotateCcw,
  ScreenShare,
  ShieldCheck,
  Smartphone,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, Tooltip } from "./ui";
import { BatteryIndicator, KeyValue } from "./Common";
import { PhoneFrame } from "./PhoneFrame";
import { SessionStatusBadge } from "./StatusBadges";
import { StartSessionDialog } from "./StartSessionDialog";
import { RemoteControlBar, RemoteControlLayer } from "./RemoteControl";
import { realtime } from "../lib/ws";
import { cn } from "../lib/cn";
import { api, errorMessage } from "../lib/api";
import { endReasonText, hasRole, isSessionTerminal } from "../lib/labels";
import { formatClock, formatCountdown, formatDateTime, relativeTime } from "../lib/format";
import { deviceSubtitle, deviceUserName, screenShareBlockReason } from "../lib/devices";
import type { ControlInput, Device, ScreenSession } from "../lib/types";
import { useFleet } from "../state/store";
import { useCurrentUser } from "../state/auth";
import { useNow } from "../hooks/useNow";
import { useScreenStream, type ScreenStreamState } from "../hooks/useScreenStream";

function useDeviceSession(device: Device): ScreenSession | null {
  const sessions = useFleet((s) => s.sessions);
  const upsertSession = useFleet((s) => s.upsertSession);
  const [focusId, setFocusId] = useState<string | null>(null);

  const liveId = useMemo(() => {
    if (device.activeScreenSessionId) return device.activeScreenSessionId;
    const live = Object.values(sessions)
      .filter((s) => s.deviceId === device.id && !isSessionTerminal(s.status))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return live[0]?.id ?? null;
  }, [device.activeScreenSessionId, device.id, sessions]);

  useEffect(() => {
    if (liveId) setFocusId(liveId);
  }, [liveId]);

  // The device says it has a session we don't know about yet: fetch it.
  useEffect(() => {
    if (!liveId || sessions[liveId]) return;
    let cancelled = false;
    api
      .get<{ sessions: ScreenSession[] }>("/api/screen-sessions", { query: { deviceId: device.id } })
      .then(({ sessions: list }) => {
        if (!cancelled) list.forEach(upsertSession);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [liveId, sessions, device.id, upsertSession]);

  return focusId ? sessions[focusId] ?? null : null;
}

export function ScreenSessionConsole({ device, stacked = false }: { device: Device; stacked?: boolean }) {
  const user = useCurrentUser();
  const session = useDeviceSession(device);
  const upsertSession = useFleet((s) => s.upsertSession);
  const now = useNow(1000);
  const [startOpen, setStartOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  const isRequester = !!session && session.requestedBy.id === user.id;
  const live = !!session && !isSessionTerminal(session.status);
  const streamEnabled = !!session && isRequester && (session.status === "connecting" || session.status === "active");
  const stream = useScreenStream(session?.id ?? null, streamEnabled);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  const [hasFrames, setHasFrames] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== stream.stream) v.srcObject = stream.stream;
    if (!stream.stream) {
      setHasFrames(false);
      setVideoDims(null);
    } else {
      void v.play().catch(() => undefined);
    }
  }, [stream.stream]);

  const blockReason = screenShareBlockReason(device, user.role);
  const canStop = live && (isRequester || hasRole(user.role, "admin"));

  const stop = async () => {
    if (!session) return;
    setStopping(true);
    try {
      const res = await api.post<{ session: ScreenSession }>(`/api/screen-sessions/${session.id}/end`);
      upsertSession(res.session);
      toast.success("Screen sharing stopped");
    } catch (err) {
      toast.error("Could not stop the session", { description: errorMessage(err) });
    } finally {
      setStopping(false);
    }
  };

  const tele = device.telemetry;
  const orientation =
    stream.meta?.orientation ??
    (videoDims ? (videoDims.w > videoDims.h ? "landscape" : "portrait") : null) ??
    tele?.orientation ??
    "portrait";
  const aspect = videoDims
    ? videoDims.w / videoDims.h
    : stream.meta
      ? stream.meta.width / stream.meta.height
      : tele?.screenWidth && tele?.screenHeight
        ? tele.screenWidth / tele.screenHeight
        : null;

  const showVideo = streamEnabled && !!stream.stream && hasFrames;

  // §9: input is only sent while the session is active, the user granted control,
  // we are the requesting admin and the picture is actually on screen.
  const controlActive = !!session && session.status === "active" && session.controlGranted === true && isRequester && showVideo;
  const showControlBar = !!session && live && isRequester && session.controlRequested === true;
  const controlDisabledReason = !session
    ? null
    : session.status === "awaiting_consent"
      ? "Waiting for the user to approve remote control."
      : !session.controlGranted
        ? session.consentedAt
          ? "View only: the user didn't allow control, or turned it off."
          : "Waiting for the user to approve remote control."
        : !showVideo
          ? "Control resumes once the live picture is on screen."
          : null;

  const sendInput = (input: ControlInput): boolean => {
    if (!session || !controlActive) return false;
    const ok = realtime.send({ type: "control.input", sessionId: session.id, input });
    if (!ok) toast.error("Input not sent", { description: "The real-time connection to the server is down. Reconnecting…" });
    return ok;
  };

  // Tell the admin when the device user switches control off mid-session.
  const prevGranted = useRef<{ id: string; granted: boolean } | null>(null);
  useEffect(() => {
    if (!session) return;
    const prev = prevGranted.current;
    const granted = session.controlGranted === true;
    if (prev && prev.id === session.id && prev.granted && !granted && !isSessionTerminal(session.status)) {
      toast.info("Remote control turned off", { description: "The session continues view-only." });
    }
    prevGranted.current = { id: session.id, granted };
  }, [session]);

  const startButton = (
    <Tooltip content={blockReason} focusable={!!blockReason}>
      <Button
        variant="primary"
        icon={<ScreenShare />}
        disabled={!!blockReason}
        onClick={() => setStartOpen(true)}
      >
        {session && !live ? "Start new session" : "Start screen sharing"}
      </Button>
    </Tooltip>
  );

  return (
    <div className={cn("grid gap-4", !stacked && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
      {/* Stage */}
      <div
        className="relative overflow-hidden rounded-card border border-border bg-surface-2"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, var(--border-strong) 1px, transparent 0)",
          backgroundSize: "20px 20px",
        }}
      >
        <StageChips
          device={device}
          session={session}
          stream={stream}
          orientation={orientation}
          now={now}
          showVideo={showVideo}
          controlActive={controlActive}
        />
        <div className="flex min-h-[520px] flex-col items-center justify-center px-4 pb-16 pt-28 sm:px-8 sm:pt-20">
          <PhoneFrame
            orientation={orientation}
            aspect={aspect}
            highlight={controlActive}
            label={showVideo && !controlActive ? `Live screen of ${device.name}` : undefined}
          >
            {streamEnabled && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) setVideoDims({ w: v.videoWidth, h: v.videoHeight });
                }}
                onResize={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) setVideoDims({ w: v.videoWidth, h: v.videoHeight });
                }}
                onPlaying={() => setHasFrames(true)}
                className={cn("absolute inset-0 h-full w-full bg-black object-contain", !showVideo && "opacity-0")}
              />
            )}
            {controlActive && (
              <RemoteControlLayer
                videoRef={videoRef}
                onInput={sendInput}
                label={`Remote screen of ${device.name}. Tap, hold or drag to control the device. Press Escape to release focus.`}
              />
            )}
            {!showVideo && (
              <ScreenPlaceholder device={device} session={session} isRequester={isRequester} stream={stream} now={now} />
            )}
          </PhoneFrame>
          {showControlBar && <RemoteControlBar enabled={controlActive} disabledReason={controlDisabledReason} onInput={sendInput} />}
        </div>
        {showVideo && stream.stats && (
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 p-3">
            <Chip icon={<Gauge />} mono>
              {stream.stats.bitrateKbps.toLocaleString()} kbps · {stream.stats.fps} fps
              {stream.stats.width > 0 && ` · ${stream.stats.width}×${stream.stats.height}`}
            </Chip>
            {stream.stats.route && (
              <Chip icon={<ShieldCheck />}>{stream.stats.route === "relay" ? "Relayed (TURN) · encrypted" : "Peer-to-peer · encrypted"}</Chip>
            )}
          </div>
        )}
      </div>

      {/* Session panel */}
      <Card className="flex flex-col">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-fg">Screen session</h3>
            {session ? <SessionStatusBadge status={session.status} /> : <Badge tone="neutral">Idle</Badge>}
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            {deviceSubtitle(device)} · {device.platform === "ios" ? "iOS" : "Android"} {device.osVersion}
          </p>
        </div>
        <div className="flex-1 px-5 py-2">
          {session ? (
            <dl className="divide-y divide-border">
              <div className="py-3">
                <dt className="text-[12px] font-medium text-muted">Purpose (shown to user)</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-fg">{session.purpose}</dd>
              </div>
              <KeyValue label="Requested by">{session.requestedBy.name}</KeyValue>
              <KeyValue label="Requested">{relativeTime(session.requestedAt, now)}</KeyValue>
              {session.status === "awaiting_consent" && (
                <KeyValue label="Request expires">
                  <span className="tnum font-medium text-warning-fg">{formatCountdown(session.expiresAt, now)}</span>
                </KeyValue>
              )}
              {session.consentedAt && <KeyValue label="Approved">{formatDateTime(session.consentedAt)}</KeyValue>}
              <KeyValue label="Remote control">
                {!session.controlRequested ? (
                  <span className="text-muted">Not requested (view only)</span>
                ) : session.controlGranted ? (
                  <span className="font-medium text-accent">Granted</span>
                ) : session.status === "awaiting_consent" ? (
                  "Requested"
                ) : (
                  <span className="text-warning-fg">View only</span>
                )}
              </KeyValue>
              {session.controlRequested && (
                <KeyValue label="Inputs relayed">
                  <span className="tnum">{(session.inputCount ?? 0).toLocaleString()}</span>
                </KeyValue>
              )}
              {session.startedAt && (
                <KeyValue label={live ? "Live for" : "Started"}>
                  {live ? (
                    <span className="tnum">{formatClock(now - new Date(session.startedAt).getTime())}</span>
                  ) : (
                    formatDateTime(session.startedAt)
                  )}
                </KeyValue>
              )}
              {session.endedAt && <KeyValue label="Ended">{formatDateTime(session.endedAt)}</KeyValue>}
              {isSessionTerminal(session.status) && (
                <div className="py-3">
                  <dt className="text-[12px] font-medium text-muted">Outcome</dt>
                  <dd className="mt-1 text-[13px] text-fg">{endReasonText(session.endReason ?? session.status)}</dd>
                </div>
              )}
              {stream.error && streamEnabled && (
                <div className="py-3 text-[12.5px] text-danger-fg">
                  <AlertCircle className="mr-1 inline size-3.5" />
                  {stream.error}
                </div>
              )}
            </dl>
          ) : (
            <div className="py-4 text-[13px] leading-relaxed text-muted">
              No screen session for this device yet. Requests are sent to the device, and the user must approve them
              there. The operating system then asks again before anything is captured.
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
          {live ? (
            <>
              {canStop ? (
                <Button variant="danger" icon={<Square />} loading={stopping} onClick={stop} className="flex-1">
                  {session?.status === "awaiting_consent" ? "Cancel request" : "Stop sharing"}
                </Button>
              ) : (
                <p className="text-[12.5px] text-muted">Only {session?.requestedBy.name} or an admin can stop this session.</p>
              )}
              {streamEnabled && (
                <Tooltip content="Re-negotiate the WebRTC connection">
                  <Button variant="secondary" size="icon" aria-label="Reconnect stream" onClick={stream.reconnect}>
                    <RotateCcw />
                  </Button>
                </Tooltip>
              )}
            </>
          ) : (
            <div className="w-full [&>span]:w-full [&_button]:w-full">{startButton}</div>
          )}
        </div>
      </Card>

      <StartSessionDialog device={device} open={startOpen} onClose={() => setStartOpen(false)} />
    </div>
  );
}

function Chip({
  icon,
  children,
  tone,
  mono,
}: {
  icon?: ReactNode;
  children: ReactNode;
  tone?: "live" | "warn" | "muted" | "control";
  mono?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium shadow-xs backdrop-blur [&_svg]:size-3.5",
        tone === "live"
          ? "border-transparent bg-session text-white"
          : tone === "control"
            ? "border-transparent bg-accent text-accent-fg"
          : tone === "warn"
            ? "border-warning/30 bg-warning-soft text-warning-fg"
            : "border-border bg-surface/90 text-fg-2",
        mono && "tnum",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function StageChips({
  device,
  session,
  stream,
  orientation,
  now,
  showVideo,
  controlActive,
}: {
  device: Device;
  session: ScreenSession | null;
  stream: ScreenStreamState;
  orientation: "portrait" | "landscape";
  now: number;
  showVideo: boolean;
  controlActive: boolean;
}) {
  const live = session && !isSessionTerminal(session.status);
  const phaseLabel: Record<string, string> = {
    idle: "Not connected",
    waiting_ws: "Waiting for real-time link",
    negotiating: "Negotiating",
    connecting: "Connecting",
    connected: "Connected",
    unstable: "Connection unstable",
    reconnecting: `Reconnecting (attempt ${stream.attempts})`,
    closed: "Closed",
  };
  return (
    <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip icon={<Smartphone />}>{device.model || device.name}</Chip>
        <Chip icon={device.online ? <Wifi /> : <WifiOff />} tone={device.online ? undefined : "muted"}>
          {device.online ? "Device online" : "Device offline"}
        </Chip>
        <Chip icon={<RefreshCw />}>{orientation === "landscape" ? "Landscape" : "Portrait"}</Chip>
        <Chip>
          <BatteryIndicator telemetry={device.telemetry} />
        </Chip>
      </div>
      {live && (
        <div className="flex flex-wrap justify-end gap-2">
          {showVideo ? (
            <Chip tone="live" icon={<span className="size-1.5 rounded-full bg-white animate-pulse" />}>
              Live
            </Chip>
          ) : (
            session.status !== "awaiting_consent" && (
              <Chip tone={stream.phase === "unstable" || stream.phase === "reconnecting" ? "warn" : undefined}>
                {phaseLabel[stream.phase] ?? stream.phase}
              </Chip>
            )
          )}
          {session.status === "active" &&
            (controlActive ? (
              <Chip tone="control" icon={<MousePointerClick />}>
                You are controlling this device
              </Chip>
            ) : (
              <Chip icon={<Eye />}>View only</Chip>
            ))}
          {session.startedAt && (
            <Chip icon={<Clock />} mono>
              {formatClock(now - new Date(session.startedAt).getTime())}
            </Chip>
          )}
        </div>
      )}
    </div>
  );
}

function ScreenPlaceholder({
  device,
  session,
  isRequester,
  stream,
  now,
}: {
  device: Device;
  session: ScreenSession | null;
  isRequester: boolean;
  stream: ScreenStreamState;
  now: number;
}) {
  let icon: ReactNode = <MonitorOff />;
  let title = "No live screen";
  let body: ReactNode = "Screen sharing starts only after the device user approves it.";
  let accent = "text-white/70";

  if (session) {
    const s = session.status;
    if (s === "awaiting_consent") {
      icon = <Hourglass className="animate-pulse" />;
      title = "Awaiting approval";
      body = (
        <>
          Waiting for {deviceUserName(device)} to approve on their device.
          <span className="mt-3 block font-mono text-lg font-medium text-white tnum">{formatCountdown(session.expiresAt, now)}</span>
        </>
      );
      accent = "text-amber-300";
    } else if ((s === "connecting" || s === "active") && !isRequester) {
      icon = <Lock />;
      title = "Session in progress";
      body = `${session.requestedBy.name} is viewing this screen. The stream is only delivered to the administrator who requested it.`;
      accent = "text-violet-300";
    } else if (s === "connecting" || s === "active") {
      icon = <Loader2 className="animate-spin" />;
      title = s === "active" ? "Restoring the stream" : "Establishing secure connection";
      body =
        stream.phase === "waiting_ws"
          ? "Waiting for the real-time connection to the server."
          : stream.phase === "unstable" || stream.phase === "reconnecting"
            ? "The connection dropped. Re-negotiating with the device."
            : "Approved on the device. Negotiating an encrypted WebRTC stream.";
      accent = "text-sky-300";
    } else if (s === "rejected") {
      icon = <Ban />;
      title = "Request declined";
      body = endReasonText(session.endReason ?? "rejected");
      accent = "text-rose-300";
    } else if (s === "failed") {
      icon = <AlertCircle />;
      title = "Session failed";
      body = endReasonText(session.endReason ?? "error");
      accent = "text-rose-300";
    } else if (s === "expired") {
      icon = <Hourglass />;
      title = "Request expired";
      body = endReasonText(session.endReason ?? "consent_timeout");
    } else if (s === "ended") {
      icon = <MonitorOff />;
      title = "Session ended";
      body = endReasonText(session.endReason);
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(120%_80%_at_50%_0%,#262b3a_0%,#0b0d13_60%)] px-6 text-center">
      <div className={cn("mb-4 grid size-12 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10 [&_svg]:size-5", accent)}>
        {icon}
      </div>
      <div className="text-[14px] font-semibold text-white">{title}</div>
      <div className="mt-1.5 max-w-[220px] text-[12px] leading-relaxed text-white/60">{body}</div>
    </div>
  );
}
