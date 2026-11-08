import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  Activity,
  ArrowLeft,
  Ban,
  KeyRound,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  ScreenShare,
  SearchX,
  Smartphone,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button, ConfirmDialog, EmptyState, Skeleton, Tabs, TabPanel, Tooltip } from "../../components/ui";
import { DeviceStatusBadge } from "../../components/StatusBadges";
import { PlatformLabel } from "../../components/Common";
import { ScreenSessionConsole } from "../../components/ScreenSessionConsole";
import { StartSessionDialog } from "../../components/StartSessionDialog";
import { MessagesPanel } from "../../components/MessagesPanel";
import { api, ApiError, errorMessage } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { deviceSubtitle, screenShareBlockReason } from "../../lib/devices";
import { isCommandOpen, isSessionTerminal } from "../../lib/labels";
import type { Device } from "../../lib/types";
import { useFleet } from "../../state/store";
import { useAuth, useCurrentUser } from "../../state/auth";
import { useNow } from "../../hooks/useNow";
import { RenameDialog, AssignUserDialog } from "./DeviceDialogs";
import { OverviewTab } from "./OverviewTab";
import { PermissionsTab } from "./PermissionsTab";
import { ActivityTab } from "./ActivityTab";
import { DeviceSessionHistory } from "./DeviceSessionHistory";
import { CommandsTab } from "./CommandsTab";
import { SecurityActionsMenu } from "./SecurityActions";

type TabId = "overview" | "permissions" | "screen" | "commands" | "messages" | "activity";

export function DeviceDetailPage() {
  const { id = "" } = useParams();
  const device = useFleet((s) => s.devices[id]);
  const upsert = useFleet((s) => s.upsertDevice);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setLoadError(null);
    api
      .get<{ device: Device }>(`/api/devices/${id}`)
      .then(({ device: d }) => !cancelled && upsert(d))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id, upsert]);

  if (!device) {
    if (notFound || loadError) {
      return (
        <EmptyState
          icon={<SearchX />}
          title={notFound ? "Device not found" : "Couldn't load this device"}
          description={notFound ? "It may have been removed, or the link is wrong." : loadError}
          action={
            <Link to="/devices">
              <Button>Back to devices</Button>
            </Link>
          }
        />
      );
    }
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  return <DeviceDetail device={device} />;
}

function DeviceDetail({ device }: { device: Device }) {
  const user = useCurrentUser();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabId) || "overview";
  const setTab = (t: TabId) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };
  const now = useNow(15_000);
  const upsert = useFleet((s) => s.upsertDevice);
  const session = useFleet((s) => (device.activeScreenSessionId ? s.sessions[device.activeScreenSessionId] : undefined));
  const openCommands = useFleet((s) => Object.values(s.commands).filter((c) => c.deviceId === device.id && isCommandOpen(c.status)).length);

  const [dialog, setDialog] = useState<null | "rename" | "assign" | "suspend" | "resume" | "revoke" | "share">(null);
  const [checkingIn, setCheckingIn] = useState(false);

  const isOperator = can("operator");
  const isAdmin = can("admin");
  const revoked = device.lifecycleStatus === "revoked";
  const suspended = device.lifecycleStatus === "suspended";
  const blockReason = screenShareBlockReason(device, user.role);
  const liveSession = session && !isSessionTerminal(session.status);

  const checkin = async () => {
    setCheckingIn(true);
    try {
      await api.post(`/api/devices/${device.id}/checkin`);
      toast.success("Check-in requested", { description: "Fresh telemetry and permissions will arrive shortly." });
    } catch (err) {
      toast.error("Check-in failed", {
        description: err instanceof ApiError && err.code === "device_offline" ? "The device is offline." : errorMessage(err),
      });
    } finally {
      setCheckingIn(false);
    }
  };

  const lifecycle = async (action: "suspend" | "resume" | "revoke", reason: string) => {
    const body = action === "suspend" ? { reason } : action === "revoke" ? { reason, confirm: device.name } : undefined;
    try {
      const { device: d } = await api.post<{ device: Device }>(`/api/devices/${device.id}/${action}`, body);
      upsert(d);
      toast.success(action === "suspend" ? "Device suspended" : action === "resume" ? "Device resumed" : "Device revoked");
    } catch (err) {
      toast.error(`Could not ${action} the device`, { description: errorMessage(err) });
      throw err;
    }
  };

  const checkinReason = !device.online ? "The device is offline." : revoked ? "The device is revoked." : suspended ? "The device is suspended." : null;

  return (
    <>
      <Link to="/devices" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Devices
      </Link>

      <div className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="relative grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-surface text-muted shadow-xs">
            <Smartphone className="size-6" />
            {device.online && <span className="absolute -right-1 -top-1 size-3.5 rounded-full border-[3px] border-bg bg-success" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-semibold tracking-[-0.01em] text-fg">{device.name}</h1>
              <DeviceStatusBadge status={device.displayStatus} />
              {liveSession && (
                <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-session-soft px-2 text-[12px] font-medium text-session-fg">
                  <ScreenShare className="size-3" /> Screen session
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              <span>{deviceSubtitle(device)}</span>
              <span aria-hidden>·</span>
              <PlatformLabel platform={device.platform} className="text-muted" />
              <span>{device.osVersion}</span>
              <span aria-hidden>·</span>
              <span>{device.online ? "Online now" : `Last seen ${relativeTime(device.lastSeenAt, now)}`}</span>
              {device.assignedUser && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="size-3.5" />
                    {device.assignedUser.name}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {isOperator && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<Pencil />} onClick={() => setDialog("rename")} disabled={revoked}>
              Rename
            </Button>
            <Button size="sm" icon={<UserRound />} onClick={() => setDialog("assign")} disabled={revoked}>
              Assign user
            </Button>
            <Tooltip content={checkinReason} focusable={!!checkinReason}>
              <Button size="sm" icon={<RefreshCw />} onClick={checkin} loading={checkingIn} disabled={!!checkinReason}>
                Request check-in
              </Button>
            </Tooltip>
            {!revoked && <SecurityActionsMenu device={device} />}
            {isAdmin && !revoked && (
              suspended ? (
                <Button size="sm" icon={<Play />} onClick={() => setDialog("resume")}>
                  Resume
                </Button>
              ) : (
                <Button size="sm" variant="danger-soft" icon={<Pause />} onClick={() => setDialog("suspend")}>
                  Suspend
                </Button>
              )
            )}
            {isAdmin && !revoked && (
              <Button size="sm" variant="danger-soft" icon={<Ban />} onClick={() => setDialog("revoke")}>
                Revoke
              </Button>
            )}
            {!liveSession && (
              <Tooltip content={blockReason} focusable={!!blockReason}>
                <Button size="sm" variant="primary" icon={<ScreenShare />} disabled={!!blockReason} onClick={() => setDialog("share")}>
                  Start screen sharing
                </Button>
              </Tooltip>
            )}
            {liveSession && (
              <Button size="sm" variant="primary" icon={<ScreenShare />} onClick={() => setTab("screen")}>
                Open live session
              </Button>
            )}
          </div>
        )}
      </div>

      <Tabs<TabId>
        ariaLabel="Device sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: "overview", label: "Overview", icon: <LayoutGrid /> },
          {
            id: "permissions",
            label: "Permissions",
            icon: <KeyRound />,
            count: device.permissions.filter((p) => p.required && p.status !== "granted").length || null,
          },
          { id: "screen", label: "Screen sharing", icon: <ScreenShare /> },
          { id: "commands", label: "Commands", icon: <ListChecks />, count: openCommands || null },
          { id: "messages", label: "Messages", icon: <MessageSquare />, hidden: !isOperator },
          { id: "activity", label: "Activity", icon: <Activity /> },
        ]}
      />

      <div className="pt-6">
        {tab === "overview" && (
          <TabPanel id="overview">
            <OverviewTab device={device} />
          </TabPanel>
        )}
        {tab === "permissions" && (
          <TabPanel id="permissions">
            <PermissionsTab device={device} />
          </TabPanel>
        )}
        {tab === "screen" && (
          <TabPanel id="screen" className="space-y-6">
            <ScreenSessionConsole device={device} />
            <DeviceSessionHistory deviceId={device.id} />
          </TabPanel>
        )}
        {tab === "commands" && (
          <TabPanel id="commands">
            <CommandsTab device={device} />
          </TabPanel>
        )}
        {tab === "messages" && isOperator && (
          <TabPanel id="messages">
            <MessagesPanel device={device} className="h-[600px]" />
          </TabPanel>
        )}
        {tab === "activity" && (
          <TabPanel id="activity">
            <ActivityTab device={device} />
          </TabPanel>
        )}
      </div>

      <RenameDialog device={device} open={dialog === "rename"} onClose={() => setDialog(null)} />
      <AssignUserDialog device={device} open={dialog === "assign"} onClose={() => setDialog(null)} />
      <StartSessionDialog device={device} open={dialog === "share"} onClose={() => setDialog(null)} onStarted={() => setTab("screen")} />
      <ConfirmDialog
        open={dialog === "suspend"}
        onClose={() => setDialog(null)}
        title={`Suspend ${device.name}?`}
        description="The device is disconnected immediately and blocked until resumed. Any screen session ends."
        confirmLabel="Suspend device"
        reason={{ label: "Reason", placeholder: "Recorded in the audit log and shown to the device user", required: true }}
        onConfirm={(reason) => lifecycle("suspend", reason)}
      />
      <ConfirmDialog
        open={dialog === "resume"}
        onClose={() => setDialog(null)}
        tone="primary"
        title={`Resume ${device.name}?`}
        description="The device will be allowed to reconnect."
        confirmLabel="Resume device"
        onConfirm={() => lifecycle("resume", "")}
      />
      <ConfirmDialog
        open={dialog === "revoke"}
        onClose={() => setDialog(null)}
        title={`Revoke ${device.name}?`}
        description="This permanently revokes the device's credentials. It will wipe its local MDM credentials and can only come back by enrolling again. This cannot be undone."
        confirmLabel="Revoke device"
        confirmText={device.name}
        reason={{ label: "Reason", placeholder: "Recorded in the audit log", required: true }}
        onConfirm={(reason) => lifecycle("revoke", reason)}
      />
    </>
  );
}
