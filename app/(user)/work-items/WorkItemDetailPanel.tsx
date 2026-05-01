"use client";

import { useState, useEffect } from "react";
import { api } from "@/app/lib/api";

interface WorkItem {
  id: string;
  key_num: number;
  item_type: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string | null;
  story_points: number | null;
  sprint_id: string | null;
  parent_id: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  children_count: number;
}

interface FieldValue {
  id: string;
  field_library_id: string | null;
  field_name: string;
  label: string;
  field_type: string;
  options_json: string | null;
  string_value: string | null;
  number_value: string | null;
  text_value: string | null;
  date_value: string | null;
}

interface Props {
  item: WorkItem;
  onClose: () => void;
  onUpdated: (updated: WorkItem) => void;
}

const STATUS_OPTIONS = ["open", "in_progress", "done", "cancelled"];
const PRIORITY_OPTIONS = ["critical", "high", "medium", "low"];

function FieldValueInput({
  fv,
  onSave,
}: {
  fv: FieldValue;
  onSave: (fieldLibraryId: string, value: string) => Promise<void>;
}) {
  const current = fv.string_value ?? fv.number_value ?? fv.date_value ?? fv.text_value ?? "";
  const [val, setVal] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVal(fv.string_value ?? fv.number_value ?? fv.date_value ?? fv.text_value ?? "");
  }, [fv.id]);

  const options: string[] = (() => {
    try { return fv.options_json ? JSON.parse(fv.options_json) : []; }
    catch { return []; }
  })();

  async function commit(newVal: string) {
    if (newVal === current) return;
    setSaving(true);
    try { await onSave(fv.field_library_id!, newVal); }
    finally { setSaving(false); }
  }

  if (fv.field_type === "select" || fv.field_type === "radio") {
    return (
      <select
        className="form__select form__select--sm"
        value={val}
        disabled={saving}
        onChange={(e) => { setVal(e.target.value); commit(e.target.value); }}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (fv.field_type === "date") {
    return (
      <input
        type="date"
        className="form__input"
        value={val}
        disabled={saving}
        onChange={(e) => setVal(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
      />
    );
  }
  if (fv.field_type === "boolean") {
    return (
      <select
        className="form__select form__select--sm"
        value={val}
        disabled={saving}
        onChange={(e) => { setVal(e.target.value); commit(e.target.value); }}
      >
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (fv.field_type === "integer" || fv.field_type === "decimal") {
    return (
      <input
        type="number"
        className="form__input"
        value={val}
        disabled={saving}
        onChange={(e) => setVal(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      className="form__input"
      value={val}
      disabled={saving}
      onChange={(e) => setVal(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
    />
  );
}

export default function WorkItemDetailPanel({ item, onClose, onUpdated }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [status, setStatus] = useState(item.status);
  const [priority, setPriority] = useState(item.priority ?? "");
  const [points, setPoints] = useState<string>(item.story_points?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [fieldValues, setFieldValues] = useState<FieldValue[]>([]);
  const [fvLoading, setFvLoading] = useState(false);

  useEffect(() => {
    setTitle(item.title);
    setStatus(item.status);
    setPriority(item.priority ?? "");
    setPoints(item.story_points?.toString() ?? "");
    setEditing(false);
  }, [item.id]);

  useEffect(() => {
    setFvLoading(true);
    api<{ field_values: FieldValue[] }>(`/api/work-items/${item.id}/field-values`)
      .then((r) => setFieldValues(r.field_values))
      .catch(() => setFieldValues([]))
      .finally(() => setFvLoading(false));
  }, [item.id]);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (title !== item.title) body.title = title;
      if (status !== item.status) body.status = status;
      if (priority !== (item.priority ?? "")) body.priority = priority || null;
      const sp = points === "" ? null : parseInt(points, 10);
      if (sp !== item.story_points) body.story_points = sp;
      if (Object.keys(body).length === 0) { setEditing(false); return; }

      const updated = await api<WorkItem>(`/api/work-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onUpdated(updated);
      setEditing(false);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false);
    }
  }

  async function saveFieldValue(fieldLibraryId: string, value: string) {
    const fv = fieldValues.find((f) => f.field_library_id === fieldLibraryId);
    if (!fv) return;
    const body: Record<string, unknown> = { field_library_id: fieldLibraryId };
    if (fv.field_type === "integer" || fv.field_type === "decimal") {
      body.number_value = value;
    } else if (fv.field_type === "richtext") {
      body.text_value = value;
    } else if (fv.field_type === "date") {
      body.date_value = value;
    } else {
      body.string_value = value;
    }
    const res = await api<{ field_values: FieldValue[] }>(
      `/api/work-items/${item.id}/field-values`,
      { method: "PUT", body: JSON.stringify([body]) }
    );
    setFieldValues(res.field_values);
  }

  return (
    <aside className="work-items-panel" aria-label="Work item detail">
      {/* Header */}
      <div className="work-items-panel__header">
        <div>
          <span className="work-items-panel__meta">
            #{item.key_num} · {item.item_type}
          </span>
          {!editing && (
            <p className="work-items-panel__title">{item.title}</p>
          )}
        </div>
        <div className="work-items-panel__header-actions">
          {!editing && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Edit form */}
      {editing ? (
        <div className="work-items-panel__edit-form">
          <label className="work-items-panel__field-label">
            Title
            <input
              type="text"
              className="form__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="work-items-panel__field-label">
            Status
            <select
              className="form__select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.replace("_", " ")}</option>
              ))}
            </select>
          </label>

          <label className="work-items-panel__field-label">
            Priority
            <select
              className="form__select"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="">None</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>

          <label className="work-items-panel__field-label">
            Story Points
            <input
              type="number"
              min={0}
              className="form__input"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          </label>

          <div className="work-items-panel__edit-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <dl className="work-items-panel__info-grid">
          <div className="work-items-panel__info-item">
            <dt>Status</dt>
            <dd>{item.status.replace("_", " ")}</dd>
          </div>
          <div className="work-items-panel__info-item">
            <dt>Priority</dt>
            <dd>{item.priority ?? "—"}</dd>
          </div>
          <div className="work-items-panel__info-item">
            <dt>Points</dt>
            <dd>{item.story_points ?? "—"}</dd>
          </div>
          <div className="work-items-panel__info-item">
            <dt>Type</dt>
            <dd>{item.item_type}</dd>
          </div>
        </dl>
      )}

      {/* Custom field values — always visible, inline editable */}
      {fieldValues.length > 0 && (
        <div>
          <p className="work-items-panel__section-label">Custom Fields</p>
          {fvLoading ? (
            <p className="placeholder__body">Loading…</p>
          ) : (
            <div className="work-items-panel__custom-fields">
              {fieldValues.map((fv) => (
                <label key={fv.id} className="work-items-panel__field-label">
                  {fv.label}
                  <FieldValueInput fv={fv} onSave={saveFieldValue} />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {!editing && (
        <p className="work-items-panel__updated">
          Updated {new Date(item.updated_at).toLocaleDateString()}
        </p>
      )}
    </aside>
  );
}
