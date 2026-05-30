"use client";

// CustomFieldEditForm — the controlled form state machine for a single
// custom-field row. Lifted out of
// app/(user)/workspace-admin/custom-fields/[id]/page.tsx so the same form
// can be mounted inside the inline OTV2 flyout (create + edit) without
// the page chrome (PageContent / PageHeading / PageDescription / Panel).
//
// Behaviour parity is the bar: Save handler logic mirrors the [id] page
// exactly — validate, parse options_json, create-or-update field, then
// replace bindings, surface errors. Two-column layout (form left, picker
// right) lives inside this component; the parent flyout only owns the
// header / close button.
//
// Plan: docs/superpowers/plans/2026-05-28-objecttree-generic-rowtype.md
// (Task 3, Step 2).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/app/lib/api";
import {
  createWorkspaceField,
  getFieldTypeBindings,
  replaceFieldTypeBindings,
  updateWorkspaceField,
  type FieldCreate,
  type FieldTypeBinding,
  type FieldUpdate,
  type WorkspaceField,
} from "@/app/lib/fieldsApi";
import TypeBindingsPicker, {
  type DraftBinding,
} from "@/app/components/CustomFields/TypeBindingsPicker";

// Rule 2 — custom-field-name prefix. The backend's
// `backend/internal/fields/service.go` pins every workspace-/tenant-scope
// field name to `^c_artefacts_[a-z][a-z0-9_]*$` (regex
// `customFieldNameRe`). Server is the gate (HARD RULE), but the form
// glues the prefix on for the user so they can't trip a 400 from typing
// the wrong shape. We strip the prefix on render (so the editor only
// shows the suffix) and re-attach on submit. Detect-and-pass-through
// guards the edit-mode path where `name` already carries the prefix.
const CUSTOM_FIELD_PREFIX = "c_artefacts_";

function stripFieldPrefix(raw: string): string {
  return raw.startsWith(CUSTOM_FIELD_PREFIX)
    ? raw.slice(CUSTOM_FIELD_PREFIX.length)
    : raw;
}

function attachFieldPrefix(suffix: string): string {
  const t = suffix.trim();
  return t.startsWith(CUSTOM_FIELD_PREFIX) ? t : CUSTOM_FIELD_PREFIX + t;
}

// Closed vocabulary of data_type values the backend accepts. Mirrors
// AllowedFieldTypes in backend/internal/fields/service.go and matches
// the list rendered by the legacy [id]/page.tsx editor.
const DATA_TYPES: { value: string; label: string }[] = [
  { value: "textbox", label: "Textbox" },
  { value: "richtext", label: "Rich text" },
  { value: "integer", label: "Integer" },
  { value: "decimal", label: "Decimal" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" },
  { value: "select", label: "Select (one)" },
  { value: "multiselect", label: "Multi-select" },
  { value: "radio", label: "Radio" },
  { value: "user", label: "User picker" },
  { value: "url", label: "URL" },
];

interface Props {
  workspaceId: string;
  /** null → create-mode; populated WorkspaceField → edit-mode. */
  initial: WorkspaceField | null;
  onCancel: () => void;
  onSaved: (next: WorkspaceField) => void;
  /**
   * Forwarded to TypeBindingsPicker. When set, that artefact type is
   * force-bound (checked + disabled + un-removable). The Form Layout
   * Builder's add-custom-field overlay passes the type being edited so a
   * newly-created field is always available on that type.
   */
  lockedTypeId?: string;
}

export default function CustomFieldEditForm({
  workspaceId,
  initial,
  onCancel,
  onSaved,
  lockedTypeId,
}: Props) {
  const isNew = initial === null;

  // ── Form fields ─────────────────────────────────────────────────────────
  // `name` is the *suffix only* — the prefix is glued on at submit. On
  // edit-mode hydration the existing wire `name` already carries
  // `c_artefacts_`, so strip it so the user sees just their part.
  const [name, setName] = useState(stripFieldPrefix(initial?.name ?? ""));
  const [label, setLabel] = useState(initial?.label ?? "");
  const [dataType, setDataType] = useState(initial?.data_type ?? "textbox");
  const [scope, setScope] = useState<"workspace" | "tenant">(
    initial == null
      ? "workspace"
      : initial.scope === "global"
      ? "tenant"
      : initial.scope,
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [optionsRaw, setOptionsRaw] = useState(
    initial?.options_json
      ? JSON.stringify(initial.options_json, null, 2)
      : "",
  );

  // ── Bindings (controlled by this form; sent to the picker) ─────────────
  const [bindings, setBindings] = useState<DraftBinding[]>([]);
  const [bindingsDirty, setBindingsDirty] = useState(false);

  // ── UI state ───────────────────────────────────────────────────────────
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit mode: hydrate bindings from server. Non-fatal — if the GET
  // fails, the picker stays empty and a subsequent Save will overwrite
  // the binding set. Mirrors the legacy [id]/page.tsx behaviour.
  useEffect(() => {
    let cancelled = false;
    if (initial == null) return;
    void (async () => {
      try {
        const bs = await getFieldTypeBindings(workspaceId, initial.id);
        if (cancelled) return;
        setBindings(
          bs.map((b: FieldTypeBinding) => ({
            artefact_type_id: b.artefact_type_id,
            position: b.position,
            required: b.required,
            default_value: b.default_value,
          })),
        );
        setBindingsDirty(false);
      } catch {
        // Bindings are non-fatal on load. Leave the picker empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, initial]);

  const optionsHelp = useMemo(
    () =>
      dataType === "select" ||
      dataType === "multiselect" ||
      dataType === "radio",
    [dataType],
  );

  // Parse the options_json textarea to either undefined (blank / N/A)
  // or a JSON value. Surfaces a per-call error string when parsing fails.
  const parseOptions = useCallback((): { value: unknown | undefined; err: string | null } => {
    if (!optionsHelp || !optionsRaw.trim()) return { value: undefined, err: null };
    try {
      return { value: JSON.parse(optionsRaw), err: null };
    } catch (e) {
      return {
        value: undefined,
        err: `options_json is not valid JSON: ${(e as Error).message}`,
      };
    }
  }, [optionsHelp, optionsRaw]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !label.trim()) {
        setErr("Name and label are required.");
        return;
      }
      const parsed = parseOptions();
      if (parsed.err) {
        setErr(parsed.err);
        return;
      }
      setErr(null);
      setBusy(true);
      // Rule 2 prefix is glued on here, not stored in `name`. Frontend
      // is defence-in-depth — the backend handler (handler.go::Create)
      // and the Postgres CHECK (mig 160) remain the authoritative gates.
      const wireName = attachFieldPrefix(name);
      try {
        if (isNew) {
          const body: FieldCreate = {
            name: wireName,
            label: label.trim(),
            data_type: dataType,
            scope,
            description: description.trim() || undefined,
            options_json: parsed.value,
          };
          const created = await createWorkspaceField(workspaceId, body);

          // Persist bindings against the new field_id. If the PUT fails
          // the field row is already created; surface the message and
          // hand control back to the parent (which can re-open the row
          // for a retry).
          if (bindings.length > 0) {
            try {
              await replaceFieldTypeBindings(workspaceId, created.id, bindings);
            } catch (be: unknown) {
              setErr(
                "Field created, but bindings failed: " +
                  (be instanceof Error ? be.message : "unknown error") +
                  ". Open the field to retry binding it to artefact types.",
              );
              onSaved(created);
              return;
            }
          }
          onSaved(created);
        } else {
          if (initial == null) return;
          const body: FieldUpdate = {
            name: wireName === initial.name ? undefined : wireName,
            label: label.trim() === initial.label ? undefined : label.trim(),
            data_type: dataType === initial.data_type ? undefined : dataType,
            description:
              description.trim() === (initial.description ?? "")
                ? undefined
                : description.trim() || undefined,
            options_json: parsed.value,
          };
          const updated = await updateWorkspaceField(
            workspaceId,
            initial.id,
            body,
          );
          // Bindings second — only PUT if the picker was touched.
          if (bindingsDirty) {
            try {
              await replaceFieldTypeBindings(workspaceId, initial.id, bindings);
              setBindingsDirty(false);
            } catch (be: unknown) {
              setErr(
                "Field saved, but bindings failed: " +
                  (be instanceof Error ? be.message : "unknown error") +
                  ". Re-click Save to retry.",
              );
              setBusy(false);
              return;
            }
          }
          onSaved(updated);
        }
      } catch (ex) {
        if (ex instanceof ApiError) {
          if (ex.status === 409) {
            setErr(
              "Conflict — either the field name is already in use, or the data-type cannot change because existing values reference this field. Archive and recreate the field if a type change is required.",
            );
          } else if (ex.status === 403) {
            setErr(
              "Forbidden — you do not have permission to manage fields at this visibility level.",
            );
          } else {
            // RFC 9457 Problem Details: ApiError.detail / ApiError.title are
            // already lifted from the body, and ApiError.body is the parsed
            // JSON (NOT a string). The previous `String(ex.body ?? "")` was
            // a bug — it produced "[object Object]" because the body is an
            // object, not a string. Prefer detail → title → JSON dump → fallback.
            const detail = ex.detail ?? ex.title;
            // Rule 2 violation has a distinctive substring — surface a
            // friendlier message the user can act on without reading the
            // raw backend wording.
            if (
              ex.status === 400 &&
              typeof detail === "string" &&
              detail.includes("c_artefacts_")
            ) {
              setErr(
                "Field name must be lower_snake_case starting with a letter (e.g. severity, blocker_reason). The c_artefacts_ prefix is added for you automatically.",
              );
            } else if (detail) {
              setErr(`Error ${ex.status}: ${detail}`);
            } else {
              // No detail/title — dump the body as JSON so the user (and any
              // logs) see SOMETHING actionable instead of "[object Object]".
              let body: string;
              try {
                body = typeof ex.body === "string" ? ex.body : JSON.stringify(ex.body);
              } catch {
                body = String(ex.body ?? "");
              }
              setErr(`Error ${ex.status}: ${body}`);
            }
          }
        } else {
          setErr("Save failed.");
        }
      } finally {
        setBusy(false);
      }
    },
    [
      bindings,
      bindingsDirty,
      dataType,
      description,
      initial,
      isNew,
      label,
      name,
      onSaved,
      parseOptions,
      scope,
      workspaceId,
    ],
  );

  return (
    <form className="form custom-field-edit-form" onSubmit={onSubmit}>
      {err && <div className="form__error">{err}</div>}

      <div className="custom-field-edit-form__Columns">
        {/* ── Left column: form fields ────────────────────────────────── */}
        <div className="custom-field-edit-form__FormCol">
          <div className="custom-field-edit-form__FieldStack">
            {/* Visible-name field FIRST — the field the user actually
                cares about. The machine identifier (slug) follows in
                position 2. Wire payload field names (`name` / `label`)
                are unchanged — only the display labels differ. */}
            <label className="form__label">
              Name
              <input
                type="text"
                className="form__input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Severity"
                required
              />
            </label>

            <label className="form__label">
              Machine identifier
              {/* Rule 2 — read-only prefix affix. The editable input
                  carries only the suffix; the prefix is glued on at
                  submit. CSS in app/globals.css renders the affix as a
                  muted span flush against the input's left edge. */}
              <div className="custom-field-edit-form__PrefixedInput">
                <span
                  className="custom-field-edit-form__InputPrefix"
                  aria-hidden="true"
                >
                  {CUSTOM_FIELD_PREFIX}
                </span>
                <input
                  type="text"
                  className="form__input custom-field-edit-form__InputAfterPrefix"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="severity"
                  required
                  pattern="[a-z][a-z0-9_]*"
                  title="lower_snake_case starting with a letter"
                  disabled={!isNew}
                />
              </div>
              <span className="form__hint">
                The machine identifier is locked to the
                <code> {CUSTOM_FIELD_PREFIX}</code> prefix
                (Rule 2). Type the rest in lower_snake_case.
              </span>
            </label>

            <label className="form__label">
              Data type
              <select
                className="form__select"
                value={dataType}
                onChange={(e) => setDataType(e.target.value)}
                disabled={!isNew}
              >
                {DATA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {!isNew && (
                <span className="form__hint">
                  Changing the data type is blocked if any record stores a value
                  for this field — archive and recreate instead.
                </span>
              )}
            </label>

            <label className="form__label">
              Visibility
              <select
                className="form__select"
                value={scope}
                onChange={(e) =>
                  setScope(e.target.value as "workspace" | "tenant")
                }
                disabled={!isNew}
              >
                <option value="workspace">This workspace only</option>
                <option value="tenant">All workspaces in this tenant</option>
              </select>
              <span className="form__hint">
                {isNew
                  ? "Controls who can manage this field — independent of which artefact types it applies to (set on the right)."
                  : "Visibility is immutable once a field is created."}
              </span>
            </label>

            <label className="form__label">
              Description (optional)
              <textarea
                className="form__textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Helper text shown beneath the input."
              />
            </label>

            {optionsHelp && (
              <label className="form__label">
                Options (JSON array)
                <textarea
                  className="form__textarea"
                  value={optionsRaw}
                  onChange={(e) => setOptionsRaw(e.target.value)}
                  rows={6}
                  placeholder={'["Low","Medium","High"]'}
                />
                <span className="form__hint">
                  Required for select / multi-select / radio. Either an array
                  of strings or an array of <code>{`{value, label}`}</code> objects.
                </span>
              </label>
            )}
          </div>
        </div>

        {/* ── Right column: type bindings picker ──────────────────────── */}
        <div className="custom-field-edit-form__PickerCol">
          <TypeBindingsPicker
            bindings={bindings}
            onChange={(next) => {
              setBindings(next);
              setBindingsDirty(true);
            }}
            disabled={busy}
            lockedTypeId={lockedTypeId}
          />
        </div>
      </div>

      <div className="form__actions">
        <button
          type="button"
          className="btn"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
        >
          {busy ? "Saving…" : isNew ? "Create" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
