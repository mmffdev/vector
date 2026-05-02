"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { api } from "@/app/lib/api";
import { useTabState } from "@/app/hooks/useTabState";

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
    api<{ items: CustomField[] }>("/api/custom-field-library")
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
      await api("/api/custom-field-library", { method: "POST", body: JSON.stringify(body) });
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
    await api(`/api/custom-field-library/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? "Cancel" : "New field"}
        </button>
      </div>

      {creating && (
        <div
          style={{
            background: "var(--surface-sunken)",
            border: "1px solid var(--border)",
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
            <label style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              Field name (slug)
              <input
                type="text"
                className="backlog-filter__search"
                style={{ display: "block", width: "100%", height: 32, marginTop: 4 }}
                placeholder="e.g. environment"
                value={newField.field_name}
                onChange={(e) => setNewField((f) => ({ ...f, field_name: e.target.value }))}
              />
            </label>
            <label style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              Label
              <input
                type="text"
                className="backlog-filter__search"
                style={{ display: "block", width: "100%", height: 32, marginTop: 4 }}
                placeholder="e.g. Environment"
                value={newField.label}
                onChange={(e) => setNewField((f) => ({ ...f, label: e.target.value }))}
              />
            </label>
            <label style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              Type
              <select
                className="btn btn--ghost btn--sm"
                style={{ display: "block", width: "100%", marginTop: 4 }}
                value={newField.type}
                onChange={(e) => setNewField((f) => ({ ...f, type: e.target.value }))}
              >
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          {(newField.type === "select" || newField.type === "multiselect" || newField.type === "radio") && (
            <label style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              Options JSON (array of strings, e.g. ["a","b"])
              <input
                type="text"
                className="backlog-filter__search"
                style={{ display: "block", width: "100%", height: 32, marginTop: 4 }}
                placeholder='["option1","option2"]'
                value={newField.options_json}
                onChange={(e) => setNewField((f) => ({ ...f, options_json: e.target.value }))}
              />
            </label>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn--primary btn--sm" onClick={create} disabled={saving}>
              {saving ? "Saving…" : "Create field"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--ink-muted)", fontSize: 13 }}>Loading…</p>
      ) : fields.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__text">No custom fields yet. Create one above.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead className="table__head">
              <tr>
                <th className="table__cell">Field name</th>
                <th className="table__cell">Label</th>
                <th className="table__cell">Type</th>
                <th className="table__cell">Created</th>
                <th className="table__cell" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id} className="table__row">
                  <td className="table__cell">
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{f.field_name}</span>
                  </td>
                  <td className="table__cell">{f.label}</td>
                  <td className="table__cell">
                    <span className="pill pill--neutral pill--sm">{f.type}</span>
                  </td>
                  <td className="table__cell" style={{ color: "var(--ink-muted)", fontSize: 12 }}>
                    {new Date(f.created_at).toLocaleDateString()}
                  </td>
                  <td className="table__cell">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--danger"
                      onClick={() => archive(f.id)}
                    >
                      Archive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        api<{ items: Template[] }>("/api/work-item-templates"),
        api<{ items: CustomField[] }>("/api/custom-field-library"),
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
      await api("/api/work-item-templates", { method: "POST", body: JSON.stringify(body) });
      setNewTmpl({ name: "", description: "", item_type: "" });
      setCreating(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function addField(templateId: string, fieldLibraryId: string, position: number) {
    await api(`/api/work-item-templates/${templateId}/fields`, {
      method: "POST",
      body: JSON.stringify({ field_library_id: fieldLibraryId, position, required: false }),
    });
    load();
  }

  async function removeField(templateId: string, fieldLibraryId: string) {
    await api(`/api/work-item-templates/${templateId}/fields/${fieldLibraryId}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn--primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "New template"}
        </button>
      </div>

      {creating && (
        <div
          style={{
            background: "var(--surface-sunken)",
            border: "1px solid var(--border)",
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
            <label style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              Name
              <input
                type="text"
                className="backlog-filter__search"
                style={{ display: "block", width: "100%", height: 32, marginTop: 4 }}
                placeholder="e.g. Bug Report"
                value={newTmpl.name}
                onChange={(e) => setNewTmpl((t) => ({ ...t, name: e.target.value }))}
              />
            </label>
            <label style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              Description
              <input
                type="text"
                className="backlog-filter__search"
                style={{ display: "block", width: "100%", height: 32, marginTop: 4 }}
                placeholder="Optional"
                value={newTmpl.description}
                onChange={(e) => setNewTmpl((t) => ({ ...t, description: e.target.value }))}
              />
            </label>
            <label style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              Item type
              <select
                className="btn btn--ghost btn--sm"
                style={{ display: "block", width: "100%", marginTop: 4 }}
                value={newTmpl.item_type}
                onChange={(e) => setNewTmpl((t) => ({ ...t, item_type: e.target.value }))}
              >
                <option value="">Any</option>
                <option value="epic">Epic</option>
                <option value="story">Story</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn--primary btn--sm" onClick={createTemplate} disabled={saving}>
              {saving ? "Saving…" : "Create template"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--ink-muted)", fontSize: 13 }}>Loading…</p>
      ) : templates.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__text">No templates yet. Create one above.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {templates.map((t) => {
            const isOpen = expandedId === t.id;
            const usedFieldIds = new Set(t.fields.map((f) => f.field_library_id));
            const available = allFields.filter((f) => !usedFieldIds.has(f.id));

            return (
              <div
                key={t.id}
                style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "var(--space-3) var(--space-4)",
                    cursor: "pointer",
                  }}
                  onClick={() => setExpandedId(isOpen ? null : t.id)}
                >
                  <div>
                    <span style={{ fontWeight: 500 }}>{t.name}</span>
                    {t.item_type && (
                      <span className="pill pill--neutral pill--sm" style={{ marginLeft: 8 }}>
                        {t.item_type}
                      </span>
                    )}
                    <span style={{ marginLeft: 12, fontSize: 12, color: "var(--ink-muted)" }}>
                      {t.fields.length} field{t.fields.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span style={{ color: "var(--ink-muted)" }}>{isOpen ? "▾" : "▸"}</span>
                </div>

                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: "var(--space-3) var(--space-4)" }}>
                    {t.fields.length === 0 ? (
                      <p style={{ fontSize: 12, color: "var(--ink-muted)", margin: "0 0 var(--space-3)" }}>
                        No fields added yet.
                      </p>
                    ) : (
                      <div className="table-wrap" style={{ marginBottom: "var(--space-3)" }}>
                        <table className="table">
                          <thead className="table__head">
                            <tr>
                              <th className="table__cell">Pos</th>
                              <th className="table__cell">Label</th>
                              <th className="table__cell">Type</th>
                              <th className="table__cell">Required</th>
                              <th className="table__cell" />
                            </tr>
                          </thead>
                          <tbody>
                            {[...t.fields].sort((a, b) => a.position - b.position).map((f) => (
                              <tr key={f.id} className="table__row">
                                <td className="table__cell table__cell--numeric">{f.position}</td>
                                <td className="table__cell">{f.label}</td>
                                <td className="table__cell">
                                  <span className="pill pill--neutral pill--sm">{f.field_type}</span>
                                </td>
                                <td className="table__cell">
                                  {f.required ? (
                                    <span className="pill pill--warning pill--sm">required</span>
                                  ) : (
                                    <span style={{ color: "var(--ink-muted)", fontSize: 12 }}>optional</span>
                                  )}
                                </td>
                                <td className="table__cell">
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    onClick={() => removeField(t.id, f.field_library_id)}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {available.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                        <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>Add field:</span>
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
  const router = useRouter();
  const [tab, setTab] = useTabState(TABS, "fields", "tab");

  useEffect(() => {
    if (user && user.role !== "padmin") router.replace("/work-items");
  }, [user, router]);

  if (!user || user.role !== "padmin") return null;

  return (
    <StrictRoute>
    <PageShell
      title="Work Items Settings"
      subtitle="Custom field library and item templates"
      actions={
        <a href="/work-items" className="btn btn--ghost">
          ← Back to Work Items
        </a>
      }
    >
      <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
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
    </PageShell>
    </StrictRoute>
  );
}
