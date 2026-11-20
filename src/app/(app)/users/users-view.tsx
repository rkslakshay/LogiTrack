"use client";

import { useState } from "react";
import { Copy, KeyRound, LockOpen, Pencil, Plus, ShieldOff, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useListState, useQuery, type Paged } from "@/lib/client";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/constants";
import { formatDate, timeAgo } from "@/lib/format";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import { userCreateSchema, userUpdateSchema } from "@/lib/validation";
import { DataTable, FilterSelect, Pagination, SearchInput, Toolbar, type Column } from "@/components/app/data-table";
import { FormDialog, type FieldConfig } from "@/components/app/form-dialog";
import { PageHeader } from "@/components/app/page";
import { useUser } from "@/components/app/providers";
import { RowActions } from "@/components/app/row-actions";
import { Badge, StatusBadge, type Tone } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  driver: { id: string; code: string } | null;
  mfaEnabled: boolean;
  lockedUntil: string | null;
  failedLoginCount: number;
}

const ROLE_TONE: Record<Role, Tone> = { SUPER_ADMIN: "danger", FLEET_MANAGER: "info", DISPATCHER: "indigo", DRIVER: "neutral" };
const ROLE_SUMMARY: Record<Role, string> = {
  SUPER_ADMIN: "Full access, including users, settings and audit logs.",
  FLEET_MANAGER: "Vehicles, drivers, deliveries, fuel, maintenance, analytics and reports.",
  DISPATCHER: "Deliveries, assignment, route planning and live tracking. Read-only fleet.",
  DRIVER: "Own deliveries, status updates, issue reporting and own performance.",
};

export function UsersView() {
  const me = useUser();
  const list = useListState({ filters: { role: "", active: "" } });
  const { data, loading, refreshing, error, reload } = useQuery<Paged<UserRow>>(`/api/users${list.query}`);
  const [form, setForm] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const [deactivating, setDeactivating] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = form.user;

  const deactivate = async () => {
    if (!deactivating) return;
    setBusy(true);
    try {
      await api.del(`/api/users/${deactivating.id}`);
      toast.success(`${deactivating.name} deactivated`);
      setDeactivating(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const [resetLink, setResetLink] = useState<{ url: string; expiresAt: string; user: { name: string } } | null>(null);
  const [securityAction, setSecurityAction] = useState<{ kind: "mfa" | "unlock"; user: UserRow } | null>(null);

  const createResetLink = async (u: UserRow) => {
    try {
      setResetLink(await api.post(`/api/users/${u.id}/reset-link`));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const runSecurityAction = async () => {
    if (!securityAction) return;
    setBusy(true);
    try {
      const { kind, user: u } = securityAction;
      if (kind === "mfa") await api.del(`/api/users/${u.id}/mfa`);
      else await api.post(`/api/users/${u.id}/unlock`);
      toast.success(kind === "mfa" ? `Two-factor authentication removed for ${u.name}` : `${u.name} can sign in again`);
      setSecurityAction(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const isLocked = (u: UserRow) => !!u.lockedUntil && new Date(u.lockedUntil) > new Date();

  const reactivate = async (u: UserRow) => {
    try {
      await api.put(`/api/users/${u.id}`, { name: u.name, email: u.email, phone: u.phone ?? "", role: u.role, isActive: true });
      toast.success(`${u.name} reactivated`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const fields: FieldConfig[] = [
    { name: "name", label: "Full name", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone number", type: "tel", placeholder: "+91 98765 43210" },
    {
      name: "role", label: "Role", type: "select", required: true, emptyOption: "Select a role…", disabled: !!editing?.driver || editing?.id === me.id,
      hint: editing?.driver ? "Linked to a driver profile" : editing?.id === me.id ? "You cannot change your own role" : undefined,
      options: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
    },
    {
      name: "password", label: editing ? "Reset password" : "Password", type: "password", required: !editing, wide: true, autoComplete: "new-password",
      hint: editing ? "Leave blank to keep the current password. Resetting signs the user out everywhere." : "At least 8 characters with a letter and a number.",
    },
    { name: "isActive", label: "Account is active", type: "checkbox", wide: true, hint: "Inactive users cannot sign in.", disabled: editing?.id === me.id },
  ];

  const columns: Column<UserRow>[] = [
    {
      key: "name", header: "User", sortKey: "name",
      render: (u) => <div><p className="whitespace-nowrap font-medium">{u.name}{u.id === me.id && <span className="ml-1.5 text-xs font-normal text-ink-3">(you)</span>}</p><p className="text-xs text-ink-3">{u.email}</p></div>,
    },
    { key: "role", header: "Role", sortKey: "role", render: (u) => <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge> },
    { key: "phone", header: "Phone", hideBelow: "md", render: (u) => u.phone ?? "—" },
    { key: "driver", header: "Driver profile", hideBelow: "lg", render: (u) => u.driver?.code ?? "—" },
    {
      key: "status", header: "Status", sortKey: "isActive",
      render: (u) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={u.isActive ? "ACTIVE" : "INACTIVE"} />
          {isLocked(u) && <Badge tone="danger">Locked</Badge>}
        </span>
      ),
    },
    { key: "mfa", header: "Two-factor", hideBelow: "md", render: (u) => (u.mfaEnabled ? <Badge tone="success" dot>On</Badge> : <span className="text-xs text-ink-3">Off</span>) },
    { key: "login", header: "Last sign-in", sortKey: "lastLoginAt", hideBelow: "md", render: (u) => (u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never") },
    { key: "created", header: "Created", sortKey: "createdAt", hideBelow: "xl", render: (u) => formatDate(u.createdAt) },
    {
      key: "actions", header: "", align: "right", className: "w-10",
      render: (u) => (
        <RowActions
          label={`Actions for ${u.name}`}
          actions={[
            { label: "Edit", icon: Pencil, onSelect: () => setForm({ open: true, user: u }) },
            { label: "Reactivate", icon: UserCheck, onSelect: () => reactivate(u), hidden: u.isActive },
            { label: "Create password reset link", icon: KeyRound, onSelect: () => createResetLink(u), hidden: !u.isActive || u.id === me.id, separated: true },
            { label: "Unlock sign-in", icon: LockOpen, onSelect: () => setSecurityAction({ kind: "unlock", user: u }), hidden: !isLocked(u) },
            { label: "Reset two-factor", icon: ShieldOff, onSelect: () => setSecurityAction({ kind: "mfa", user: u }), hidden: !u.mfaEnabled || u.id === me.id },
            { label: "Deactivate", icon: UserX, tone: "danger", separated: true, onSelect: () => setDeactivating(u), hidden: !u.isActive || u.id === me.id },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="User Management"
        description="Create accounts and control what each person can access."
        actions={<Button onClick={() => setForm({ open: true, user: null })}><Plus />Add user</Button>}
      />
      <Card>
        <Toolbar list={list}>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, email, phone…" />
          <FilterSelect label="Roles" value={list.filters.role} onChange={(v) => list.setFilter("role", v)} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          <FilterSelect label="Account status" allLabel="Active and inactive" value={list.filters.active} onChange={(v) => list.setFilter("active", v)} options={[{ value: "yes", label: "Active" }, { value: "no", label: "Inactive" }]} />
        </Toolbar>
        <DataTable
          caption="Users"
          columns={columns}
          rows={data?.items}
          rowKey={(u) => u.id}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onRetry={reload}
          sort={list.sort}
          dir={list.dir}
          onSort={list.toggleSort}
          empty={{ title: "No users match your filters" }}
        />
        {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} noun="users" />}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Roles and permissions" description="Enforced on the server for every page and API request" />
        <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r} className="bg-surface p-4">
              <Badge tone={ROLE_TONE[r]}>{ROLE_LABELS[r]}</Badge>
              <p className="mt-2 text-[13px] text-ink-2">{ROLE_SUMMARY[r]}</p>
              <p className="mt-2 text-xs text-ink-3">{ROLE_PERMISSIONS[r].length} permissions</p>
            </div>
          ))}
        </div>
      </Card>

      <FormDialog
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        title={editing ? `Edit ${editing.name}` : "Add user"}
        description={editing ? "Update the account, role or password." : "Create a login for a team member. For drivers, create the account from the driver profile instead."}
        fields={fields}
        schema={editing ? userUpdateSchema : userCreateSchema}
        initial={{
          name: editing?.name ?? "",
          email: editing?.email ?? "",
          phone: editing?.phone ?? "",
          role: editing?.role ?? "",
          password: "",
          isActive: editing?.isActive ?? true,
        }}
        submitLabel={editing ? "Save changes" : "Create user"}
        successMessage={editing ? "User updated" : "User created"}
        onSubmit={(values) => (editing ? api.put(`/api/users/${editing.id}`, values) : api.post("/api/users", values))}
        onSuccess={reload}
      />
      <Dialog
        open={!!resetLink}
        onOpenChange={(open) => !open && setResetLink(null)}
        title={`Password reset link for ${resetLink?.user.name ?? ""}`}
        description="Give this link to the user directly, in person or through a channel you trust. It works once and is not shown again."
        size="md"
        footer={<Button onClick={() => setResetLink(null)}>Done</Button>}
      >
        {resetLink && (
          <div className="space-y-3">
            <label htmlFor="reset-link" className="text-[13px] font-medium text-ink">One-time link</label>
            <div className="flex gap-2">
              <Input id="reset-link" readOnly value={resetLink.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(resetLink.url);
                  toast.success("Link copied");
                }}
              >
                <Copy />Copy
              </Button>
            </div>
            <p className="text-xs text-ink-3">
              Expires {new Date(resetLink.expiresAt).toLocaleString("en-IN")}. Creating another link cancels this one. Using it signs the user out everywhere;
              two-factor authentication, if on, is still required at the next sign-in.
            </p>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!securityAction}
        onOpenChange={(open) => !open && setSecurityAction(null)}
        title={securityAction?.kind === "mfa" ? `Reset two-factor for ${securityAction.user.name}?` : `Unlock ${securityAction?.user.name ?? ""}?`}
        description={
          securityAction?.kind === "mfa"
            ? "Use this only when the user has lost both their authenticator and their recovery codes, and you have confirmed who they are. Their two-factor authentication and recovery codes are removed and they are signed out everywhere."
            : "The temporary lock after repeated failed sign-ins is lifted now instead of when it expires."
        }
        confirmLabel={securityAction?.kind === "mfa" ? "Reset two-factor" : "Unlock"}
        tone={securityAction?.kind === "mfa" ? "danger" : "primary"}
        loading={busy}
        onConfirm={runSecurityAction}
      />
      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name ?? "user"}?`}
        description="They are signed out immediately and can no longer sign in. Their history stays in the audit log, and the account can be reactivated later."
        confirmLabel="Deactivate"
        loading={busy}
        onConfirm={deactivate}
      />
    </>
  );
}
