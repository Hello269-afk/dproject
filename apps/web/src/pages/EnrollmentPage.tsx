import { useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, Ban, QrCode, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { NoAccess, PageHeader, Unavailable } from "../components/Common";
import { EnrollmentStatusBadge } from "../components/StatusBadges";
import { EnrollmentModal } from "../components/EnrollmentModal";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Select, SkeletonRows, Table, TBody, TD, TH, THead, TR, Tooltip } from "../components/ui";
import { useFleet } from "../state/store";
import { useAuth } from "../state/auth";
import { api, errorMessage } from "../lib/api";
import { cn } from "../lib/cn";
import { formatCountdown, formatDateTime, relativeTime } from "../lib/format";
import { ENROLLMENT_STATUS_META, ENROLLMENT_STEPS, enrollmentStepIndex } from "../lib/labels";
import { ENROLLMENT_STATUSES, type Enrollment, type EnrollmentStatus } from "../lib/types";
import { useNow } from "../hooks/useNow";

const REVOCABLE: EnrollmentStatus[] = ["generated", "scanned", "app_opened", "permissions_approved"];

export function EnrollmentPage() {
  const { can } = useAuth();
  if (!can("operator")) {
    return (
      <>
        <PageHeader title="Enrollment" />
        <Card>
          <NoAccess role="operator" what="Viewing and creating enrollments" />
        </Card>
      </>
    );
  }
  return <EnrollmentList />;
}

function EnrollmentList() {
  const map = useFleet((s) => s.enrollments);
  const state = useFleet((s) => s.enrollmentsState);
  const error = useFleet((s) => s.enrollmentsError);
  const load = useFleet((s) => s.loadEnrollments);
  const upsert = useFleet((s) => s.upsertEnrollment);
  const now = useNow(1000);
  const [status, setStatus] = useState<EnrollmentStatus | "">("");
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState<Enrollment | null>(null);

  const enrollments = useMemo(
    () =>
      Object.values(map)
        .filter((e) => !status || e.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [map, status],
  );

  const revoke = async () => {
    if (!revoking) return;
    try {
      const { enrollment } = await api.post<{ enrollment: Enrollment }>(`/api/enrollments/${revoking.id}/revoke`);
      upsert(enrollment);
      toast.success("Enrollment revoked");
    } catch (err) {
      toast.error("Could not revoke enrollment", { description: errorMessage(err) });
      throw err;
    }
  };

  return (
    <>
      <PageHeader
        title="Enrollment"
        description="One-time QR enrollments. Progress updates live as the device user scans, reviews permissions and connects."
        actions={
          <Button variant="primary" size="lg" icon={<QrCode />} onClick={() => setOpen(true)}>
            Enroll device
          </Button>
        }
      />
      <Card>
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as EnrollmentStatus | "")} className="w-full sm:w-56">
            <option value="">All statuses</option>
            {ENROLLMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ENROLLMENT_STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <span className="tnum ml-auto text-[12px] text-muted">{enrollments.length} enrollments</span>
        </div>
        {state === "idle" || state === "loading" ? (
          <SkeletonRows rows={6} cols={6} />
        ) : state === "error" ? (
          <EmptyState icon={<AlertTriangle />} title="Couldn't load enrollments" description={error ?? undefined} action={<Button onClick={() => void load()}>Retry</Button>} />
        ) : enrollments.length === 0 ? (
          <EmptyState
            icon={<QrCode />}
            title={status ? "No enrollments with this status" : "No enrollments yet"}
            description="Generate a QR code, scan it with the phone and follow the steps in the MDM app."
            action={
              <Button variant="primary" icon={<QrCode />} onClick={() => setOpen(true)}>
                Enroll device
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Enrollment</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Progress</TH>
                <TH className="hidden lg:table-cell">Permissions</TH>
                <TH className="hidden lg:table-cell">Created</TH>
                <TH>Expires</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {enrollments.map((e) => {
                const expiredNow = new Date(e.expiresAt).getTime() <= now;
                const effective: EnrollmentStatus = REVOCABLE.includes(e.status) && expiredNow ? "expired" : e.status;
                const step = enrollmentStepIndex(e.status);
                return (
                  <TR key={e.id}>
                    <TD>
                      <div className="font-medium text-fg">{e.deviceNameHint ?? <span className="text-muted">Unnamed device</span>}</div>
                      <div className="text-[12px] text-muted">{e.assignedUser ? e.assignedUser.name : "No assigned user"}</div>
                    </TD>
                    <TD>
                      <EnrollmentStatusBadge status={effective} />
                    </TD>
                    <TD className="hidden md:table-cell">
                      <div className="flex w-36 gap-1" aria-label={`Step ${Math.max(step, 0) + 1} of ${ENROLLMENT_STEPS.length}`}>
                        {ENROLLMENT_STEPS.map((s, i) => (
                          <span
                            key={s.status}
                            title={s.label}
                            className={cn(
                              "h-1.5 flex-1 rounded-full",
                              i <= step ? (e.status === "connected" ? "bg-success" : "bg-accent") : "bg-surface-3",
                              (effective === "expired" || effective === "revoked") && i <= step && "bg-neutral",
                            )}
                          />
                        ))}
                      </div>
                    </TD>
                    <TD className="hidden lg:table-cell">
                      <span className="tnum">{e.requestedPermissions.length}</span>
                      <span className="text-muted"> requested</span>
                      {e.requiredPermissions.length > 0 && (
                        <Badge tone="accent" className="ml-2">
                          {e.requiredPermissions.length} required
                        </Badge>
                      )}
                    </TD>
                    <TD className="hidden lg:table-cell" title={formatDateTime(e.createdAt)}>
                      <div>{relativeTime(e.createdAt, now)}</div>
                      <div className="text-[12px] text-muted">by {e.createdBy.name}</div>
                    </TD>
                    <TD className="tnum whitespace-nowrap">
                      {REVOCABLE.includes(e.status) && !expiredNow ? (
                        formatCountdown(e.expiresAt, now)
                      ) : e.deviceId ? (
                        <Link to={`/devices/${e.deviceId}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                          <Smartphone className="size-3.5" /> View device
                        </Link>
                      ) : (
                        <Unavailable>—</Unavailable>
                      )}
                    </TD>
                    <TD className="text-right">
                      {REVOCABLE.includes(e.status) && !expiredNow ? (
                        <Tooltip content="Revoke so the QR code and pairing code stop working">
                          <Button size="sm" variant="ghost" icon={<Ban />} onClick={() => setRevoking(e)} className="text-danger-fg hover:bg-danger-soft hover:text-danger-fg">
                            Revoke
                          </Button>
                        </Tooltip>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      <EnrollmentModal open={open} onClose={() => setOpen(false)} />
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke this enrollment?"
        description="The QR code, link and pairing code stop working immediately. A device that's mid-enrollment won't be able to finish."
        confirmLabel="Revoke enrollment"
        onConfirm={revoke}
      />
    </>
  );
}
