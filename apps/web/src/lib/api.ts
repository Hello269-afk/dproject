import type { AuthResponse } from "./types";

/** Error thrown for any non-2xx response (or network failure, status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

// ---- token handling (memory only) ---------------------------------------

let accessToken: string | null = null;
let refreshInFlight: Promise<AuthResponse> | null = null;
let onSessionRefreshed: ((res: AuthResponse) => void) | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

/** The auth provider registers these so refreshes/expiry propagate to React state. */
export function registerAuthHandlers(handlers: {
  onRefreshed: (res: AuthResponse) => void;
  onLost: () => void;
}) {
  onSessionRefreshed = handlers.onRefreshed;
  onSessionLost = handlers.onLost;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || `Request failed (${res.status})`;
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } };
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
    }
  } catch {
    /* non-JSON body */
  }
  return new ApiError(res.status, code, message);
}

/**
 * POST /api/auth/refresh. Single in-flight: concurrent callers share one request,
 * because the refresh token rotates and reuse revokes the whole family.
 */
export function refreshSession(): Promise<AuthResponse> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      let res: Response;
      try {
        res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
      } catch {
        throw new ApiError(0, "network_error", "Cannot reach the API server");
      }
      if (!res.ok) throw await parseError(res);
      const data = (await res.json()) as AuthResponse;
      accessToken = data.accessToken;
      onSessionRefreshed?.(data);
      return data;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | null | undefined>;
  signal?: AbortSignal;
  /** Public endpoints: do not attach the bearer token or try refreshing. */
  anonymous?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: Method, path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (!opts.anonymous && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Cannot reach the API server");
  }

  if (res.status === 401 && !opts.anonymous) {
    const err = await parseError(res);
    if (err.code === "token_expired" && !retried) {
      try {
        await refreshSession();
      } catch {
        onSessionLost?.();
        throw err;
      }
      return request<T>(method, path, opts, true);
    }
    // Step-up re-authentication failures (wrong password on a wipe) are a
    // normal form error, not a lost session: don't sign the admin out.
    if (err.code !== "reauth_failed") onSessionLost?.();
    throw err;
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PATCH", path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PUT", path, { ...opts, body }),
};
