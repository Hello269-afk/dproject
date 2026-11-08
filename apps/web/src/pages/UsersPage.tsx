import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, NoAccess, PageHeader } from "../components/Common";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonRows,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tooltip,
} from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { relativeTime } from "../lib/format";
import { ROLE_META } from "../lib/labels";
import type { Role, User } from "../lib/types";
import { useAuth, useCurrentUser } from "../state/auth";
import { useApiQuery } from "../hooks/useApiQuery";

/** Roles the current user may assign / manage (owners manage admins; admins manage below admin). */
function manageableRoles(role: Role): Role[] {
  if (role === "owner") return ["owner", "admin", "operator", "viewer", "member"];
  if (role === "admin") return ["operator", "viewer", "member"];
  return [];
}

export function UsersPage() {
  const { can } = useAuth();
  if (!can("admin")) {
    return (
      <>
        <PageHeader title="Users" />
        <Card>
          <NoAccess role="admin" what="Managing users" />
        </Card>
      </>
    );
  }
  return <UsersList />;
}

function UsersList() {
  const me = useCurrentUser();
  const q = useApiQuery((signal) => api.get<{ users: User[] }>("/api/users", { signal }).then((r) => r.users), []);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [disabling, setDisabling] = useState<User | null>(null);
  const roles = manageableRoles(me.role);

  const users = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((u) => !roleFilter || u.role === roleFilter)
      .filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [q.data, search, roleFilter]);

  const replace = (u: User) => q.setData((prev) => prev?.map((x) => (x.id === u.id ? u : x)));

  const patch = async (u: User, body: Partial<Pick<User, "role" | "status" | "name">>, success: string) => {
    try {
      const { user } = await api.patch<{ user: User }>(`/api/users/${u.id}`, body);
      replace(user);
      toast.success(success);
    } catch (err) {
      toast.error("Update failed", { description: errorMessage(err) });
      throw err;
    }
  };

  const canManage = (u: User) => u.id !== me.id && roles.includes(u.role);

  return (
    <>
      <PageHeader
        title="Users"
        description="Dashboard administrators and device users (members). Members can't sign in to the dashboard."
        actions={
          <Button variant="primary" icon={<UserPlus />} onClick={() => setCreateOpen(true)}>
            Add user
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
          <Input icon={<Search />} placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" className="sm:w-72" />
          <Select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | "")} className="sm:w-44">
            <option value="">All roles</option>
            {(Object.keys(ROLE_META) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label}
              </option>
            ))}
          </Select>
        </div>
        {q.loading && !q.data ? (
          <SkeletonRows rows={6} cols={5} />
        ) : q.error ? (
          <EmptyState icon={<AlertTriangle />} title="Couldn't load users" description={errorMessage(q.error)} action={<Button onClick={() => void q.reload()}>Retry</Button>} />
        ) : users.length === 0 ? (
          <EmptyState icon={<Users />} title="No users found" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Last sign-in</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {users.map((u) => {
                const manageable = canManage(u);
                const reason = u.id === me.id ? "You can't change your own account here." : !manageable ? "Only an owner can change admins and owners." : null;
                return (
                  <TR key={u.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-fg">
                            {u.name} {u.id === me.id && <span className="text-[12px] font-normal text-muted">(you)</span>}
                          </div>
                          <div className="truncate text-[12px] text-muted">{u.email}</div>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      {manageable ? (
                        <Select
                          aria-label={`Role for ${u.name}`}
                          value={u.role}
                          onChange={(e) => void patch(u, { role: e.target.value as Role }, `${u.name} is now ${ROLE_META[e.target.value as Role].label}`).catch(() => undefined)}
                          className="w-36"
                        >
                          {roles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_META[r].label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span title={ROLE_META[u.role].description}>{ROLE_META[u.role].label}</span>
                      )}
                    </TD>
                    <TD>{u.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>}</TD>
                    <TD className="hidden md:table-cell">{u.role === "member" ? <span className="text-subtle">N/A</span> : relativeTime(u.lastLoginAt)}</TD>
                    <TD className="text-right">
                      <Tooltip content={reason} focusable={!!reason}>
                        {u.status === "active" ? (
                          <Button size="sm" variant="ghost" disabled={!manageable} onClick={() => setDisabling(u)} className="text-danger-fg hover:bg-danger-soft hover:text-danger-fg">
                            Disable
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" disabled={!manageable} onClick={() => void patch(u, { status: "active" }, `${u.name} re-enabled`).catch(() => undefined)}>
                            Enable
                          </Button>
                        )}
                      </Tooltip>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        roles={roles}
        onCreated={(u) => q.setData((prev) => (prev ? [...prev, u] : [u]))}
      />
      <ConfirmDialog
        open={!!disabling}
        onClose={() => setDisabling(null)}
        title={`Disable ${disabling?.name}?`}
        description="They will be signed out and unable to sign in until re-enabled. Devices assigned to them stay enrolled."
        confirmLabel="Disable user"
        onConfirm={() => (disabling ? patch(disabling, { status: "disabled" }, `${disabling.name} disabled`) : undefined)}
      />
    </>
  );
}

function CreateUserDialog({ open, onClose, roles, onCreated }: { open: boolean; onClose: () => void; roles: Role[]; onCreated: (u: User) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setRole("member");
      setPassword("");
    }
  }, [open]);

  const needsPassword = role !== "member";
  const valid = name.trim() && email.trim() && (!needsPassword || password.length >= 8);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body: Record<string, string> = { name: name.trim(), email: email.trim(), role };
      if (needsPassword) body.password = password;
      const { user } = await api.post<{ user: User }>("/api/users", body);
      onCreated(user);
      toast.success(`${user.name} added`, { description: needsPassword ? "Share the password with them securely." : "They can now be assigned devices." });
      onClose();
    } catch (err) {
      toast.error("Could not add user", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!busy}
      title="Add user"
      description="Members are device users and don't get dashboard access. Other roles sign in with the password you set."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Add user
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="nu-name">
            <Input id="nu-name" data-autofocus="" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email" htmlFor="nu-email">
            <Input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
        </div>
        <Field label="Role" htmlFor="nu-role" hint={ROLE_META[role].description}>
          <Select id="nu-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label}
              </option>
            ))}
          </Select>
        </Field>
        {needsPassword && (
          <Field
            label="Initial password"
            htmlFor="nu-password"
            hint="At least 10 characters. Share it securely; there's no email invite yet."
            error={password.length > 0 && password.length < 10 ? "Too short" : undefined}
          >
            <Input id="nu-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
