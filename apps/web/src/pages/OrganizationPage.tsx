import { useEffect, useState } from "react";
import { Building2, Lock } from "lucide-react";
import { toast } from "sonner";
import { KeyValue, PageHeader } from "../components/Common";
import { Button, Card, CardHeader, Field, Input, Skeleton } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Organization } from "../lib/types";
import { useAuth } from "../state/auth";
import { useApiQuery } from "../hooks/useApiQuery";
import { useFleet } from "../state/store";

export function OrganizationPage() {
  const { can, setOrganization } = useAuth();
  const isOwner = can("owner");
  const q = useApiQuery((signal) => api.get<{ organization: Organization }>("/api/organization", { signal }).then((r) => r.organization), []);
  const deviceCount = useFleet((s) => Object.keys(s.devices).length);
  const org = q.data;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (org) {
      setName(org.name);
      setEmail(org.supportEmail ?? "");
      setPhone(org.supportPhone ?? "");
    }
  }, [org]);

  const dirty = !!org && (name.trim() !== org.name || (email.trim() || null) !== org.supportEmail || (phone.trim() || null) !== org.supportPhone);

  const save = async () => {
    if (!org || !name.trim()) return;
    setBusy(true);
    try {
      const { organization } = await api.patch<{ organization: Organization }>("/api/organization", {
        name: name.trim(),
        supportEmail: email.trim() || null,
        supportPhone: phone.trim() || null,
      });
      q.setData(() => organization);
      setOrganization(organization);
      toast.success("Organisation updated");
    } catch (err) {
      toast.error("Could not save", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Organization" description="Details shown to device users during enrollment, in consent screens and in support contacts." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Details"
            icon={<Building2 />}
            description={isOwner ? "Only owners can edit these." : undefined}
            actions={!isOwner && <span className="inline-flex items-center gap-1 text-[12px] text-muted"><Lock className="size-3.5" /> Owner only</span>}
          />
          {!org ? (
            <div className="space-y-4 p-5">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : (
            <form
              className="space-y-4 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <Field label="Organisation name" htmlFor="org-name">
                <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} required />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Support email" htmlFor="org-email" optional hint="Shown to device users who need help.">
                  <Input id="org-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!isOwner} placeholder="it-help@example.com" />
                </Field>
                <Field label="Support phone" htmlFor="org-phone" optional>
                  <Input id="org-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!isOwner} placeholder="+61 2 0000 0000" />
                </Field>
              </div>
              {isOwner && (
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    disabled={!dirty || busy}
                    onClick={() => {
                      setName(org.name);
                      setEmail(org.supportEmail ?? "");
                      setPhone(org.supportPhone ?? "");
                    }}
                  >
                    Reset
                  </Button>
                  <Button type="submit" variant="primary" loading={busy} disabled={!dirty || !name.trim()}>
                    Save changes
                  </Button>
                </div>
              )}
            </form>
          )}
          {q.error && <p className="px-5 pb-5 text-[13px] text-danger-fg">{errorMessage(q.error)}</p>}
        </Card>
        <Card>
          <CardHeader title="At a glance" />
          <dl className="divide-y divide-border px-5">
            <KeyValue label="Slug" mono>
              {org?.slug ?? "—"}
            </KeyValue>
            <KeyValue label="Created">{formatDate(org?.createdAt)}</KeyValue>
            <KeyValue label="Enrolled devices">
              <span className="tnum">{deviceCount}</span>
            </KeyValue>
            <KeyValue label="Organisation ID" mono>
              {org?.id ?? "—"}
            </KeyValue>
          </dl>
        </Card>
      </div>
    </>
  );
}
