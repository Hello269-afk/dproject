import { useEffect, useRef, useState } from "react";
import { ScreenReceiver, type ReceiverPhase, type ScreenMeta, type StreamStats } from "../lib/rtc";

export interface ScreenStreamState {
  stream: MediaStream | null;
  phase: ReceiverPhase | "idle";
  meta: ScreenMeta | null;
  stats: StreamStats | null;
  error: string | null;
  attempts: number;
  reconnect: () => void;
}

/**
 * Runs a ScreenReceiver while `enabled` (session is connecting/active and the
 * current admin is the requester). Tears everything down when disabled.
 */
export function useScreenStream(sessionId: string | null, enabled: boolean): ScreenStreamState {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<ReceiverPhase | "idle">("idle");
  const [meta, setMeta] = useState<ScreenMeta | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const receiverRef = useRef<ScreenReceiver | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    setError(null);
    setMeta(null);
    setAttempts(0);
    const r = new ScreenReceiver(sessionId, {
      onStream: setStream,
      onPhase: setPhase,
      onMeta: setMeta,
      onStats: setStats,
      onError: setError,
      onAttempt: setAttempts,
    });
    receiverRef.current = r;
    r.start();
    return () => {
      r.stop();
      receiverRef.current = null;
      setStream(null);
      setStats(null);
      setPhase("idle");
    };
  }, [sessionId, enabled]);

  return {
    stream,
    phase,
    meta,
    stats,
    error,
    attempts,
    reconnect: () => receiverRef.current?.renegotiate(),
  };
}
