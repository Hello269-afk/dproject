import { api } from "./api";
import { realtime } from "./ws";
import type { Orientation } from "./types";
import { iceServerCache } from "../state/store";

export interface StreamStats {
  bitrateKbps: number;
  fps: number;
  width: number;
  height: number;
  route: "relay" | "direct" | null;
  packetsLost: number | null;
}

export interface ScreenMeta {
  orientation: Orientation;
  width: number;
  height: number;
}

export type ReceiverPhase = "waiting_ws" | "negotiating" | "connecting" | "connected" | "unstable" | "reconnecting" | "closed";

export interface ReceiverCallbacks {
  onStream: (stream: MediaStream | null) => void;
  onPhase: (phase: ReceiverPhase) => void;
  onMeta: (meta: ScreenMeta) => void;
  onStats: (stats: StreamStats | null) => void;
  onError: (message: string) => void;
  onAttempt: (n: number) => void;
}

const STATS_INTERVAL = 2000;
const STATS_REPORT_EVERY = 5; // 5 × 2 s = send screen.stats every 10 s
const UNSTABLE_GRACE = 5000;

async function resolveIceServers(sessionId: string): Promise<RTCIceServer[]> {
  const cached = iceServerCache.get(sessionId);
  if (cached) return cached;
  const { iceServers } = await api.get<{ iceServers: RTCIceServer[] }>("/api/rtc/ice-servers");
  iceServerCache.set(sessionId, iceServers);
  return iceServers;
}

/**
 * Admin-side receive-only WebRTC peer for one screen session.
 * Signalling runs over the shared admin WebSocket (rtc.offer / rtc.answer / rtc.ice).
 * Re-offers with a fresh RTCPeerConnection after >5 s of failed/disconnected
 * or after a WebSocket reconnect; the device reuses its running capture.
 */
export class ScreenReceiver {
  private pc: RTCPeerConnection | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private offs: (() => void)[] = [];
  private unstableTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private statsTick = 0;
  private lastBytes: { bytes: number; ts: number; frames: number } | null = null;
  private stopped = false;
  private attempt = 0;
  private iceServers: RTCIceServer[] | null = null;
  private readonly sessionId: string;
  private readonly cb: ReceiverCallbacks;

  constructor(sessionId: string, cb: ReceiverCallbacks) {
    this.sessionId = sessionId;
    this.cb = cb;
  }

  start() {
    this.offs.push(
      realtime.on("rtc.answer", (m) => {
        if (m.sessionId === this.sessionId) void this.handleAnswer(m.sdp);
      }),
      realtime.on("rtc.ice", (m) => {
        if (m.sessionId === this.sessionId) void this.handleRemoteIce(m.candidate);
      }),
      realtime.on("screen.meta", (m) => {
        if (m.sessionId === this.sessionId) this.cb.onMeta({ orientation: m.orientation, width: m.width, height: m.height });
      }),
      realtime.onOpen((isReconnect) => {
        // Fresh socket: the server forgot our signalling state, so re-offer.
        if (this.stopped) return;
        if (isReconnect || !this.pc) void this.negotiate();
      }),
    );
    void this.negotiate();
  }

  stop() {
    this.stopped = true;
    this.offs.forEach((o) => o());
    this.offs = [];
    this.teardownPc();
    this.cb.onPhase("closed");
    this.cb.onStream(null);
    this.cb.onStats(null);
  }

  /** Manual "Reconnect" from the UI. */
  renegotiate() {
    if (!this.stopped) void this.negotiate();
  }

  private teardownPc() {
    if (this.unstableTimer) clearTimeout(this.unstableTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.unstableTimer = null;
    this.statsTimer = null;
    this.lastBytes = null;
    this.pendingIce = [];
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        /* already closed */
      }
      this.pc = null;
    }
  }

  private async negotiate() {
    if (this.stopped) return;
    if (!realtime.isOpen) {
      this.cb.onPhase("waiting_ws");
      return; // onOpen will call us again
    }
    const isRetry = this.attempt > 0;
    this.attempt++;
    this.cb.onAttempt(this.attempt);
    this.cb.onPhase(isRetry ? "reconnecting" : "negotiating");
    this.teardownPc();

    try {
      if (!this.iceServers) this.iceServers = await resolveIceServers(this.sessionId);
    } catch (err) {
      this.cb.onError(`Could not load ICE servers: ${(err as Error).message}`);
      this.iceServers = [];
    }
    if (this.stopped) return;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers ?? [] });
    this.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });

    pc.ontrack = (ev) => {
      if (this.pc !== pc) return;
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.cb.onStream(stream);
    };

    pc.onicecandidate = (ev) => {
      if (this.pc !== pc || !ev.candidate) return;
      realtime.send({
        type: "rtc.ice",
        sessionId: this.sessionId,
        candidate: {
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
        },
      });
    };

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const st = pc.connectionState;
      if (st === "connected") {
        if (this.unstableTimer) clearTimeout(this.unstableTimer);
        this.unstableTimer = null;
        this.cb.onPhase("connected");
        realtime.send({ type: "screen.connected", sessionId: this.sessionId });
        this.startStats(pc);
      } else if (st === "connecting" || st === "new") {
        this.cb.onPhase("connecting");
      } else if (st === "failed" || st === "disconnected") {
        this.cb.onPhase("unstable");
        if (!this.unstableTimer) {
          this.unstableTimer = setTimeout(() => {
            this.unstableTimer = null;
            if (this.pc === pc && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) {
              void this.negotiate();
            }
          }, UNSTABLE_GRACE);
        }
      }
    };

    try {
      const offer = await pc.createOffer();
      if (this.pc !== pc) return;
      await pc.setLocalDescription(offer);
      if (this.pc !== pc) return;
      const sent = realtime.send({ type: "rtc.offer", sessionId: this.sessionId, sdp: offer.sdp ?? "" });
      if (!sent) {
        this.cb.onPhase("waiting_ws");
        return;
      }
      this.cb.onPhase("connecting");
    } catch (err) {
      this.cb.onError(`Could not create the WebRTC offer: ${(err as Error).message}`);
    }
  }

  private async handleAnswer(sdp: string) {
    const pc = this.pc;
    if (!pc || pc.signalingState !== "have-local-offer") return;
    try {
      await pc.setRemoteDescription({ type: "answer", sdp });
      const queued = this.pendingIce;
      this.pendingIce = [];
      for (const c of queued) await pc.addIceCandidate(c).catch(() => undefined);
    } catch (err) {
      this.cb.onError(`Could not apply the device's answer: ${(err as Error).message}`);
    }
  }

  private async handleRemoteIce(candidate: RTCIceCandidateInit) {
    const pc = this.pc;
    if (!pc) return;
    if (!pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    await pc.addIceCandidate(candidate).catch(() => undefined);
  }

  private startStats(pc: RTCPeerConnection) {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTick = 0;
    this.statsTimer = setInterval(() => void this.sampleStats(pc), STATS_INTERVAL);
    void this.sampleStats(pc);
  }

  private async sampleStats(pc: RTCPeerConnection) {
    if (this.pc !== pc) return;
    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return;
    }
    let inbound: Record<string, unknown> | null = null;
    let selectedPairId: string | null = null;
    const byId = new Map<string, Record<string, unknown>>();
    report.forEach((s: Record<string, unknown>) => {
      byId.set(s.id as string, s);
      if (s.type === "inbound-rtp" && (s.kind === "video" || s.mediaType === "video")) inbound = s;
      if (s.type === "transport" && typeof s.selectedCandidatePairId === "string") selectedPairId = s.selectedCandidatePairId;
    });
    if (!selectedPairId) {
      report.forEach((s: Record<string, unknown>) => {
        if (s.type === "candidate-pair" && s.state === "succeeded" && (s.nominated || s.selected)) selectedPairId = s.id as string;
      });
    }
    let route: StreamStats["route"] = null;
    if (selectedPairId) {
      const pair = byId.get(selectedPairId);
      const local = pair ? byId.get(pair.localCandidateId as string) : undefined;
      const remote = pair ? byId.get(pair.remoteCandidateId as string) : undefined;
      if (local || remote) route = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "relay" : "direct";
    }
    const ib = inbound as Record<string, unknown> | null;
    if (!ib) return;
    const bytes = Number(ib.bytesReceived ?? 0);
    const ts = Number(ib.timestamp ?? performance.now());
    const frames = Number(ib.framesDecoded ?? 0);
    let bitrateKbps = 0;
    let fps = typeof ib.framesPerSecond === "number" ? (ib.framesPerSecond as number) : 0;
    if (this.lastBytes && ts > this.lastBytes.ts) {
      const dt = (ts - this.lastBytes.ts) / 1000;
      bitrateKbps = Math.max(0, ((bytes - this.lastBytes.bytes) * 8) / 1000 / dt);
      if (!fps) fps = Math.max(0, (frames - this.lastBytes.frames) / dt);
    }
    this.lastBytes = { bytes, ts, frames };
    const stats: StreamStats = {
      bitrateKbps: Math.round(bitrateKbps),
      fps: Math.round(fps),
      width: Number(ib.frameWidth ?? 0),
      height: Number(ib.frameHeight ?? 0),
      route,
      packetsLost: typeof ib.packetsLost === "number" ? (ib.packetsLost as number) : null,
    };
    this.cb.onStats(stats);
    this.statsTick++;
    if (this.statsTick % STATS_REPORT_EVERY === 0) {
      realtime.send({
        type: "screen.stats",
        sessionId: this.sessionId,
        bitrateKbps: stats.bitrateKbps,
        fps: stats.fps,
        width: stats.width,
        height: stats.height,
      });
    }
  }
}
