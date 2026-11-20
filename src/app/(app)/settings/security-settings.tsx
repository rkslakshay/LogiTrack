"use client";

import * as React from "react";
import { Copy, Download, Laptop, LogOut, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useQuery } from "@/lib/client";
import { formatDateTime, timeAgo } from "@/lib/format";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge } from "@/components/app/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/app/page";
import { useDemo, useUser } from "@/components/app/providers";
import { ReauthDialog } from "@/components/app/reauth-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FieldError, FieldHint, Input, Label } from "@/components/ui/input";

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}
interface SetupMaterial {
  otpauthUri: string;
  manualKey: string;
  qrSvg: string;
  issuer: string;
  account: string;
}
interface SessionRow {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Recovery codes, shown exactly once, with copy and download. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = `LogiTrack recovery codes\nGenerated ${new Date().toLocaleString("en-IN")}\nEach code can be used once.\n\n${codes.join("\n")}\n`;
  return (
    <div>
      <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-ink" role="alert">
        Save these codes somewhere safe now. They will not be shown again. Each one signs you in once if you lose your authenticator.
      </div>
      <ul className="tabular mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md bg-canvas p-3 font-mono text-sm text-ink" aria-label="Recovery codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(codes.join("\n"));
            toast.success("Recovery codes copied");
          }}
        >
          <Copy />Copy
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "logitrack-recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download />Download
        </Button>
      </div>
    </div>
  );
}

function TwoFactorCard() {
  const demo = useDemo();
  const status = useQuery<MfaStatus>("/api/profile/mfa");
  const [step, setStep] = React.useState<"idle" | "password" | "scan" | "codes">("idle");
  const [setup, setSetup] = React.useState<SetupMaterial | null>(null);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [code, setCode] = React.useState("");
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dialog, setDialog] = React.useState<"disable" | "regenerate" | null>(null);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setCodeError(null);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>("/api/profile/mfa/enable", { code });
      setCodes(result.recoveryCodes);
      setSetup(null); // forget the secret as soon as it is active
      setStep("codes");
      status.reload();
      toast.success("Two-factor authentication is on");
    } catch (err) {
      setCodeError(errorMessage(err));
    } finally {
      setBusy(false);
      setCode("");
    }
  };

  const enabled = status.data?.enabled;
  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        description="Sign in with your password and a code from an authenticator app (for example Google Authenticator, Microsoft Authenticator, Aegis or 1Password)."
        action={status.data && <Badge tone={enabled ? "success" : "neutral"} dot>{enabled ? "On" : "Off"}</Badge>}
      />
      <CardBody>
        {status.error ? (
          <ErrorState message={status.error} onRetry={status.reload} className="py-6" />
        ) : !status.data ? (
          <LoadingState className="py-6" />
        ) : step === "codes" && codes ? (
          <div className="max-w-xl">
            <RecoveryCodes codes={codes} />
            <Button className="mt-4" onClick={() => { setCodes(null); setStep("idle"); }}>I have saved my codes</Button>
          </div>
        ) : step === "scan" && setup ? (
          <div className="grid max-w-3xl gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
            {/* A generated data: URL; next/image adds nothing for an inline SVG of a secret. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
              alt={`QR code to add LogiTrack (${setup.account}) to an authenticator app. The same key is shown as text alongside.`}
              width={200}
              height={200}
              className="rounded-md border border-line bg-white p-2"
            />
            <form onSubmit={verify} noValidate>
              <ol className="list-decimal space-y-1 pl-4 text-[13px] text-ink-2">
                <li>Scan the QR code with your authenticator app.</li>
                <li>Or enter this key manually (time-based, 6 digits):</li>
              </ol>
              <p className="tabular mt-2 select-all rounded-md bg-canvas px-3 py-2 font-mono text-sm text-ink" aria-label="Manual entry key">{setup.manualKey}</p>
              <Label htmlFor="mfa-confirm-code" className="mt-4" required>Enter the 6-digit code to finish</Label>
              <div className="flex gap-2">
                <Input id="mfa-confirm-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!codeError} className="max-w-40" />
                <Button type="submit" loading={busy}>Verify</Button>
              </div>
              <FieldError>{codeError}</FieldError>
              <Button variant="link" size="sm" className="mt-2 h-auto p-0" onClick={() => { setSetup(null); setStep("idle"); }}>Cancel set-up</Button>
            </form>
          </div>
        ) : enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] text-ink-2">
              <p className="flex items-center gap-1.5 font-medium text-ink"><ShieldCheck className="size-4 text-success" aria-hidden />Your account is protected with an authenticator app.</p>
              <p className="mt-1">Turned on {status.data.enabledAt ? formatDateTime(status.data.enabledAt) : ""}. {status.data.recoveryCodesRemaining} unused recovery code{status.data.recoveryCodesRemaining === 1 ? "" : "s"} left.</p>
              {status.data.recoveryCodesRemaining <= 3 && <p className="mt-1 font-medium text-warning">You are running low on recovery codes. Generate a new set.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDialog("regenerate")}>New recovery codes</Button>
              <Button variant="danger-ghost" onClick={() => setDialog("disable")}><ShieldOff />Turn off</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-[13px] text-ink-2">
              Two-factor authentication stops someone who learns your password from signing in. You will need your phone, or a recovery code, every time you sign in.
              {demo.enabled && " On this shared demo account it is removed again when the demo data is reset."}
            </p>
            <Button onClick={() => setStep("password")}><Smartphone />Set up two-factor</Button>
          </div>
        )}
      </CardBody>

      <ReauthDialog
        open={step === "password"}
        onOpenChange={(o) => !o && setStep("idle")}
        title="Set up two-factor authentication"
        description="Confirm your password to continue."
        needsCode={false}
        confirmLabel="Continue"
        onConfirm={async ({ password }) => {
          setSetup(await api.post<SetupMaterial>("/api/profile/mfa", { password }));
          setStep("scan");
        }}
      />
      <ReauthDialog
        open={dialog === "regenerate"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Generate new recovery codes"
        description="Your current recovery codes stop working. Confirm your password and a code from your app."
        needsCode
        confirmLabel="Generate"
        onConfirm={async (input) => {
          const result = await api.post<{ recoveryCodes: string[] }>("/api/profile/mfa/recovery-codes", input);
          setDialog(null);
          setCodes(result.recoveryCodes);
          setStep("codes");
          status.reload();
        }}
      />
      <ReauthDialog
        open={dialog === "disable"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Turn off two-factor authentication?"
        description="Your account will be protected by your password alone. Confirm your password and a code from your app."
        needsCode
        confirmLabel="Turn off"
        tone="danger"
        onConfirm={async (input) => {
          await api.post("/api/profile/mfa/disable", input);
          setDialog(null);
          status.reload();
          toast.success("Two-factor authentication is off");
        }}
      />
    </Card>
  );
}

function SessionsCard() {
  const sessions = useQuery<SessionRow[]>("/api/profile/sessions");
  const [confirmAll, setConfirmAll] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const others = (sessions.data ?? []).filter((s) => !s.current);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      sessions.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Where you are signed in"
        description="Sessions end after 7 days, or after 12 hours without activity."
        action={others.length > 0 && <Button variant="secondary" size="sm" onClick={() => setConfirmAll(true)}><LogOut />Sign out other sessions</Button>}
      />
      {sessions.error ? (
        <ErrorState message={sessions.error} onRetry={sessions.reload} className="py-6" />
      ) : !sessions.data ? (
        <LoadingState className="py-6" />
      ) : sessions.data.length === 0 ? (
        <EmptyState title="No sessions" className="py-6" />
      ) : (
        <ul className="divide-y divide-line" aria-label="Active sessions">
          {sessions.data.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <Laptop className="size-4 shrink-0 text-ink-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                  {describeAgent(s.userAgent)}
                  {s.current && <Badge tone="success">This device</Badge>}
                </p>
                <p className="text-xs text-ink-3">Signed in {formatDateTime(s.createdAt)} · last active {timeAgo(s.lastSeenAt)}</p>
              </div>
              {!s.current && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => api.del(`/api/profile/sessions/${s.id}`), "Session signed out")} aria-label={`Sign out ${describeAgent(s.userAgent)}, signed in ${formatDateTime(s.createdAt)}`}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out of all other sessions?"
        description={`${others.length} other session${others.length === 1 ? "" : "s"} will be signed out. This device stays signed in.`}
        confirmLabel="Sign out others"
        loading={busy}
        onConfirm={() => act(() => api.del("/api/profile/sessions"), "Other sessions signed out")}
      />
    </Card>
  );
}

export function SecuritySettings() {
  const user = useUser();
  return (
    <div className="space-y-4">
      <TwoFactorCard />
      <SessionsCard />
      <FieldHint>Signed in as {user.email}. Forgot your password? A Super Admin can give you a one-time reset link.</FieldHint>
    </div>
  );
}
