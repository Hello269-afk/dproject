import { api } from "./api";
import type { ClientMessage, ServerEventMap, ServerEventType } from "./types";

export type WsStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface WsDiagnostics {
  status: WsStatus;
  url: string;
  connectedAt: number | null;
  lastMessageAt: number | null;
  lastCloseCode: number | null;
  lastError: string | null;
  reconnectAttempts: number;
  latencyMs: number | null;
  nextRetryAt: number | null;
}

type Handler<K extends ServerEventType> = (payload: ServerEventMap[K]) => void;
type AnyHandler = (type: string, payload: unknown) => void;

const PING_INTERVAL = 25_000;
const MAX_BACKOFF = 30_000;

export function wsUrl(ticket?: string) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const base = `${proto}//${location.host}/ws`;
  return ticket ? `${base}?ticket=${encodeURIComponent(ticket)}` : base;
}

/**
 * Single admin WebSocket. Fetches a fresh single-use ticket for every
 * (re)connect, reconnects with jittered exponential backoff, and exposes a
 * typed subscription API plus `send()` for rtc/screen messages.
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private wanted = false;
  private generation = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingSentAt: number | null = null;
  private handlers = new Map<string, Set<(p: unknown) => void>>();
  private anyHandlers = new Set<AnyHandler>();
  private openHandlers = new Set<(isReconnect: boolean) => void>();
  private diagListeners = new Set<() => void>();
  private hasConnectedBefore = false;

  diag: WsDiagnostics = {
    status: "idle",
    url: wsUrl(),
    connectedAt: null,
    lastMessageAt: null,
    lastCloseCode: null,
    lastError: null,
    reconnectAttempts: 0,
    latencyMs: null,
    nextRetryAt: null,
  };

  private setDiag(patch: Partial<WsDiagnostics>) {
    this.diag = { ...this.diag, ...patch };
    this.diagListeners.forEach((l) => l());
  }

  subscribeDiagnostics = (listener: () => void) => {
    this.diagListeners.add(listener);
    return () => {
      this.diagListeners.delete(listener);
    };
  };
  getDiagnostics = () => this.diag;

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.hasConnectedBefore = false;
    this.setDiag({ reconnectAttempts: 0 });
    void this.connect();
  }

  stop() {
    this.wanted = false;
    this.generation++;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000, "client stop");
      this.ws = null;
    }
    this.setDiag({ status: "idle", connectedAt: null, nextRetryAt: null, latencyMs: null });
  }

  /** Force an immediate reconnect attempt (e.g. from the diagnostics panel). */
  reconnectNow() {
    if (!this.wanted) return;
    this.generation++;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000, "manual reconnect");
      this.ws = null;
    }
    void this.connect();
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  on<K extends ServerEventType>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const h = handler as (p: unknown) => void;
    set.add(h);
    return () => {
      set!.delete(h);
    };
  }

  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  /** Fires on every successful open; `isReconnect` is true after the first. */
  onOpen(handler: (isReconnect: boolean) => void): () => void {
    this.openHandlers.add(handler);
    return () => {
      this.openHandlers.delete(handler);
    };
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private async connect() {
    const gen = ++this.generation;
    this.setDiag({ status: this.hasConnectedBefore ? "reconnecting" : "connecting", nextRetryAt: null });
    let ticket: string;
    try {
      ({ ticket } = await api.post<{ ticket: string }>("/api/ws-ticket"));
    } catch (err) {
      if (gen !== this.generation) return;
      this.setDiag({ lastError: `Ticket request failed: ${(err as Error).message}` });
      this.scheduleReconnect();
      return;
    }
    if (gen !== this.generation || !this.wanted) return;

    const ws = new WebSocket(wsUrl(ticket));
    this.ws = ws;

    ws.onopen = () => {
      if (gen !== this.generation) return;
      const isReconnect = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.setDiag({ status: "open", connectedAt: Date.now(), reconnectAttempts: 0, lastError: null });
      this.pingTimer = setInterval(() => {
        this.pingSentAt = Date.now();
        this.send({ type: "ping" });
      }, PING_INTERVAL);
      this.pingSentAt = Date.now();
      this.send({ type: "ping" });
      this.openHandlers.forEach((h) => h(isReconnect));
    };

    ws.onmessage = (ev) => {
      if (gen !== this.generation) return;
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;
      this.setDiag({ lastMessageAt: Date.now() });
      if (msg.type === "ping") {
        this.send({ type: "pong" });
        return;
      }
      if (msg.type === "pong") {
        if (this.pingSentAt) this.setDiag({ latencyMs: Date.now() - this.pingSentAt });
        this.pingSentAt = null;
        return;
      }
      const { type, ...payload } = msg;
      this.handlers.get(type)?.forEach((h) => {
        try {
          h(payload);
        } catch (e) {
          console.error(`[ws] handler for ${type} failed`, e);
        }
      });
      this.anyHandlers.forEach((h) => h(type, payload));
    };

    ws.onerror = () => {
      if (gen !== this.generation) return;
      this.setDiag({ lastError: "WebSocket error" });
    };

    ws.onclose = (ev) => {
      if (gen !== this.generation) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.setDiag({ lastCloseCode: ev.code, connectedAt: null, latencyMs: null });
      if (this.wanted) this.scheduleReconnect();
      else this.setDiag({ status: "closed" });
    };
  }

  private scheduleReconnect() {
    if (!this.wanted) return;
    const attempt = this.diag.reconnectAttempts + 1;
    const base = Math.min(MAX_BACKOFF, 1000 * 2 ** Math.min(attempt - 1, 5));
    const delay = Math.round(base * (0.7 + Math.random() * 0.6));
    this.setDiag({
      status: "reconnecting",
      reconnectAttempts: attempt,
      nextRetryAt: Date.now() + delay,
    });
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }
}

export const realtime = new RealtimeClient();
