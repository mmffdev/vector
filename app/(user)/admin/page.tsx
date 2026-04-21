"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import { useAuth, type Role } from "@/app/contexts/AuthContext";
import { api, ApiError } from "@/app/lib/api";

interface AdminUser {
  id: string;
  tenant_id: string;
  email: string;
  role: Role;
  is_active: boolean;
  last_login: string | null;
  force_password_change: boolean;
  created_at: string;
}

type Tab = "users" | "permissions";

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("users");

  useEffect(() => {
    if (user && user.role === "user") router.replace("/dashboard");
  }, [user, router]);

  if (!user || user.role === "user") return null;
  const isGadmin = user.role === "gadmin";

  return (
    <PageShell title="Settings" subtitle="User management and system configuration">
      <div className="tabs">
        <TabButton active={tab === "users"} onClick={() => setTab("users")}>
          Users
        </TabButton>
        <TabButton active={tab === "permissions"} onClick={() => setTab("permissions")}>
          Permissions
        </TabButton>
      </div>
      {tab === "users" && <UsersTab isGadmin={isGadmin} />}
      {tab === "permissions" && <PermissionsTab />}
    </PageShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls = active ? "tabs__tab tabs__tab--active" : "tabs__tab";
  return (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

// ---------- Users tab ----------

function UsersTab({ isGadmin }: { isGadmin: boolean }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUrl, setResetUrl] = useState<{ email: string; url: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await api<AdminUser[]>("/api/admin/users");
      setUsers(data);
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function updateUser(id: string, patch: { role?: Role; is_active?: boolean }) {
    setPendingId(id);
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Update failed");
    } finally {
      setPendingId(null);
    }
  }

  const sorted = useMemo(
    () => (users ? [...users].sort((a, b) => a.email.localeCompare(b.email)) : null),
    [users]
  );

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar__meta">
          {sorted ? `${sorted.length} user${sorted.length === 1 ? "" : "s"}` : "Loading…"}
        </div>
        {isGadmin && (
          <button onClick={() => setShowCreate(true)} className="btn btn--primary">
            + New user
          </button>
        )}
      </div>

      {err && <div className="form__error">{err}</div>}

      {sorted && (
        <div className="table-wrap">
          <table className="table">
            <thead className="table__head">
              <tr className="table__row">
                <th className="table__cell">Email</th>
                <th className="table__cell">Role</th>
                <th className="table__cell">Active</th>
                <th className="table__cell">Last login</th>
                <th className="table__cell">Created</th>
                <th className="table__cell"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id} className="table__row">
                  <td className="table__cell">
                    {u.email}
                    {u.force_password_change && (
                      <span className="tag" title="Must change password on next login">
                        pending pw
                      </span>
                    )}
                  </td>
                  <td className="table__cell">
                    {isGadmin ? (
                      <select
                        value={u.role}
                        disabled={pendingId === u.id}
                        onChange={(e) => updateUser(u.id, { role: e.target.value as Role })}
                        className="form__select form__select--sm"
                      >
                        <option value="user">user</option>
                        <option value="padmin">padmin</option>
                        <option value="gadmin">gadmin</option>
                      </select>
                    ) : (
                      <span className="u-mono">{u.role}</span>
                    )}
                  </td>
                  <td className="table__cell">
                    {isGadmin ? (
                      <label className="form__switch">
                        <input
                          type="checkbox"
                          checked={u.is_active}
                          disabled={pendingId === u.id}
                          onChange={(e) => updateUser(u.id, { is_active: e.target.checked })}
                        />
                        {u.is_active ? "active" : "inactive"}
                      </label>
                    ) : (
                      <span>{u.is_active ? "active" : "inactive"}</span>
                    )}
                  </td>
                  <td className="table__cell">{fmtDate(u.last_login)}</td>
                  <td className="table__cell">{fmtDate(u.created_at)}</td>
                  <td className="table__cell"></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

      {resetUrl && <ResetLinkModal email={resetUrl.email} url={resetUrl.url} onClose={() => setResetUrl(null)} />}
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
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const resp = await api<{ user: AdminUser; reset_url?: string }>("/api/admin/users", {
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
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="form__select"
          >
            <option value="user">user</option>
            <option value="padmin">padmin</option>
            <option value="gadmin">gadmin</option>
          </select>
        </label>
        {err && <div className="form__error">{err}</div>}
        <div className="modal__actions">
          <button type="button" onClick={onClose} className="btn btn--secondary" disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
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
    } catch {
      // ignore
    }
  }
  return (
    <Modal onClose={onClose} title="User created">
      <div className="u-stack">
        <p className="auth-card__subtitle">
          <strong>{email}</strong> was created with a temporary password and must set their own via the link below.
          Copy it and send it to them — it expires in 1 hour.
        </p>
        <code className="code-block">{url || "(no link — EMAIL_MODE is not console)"}</code>
        <div className="modal__actions">
          <button type="button" onClick={onClose} className="btn btn--secondary">
            Close
          </button>
          <button type="button" onClick={copy} className="btn btn--primary" disabled={!url}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Permissions tab ----------

function PermissionsTab() {
  return (
    <div className="placeholder">
      <h3 className="placeholder__title">Permissions</h3>
      <p className="placeholder__body">
        Project-level permissions will appear here once the projects module is live. The backend grid is already wired
        (<code>/api/admin/permissions</code>), so enabling this tab is a UI-only change later.
      </p>
    </div>
  );
}

// ---------- Modal primitive ----------

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button onClick={onClose} className="modal__close" aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

// ---------- helpers ----------

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
