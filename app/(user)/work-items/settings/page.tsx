"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { api } from "@/app/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomField {
  id: string;
  field_name: string;
  label: string;
  type: string;
  options_json: string | null;
  created_at: string;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  item_type: string | null;
  fields: TemplateField[];
  created_at: string;
}

interface TemplateField {
  id: string;
  field_library_id: string;
  field_name: string;
  label: string;
  field_type: string;
  position: number;
  required: boolean;
  default_value: string | null;
}

const FIELD_TYPES = [
  "textbox", "richtext", "integer", "decimal",
  "date", "boolean", "select", "multiselect",
  "radio", "user", "url",
];

// ─── Custom Field Library Tab ─────────────────────────────────────────────────

function CustomFieldLibrary() {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newField, setNewField] = useState({ field_name: "", label: "", type: "textbox", options_json: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ items: CustomField[] }>("/custom-field-library")
      .then((r) => setFields(r.items))
      .catch(() => setFields([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!newField.field_name.trim() || !newField.label.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        field_name: newField.field_name.trim(),
        label: newField.label.trim(),
        type: newField.type,
      };
      if (newField.options_json.trim()) body.options_json = newField.options_json.trim();
      await api("/custom-field-library", { method: "POST", body: JSON.stringify(body) });
      setNewField({ field_name: "", label: "", type: "textbox", options_json: "" });
      setCreating(false);
      load();
    } catch {
      // surface inline if needed
    } finally {
      setSaving(false);
    }
  }

  async function archive(id: string) {
    if (!confirm("Archive this field? It will be hidden from new items.")) return;
    await api(`/custom-field-library/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="wi-settings">
      <div className="wi-settings__row-end">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? "Cancel" : "New field"}
        </button>
      </div>

      {creating && (
        <div className="wi-settings__form-card">
          <div className="wi-settings__grid-3">
            <label className="wi-settings__label">
              Field name (slug)
              <input
                type="text"
                className="backlog-filter__search wi-settings__field-input"
                placeholder="e.g. environment"
                value={newField.field_name}
                onChange={(e) => setNewField((f) => ({ ...f, field_name: e.target.value }))}
              />
            </label>
            <label className="wi-settings__label">
              Label
              <input
                type="text"
                className="backlog-filter__search wi-settings__field-input"
                placeholder="e.g. Environment"
                value={newField.label}
                onChange={(e) => setNewField((f) => ({ ...f, label: e.target.value }))}
              />
            </label>
            <label className="wi-settings__label">
              Type
              <select
                className="btn btn--ghost btn--sm wi-settings__field-input"
                value={newField.type}
                onChange={(e) => setNewField((f) => ({ ...f, type: e.target.value }))}
              >
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          {(newField.type === "select" || newField.type === "multiselect" || newField.type === "radio") && (
            <label className="wi-settings__label">
              Options JSON (array of strings, e.g. [&quot;a&quot;,&quot;b&quot;])
              <input
                type="text"
                className="backlog-filter__search wi-settings__field-input"
                placeholder='["option1","option2"]'
                value={newField.options_json}
                onChange={(e) => setNewField((f) => ({ ...f, options_json: e.target.value }))}
              />
            </label>
          )}
          <div className="wi-settings__row-end">
            <button type="button" className="btn btn--primary btn--sm" onClick={create} disabled={saving}>
              {saving ? "Saving…" : "Create field"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="wi-settings__loading">Loading…</p>
      ) : fields.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__text">No custom fields yet. Create one above.</p>
        </div>
      ) : (
        <Table<CustomField>
          pageId="work-items-settings"
          slot="custom_fields"
          ariaLabel="Custom fields"
          rows={fields}
          rowKey={(f) => f.id}
          columns={[
            {
              key: "field_name",
              header: "Field name",
              kind: "custom",
              render: (f) => <span className="wi-settings__field-name">{f.field_name}</span>,
            },
            { key: "label", header: "Label" },
            {
              key: "type",
              header: "Type",
              width: 130,
              kind: "pill",
              pillVariant: () => "neutral",
              pillLabel: (f) => f.type,
            },
            {
              key: "created_at",
              header: "Created",
              width: 140,
              kind: "custom",
              render: (f) => new Date(f.created_at).toLocaleDateString(),
            },
            {
              key: "actions",
              header: "",
              width: 120,
              kind: "custom",
              render: (f) => (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--danger"
                  onClick={() => archive(f.id)}
                >
                  Archive
                </button>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

// ─── Template Builder Tab ─────────────────────────────────────────────────────

function TemplateBuilder() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [allFields, setAllFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTmpl, setNewTmpl] = useState({ name: "", description: "", item_type: "" });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, fRes] = await Promise.all([
        api<{ items: Template[] }>("/work-item-templates"),
        api<{ items: CustomField[] }>("/custom-field-library"),
      ]);
      setTemplates(tRes.items);
      setAllFields(fRes.items);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createTemplate() {
    if (!newTmpl.name.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: newTmpl.name.trim() };
      if (newTmpl.description.trim()) body.description = newTmpl.description.trim();
      if (newTmpl.item_type) body.item_type = newTmpl.item_type;
      await api("/work-item-templates", { method: "POST", body: JSON.stringify(body) });
      setNewTmpl({ name: "", description: "", item_type: "" });
      setCreating(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function addField(templateId: string, fieldLibraryId: string, position: number) {
    await api(`/work-item-templates/${templateId}/fields`, {
      method: "POST",
      body: JSON.stringify({ field_library_id: fieldLibraryId, position, required: false }),
    });
    load();
  }

  async function removeField(templateId: string, fieldLibraryId: string) {
    await api(`/work-item-templates/${templateId}/fields/${fieldLibraryId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="wi-settings">
      <div className="wi-settings__row-end">
        <button type="button" className="btn btn--primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "New template"}
        </button>
      </div>

      {creating && (
        <div className="wi-settings__form-card">
          <div className="wi-settings__grid-3">
            <label className="wi-settings__label">
              Name
              <input
                type="text"
                className="backlog-filter__search wi-settings__field-input"
                placeholder="e.g. Bug Report"
                value={newTmpl.name}
                onChange={(e) => setNewTmpl((t) => ({ ...t, name: e.target.value }))}
              />
            </label>
            <label className="wi-settings__label">
              Description
              <input
                type="text"
                className="backlog-filter__search wi-settings__field-input"
                placeholder="Optional"
                value={newTmpl.description}
                onChange={(e) => setNewTmpl((t) => ({ ...t, description: e.target.value }))}
              />
            </label>
            <label className="wi-settings__label">
              Item type
              <select
                className="btn btn--ghost btn--sm wi-settings__field-input"
                value={newTmpl.item_type}
                onChange={(e) => setNewTmpl((t) => ({ ...t, item_type: e.target.value }))}
              >
                <option value="">Any</option>
                <option value="epic">Epic</option>
                <option value="story">Story</option>
              </select>
            </label>
          </div>
          <div className="wi-settings__row-end">
            <button type="button" className="btn btn--primary btn--sm" onClick={createTemplate} disabled={saving}>
              {saving ? "Saving…" : "Create template"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="wi-settings__loading">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__text">No templates yet. Create one above.</p>
        </div>
      ) : (
        <div className="wi-settings__type-list">
          {templates.map((t) => {
            const isOpen = expandedId === t.id;
            const usedFieldIds = new Set(t.fields.map((f) => f.field_library_id));
            const available = allFields.filter((f) => !usedFieldIds.has(f.id));

            return (
              <div key={t.id} className="wi-settings__type-card">
                <div
                  className="wi-settings__type-name"
                  onClick={() => setExpandedId(isOpen ? null : t.id)}
                >
                  <div>
                    <span className="wi-settings__type-meta">{t.name}</span>
                    {t.item_type && (
                      <span className="pill pill--neutral pill--sm wi-settings__pill-spacer">
                        {t.item_type}
                      </span>
                    )}
                    <span className="wi-settings__type-hint">
                      {t.fields.length} field{t.fields.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span className="wi-settings__type-chevron">{isOpen ? "▾" : "▸"}</span>
                </div>

                {isOpen && (
                  <div className="wi-settings__type-body">
                    {t.fields.length === 0 ? (
                      <p className="wi-settings__type-hint">
                        No fields added yet.
                      </p>
                    ) : (
                      <Table<TemplateField>
                        pageId="work-items-settings"
                        slot={`template_fields__${t.id.replace(/-/g, "_")}`}
                        ariaLabel={`Fields for ${t.name}`}
                        rows={[...t.fields].sort((a, b) => a.position - b.position)}
                        rowKey={(f) => f.id}
                        columns={[
                          { key: "position", header: "Pos", width: 60, kind: "numeric" },
                          { key: "label", header: "Label" },
                          {
                            key: "field_type",
                            header: "Type",
                            width: 130,
                            kind: "pill",
                            pillVariant: () => "neutral",
                            pillLabel: (f) => f.field_type,
                          },
                          {
                            key: "required",
                            header: "Required",
                            width: 130,
                            kind: "custom",
                            render: (f) =>
                              f.required ? (
                                <span className="pill pill--warning pill--sm">required</span>
                              ) : (
                                <span className="wi-settings__optional">optional</span>
                              ),
                          },
                          {
                            key: "actions",
                            header: "",
                            width: 110,
                            kind: "custom",
                            render: (f) => (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => removeField(t.id, f.field_library_id)}
                              >
                                Remove
                              </button>
                            ),
                          },
                        ]}
                      />
                    )}

                    {available.length > 0 && (
                      <div className="wi-settings__add-row">
                        <span className="wi-settings__add-label">Add field:</span>
                        <select
                          className="btn btn--ghost btn--sm"
                          defaultValue=""
                          onChange={(e) => {
                            const fieldId = e.target.value;
                            if (fieldId) {
                              addField(t.id, fieldId, t.fields.length);
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = ["fields", "templates"] as const;

export default function WorkItemsSettingsPage() {
  const { user } = useAuth();
  const canEditSettings = useHasPermission("work_items.settings.edit");
  const router = useRouter();
  const [tab, setTab] = useState<typeof TABS[number]>("fields");

  useEffect(() => {
    if (user && !canEditSettings) router.replace("/work-items");
  }, [user, canEditSettings, router]);

  if (!user || !canEditSettings) return null;

  return (
    <>
      <div className="wi-settings__filter-bar">
        {(["fields", "templates"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={"pill " + (tab === t ? "pill--info" : "pill--neutral")}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "fields" ? "Custom field library" : "Item templates"}
          </button>
        ))}
      </div>

      {tab === "fields" ? (
        <Panel name="work_items_settings_fields" title="Custom field library">
          <CustomFieldLibrary />
        </Panel>
      ) : (
        <Panel name="work_items_settings_templates" title="Item templates">
          <TemplateBuilder />
        </Panel>
      )}
    </>
  );
}
