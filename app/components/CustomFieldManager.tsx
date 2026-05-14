"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Table from "@/app/components/Table";

// ─── Types (mirror BFF wire shapes — see /api/dev/field-library) ─────────────

export interface FieldLibraryEntry {
  id: string;
  field_name: string;
  label: string;
  field_type: string;
  description: string | null;
  options_json: unknown;
  config_json: unknown;
  adoption_count: number;
  created_at: string;
  updated_at: string;
}

export interface ArtefactType {
  id: string;
  scope: "work" | "strategy";
  source: "system" | "tenant";
  name: string;
  prefix: string;
  parent_type_id: string | null;
  sort_order: number;
}

export interface ArtefactTypeBinding {
  id: string;
  field_library_id: string;
  field_name: string;
  label: string;
  field_type: string;
  options_json: unknown;
  position: number;
  required: boolean;
  default_value: string | null;
}

const FIELD_TYPES = [
  "textbox", "richtext", "integer", "decimal",
  "date", "boolean", "select", "multiselect",
  "radio", "user", "url",
] as const;

const NEEDS_OPTIONS = new Set<string>(["select", "multiselect", "radio"]);

// Map the parent page's itemType key to the artefact_type prefix seeded in the
// vector_artefacts schema (see db/vector_artefacts/schema/010_seed_system_artefact_types.sql
// and 027_seed_defect_field_library.sql).
const ITEM_TYPE_TO_PREFIX: Record<string, string> = {
  epic:   "EP",
  story:  "US",
  task:   "TA",
  defect: "DE",
};

// ─── BFF helpers ─────────────────────────────────────────────────────────────

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error)
      : `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return data as T;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface CustomFieldManagerProps {
  /** Parent itemType key — "epic" | "story" | "task" | "defect". */
  itemType: string;
  /** Display label used in headings (e.g. "Story", "Task"). */
  itemTypeLabel: string;
  /** Stable address slot for the embedded <Table> primitives. */
  pageId: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CustomFieldManager({ itemType, itemTypeLabel, pageId }: CustomFieldManagerProps) {
  const [library, setLibrary] = useState<FieldLibraryEntry[]>([]);
  const [bindings, setBindings] = useState<ArtefactTypeBinding[]>([]);
  const [artefactTypeId, setArtefactTypeId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newField, setNewField] = useState({
    field_name:   "",
    label:        "",
    field_type:   "textbox",
    options_json: "",
  });
  const [saving, setSaving] = useState(false);
  const [archiveArmed, setArchiveArmed] = useState<string | null>(null);

  // Bootstrap: resolve artefact_type_id for the prefix, then load library + bindings.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const prefix = ITEM_TYPE_TO_PREFIX[itemType];
    if (!prefix) {
      setError(`Unknown item type "${itemType}".`);
      setLoading(false);
      return;
    }

    try {
      const typesRes = await bff<{ items: ArtefactType[] }>("/api/dev/artefact-types");
      const match = typesRes.items.find((t) => t.prefix === prefix);
      if (!match) {
        setError(`No artefact type with prefix "${prefix}" exists in this subscription.`);
        setLoading(false);
        return;
      }
      setArtefactTypeId(match.id);

      const [libRes, bindRes] = await Promise.all([
        bff<{ items: FieldLibraryEntry[] }>("/api/dev/field-library"),
        bff<{ items: ArtefactTypeBinding[] }>(`/api/dev/artefact-types/${match.id}/fields`),
      ]);
      setLibrary(libRes.items);
      setBindings(bindRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load custom fields.");
    } finally {
      setLoading(false);
    }
  }, [itemType]);

  useEffect(() => { load(); }, [load]);

  // ─── Library: create + archive ──────────────────────────────────────────────

  async function createLibraryField() {
    if (!newField.label.trim()) return;
    if (NEEDS_OPTIONS.has(newField.field_type) && !newField.options_json.trim()) {
      setError(`Type "${newField.field_type}" requires options JSON.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        label:      newField.label.trim(),
        field_type: newField.field_type,
      };
      if (newField.field_name.trim()) body.field_name = newField.field_name.trim();
      if (newField.options_json.trim()) body.options_json = newField.options_json.trim();

      await bff("/api/dev/field-library", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNewField({ field_name: "", label: "", field_type: "textbox", options_json: "" });
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create field.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveLibraryField(id: string) {
    try {
      await bff(`/api/dev/field-library/${id}`, { method: "DELETE" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive field.");
      return;
    } finally {
      setArchiveArmed(null);
    }
    await load();
  }

  // ─── Bindings: bind + unbind ──────────────────────────────────────────────

  async function bindField(fieldLibraryId: string) {
    if (!artefactTypeId) return;
    try {
      await bff(`/api/dev/artefact-types/${artefactTypeId}/fields`, {
        method: "POST",
        body: JSON.stringify({
          field_library_id: fieldLibraryId,
          position:         bindings.length,
          required:         false,
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add field.");
      return;
    }
    await load();
  }

  async function unbindField(fieldLibraryId: string) {
    if (!artefactTypeId) return;
    try {
      await bff(`/api/dev/artefact-types/${artefactTypeId}/fields/${fieldLibraryId}`, {
        method: "DELETE",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove field.");
      return;
    }
    await load();
  }

  // Library entries not yet bound to this artefact type.
  const available = useMemo(() => {
    const used = new Set(bindings.map((b) => b.field_library_id));
    return library.filter((f) => !used.has(f.id));
  }, [library, bindings]);

  if (loading) {
    return <p className="form__hint">Loading custom fields…</p>;
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel__header">
        <h3 className="eyebrow">Custom fields — {itemTypeLabel}</h3>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Cancel" : "+ New field"}
        </button>
      </div>

      {error && <p className="form__error">{error}</p>}

      {showCreate && (
        <div className="form__row">
          <label className="form__label">
            Label
            <input
              type="text"
              className="form__input"
              placeholder="e.g. Acceptance Criteria"
              value={newField.label}
              onChange={(e) => setNewField((f) => ({ ...f, label: e.target.value }))}
            />
          </label>
          <label className="form__label">
            Field name (slug — optional, derived from label if blank)
            <input
              type="text"
              className="form__input"
              placeholder="e.g. acceptance_criteria"
              value={newField.field_name}
              onChange={(e) => setNewField((f) => ({ ...f, field_name: e.target.value }))}
            />
          </label>
          <label className="form__label">
            Type
            <select
              className="form__select"
              value={newField.field_type}
              onChange={(e) => setNewField((f) => ({ ...f, field_type: e.target.value }))}
            >
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {NEEDS_OPTIONS.has(newField.field_type) && (
            <label className="form__label">
              Options JSON
              <input
                type="text"
                className="form__input"
                placeholder='["option1","option2"]'
                value={newField.options_json}
                onChange={(e) => setNewField((f) => ({ ...f, options_json: e.target.value }))}
              />
            </label>
          )}
          <div className="form__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={createLibraryField}
              disabled={saving}
            >
              {saving ? "Saving…" : "Create field"}
            </button>
          </div>
        </div>
      )}

      {bindings.length === 0 ? (
        <div className="empty-state">
          No fields configured yet for {itemTypeLabel}. Add one from the library, or create a new field above.
        </div>
      ) : (
        <Table<ArtefactTypeBinding>
          pageId={pageId}
          slot={`type_fields__${itemType}`}
          ariaLabel={`Custom fields for ${itemTypeLabel}`}
          rows={[...bindings].sort((a, b) => a.position - b.position)}
          rowKey={(f) => f.id}
          columns={[
            { key: "position", header: "Pos", width: 60, kind: "numeric" },
            { key: "label",    header: "Label" },
            { key: "field_name", header: "Slug",
              kind: "custom",
              render: (f) => <code className="form__hint">{f.field_name}</code>,
            },
            { key: "field_type", header: "Type", width: 130,
              kind: "pill",
              pillVariant: () => "neutral",
              pillLabel: (f) => f.field_type,
            },
            { key: "required", header: "Required", width: 110,
              kind: "custom",
              render: (f) => f.required
                ? <span className="pill pill--warning pill--sm">required</span>
                : <span className="form__hint">optional</span>,
            },
            { key: "actions", header: "", width: 110,
              kind: "custom",
              render: (f) => (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => unbindField(f.field_library_id)}
                >
                  Remove
                </button>
              ),
            },
          ]}
        />
      )}

      {available.length > 0 && (
        <div className="form__row form__row--inline">
          <span className="form__label form__label--inline">Add from library:</span>
          <select
            className="form__select form__select--sm"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) {
                bindField(id);
                e.target.value = "";
              }
            }}
          >
            <option value="">Select…</option>
            {available.map((f) => (
              <option key={f.id} value={f.id}>{f.label} ({f.field_type})</option>
            ))}
          </select>
        </div>
      )}

      {library.length > 0 && (
        <details className="settings-panel__details">
          <summary className="eyebrow">Workspace field library ({library.length})</summary>
          <Table<FieldLibraryEntry>
            pageId={pageId}
            slot={`field_library__${itemType}`}
            ariaLabel="Workspace custom field library"
            rows={library}
            rowKey={(f) => f.id}
            columns={[
              { key: "label", header: "Label" },
              { key: "field_name", header: "Slug",
                kind: "custom",
                render: (f) => <code className="form__hint">{f.field_name}</code>,
              },
              { key: "field_type", header: "Type", width: 130,
                kind: "pill",
                pillVariant: () => "neutral",
                pillLabel: (f) => f.field_type,
              },
              { key: "adoption_count", header: "Adopted by", width: 110, kind: "numeric" },
              { key: "created_at", header: "Created", width: 140,
                kind: "custom",
                render: (f) => new Date(f.created_at).toLocaleDateString(),
              },
              { key: "actions", header: "", width: 180,
                kind: "custom",
                render: (f) => archiveArmed === f.id ? (
                  <span className="form__actions form__actions--inline">
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => archiveLibraryField(f.id)}
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
                    className="btn btn--ghost btn--sm btn--danger"
                    onClick={() => setArchiveArmed(f.id)}
                    disabled={f.adoption_count > 0}
                    title={f.adoption_count > 0 ? "Unbind from all artefact types first" : undefined}
                  >
                    Archive
                  </button>
                ),
              },
            ]}
          />
        </details>
      )}
    </div>
  );
}
