"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import ToggleBtn from "@/app/components/ToggleBtn";
import UserNodeAssignment from "@/app/components/topology/UserNodeAssignment";
import { useHasPermission } from "@/app/contexts/AuthContext";
import { apiSite as api, ApiError } from "@/app/lib/api";
import { topologyApi, listGrantsByUser, type MyGrant, type OrgNode } from "@/app/lib/topologyApi";
import { costCentresApi, type CostCentre } from "@/app/lib/costCentresApi";
import { Modal, type AdminUser, type AdminUserRole, type RoleSummary } from "@/app/(user)/_shared";

type PageSize = "all" | 10 | 25 | 50 | 100;

// B20.4.5 — topology access section inside the inline edit-row panel.
// Replaces the previous standalone /user-management/{id}/topology-
// permissions page. The previous component hard-coded role="admin"
// when granting; this version exposes a default-role select
// (viewer/editor/admin) at the section header so the operator picks
// the intended role before ticking nodes.
//
// Server-side: each toggle hits the topology service directly
// (POST /topology/nodes/{nodeId}/roles to grant, DELETE
// /topology/roles/{grant_id} to revoke). Both endpoints are gated
// behind topology.grants.manage_others on the backend, which the
// host UserEditPanel already gates the section's visibility on —
// but the backend re-checks per call (server-side-first per the
// SERVER IS THE GATE hard rule), so deep-linking or stale UI cannot
// bypass.
//
// Optimistic mutation pattern mirrors the previous standalone page:
// flip the grants array, fire the network call, refetch on grant
// to bind the real grant_id. On error, revert.
function TopologyAccessSection({
  userId,
}: {
  userId: string;
}) {
  type TopologyRole = "viewer" | "editor" | "admin";
  const [tree,        setTree]        = useState<OrgNode[] | null>(null);
  const [grants,      setGrants]      = useState<MyGrant[] | null>(null);
  const [collapsed,   setCollapsed]   = useState<Set<string>>(new Set());
  const [defaultRole, setDefaultRole] = useState<TopologyRole>("viewer");
  const [loadErr,     setLoadErr]     = useState<string | null>(null);
  const [mutErr,      setMutErr]      = useState<string | null>(null);

  const selectedNodeIds = useMemo<Set<string>>(
    () => new Set((grants ?? []).map((g) => g.node_id)),
    [grants],
  );

  const reloadGrants = useCallback(async () => {
    const next = await listGrantsByUser(userId);
    setGrants(next);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setLoadErr(null);
    Promise.all([topologyApi.tree(), listGrantsByUser(userId)])
      .then(([treeRows, grantRows]) => {
        if (cancelled) return;
        setTree(treeRows);
        setGrants(grantRows);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadErr(
          err instanceof ApiError
            ? `Error ${err.status}: ${String(err.body ?? "")}`
            : "Failed to load topology access.",
        );
      });
    return () => { cancelled = true; };
  }, [userId]);

  const handleToggle = useCallback(
    async (nodeId: string, nextSelected: boolean) => {
      setMutErr(null);
      const prev = grants ?? [];

      if (nextSelected) {
        const placeholder: MyGrant = {
          grant_id: `optimistic-${nodeId}`,
          node_id: nodeId,
          workspace_id: "",
          parent_id: null,
          name: "",
          label_override: null,
          colour: null,
          icon: null,
          role: defaultRole,
          granted_at: new Date().toISOString(),
          position: 0,
        };
        setGrants([...prev, placeholder]);
        try {
          await topologyApi.grantRole(nodeId, userId, defaultRole, false);
          await reloadGrants();
        } catch (err) {
          setGrants(prev);
          setMutErr(
            err instanceof ApiError
              ? `Grant failed (Error ${err.status}): ${String(err.body ?? "")}`
              : "Grant failed.",
          );
        }
        return;
      }

      const target = prev.find((g) => g.node_id === nodeId);
      if (!target) {
        setMutErr("Cannot revoke — no matching grant on record.");
        return;
      }
      setGrants(prev.filter((g) => g.node_id !== nodeId));
      try {
        await topologyApi.revokeRole(target.grant_id);
      } catch (err) {
        setGrants(prev);
        setMutErr(
          err instanceof ApiError
            ? `Revoke failed (Error ${err.status}): ${String(err.body ?? "")}`
            : "Revoke failed.",
        );
      }
    },
    [grants, userId, defaultRole, reloadGrants],
  );

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <>
      <div className="users-edit-panel__topology_header">
        <label className="form__label form__label--inline">
          <span>Default role for new grants:</span>
          <select
            className="form__select form__select--sm"
            value={defaultRole}
            onChange={(e) => setDefaultRole(e.target.value as TopologyRole)}
            aria-label="Default role for new topology grants"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <span className="form__hint">
          Ticking a node grants this role. Untick to revoke. Existing
          grants keep their original role; the picker shows the granted
          subset only — change role by untick → re-tick.
        </span>
      </div>

      {loadErr && <div className="form__error">{loadErr}</div>}
      {mutErr  && <div className="form__error">{mutErr}</div>}

      {tree && grants ? (
        <UserNodeAssignment
          tree={tree}
          selectedNodeIds={selectedNodeIds}
          onToggle={handleToggle}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      ) : (
        !loadErr && <p className="form__hint">Loading topology…</p>
      )}
    </>
  );
}

// B20.4.8 — inline edit-row panel restructured into 4 sections:
// Account Information / Display Preferences / Settings / Administrative
// Fields. Field-to-section mapping follows the plan doc spec
// (context/plans/USERS-CONSOLIDATION.md). All fields are optional on
// the wire — the panel sends only changed fields in the PATCH body
// (Partial<AdminUser> shape).
type EditPatch = Partial<{
  role: AdminUserRole;
  is_active: boolean;
  first_name: string;
  last_name: string;
  department: string;
  middle_name: string;
  display_name: string;
  phone_work: string;
  phone_mobile: string;
  timezone: string;
  date_format: string;
  datetime_format: string;
  email_notifications_enabled: boolean;
  password_reset_required: boolean;
  cost_centre_id: string;
  office_location_id: string;
}>;

function UserEditPanel({
  u,
  onSave,
  onIssueReset,
  onDelete,
}: {
  u: AdminUser;
  onSave: (id: string, patch: EditPatch) => Promise<void>;
  onIssueReset: (id: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  // Account Information
  const [firstName,    setFirstName]    = useState(u.first_name ?? "");
  const [middleName,   setMiddleName]   = useState(u.middle_name ?? "");
  const [lastName,     setLastName]     = useState(u.last_name ?? "");
  const [department,   setDepartment]   = useState(u.department ?? "");
  const [phoneWork,    setPhoneWork]    = useState(u.phone_work ?? "");
  const [phoneMobile,  setPhoneMobile]  = useState(u.phone_mobile ?? "");
  const [role,         setRole]         = useState<AdminUserRole>(u.role);
  const [isActive,     setIsActive]     = useState(u.is_active);
  // Display Preferences
  const [displayName,  setDisplayName]  = useState(u.display_name ?? "");
  // Settings
  const [timezone,         setTimezone]         = useState(u.timezone ?? "");
  const [dateFormat,       setDateFormat]       = useState(u.date_format ?? "");
  const [datetimeFormat,   setDatetimeFormat]   = useState(u.datetime_format ?? "");
  const [emailNotif,       setEmailNotif]       = useState(u.email_notifications_enabled ?? true);
  // Administrative Fields (stub UUID fields; rendered as plain inputs
  // until B20.4.3 / B20.4.7 land the cost-centre / office-location
  // typeaheads). ldap_dn is read-only — surfaced as "Network ID" per
  // spec but the column itself stays auth-managed.
  const [costCentreId,     setCostCentreId]     = useState(u.cost_centre_id ?? "");
  const [officeLocId,      setOfficeLocId]      = useState(u.office_location_id ?? "");

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

  // Cost-centre dropdown options (B20.4.3).
  const [costCentres, setCostCentres] = useState<CostCentre[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<RoleSummary[]>("/roles/creatable")
      .then((rows) => { if (!cancelled) setCreatable(rows); })
      .catch(() => { if (!cancelled) setCreatable([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    costCentresApi.list()
      .then((rows) => { if (!cancelled) setCostCentres(rows); })
      .catch(() => { if (!cancelled) setCostCentres([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setFirstName(u.first_name ?? "");
    setMiddleName(u.middle_name ?? "");
    setLastName(u.last_name ?? "");
    setDepartment(u.department ?? "");
    setPhoneWork(u.phone_work ?? "");
    setPhoneMobile(u.phone_mobile ?? "");
    setRole(u.role);
    setIsActive(u.is_active);
    setDisplayName(u.display_name ?? "");
    setTimezone(u.timezone ?? "");
    setDateFormat(u.date_format ?? "");
    setDatetimeFormat(u.datetime_format ?? "");
    setEmailNotif(u.email_notifications_enabled ?? true);
    setCostCentreId(u.cost_centre_id ?? "");
    setOfficeLocId(u.office_location_id ?? "");
  }, [u]);

  const roleOptions = useMemo<RoleSummary[]>(() => {
    const list = [...(creatable ?? [])];
    if (!list.some((r) => r.code === u.role)) {
      list.unshift({ id: `current-${u.role}`, code: u.role, label: u.role, is_external: false, is_system: true, rank: 0 });
    }
    return list;
  }, [creatable, u.role]);

  // Build the sparse patch: only include fields that actually changed.
  // The Update handler in the backend is field-by-field sparse, so we
  // don't send unchanged fields and the server doesn't update them.
  const buildPatch = useCallback((): EditPatch => {
    const p: EditPatch = {};
    if (firstName       !== (u.first_name ?? ""))                 p.first_name = firstName;
    if (middleName      !== (u.middle_name ?? ""))                p.middle_name = middleName;
    if (lastName        !== (u.last_name ?? ""))                  p.last_name = lastName;
    if (department      !== (u.department ?? ""))                 p.department = department;
    if (phoneWork       !== (u.phone_work ?? ""))                 p.phone_work = phoneWork;
    if (phoneMobile     !== (u.phone_mobile ?? ""))               p.phone_mobile = phoneMobile;
    if (role            !== u.role)                               p.role = role;
    if (isActive        !== u.is_active)                          p.is_active = isActive;
    if (displayName     !== (u.display_name ?? ""))               p.display_name = displayName;
    if (timezone        !== (u.timezone ?? ""))                   p.timezone = timezone;
    if (dateFormat      !== (u.date_format ?? ""))                p.date_format = dateFormat;
    if (datetimeFormat  !== (u.datetime_format ?? ""))            p.datetime_format = datetimeFormat;
    if (emailNotif      !== (u.email_notifications_enabled ?? true)) p.email_notifications_enabled = emailNotif;
    if (costCentreId    !== (u.cost_centre_id ?? ""))             p.cost_centre_id = costCentreId;
    if (officeLocId     !== (u.office_location_id ?? ""))         p.office_location_id = officeLocId;
    return p;
  }, [u, firstName, middleName, lastName, department, phoneWork, phoneMobile, role, isActive,
      displayName, timezone, dateFormat, datetimeFormat, emailNotif, costCentreId, officeLocId]);

  const dirty = Object.keys(buildPatch()).length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      await onSave(u.id, buildPatch());
      setInfo("Changes saved.");
    } catch (e) {
      // E.164 phone validation surfaces as 400 phone.invalid_e164 —
      // worth a friendlier message than the raw error.
      if (e instanceof ApiError && e.status === 400 && String(e.body ?? "").includes("phone.invalid_e164")) {
        setErr("Phone numbers must be in E.164 format (e.g. +447700900123).");
      } else {
        setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Save failed");
      }
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

  // Compact section header — same .users-edit-panel__section_header
  // CSS pack used across the four blocks. Sub-component to avoid
  // repetition.
  const SectionHeader = ({ children }: { children: React.ReactNode }) => (
    <div className="users-edit-panel__section_header">{children}</div>
  );

  return (
    <div className="users-edit-panel">
      <form className="form" onSubmit={onSubmit}>
        {/* ── Account Information ─────────────────────────────────── */}
        <SectionHeader>Account Information</SectionHeader>
        <div className="form__grid">
          <label className="form__label">
            First name
            <input type="text" className="form__input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="form__label">
            Middle name
            <input type="text" className="form__input" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
          </label>
          <label className="form__label">
            Last name
            <input type="text" className="form__input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
          <label className="form__label">
            Email
            <input type="email" className="form__input" value={u.email} disabled />
            <span className="form__hint">Email cannot be changed from this panel.</span>
          </label>
          <label className="form__label">
            Department
            <input type="text" className="form__input" value={department} onChange={(e) => setDepartment(e.target.value)} />
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
          <label className="form__label">
            Phone (work)
            <input
              type="tel"
              className="form__input"
              placeholder="+447700900123"
              value={phoneWork}
              onChange={(e) => setPhoneWork(e.target.value)}
            />
            <span className="form__hint">E.164 format only (leading +, country code, digits).</span>
          </label>
          <label className="form__label">
            Phone (mobile)
            <input
              type="tel"
              className="form__input"
              placeholder="+447700900123"
              value={phoneMobile}
              onChange={(e) => setPhoneMobile(e.target.value)}
            />
          </label>
        </div>

        {/* ── Display Preferences ─────────────────────────────────── */}
        <SectionHeader>Display Preferences</SectionHeader>
        <div className="form__grid">
          <label className="form__label">
            Display name
            <input type="text" className="form__input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <span className="form__hint">Name shown to other users (e.g. mentions, comments).</span>
          </label>
          {/* Profile image upload deferred to B20.4.9 */}
        </div>

        {/* ── Settings ────────────────────────────────────────────── */}
        <SectionHeader>Settings</SectionHeader>
        <div className="form__grid">
          <label className="form__label">
            Timezone
            <input
              type="text"
              className="form__input"
              placeholder="Europe/London"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
            <span className="form__hint">Inherits the workspace default when blank.</span>
          </label>
          <label className="form__label">
            Date format
            <input
              type="text"
              className="form__input"
              placeholder="YYYY-MM-DD"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
            />
          </label>
          <label className="form__label">
            Date & time format
            <input
              type="text"
              className="form__input"
              placeholder="YYYY-MM-DD HH:mm"
              value={datetimeFormat}
              onChange={(e) => setDatetimeFormat(e.target.value)}
            />
          </label>
          <label className="form__label form__label--inline">
            <input
              type="checkbox"
              checked={emailNotif}
              onChange={(e) => setEmailNotif(e.target.checked)}
            />
            <span>Email notifications enabled</span>
          </label>
          {u.password_changed_at != null && (
            <label className="form__label">
              Password last changed
              <input
                type="text"
                className="form__input"
                value={new Date(u.password_changed_at).toLocaleString()}
                disabled
              />
            </label>
          )}
        </div>

        {/* ── Administrative Fields ───────────────────────────────── */}
        <SectionHeader>Administrative Fields</SectionHeader>
        <div className="form__grid">
          <label className="form__label">
            Network ID
            <input
              type="text"
              className="form__input"
              value={u.ldap_dn ?? ""}
              disabled
            />
            <span className="form__hint">LDAP/AD bind DN; auth-managed (set during SSO bind, not editable here).</span>
          </label>
          <label className="form__label">
            Cost centre
            <select
              className="form__select"
              value={costCentreId}
              onChange={(e) => setCostCentreId(e.target.value)}
              disabled={costCentres == null}
            >
              <option value="">(none)</option>
              {(costCentres ?? []).map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.code} — {cc.name}
                </option>
              ))}
            </select>
            <span className="form__hint">Manage the catalogue at <code>/workspace-admin/cost-centres</code> (gadmin only).</span>
          </label>
          <label className="form__label">
            Office location
            <input
              type="text"
              className="form__input"
              placeholder="(UUID until B20.4.7 lands the picker)"
              value={officeLocId}
              onChange={(e) => setOfficeLocId(e.target.value)}
            />
            <span className="form__hint">Vector-admin-managed list; deferred.</span>
          </label>
        </div>

        {/* ── Topology Access (B20.4.5) ─────────────────────────── */}
        {hasManageGrants && (
          <>
            <SectionHeader>Topology Access</SectionHeader>
            <TopologyAccessSection userId={u.id} />
          </>
        )}

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
            {/* B20.4.5 — "Manage topology permissions" link removed;
                topology access now lives inline as a section above
                in the same panel, replacing the standalone route. */}
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

  // Accepts the full B20.4 EditPatch shape (extended profile + stub
  // FKs); the server's PATCH /admin/users/{id} is field-by-field
  // sparse so unchanged fields aren't touched. Wider type than the
  // pre-B20.4 callsite — keeps the body opaque-pass-through so new
  // panel sections can extend the patch without re-typing this fn.
  async function patchUser(id: string, patch: EditPatch) {
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
      <PageDescription title="Users">
        <p className="form__hint">
          Create and manage user accounts, assign roles, and control workspace access.
          Click a row to edit a user inline. Use the New User button to invite new
          accounts; the system emails a one-time reset link to the address you enter.
        </p>
      </PageDescription>
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
            // B20.4.6 — Password-reset-flag column. Renders a flag
            // icon when the server says password_reset_required=true.
            // Read-only here; the set/clear UI is deferred to a
            // future story. When the field is absent from the wire
            // payload (caller lacks users.admin.view) the column
            // renders blank — that's the server-side gate doing its
            // job, not a missing render.
            {
              key: "password_reset",
              header: "Password reset",
              width: 130,
              kind: "custom",
              render: (u) =>
                u.password_reset_required ? (
                  <span
                    className="pill pill--warning"
                    title="Marked for password reset on next login"
                    aria-label="Password reset required"
                  >
                    reset due
                  </span>
                ) : (
                  <span aria-hidden>—</span>
                ),
            },
            // B20.4.10 — Disabled rendered as a read-only checkbox
            // (Rally pattern). The actual toggle action lives in the
            // inline edit-row panel below; surfacing it as a clickable
            // toggle on the list invited accidental disables. The
            // checkbox is `disabled` so it cannot be edited from the
            // row — that's the whole point of the read-only treatment.
            {
              key: "disabled",
              header: "Disabled",
              width: 110,
              kind: "custom",
              render: (u) => (
                <input
                  type="checkbox"
                  checked={!u.is_active}
                  disabled
                  aria-label={u.is_active ? "Active" : "Disabled"}
                  // Hand cursor would mislead — keep default.
                />
              ),
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
