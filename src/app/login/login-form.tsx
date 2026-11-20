"use client";

import { useState } from "react";
import { ArrowRight, ClipboardList, Navigation, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { api, ApiClientError, errorMessage } from "@/lib/client";
import { loginSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/input";
import { MfaStep } from "./mfa-step";

interface DemoRole {
  key: string;
  role: string;
  person: string;
  email: string;
  password: string;
  icon: LucideIcon;
  summary: string;
  can: string[];
}

// Seeded demo accounts (prisma/seed data). They exist only in the sample dataset.
const DEMO_ROLES: DemoRole[] = [
  {
    key: "admin", role: "Super Admin", person: "Aarav Mehta", email: "admin@logitrack.in", password: "Admin@123", icon: ShieldCheck,
    summary: "Sees and controls everything.",
    can: ["All modules, analytics and reports", "User accounts and roles", "System settings and the audit log"],
  },
  {
    key: "manager", role: "Fleet Manager", person: "Priya Nair", email: "manager@logitrack.in", password: "Manager@123", icon: Truck,
    summary: "Keeps the fleet running and costs in check.",
    can: ["Vehicles, drivers and assignments", "Fuel, maintenance and reminders", "Analytics, performance and exports"],
  },
  {
    key: "dispatcher", role: "Dispatcher", person: "Rohan Verma", email: "dispatcher@logitrack.in", password: "Dispatch@123", icon: ClipboardList,
    summary: "Plans and dispatches the day's deliveries.",
    can: ["Create, assign and update deliveries", "Plan and optimise routes", "Live map and delivery risk"],
  },
  {
    key: "driver", role: "Driver", person: "Suresh Yadav", email: "driver@logitrack.in", password: "Driver@123", icon: Navigation,
    summary: "Works only on their own deliveries.",
    can: ["Assigned deliveries and instructions", "Update status, report issues", "Own performance, nothing else"],
  },
];

export function LoginForm({ next, demo, notice = null }: { next: string | null; demo: boolean; notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [mfa, setMfa] = useState(false);

  const signIn = async (credentials: { email: string; password: string }, source: string) => {
    setFormError(null);
    const parsed = loginSchema.safeParse(credentials);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setLoading(source);
    try {
      const result = await api.post<{ redirectTo?: string; mfaRequired?: boolean }>("/api/auth/login", parsed.data);
      if (result.mfaRequired) {
        setMfa(true);
        setLoading(null);
        return;
      }
      // Full page load so the server layout picks up the new session cookie.
      window.location.href = next ?? result.redirectTo ?? "/";
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
      setLoading(null);
    }
  };

  return (
    <div className={demo ? "grid items-start gap-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-12" : "mx-auto max-w-sm"}>
      {mfa ? (
        <MfaStep
          next={next}
          onCancel={() => {
            setMfa(false);
            setPassword("");
            setFormError("Your sign-in expired or was cancelled. Please enter your password again.");
          }}
        />
      ) : (
      <section aria-labelledby="signin-heading">
        <h1 id="signin-heading" className="text-xl font-semibold tracking-tight text-ink">
          Sign in to your account
        </h1>
        <p className="mt-1 text-[13px] text-ink-3">Enter your work email and password to continue.</p>

        <form
          className="mt-6 space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void signIn({ email, password }, "form");
          }}
        >
          {notice === "password-reset" && !formError && (
            <div role="status" className="rounded-md border border-success/25 bg-success-soft px-3 py-2 text-[13px] text-success">
              Your password has been changed. Sign in with the new password.
            </div>
          )}
          {notice === "restored" && !formError && (
            <div role="status" className="rounded-md border border-info/25 bg-info-soft px-3 py-2 text-[13px] text-info">
              The database was restored from a backup. Please sign in again.
            </div>
          )}
          {formError && (
            <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {formError}
            </div>
          )}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} placeholder="you@company.in" />
            <FieldError>{errors.email}</FieldError>
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
            <FieldError>{errors.password}</FieldError>
          </div>
          <Button type="submit" className="w-full" loading={loading === "form"} disabled={loading !== null}>
            Sign in
          </Button>
        </form>
      </section>
      )}

      {demo && (
        <section id="demo" aria-labelledby="demo-heading" className="scroll-mt-6">
          <h2 id="demo-heading" className="text-xl font-semibold tracking-tight text-ink">
            Explore the demo
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
            Pick a role to sign in with one click. Each role sees a different application. A short guided tour is offered after you sign in, and
            staff roles can reset the sample data at any time from the bar at the top of the app.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {DEMO_ROLES.map((r) => (
              <Card key={r.key} className="flex flex-col p-4" data-demo-role={r.key}>
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
                    <r.icon className="size-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-ink">{r.role}</h3>
                    <p className="truncate text-xs text-ink-3">{r.person} · {r.email}</p>
                  </div>
                </div>
                <p className="mt-3 text-[13px] font-medium text-ink">{r.summary}</p>
                <ul className="mt-1.5 flex-1 space-y-1 text-[13px] text-ink-2">
                  {r.can.map((c) => (
                    <li key={c} className="flex gap-2">
                      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                      {c}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  className="mt-4 w-full"
                  loading={loading === r.key}
                  disabled={loading !== null}
                  onClick={() => {
                    setEmail(r.email);
                    setPassword(r.password);
                    void signIn({ email: r.email, password: r.password }, r.key);
                  }}
                >
                  Sign in as {r.role}
                  {loading !== r.key && <ArrowRight />}
                </Button>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-3">
            These accounts exist only in the sample dataset. Passwords are listed in the README; the buttons above fill them in for you.
          </p>
        </section>
      )}
    </div>
  );
}
