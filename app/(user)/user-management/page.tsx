"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import ToggleBtn from "@/app/components/ToggleBtn";
import { useHasPermission } from "@/app/contexts/AuthContext";
import { apiSite as api, ApiError } from "@/app/lib/api";
import { Modal, type AdminUser, type AdminUserRole, type RoleSummary } from "@/app/(user)/workspace-settings/_shared";

type PageSize = "all" | 10 | 25 | 50 | 100;

function UserEditPanel({
  u,
  onSave,
  onIssueReset,
  onDelete,
}: {
  u: AdminUser;
  onSave: (id: string, patch: Partial<{ role: AdminUserRole; is_active: boolean; first_name: string; last_name: string; department: string }>) => Promise<void>;
  onIssueReset: (id: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [firstName,   setFirstName]   = useState(u.first_name ?? "");
  const [lastName,    setLastName]    = useState(u.last_name ?? "");
  const [department,  setDepartment]  = useState(u.department ?? "");
  const [role,        setRole]        = useState<AdminUserRole>(u.role);
  const [isActive,    setIsActive]    = useState(u.is_active);
  const [removeBusy,  setRemoveBusy]  = useState(false);
  const [creatable,   setCreatable]   = useState<RoleSummary[] | null>(null);
  const [busy,        setBusy]        = useState(false);
  const [resetBusy,   setResetBusy]   = useState(false);
  const [err,         setErr]         = useState<string | null>(null);
  const [info,        setInfo]        = useState<string | null>(null);
  // PLA-0046 / story 00556 — gates the "Manage topology permissions"
  // entry button. Gadmin only; the per-user page also re-checks so
  // direct deep-links still surface the in-page Forbidden panel.
  const hasManageGrants = useHasPermission("topology.grants.manage_others");

  useEffect(() => {
    let cancelled = false;
    api<RoleSummary[]>("/roles/creatable")
      .then((rows) => { if (!cancelled) setCreatable(rows); })
      .catch(() => { if (!cancelled) setCreatable([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setFirstName(u.first_name ?? "");
    setLastName(u.last_name ?? "");
    setDepartment(u.department ?? "");
    setRole(u.role);
    setIsActive(u.is_active);
  }, [u.id, u.first_name, u.last_name, u.department, u.role, u.is_active]);

  const roleOptions = useMemo<RoleSummary[]>(() => {
    const list = [...(creatable ?? [])];
    if (!list.some((r) => r.code === u.role)) {
      list.unshift({ id: `current-${u.role}`, code: u.role, label: u.role, is_external: false, is_system: true, rank: 0 });
    }
    return list;
  }, [creatable, u.role]);

  const dirty =
    firstName  !== (u.first_name  ?? "") ||
    lastName   !== (u.last_name   ?? "") ||
    department !== (u.department  ?? "") ||
    role       !== u.role ||
    isActive   !== u.is_active;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      await onSave(u.id, { first_name: firstName, last_name: lastName, department, role, is_active: isActive });
      setInfo("Changes saved.");
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    setErr(null);
    setInfo(null);
    setResetBusy(true);
    try {
      await onIssueReset(u.id);
      setInfo(`Password reset link sent to ${u.email}.`);
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Reset failed");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="users-edit-panel">
      <form className="form" onSubmit={onSubmit}>
        <div className="form__grid">
          <label className="form__label">
            First name
            <input type="text" className="form__input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="form__label">
            Last name
            <input type="text" className="form__input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
          <label className="form__label">
            Department
            <input type="text" className="form__input" value={department} onChange={(e) => setDepartment(e.target.value)} />
          </label>
          <label className="form__label">
            Email
            <input type="email" className="form__input" value={u.email} disabled />
            <span className="form__hint">Email cannot be changed from this panel.</span>
          </label>
          <label className="form__label">
            Role
            <select className="form__select" value={role} onChange={(e) => setRole(e.target.value)} disabled={creatable === null}>
              {roleOptions.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.label}{r.is_external ? " (external)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {err  && <div className="form__error">{err}</div>}
        {info && <div className="form__info">{info}</div>}

        <div className="users-edit-panel__actions">
          <div className="users-edit-panel__actions-left">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={sendReset}
              disabled={resetBusy || busy}
              title="Generate a password reset link and email it to the user's registered address."
            >
              {resetBusy ? "Sending…" : "Send password reset"}
            </button>
            {hasManageGrants && (
              <Link
                href={`/user-management/${u.id}/topology-permissions`}
                className="btn btn--secondary"
              >
                Manage topology permissions
              </Link>
            )}
          </div>
          <div className="users-edit-panel__actions-right">
            {isActive !== u.is_active && (
              <span className="users-edit-panel__state-confirm-msg" role="status" aria-live="polite">
                {isActive
                  ? "Make this user account active? Click Confirm changes to apply."
                  : "Disable this user account? Click Confirm changes to apply."}
              </span>
            )}
            <span className="users-edit-panel__state" aria-label="Account state">
              <ToggleBtn value={!isActive} onChange={(v) => setIsActive(!v)} labels={["Active", "Inactive"]} />
            </span>
            <button
              type="button"
              className="btn btn--danger users-edit-panel__remove-btn"
              onClick={async () => {
                if (removeBusy) return;
                setRemoveBusy(true);
                setErr(null);
                try {
                  await onDelete();
                } catch (e) {
                  setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Remove failed");
                } finally {
                  setRemoveBusy(false);
                }
              }}
              disabled={busy || resetBusy || removeBusy}
            >
              {removeBusy ? "Removing…" : "Remove user"}
            </button>
            <button type="submit" className="btn btn--primary" disabled={!dirty || busy}>
              {busy ? "Saving…" : "Confirm changes"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (email: string, resetUrl: string) => void;
}) {
  const [email,     setEmail]     = useState("");
  const [role,      setRole]      = useState<AdminUserRole>("");
  const [creatable, setCreatable] = useState<RoleSummary[] | null>(null);
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<RoleSummary[]>("/roles/creatable")
      .then((rows) => {
        if (cancelled) return;
        setCreatable(rows);
        const def = [...rows].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0];
        if (def) setRole(def.code);
      })
      .catch(() => { if (!cancelled) setCreatable([]); });
    return () => { cancelled = true; };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const resp = await api<{ user: AdminUser; reset_url?: string }>("/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      onCreated(resp.user.email, resp.reset_url ?? "");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErr("That email is already registered.");
      else setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  const noRoles = creatable !== null && creatable.length === 0;

  return (
    <Modal onClose={onClose} title="New user">
      <form onSubmit={onSubmit} className="form">
        <label className="form__label">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="form__input"
            autoFocus
          />
        </label>
        <label className="form__label">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)} className="form__select" disabled={creatable === null || noRoles}>
            {creatable === null && <option value="">Loading…</option>}
            {noRoles && <option value="">No assignable roles</option>}
            {(creatable ?? []).map((r) => (
              <option key={r.id} value={r.code}>
                {r.label}{r.is_external ? " (external)" : ""}
              </option>
            ))}
          </select>
        </label>
        {err && <div className="form__error">{err}</div>}
        <div className="modal__actions">
          <button type="button" onClick={onClose} className="btn btn--secondary" disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || creatable === null || noRoles || !role}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetLinkModal({ email, url, onClose }: { email: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }
  return (
    <Modal onClose={onClose} title="Password reset link">
      <div className="u-stack">
        <p className="auth-card__subtitle">
          A reset link was generated and emailed to <strong>{email}</strong>. The link expires in 1 hour.
          You can also copy it below and send it to them directly.
        </p>
        <code className="code-block">{url || "(no link — EMAIL_MODE is not console)"}</code>
        <div className="modal__actions">
          <button type="button" onClick={onClose} className="btn btn--secondary">Close</button>
          <button type="button" onClick={copy} className="btn btn--primary" disabled={!url}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function UsersPage() {
  const { full } = usePageTitle();
  const [users,        setUsers]        = useState<AdminUser[] | null>(null);
  const [visibleRoles, setVisibleRoles] = useState<RoleSummary[] | null>(null);
  const [err,          setErr]          = useState<string | null>(null);
  const [showCreate,   setShowCreate]   = useState(false);
  const [resetUrl,     setResetUrl]     = useState<{ email: string; url: string } | null>(null);

  const [search,       setSearch]       = useState("");
  const [deptFilter,   setDeptFilter]   = useState<string>("");
  const [roleFilter,   setRoleFilter]   = useState<"" | AdminUserRole>("");
  const [externalOnly, setExternalOnly] = useState(false);
  const [pageSize,     setPageSize]     = useState<PageSize>(25);
  const [page,         setPage]         = useState(1);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [data, roles] = await Promise.all([
        api<AdminUser[]>("/admin/users"),
        api<RoleSummary[]>("/roles/"),
      ]);
      setUsers(data);
      setVisibleRoles(roles);
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Failed to load");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const roleByCode = useMemo(() => {
    const m = new Map<string, RoleSummary>();
    for (const r of visibleRoles ?? []) m.set(r.code, r);
    return m;
  }, [visibleRoles]);

  const departments = useMemo(() => {
    if (!users) return [];
    const set = new Set<string>();
    for (const u of users) {
      const d = (u.department ?? "").trim();
      if (d) set.add(d);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [users]);

  const filtered = useMemo(() => {
    if (!users) return null;
    const q = search.trim().toLowerCase();
    return [...users]
      .filter((u) => {
        if (deptFilter && (u.department ?? "") !== deptFilter) return false;
        if (roleFilter && u.role !== roleFilter) return false;
        if (externalOnly && !roleByCode.get(u.role)?.is_external) return false;
        if (!q) return true;
        const hay = [u.email, u.first_name ?? "", u.last_name ?? "", u.department ?? "", u.role].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const an = (a.last_name ?? "").localeCompare(b.last_name ?? "");
        if (an !== 0) return an;
        return a.email.localeCompare(b.email);
      });
  }, [users, search, deptFilter, roleFilter, externalOnly, roleByCode]);

  useEffect(() => { setPage(1); }, [search, deptFilter, roleFilter, externalOnly, pageSize]);

  const total      = filtered?.length ?? 0;
  const sizeNumber = pageSize === "all" ? Math.max(total, 1) : pageSize;
  const pageCount  = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / sizeNumber));
  const safePage   = Math.min(page, pageCount);

  async function patchUser(id: string, patch: Partial<{
    role: AdminUserRole; is_active: boolean;
    first_name: string; last_name: string; department: string;
  }>) {
    await api(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await load();
  }

  async function issueReset(id: string) {
    const resp = await api<{ email: string; reset_url?: string }>(
      `/admin/users/${id}/password-reset`,
      { method: "POST" },
    );
    setResetUrl({ email: resp.email, url: resp.reset_url ?? "" });
  }

  async function deleteUser(id: string) {
    await api(`/admin/users/${id}`, { method: "DELETE" });
    await load();
  }

  const paginationConfig =
    pageSize === "all" || total <= pageSize
      ? undefined
      : { pageSize, page: safePage - 1, onPageChange: (n: number) => setPage(n + 1) };

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Manage workspace users, roles, and access settings." />
      <Panel
        name="panel_user_management_header"
        className="page-panel-heading"
        title="User Management"
        description="Create and manage user accounts, assign roles, and control workspace access."
      />
    <div>
      {err && <div className="form__error">{err}</div>}

      {filtered && (
        <Table<AdminUser>
          pageId="workspace-settings"
          slot="users"
          ariaLabel="Users"
          rows={filtered}
          rowKey={(u) => u.id}
          empty="No users match the current filters."
          expandable={{
            renderPanel: (u) => (
              <UserEditPanel
                u={u}
                onSave={patchUser}
                onIssueReset={issueReset}
                onDelete={() => deleteUser(u.id)}
              />
            ),
            canExpand: () => true,
          }}
          pagination={paginationConfig}
          toolbar={{
            search: {
              value: search,
              onChange: setSearch,
              placeholder: "Search name, email, department…",
            },
            filters: [
              {
                key: "department",
                label: "Department",
                value: deptFilter,
                onChange: setDeptFilter,
                options: [
                  { value: "", label: "All departments" },
                  ...departments.map((d) => ({ value: d, label: d })),
                ],
              },
              {
                key: "role",
                label: "Role",
                value: roleFilter,
                onChange: (v) => setRoleFilter(v as "" | AdminUserRole),
                options: [
                  { value: "", label: "All roles" },
                  ...(visibleRoles ?? []).map((r) => ({
                    value: r.code,
                    label: `${r.label}${r.is_external ? " (external)" : ""}`,
                  })),
                ],
              },
            ],
            meta: filtered ? `${total} user${total === 1 ? "" : "s"}` : "Loading…",
            actions: (
              <>
                <label
                  className="form__label form__label--inline"
                  title="Show only users on roles flagged is_external"
                >
                  <input
                    type="checkbox"
                    checked={externalOnly}
                    onChange={(e) => setExternalOnly(e.target.checked)}
                  />
                  <span>External only</span>
                </label>
                <select
                  className="form__select form__select--sm"
                  value={String(pageSize)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPageSize(v === "all" ? "all" : (Number(v) as PageSize));
                  }}
                  aria-label="Page size"
                >
                  <option value="all">All</option>
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
                <button onClick={() => setShowCreate(true)} className="btn btn--primary">
                  + New user
                </button>
              </>
            ),
          }}
          columns={[
            { key: "expander", width: 40, kind: "expander" },
            {
              key: "last_name",
              header: "Last name",
              width: 160,
              kind: "custom",
              render: (u) => u.last_name ?? <span>—</span>,
            },
            {
              key: "first_name",
              header: "First name",
              width: 160,
              kind: "custom",
              render: (u) => u.first_name ?? <span>—</span>,
            },
            {
              key: "email",
              header: "Email",
              kind: "custom",
              render: (u) => (
                <div className="u-row u-row--gap-2">
                  <span>{u.email}</span>
                  {roleByCode.get(u.role)?.is_external && (
                    <span className="pill pill--neutral" title="Role is flagged external (e.g. partner / contractor)">
                      external
                    </span>
                  )}
                  {u.force_password_change && (
                    <span className="pill pill--warning" title="Must change password on next login">
                      pending pw
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "department",
              header: "Department",
              width: 200,
              kind: "custom",
              render: (u) => u.department ?? <span>—</span>,
            },
            {
              key: "status",
              header: "Status",
              width: 110,
              kind: "pill",
              pillVariant: (u) => (u.is_active ? "success" : "neutral"),
              pillLabel: (u) => (u.is_active ? "Active" : "Inactive"),
            },
          ]}
        />
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(email, url) => {
            setResetUrl({ email, url });
            setShowCreate(false);
            load();
          }}
        />
      )}

      {resetUrl && (
        <ResetLinkModal
          email={resetUrl.email}
          url={resetUrl.url}
          onClose={() => setResetUrl(null)}
        />
      )}
    </div>
    </PageContent>
  );
}
