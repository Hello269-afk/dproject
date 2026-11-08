import { Badge } from "./ui";
import {
  DEVICE_STATUS_META,
  ENROLLMENT_STATUS_META,
  PERMISSION_STATUS_META,
  SESSION_STATUS_META,
} from "../lib/labels";
import type { DeviceStatus, EnrollmentStatus, PermissionStatus, ScreenSessionStatus } from "../lib/types";

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const m = DEVICE_STATUS_META[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={m.tone} dot pulse={status === "connected"} title={m.description}>
      {m.label}
    </Badge>
  );
}

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  const m = ENROLLMENT_STATUS_META[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

export function PermissionStatusBadge({ status }: { status: PermissionStatus }) {
  const m = PERMISSION_STATUS_META[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function SessionStatusBadge({ status }: { status: ScreenSessionStatus }) {
  const m = SESSION_STATUS_META[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={m.tone} dot pulse={status === "active" || status === "awaiting_consent"}>
      {m.label}
    </Badge>
  );
}
