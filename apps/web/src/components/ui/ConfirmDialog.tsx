import { useEffect, useId, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Field, Input, Textarea } from "./Input";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  /** Require the user to type this exact text before confirming. */
  confirmText?: string;
  /** Ask for a free-text reason; passed to onConfirm. */
  reason?: { label: string; placeholder?: string; required?: boolean };
  /** Step-up re-authentication: ask for the admin's current password; passed to onConfirm. */
  password?: { label: string; hint?: ReactNode };
  /** Inline error shown above the footer (e.g. "Password is incorrect"). */
  error?: ReactNode;
  onConfirm: (reason: string, extra: { password: string }) => Promise<unknown> | unknown;
  children?: ReactNode;
  size?: "sm" | "md";
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = "danger",
  confirmText,
  reason,
  password,
  error,
  onConfirm,
  children,
  size = "sm",
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const ids = useId();
  const [reasonText, setReasonText] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped("");
      setReasonText("");
      setPw("");
      setBusy(false);
    }
  }, [open]);

  const typedOk = !confirmText || typed === confirmText;
  const reasonOk = !reason?.required || reasonText.trim().length > 0;
  const pwOk = !password || pw.length > 0;

  const submit = async () => {
    if (!typedOk || !reasonOk || !pwOk || busy) return;
    setBusy(true);
    try {
      await onConfirm(reasonText.trim(), { password: pw });
      onClose();
    } catch {
      /* caller shows the toast; keep dialog open */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!busy}
      size={size}
      title={title}
      description={description}
      icon={
        tone === "danger" ? (
          <span className="grid size-9 place-items-center rounded-lg bg-danger-soft text-danger-fg">
            <AlertTriangle />
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={submit} loading={busy} disabled={!typedOk || !reasonOk || !pwOk}>
            {confirmLabel}
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
        {children}
        {reason && (
          <Field label={reason.label} optional={!reason.required} htmlFor={`${ids}-reason`}>
            <Textarea
              id={`${ids}-reason`}
              data-autofocus={!confirmText ? "" : undefined}
              rows={2}
              value={reasonText}
              placeholder={reason.placeholder}
              onChange={(e) => setReasonText(e.target.value)}
            />
          </Field>
        )}
        {confirmText && (
          <Field
            htmlFor={`${ids}-confirm`}
            label={
              <>
                Type <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg">{confirmText}</span> to confirm
              </>
            }
          >
            <Input id={`${ids}-confirm`} data-autofocus="" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
        )}
        {password && (
          <Field label={password.label} hint={password.hint} htmlFor={`${ids}-password`}>
            <Input id={`${ids}-password`} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </Field>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] text-danger-fg">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
