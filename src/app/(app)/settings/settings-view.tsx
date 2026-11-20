"use client";

import * as React from "react";
import { KeyRound, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { api, ApiClientError, errorMessage, useQuery } from "@/lib/client";
import { ROLE_LABELS } from "@/lib/constants";
import { changePasswordSchema, profileSchema, settingsSchema } from "@/lib/validation";
import type { AppSettings } from "@/server/services/settings";
import { FormField, type FieldConfig, type FormValues } from "@/components/app/form-dialog";
import { DetailList, LoadingState, PageHeader } from "@/components/app/page";
import { useCan, useUser } from "@/components/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SecuritySettings } from "./security-settings";

/** Inline (non-dialog) form with the same validation behaviour as FormDialog. */
function InlineForm<S extends z.ZodType>({
  fields, schema, initial, submitLabel, onSubmit, resetOnSuccess,
}: {
  fields: FieldConfig[];
  schema: S;
  initial: FormValues;
  submitLabel: string;
  onSubmit: (values: z.infer<S>) => Promise<string>;
  resetOnSuccess?: boolean;
}) {
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const id = React.useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "_")] ??= issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      toast.success(await onSubmit(parsed.data));
      if (resetOnSuccess) setValues(initial);
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid max-w-2xl grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
      {formError && <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger sm:col-span-2">{formError}</div>}
      {fields.map((field) => (
        <React.Fragment key={field.name}>
          {field.section && <p className="mt-1 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ink-3 sm:col-span-2">{field.section}</p>}
          <FormField
            field={field}
            idPrefix={id}
            value={values[field.name] ?? ""}
            error={errors[field.name]}
            onChange={(v) => {
              setValues((prev) => ({ ...prev, [field.name]: v }));
              setErrors((prev) => ({ ...prev, [field.name]: "" }));
            }}
          />
        </React.Fragment>
      ))}
      <div className="sm:col-span-2">
        <Button type="submit" loading={saving}>{submitLabel}</Button>
      </div>
    </form>
  );
}

export function SettingsView() {
  const user = useUser();
  const can = useCan();
  const isAdmin = can("settings:manage");
  const settings = useQuery<AppSettings>(isAdmin ? "/api/settings" : null);

  return (
    <>
      <PageHeader title="Settings" description="Your profile, password and system configuration." />
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile"><UserRound />Profile</TabsTrigger>
          <TabsTrigger value="password"><KeyRound />Password</TabsTrigger>
          <TabsTrigger value="security"><ShieldCheck />Security</TabsTrigger>
          {isAdmin && <TabsTrigger value="system"><SlidersHorizontal />System</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Profile" description="How your name appears across LogiTrack" />
              <CardBody>
                <InlineForm
                  schema={profileSchema}
                  submitLabel="Save profile"
                  initial={{ name: user.name, phone: user.phone ?? "" }}
                  fields={[
                    { name: "name", label: "Full name", required: true },
                    { name: "phone", label: "Phone number", type: "tel", placeholder: "+91 98765 43210" },
                  ]}
                  onSubmit={async (values) => {
                    await api.put("/api/profile", values);
                    // Reload so the shell picks up the new name from the session.
                    setTimeout(() => window.location.reload(), 600);
                    return "Profile updated";
                  }}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Account" />
              <CardBody>
                <DetailList
                  columns={1}
                  items={[
                    { label: "Email (sign-in)", value: user.email },
                    { label: "Role", value: ROLE_LABELS[user.role] },
                    { label: "Driver profile", value: user.driverId ? "Linked" : "Not linked" },
                  ]}
                />
                <p className="mt-3 text-xs text-ink-3">Your email and role can only be changed by a Super Admin.</p>
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>

        <TabsContent value="password">
          <Card>
            <CardHeader title="Change password" description="Changing your password signs you out on every other device" />
            <CardBody>
              <InlineForm
                schema={changePasswordSchema}
                submitLabel="Change password"
                resetOnSuccess
                initial={{ currentPassword: "", newPassword: "", confirmPassword: "" }}
                fields={[
                  { name: "currentPassword", label: "Current password", type: "password", required: true, wide: true, autoComplete: "current-password" },
                  { name: "newPassword", label: "New password", type: "password", required: true, autoComplete: "new-password", hint: "At least 8 characters with a letter and a number; not a common password or your name. Longer is stronger." },
                  { name: "confirmPassword", label: "Confirm new password", type: "password", required: true, autoComplete: "new-password" },
                ]}
                onSubmit={async (values) => {
                  await api.post("/api/profile/password", values);
                  return "Password changed";
                }}
              />
            </CardBody>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="system">
            <Card>
              <CardHeader title="System settings" description="Applies to everyone. Changes are recorded in the activity log." />
              <CardBody>
                {!settings.data ? (
                  <LoadingState />
                ) : (
                  <InlineForm
                    key={JSON.stringify(settings.data)}
                    schema={settingsSchema}
                    submitLabel="Save settings"
                    initial={{
                      companyName: settings.data.companyName,
                      simulationSpeed: String(settings.data.simulationSpeed),
                      averageSpeedKmh: String(settings.data.averageSpeedKmh),
                      simulationAutoComplete: settings.data.simulationAutoComplete,
                      maintenanceReminderDays: String(settings.data.maintenanceReminderDays),
                      maintenanceReminderKm: String(settings.data.maintenanceReminderKm),
                      complianceReminderDays: String(settings.data.complianceReminderDays),
                    }}
                    fields={[
                      { name: "companyName", label: "Company name", required: true, wide: true },
                      { name: "simulationSpeed", label: "Simulation speed (×)", type: "number", min: 1, max: 240, section: "GPS simulation", hint: "Simulated seconds per real second. 10× means a 40 km trip takes about 6 minutes." },
                      { name: "averageSpeedKmh", label: "Average vehicle speed (km/h)", type: "number", min: 10, max: 100, hint: "Used for travel-time estimates and by the simulator" },
                      { name: "simulationAutoComplete", label: "Complete deliveries automatically on arrival", type: "checkbox", wide: true, hint: "When off, the vehicle waits at the destination until someone marks the delivery as delivered." },
                      { name: "maintenanceReminderDays", label: "Maintenance reminder (days before)", type: "number", min: 1, max: 90, section: "Reminders" },
                      { name: "maintenanceReminderKm", label: "Maintenance reminder (km before)", type: "number", min: 50, max: 10000 },
                      { name: "complianceReminderDays", label: "Document expiry reminder (days before)", type: "number", min: 1, max: 180, hint: "Insurance, registration and driving licences" },
                    ]}
                    onSubmit={async (values) => {
                      await api.put("/api/settings", values);
                      settings.reload();
                      return "Settings saved";
                    }}
                  />
                )}
              </CardBody>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
