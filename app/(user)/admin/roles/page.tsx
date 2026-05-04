"use client";

// /admin/roles — PLA-0007 G3 — roles management UI.
//
// Layout: list (left) + detail (right). System rows are visually
// locked (label/description editable, code/rank/permissions read-only
// per backend ErrSystemRoleImmutable). Tenant rows are full CRUD
// where the actor's permissions allow.
//
// Permission gates are server-side authoritative; the UI hides actions
// the actor lacks (roles.create / roles.update / roles.archive /
// roles.assign_permissions / roles.revoke_permissions). The page itself
// requires roles.list — pages without it redirect to /dashboard.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { api } from "@/app/lib/api";

interface Role {
  id: string;
  subscription_id?: string | null;
  code: string;
  label: string;
  description: string;
  rank: number;
  is_system: boolean;
  is_external: boolean;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface Permission {
  id: string;
  code: string;
  label: string;
  category: string;
  description: string;
}

export default function AdminRolesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const canList = useHasPermission("roles.list");
  const canCreate = useHasPermission("roles.create");
  const canUpdate = useHasPermission("roles.update");
  const canArchive = useHasPermission("roles.archive");
  const canAssign = useHasPermission("roles.assign_permissions");
  const canRevoke = useHasPermission("roles.revoke_permissions");

  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grantedIds, setGrantedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Detail-form draft (label/description/rank). Code + is_external are
  // create-only (cannot be changed post-create per service.go).
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftRank, setDraftRank] = useState(0);

  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newRank, setNewRank] = useState(20);
  const [newIsExternal, setNewIsExternal] = useState(false);

  // Page-level access guard: anyone without roles.list is bounced.
  useEffect(() => {
    if (!user) return;
    if (!canList) router.replace("/dashboard");
  }, [user, canList, router]);

  const refreshRoles = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [r, p] = await Promise.all([
        api<Role[]>("/api/roles/"),
        api<Permission[]>("/api/roles/permissions/catalogue"),
      ]);
      const sorted = [...r].sort((a, b) => {
        if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.label.localeCompare(b.label);
      });
      setRoles(sorted);
      setPerms(p);
      if (!selectedId && sorted.length > 0) setSelectedId(sorted[0].id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (canList) void refreshRoles();
  }, [canList, refreshRoles]);

  const selected = useMemo(
    () => roles.find((r) => r.id === selectedId) ?? null,
    [roles, selectedId],
  );

  // Load granted permission ids when selection changes.
  useEffect(() => {
    if (!selectedId) {
      setGrantedIds(new Set());
      return;
    }
    let cancelled = false;
    api<string[]>(`/api/roles/${selectedId}/permissions`)
      .then((ids) => {
        if (!cancelled) setGrantedIds(new Set(ids));
      })
      .catch(() => {
        if (!cancelled) setGrantedIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Sync draft form to selection.
  useEffect(() => {
    if (!selected) return;
    setDraftLabel(selected.label);
    setDraftDescription(selected.description);
    setDraftRank(selected.rank);
  }, [selected]);

  const dirty = useMemo(() => {
    if (!selected) return false;
    return (
      draftLabel !== selected.label ||
      draftDescription !== selected.description ||
      draftRank !== selected.rank
    );
  }, [selected, draftLabel, draftDescription, draftRank]);

  async function saveDetail() {
    if (!selected || !dirty || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {};
      if (draftLabel !== selected.label) body.label = draftLabel;
      if (draftDescription !== selected.description) body.description = draftDescription;
      // Rank is rejected by service for system rows — only send for tenant.
      if (!selected.is_system && draftRank !== selected.rank) body.rank = draftRank;
      const updated = await api<Role>(`/api/roles/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setRoles((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function archiveRole() {
    if (!selected || selected.is_system || busy) return;
    if (!window.confirm(`Archive role "${selected.label}"?`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/roles/${selected.id}`, { method: "DELETE" });
      setRoles((rs) => rs.filter((r) => r.id !== selected.id));
      setSelectedId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "archive failed");
    } finally {
      setBusy(false);
    }
  }

  async function createRole() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await api<Role>("/api/roles/", {
        method: "POST",
        body: JSON.stringify({
          code: newCode.trim(),
          label: newLabel.trim(),
          description: newDescription.trim(),
          rank: newRank,
          is_external: newIsExternal,
        }),
      });
      setRoles((rs) => [...rs, created].sort((a, b) => {
        if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.label.localeCompare(b.label);
      }));
      setSelectedId(created.id);
      setCreating(false);
      setNewCode("");
      setNewLabel("");
      setNewDescription("");
      setNewRank(20);
      setNewIsExternal(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function togglePermission(permId: string, granted: boolean) {
    if (!selected || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (granted) {
        await api(`/api/roles/${selected.id}/permissions`, {
          method: "DELETE",
          body: JSON.stringify({ permission_ids: [permId] }),
        });
        setGrantedIds((s) => {
          const next = new Set(s);
          next.delete(permId);
          return next;
        });
      } else {
        await api(`/api/roles/${selected.id}/permissions`, {
          method: "POST",
          body: JSON.stringify({ permission_ids: [permId] }),
        });
        setGrantedIds((s) => {
          const next = new Set(s);
          next.add(permId);
          return next;
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "permission update failed");
    } finally {
      setBusy(false);
    }
  }

  const permsByCategory = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of perms) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [perms]);

  if (!user || !canList) return null;

  return (
    <StrictRoute>
      <PageShell
        title="Roles"
        subtitle="Manage system and tenant-custom roles, and the permissions assigned to them"
        actions={
          canCreate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setCreating((v) => !v)}
              disabled={busy}
            >
              {creating ? "Cancel new role" : "+ New role"}
            </button>
          ) : null
        }
      >
        {err && (
          <Panel name="admin_roles_error" title="Error">
            <p className="form__hint">{err}</p>
          </Panel>
        )}

        {creating && canCreate && (
          <Panel name="admin_roles_create" title="New role">
            <div className="form__row">
              <label className="form__label" htmlFor="nr-code">Code</label>
              <input
                id="nr-code"
                className="form__input"
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="e.g. team_lead_finance"
                disabled={busy}
              />
            </div>
            <div className="form__row">
              <label className="form__label" htmlFor="nr-label">Label</label>
              <input
                id="nr-label"
                className="form__input"
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Team Lead — Finance"
                disabled={busy}
              />
            </div>
            <div className="form__row">
              <label className="form__label" htmlFor="nr-desc">Description</label>
              <textarea
                id="nr-desc"
                className="form__textarea"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form__row">
              <label className="form__label" htmlFor="nr-rank">Rank</label>
              <input
                id="nr-rank"
                className="form__input"
                type="number"
                min={11}
                max={89}
                value={newRank}
                onChange={(e) => setNewRank(Number(e.target.value))}
                disabled={busy}
              />
            </div>
            <div className="form__row">
              <label className="form__label">
                <input
                  type="checkbox"
                  checked={newIsExternal}
                  onChange={(e) => setNewIsExternal(e.target.checked)}
                  disabled={busy}
                />{" "}
                External role
              </label>
            </div>
            <div className="form__row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={createRole}
                disabled={busy || !newCode.trim() || !newLabel.trim()}
              >
                Create
              </button>
            </div>
          </Panel>
        )}

        <div className="admin-roles">
          <Panel name="admin_roles_list" title="Roles">
            {loading ? (
              <p className="form__hint">Loading…</p>
            ) : roles.length === 0 ? (
              <p className="form__hint">No roles.</p>
            ) : (
              <ul className="admin-roles__list" role="listbox">
                {roles.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={
                        "admin-roles__list-item" +
                        (r.id === selectedId ? " is-selected" : "")
                      }
                      role="option"
                      aria-selected={r.id === selectedId}
                      onClick={() => setSelectedId(r.id)}
                    >
                      <span className="admin-roles__list-label">{r.label}</span>
                      <span className="admin-roles__list-meta">
                        {r.is_system && <span className="tag tag--muted">system</span>}
                        {r.is_external && <span className="tag tag--warn">external</span>}
                        <span className="admin-roles__list-rank">#{r.rank}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel name="admin_roles_detail" title={selected ? selected.label : "Detail"}>
            {!selected ? (
              <p className="form__hint">Select a role to view details.</p>
            ) : (
              <>
                <div className="form__row">
                  <span className="eyebrow">Code</span>
                  <code className="admin-roles__code">{selected.code}</code>
                </div>
                <div className="form__row">
                  <label className="form__label" htmlFor="rd-label">Label</label>
                  <input
                    id="rd-label"
                    className="form__input"
                    type="text"
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    disabled={busy || !canUpdate}
                  />
                </div>
                <div className="form__row">
                  <label className="form__label" htmlFor="rd-desc">Description</label>
                  <textarea
                    id="rd-desc"
                    className="form__textarea"
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    disabled={busy || !canUpdate}
                  />
                </div>
                <div className="form__row">
                  <label className="form__label" htmlFor="rd-rank">Rank</label>
                  <input
                    id="rd-rank"
                    className="form__input"
                    type="number"
                    min={11}
                    max={89}
                    value={draftRank}
                    onChange={(e) => setDraftRank(Number(e.target.value))}
                    disabled={busy || !canUpdate || selected.is_system}
                  />
                  {selected.is_system && (
                    <p className="form__hint">Rank is locked for system roles.</p>
                  )}
                </div>
                <div className="form__row admin-roles__detail-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={saveDetail}
                    disabled={busy || !canUpdate || !dirty}
                  >
                    Save changes
                  </button>
                  {!selected.is_system && canArchive && (
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={archiveRole}
                      disabled={busy}
                    >
                      Archive role
                    </button>
                  )}
                </div>
              </>
            )}
          </Panel>

          <Panel name="admin_roles_permissions" title="Permissions">
            {!selected ? (
              <p className="form__hint">Select a role to view its permissions.</p>
            ) : selected.is_system ? (
              <>
                <p className="form__hint">
                  System roles have a locked permission grid. The grid below is read-only.
                </p>
                <PermissionGrid
                  groups={permsByCategory}
                  granted={grantedIds}
                  readOnly
                />
              </>
            ) : (
              <PermissionGrid
                groups={permsByCategory}
                granted={grantedIds}
                readOnly={busy || (!canAssign && !canRevoke)}
                onToggle={(id, isGranted) => {
                  if (isGranted && !canRevoke) return;
                  if (!isGranted && !canAssign) return;
                  void togglePermission(id, isGranted);
                }}
              />
            )}
          </Panel>
        </div>
      </PageShell>
    </StrictRoute>
  );
}

function PermissionGrid({
  groups,
  granted,
  readOnly,
  onToggle,
}: {
  groups: Array<[string, Permission[]]>;
  granted: Set<string>;
  readOnly?: boolean;
  onToggle?: (id: string, isGranted: boolean) => void;
}) {
  return (
    <div className="admin-roles__perms">
      {groups.map(([cat, list]) => (
        <div key={cat} className="admin-roles__perms-group">
          <div className="eyebrow">{cat}</div>
          <ul className="admin-roles__perms-list">
            {list.map((p) => {
              const isGranted = granted.has(p.id);
              return (
                <li key={p.id} className="admin-roles__perms-item">
                  <label className="admin-roles__perms-label">
                    <input
                      type="checkbox"
                      checked={isGranted}
                      disabled={readOnly}
                      onChange={() => onToggle?.(p.id, isGranted)}
                    />
                    <span className="admin-roles__perms-text">
                      <span className="admin-roles__perms-title">{p.label}</span>
                      <code className="admin-roles__perms-code">{p.code}</code>
                      {p.description && (
                        <span className="admin-roles__perms-desc">{p.description}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
