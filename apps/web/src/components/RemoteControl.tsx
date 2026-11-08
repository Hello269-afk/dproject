import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { ArrowLeft, Bell, Circle, MousePointerClick, Send, SlidersHorizontal, Square } from "lucide-react";
import { Button, Input, Tooltip } from "./ui";
import { cn } from "../lib/cn";
import {
  LONG_PRESS_MS,
  MOVE_THRESHOLD,
  round4,
  SWIPE_MAX_MS,
  SWIPE_MIN_MS,
  TEXT_MAX,
  videoFramePoint,
  type FramePoint,
} from "../lib/control";
import type { ControlInput, GlobalAction } from "../lib/types";

interface Gesture {
  pointerId: number;
  start: FramePoint;
  last: FramePoint;
  t0: number;
  moved: boolean;
  longPressed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Mark {
  id: number;
  left: number;
  top: number;
  kind: "tap" | "long" | "swipe";
}

/**
 * Transparent input surface laid exactly over the `<video>`. Turns pointer
 * gestures into §9 ControlInput frames:
 * - stationary (< 2% movement) and released < 400 ms → tap
 * - stationary and held ≥ 500 ms → long_press (fires while still held)
 * - moved ≥ 2% → swipe with the real gesture duration (clamped 50..3000 ms)
 * A stationary release between 400 and 500 ms is still sent as a tap.
 * Presses that start on the letterbox bars are ignored.
 */
export function RemoteControlLayer({
  videoRef,
  onInput,
  label,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  onInput: (input: ControlInput) => boolean;
  label: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const markId = useRef(0);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  useEffect(
    () => () => {
      if (gesture.current?.timer) clearTimeout(gesture.current.timer);
      gesture.current = null;
    },
    [],
  );

  const addMark = (clientX: number, clientY: number, kind: Mark["kind"]) => {
    const r = layerRef.current?.getBoundingClientRect();
    if (!r) return;
    const id = ++markId.current;
    setMarks((m) => [...m.slice(-6), { id, left: clientX - r.left, top: clientY - r.top, kind }]);
    setTimeout(() => setMarks((m) => m.filter((x) => x.id !== id)), 650);
  };

  const point = (e: { clientX: number; clientY: number }) => {
    const v = videoRef.current;
    return v ? videoFramePoint(v, e.clientX, e.clientY) : null;
  };

  const reset = () => {
    if (gesture.current?.timer) clearTimeout(gesture.current.timer);
    gesture.current = null;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || gesture.current) return;
    const p = point(e);
    if (!p || !p.inside) return;
    e.preventDefault();
    layerRef.current?.focus({ preventScroll: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    const { clientX, clientY } = e;
    const g: Gesture = { pointerId: e.pointerId, start: p, last: p, t0: performance.now(), moved: false, longPressed: false, timer: null };
    g.timer = setTimeout(() => {
      if (gesture.current !== g || g.moved) return;
      g.timer = null;
      g.longPressed = true;
      if (onInputRef.current({ kind: "long_press", x: round4(g.start.x), y: round4(g.start.y) })) addMark(clientX, clientY, "long");
    }, LONG_PRESS_MS);
    gesture.current = g;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const p = point(e);
    if (!p) return;
    g.last = p;
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) >= MOVE_THRESHOLD) {
      g.moved = true;
      if (g.timer) clearTimeout(g.timer);
      g.timer = null;
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const p = point(e) ?? g.last;
    const elapsed = performance.now() - g.t0;
    reset();
    if (g.longPressed) return;
    const moved = g.moved || Math.hypot(p.x - g.start.x, p.y - g.start.y) >= MOVE_THRESHOLD;
    if (!moved) {
      // < 400 ms (TAP_MAX_MS) is the spec'd tap; a 400..500 ms release (before long-press fired) is treated as a tap too.
      if (onInputRef.current({ kind: "tap", x: round4(g.start.x), y: round4(g.start.y) })) addMark(e.clientX, e.clientY, "tap");
      return;
    }
    const durationMs = Math.round(Math.min(SWIPE_MAX_MS, Math.max(SWIPE_MIN_MS, elapsed)));
    if (
      onInputRef.current({
        kind: "swipe",
        x1: round4(g.start.x),
        y1: round4(g.start.y),
        x2: round4(p.x),
        y2: round4(p.y),
        durationMs,
      })
    )
      addMark(e.clientX, e.clientY, "swipe");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      reset();
      layerRef.current?.blur();
    }
  };

  return (
    <div
      ref={layerRef}
      role="application"
      aria-label={label}
      aria-roledescription="Remote screen"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      onLostPointerCapture={(e) => {
        if (gesture.current?.pointerId === e.pointerId && !gesture.current.longPressed) reset();
      }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="absolute inset-0 z-10 cursor-pointer select-none outline-none [touch-action:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      {marks.map((m) => (
        <span
          key={m.id}
          aria-hidden
          className={cn(
            "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 bg-white/30 animate-ping",
            m.kind === "long" ? "size-10" : "size-7",
          )}
          style={{ left: m.left, top: m.top, animationIterationCount: 1, animationDuration: "650ms" }}
        />
      ))}
    </div>
  );
}

const GLOBAL_BUTTONS: { action: GlobalAction; label: string; icon: typeof ArrowLeft }[] = [
  { action: "back", label: "Back", icon: ArrowLeft },
  { action: "home", label: "Home", icon: Circle },
  { action: "recents", label: "Recent apps", icon: Square },
  { action: "notifications", label: "Notifications", icon: Bell },
  { action: "quick_settings", label: "Quick settings", icon: SlidersHorizontal },
];

/** Navigation buttons and a text sender under the phone frame. */
export function RemoteControlBar({
  enabled,
  disabledReason,
  onInput,
}: {
  enabled: boolean;
  disabledReason: string | null;
  onInput: (input: ControlInput) => boolean;
}) {
  const [text, setText] = useState("");

  const sendText = () => {
    const t = text;
    if (!enabled || !t.trim()) return;
    if (onInput({ kind: "text", text: t.slice(0, TEXT_MAX) })) setText("");
  };

  return (
    <div
      className={cn(
        "mx-auto mt-5 w-full max-w-[440px] rounded-xl border bg-surface/95 p-2.5 shadow-xs backdrop-blur",
        enabled ? "border-accent/40" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        {GLOBAL_BUTTONS.map(({ action, label, icon: Icon }) => (
          <Tooltip key={action} content={enabled ? label : disabledReason ?? label} focusable={!enabled}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              disabled={!enabled}
              onClick={() => onInput({ kind: "global", action })}
            >
              <Icon />
            </Button>
          </Tooltip>
        ))}
      </div>
      <form
        className="mt-2 flex items-center gap-2 border-t border-border pt-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          sendText();
        }}
      >
        <Input
          aria-label="Text to type on the device"
          placeholder={enabled ? "Type into the focused field on the device…" : "Text input unavailable"}
          value={text}
          maxLength={TEXT_MAX}
          disabled={!enabled}
          onChange={(e) => setText(e.target.value)}
          className="h-8 text-[13px]"
        />
        <Button type="submit" size="sm" variant="primary" icon={<Send />} disabled={!enabled || !text.trim()}>
          Send
        </Button>
      </form>
      {!enabled && disabledReason && (
        <p className="mt-2 flex items-center gap-1.5 px-0.5 text-[12px] text-muted">
          <MousePointerClick className="size-3.5 shrink-0" />
          {disabledReason}
        </p>
      )}
    </div>
  );
}
