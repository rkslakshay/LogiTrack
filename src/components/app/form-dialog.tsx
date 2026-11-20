"use client";

import * as React from "react";
import { toast } from "sonner";
import type { z } from "zod";
import { ApiClientError, errorMessage } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";

export type FormValues = Record<string, string | boolean>;

export interface FieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface FieldConfig {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "password" | "number" | "date" | "datetime-local" | "select" | "textarea" | "checkbox";
  options?: FieldOption[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  /** Span both columns of the form grid. */
  wide?: boolean;
  step?: string;
  min?: string | number;
  max?: string | number;
  autoComplete?: string;
  /** Text shown for the empty option of a select. Pass null to omit the empty option. */
  emptyOption?: string | null;
  disabled?: boolean;
  /** Section heading rendered above this field. */
  section?: string;
}

function zodErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function FormField({
  field,
  value,
  error,
  onChange,
  idPrefix = "f",
}: {
  field: FieldConfig;
  value: string | boolean;
  error?: string;
  onChange: (value: string | boolean) => void;
  idPrefix?: string;
}) {
  const id = `${idPrefix}-${field.name}`;
  const common = { id, name: field.name, "aria-invalid": !!error, disabled: field.disabled } as const;

  if (field.type === "checkbox") {
    return (
      <div className={cn(field.wide && "sm:col-span-2")}>
        <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-[13px] text-ink">
          <input {...common} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 rounded-sm accent-primary" />
          <span>
            <span className="font-medium">{field.label}</span>
            {field.hint && <span className="block text-xs text-ink-3">{field.hint}</span>}
          </span>
        </label>
        <FieldError>{error}</FieldError>
      </div>
    );
  }

  return (
    <div className={cn(field.wide && "sm:col-span-2")}>
      <Label htmlFor={id} required={field.required}>
        {field.label}
      </Label>
      {field.type === "select" ? (
        <Select {...common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.emptyOption !== null && <option value="">{field.emptyOption ?? "Select…"}</option>}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : field.type === "textarea" ? (
        <Textarea {...common} value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          {...common}
          type={field.type ?? "text"}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          step={field.step}
          min={field.min}
          max={field.max}
          autoComplete={field.autoComplete ?? "off"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <FieldError>{error}</FieldError>
      {!error && <FieldHint>{field.hint}</FieldHint>}
    </div>
  );
}

interface FormDialogProps<S extends z.ZodType> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FieldConfig[];
  schema: S;
  initial: FormValues;
  submitLabel?: string;
  successMessage?: string;
  size?: "sm" | "md" | "lg";
  /** Performs the save. Throw ApiClientError to show server-side field errors. */
  onSubmit: (values: z.infer<S>) => Promise<unknown>;
  onSuccess?: () => void;
  /** Lets a field change update other fields (e.g. picking a place fills coordinates). */
  onFieldChange?: (name: string, value: string | boolean, values: FormValues) => FormValues | void;
  /** Extra content rendered under the fields (previews, notes). */
  footerNote?: (values: FormValues) => React.ReactNode;
}

/**
 * Config-driven create/edit dialog. Validates with the same Zod schema the API
 * uses, then maps any server-side field errors back onto the inputs.
 */
export function FormDialog<S extends z.ZodType>(props: FormDialogProps<S>) {
  // A new key each time the dialog opens gives the form a clean state from `initial`.
  return <FormDialogBody key={String(props.open)} {...props} />;
}

function FormDialogBody<S extends z.ZodType>({
  open, onOpenChange, title, description, fields, schema, initial, submitLabel = "Save", successMessage, size = "md",
  onSubmit, onSuccess, onFieldChange, footerNote,
}: FormDialogProps<S>) {
  const [values, setValues] = React.useState<FormValues>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const formId = React.useId();

  const change = (name: string, value: string | boolean) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      return onFieldChange?.(name, value, next) ?? next;
    });
    if (errors[name]) setErrors((e) => ({ ...e, [name]: "" }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = zodErrors(parsed.error);
      setErrors(fieldErrors);
      const known = new Set(fields.map((f) => f.name));
      const orphan = Object.entries(fieldErrors).find(([key]) => !known.has(key));
      setFormError(orphan ? orphan[1] : "Please correct the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(parsed.data);
      if (successMessage) toast.success(successMessage);
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
        {formError && (
          <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger sm:col-span-2">
            {formError}
          </div>
        )}
        {fields.map((field) => (
          <React.Fragment key={field.name}>
            {field.section && (
              <p className="mt-1 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ink-3 sm:col-span-2">{field.section}</p>
            )}
            <FormField field={field} value={values[field.name] ?? ""} error={errors[field.name]} onChange={(v) => change(field.name, v)} idPrefix={formId} />
          </React.Fragment>
        ))}
        {footerNote && <div className="sm:col-span-2">{footerNote(values)}</div>}
      </form>
    </Dialog>
  );
}
