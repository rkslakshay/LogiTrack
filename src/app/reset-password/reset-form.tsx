"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { api, ApiClientError, errorMessage } from "@/lib/client";
import { passwordResetSchema } from "@/lib/validation";
import { PasswordStrength } from "@/components/app/password-strength";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

// The token is read from the fragment in the browser only.
const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const readToken = () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";

export function ResetPasswordForm() {
  const token = useSyncExternalStore(subscribe, readToken, () => null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (token === null) return null; // first render on the server
  if (!token) {
    return (
      <div role="alert">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Reset link incomplete</h1>
        <p className="mt-2 text-[13px] text-ink-2">Open the full link you were given. If it has expired, ask your administrator for a new one.</p>
        <Link href="/login" className="mt-4 inline-block text-[13px] font-medium text-primary hover:underline">Back to sign in</Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = passwordResetSchema.safeParse({ token, newPassword, confirmPassword });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await api.post("/api/auth/password-reset", parsed.data);
      // Remove the used token from the address bar and history.
      window.history.replaceState(null, "", "/reset-password");
      // Full navigation: no state from the reset page should survive.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login?notice=password-reset";
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="reset-heading">
      <span className="grid size-10 place-items-center rounded-md bg-primary-soft text-primary">
        <KeyRound className="size-5" aria-hidden />
      </span>
      <h1 id="reset-heading" className="mt-3 text-xl font-semibold tracking-tight text-ink">Choose a new password</h1>
      <p className="mt-1 text-[13px] text-ink-3">This link works once. All your current sessions will be signed out.</p>
      <form className="mt-6 space-y-4" noValidate onSubmit={submit}>
        {formError && (
          <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">{formError}</div>
        )}
        <div>
          <Label htmlFor="new-password" required>New password</Label>
          <Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} aria-invalid={!!errors.newPassword} aria-describedby="new-password-strength" />
          <FieldError>{errors.newPassword}</FieldError>
          <PasswordStrength id="new-password-strength" password={newPassword} />
        </div>
        <div>
          <Label htmlFor="confirm-password" required>Confirm new password</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} aria-invalid={!!errors.confirmPassword} />
          <FieldError>{errors.confirmPassword}</FieldError>
        </div>
        <Button type="submit" className="w-full" loading={saving}>Set new password</Button>
      </form>
    </section>
  );
}
