"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";
import { DevAccordion, DevAccordionItem } from "@dev/components/DevAccordion";
import Panel from "@/app/components/Panel";

type AdminRow = {
  help_id: string;
  addressable_id: string;
  address: string;
  page_route: string;
  kind: string;
  name: string;
  locale: string;
  body_html: string;
  seeded_from: string | null;
  is_library_default: boolean;
  updated_at: string;
  updated_by_email: string | null;
  helpable: boolean;
};

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function HelpRow({
  row,
  onChanged,
  onArchived,
}: {
  row: AdminRow;
  onChanged: (next: AdminRow) => void;
  onArchived: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.body_html);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [togglingHelpable, setTogglingHelpable] = useState(false);

  async function toggleHelpable(next: boolean) {
    setTogglingHelpable(true);
    setError(null);
    try {
      await api(`/api/addressables/admin/${encodeURIComponent(row.addressable_id)}/helpable`, {
        method: "PATCH",
        body: JSON.stringify({ helpable: next }),
      });
      onChanged({ ...row, helpable: next });
    } catch (e: any) {
      setError(e?.message ?? "Toggle failed.");
    } finally {
      setTogglingHelpable(false);
    }
  }

  function startEdit() {
    setDraft(row.body_html);
    setError(null);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setError(null);
  }
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/page-help/admin/${encodeURIComponent(row.addressable_id)}`, {
        method: "PUT",
        body: JSON.stringify({ body: draft, locale: row.locale }),
      });
      onChanged({
        ...row,
        body_html: draft,
        is_library_default: false,
        seeded_from: "manual",
        updated_at: new Date().toISOString(),
      });
      setEditing(false);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } catch (e: any) {
      setError(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }
  async function archive() {
    setSaving(true);
    setError(null);
    try {
      const url = `/api/page-help/admin/${encodeURIComponent(row.addressable_id)}?locale=${encodeURIComponent(row.locale)}`;
      await api(url, { method: "DELETE" });
      onArchived(row.help_id);
    } catch (e: any) {
      setError(e?.message ?? "Archive failed.");
      setSaving(false);
    }
  }

  const header = (
    <>
      <span className="dev-plan-id">{row.address}</span>
      <span className="dev-plan-meta">
        <span className="dev-plan-dates-strip">
          <span>{row.kind}</span>
          <span>edited {fmtDate(row.updated_at)}</span>
          <span>by {row.updated_by_email ?? "—"}</span>
        </span>
      </span>
      {row.is_library_default && <span className="badge">library default</span>}
      {savedToast && <span className="badge badge-pass">saved</span>}
    </>
  );

  return (
    <DevAccordionItem header={header}>
      {!editing && (
        <div className="dev-plan-body">
          <div className="dev-plan-rich" dangerouslySetInnerHTML={{ __html: row.body_html }} />
          {error && <div className="dev-alert dev-alert--error" style={{ marginTop: 8 }}>{error}</div>}
          <label className="dev-p" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12 }}>
            <input
              type="checkbox"
              checked={row.helpable}
              disabled={togglingHelpable}
              onChange={e => toggleHelpable(e.target.checked)}
            />
            Help icon visible
            {togglingHelpable && <span className="dev-plan-meta">· saving…</span>}
          </label>
          <div className="dev-btn-group" style={{ marginTop: 12 }}>
            <button className="dev-btn dev-btn--primary dev-btn--sm" onClick={startEdit}>Edit</button>
            {!confirmArchive && (
              <button className="dev-btn dev-btn--danger dev-btn--sm" onClick={() => setConfirmArchive(true)} disabled={saving}>
                Archive
              </button>
            )}
            {confirmArchive && (
              <>
                <button className="dev-btn dev-btn--danger dev-btn--sm" onClick={archive} disabled={saving}>
                  {saving ? "Archiving…" : "Confirm archive"}
                </button>
                <button className="dev-btn dev-btn--sm" onClick={() => setConfirmArchive(false)} disabled={saving}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {editing && (
        <div className="dev-plan-body">
          <textarea
            className="dev-research-search"
            style={{ width: "100%", minHeight: 160, fontFamily: "var(--font-mono, monospace)" }}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={saving}
            placeholder="<p>Help body HTML…</p>"
          />
          <div style={{ marginTop: 8 }}>
            <p className="dev-p" style={{ marginBottom: 4, fontWeight: 600 }}>Live preview</p>
            <div className="dev-plan-rich" dangerouslySetInnerHTML={{ __html: draft }} />
          </div>
          {error && <div className="dev-alert dev-alert--error" style={{ marginTop: 8 }}>{error}</div>}
          <div className="dev-btn-group" style={{ marginTop: 12 }}>
            <button className="dev-btn dev-btn--primary dev-btn--sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="dev-btn dev-btn--sm" onClick={cancelEdit} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}
    </DevAccordionItem>
  );
}

export default function DevPageHelpPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<AdminRow[]>("/api/page-help/admin/");
      setRows(data ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load page_help rows.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? rows.filter(r => r.address.toLowerCase().includes(q) || r.page_route.toLowerCase().includes(q))
      : rows;
    const out = new Map<string, AdminRow[]>();
    for (const r of filtered) {
      const list = out.get(r.page_route) ?? [];
      list.push(r);
      out.set(r.page_route, list);
    }
    return Array.from(out.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows, search]);

  if (!user) return null;
  if (user.role.code !== "gadmin") {
    return (
      <div className="dev-research-empty">
        Page Help editor is gadmin-only. Your role: <code>{user.role.code}</code>.
      </div>
    );
  }

  return (
    <Panel name="dev_page_help" title="Page Help">
    <div className="dev-plans-panel">
      <div className="dev-research-header">
        <div>
          <p className="dev-p" style={{ marginBottom: 0 }}>
            Edit the help body shown by the <code>TbHelpHexagon</code> popover on every registered addressable.
            Saved edits flip <code>seeded_from='manual'</code> (the schema's name for editor-authored content);
            future library churn will not retro-apply.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="dev-btn dev-btn--sm">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="dev-research-toolbar">
        <input
          type="search"
          className="dev-research-search"
          placeholder="Search by address or page_route…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="dev-alert dev-alert--error">{error}</div>}

      {!loading && rows.length === 0 && !error && (
        <div className="dev-research-empty">
          No page_help rows. Register addressables via build-reconcile first.
        </div>
      )}

      {grouped.map(([route, list]) => (
        <section key={route} className="dev-section">
          <h3 className="dev-h3"><code>{route}</code> <span className="dev-plan-meta">· {list.length} row{list.length === 1 ? "" : "s"}</span></h3>
          <DevAccordion>
            {list.map(r => (
              <HelpRow
                key={r.help_id}
                row={r}
                onChanged={next => setRows(prev => prev.map(x => x.help_id === next.help_id ? next : x))}
                onArchived={id => setRows(prev => prev.filter(x => x.help_id !== id))}
              />
            ))}
          </DevAccordion>
        </section>
      ))}

      {!loading && grouped.length === 0 && rows.length > 0 && (
        <div className="dev-research-empty">
          No rows match &ldquo;<em>{search}</em>&rdquo;.
        </div>
      )}
    </div>
    </Panel>
  );
}
