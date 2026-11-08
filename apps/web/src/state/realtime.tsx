import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { realtime } from "../lib/ws";
import type { ServerEventMap, ServerEventType } from "../lib/types";
import { useAuth } from "./auth";
import { useFleet } from "./store";
import { hasRole } from "../lib/labels";

/**
 * Starts the WebSocket while signed in, seeds the fleet store and routes
 * broadcast events into it. Mount once inside the authenticated shell.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const role = user?.role;
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    const fleet = useFleet.getState();
    const canEnroll = hasRole(role, "operator");
    const seed = () => {
      void fleet.loadDevices();
      void fleet.loadSessions();
      if (canEnroll) void fleet.loadEnrollments();
    };
    seed();

    const offs = [
      realtime.on("device.updated", ({ device }) => useFleet.getState().upsertDevice(device)),
      realtime.on("device.telemetry", ({ deviceId, telemetry, lastSeenAt }) =>
        useFleet.getState().applyTelemetry(deviceId, telemetry, lastSeenAt),
      ),
      realtime.on("screen.session.updated", ({ session }) => useFleet.getState().upsertSession(session)),
      realtime.on("enrollment.updated", ({ enrollment }) => useFleet.getState().upsertEnrollment(enrollment)),
      realtime.on("command.updated", ({ command }) => useFleet.getState().upsertCommands([command])),
      realtime.onOpen((isReconnect) => {
        if (isReconnect) seed();
      }),
    ];
    realtime.start();
    return () => {
      offs.forEach((off) => off());
      realtime.stop();
      useFleet.getState().reset();
    };
  }, [userId, role]);

  return <>{children}</>;
}

/** Subscribe to a server event for the lifetime of the component. */
export function useRealtimeEvent<K extends ServerEventType>(type: K, handler: (payload: ServerEventMap[K]) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return realtime.on(type, (p) => ref.current(p));
  }, [type, enabled]);
}

export function useWsDiagnostics() {
  return useSyncExternalStore(realtime.subscribeDiagnostics, realtime.getDiagnostics);
}
