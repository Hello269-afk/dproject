import { useState } from "react";
import { Lock, Mail } from "lucide-react";
import { Button, Field, Input } from "../components/ui";
import { useAuth } from "../state/auth";
import { errorMessage } from "../lib/api";
import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err, "Sign-in failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">Sign in</h1>
      <p className="mt-1.5 text-[13.5px] text-muted">Use your administrator account.</p>
      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Email" htmlFor="login-email">
          <Input id="login-email" type="email" icon={<Mail />} autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <Input id="login-password" type="password" icon={<Lock />} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-fg">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
