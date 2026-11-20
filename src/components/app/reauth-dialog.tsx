"use client";

import * as React from "react";
import { ApiClientError, errorMessage } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";

/** Password (and, when two-factor is on, a code) before a sensitive change. */
export function ReauthDialog({
  open, onOpenChange, title, description, needsCode, confirmLabel, tone = "primary", onConfirm, confirmText, children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  needsCode: boolean;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: (input: { password: string; code?: string; confirm?: string }) => Promise<void>;
  /** When set, the user must also type this word (e.g. RESTORE) to enable the action. */
  confirmText?: string;
  children?: React.ReactNode;
}) {
  const [typed, setTyped] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ password, ...(needsCode ? { code } : {}), ...(confirmText ? { confirm: typed } : {}) });
      setPassword("");
      setTyped("");
      setCode("");
      setErrors({});
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      description={description}
      size={children ? "md" : "sm"}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" form={id} loading={busy} disabled={!!confirmText && typed !== confirmText} variant={tone === "danger" ? "danger" : "primary"}>{confirmLabel}</Button>
        </>
      }
    >
      <form id={id} onSubmit={submit} className="space-y-3.5" noValidate>
        {children}
        {error && <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</div>}
        <div>
          <Label htmlFor={`${id}-password`} required>Current password</Label>
          <Input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
          <FieldError>{errors.password}</FieldError>
        </div>
        {needsCode && (
          <div>
            <Label htmlFor={`${id}-code`} required>Authentication code</Label>
            <Input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!errors.code} />
            <FieldError>{errors.code}</FieldError>
          </div>
        )}
        {confirmText && (
          <div>
            <Label htmlFor={`${id}-confirm`} required>Type {confirmText} to confirm</Label>
            <Input id={`${id}-confirm`} autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} aria-invalid={!!errors.confirm} />
            <FieldError>{errors.confirm}</FieldError>
          </div>
        )}
      </form>
    </Dialog>
  );
}
