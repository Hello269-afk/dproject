// Phase 2: company-owned provisioning, consented remote control, queued commands with step-up
// re-auth for wipe, and security policy / compliance. Same harness as e2e: real server, scripted device.

process.env.APP_DOWNLOAD_URL = 'https://example.test/mdm-agent.apk';
process.env.APP_SIGNATURE_CHECKSUM = 'AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Peer, call, startServer, stopServer } from './harness.js';

before(startServer);
after(stopServer);

const PASSWORD = 'correct-horse-battery';
/** Polls the API until the device is offline: buffered WS frames from earlier steps can't be trusted for this. */
async function untilOffline(token: string, id: string) {
  for (let i = 0; i < 100; i++) {
    if (!(await call('GET', `/api/devices/${id}`, { token })).body.device.online) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('device never went offline');
}

const granted = (...keys: string[]) => keys.map((key) => ({ key, status: 'granted' }));

async function enroll(owner: string, opts: { ownership: 'company' | 'personal'; requested: string[]; install: string; name: string; mode?: string }) {
  const e = await call('POST', '/api/enrollments', { token: owner, body: {
    expiresInMinutes: 60, requestedPermissions: opts.requested, requiredPermissions: ['screen_capture'], ownership: opts.ownership,
    deviceNameHint: opts.name,
  } });
  assert.equal(e.status, 201);
  const done = await call('POST', '/api/device/enroll/complete', { body: {
    token: e.body.token, installationId: opts.install, permissions: granted(...opts.requested),
    device: { platform: 'android', manufacturer: 'Samsung', model: 'Galaxy A55', osVersion: '14', appVersion: '2.0.0', managementMode: opts.mode ?? 'none' },
  } });
  assert.equal(done.status, 201);
  const { accessToken } = (await call('POST', '/api/device/token', { body: { deviceId: done.body.deviceId, deviceSecret: done.body.deviceSecret } })).body;
  const connect = async () => {
    const p = await new Peer().open((await call('POST', '/api/device/ws-ticket', { token: accessToken })).body.ticket);
    await p.next((m) => m.type === 'hello');
    return p;
  };
  return { enrollment: e.body, id: done.body.deviceId as string, token: accessToken as string, ws: await connect(), connect };
}

describe('Phase 2: control, commands, policy', () => {
  let owner: string;
  let operator: string;
  let adminWs: Peer;
  let company: Awaited<ReturnType<typeof enroll>>;
  let personal: Awaited<ReturnType<typeof enroll>>;

  it('sets up an org, an operator, and the admin socket', async () => {
    owner = (await call('POST', '/api/auth/setup', { body: { orgName: 'Acme', name: 'Olivia Owner', email: 'o@acme.test', password: PASSWORD } })).body.accessToken;
    await call('POST', '/api/users', { token: owner, body: { email: 'op@acme.test', name: 'Oscar Op', role: 'operator', password: 'operator-pass-123' } });
    operator = (await call('POST', '/api/auth/login', { body: { email: 'op@acme.test', password: 'operator-pass-123' } })).body.accessToken;
    adminWs = await new Peer().open((await call('POST', '/api/ws-ticket', { token: owner })).body.ticket);
    await adminWs.next((m) => m.type === 'hello');
  });

  it('issues an Android Enterprise provisioning QR only for company-owned enrollments', async () => {
    const c = await call('POST', '/api/enrollments', { token: owner, body: {
      expiresInMinutes: 60, requestedPermissions: ['screen_capture'], requiredPermissions: [], ownership: 'company' } });
    const payload = JSON.parse(c.body.androidProvisioning.qrPayload);
    assert.equal(payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'], process.env.APP_SIGNATURE_CHECKSUM);
    assert.equal(payload['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'].mdm_token, c.body.token);
    assert.equal(c.body.enrollment.ownership, 'company');
    const p = await call('POST', '/api/enrollments', { token: owner, body: {
      expiresInMinutes: 60, requestedPermissions: ['screen_capture'], requiredPermissions: [] } });
    assert.equal(p.body.androidProvisioning, undefined);
    assert.equal(p.body.enrollment.ownership, 'personal');
    const bad = await call('POST', '/api/enrollments', { token: owner, body: {
      expiresInMinutes: 60, requestedPermissions: ['accessibility'], requiredPermissions: ['accessibility'] } });
    assert.equal(bad.status, 400, 'remote control can never be a condition of enrollment');
  });

  it('enrolls a company device (device owner) and a personal device, and records reported capabilities', async () => {
    company = await enroll(owner, { ownership: 'company', requested: ['screen_capture', 'accessibility', 'device_admin'], install: 'inst-company-1', name: 'Warehouse 1', mode: 'device_owner' });
    personal = await enroll(owner, { ownership: 'personal', requested: ['screen_capture'], install: 'inst-personal-1', name: 'Sam BYOD' });
    company.ws.send({ type: 'device.state', managementMode: 'device_owner', capabilities: ['lock', 'reboot', 'wipe', 'remote_control', 'apply_policy'] });
    const upd = await adminWs.next((m) => m.type === 'device.updated' && m.device.id === company.id && m.device.capabilities.length === 5);
    assert.equal(upd.device.ownership, 'company');
    assert.equal(upd.device.managementMode, 'device_owner');
    personal.ws.send({ type: 'device.state', managementMode: 'none', capabilities: [] });
  });

  it('refuses remote control when the device has not enabled it', async () => {
    const r = await call('POST', `/api/devices/${personal.id}/screen-sessions`, { token: operator, body: { purpose: 'Fix email', control: true } });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'permission_required');
  });

  it('relays control input only after the user grants control and the stream is live', async () => {
    const r = await call('POST', `/api/devices/${company.id}/screen-sessions`, { token: owner, body: { purpose: 'Configure scanner', control: true } });
    assert.equal(r.status, 201);
    const sid = r.body.session.id;
    const req = await company.ws.next((m) => m.type === 'screen.request');
    assert.equal(req.control, true);

    company.ws.send({ type: 'screen.consent', sessionId: sid, decision: 'approved', controlGranted: true });
    const connecting = await adminWs.next((m) => m.type === 'screen.session.updated' && m.session.status === 'connecting');
    assert.equal(connecting.session.controlGranted, true);

    adminWs.send({ type: 'control.input', sessionId: sid, input: { kind: 'tap', x: 0.5, y: 0.5 } });
    await assert.rejects(company.ws.next((m) => m.type === 'control.input', 300), 'no input before the stream is live');

    adminWs.send({ type: 'screen.connected', sessionId: sid });
    await adminWs.next((m) => m.type === 'screen.session.updated' && m.session.status === 'active');
    adminWs.send({ type: 'control.input', sessionId: sid, input: { kind: 'tap', x: 0.25, y: 0.75 } });
    adminWs.send({ type: 'control.input', sessionId: sid, input: { kind: 'swipe', x1: 0.5, y1: 0.9, x2: 0.5, y2: 0.2, durationMs: 300 } });
    adminWs.send({ type: 'control.input', sessionId: sid, input: { kind: 'global', action: 'home' } });
    adminWs.send({ type: 'control.input', sessionId: sid, input: { kind: 'tap', x: 7, y: 0.5 } }); // out of range: dropped
    const tap = await company.ws.next((m) => m.type === 'control.input' && m.input.kind === 'tap');
    assert.deepEqual(tap.input, { kind: 'tap', x: 0.25, y: 0.75 });
    await company.ws.next((m) => m.type === 'control.input' && m.input.kind === 'swipe');
    await company.ws.next((m) => m.type === 'control.input' && m.input.kind === 'global');
    await assert.rejects(company.ws.next((m) => m.type === 'control.input', 300));

    // A different admin, even an owner-level one in the same org, can't inject into someone else's session.
    const opWs = await new Peer().open((await call('POST', '/api/ws-ticket', { token: operator })).body.ticket);
    await opWs.next((m) => m.type === 'hello');
    opWs.send({ type: 'control.input', sessionId: sid, input: { kind: 'global', action: 'back' } });
    await assert.rejects(company.ws.next((m) => m.type === 'control.input', 300));
    opWs.ws.close();

    company.ws.send({ type: 'control.revoked', sessionId: sid });
    const revoked = await adminWs.next((m) => m.type === 'screen.session.updated' && m.session.id === sid && m.session.status === 'active' && m.session.controlGranted === false);
    assert.equal(revoked.session.status, 'active', 'session continues view-only');
    adminWs.send({ type: 'control.input', sessionId: sid, input: { kind: 'tap', x: 0.1, y: 0.1 } });
    await assert.rejects(company.ws.next((m) => m.type === 'control.input', 300), 'no input after the user withdrew control');

    const end = await call('POST', `/api/screen-sessions/${sid}/end`, { token: owner });
    assert.equal(end.body.session.inputCount, 3);
  });

  it('keeps a session view-only when the user declines control', async () => {
    const r = await call('POST', `/api/devices/${company.id}/screen-sessions`, { token: owner, body: { purpose: 'Look only please', control: true } });
    const sid = r.body.session.id;
    await company.ws.next((m) => m.type === 'screen.request');
    company.ws.send({ type: 'screen.consent', sessionId: sid, decision: 'approved', controlGranted: false });
    adminWs.send({ type: 'screen.connected', sessionId: sid });
    const active = await adminWs.next((m) => m.type === 'screen.session.updated' && m.session.id === sid && m.session.status === 'active');
    assert.equal(active.session.controlGranted, false);
    adminWs.send({ type: 'control.input', sessionId: sid, input: { kind: 'tap', x: 0.5, y: 0.5 } });
    await assert.rejects(company.ws.next((m) => m.type === 'control.input', 300));
    await call('POST', `/api/screen-sessions/${sid}/end`, { token: owner });
  });

  it('delivers a lock command and records the device result once', async () => {
    const r = await call('POST', `/api/devices/${company.id}/commands`, { token: operator, body: { action: 'lock', reason: 'User reported phone left in taxi' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.command.status, 'sent');
    const cmd = await company.ws.next((m) => m.type === 'command' && m.action === 'lock');
    company.ws.send({ type: 'command.result', commandId: cmd.commandId, status: 'succeeded' });
    await adminWs.next((m) => m.type === 'command.updated' && m.command.id === cmd.commandId && m.command.status === 'succeeded');
    company.ws.send({ type: 'command.result', commandId: cmd.commandId, status: 'failed', error: 'late duplicate' });
    await new Promise((res) => setTimeout(res, 200));
    const list = await call('GET', `/api/devices/${company.id}/commands`, { token: owner });
    assert.equal(list.body.commands.find((c: any) => c.id === cmd.commandId).status, 'succeeded', 'results are accepted once');
  });

  it('enforces command roles, capabilities and ownership', async () => {
    assert.equal((await call('POST', `/api/devices/${company.id}/commands`, { token: operator, body: { action: 'reboot', reason: 'Frozen app' } })).status, 403);
    const nope = await call('POST', `/api/devices/${personal.id}/commands`, { token: owner, body: { action: 'lock', reason: 'testing lock' } });
    assert.equal(nope.status, 409);
    assert.equal(nope.body.error.code, 'not_supported', 'online device did not report lock capability');
    const wipePersonal = await call('POST', `/api/devices/${personal.id}/commands`, { token: owner,
      body: { action: 'wipe', reason: 'Lost', confirm: 'Sam BYOD', password: PASSWORD } });
    assert.equal(wipePersonal.body.error.code, 'not_company_owned');
  });

  it('requires typed confirmation and the admin password to wipe', async () => {
    const noConfirm = await call('POST', `/api/devices/${company.id}/commands`, { token: owner, body: { action: 'wipe', reason: 'Stolen', confirm: 'wrong', password: PASSWORD } });
    assert.equal(noConfirm.body.error.code, 'confirmation_mismatch');
    const badPw = await call('POST', `/api/devices/${company.id}/commands`, { token: owner, body: { action: 'wipe', reason: 'Stolen', confirm: 'Warehouse 1', password: 'not-my-password' } });
    assert.equal(badPw.status, 401);
    assert.equal(badPw.body.error.code, 'reauth_failed');
  });

  it('queues commands for an offline device and delivers them on reconnect', async () => {
    company.ws.ws.close();
    await untilOffline(owner, company.id);
    const wipe = await call('POST', `/api/devices/${company.id}/commands`, { token: owner, body: { action: 'wipe', reason: 'Stolen phone', confirm: 'Warehouse 1', password: PASSWORD } });
    assert.equal(wipe.status, 201);
    assert.equal(wipe.body.command.status, 'pending');
    const lock = await call('POST', `/api/devices/${company.id}/commands`, { token: owner, body: { action: 'lock', reason: 'Lock first' } });
    const cancelled = await call('POST', `/api/commands/${lock.body.command.id}/cancel`, { token: owner });
    assert.equal(cancelled.body.command.status, 'cancelled');

    company.ws = await company.connect();
    const delivered = await company.ws.next((m) => m.type === 'command');
    assert.equal(delivered.action, 'wipe', 'only the still-open command is delivered');
    await assert.rejects(company.ws.next((m) => m.type === 'command', 300));
    company.ws.send({ type: 'command.result', commandId: delivered.commandId, status: 'succeeded' });
    await adminWs.next((m) => m.type === 'command.updated' && m.command.id === delivered.commandId && m.command.status === 'succeeded');
  });

  it('pushes policy (enforced on company devices, evaluated on personal) and tracks compliance', async () => {
    const p = await call('PUT', '/api/policy', { token: owner, body: {
      passcode: 'medium', maxScreenLockTimeoutSec: 300, disableCamera: false, disallowUsbDebugging: true,
      disallowFactoryResetByUser: true, minAndroidPatchAgeDays: 90 } });
    assert.equal(p.status, 200);
    assert.equal(p.body.policy.version, 2);
    assert.equal(p.body.queuedToDevices, 1);
    const apply = await company.ws.next((m) => m.type === 'command' && m.action === 'apply_policy');
    assert.equal(apply.params.passcode, 'medium');
    const upd = await personal.ws.next((m) => m.type === 'policy.updated');
    assert.equal(upd.policy.version, 2);
    assert.equal((await call('PUT', '/api/policy', { token: operator, body: p.body.policy })).status, 403);

    personal.ws.send({ type: 'compliance', policyVersion: 2, enforced: false, passcodeSufficient: false, encrypted: true,
      securityPatch: '2025-01-05', issues: ['Screen lock is weaker than required', 'Security patch is older than 90 days'] });
    const nc = await adminWs.next((m) => m.type === 'device.updated' && m.device.id === personal.id && m.device.displayStatus === 'non_compliant');
    assert.equal(nc.device.compliance.issues.length, 2);
    const overview = await call('GET', '/api/overview', { token: owner });
    assert.equal(overview.body.counts.nonCompliant, 1);
  });

  it('cancels pending commands when a device is revoked', async () => {
    personal.ws.ws.close();
    await untilOffline(owner, personal.id);
    // Offline devices may queue a lock; the device answers `unsupported` if it can't.
    const q = await call('POST', `/api/devices/${personal.id}/commands`, { token: owner, body: { action: 'lock', reason: 'Queued then revoked' } });
    assert.equal(q.body.command.status, 'pending');
    await call('POST', `/api/devices/${personal.id}/revoke`, { token: owner, body: { reason: 'Left company', confirm: 'Sam BYOD' } });
    const list = await call('GET', `/api/devices/${personal.id}/commands`, { token: owner });
    assert.equal(list.body.commands[0].status, 'cancelled');
  });

  it('audits the Phase 2 actions', async () => {
    const logs = (await call('GET', '/api/audit-logs?limit=200', { token: owner })).body.logs.map((l: any) => l.action);
    for (const a of ['screen.control_granted', 'screen.control_revoked', 'command.lock.queued', 'command.lock.succeeded',
      'command.wipe.queued', 'command.wipe.succeeded', 'command.lock.cancelled', 'auth.reauth_failed', 'policy.updated',
      'device.non_compliant']) {
      assert.ok(logs.includes(a), `missing audit ${a}`);
    }
  });
});
