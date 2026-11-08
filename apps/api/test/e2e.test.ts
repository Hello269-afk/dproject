// End-to-end protocol test: real HTTP server, real WebSockets, in-memory Postgres (PGlite).
// The "device" here is a scripted protocol client standing in for the Android agent, so the
// server's enforcement (consent, RBAC, org isolation, revocation) is exercised without hardware.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { state } from '../src/state.js';
import { Peer, call, startServer, stopServer } from './harness.js';

const ALL_REQUESTED = ['screen_capture', 'location', 'notifications'];

before(startServer);
after(stopServer);

describe('MDM platform end-to-end', () => {
  let owner: string;
  let ownerCookie: string;
  let adminWs: Peer;
  let enrollment: any;
  let deviceId: string;
  let deviceSecret: string;
  let deviceToken: string;
  let deviceWs: Peer;

  it('bootstraps the first organisation and owner, then locks setup', async () => {
    assert.equal((await call('GET', '/api/auth/setup-status')).body.needsSetup, true);
    const r = await call('POST', '/api/auth/setup', { body: { orgName: 'Acme Corp', name: 'Olivia Owner', email: 'owner@acme.test', password: 'correct-horse-battery' } });
    assert.equal(r.status, 201);
    owner = r.body.accessToken;
    ownerCookie = r.headers.get('set-cookie')!.split(';')[0]!;
    assert.match(r.headers.get('set-cookie')!, /HttpOnly/i);
    const again = await call('POST', '/api/auth/setup', { body: { orgName: 'X', name: 'X', email: 'x@x.test', password: 'correct-horse-battery' } });
    assert.equal(again.status, 409);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const r1 = await call('POST', '/api/auth/refresh', { cookie: ownerCookie });
    assert.equal(r1.status, 200);
    const newCookie = r1.headers.get('set-cookie')!.split(';')[0]!;
    const reuse = await call('POST', '/api/auth/refresh', { cookie: ownerCookie });
    assert.equal(reuse.status, 401, 'old refresh token must not work twice');
    const afterTheft = await call('POST', '/api/auth/refresh', { cookie: newCookie });
    assert.equal(afterTheft.status, 401, 'whole family revoked after reuse');
    const login = await call('POST', '/api/auth/login', { body: { email: 'owner@acme.test', password: 'correct-horse-battery' } });
    assert.equal(login.status, 200);
    owner = login.body.accessToken;
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'owner@acme.test', password: 'wrong-password!!' } })).status, 401);
  });

  it('connects the admin dashboard socket with a single-use ticket', async () => {
    const { body } = await call('POST', '/api/ws-ticket', { token: owner });
    adminWs = await new Peer().open(body.ticket);
    await adminWs.next((m) => m.type === 'hello');
    const reused = await new Peer().open(body.ticket);
    assert.equal(await reused.closedWith(), 4001);
  });

  it('creates an enrollment invitation and tracks scan → app opened → permissions reviewed', async () => {
    const member = await call('POST', '/api/users', { token: owner, body: { email: 'sam@acme.test', name: 'Sam Field', role: 'member' } });
    assert.equal(member.status, 201);
    const r = await call('POST', '/api/enrollments', { token: owner, body: {
      assignedUserId: member.body.user.id, deviceNameHint: "Sam's Pixel", expiresInMinutes: 60,
      requestedPermissions: ALL_REQUESTED, requiredPermissions: ['screen_capture'],
    } });
    assert.equal(r.status, 201);
    enrollment = r.body;
    assert.match(enrollment.pairingCode, /^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    assert.ok(enrollment.enrollmentUrl.endsWith(`/enroll/${enrollment.token}`));
    assert.ok(enrollment.appLink.startsWith('mdm://enroll?token='));

    const scan = await call('POST', '/api/public/enroll/scan', { body: { token: enrollment.token } });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.organization.name, 'Acme Corp');
    assert.deepEqual(scan.body.requestedPermissions.map((p: any) => p.key).sort(), [...ALL_REQUESTED].sort());
    assert.equal((await adminWs.next((m) => m.type === 'enrollment.updated' && m.enrollment.status === 'scanned')).enrollment.id, enrollment.enrollment.id);

    // The app can use the pairing code instead of the link, in any case/format.
    const code = enrollment.pairingCode.toLowerCase().replace('-', ' ');
    const inspect = await call('POST', '/api/device/enroll/inspect', { body: { pairingCode: code } });
    assert.equal(inspect.status, 200);
    assert.equal(inspect.body.assignedUserName, 'Sam Field');
    await adminWs.next((m) => m.type === 'enrollment.updated' && m.enrollment.status === 'app_opened');

    const reviewed = await call('POST', '/api/device/enroll/permissions-reviewed', { body: {
      token: enrollment.token, permissions: [{ key: 'screen_capture', status: 'granted' }, { key: 'location', status: 'denied' }],
    } });
    assert.equal(reviewed.status, 200);
    await adminWs.next((m) => m.type === 'enrollment.updated' && m.enrollment.status === 'permissions_approved');
  });

  it('refuses to authenticate a device until required permissions are granted, then enrolls once', async () => {
    const device = { name: '', platform: 'android', manufacturer: 'Google', model: 'Pixel 8', osVersion: '14', appVersion: '1.0.0' };
    const missing = await call('POST', '/api/device/enroll/complete', { body: {
      token: enrollment.token, installationId: 'install-0001-aaaa', device,
      permissions: [{ key: 'screen_capture', status: 'denied' }],
    } });
    assert.equal(missing.status, 422);

    const ok = await call('POST', '/api/device/enroll/complete', { body: {
      token: enrollment.token, installationId: 'install-0001-aaaa', device,
      permissions: [{ key: 'screen_capture', status: 'granted' }, { key: 'location', status: 'denied' }, { key: 'notifications', status: 'granted' }],
    } });
    assert.equal(ok.status, 201);
    deviceId = ok.body.deviceId;
    deviceSecret = ok.body.deviceSecret;
    await adminWs.next((m) => m.type === 'enrollment.updated' && m.enrollment.status === 'authenticated');

    const replay = await call('POST', '/api/device/enroll/complete', { body: {
      token: enrollment.token, installationId: 'install-9999-zzzz', device, permissions: [{ key: 'screen_capture', status: 'granted' }],
    } });
    assert.equal(replay.status, 410, 'invitation is single-use');
    assert.equal(replay.body.error.code, 'enrollment_used');

    const d = (await call('GET', `/api/devices/${deviceId}`, { token: owner })).body.device;
    assert.equal(d.name, "Sam's Pixel");
    assert.equal(d.displayStatus, 'authenticated');
    assert.equal(d.online, false);
    assert.equal(d.telemetry, null, 'no telemetry is invented before the device reports');
  });

  it('device authenticates, connects, and goes live on the dashboard', async () => {
    assert.equal((await call('POST', '/api/device/token', { body: { deviceId, deviceSecret: 'x'.repeat(43) } })).status, 401);
    const t = await call('POST', '/api/device/token', { body: { deviceId, deviceSecret } });
    assert.equal(t.status, 200);
    deviceToken = t.body.accessToken;
    const { body } = await call('POST', '/api/device/ws-ticket', { token: deviceToken });
    deviceWs = await new Peer().open(body.ticket);
    const hello = await deviceWs.next((m) => m.type === 'hello');
    assert.equal(hello.organization.name, 'Acme Corp');
    const upd = await adminWs.next((m) => m.type === 'device.updated' && m.device.id === deviceId && m.device.online);
    assert.equal(upd.device.displayStatus, 'connected');
    await adminWs.next((m) => m.type === 'enrollment.updated' && m.enrollment.status === 'connected');
  });

  it('streams real telemetry and drops location the user did not grant', async () => {
    deviceWs.send({ type: 'telemetry', batteryPct: 81, charging: true, networkType: 'wifi', wifiSsid: null, ipAddress: '192.168.1.20',
      storageTotalBytes: 128e9, storageFreeBytes: 40e9, memoryTotalBytes: null, memoryAvailBytes: null,
      orientation: 'portrait', screenWidth: 1080, screenHeight: 2400,
      location: { lat: -33.86, lng: 151.2, accuracyM: 12, at: new Date().toISOString() }, reportedAt: new Date().toISOString() });
    const tm = await adminWs.next((m) => m.type === 'device.telemetry' && m.deviceId === deviceId);
    assert.equal(tm.telemetry.batteryPct, 81);
    assert.equal(tm.telemetry.memoryTotalBytes, null, 'unavailable stays unavailable');
    assert.equal(tm.telemetry.location, null, 'location permission is denied, so location is discarded');
  });

  it('records permission changes with history and flags required ones', async () => {
    deviceWs.send({ type: 'permissions', permissions: [{ key: 'notifications', status: 'revoked' }] });
    const upd = await adminWs.next((m) => m.type === 'device.updated' && m.device.permissions.some((p: any) => p.key === 'notifications' && p.status === 'revoked'));
    assert.equal(upd.device.displayStatus, 'connected', 'notifications is optional');
    const hist = await call('GET', `/api/devices/${deviceId}/permission-history`, { token: owner });
    assert.ok(hist.body.history.some((h: any) => h.key === 'notifications' && h.from === 'granted' && h.to === 'revoked'));
  });

  it('enforces RBAC: viewers cannot start screen sharing or suspend devices', async () => {
    await call('POST', '/api/users', { token: owner, body: { email: 'vic@acme.test', name: 'Vic Viewer', role: 'viewer', password: 'viewer-password-123' } });
    const v = (await call('POST', '/api/auth/login', { body: { email: 'vic@acme.test', password: 'viewer-password-123' } })).body.accessToken;
    assert.equal((await call('GET', `/api/devices/${deviceId}`, { token: v })).status, 200);
    assert.equal((await call('POST', `/api/devices/${deviceId}/screen-sessions`, { token: v, body: { purpose: 'snoop' } })).status, 403);
    assert.equal((await call('POST', `/api/devices/${deviceId}/suspend`, { token: v, body: { reason: 'x' } })).status, 403);
    assert.equal((await call('GET', '/api/audit-logs', { token: v })).status, 403);
  });

  it('runs a consented screen-sharing session with relayed signalling', async () => {
    const r = await call('POST', `/api/devices/${deviceId}/screen-sessions`, { token: owner, body: { purpose: 'Help with VPN setup' } });
    assert.equal(r.status, 201);
    const sid = r.body.session.id;
    assert.equal(r.body.session.status, 'awaiting_consent');
    assert.ok(Array.isArray(r.body.iceServers));

    const dup = await call('POST', `/api/devices/${deviceId}/screen-sessions`, { token: owner, body: { purpose: 'again' } });
    assert.equal(dup.status, 409);

    const req = await deviceWs.next((m) => m.type === 'screen.request');
    assert.equal(req.sessionId, sid);
    assert.equal(req.requestedBy.name, 'Olivia Owner');
    assert.equal(req.purpose, 'Help with VPN setup');

    // No signalling reaches the device before the user has consented.
    adminWs.send({ type: 'rtc.offer', sessionId: sid, sdp: 'v=0 premature offer' });
    await assert.rejects(deviceWs.next((m) => m.type === 'rtc.offer', 300));

    deviceWs.send({ type: 'screen.consent', sessionId: sid, decision: 'approved' });
    await adminWs.next((m) => m.type === 'screen.session.updated' && m.session.status === 'connecting');

    adminWs.send({ type: 'rtc.offer', sessionId: sid, sdp: 'v=0 offer-sdp' });
    assert.equal((await deviceWs.next((m) => m.type === 'rtc.offer')).sdp, 'v=0 offer-sdp');
    deviceWs.send({ type: 'rtc.answer', sessionId: sid, sdp: 'v=0 answer-sdp' });
    assert.equal((await adminWs.next((m) => m.type === 'rtc.answer')).sdp, 'v=0 answer-sdp');
    deviceWs.send({ type: 'rtc.ice', sessionId: sid, candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
    await adminWs.next((m) => m.type === 'rtc.ice');
    deviceWs.send({ type: 'screen.meta', sessionId: sid, orientation: 'landscape', width: 2400, height: 1080 });
    assert.equal((await adminWs.next((m) => m.type === 'screen.meta')).orientation, 'landscape');

    adminWs.send({ type: 'screen.connected', sessionId: sid });
    const active = await adminWs.next((m) => m.type === 'screen.session.updated' && m.session.status === 'active');
    assert.ok(active.session.startedAt);

    const end = await call('POST', `/api/screen-sessions/${sid}/end`, { token: owner });
    assert.equal(end.body.session.status, 'ended');
    assert.equal(end.body.session.endReason, 'admin_stopped');
    assert.equal((await deviceWs.next((m) => m.type === 'screen.cancel')).sessionId, sid);
  });

  it('honours a user rejecting the request and the user stopping mid-session', async () => {
    const r1 = await call('POST', `/api/devices/${deviceId}/screen-sessions`, { token: owner, body: { purpose: 'Check settings' } });
    await deviceWs.next((m) => m.type === 'screen.request');
    deviceWs.send({ type: 'screen.consent', sessionId: r1.body.session.id, decision: 'rejected' });
    const rej = await adminWs.next((m) => m.type === 'screen.session.updated' && m.session.id === r1.body.session.id && m.session.status === 'rejected');
    assert.equal(rej.session.endReason, 'rejected');

    const r2 = await call('POST', `/api/devices/${deviceId}/screen-sessions`, { token: owner, body: { purpose: 'Second try' } });
    await deviceWs.next((m) => m.type === 'screen.request');
    deviceWs.send({ type: 'screen.consent', sessionId: r2.body.session.id, decision: 'approved' });
    await adminWs.next((m) => m.type === 'screen.session.updated' && m.session.status === 'connecting');
    deviceWs.send({ type: 'screen.stopped', sessionId: r2.body.session.id, reason: 'user_stopped' });
    const ended = await adminWs.next((m) => m.type === 'screen.session.updated' && m.session.id === r2.body.session.id && m.session.status === 'ended');
    assert.equal(ended.session.endReason, 'user_stopped');
  });

  it('blocks screen-share requests once the user opts out', async () => {
    deviceWs.send({ type: 'permissions', permissions: [{ key: 'screen_capture', status: 'denied' }] });
    const upd = await adminWs.next((m) => m.type === 'device.updated' && m.device.displayStatus === 'permission_required');
    assert.equal(upd.device.id, deviceId);
    const r = await call('POST', `/api/devices/${deviceId}/screen-sessions`, { token: owner, body: { purpose: 'Help' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'permission_required');
    deviceWs.send({ type: 'permissions', permissions: [{ key: 'screen_capture', status: 'granted' }] });
    await adminWs.next((m) => m.type === 'device.updated' && m.device.displayStatus === 'connected');
  });

  it('isolates organisations completely', async () => {
    // A second org can only exist via the DB today (single-tenant setup flow), so create it directly.
    const [org] = await state.db.query(`INSERT INTO organizations (name, slug) VALUES ('Rival', 'rival') RETURNING id`);
    const { hashPassword } = await import('../src/lib/crypto.js');
    await state.db.query(`INSERT INTO users (org_id, email, name, password_hash, role) VALUES ($1,'eve@rival.test','Eve',$2,'owner')`,
      [org.id, await hashPassword('rival-password-123')]);
    const eve = (await call('POST', '/api/auth/login', { body: { email: 'eve@rival.test', password: 'rival-password-123' } })).body.accessToken;
    assert.equal((await call('GET', '/api/devices', { token: eve })).body.devices.length, 0);
    assert.equal((await call('GET', `/api/devices/${deviceId}`, { token: eve })).status, 404);
    assert.equal((await call('POST', `/api/devices/${deviceId}/screen-sessions`, { token: eve, body: { purpose: 'spy on rival' } })).status, 404);
    assert.equal((await call('POST', `/api/devices/${deviceId}/revoke`, { token: eve, body: { reason: 'x', confirm: "Sam's Pixel" } })).status, 404);
    assert.equal((await call('POST', `/api/enrollments/${enrollment.enrollment.id}/revoke`, { token: eve })).status, 404);
    const eveWs = await new Peer().open((await call('POST', '/api/ws-ticket', { token: eve })).body.ticket);
    await eveWs.next((m) => m.type === 'hello');
    deviceWs.send({ type: 'telemetry', batteryPct: 50, reportedAt: new Date().toISOString() });
    await adminWs.next((m) => m.type === 'device.telemetry');
    await assert.rejects(eveWs.next((m) => m.type === 'device.telemetry', 300), 'other orgs receive nothing');
    eveWs.ws.close();
  });

  it('suspends, resumes and revokes with confirmation, cutting the device off', async () => {
    const sus = await call('POST', `/api/devices/${deviceId}/suspend`, { token: owner, body: { reason: 'Lost device report' } });
    assert.equal(sus.body.device.displayStatus, 'suspended');
    await deviceWs.next((m) => m.type === 'device.suspended');
    assert.equal(await deviceWs.closedWith(), 4003);
    assert.equal((await call('POST', '/api/device/ws-ticket', { token: deviceToken })).body.error.code, 'device_suspended');

    await call('POST', `/api/devices/${deviceId}/resume`, { token: owner });
    deviceWs = await new Peer().open((await call('POST', '/api/device/ws-ticket', { token: deviceToken })).body.ticket);
    await deviceWs.next((m) => m.type === 'hello');

    const wrong = await call('POST', `/api/devices/${deviceId}/revoke`, { token: owner, body: { reason: 'Left company', confirm: 'nope' } });
    assert.equal(wrong.status, 400);
    const rev = await call('POST', `/api/devices/${deviceId}/revoke`, { token: owner, body: { reason: 'Left company', confirm: "Sam's Pixel" } });
    assert.equal(rev.body.device.displayStatus, 'revoked');
    await deviceWs.next((m) => m.type === 'device.revoked');
    assert.equal(await deviceWs.closedWith(), 4003);
    const after = await call('GET', '/api/device/me', { token: deviceToken });
    assert.equal(after.status, 401, 'token minted before revocation is dead (secret version bumped)');
    assert.equal((await call('POST', '/api/device/token', { body: { deviceId, deviceSecret } })).body.error.code, 'device_revoked');
  });

  it('writes a complete audit trail', async () => {
    const r = await call('GET', '/api/audit-logs?limit=200', { token: owner });
    const actions = new Set(r.body.logs.map((l: any) => l.action));
    for (const a of ['org.created', 'auth.login', 'auth.refresh_reuse_detected', 'enrollment.created', 'enrollment.scanned',
      'device.enrolled', 'device.connected', 'screen.requested', 'screen.consented', 'screen.started', 'screen.ended',
      'screen.rejected', 'device.permissions_changed', 'device.suspended', 'device.revoked']) {
      assert.ok(actions.has(a), `audit log missing ${a}`);
    }
    const overview = await call('GET', '/api/overview', { token: owner });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.counts.revoked, 1);
  });
});
