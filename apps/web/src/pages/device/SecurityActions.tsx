import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Clock, Lock, Power, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader, ConfirmDialog, Tooltip } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { securityActionAvailability, type SecurityAction } from "../../lib/devices";
import type { Device, DeviceCommand } from "../../lib/types";
import { useFleet } from "../../state/store";
import { useCurrentUser } from "../../state/auth";

const ACTIONS: { action: SecurityAction; label: string; icon: ReactNode; description: string }[] = [
  { action: "lock", label: "Lock", icon: <Lock />, description: "Locks the screen now. The user unlocks with their PIN, pattern or password." },
  { action: "reboot", label: "Reboot", icon: <Power />, description: "Restarts the phone. Unsaved work in open apps may be lost." },
  {
    action: "wipe",
    label: "Wipe",
    icon: <Trash2 />,
    description: "Factory resets the phone, erasing all apps, data and accounts. Company-owned only.",
  },
];

/** Shared state + dialogs for issuing lock / reboot / wipe (§10). */
function useSecurityCommands(device: Device) {
  const user = useCurrentUser();
  const upsertCommands = useFleet((s) => s.upsertCommands);
  const [dialog, setDialog] = useState<SecurityAction | null>(null);
  const [wipeError, setWipeError] = useState<string | null>(null);

  useEffect(() => {
    if (dialog === "wipe") setWipeError(null);
  }, [dialog]);

  const availability = (a: SecurityAction) => securityActionAvailability(device, a, user.role);

  const send = async (action: SecurityAction, reason: string, extra?: { confirm?: string; password?: string }) => {
    try {
      const { command } = await api.post<{ command: DeviceCommand }>(`/api/devices/${device.id}/commands`, { action, reason, ...extra });
      upsertCommands([command]);
      const label = ACTIONS.find((x) => x.action === action)?.label ?? action;
      if (command.status === "pending") {
        toast.success(`${label} queued`, { description: "Queued: runs when the device reconnects." });
      } else {
        toast.success(`${label} sent to ${device.name}`, { description: "Track the result in the Commands tab." });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_failed") {
        setWipeError("That password is incorrect. Enter your current dashboard password.");
      } else if (err instanceof ApiError && err.code === "not_supported") {
        toast.error("The device can't do this", { description: "Its last reported capabilities don't include this action." });
      } else {
        toast.error("Could not send the command", { description: errorMessage(err) });
      }
      throw err;
    }
  };

  const queuedNote = !device.online ? (
    <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12.5px] text-warning-fg">
      <Clock className="mt-0.5 size-3.5 shrink-0" />
      The device is offline. Queued: runs when the device reconnects (commands expire after 7 days).
    </p>
  ) : null;

  const dialogs = (
    <>
      <ConfirmDialog
        open={dialog === "lock"}
        onClose={() => setDialog(null)}
        tone="primary"
        title={`Lock ${device.name}?`}
        description="The screen locks immediately. The user unlocks it with their usual PIN, pattern or password."
        confirmLabel={device.online ? "Lock device" : "Queue lock"}
        reason={{ label: "Reason", placeholder: "Recorded in the audit log", required: true }}
        onConfirm={(reason) => send("lock", reason)}
      >
        {queuedNote}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "reboot"}
        onClose={() => setDialog(null)}
        title={`Reboot ${device.name}?`}
        description="The phone restarts. Unsaved work in open apps may be lost, and the device is briefly offline."
        confirmLabel={device.online ? "Reboot device" : "Queue reboot"}
        reason={{ label: "Reason", placeholder: "Recorded in the audit log", required: true }}
        onConfirm={(reason) => send("reboot", reason)}
      >
        {queuedNote}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "wipe"}
        onClose={() => setDialog(null)}
        size="md"
        title={`Wipe ${device.name}?`}
        description="This factory resets the phone. It cannot be undone."
        confirmLabel={device.online ? "Wipe device" : "Queue wipe"}
        confirmText={device.name}
        reason={{ label: "Reason", placeholder: "e.g. Reported lost on 4 Nov, ticket #5120", required: true }}
        password={{ label: "Your password", hint: "Re-enter your dashboard password to confirm it's you." }}
        error={wipeError}
        onConfirm={(reason, { password }) => {
          setWipeError(null);
          return send("wipe", reason, { confirm: device.name, password });
        }}
      >
        <ul className="space-y-1.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-[12.5px] leading-relaxed text-danger-fg">
          <li>• Erases everything on the phone: apps, photos, files, accounts and settings.</li>
          <li>• The phone leaves management and must be set up again from scratch.</li>
          <li>• Data that isn't backed up elsewhere is gone for good.</li>
        </ul>
        {queuedNote}
      </ConfirmDialog>
    </>
  );

  return { availability, open: setDialog, dialogs };
}

/** Card with Lock / Reboot / Wipe, each with its explanation and gating. */
export function SecurityActionsCard({ device }: { device: Device }) {
  const { availability, open, dialogs } = useSecurityCommands(device);
  return (
    <Card>
      <CardHeader title="Security actions" icon={<ShieldAlert />} description="Commands are queued while the device is offline." />
      <ul className="divide-y divide-border">
        {ACTIONS.map(({ action, label, icon, description }) => {
          const a = availability(action);
          return (
            <li key={action} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-fg">{label}</div>
                <p className="text-[12px] leading-relaxed text-muted">{a.blockReason ?? description}</p>
                {!a.blockReason && a.queued && <p className="text-[12px] text-warning-fg">Queued: runs when the device reconnects.</p>}
              </div>
              <Tooltip content={a.blockReason} focusable={!!a.blockReason}>
                <Button
                  size="sm"
                  variant={action === "lock" ? "secondary" : "danger-soft"}
                  icon={icon}
                  disabled={!!a.blockReason}
                  onClick={() => open(action)}
                >
                  {a.queued ? `Queue ${label.toLowerCase()}` : label}
                </Button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      {dialogs}
    </Card>
  );
}

/** Compact header menu with the same actions. */
export function SecurityActionsMenu({ device }: { device: Device }) {
  const { availability, open: openDialog, dialogs } = useSecurityCommands(device);
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
    <div ref={ref} className="relative">
      <Button size="sm" icon={<ShieldAlert />} iconRight={<ChevronDown />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Security
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-72 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-pop animate-pop-in"
        >
          {ACTIONS.map(({ action, label, icon }) => {
            const a = availability(action);
            return (
              <button
                key={action}
                role="menuitem"
                type="button"
                disabled={!!a.blockReason}
                onClick={() => {
                  setOpen(false);
                  openDialog(action);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left disabled:opacity-60 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
                  action === "lock" ? "text-fg-2 enabled:hover:bg-surface-2" : "text-danger-fg enabled:hover:bg-danger-soft",
                )}
              >
                {icon}
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">
                    {label}
                    {!a.blockReason && a.queued && <span className="ml-1.5 text-[11.5px] font-normal text-warning-fg">· queued</span>}
                  </span>
                  {a.blockReason && <span className="block text-[11.5px] leading-snug text-muted">{a.blockReason}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {dialogs}
    </div>
  );
}
