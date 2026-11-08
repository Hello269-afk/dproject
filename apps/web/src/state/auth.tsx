import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, refreshSession, registerAuthHandlers, setAccessToken } from "../lib/api";
import type { AuthResponse, Organization, Role, User } from "../lib/types";
import { hasRole } from "../lib/labels";

export type AuthStatus = "booting" | "unreachable" | "needsSetup" | "anonymous" | "authenticated";

interface AuthCtx {
  status: AuthStatus;
  user: User | null;
  organization: Organization | null;
  bootError: string | null;
  login: (email: string, password: string) => Promise<void>;
  setup: (body: { orgName: string; name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  retryBoot: () => void;
  setOrganization: (org: Organization) => void;
  can: (min: Role) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootNonce, setBootNonce] = useState(0);

  const applySession = useCallback((res: AuthResponse) => {
    setAccessToken(res.accessToken);
    setUser(res.user);
    setOrganization(res.organization);
    setStatus("authenticated");
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus((s) => (s === "needsSetup" ? s : "anonymous"));
  }, []);

  useEffect(() => {
    registerAuthHandlers({
      onRefreshed: (res) => {
        setUser(res.user);
        setOrganization(res.organization);
      },
      onLost: clearSession,
    });
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("booting");
      setBootError(null);
      try {
        const { needsSetup } = await api.get<{ needsSetup: boolean }>("/api/auth/setup-status", { anonymous: true });
        if (cancelled) return;
        if (needsSetup) {
          setStatus("needsSetup");
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setBootError(err instanceof ApiError ? err.message : "Cannot reach the API server");
        setStatus("unreachable");
        return;
      }
      try {
        const res = await refreshSession();
        if (!cancelled) applySession(res);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 0) {
          setBootError(err.message);
          setStatus("unreachable");
        } else {
          setStatus("anonymous");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootNonce, applySession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<AuthResponse>("/api/auth/login", { email, password }, { anonymous: true });
      if (res.user.role === "member") {
        await api.post("/api/auth/logout", undefined, { anonymous: true }).catch(() => undefined);
        throw new ApiError(403, "member_cannot_sign_in", "Device users (members) cannot sign in to the dashboard.");
      }
      applySession(res);
    },
    [applySession],
  );

  const setup = useCallback(
    async (body: { orgName: string; name: string; email: string; password: string }) => {
      const res = await api.post<AuthResponse>("/api/auth/setup", body, { anonymous: true });
      applySession(res);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout", undefined, { anonymous: true });
    } catch {
      /* clear locally regardless */
    }
    setAccessToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      user,
      organization,
      bootError,
      login,
      setup,
      logout,
      retryBoot: () => setBootNonce((n) => n + 1),
      setOrganization,
      can: (min: Role) => hasRole(user?.role, min),
    }),
    [status, user, organization, bootError, login, setup, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** Use inside authenticated routes only. */
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("No authenticated user");
  return user;
}
