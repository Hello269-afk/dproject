import { hub } from '../realtime/hub.js';
import { db } from '../state.js';
import { loadDevice, loadEnrollment, loadSession } from './serialize.js';

// Re-read from the database and push the fresh object, so dashboards never drift from storage.

export async function emitDevice(orgId: string, deviceId: string) {
  const device = await loadDevice(db(), orgId, deviceId);
  if (device) hub.toOrgAdmins(orgId, { type: 'device.updated', device });
  return device;
}

export async function emitEnrollment(enrollmentId: string) {
  const enrollment = await loadEnrollment(db(), enrollmentId);
  if (enrollment) hub.toOrgAdmins(enrollment.orgId, { type: 'enrollment.updated', enrollment });
  return enrollment;
}

export async function emitSession(sessionId: string) {
  const session = await loadSession(db(), sessionId);
  if (session) hub.toOrgAdmins(session.orgId, { type: 'screen.session.updated', session });
  return session;
}
