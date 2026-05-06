// Samantha SDK — in-product API surface for custom-app authors.
//
// This file is the runtime root of `samantha.*`. Keep the namespace
// shape append-only — every release bumps a sub-surface version
// independently of the others, so a v1 contract MUST stay
// source-compatible until v2 is published.
//
// Sub-surfaces registered:
//   samantha.portfolio.fields v1 — see docs/c_samantha_sdk_fields.md

import { api, ApiError } from "./api";

// ── Types ──────────────────────────────────────────────────────────────────

export type FieldKind =
  | "textbox" | "richtext" | "integer" | "decimal" | "date"
  | "boolean" | "select" | "multiselect" | "radio" | "user" | "url";

export type ArtefactType =
  | "execution_user_stories"
  | "execution_defects"
  | "execution_tasks"
  | "execution_test_cases"
  | "strategic";

export interface SchemaField {
  id: string;
  field_name: string;
  label: string;
  type: FieldKind;
  required: boolean;
  position: number;
  default_value: string | null;
  options_json: string | null;
  config_json: string | null;
}

export interface FieldValue {
  id: string;
  field_name: string;
  schema_field_id: string | null;
  string_value: string | null;
  number_value: string | null;
  text_value: string | null;
  date_value: string | null;
}

// ── Error classes ──────────────────────────────────────────────────────────

export class SamanthaError extends Error {
  code: string;
  requestID?: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SamanthaError";
    this.code = code;
  }
}

export class SamanthaNotFoundError extends SamanthaError {
  constructor(message = "Not found") { super("NOT_FOUND", message); this.name = "SamanthaNotFoundError"; }
}

export class SamanthaTypeError extends SamanthaError {
  constructor(message: string) { super("TYPE_ERROR", message); this.name = "SamanthaTypeError"; }
}

export class SamanthaInvalidKindError extends SamanthaError {
  constructor(message = "Invalid field kind") { super("INVALID_KIND", message); this.name = "SamanthaInvalidKindError"; }
}

export class SamanthaTypeConflictError extends SamanthaError {
  constructor(message = "Type change blocked by existing values") { super("TYPE_CONFLICT", message); this.name = "SamanthaTypeConflictError"; }
}

export class SamanthaForbiddenError extends SamanthaError {
  constructor(message = "Forbidden") { super("FORBIDDEN", message); this.name = "SamanthaForbiddenError"; }
}

export class SamanthaServerError extends SamanthaError {
  constructor(message = "Server error") { super("SERVER_ERROR", message); this.name = "SamanthaServerError"; }
}

// ── Internal helpers ───────────────────────────────────────────────────────

function rethrow(err: unknown): never {
  if (err instanceof SamanthaError) throw err;
  if (err instanceof ApiError) {
    if (err.status === 404) throw new SamanthaNotFoundError(err.detail ?? err.message);
    if (err.status === 400) throw new SamanthaInvalidKindError(err.detail ?? err.message);
    if (err.status === 403) throw new SamanthaForbiddenError(err.detail ?? err.message);
    if (err.status === 409) throw new SamanthaTypeConflictError(err.detail ?? err.message);
    throw new SamanthaServerError(err.detail ?? err.message);
  }
  throw err;
}

type WriteBody = {
  string_value?: string | null;
  number_value?: string | null;
  text_value?: string | null;
  date_value?: string | null;
};

// Coerces a JS value to the correct typed column for the given schema field.
// Throws SamanthaTypeError synchronously before any network call on mismatch.
function coerce(schema: SchemaField, value: unknown): WriteBody {
  const f = schema.field_name;
  switch (schema.type) {
    case "textbox":
    case "url":
    case "select":
    case "radio":
    case "user":
      if (typeof value !== "string") throw new SamanthaTypeError(`"${f}" expects a string`);
      return { string_value: value };
    case "boolean":
      if (typeof value !== "boolean") throw new SamanthaTypeError(`"${f}" expects a boolean`);
      return { string_value: value ? "true" : "false" };
    case "multiselect":
      if (!Array.isArray(value) || !value.every(v => typeof v === "string"))
        throw new SamanthaTypeError(`"${f}" expects string[]`);
      return { string_value: JSON.stringify(value) };
    case "richtext":
      if (typeof value !== "string") throw new SamanthaTypeError(`"${f}" expects a string`);
      return { text_value: value };
    case "integer":
    case "decimal":
      if (typeof value !== "number" && typeof value !== "string")
        throw new SamanthaTypeError(`"${f}" expects a number or numeric string`);
      return { number_value: String(value) };
    case "date":
      if (value === null) return { date_value: null };
      if (value instanceof Date) return { date_value: value.toISOString().split("T")[0] };
      if (typeof value === "string") return { date_value: value };
      throw new SamanthaTypeError(`"${f}" expects a Date, ISO string, or null`);
    default:
      throw new SamanthaInvalidKindError(`Unknown field kind: ${(schema as SchemaField).type}`);
  }
}

// ── samantha.portfolio.fields ──────────────────────────────────────────────

const fields = {
  // Returns active schema fields for the caller's workspace + artefact type,
  // ordered by position ASC, field_name ASC. Archived rows excluded.
  getSchema: async (artefactType: ArtefactType): Promise<SchemaField[]> => {
    try {
      return await api<SchemaField[]>(`/api/artefacts/${artefactType}/schema`);
    } catch (err) {
      rethrow(err);
    }
  },

  // Returns all field values for an artefact, ordered by field_name.
  getValues: async (artefactType: ArtefactType, artefactID: string): Promise<FieldValue[]> => {
    try {
      return await api<FieldValue[]>(`/api/artefacts/${artefactType}/${artefactID}/fields`);
    } catch (err) {
      rethrow(err);
    }
  },

  // Returns the value for a single field, or null if never written.
  getValue: async (artefactType: ArtefactType, artefactID: string, fieldName: string): Promise<FieldValue | null> => {
    const values = await fields.getValues(artefactType, artefactID);
    return values.find(v => v.field_name === fieldName) ?? null;
  },

  // Upserts a single field value. Coerces value to the correct typed column;
  // throws SamanthaTypeError synchronously on mismatch before any network call.
  setValue: async (
    artefactType: ArtefactType,
    artefactID: string,
    fieldName: string,
    value: unknown,
  ): Promise<FieldValue> => {
    const schema = await fields.getSchema(artefactType);
    const field = schema.find(f => f.field_name === fieldName);
    if (!field) throw new SamanthaNotFoundError(`Schema field "${fieldName}" not found`);
    const body = coerce(field, value);
    try {
      return await api<FieldValue>(
        `/api/artefacts/${artefactType}/${artefactID}/fields/${fieldName}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
    } catch (err) {
      rethrow(err);
    }
  },

  // Bulk-upserts field values in a single DB transaction.
  // Coerces all values before the network call; throws SamanthaTypeError
  // synchronously if any field is invalid.
  setValues: async (
    artefactType: ArtefactType,
    artefactID: string,
    values: Record<string, unknown>,
  ): Promise<FieldValue[]> => {
    const schema = await fields.getSchema(artefactType);
    const body: Record<string, WriteBody> = {};
    for (const [fieldName, value] of Object.entries(values)) {
      const field = schema.find(f => f.field_name === fieldName);
      if (!field) throw new SamanthaNotFoundError(`Schema field "${fieldName}" not found`);
      body[fieldName] = coerce(field, value);
    }
    try {
      return await api<FieldValue[]>(
        `/api/artefacts/${artefactType}/${artefactID}/fields/bulk`,
        { method: "POST", body: JSON.stringify(body) },
      );
    } catch (err) {
      rethrow(err);
    }
  },

  // Extracts the typed JS value from a FieldValue row.
  // integer/decimal → number; date → ISO string | null; boolean → boolean;
  // multiselect → string[]; richtext → string | null; all others → string | null.
  unwrap: (value: FieldValue, schema: SchemaField): unknown => {
    switch (schema.type) {
      case "integer":
      case "decimal":
        return value.number_value !== null ? Number(value.number_value) : null;
      case "date":
        return value.date_value;
      case "boolean":
        return value.string_value === "true";
      case "multiselect":
        return value.string_value !== null ? (JSON.parse(value.string_value) as string[]) : [];
      case "richtext":
        return value.text_value;
      default:
        return value.string_value;
    }
  },
};

// ── samantha root ──────────────────────────────────────────────────────────

export const samantha = {
  portfolio: {
    fields,
  },
};

export default samantha;
