"use client";

// Phase 2 PoC: Work Items v2 - hits vector_artefacts directly via
// /api/v2/* route handlers. No Go backend involvement.
//
// Visible 'PoC' marker so anyone landing on this page knows they're not on
// the production work-items view at /work-items.

import { useCallback, useEffect, useMemo, useState } from "react";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";

interface ArtefactType {
  id: string;
  scope: "work" | "strategy";
  source: "system" | "tenant";
  name: string;
  prefix: string;
  parent_type_id: string | null;
  sort_order: number;
}

interface WorkItem {
  id: string;
  number: number;
  title: string;
  description: string | null;
  position: number;
  type_name: string;
  type_prefix: string;
  state_name: string | null;
  state_kind: "todo" | "in_progress" | "done" | "cancelled" | null;
  parent_artefact_id: string | null;
  created_at: string;
  updated_at: string;
}

const KIND_VARIANT: Record<NonNullable<WorkItem["state_kind"]>, "neutral" | "info" | "success" | "danger"> = {
  todo:        "neutral",
  in_progress: "info",
  done:        "success",
  cancelled:   "danger",
};

export default function WorkItemsV2Page() {
  const [types, setTypes] = useState<ArtefactType[]>([]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ artefact_type_id: "", title: "" });
  const [saving, setSaving] = useState(false);
  const [archiveArmed, setArchiveArmed] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const workTypes = useMemo(() => types.filter((t) => t.scope === "work"), [types]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tRes, iRes] = await Promise.all([
        fetch("/api/v2/artefact-types").then((r) => r.json()),
        fetch("/api/v2/work-items").then((r) => r.json()),
      ]);
      if (tRes.error) throw new Error(tRes.error);
      if (iRes.error) throw new Error(iRes.error);
      setTypes(tRes.items as ArtefactType[]);
      setItems(iRes.items as WorkItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Default the type selector to the first work type once they're loaded.
  useEffect(() => {
    if (!draft.artefact_type_id && workTypes.length > 0) {
      setDraft((d) => ({ ...d, artefact_type_id: workTypes[0].id }));
    }
  }, [workTypes, draft.artefact_type_id]);

  async function createItem() {
    if (!draft.artefact_type_id || !draft.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v2/work-items", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          artefact_type_id: draft.artefact_type_id,
          title:            draft.title.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDraft((d) => ({ ...d, title: "" }));
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  async function renameItem(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const res = await fetch(`/api/v2/work-items/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename");
    }
  }

  async function archiveItem(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/v2/work-items/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setArchiveArmed(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive");
    }
  }

  return (
    <>
      <header style={{ marginBottom: "16px" }}>
        <h1 className="page-title">Work Items (v2)</h1>
        <p className="page-subtitle">
          Phase 2 PoC against vector_artefacts. Single fixture subscription.
        </p>
      </header>
      <div className="form__row form__row--inline" style={{ alignItems: "center" }}>
        <span className="pill pill--warning">Vector Artefacts · PoC</span>
        <span className="form__hint">
          This page reads/writes the new <code>vector_artefacts</code> database
          directly. Production <a href="/work-items">/work-items</a> is unaffected.
        </span>
      </div>

      <Panel name="work_items_v2_list" title="Work items">
        {error && <p className="form__error">{error}</p>}

        <div className="settings-panel__header">
          <h3 className="eyebrow">All work items in PoC subscription</h3>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => setShowCreate((v) => !v)}
            disabled={workTypes.length === 0}
          >
            {showCreate ? "Cancel" : "+ New work item"}
          </button>
        </div>

        {showCreate && (
          <div className="form__row">
            <label className="form__label">
              Type
              <select
                className="form__select"
                value={draft.artefact_type_id}
                onChange={(e) => setDraft((d) => ({ ...d, artefact_type_id: e.target.value }))}
              >
                {workTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.prefix} · {t.name}</option>
                ))}
              </select>
            </label>
            <label className="form__label" style={{ flex: 1 }}>
              Title
              <input
                type="text"
                className="form__input"
                placeholder="Add a payments retry handler"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") void createItem(); }}
              />
            </label>
            <div className="form__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={createItem}
                disabled={saving || !draft.title.trim()}
              >
                {saving ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="form__hint">Loading…</p>
        ) : items.length === 0 ? (
          <div className="empty-state">
            No work items yet. Create the first one above.
          </div>
        ) : (
          <Table<WorkItem>
            pageId="work-items-v2"
            slot="list"
            ariaLabel="Work items in PoC subscription"
            rows={items}
            rowKey={(r) => r.id}
            columns={[
              { key: "id", header: "ID", width: 110,
                kind: "custom",
                render: (r) => <code className="form__hint">{r.type_prefix}-{r.number}</code>,
              },
              { key: "type",  header: "Type", width: 120,
                kind: "pill",
                pillVariant: () => "neutral",
                pillLabel: (r) => r.type_name,
              },
              { key: "title", header: "Title",
                kind: "custom",
                render: (r) => editingId === r.id ? (
                  <input
                    type="text"
                    className="form__input"
                    autoFocus
                    defaultValue={r.title}
                    onBlur={(e) => void renameItem(r.id, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void renameItem(r.id, e.currentTarget.value);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ justifyContent: "flex-start", textAlign: "left", width: "100%" }}
                    onClick={() => setEditingId(r.id)}
                  >
                    {r.title}
                  </button>
                ),
              },
              { key: "state", header: "State", width: 140,
                kind: "pill",
                pillVariant: (r) => r.state_kind ? KIND_VARIANT[r.state_kind] : "neutral",
                pillLabel: (r) => r.state_name ?? "—",
              },
              { key: "actions", header: "", width: 180,
                kind: "custom",
                render: (r) => archiveArmed === r.id ? (
                  <span className="form__actions form__actions--inline">
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => archiveItem(r.id)}
                    >
                      Confirm archive
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setArchiveArmed(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setArchiveArmed(r.id)}
                  >
                    Archive
                  </button>
                ),
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}
