import { create } from "zustand";
import { api } from "../lib/api";
import type { Device, DeviceCommand, Enrollment, ScreenSession, Telemetry } from "../lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

interface FleetState {
  devices: Record<string, Device>;
  devicesState: LoadState;
  devicesError: string | null;

  sessions: Record<string, ScreenSession>;
  sessionsState: LoadState;

  enrollments: Record<string, Enrollment>;
  enrollmentsState: LoadState;
  enrollmentsError: string | null;

  /** Remote commands (§10), loaded per device and kept live by command.updated. */
  commands: Record<string, DeviceCommand>;

  loadDevices: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadEnrollments: () => Promise<void>;

  upsertDevice: (d: Device) => void;
  applyTelemetry: (deviceId: string, telemetry: Telemetry, lastSeenAt: string) => void;
  upsertSession: (s: ScreenSession) => void;
  upsertEnrollment: (e: Enrollment) => void;
  upsertCommands: (list: DeviceCommand[]) => void;
  reset: () => void;
}

const initial = {
  devices: {},
  devicesState: "idle" as LoadState,
  devicesError: null,
  sessions: {},
  sessionsState: "idle" as LoadState,
  enrollments: {},
  enrollmentsState: "idle" as LoadState,
  enrollmentsError: null,
  commands: {},
};

/**
 * Live fleet store. Seeded from REST, then kept current by WebSocket events
 * (see RealtimeProvider). Re-seeded after every WS reconnect to cover gaps.
 */
export const useFleet = create<FleetState>((set, get) => ({
  ...initial,

  loadDevices: async () => {
    if (get().devicesState !== "ready") set({ devicesState: "loading" });
    try {
      const { devices } = await api.get<{ devices: Device[] }>("/api/devices");
      set({ devices: Object.fromEntries(devices.map((d) => [d.id, d])), devicesState: "ready", devicesError: null });
    } catch (err) {
      set({ devicesState: get().devicesState === "ready" ? "ready" : "error", devicesError: (err as Error).message });
    }
  },

  loadSessions: async () => {
    if (get().sessionsState !== "ready") set({ sessionsState: "loading" });
    try {
      const { sessions } = await api.get<{ sessions: ScreenSession[] }>("/api/screen-sessions");
      set((s) => ({
        sessions: { ...s.sessions, ...Object.fromEntries(sessions.map((x) => [x.id, x])) },
        sessionsState: "ready",
      }));
    } catch {
      set({ sessionsState: get().sessionsState === "ready" ? "ready" : "error" });
    }
  },

  loadEnrollments: async () => {
    if (get().enrollmentsState !== "ready") set({ enrollmentsState: "loading" });
    try {
      const { enrollments } = await api.get<{ enrollments: Enrollment[] }>("/api/enrollments");
      set({
        enrollments: Object.fromEntries(enrollments.map((e) => [e.id, e])),
        enrollmentsState: "ready",
        enrollmentsError: null,
      });
    } catch (err) {
      set({ enrollmentsState: get().enrollmentsState === "ready" ? "ready" : "error", enrollmentsError: (err as Error).message });
    }
  },

  upsertDevice: (d) => set((s) => ({ devices: { ...s.devices, [d.id]: d } })),

  applyTelemetry: (deviceId, telemetry, lastSeenAt) =>
    set((s) => {
      const d = s.devices[deviceId];
      if (!d) return s;
      return { devices: { ...s.devices, [deviceId]: { ...d, telemetry, lastSeenAt } } };
    }),

  upsertSession: (session) =>
    set((s) => {
      const devices = s.devices;
      const d = devices[session.deviceId];
      // Keep the device's activeScreenSessionId consistent until the next device.updated arrives.
      let nextDevices = devices;
      if (d) {
        const terminal = ["ended", "rejected", "expired", "failed"].includes(session.status);
        const active = terminal ? (d.activeScreenSessionId === session.id ? null : d.activeScreenSessionId) : session.id;
        if (active !== d.activeScreenSessionId) nextDevices = { ...devices, [d.id]: { ...d, activeScreenSessionId: active } };
      }
      return { sessions: { ...s.sessions, [session.id]: session }, devices: nextDevices };
    }),

  upsertEnrollment: (e) => set((s) => ({ enrollments: { ...s.enrollments, [e.id]: e } })),

  upsertCommands: (list) =>
    set((s) => {
      if (list.length === 0) return s;
      const next = { ...s.commands };
      for (const c of list) next[c.id] = c;
      return { commands: next };
    }),

  reset: () => set({ ...initial }),
}));

/** ICE servers per session id (returned once by POST /screen-sessions). Not reactive. */
export const iceServerCache = new Map<string, RTCIceServer[]>();
