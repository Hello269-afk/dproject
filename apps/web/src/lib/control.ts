// Remote-control geometry (PROTOCOL.md §9): pointer positions → coordinates
// normalised 0..1 of the *streamed frame*, i.e. the video's intrinsic size.

export interface FramePoint {
  /** 0..1 across the streamed frame (clamped). */
  x: number;
  y: number;
  /** False when the pointer is over the letterbox bars, not the picture. */
  inside: boolean;
}

/** Rotation applied to an element by its own CSS transform, in radians. */
function elementRotation(el: Element): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = t.match(/^matrix\(([^)]+)\)$/);
  if (!m) return 0;
  const [a, b] = m[1].split(",").map((v) => parseFloat(v));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.atan2(b, a) : 0;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Maps a client (viewport) point onto the rendered video *content* box of a
 * `<video>` using `object-fit: contain`. Accounts for:
 * - letterboxing/pillarboxing (the picture is centred and scaled to fit),
 * - a CSS rotation/scale on the video element itself (undone around its centre),
 * - device rotation: the stream's intrinsic size changes when the phone rotates,
 *   and `videoWidth/videoHeight` are read live on every call.
 * Returns null while the video has no intrinsic size yet.
 */
export function videoFramePoint(video: HTMLVideoElement, clientX: number, clientY: number): FramePoint | null {
  const W = video.clientWidth;
  const H = video.clientHeight;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!W || !H || !vw || !vh) return null;

  const rect = video.getBoundingClientRect();
  let dx = clientX - (rect.left + rect.width / 2);
  let dy = clientY - (rect.top + rect.height / 2);

  const angle = elementRotation(video);
  if (angle) {
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
  }
  // Undo any CSS scale: compare the (un-rotated) on-screen size with the layout size.
  const quarter = Math.round(angle / (Math.PI / 2)) % 2 !== 0;
  const shownW = quarter ? rect.height : rect.width;
  const shownH = quarter ? rect.width : rect.height;
  if (shownW > 0 && shownH > 0) {
    dx *= W / shownW;
    dy *= H / shownH;
  }
  const lx = dx + W / 2;
  const ly = dy + H / 2;

  // object-fit: contain
  const scale = Math.min(W / vw, H / vh);
  const cw = vw * scale;
  const ch = vh * scale;
  const ox = (W - cw) / 2;
  const oy = (H - ch) / 2;
  const nx = (lx - ox) / cw;
  const ny = (ly - oy) / ch;
  const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
  return { x: clamp01(nx), y: clamp01(ny), inside };
}

/** Rounds to 4 decimals: plenty for any phone screen, keeps frames small. */
export function round4(v: number) {
  return Math.round(v * 10_000) / 10_000;
}

export const TAP_MAX_MS = 400;
export const LONG_PRESS_MS = 500;
/** Movement (normalised, Euclidean) below which a press counts as stationary: 2%. */
export const MOVE_THRESHOLD = 0.02;
export const SWIPE_MIN_MS = 50;
export const SWIPE_MAX_MS = 3000;
export const TEXT_MAX = 500;
