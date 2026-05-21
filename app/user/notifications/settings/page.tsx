"use client";

// /user/notifications/settings — Notification rules + preferences.
//
// Two stacked panels:
//   1. Rules table (top) — user's existing rules with enabled toggle,
//      edit, delete actions.
//   2. Create / edit panel (bottom) — form with type / target /
//      conditions[] builder. Dropdowns are schema-driven from
//      /notifications/rule-schema so renamed fields + custom artefact
//      types appear automatically.
//
// Modelled on JIRA's filter-subscription / Rally's notification-rule UI.
// Strawman scope: artefact rules only (other types in the schema endpoint
// are surfaced as disabled options with a "coming soon" reason).

import { useCallback, useEffect, useMemo, useState } from "react";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import Table, { type Column } from "@/app/components/Table";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import {
  notificationRules,
  type NotificationRule,
  type RuleCondition,
  type RuleFieldEntry,
  type RuleOperator,
  type RuleOperatorEntry,
  type RuleTargetEntry,
  type RuleTypeEntry,
} from "@/app/lib/apiSite";

// ─── Editor state ──────────────────────────────────────────────

interface EditorState {
  mode: "create" | "edit";
  id?: string;
  name: string;
  type: string;
  target: string;
  conditions: RuleCondition[];
}

const EMPTY_EDITOR: EditorState = {
  mode: "create",
  name: "",
  type: "artefact",
  target: "",
  conditions: [],
};

export default function NotificationsSettingsPage() {
  // List state
  const [rules, setRules] = useState<NotificationRule[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Editor state
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Schema state — driven by editor.type / editor.target.
  const [types, setTypes] = useState<RuleTypeEntry[] | null>(null);
  const [targets, setTargets] = useState<RuleTargetEntry[] | null>(null);
  const [fields, setFields] = useState<RuleFieldEntry[] | null>(null);

  // ── Load existing rules ───────────────────────────────────
  const refreshRules = useCallback(async () => {
    setListError(null);
    try {
      const res = await notificationRules.list();
      setRules(res.rules);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load rules.");
      setRules([]);
    }
  }, []);
  useEffect(() => {
    void refreshRules();
  }, [refreshRules]);

  // ── Load type list once ───────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const res = await notificationRules.schemaTypes();
        setTypes(res.types);
      } catch {
        setTypes([]);
      }
    })();
  }, []);

  // ── Load targets when type changes ────────────────────────
  useEffect(() => {
    setTargets(null);
    if (!editor.type) return;
    void (async () => {
      try {
        const res = await notificationRules.schemaTargets(editor.type);
        setTargets(res.targets);
      } catch {
        setTargets([]);
      }
    })();
  }, [editor.type]);

  // ── Load fields when target changes ───────────────────────
  useEffect(() => {
    setFields(null);
    if (!editor.type || !editor.target) return;
    void (async () => {
      try {
        const res = await notificationRules.schemaFields(editor.type, editor.target);
        setFields(res.fields);
      } catch {
        setFields([]);
      }
    })();
  }, [editor.type, editor.target]);

  // Quick lookups for the rules table summary line.
  const targetLabelById = useMemo(() => {
    const m = new Map<string, string>();
    targets?.forEach((t) => m.set(t.value, t.label));
    return m;
  }, [targets]);

  // ── Actions ────────────────────────────────────────────────

  function startCreate() {
    setEditor({ ...EMPTY_EDITOR });
    setSubmitError(null);
  }

  function startEdit(r: NotificationRule) {
    setEditor({
      mode: "edit",
      id: r.users_notification_rules_id,
      name: r.users_notification_rules_name,
      type: r.users_notification_rules_type,
      target: r.users_notification_rules_target ?? "",
      conditions: r.users_notification_rules_conditions ?? [],
    });
    setSubmitError(null);
  }

  async function handleToggleEnabled(r: NotificationRule) {
    try {
      await notificationRules.update(r.users_notification_rules_id, {
        enabled: !r.users_notification_rules_enabled,
      });
      refreshRules();
    } catch {
      // Silent — the table row will reflect server state on the next refresh.
    }
  }

  async function handleDelete(r: NotificationRule) {
    if (!confirm(`Delete rule "${r.users_notification_rules_name}"?`)) return;
    try {
      await notificationRules.delete(r.users_notification_rules_id);
      if (editor.id === r.users_notification_rules_id) {
        startCreate();
      }
      refreshRules();
    } catch {
      // Silent.
    }
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (editor.name.trim() === "") {
      setSubmitError("Name is required.");
      return;
    }
    if (!editor.target) {
      setSubmitError("Target is required.");
      return;
    }
    if (editor.conditions.length === 0) {
      setSubmitError("Add at least one condition.");
      return;
    }
    setSubmitting(true);
    try {
      if (editor.mode === "edit" && editor.id) {
        await notificationRules.update(editor.id, {
          name: editor.name,
          conditions: editor.conditions,
        });
      } else {
        await notificationRules.create({
          name: editor.name,
          type: editor.type,
          target: editor.target,
          conditions: editor.conditions,
        });
      }
      startCreate();
      refreshRules();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to save rule.");
    } finally {
      setSubmitting(false);
    }
  }

  function addCondition() {
    setEditor((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { field: "", operator: "=", value: "" }],
    }));
  }

  function updateCondition(idx: number, patch: Partial<RuleCondition>) {
    setEditor((prev) => ({
      ...prev,
      conditions: prev.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  }

  function removeCondition(idx: number) {
    setEditor((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== idx),
    }));
  }

  return (
    <PageContent>
      <StrictRoute>
        <PageDescription>
          Build rules to control which artefact changes notify you. Each rule
          fires its own notification when an event matches all of its conditions.
          The settings here power your notifications bell and inbox.
        </PageDescription>

        {/* ─── Rules table (top) ───────────────────────────────── */}
        <Panel
          name="panel_notifications_rules_list"
          title="Your rules"
          description={
            rules === null
              ? "Loading…"
              : `${rules.length} rule${rules.length === 1 ? "" : "s"} configured`
          }
        >
          <div className="notification-rules__List">
            {listError && (
              <div className="notification-rules__List_state is-error">{listError}</div>
            )}
            {rules === null && (
              <div className="notification-rules__List_state">Loading…</div>
            )}
            {rules && rules.length === 0 && !listError && (
              <div className="notification-rules__List_state">
                No rules yet. Create one below to start receiving notifications when
                artefacts change.
              </div>
            )}
            {rules && rules.length > 0 && (
              <Table<NotificationRule>
                pageId="notifications_settings"
                slot="rules_list"
                ariaLabel="Notification rules"
                columns={rulesColumns({
                  targetLabelById,
                  onEdit: startEdit,
                  onDelete: handleDelete,
                  onToggle: handleToggleEnabled,
                })}
                rows={rules}
                rowKey={(r) => r.users_notification_rules_id}
                rowClassName={(r) =>
                  editor.id === r.users_notification_rules_id ? "is-editing" : undefined
                }
                noScroll
              />
            )}
          </div>
        </Panel>

        {/* ─── Create / edit panel (bottom) ────────────────────── */}
        <Panel
          name="panel_notifications_rules_editor"
          title={editor.mode === "edit" ? "Edit rule" : "New rule"}
          description={
            editor.mode === "edit"
              ? `Editing "${editor.name || "(unnamed)"}"`
              : "Compose a rule. All conditions must match for the rule to fire."
          }
        >
          <div className="notification-rules__Editor">
            {/* Name */}
            <label className="notification-rules__Editor_field">
              <span className="notification-rules__Editor_field_label">Name</span>
              <input
                type="text"
                className="form__input"
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                placeholder="e.g. Critical defects assigned to me"
                maxLength={100}
              />
            </label>

            {/* Type */}
            <label className="notification-rules__Editor_field">
              <span className="notification-rules__Editor_field_label">Type</span>
              <select
                className="form__select"
                value={editor.type}
                onChange={(e) => setEditor({ ...editor, type: e.target.value, target: "", conditions: [] })}
                disabled={editor.mode === "edit"}
              >
                {(types ?? []).map((t) => (
                  <option key={t.value} value={t.value} disabled={!t.enabled}>
                    {t.label}
                    {!t.enabled && t.reason ? ` — ${t.reason}` : ""}
                  </option>
                ))}
              </select>
            </label>

            {/* Target — required for type=artefact */}
            <label className="notification-rules__Editor_field">
              <span className="notification-rules__Editor_field_label">Artefact type</span>
              <select
                className="form__select"
                value={editor.target}
                onChange={(e) => setEditor({ ...editor, target: e.target.value, conditions: [] })}
                disabled={editor.mode === "edit" || targets === null}
              >
                <option value="">
                  {targets === null ? "Loading…" : "Choose an artefact type…"}
                </option>
                {(targets ?? []).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Conditions builder */}
            <div className="notification-rules__Editor_Conditions">
              <div className="notification-rules__Editor_Conditions_header">
                <span className="notification-rules__Editor_field_label">Conditions</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={addCondition}
                  disabled={!editor.target || fields === null}
                >
                  + Add condition
                </button>
              </div>

              {editor.conditions.length === 0 ? (
                <div className="notification-rules__Editor_Conditions_empty">
                  {editor.target
                    ? "No conditions yet. Add one to define when this rule fires."
                    : "Choose an artefact type to start adding conditions."}
                </div>
              ) : (
                <ul className="notification-rules__Editor_Conditions_list" role="list">
                  {editor.conditions.map((c, idx) => (
                    <ConditionRow
                      key={idx}
                      condition={c}
                      fields={fields ?? []}
                      onChange={(patch) => updateCondition(idx, patch)}
                      onRemove={() => removeCondition(idx)}
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* Submit row */}
            <div className="notification-rules__Editor_Actions">
              {submitError && (
                <div className="notification-rules__Editor_error">{submitError}</div>
              )}
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {editor.mode === "edit"
                  ? submitting
                    ? "Saving…"
                    : "Save changes"
                  : submitting
                    ? "Creating…"
                    : "Create rule"}
              </button>
              {editor.mode === "edit" && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={startCreate}
                  disabled={submitting}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </Panel>
      </StrictRoute>
    </PageContent>
  );
}

// ─── Condition row ────────────────────────────────────────────────

interface ConditionRowProps {
  condition: RuleCondition;
  fields: RuleFieldEntry[];
  onChange: (patch: Partial<RuleCondition>) => void;
  onRemove: () => void;
}

function ConditionRow({ condition, fields, onChange, onRemove }: ConditionRowProps) {
  const selectedField = fields.find((f) => f.value === condition.field);
  const operators: RuleOperatorEntry[] = selectedField?.operators ?? [];
  const selectedOp = operators.find((o) => o.value === condition.operator);
  const showValue = selectedOp?.needs_value ?? true;

  return (
    <li className="notification-rules__Editor_Conditions_list_item">
      {/* Field */}
      <select
        className="form__select form__select--sm"
        value={condition.field}
        onChange={(e) => {
          const f = fields.find((x) => x.value === e.target.value);
          // Reset operator + value when the field changes — the new field
          // type may have a totally different operator set.
          onChange({
            field: e.target.value,
            operator: (f?.operators[0]?.value ?? "=") as RuleOperator,
            value: "",
          });
        }}
        aria-label="Field"
      >
        <option value="">Choose field…</option>
        {fields.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      {/* Operator */}
      <select
        className="form__select form__select--sm"
        value={condition.operator}
        onChange={(e) => onChange({ operator: e.target.value as RuleOperator, value: "" })}
        disabled={!selectedField}
        aria-label="Operator"
      >
        {operators.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Value — only when the operator needs one. Component varies by field type. */}
      {showValue ? (
        <ValueInput field={selectedField} condition={condition} onChange={onChange} />
      ) : (
        <span className="notification-rules__Editor_Conditions_list_item_blank" />
      )}

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onRemove}
        aria-label="Remove condition"
      >
        ×
      </button>
    </li>
  );
}

// ─── Value input — type-aware ─────────────────────────────────

interface ValueInputProps {
  field?: RuleFieldEntry;
  condition: RuleCondition;
  onChange: (patch: Partial<RuleCondition>) => void;
}

function ValueInput({ field, condition, onChange }: ValueInputProps) {
  if (!field) {
    return (
      <input
        type="text"
        className="form__input form__input--sm"
        value={String(condition.value ?? "")}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="Value"
        disabled
      />
    );
  }
  switch (field.value_type) {
    case "boolean":
      return (
        <select
          className="form__select form__select--sm"
          value={String(condition.value ?? "false")}
          onChange={(e) => onChange({ value: e.target.value === "true" })}
          aria-label="Value"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    case "integer":
      return (
        <input
          type="number"
          step={1}
          className="form__input form__input--sm"
          value={String(condition.value ?? "")}
          onChange={(e) =>
            onChange({ value: e.target.value === "" ? "" : Number(e.target.value) })
          }
          placeholder="Number"
          aria-label="Value"
        />
      );
    case "decimal":
      return (
        <input
          type="number"
          step="any"
          className="form__input form__input--sm"
          value={String(condition.value ?? "")}
          onChange={(e) =>
            onChange({ value: e.target.value === "" ? "" : Number(e.target.value) })
          }
          placeholder="Number"
          aria-label="Value"
        />
      );
    case "date":
      return (
        <input
          type="date"
          className="form__input form__input--sm"
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ value: e.target.value })}
          aria-label="Value"
        />
      );
    case "select":
    case "multiselect":
      if (field.options && field.options.length > 0) {
        return (
          <select
            className="form__select form__select--sm"
            value={String(condition.value ?? "")}
            onChange={(e) => onChange({ value: e.target.value })}
            aria-label="Value"
          >
            <option value="">Choose value…</option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      }
      return (
        <input
          type="text"
          className="form__input form__input--sm"
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="Value"
          aria-label="Value"
        />
      );
    case "user":
      return (
        <input
          type="text"
          className="form__input form__input--sm"
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="User id or email"
          aria-label="Value"
        />
      );
    case "textbox":
    case "richtext":
    default:
      return (
        <input
          type="text"
          className="form__input form__input--sm"
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="Value"
          aria-label="Value"
        />
      );
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function summariseConditions(conds: RuleCondition[]): string {
  if (!conds || conds.length === 0) return "(none)";
  return conds
    .map((c) => {
      const op = humanOperator(c.operator);
      const val =
        c.value === undefined || c.value === "" ? "" : ` ${formatVal(c.value)}`;
      return `${c.field} ${op}${val}`;
    })
    .join(" AND ");
}

function humanOperator(op: RuleOperator): string {
  switch (op) {
    case "=":
      return "equals";
    case "!=":
      return "≠";
    case ">":
      return ">";
    case "<":
      return "<";
    case ">=":
      return "≥";
    case "<=":
      return "≤";
    case "contains":
      return "contains";
    case "changed":
      return "changed";
    case "changed_from":
      return "changed from";
    case "changed_to":
      return "changed to";
    case "was":
      return "was";
    case "was_not":
      return "was not";
    case "was_in":
      return "was in";
    case "was_not_in":
      return "was not in";
    default:
      return op;
  }
}

function formatVal(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

// ─── Rules table column definitions ────────────────────────────

interface RulesColumnsOpts {
  targetLabelById: Map<string, string>;
  onEdit: (r: NotificationRule) => void;
  onDelete: (r: NotificationRule) => void;
  onToggle: (r: NotificationRule) => void;
}

function rulesColumns(opts: RulesColumnsOpts): Column<NotificationRule>[] {
  return [
    {
      key: "name",
      header: "Name",
      render: (r) => r.users_notification_rules_name,
    },
    {
      key: "type",
      header: "Type",
      render: (r) => (
        <span className="notification-rules__List_Type">
          <span className="pill pill--info">{r.users_notification_rules_type}</span>
          {r.users_notification_rules_target && (
            <span className="notification-rules__List_target">
              {opts.targetLabelById.get(r.users_notification_rules_target) ??
                r.users_notification_rules_target}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "conditions",
      header: "Conditions",
      render: (r) => (
        <span className="notification-rules__List_summary">
          {summariseConditions(r.users_notification_rules_conditions)}
        </span>
      ),
    },
    {
      key: "enabled",
      header: "Enabled",
      kind: "center",
      render: (r) => (
        <label className="notification-rules__List_toggle">
          <input
            type="checkbox"
            checked={r.users_notification_rules_enabled}
            onChange={() => opts.onToggle(r)}
            aria-label={`${
              r.users_notification_rules_enabled ? "Disable" : "Enable"
            } rule ${r.users_notification_rules_name}`}
          />
          <span>{r.users_notification_rules_enabled ? "On" : "Off"}</span>
        </label>
      ),
    },
    {
      key: "actions",
      header: "",
      kind: "center",
      render: (r) => (
        <span className="notification-rules__List_actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => opts.onEdit(r)}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => opts.onDelete(r)}
          >
            Delete
          </button>
        </span>
      ),
    },
  ];
}
