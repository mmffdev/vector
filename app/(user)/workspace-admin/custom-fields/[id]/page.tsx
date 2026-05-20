"use client";

// Custom Fields editor — full-page create/edit surface. One route
// handles both: `[id]` segment is the literal "new" or a field UUID.
//
// Why a separate page (not a modal): fields carry options_json,
// config_json, and a description that benefit from more space than
// a modal allows. Matches the "custom fields are universal" framing —
// they're a first-class object, not a sub-form of something else.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { useActiveWorkspace } from "@/app/hooks/useActiveWorkspace";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { ApiError } from "@/app/lib/api";
import {
  createWorkspaceField,
  getWorkspaceFields,
  updateWorkspaceField,
  type FieldCreate,
  type FieldUpdate,
  type WorkspaceField,
} from "@/app/lib/fieldsApi";

// The closed set of data_type values the backend's
// artefacts_fields_library CHECK constraint accepts. Mirrors
// AllowedFieldTypes in backend/internal/fields/service.go.
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

export default function CustomFieldEditorPage() {
  const { full } = usePageTitle();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const activeWorkspaceId = useActiveWorkspace();

  const isNew = params.id === "new";

  // Form state
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [dataType, setDataType] = useState("textbox");
  const [scope, setScope] = useState<"workspace" | "tenant">("workspace");
  const [description, setDescription] = useState("");
  const [optionsRaw, setOptionsRaw] = useState("");

  // Loaded row (for edit mode — null while loading or for "new")
  const [current, setCurrent] = useState<WorkspaceField | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit mode: fetch the field by listing all and picking the row.
  // (No GET-by-id endpoint exists; list is the only read path. The
  // server still 404s for cross-tenant ids — defence in depth.)
  const load = useCallback(async () => {
    if (isNew || !activeWorkspaceId) return;
    setErr(null);
    try {
      const data = await getWorkspaceFields(activeWorkspaceId);
      const match = data.find((f) => f.id === params.id);
      if (!match) {
        setErr("Field not found.");
        setLoading(false);
        return;
      }
      setCurrent(match);
      setName(match.name);
      setLabel(match.label);
      setDataType(match.data_type);
      setScope(match.scope === "global" ? "tenant" : match.scope);
      setDescription(match.description ?? "");
      setOptionsRaw(
        match.options_json
          ? JSON.stringify(match.options_json, null, 2)
          : "",
      );
      setLoading(false);
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? `Error ${e.status}: ${String(e.body ?? "")}`
          : "Failed to load field.",
      );
      setLoading(false);
    }
  }, [activeWorkspaceId, isNew, params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const optionsHelp = useMemo(
    () =>
      dataType === "select" ||
      dataType === "multiselect" ||
      dataType === "radio",
    [dataType],
  );

  // optionsRaw → unknown for the wire (or undefined when blank).
  function parseOptions(): { value: unknown | undefined; err: string | null } {
    if (!optionsHelp || !optionsRaw.trim()) return { value: undefined, err: null };
    try {
      return { value: JSON.parse(optionsRaw), err: null };
    } catch (e) {
      return {
        value: undefined,
        err: `options_json is not valid JSON: ${(e as Error).message}`,
      };
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspaceId) return;
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
    try {
      if (isNew) {
        const body: FieldCreate = {
          name: name.trim(),
          label: label.trim(),
          data_type: dataType,
          scope,
          description: description.trim() || undefined,
          options_json: parsed.value,
        };
        const created = await createWorkspaceField(activeWorkspaceId, body);
        router.push(`/workspace-admin/custom-fields/${created.id}`);
      } else {
        if (!current) return;
        const body: FieldUpdate = {
          name: name.trim() === current.name ? undefined : name.trim(),
          label: label.trim() === current.label ? undefined : label.trim(),
          data_type: dataType === current.data_type ? undefined : dataType,
          description:
            description.trim() === (current.description ?? "")
              ? undefined
              : description.trim() || undefined,
          options_json: parsed.value,
        };
        await updateWorkspaceField(activeWorkspaceId, current.id, body);
        await load();
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          setErr(
            "Conflict — either the field name is already in use, or the data-type cannot change because existing values reference this field. Archive and recreate the field if a type change is required.",
          );
        } else if (e.status === 403) {
          setErr(
            "Forbidden — you do not have permission to manage fields at this scope.",
          );
        } else {
          setErr(`Error ${e.status}: ${String(e.body ?? "")}`);
        }
      } else {
        setErr("Save failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <PageContent>
        <PageHeading level={1} title={full} subtitle="Loading custom field…" />
        <PageDescription title="Custom Field">
          <p className="form__hint">Loading…</p>
        </PageDescription>
      </PageContent>
    );
  }

  return (
    <PageContent>
      <PageHeading
        level={1}
        title={full}
        subtitle={
          isNew
            ? "Create a new custom field."
            : `Edit “${current?.label ?? ""}”.`
        }
      />
      <PageDescription title={isNew ? "New Custom Field" : "Edit Custom Field"}>
        <p className="form__hint">
          The <code>name</code> is the stable machine identifier (used in
          payloads); the <code>label</code> is what end users see. Choose
          a <em>data type</em> carefully — once any artefact, sprint or
          release stores a value against this field, the type is locked
          until the field is archived. The <em>scope</em> decides who
          can manage the field and where it’s visible.
        </p>
      </PageDescription>

      {err && <div className="form__error">{err}</div>}

      <Panel name="custom_field_editor" title={isNew ? "New field" : current?.label ?? "Edit"}>
        <form className="form" onSubmit={onSubmit}>
          <div className="form__grid">
            <label className="form__label">
              Name (machine identifier)
              <input
                type="text"
                className="form__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="severity"
                required
                pattern="[a-z][a-z0-9_]*"
                title="lower_snake_case starting with a letter"
              />
            </label>

            <label className="form__label">
              Label (user-facing)
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
              Data type
              <select
                className="form__select"
                value={dataType}
                onChange={(e) => setDataType(e.target.value)}
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
              Scope
              <select
                className="form__select"
                value={scope}
                onChange={(e) => setScope(e.target.value as "workspace" | "tenant")}
                disabled={!isNew}
              >
                <option value="workspace">Workspace</option>
                <option value="tenant">Tenant</option>
              </select>
              {!isNew && (
                <span className="form__hint">
                  Scope is immutable once a field is created.
                </span>
              )}
            </label>
          </div>

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

          <div className="form__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => router.push("/workspace-admin/custom-fields")}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "Saving…" : isNew ? "Create" : "Save changes"}
            </button>
          </div>
        </form>
      </Panel>
    </PageContent>
  );
}
