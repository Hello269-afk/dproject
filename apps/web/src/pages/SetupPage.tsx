import { useState } from "react";
import { Building2, Lock, Mail, User } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input } from "../components/ui";
import { useAuth } from "../state/auth";
import { errorMessage } from "../lib/api";
import { AuthLayout } from "./AuthLayout";

export function SetupPage() {
  const { setup } = useAuth();
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async () => {
    if (tooShort || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await setup({ orgName: orgName.trim(), name: name.trim(), email: email.trim(), password });
      toast.success("Organisation created", { description: "You're signed in as the owner." });
    } catch (err) {
      setError(errorMessage(err, "Setup failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-2 inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold text-accent-soft-fg">
        First-run setup
      </div>
      <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">Create your organisation</h1>
      <p className="mt-1.5 text-[13.5px] text-muted">You'll be the owner. You can invite admins and operators afterwards.</p>
      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Organisation name" htmlFor="setup-org">
          <Input id="setup-org" icon={<Building2 />} required autoFocus value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </Field>
        <Field label="Your name" htmlFor="setup-name">
          <Input id="setup-name" icon={<User />} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Work email" htmlFor="setup-email">
          <Input id="setup-email" type="email" icon={<Mail />} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="setup-password" error={tooShort ? "Use at least 10 characters." : undefined}>
          <Input
            id="setup-password"
            type="password"
            icon={<Lock />}
            autoComplete="new-password"
            required
            aria-invalid={tooShort}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirm password" htmlFor="setup-confirm" error={mismatch ? "Passwords don't match." : undefined}>
          <Input
            id="setup-confirm"
            type="password"
            icon={<Lock />}
            autoComplete="new-password"
            required
            aria-invalid={mismatch}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {error && (
          <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-fg">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={tooShort || mismatch}>
          Create organisation
        </Button>
      </form>
    </AuthLayout>
  );
}
