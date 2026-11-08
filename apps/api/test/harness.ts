// Shared test harness: boots the real API (HTTP + WebSockets) on an in-memory Postgres and gives
// tests a fetch helper and a WebSocket peer that can await specific frames.
// The app is imported lazily so a test file can set process.env before config is read.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

let base = '';
let server: http.Server;
let wss: { clients: Set<WebSocket>; close(): void };
let teardown: () => Promise<void> = async () => {};

export async function startServer() {
  const [{ createApp }, { openDb }, { migrate }, { attachWebSocket }, { resetScreenState }, { state }] = await Promise.all([
    import('../src/app.js'), import('../src/db/index.js'), import('../src/db/migrate.js'),
    import('../src/realtime/ws.js'), import('../src/services/screen.js'), import('../src/state.js'),
  ]);
  state.db = await openDb('', 'memory://');
  await migrate(state.db, () => {});
  server = http.createServer(createApp({ rateLimits: false }));
  wss = attachWebSocket(server) as any;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  teardown = async () => {
    resetScreenState();
    for (const c of wss.clients) c.terminate();
    wss.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await state.db.close();
  };
  return state;
}

export const stopServer = () => teardown();

export type Res = { status: number; body: any; headers: Headers };
export async function call(method: string, path: string, opts: { token?: string; body?: unknown; cookie?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  const r = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
}

/** A WebSocket client that records every frame and lets tests await a specific one. */
export class Peer {
  ws!: WebSocket;
  frames: any[] = [];
  closed: { code: number } | null = null;
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  async open(ticket: string) {
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/ws?ticket=${ticket}`);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      this.frames.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
    this.ws.on('close', (code) => { this.closed = { code }; });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    return this;
  }
  next(pred: (m: any) => boolean, ms = 3000): Promise<any> {
    const hit = this.frames.find(pred);
    if (hit) { this.frames.splice(this.frames.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const waiter = { pred, resolve: (m: any) => { clearTimeout(t); this.frames.splice(this.frames.indexOf(m), 1); resolve(m); } };
      // A timed-out waiter must unregister, or it would silently swallow the next matching frame.
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`timed out waiting for frame; buffered: ${this.frames.map((f) => f.type).join(',') || 'none'}`));
      }, ms);
      this.waiters.push(waiter);
    });
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  async closedWith(ms = 3000) {
    const start = Date.now();
    while (!this.closed && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 20));
    return this.closed?.code;
  }
}
