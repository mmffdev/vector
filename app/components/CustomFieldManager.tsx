"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Table from "@/app/components/Table";
import { api } from "@/app/lib/api";

// ─── Types (mirror backend wire shapes) ──────────────────────────────────────

export interface CustomField {
  id: string;
  field_name: string;
  label: string;
  type: string;
  options_json: string | null;
  config_json?: string | null;
  created_at: string;
}

export interface TemplateField {
  id: string;
  field_library_id: string;
  field_name: string;
  label: string;
  field_type: string;
  position: number;
  required: boolean;
  default_value: string | null;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  item_type: string | null;
  fields: TemplateField[];
  created_at: string;
}

const FIELD_TYPES = [
  "textbox", "richtext", "integer", "decimal",
  "date", "boolean", "select", "multiselect",
  "radio", "user", "url",
] as const;

const NEEDS_OPTIONS = new Set(["select", "multiselect", "radio"]);

// ─── Props ───────────────────────────────────────────────────────────────────

export interface CustomFieldManagerProps {
  /** Filters templates and seeds a default template name (e.g. "story", "task"). */
  itemType: string;
  /** Display label used in the auto-created template name (e.g. "Story", "Task"). */
  itemTypeLabel: string;
  /** Stable address slot for the embedded <Table> primitives. */
  pageId: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CustomFieldManager({ itemType, itemTypeLabel, pageId }: CustomFieldManagerProps) {
  const [library, setLibrary]   = useState<CustomField[]>([]);
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newField, setNewField] = useState({ field_name: "", label: "", type: "textbox", options_json: "" });
  const [saving, setSaving]     = useState(false);
  const [archiveArmed, setArchiveArmed] = useState<string | null>(null);

  // Bootstrap: load library + first template for itemType (or create one).
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [libRes, tmplRes] = await Promise.all([
        api<{ items: CustomField[] }>("/api/custom-field-library"),
        api<{ items: Template[] }>("/api/work-item-templates"),
      ]);
      setLibrary(libRes.items);

      const matching = tmplRes.items.find((t) => t.item_type === itemType);
      if (matching) {
        setTemplate(matching);
      } else {
        const created = await api<Template>("/api/work-item-templates", {
          method: "POST",
          body: JSON.stringify({
            name:        `${itemTypeLabel} fields`,
            description: `Custom fields shown on every ${itemType}.`,
            item_type:   itemType,
          }),
        });
        setTemplate({ ...created, fields: created.fields ?? [] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load custom fields.");
    } finally {
      setLoading(false);
    }
  }, [itemType, itemTypeLabel]);

  useEffect(() => { load(); }, [load]);

  // ─── Library: create + archive ──────────────────────────────────────────────

  async function createLibraryField() {
    if (!newField.field_name.trim() || !newField.label.trim()) return;
    if (NEEDS_OPTIONS.has(newField.type) && !newField.options_json.trim()) {
      setError(`Type "${newField.type}" requires options JSON.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        field_name: newField.field_name.trim(),
        label:      newField.label.trim(),
        type:       newField.type,
      };
      if (newField.options_json.trim()) body.options_json = newField.options_json.trim();
      await api("/api/custom-field-library", { method: "POST", body: JSON.stringify(body) });
      setNewField({ field_name: "", label: "", type: "textbox", options_json: "" });
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create field.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveLibraryField(id: string) {
    await api(`/api/custom-field-library/${id}`, { method: "DELETE" });
    setArchiveArmed(null);
    await load();
  }

  // ─── Template slots: add + remove ──────────────────────────────────────────

  async function addToTemplate(fieldLibraryId: string) {
    if (!template) return;
    await api(`/api/work-item-templates/${template.id}/fields`, {
      method: "POST",
      body: JSON.stringify({
        field_library_id: fieldLibraryId,
        position:         template.fields.length,
        required:         false,
      }),
    });
    await load();
  }

  async function removeFromTemplate(fieldLibraryId: string) {
    if (!template) return;
    await api(`/api/work-item-templates/${template.id}/fields/${fieldLibraryId}`, {
      method: "DELETE",
    });
    await load();
  }

  // Library entries not yet in this template.
  const available = useMemo(() => {
    if (!template) return [];
    const used = new Set(template.fields.map((f) => f.field_library_id));
    return library.filter((f) => !used.has(f.id));
  }, [library, template]);

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
            Field name (slug)
            <input
              type="text"
              className="form__input"
              placeholder="e.g. environment"
              value={newField.field_name}
              onChange={(e) => setNewField((f) => ({ ...f, field_name: e.target.value }))}
            />
          </label>
          <label className="form__label">
            Label
            <input
              type="text"
              className="form__input"
              placeholder="e.g. Environment"
              value={newField.label}
              onChange={(e) => setNewField((f) => ({ ...f, label: e.target.value }))}
            />
          </label>
          <label className="form__label">
            Type
            <select
              className="form__select"
              value={newField.type}
              onChange={(e) => setNewField((f) => ({ ...f, type: e.target.value }))}
            >
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {NEEDS_OPTIONS.has(newField.type) && (
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

      {template && template.fields.length === 0 ? (
        <div className="empty-state">
          No fields configured yet for {itemTypeLabel}. Add one from the library, or create a new field above.
        </div>
      ) : (
        template && (
          <Table<TemplateField>
            pageId={pageId}
            slot={`template_fields__${itemType}`}
            ariaLabel={`Custom fields for ${itemTypeLabel}`}
            rows={[...template.fields].sort((a, b) => a.position - b.position)}
            rowKey={(f) => f.id}
            columns={[
              { key: "position", header: "Pos",   width: 60,  kind: "numeric" },
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
                    onClick={() => removeFromTemplate(f.field_library_id)}
                  >
                    Remove
                  </button>
                ),
              },
            ]}
          />
        )
      )}

      {template && available.length > 0 && (
        <div className="form__row form__row--inline">
          <span className="form__label form__label--inline">Add from library:</span>
          <select
            className="form__select form__select--sm"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) {
                addToTemplate(id);
                e.target.value = "";
              }
            }}
          >
            <option value="">Select…</option>
            {available.map((f) => (
              <option key={f.id} value={f.id}>{f.label} ({f.type})</option>
            ))}
          </select>
        </div>
      )}

      {library.length > 0 && (
        <details className="settings-panel__details">
          <summary className="eyebrow">Workspace field library ({library.length})</summary>
          <Table<CustomField>
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
              { key: "type", header: "Type", width: 130,
                kind: "pill",
                pillVariant: () => "neutral",
                pillLabel: (f) => f.type,
              },
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
