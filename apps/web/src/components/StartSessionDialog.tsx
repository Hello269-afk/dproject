import { useEffect, useState } from "react";
import { MousePointerClick, ScreenShare } from "lucide-react";
import { toast } from "sonner";
import { Button, Checkbox, Dialog, Field, Textarea, Tooltip } from "./ui";
import { api, ApiError, errorMessage } from "../lib/api";
import type { CreateScreenSessionResponse, Device } from "../lib/types";
import { iceServerCache, useFleet } from "../state/store";
import { deviceUserName, remoteControlReadiness } from "../lib/devices";
import { cn } from "../lib/cn";

const MAX = 200;

export function StartSessionDialog({
  device,
  open,
  onClose,
  onStarted,
}: {
  device: Device;
  open: boolean;
  onClose: () => void;
  onStarted?: (sessionId: string) => void;
}) {
  const [purpose, setPurpose] = useState("");
  const [control, setControl] = useState(false);
  const [busy, setBusy] = useState(false);
  const upsertSession = useFleet((s) => s.upsertSession);
  const readiness = remoteControlReadiness(device);
  // Offline is handled by the screen-share block itself; only device-side readiness gates the checkbox.
  const controlBlock = readiness.accessibility && readiness.capability ? null : readiness.reason;

  useEffect(() => {
    if (open) {
      setPurpose("");
      setControl(false);
    }
  }, [open]);

  const submit = async () => {
    const p = purpose.trim();
    if (!p || busy) return;
    setBusy(true);
    try {
      const res = await api.post<CreateScreenSessionResponse>(`/api/devices/${device.id}/screen-sessions`, {
        purpose: p,
        control: control && !controlBlock,
      });
      iceServerCache.set(res.session.id, res.iceServers);
      upsertSession(res.session);
      toast.success("Screen-share request sent", { description: `Waiting for ${deviceUserName(device)} to approve.` });
      onStarted?.(res.session.id);
      onClose();
    } catch (err) {
      toast.error("Could not request screen sharing", {
        description:
          err instanceof ApiError && err.code === "permission_required" && control
            ? "Remote control needs the device's accessibility permission to be granted. Request view-only instead, or ask the user to turn it on."
            : errorMessage(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!busy}
      title="Request screen sharing"
      description={`${device.name} will show your name and this purpose. Nothing is captured until ${deviceUserName(device)} approves and the operating system confirms.`}
      icon={
        <span className="grid size-9 place-items-center rounded-lg bg-session-soft text-session-fg">
          <ScreenShare />
        </span>
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!purpose.trim()}>
            Send request
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Purpose"
          htmlFor="ss-purpose"
          hint={
            <span className="flex justify-between gap-2">
              <span>Shown to the device user on the consent screen.</span>
              <span className="tnum">
                {purpose.length}/{MAX}
              </span>
            </span>
          }
        >
          <Textarea
            id="ss-purpose"
            data-autofocus=""
            rows={3}
            maxLength={MAX}
            required
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Help troubleshoot the email sync issue reported in ticket #4821"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
          />
        </Field>
        <div className="mt-4">
        <Tooltip content={controlBlock} focusable={!!controlBlock} className="w-full">
          <label
            htmlFor="ss-control"
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border border-border p-3",
              controlBlock ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-2/60",
              control && !controlBlock && "border-accent/50 bg-accent-soft/40",
            )}
          >
            <span className="pt-0.5">
              <Checkbox id="ss-control" checked={control && !controlBlock} disabled={!!controlBlock} onChange={setControl} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                <MousePointerClick className="size-3.5 text-muted" /> Request remote control
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                Lets you tap, swipe and type on the device. {deviceUserName(device)} can approve view-only instead, and can turn control off at
                any time.
              </span>
            </span>
          </label>
        </Tooltip>
        </div>
        <ul className="mt-4 space-y-1.5 rounded-lg border border-border bg-surface-2 p-3 text-[12.5px] text-muted">
          <li>• The request expires after 60 seconds if not answered.</li>
          <li>• The user can stop sharing at any time from their device.</li>
          <li>• Every step is recorded in the audit log.</li>
        </ul>
      </form>
    </Dialog>
  );
}
