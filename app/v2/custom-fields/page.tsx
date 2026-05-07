"use client";

// Phase 2 PoC: Custom Fields v2 — workspace-wide field library.
// PLA-0026 / Story 00510 (F4): GET list switched from /api/v2/field-library
// (direct DB via Next.js route) to the Go-backed /api/workspace/:id/fields.
// Writes (create/rename/archive) still go through /api/v2/field-library
// until a Go CRUD surface ships.
//
// Visible 'PoC' marker so anyone landing on this page knows they're not
// on the production custom-fields surface.

import { useCallback, useEffect, useState } from "react";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { getWorkspaceFields, type WorkspaceField } from "@/app/lib/fieldsApi";

// POC_WORKSPACE_ID mirrors the fixture in app/lib/v2/db.ts — both must
// stay in sync until the PoC surfaces are retired.
const POC_WORKSPACE_ID = "00000000-0000-0000-0000-000000000002";

const FIELD_TYPES = [
  "textbox", "richtext", "integer", "decimal", "date", "boolean",
  "select", "multiselect", "radio", "user", "url",
] as const;
type FieldType = typeof FIELD_TYPES[number];

export default function CustomFieldsV2Page() {
  const [items, setItems] = useState<WorkspaceField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ label: "", field_type: "textbox" as FieldType });
  const [saving, setSaving] = useState(false);
  const [archiveArmed, setArchiveArmed] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const fields = await getWorkspaceFields(POC_WORKSPACE_ID);
      setItems(fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createItem() {
    if (!draft.label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v2/field-library", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          label:      draft.label.trim(),
          field_type: draft.field_type,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDraft({ label: "", field_type: "textbox" });
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  async function renameItem(id: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const res = await fetch(`/api/v2/field-library/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ label: trimmed }),
      });
      const body = (await res.json()) as { error?: string };
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
      const res = await fetch(`/api/v2/field-library/${id}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
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
        <h1 className="page-title">Custom Fields (v2)</h1>
        <p className="page-subtitle">
          Phase 2 PoC against vector_artefacts — workspace-wide field library.
          Read path: Go-backed /api/workspace/:id/fields (F4). Write path: /api/v2/field-library (PoC only, until Go CRUD ships).
        </p>
      </header>
      <div className="form__row form__row--inline" style={{ alignItems: "center" }}>
        <span className="pill pill--warning">Vector Artefacts · PoC</span>
        <span className="form__hint">
          This page reads/writes the new <code>vector_artefacts</code> database
          directly. Production custom-fields surface is unaffected.
        </span>
      </div>

      <Panel name="custom_fields_v2_list" title="Field library">
        {error && <p className="form__error">{error}</p>}

        <div className="settings-panel__header">
          <h3 className="eyebrow">Field library in PoC subscription</h3>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? "Cancel" : "+ New field"}
          </button>
        </div>

        {showCreate && (
          <div className="form__row">
            <label className="form__label" style={{ flex: 1 }}>
              Label
              <input
                type="text"
                className="form__input"
                placeholder="Severity"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") void createItem(); }}
              />
            </label>
            <label className="form__label">
              Type
              <select
                className="form__select"
                value={draft.field_type}
                onChange={(e) => setDraft((d) => ({ ...d, field_type: e.target.value as FieldType }))}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <div className="form__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={createItem}
                disabled={saving || !draft.label.trim()}
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
            No custom fields yet. Create the first one above.
          </div>
        ) : (
          <Table<WorkspaceField>
            pageId="custom-fields-v2"
            slot="list"
            ariaLabel="Custom fields in PoC subscription"
            rows={items}
            rowKey={(r) => r.id}
            columns={[
              { key: "label", header: "Label",
                kind: "custom",
                render: (r) => editingId === r.id ? (
                  <input
                    type="text"
                    className="form__input"
                    autoFocus
                    defaultValue={r.label}
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
                    {r.label}
                  </button>
                ),
              },
              { key: "name", header: "Slug", width: 200,
                kind: "custom",
                render: (r) => <code className="form__hint">{r.name}</code>,
              },
              { key: "data_type", header: "Type", width: 140,
                kind: "pill",
                pillVariant: () => "neutral",
                pillLabel: (r) => r.data_type,
              },
              { key: "scope", header: "Scope", width: 110,
                kind: "pill",
                pillVariant: () => "neutral",
                pillLabel: (r) => r.scope,
              },
              { key: "actions", header: "", width: 160,
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
