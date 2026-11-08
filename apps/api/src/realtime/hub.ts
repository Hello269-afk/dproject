import type { WebSocket } from 'ws';
import { config } from '../config.js';
import { randomToken } from '../lib/crypto.js';

export type AdminConn = { kind: 'admin'; ws: WebSocket; userId: string; orgId: string; role: string; name: string };
export type DeviceConn = { kind: 'device'; ws: WebSocket; deviceId: string; orgId: string };
export type Conn = AdminConn | DeviceConn;

export type Ticket =
  | { kind: 'admin'; userId: string; orgId: string; role: string; name: string; exp: number }
  | { kind: 'device'; deviceId: string; orgId: string; exp: number };

type TicketInput = Ticket extends infer U ? (U extends Ticket ? Omit<U, 'exp'> : never) : never;

// Single-instance registry. Running more than one API instance needs a shared bus (e.g. Redis
// pub/sub) for these maps and the ticket store. See docs/ARCHITECTURE.md.
const admins = new Map<string, Set<AdminConn>>();
const devices = new Map<string, DeviceConn>();
const tickets = new Map<string, Ticket>();

function send(ws: WebSocket, msg: object): boolean {
  if (ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

export const hub = {
  issueTicket(t: TicketInput): string {
    const id = randomToken(24);
    tickets.set(id, { ...t, exp: Date.now() + config.wsTicketTtlMs } as Ticket);
    return id;
  },
  redeemTicket(id: string): Ticket | null {
    const t = tickets.get(id);
    tickets.delete(id);
    return t && t.exp > Date.now() ? t : null;
  },
  sweepTickets() {
    const now = Date.now();
    for (const [k, t] of tickets) if (t.exp <= now) tickets.delete(k);
  },

  addAdmin(c: AdminConn) {
    let set = admins.get(c.orgId);
    if (!set) admins.set(c.orgId, (set = new Set()));
    set.add(c);
  },
  removeAdmin(c: AdminConn) {
    admins.get(c.orgId)?.delete(c);
  },
  /** Registers a device socket, returning any connection it replaced. */
  setDevice(c: DeviceConn): DeviceConn | undefined {
    const prev = devices.get(c.deviceId);
    devices.set(c.deviceId, c);
    return prev;
  },
  /** Removes the device only if `c` is still the current socket (a newer one may have replaced it). */
  removeDevice(c: DeviceConn): boolean {
    if (devices.get(c.deviceId) !== c) return false;
    devices.delete(c.deviceId);
    return true;
  },

  isDeviceOnline: (deviceId: string) => devices.has(deviceId),
  isUserOnline(orgId: string, userId: string) {
    for (const c of admins.get(orgId) ?? []) if (c.userId === userId) return true;
    return false;
  },
  toOrgAdmins(orgId: string, msg: object) {
    for (const c of admins.get(orgId) ?? []) send(c.ws, msg);
  },
  toUser(orgId: string, userId: string, msg: object) {
    for (const c of admins.get(orgId) ?? []) if (c.userId === userId) send(c.ws, msg);
  },
  toDevice(deviceId: string, msg: object): boolean {
    const c = devices.get(deviceId);
    return c ? send(c.ws, msg) : false;
  },
  closeDevice(deviceId: string, code: number, reason: string) {
    devices.get(deviceId)?.ws.close(code, reason);
  },
  /** Drop an admin user's live sockets (role change, disable). */
  closeUser(orgId: string, userId: string, code: number, reason: string) {
    for (const c of admins.get(orgId) ?? []) if (c.userId === userId) c.ws.close(code, reason);
  },
  stats: () => ({ admins: [...admins.values()].reduce((n, s) => n + s.size, 0), devices: devices.size }),
};
