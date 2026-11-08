import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Activity,
  AppWindow,
  Building2,
  ChevronsUpDown,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  MonitorSmartphone,
  Moon,
  MousePointerClick,
  QrCode,
  ScreenShare,
  Settings,
  ShieldCheck,
  ShieldHalf,
  Smartphone,
  Sun,
  TabletSmartphone,
  Users,
  X,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useAuth, useCurrentUser } from "../state/auth";
import { useTheme } from "../state/theme";
import { useFleet } from "../state/store";
import { hasRole, isSessionTerminal, ROLE_META } from "../lib/labels";
import type { Role } from "../lib/types";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { Avatar } from "./Common";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  minRole?: Role;
  phase2?: boolean;
  badge?: "sessions" | "enrollments";
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Fleet",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/devices", label: "Devices", icon: Smartphone },
      { to: "/monitoring", label: "Live Monitoring", icon: Activity },
      { to: "/assist", label: "Remote Assistance", icon: LifeBuoy },
      { to: "/sessions", label: "Screen Sessions", icon: ScreenShare, badge: "sessions" },
    ],
  },
  {
    section: "Manage",
    items: [
      { to: "/enrollment", label: "Enrollment", icon: QrCode, badge: "enrollments" },
      { to: "/users", label: "Users", icon: Users, minRole: "admin" },
      { to: "/organization", label: "Organization", icon: Building2 },
      { to: "/permissions", label: "Permissions", icon: KeyRound },
      { to: "/policies", label: "Device Policies", icon: ShieldHalf },
      { to: "/applications", label: "Applications", icon: AppWindow, phase2: true },
      { to: "/remote-control", label: "Remote Control", icon: MousePointerClick },
      { to: "/ios", label: "iOS Devices", icon: TabletSmartphone, phase2: true },
    ],
  },
  {
    section: "System",
    items: [
      { to: "/audit", label: "Security & Audit", icon: ShieldCheck, minRole: "admin" },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function useNavBadges() {
  const sessions = useFleet((s) => s.sessions);
  const enrollments = useFleet((s) => s.enrollments);
  return useMemo(() => {
    const liveSessions = Object.values(sessions).filter((s) => !isSessionTerminal(s.status)).length;
    const inProgress = Object.values(enrollments).filter(
      (e) => !["connected", "expired", "revoked"].includes(e.status) && new Date(e.expiresAt).getTime() > Date.now(),
    ).length;
    return { sessions: liveSessions, enrollments: inProgress };
  }, [sessions, enrollments]);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const user = useCurrentUser();
  const { organization } = useAuth();
  const badges = useNavBadges();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="grid size-8 place-items-center rounded-lg bg-accent text-accent-fg shadow-xs">
          <MonitorSmartphone className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-fg">{organization?.name ?? "MDM"}</div>
          <div className="text-[11.5px] text-muted">Device management</div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2" aria-label="Main">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.minRole || hasRole(user.role, i.minRole));
          if (items.length === 0) return null;
          return (
            <div key={group.section}>
              <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">{group.section}</div>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const count = item.badge ? badges[item.badge] : 0;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                            isActive ? "bg-surface text-fg shadow-xs ring-1 ring-border" : "text-fg-2 hover:bg-surface-3/60 hover:text-fg",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon className={cn("size-4 shrink-0", isActive ? "text-accent" : "text-muted group-hover:text-fg-2")} />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.phase2 && (
                              <span className="rounded-md border border-border px-1.5 py-px text-[10px] font-semibold text-muted">Phase 2</span>
                            )}
                            {count > 0 && (
                              <span
                                className={cn(
                                  "tnum min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold",
                                  item.badge === "sessions" ? "bg-session-soft text-session-fg" : "bg-accent-soft text-accent-soft-fg",
                                )}
                              >
                                {count}
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <UserMenu />
    </div>
  );
}

function UserMenu() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative border-t border-border p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-surface-3/60"
      >
        <Avatar name={user.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-fg">{user.name}</div>
          <div className="truncate text-[11.5px] text-muted">{ROLE_META[user.role].label}</div>
        </div>
        <ChevronsUpDown className="size-4 text-subtle" />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-[calc(100%-4px)] left-3 right-3 z-30 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-pop animate-pop-in">
          <div className="border-b border-border px-3 py-2.5">
            <div className="truncate text-[13px] font-medium text-fg">{user.name}</div>
            <div className="truncate text-[12px] text-muted">{user.email}</div>
          </div>
          <button
            role="menuitem"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-fg-2 hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              navigate("/settings");
            }}
          >
            <Settings className="size-4" /> Settings
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-danger-fg hover:bg-danger-soft"
            onClick={() => void logout()}
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { resolved, setPreference } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
    >
      {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="hidden w-[248px] shrink-0 border-r border-border bg-surface-2/60 lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-overlay animate-fade-in" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] border-r border-border bg-surface-2 shadow-pop animate-pop-in" aria-label="Navigation">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3"
            >
              <X className="size-4" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/80 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="-ml-1.5 grid size-9 place-items-center rounded-lg text-fg-2 hover:bg-surface-2 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <ConnectionIndicator />
          <ThemeToggle />
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
