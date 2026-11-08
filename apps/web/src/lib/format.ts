export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "Unavailable";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`;
}

function toMs(d: string | number | Date): number {
  return typeof d === "number" ? d : new Date(d).getTime();
}

/** "just now", "2 min ago", "3 h ago", "Yesterday", "4 d ago", then a date. */
export function relativeTime(date: string | number | Date | null | undefined, now = Date.now()): string {
  if (date === null || date === undefined) return "Never";
  const t = toMs(date);
  if (!Number.isFinite(t)) return "Unknown";
  const diff = Math.round((now - t) / 1000);
  const future = diff < 0;
  const s = Math.abs(diff);
  const wrap = (v: string) => (future ? `in ${v}` : `${v} ago`);
  if (s < 10) return future ? "in a moment" : "just now";
  if (s < 60) return wrap(`${s} s`);
  const m = Math.floor(s / 60);
  if (m < 60) return wrap(`${m} min`);
  const h = Math.floor(m / 60);
  if (h < 24) return wrap(`${h} h`);
  const d = Math.floor(h / 24);
  if (d === 1 && !future) return "Yesterday";
  if (d < 30) return wrap(`${d} d`);
  return formatDate(t);
}

export function formatDate(date: string | number | Date | null | undefined): string {
  if (date === null || date === undefined) return "—";
  const d = new Date(toMs(date as string));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(date: string | number | Date | null | undefined): string {
  if (date === null || date === undefined) return "—";
  const d = new Date(toMs(date as string));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(date: string | number | Date | null | undefined): string {
  if (date === null || date === undefined) return "—";
  const d = new Date(toMs(date as string));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Compact duration: "45s", "12m 04s", "1h 03m". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Clock-style timer: "04:12" or "1:04:12". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Countdown text for an expiry; "Expired" when past. */
export function formatCountdown(expiresAt: string | null | undefined, now = Date.now()): string {
  if (!expiresAt) return "—";
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "Expired";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "Unavailable";
  return `${Math.round(n)}%`;
}

/** "ABCD1234" → "ABCD-1234" (already-dashed codes pass through). */
export function formatPairingCode(code: string): string {
  const clean = code.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return code.toUpperCase();
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "device.revoked" / "screen_session_started" → "Device revoked" style label. */
export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  const t = s.replace(/[._]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function shortDay(date: string): string {
  const d = new Date(date.length === 10 ? `${date}T00:00:00` : date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
