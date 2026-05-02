"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";
import { DevAccordion, DevAccordionItem } from "@dev/components/DevAccordion";

type AdminRow = {
  paneId: string;
  body_html: string;
  updated_at: string;
  updated_by_email: string | null;
};

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function PaneRow({ row, onSaved }: { row: AdminRow; onSaved: (next: AdminRow) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.body_html);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

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
      await api(`/api/pane-help/${encodeURIComponent(row.paneId)}`, {
        method: "PUT",
        body: JSON.stringify({ body: draft }),
      });
      const next: AdminRow = {
        ...row,
        body_html: draft,
        updated_at: new Date().toISOString(),
      };
      onSaved(next);
      setEditing(false);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } catch (e: any) {
      setError(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <>
      <span className="dev-plan-id">{row.paneId}</span>
      <span className="dev-plan-meta">
        <span className="dev-plan-dates-strip">
          <span>edited {fmtDate(row.updated_at)}</span>
          <span>by {row.updated_by_email ?? "—"}</span>
        </span>
      </span>
      {savedToast && <span className="badge badge-pass">saved</span>}
    </>
  );

  return (
    <DevAccordionItem header={header}>
      {!editing && (
        <div className="dev-plan-body">
          <div className="dev-plan-rich" dangerouslySetInnerHTML={{ __html: row.body_html }} />
          <div className="dev-btn-group" style={{ marginTop: 12 }}>
            <button className="dev-btn dev-btn--primary dev-btn--sm" onClick={startEdit}>Edit</button>
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

export default function DevPaneHelpPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<AdminRow[]>("/api/pane-help/admin");
      setRows(data ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pane help rows.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (!user) return null;
  if (user.role !== "gadmin") {
    return (
      <div className="dev-research-empty">
        Pane Help editor is gadmin-only. Your role: <code>{user.role}</code>.
      </div>
    );
  }

  const q = search.toLowerCase();
  const filtered = q ? rows.filter(r => r.paneId.toLowerCase().includes(q)) : rows;

  return (
    <div className="dev-plans-panel">
      <div className="dev-research-header">
        <div>
          <p className="dev-p" style={{ marginBottom: 0 }}>
            Edit the help body shown by the <code>TbHelpHexagon</code> popover on every <code>&lt;PaneHeader&gt;</code>.
            Saved edits bust the server cache and are visible on the next bulk fetch from any page.
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
          placeholder="Search by paneId…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="dev-alert dev-alert--error">{error}</div>}

      {!loading && rows.length === 0 && !error && (
        <div className="dev-research-empty">
          No pane_help rows. Run migration <code>071_pane_help.sql</code>.
        </div>
      )}

      {filtered.length > 0 && (
        <DevAccordion>
          {filtered.map(r => (
            <PaneRow
              key={r.paneId}
              row={r}
              onSaved={next => setRows(prev => prev.map(x => x.paneId === next.paneId ? next : x))}
            />
          ))}
        </DevAccordion>
      )}

      {!loading && filtered.length === 0 && rows.length > 0 && (
        <div className="dev-research-empty">
          No paneIds match &ldquo;<em>{search}</em>&rdquo;.
        </div>
      )}
    </div>
  );
}
