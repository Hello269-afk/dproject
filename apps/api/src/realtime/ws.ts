import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { hub, type AdminConn, type DeviceConn } from './hub.js';
import { db } from '../state.js';
import { audit } from '../services/audit.js';
import { ingestCompliance, ingestDeviceState, ingestPermissions, ingestTelemetry, markOffline, markOnline } from '../services/devices.js';
import { deliverPending, onCommandResult } from '../services/commands.js';
import {
  endSession, getLive, onAdminConnected, onControlRevoked, relayControlInput, onAdminOffline, onAdminOnline, onConsent, onDeviceOffline, onDeviceOnline,
} from '../services/screen.js';
import { loadDevice, loadPolicy, orgDto, userDto } from '../services/serialize.js';

const MAX_FRAME = 256 * 1024; // SDP offers are a few KB; anything larger is abuse.
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 400;          // frames per window per socket (ICE bursts are ~20-50)

const candidate = z.object({
  candidate: z.string().max(2000),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
});
const sessionId = z.string().uuid();
const sdp = z.string().min(10).max(100_000);

const adminMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('rtc.offer'), sessionId, sdp }),
  z.object({ type: z.literal('rtc.ice'), sessionId, candidate }),
  z.object({ type: z.literal('screen.connected'), sessionId }),
  z.object({ type: z.literal('control.input'), sessionId, input: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tap'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
    z.object({ kind: z.literal('long_press'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
    z.object({ kind: z.literal('swipe'), x1: z.number().min(0).max(1), y1: z.number().min(0).max(1),
      x2: z.number().min(0).max(1), y2: z.number().min(0).max(1), durationMs: z.number().int().min(50).max(3000) }),
    z.object({ kind: z.literal('global'), action: z.enum(['back', 'home', 'recents', 'notifications', 'quick_settings']) }),
    z.object({ kind: z.literal('text'), text: z.string().min(1).max(500) }),
  ]) }),
  z.object({ type: z.literal('screen.stats'), sessionId, bitrateKbps: z.number().optional(), fps: z.number().optional(),
    width: z.number().optional(), height: z.number().optional() }),
]);

const deviceMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('telemetry') }).passthrough(),
  z.object({ type: z.literal('permissions'), permissions: z.array(z.any()) }),
  z.object({ type: z.literal('screen.consent'), sessionId, decision: z.enum(['approved', 'rejected', 'os_denied']),
    controlGranted: z.boolean().optional() }),
  z.object({ type: z.literal('control.revoked'), sessionId }),
  z.object({ type: z.literal('device.state') }).passthrough(),
  z.object({ type: z.literal('compliance') }).passthrough(),
  z.object({ type: z.literal('command.result'), commandId: z.string().uuid(), status: z.enum(['succeeded', 'failed', 'unsupported']),
    error: z.string().max(1000).optional() }),
  z.object({ type: z.literal('screen.stopped'), sessionId, reason: z.enum(['user_stopped', 'os_stopped', 'error']) }),
  z.object({ type: z.literal('screen.meta'), sessionId, orientation: z.enum(['portrait', 'landscape']),
    width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000) }),
  z.object({ type: z.literal('rtc.answer'), sessionId, sdp }),
  z.object({ type: z.literal('rtc.ice'), sessionId, candidate }),
]);

function rateLimiter() {
  let start = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - start > RATE_WINDOW_MS) { start = now; count = 0; }
    return ++count <= RATE_MAX;
  };
}

const sendJson = (ws: WebSocket, msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_FRAME });
  const alive = new WeakMap<WebSocket, boolean>();

  // Transport-level heartbeat: a socket that misses two pings (~40 s) is terminated.
  const heartbeat = setInterval(() => {
    hub.sweepTickets();
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 20_000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    const ticketId = new URL(req.url ?? '', 'http://x').searchParams.get('ticket') ?? '';
    const ticket = hub.redeemTicket(ticketId);
    if (!ticket) { ws.close(4001, 'invalid_ticket'); return; }
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null;
    const allow = rateLimiter();
    if (ticket.kind === 'admin') void handleAdmin(ws, { kind: 'admin', ws, userId: ticket.userId, orgId: ticket.orgId, role: ticket.role, name: ticket.name }, allow);
    else void handleDevice(ws, { kind: 'device', ws, deviceId: ticket.deviceId, orgId: ticket.orgId }, allow, ip);
  });
  return wss;
}

function parse(raw: unknown): unknown {
  try { return JSON.parse(String(raw)); } catch { return null; }
}

async function handleAdmin(ws: WebSocket, c: AdminConn, allow: () => boolean) {
  const [u] = await db().query(`SELECT * FROM users WHERE id = $1`, [c.userId]);
  if (!u || u.status !== 'active') { ws.close(4003, 'account_disabled'); return; }
  hub.addAdmin(c);
  onAdminOnline(c.userId);
  sendJson(ws, { type: 'hello', user: userDto(u) });

  ws.on('message', async (raw) => {
    if (!allow()) { ws.close(4029, 'rate_limited'); return; }
    const parsed = adminMsg.safeParse(parse(raw));
    if (!parsed.success) return;
    const m = parsed.data;
    try {
      if (m.type === 'ping') { sendJson(ws, { type: 'pong' }); return; }
      if (m.type === 'control.input') { await relayControlInput(c.userId, c.orgId, m.sessionId, m.input); return; }
      const s = getLive(m.sessionId);
      // Only the admin who requested the session (and whose consent the user granted) may signal on it.
      if (!s || s.orgId !== c.orgId || s.requestedBy !== c.userId) return;
      if (m.type === 'screen.stats') return;
      if (s.status === 'awaiting_consent') return;
      if (m.type === 'rtc.offer') hub.toDevice(s.deviceId, { type: 'rtc.offer', sessionId: s.id, sdp: m.sdp });
      else if (m.type === 'rtc.ice') hub.toDevice(s.deviceId, { type: 'rtc.ice', sessionId: s.id, candidate: m.candidate });
      else if (m.type === 'screen.connected') await onAdminConnected(c.userId, s.id);
    } catch (e) {
      console.error('[ws admin]', e);
    }
  });
  ws.on('close', () => {
    hub.removeAdmin(c);
    onAdminOffline(c.orgId, c.userId);
  });
}

async function handleDevice(ws: WebSocket, c: DeviceConn, allow: () => boolean, ip: string | null) {
  const device = await loadDevice(db(), c.orgId, c.deviceId);
  if (!device || device.lifecycleStatus !== 'authenticated') { ws.close(4003, device?.lifecycleStatus ?? 'unknown_device'); return; }
  const ref = { id: device.id, orgId: device.orgId, name: device.name };

  // Buffer frames that arrive while presence bookkeeping is still writing, so nothing is lost.
  const queue: unknown[] = [];
  let ready = false;
  const replaced = hub.setDevice(c);
  if (replaced) replaced.ws.close(4008, 'replaced');
  ws.on('message', (raw) => {
    if (!allow()) { ws.close(4029, 'rate_limited'); return; }
    if (ready) void onFrame(raw); else queue.push(raw);
  });
  ws.on('close', () => {
    if (!hub.removeDevice(c)) return; // a newer socket took over; it owns presence now
    onDeviceOffline(c.deviceId);
    void markOffline(ref).catch((e) => console.error('[ws device close]', e));
  });

  await markOnline(ref, ip);
  const [o] = await db().query(`SELECT * FROM organizations WHERE id = $1`, [c.orgId]);
  sendJson(ws, { type: 'hello', device: await loadDevice(db(), c.orgId, c.deviceId), organization: orgDto(o),
    policy: await loadPolicy(db(), c.orgId) });
  onDeviceOnline(c.deviceId);
  await deliverPending(c.deviceId);
  ready = true;
  for (const raw of queue.splice(0)) await onFrame(raw);

  async function onFrame(raw: unknown) {
    const parsed = deviceMsg.safeParse(parse(raw));
    if (!parsed.success) return;
    const m = parsed.data;
    try {
      switch (m.type) {
        case 'ping': sendJson(ws, { type: 'pong' }); return;
        case 'telemetry': {
          const { type: _t, ...t } = m;
          await ingestTelemetry(ref, t);
          return;
        }
        case 'permissions': await ingestPermissions(ref, { permissions: m.permissions }); return;
        case 'screen.consent': await onConsent(ref, m.sessionId, m.decision, m.controlGranted ?? false); return;
        case 'control.revoked': await onControlRevoked(ref, m.sessionId); return;
        case 'device.state': { const { type: _t, ...st } = m; await ingestDeviceState(ref, st); return; }
        case 'compliance': { const { type: _t, ...cp } = m; await ingestCompliance(ref, cp); return; }
        case 'command.result': await onCommandResult(ref, m.commandId, m.status, m.error); return;
      }
      const s = getLive(m.sessionId);
      if (!s || s.deviceId !== c.deviceId) return;
      if (m.type === 'screen.stopped') {
        await endSession(s.id, 'ended', m.reason, { type: 'device', id: ref.id, name: ref.name }, false);
      } else if (s.status !== 'awaiting_consent') {
        const out = m.type === 'rtc.answer' ? { type: 'rtc.answer', sessionId: s.id, sdp: m.sdp }
          : m.type === 'rtc.ice' ? { type: 'rtc.ice', sessionId: s.id, candidate: m.candidate }
          : { type: 'screen.meta', sessionId: s.id, orientation: m.orientation, width: m.width, height: m.height };
        hub.toUser(s.orgId, s.requestedBy, out);
      }
    } catch (e) {
      if ((e as any)?.name === 'ZodError') return; // malformed telemetry is dropped, not fatal
      console.error('[ws device]', e);
      await audit({ orgId: c.orgId, actor: { type: 'system' }, action: 'ws.error', targetType: 'device', targetId: c.deviceId,
        metadata: { message: String((e as Error).message).slice(0, 200) } }).catch(() => {});
    }
  }
}
