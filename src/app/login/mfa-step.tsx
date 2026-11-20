"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api, ApiClientError, errorMessage } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label } from "@/components/ui/input";

/**
 * Second sign-in step for accounts with two-factor authentication. The password
 * has already been accepted; a short-lived HttpOnly cookie carries the challenge.
 */
export function MfaStep({ next, onCancel }: { next: string | null; onCancel: () => void }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!value.trim()) {
      setError(useRecovery ? "Enter one of your recovery codes" : "Enter the 6-digit code");
      return;
    }
    setLoading(true);
    try {
      const result = await api.post<{ redirectTo: string }>("/api/auth/mfa", useRecovery ? { recoveryCode: value } : { code: value });
      window.location.href = next ?? result.redirectTo;
    } catch (err) {
      // An expired challenge means starting again from the password.
      if (err instanceof ApiClientError && err.status === 401 && /expired/.test(err.message)) {
        onCancel();
        return;
      }
      setError(errorMessage(err));
      setLoading(false);
      setValue("");
    }
  };

  return (
    <section aria-labelledby="mfa-heading">
      <span className="grid size-10 place-items-center rounded-md bg-primary-soft text-primary">
        <ShieldCheck className="size-5" aria-hidden />
      </span>
      <h1 id="mfa-heading" className="mt-3 text-xl font-semibold tracking-tight text-ink">
        Two-factor authentication
      </h1>
      <p className="mt-1 text-[13px] text-ink-3">
        {useRecovery ? "Enter one of the recovery codes you saved when you turned on two-factor authentication. Each code works once." : "Open your authenticator app and enter the 6-digit code for LogiTrack."}
      </p>
      <form className="mt-6 space-y-4" noValidate onSubmit={submit}>
        <div>
          <Label htmlFor="mfa-code">{useRecovery ? "Recovery code" : "Authentication code"}</Label>
          <Input
            id="mfa-code"
            name={useRecovery ? "recoveryCode" : "code"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="one-time-code"
            inputMode={useRecovery ? "text" : "numeric"}
            maxLength={useRecovery ? 11 : 7}
            placeholder={useRecovery ? "xxxxx-xxxxx" : "123456"}
            aria-invalid={!!error}
            aria-describedby={error ? "mfa-error" : "mfa-hint"}
            autoFocus
            className="tabular text-base tracking-widest"
          />
          {error ? <div id="mfa-error"><FieldError>{error}</FieldError></div> : <div id="mfa-hint"><FieldHint>{useRecovery ? "Dashes and spaces are optional." : "Codes change every 30 seconds."}</FieldHint></div>}
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          Verify and sign in
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <button
          type="button"
          className="font-medium text-primary hover:underline"
          onClick={() => {
            setUseRecovery((v) => !v);
            setValue("");
            setError(null);
          }}
        >
          {useRecovery ? "Use your authenticator app instead" : "Use a recovery code"}
        </button>
        <button type="button" className="text-ink-3 hover:text-ink" onClick={onCancel}>
          Back to sign in
        </button>
      </div>
      <p className="mt-6 text-xs text-ink-3">Lost your device and your recovery codes? Ask a Super Admin to reset two-factor authentication for your account.</p>
    </section>
  );
}
