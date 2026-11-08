import type { Queryable } from '../db/index.js';
import { hub } from '../realtime/hub.js';
import { db } from '../state.js';
import { auditDto } from './serialize.js';

export type Actor =
  | { type: 'user'; id: string; name: string }
  | { type: 'device'; id: string; name: string }
  | { type: 'system' };

export type AuditEntry = {
  orgId: string;
  actor: Actor;
  action: string;
  targetType?: string;
  targetId?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
};

/** Appends to the immutable audit trail and pushes it to dashboards in real time. */
export async function audit(e: AuditEntry, q: Queryable = db()) {
  const actorId = e.actor.type === 'system' ? null : e.actor.id;
  const actorName = e.actor.type === 'system' ? 'System' : e.actor.name;
  const [row] = await q.query(
    `INSERT INTO audit_logs (org_id, actor_type, actor_id, actor_name, action, target_type, target_id, ip, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [e.orgId, e.actor.type, actorId, actorName, e.action, e.targetType ?? null, e.targetId ?? null, e.ip ?? null, JSON.stringify(e.metadata ?? {})],
  );
  const log = auditDto(row);
  hub.toOrgAdmins(e.orgId, { type: 'audit.created', log });
  return log;
}
