import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Dialog, Field, Input, Select } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { Device } from "../../lib/types";
import { useFleet } from "../../state/store";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { ROLE_META } from "../../lib/labels";

export function RenameDialog({ device, open, onClose }: { device: Device; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(device.name);
  const [busy, setBusy] = useState(false);
  const upsert = useFleet((s) => s.upsertDevice);
  useEffect(() => {
    if (open) setName(device.name);
  }, [open, device.name]);

  const submit = async () => {
    const n = name.trim();
    if (!n || n === device.name) return onClose();
    setBusy(true);
    try {
      const { device: d } = await api.patch<{ device: Device }>(`/api/devices/${device.id}`, { name: n });
      upsert(d);
      toast.success("Device renamed");
      onClose();
    } catch (err) {
      toast.error("Rename failed", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Rename device"
      dismissable={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!name.trim()}>
            Save
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
        <Field label="Device name" htmlFor="rename-input">
          <Input id="rename-input" data-autofocus="" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

export function AssignUserDialog({ device, open, onClose }: { device: Device; open: boolean; onClose: () => void }) {
  const users = useAssignableUsers(open);
  const [userId, setUserId] = useState(device.assignedUser?.id ?? "");
  const [busy, setBusy] = useState(false);
  const upsert = useFleet((s) => s.upsertDevice);
  useEffect(() => {
    if (open) setUserId(device.assignedUser?.id ?? "");
  }, [open, device.assignedUser?.id]);

  const list = users.data ?? [];
  // Keep the current assignee selectable even if the list doesn't include them (e.g. operator view).
  const missingCurrent = device.assignedUser && !list.some((u) => u.id === device.assignedUser!.id);

  const submit = async () => {
    setBusy(true);
    try {
      const { device: d } = await api.patch<{ device: Device }>(`/api/devices/${device.id}`, { assignedUserId: userId || null });
      upsert(d);
      toast.success(userId ? "User assigned" : "Device unassigned");
      onClose();
    } catch (err) {
      toast.error("Could not update assignment", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Assign user"
      description="The assigned user is shown on screen-share requests and in support chat."
      dismissable={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={userId === (device.assignedUser?.id ?? "")}>
            Save
          </Button>
        </>
      }
    >
      <Field label="User" htmlFor="assign-user" hint={users.error ? errorMessage(users.error) : undefined}>
        <Select id="assign-user" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={users.loading && !users.data}>
          <option value="">Unassigned</option>
          {missingCurrent && <option value={device.assignedUser!.id}>{device.assignedUser!.name} (current)</option>}
          {list.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.role === "member" ? u.email : ROLE_META[u.role].label}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}
