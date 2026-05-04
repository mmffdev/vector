"use client";

import { useState, useEffect } from "react";
import { api } from "@/app/lib/api";
import InlineEditField from "@/app/components/InlineEditField";

interface WorkItem {
  id: string;
  key_num: number;
  item_type: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string | null;
  story_points: number | null;
  rollup_points: number | null;
  sprint_id: string | null;
  parent_id: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  children_count: number;
}

// Tasks are bottom-layer execution units and never carry their own points
// (the backend rejects story_points writes on task rows). Every other
// type can have a manual value; rollup shadows it when children exist.
function canHaveManualPoints(itemType: string): boolean {
  return itemType !== "task";
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
  onPatch: (id: string, body: Record<string, unknown>) => void;
}

const STATUS_OPTIONS = ["open", "in_progress", "done", "cancelled"];
const PRIORITY_OPTIONS = ["critical", "high", "medium", "low"];

// Click-to-edit date picker. Display shows the formatted date as plain text;
// click swaps to a focused <input type="date"> that commits on change/blur,
// matching the inline-edit feel of every other panel field.
function InlineDateField({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        type="date"
        className="form__input form__input--sm"
        defaultValue={value}
        aria-label={ariaLabel}
        onBlur={(e) => {
          const next = e.target.value;
          setEditing(false);
          if (next !== value) onCommit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }
  return (
    <span
      className="work-items-panel__inline-trigger"
      title="Click to edit"
      onClick={() => setEditing(true)}
    >
      {value || "—"}
    </span>
  );
}

function FieldValueInput({
  fv,
  onSave,
}: {
  fv: FieldValue;
  onSave: (fieldLibraryId: string, value: string) => Promise<void>;
}) {
  const current = fv.string_value ?? fv.number_value ?? fv.date_value ?? fv.text_value ?? "";

  const options: string[] = (() => {
    try { return fv.options_json ? JSON.parse(fv.options_json) : []; }
    catch { return []; }
  })();

  const commit = (next: string) => {
    if (next === current) return;
    void onSave(fv.field_library_id!, next);
  };

  if (fv.field_type === "select" || fv.field_type === "radio") {
    return (
      <PanelInlineSelect
        value={current}
        options={options.map((o) => ({ value: o, label: o }))}
        onCommit={commit}
        ariaLabel={fv.label}
        trigger={<span>{current || "—"}</span>}
      />
    );
  }
  if (fv.field_type === "boolean") {
    const label = current === "true" ? "Yes" : current === "false" ? "No" : "—";
    return (
      <PanelInlineSelect
        value={current}
        options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
        onCommit={commit}
        ariaLabel={fv.label}
        trigger={<span>{label}</span>}
      />
    );
  }
  if (fv.field_type === "date") {
    return <InlineDateField value={current} onCommit={commit} ariaLabel={fv.label} />;
  }
  if (fv.field_type === "integer" || fv.field_type === "decimal") {
    const isInt = fv.field_type === "integer";
    return (
      <InlineEditField
        value={current}
        onCommit={(next) => {
          const trimmed = next.trim();
          if (trimmed === "") { commit(""); return; }
          const parsed = isInt ? parseInt(trimmed, 10) : parseFloat(trimmed);
          if (Number.isNaN(parsed)) return false;
          commit(String(parsed));
        }}
        ariaLabel={fv.label}
        inputClassName="form__input form__input--sm form__input--numeric"
        displayClassName="work-items-panel__inline-trigger"
        clickToEdit
        allowEmpty
        emptyDisplay="—"
        maxLength={20}
      />
    );
  }
  if (fv.field_type === "richtext") {
    return (
      <InlineEditField
        value={current}
        onCommit={(next) => commit(next)}
        ariaLabel={fv.label}
        inputClassName="form__input"
        displayClassName="work-items-panel__inline-trigger"
        clickToEdit
        multiline
        rows={4}
        allowEmpty
        emptyDisplay="—"
        maxLength={4000}
      />
    );
  }
  return (
    <InlineEditField
      value={current}
      onCommit={(next) => commit(next)}
      ariaLabel={fv.label}
      inputClassName="form__input form__input--sm"
      displayClassName="work-items-panel__inline-trigger"
      clickToEdit
      allowEmpty
      emptyDisplay="—"
      maxLength={500}
    />
  );
}

// Click-to-open native select used inside the read view for status/priority.
// Renders the parent's pill (or any node) until the user clicks it; then
// swaps to a focused <select> that commits on change. Mirrors the row
// inline-select in shape so the panel and table behave the same way.
function PanelInlineSelect({
  value,
  options,
  onCommit,
  ariaLabel,
  trigger,
  placeholder = "—",
}: {
  value: string;
  options: { value: string; label: string }[];
  onCommit: (next: string) => void;
  ariaLabel: string;
  trigger: React.ReactNode;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus
        className="form__select form__select--sm"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => {
          const next = e.target.value;
          setEditing(false);
          if (next !== value) onCommit(next);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  return (
    <span
      className="work-items-panel__inline-trigger"
      title="Click to edit"
      onClick={() => setEditing(true)}
    >
      {trigger}
    </span>
  );
}

export default function WorkItemDetailPanel({ item, onClose, onPatch }: Props) {
  const [fieldValues, setFieldValues] = useState<FieldValue[]>([]);
  const [fvLoading, setFvLoading] = useState(false);

  useEffect(() => {
    setFvLoading(true);
    api<{ field_values: FieldValue[] }>(`/api/work-items/${item.id}/field-values`)
      .then((r) => setFieldValues(r.field_values))
      .catch(() => setFieldValues([]))
      .finally(() => setFvLoading(false));
  }, [item.id]);

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
      {/* Header — title is inline-editable; meta + close stay static. */}
      <div className="work-items-panel__header">
        <div>
          <span className="work-items-panel__meta">
            #{item.key_num} · {item.item_type}
          </span>
          <p className="work-items-panel__title">
            <InlineEditField
              value={item.title}
              onCommit={(next) => onPatch(item.id, { title: next })}
              ariaLabel="Work item title"
              inputClassName="form__input"
              displayClassName="work-items-panel__title-text"
              clickToEdit
              maxLength={200}
            />
          </p>
        </div>
        <div className="work-items-panel__header-actions">
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

      {/* Inline-editable info grid. Each value is its own click-to-edit
          control; there is no separate "edit mode" — the read view IS the
          edit view, matching the work-items tree row behaviour. */}
      <dl className="work-items-panel__info-grid">
        <div className="work-items-panel__info-item">
          <dt>Status</dt>
          <dd>
            <PanelInlineSelect
              value={item.status}
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace("_", " ") }))}
              onCommit={(next) => onPatch(item.id, { status: next })}
              ariaLabel="Work item status"
              trigger={<span>{item.status.replace("_", " ")}</span>}
            />
          </dd>
        </div>
        <div className="work-items-panel__info-item">
          <dt>Priority</dt>
          <dd>
            <PanelInlineSelect
              value={item.priority ?? ""}
              options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
              onCommit={(next) => onPatch(item.id, { priority: next === "" ? null : next })}
              ariaLabel="Work item priority"
              placeholder="None"
              trigger={<span>{item.priority ?? "—"}</span>}
            />
          </dd>
        </div>
        <div className="work-items-panel__info-item">
          <dt>Points{item.rollup_points != null ? " (rolled up)" : ""}</dt>
          <dd>
            {!canHaveManualPoints(item.item_type) ? (
              <span>—</span>
            ) : item.rollup_points != null ? (
              // Show the rollup as the primary value (read-only here) but
              // still let the user edit the underlying manual story_points
              // — the manual value reappears once the children are archived.
              <span>
                {item.rollup_points}{" "}
                <span className="work-items-panel__hint">
                  (manual:{" "}
                  <InlineEditField
                    value={item.story_points != null ? String(item.story_points) : ""}
                    onCommit={(next) => {
                      const trimmed = next.trim();
                      if (trimmed === "") return onPatch(item.id, { story_points: null });
                      const parsed = parseInt(trimmed, 10);
                      if (Number.isNaN(parsed) || parsed < 0) return false;
                      return onPatch(item.id, { story_points: parsed });
                    }}
                    ariaLabel="Manual story points"
                    inputClassName="form__input form__input--sm form__input--numeric"
                    displayClassName="work-items-panel__inline-trigger"
                    clickToEdit
                    allowEmpty
                    emptyDisplay="—"
                    maxLength={6}
                  />
                  )
                </span>
              </span>
            ) : (
              <InlineEditField
                value={item.story_points != null ? String(item.story_points) : ""}
                onCommit={(next) => {
                  const trimmed = next.trim();
                  if (trimmed === "") return onPatch(item.id, { story_points: null });
                  const parsed = parseInt(trimmed, 10);
                  if (Number.isNaN(parsed) || parsed < 0) return false;
                  return onPatch(item.id, { story_points: parsed });
                }}
                ariaLabel="Story points"
                inputClassName="form__input form__input--sm form__input--numeric"
                displayClassName="work-items-panel__inline-trigger"
                clickToEdit
                allowEmpty
                emptyDisplay="—"
                maxLength={6}
              />
            )}
          </dd>
        </div>
        <div className="work-items-panel__info-item">
          <dt>Type</dt>
          <dd>{item.item_type}</dd>
        </div>
      </dl>

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

      <p className="work-items-panel__updated">
        Updated {new Date(item.updated_at).toLocaleDateString()}
      </p>
    </aside>
  );
}
