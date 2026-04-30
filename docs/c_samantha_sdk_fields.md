# Samantha SDK — Fields API Contract

> Story 00157 — formal contract document for the field rendering, schema introspection, and value read/write surface exposed to custom apps via the Samantha SDK. Backed by the three-table artefact pattern (core + `*_schema` + `*_field_values`) shipped in stories 00151–00155.

The Samantha SDK is the in-product API for custom apps. Root namespace: `samantha.portfolio.*`. This doc covers the **fields** sub-surface — everything a custom app needs to render, read, and write artefact field values without knowing the underlying SQL.

---

## Workspace Scoping Guarantee

Every call below is **implicitly scoped to the caller's `subscription_id`**. The host runtime injects subscription context from the authenticated user; SDK methods cannot be called against another workspace. This is enforced two layers deep:

1. **API layer** — every backend handler reads `auth.UserFromCtx(r.Context()).SubscriptionID` and passes it to the service.
2. **DB layer** — `*_schema` tables carry `UNIQUE(subscription_id, field_name)`, and every read/write WHERE clause filters on `subscription_id`.

A custom app **cannot** observe or mutate another workspace's schema or values, even if it knows another workspace's UUID.

---

## Type-to-Renderer Map

The `type` column on `*_schema` rows drives renderer selection. Eleven kinds are valid (CHECK constraint enforced in SQL):

| `type`        | Renderer            | Stored in column   | Postgres type      |
|---------------|---------------------|--------------------|--------------------|
| `textbox`     | single-line input   | `string_value`     | TEXT               |
| `richtext`    | rich text editor    | `text_value`       | TEXT               |
| `integer`     | number input        | `number_value`     | NUMERIC(19,4)      |
| `decimal`     | number input        | `number_value`     | NUMERIC(19,4)      |
| `date`        | date picker         | `date_value`       | DATE               |
| `boolean`     | toggle / checkbox   | `string_value`     | TEXT (`"true"`/`"false"`) |
| `select`      | single-select       | `string_value`     | TEXT (option key)  |
| `multiselect` | multi-select        | `string_value`     | TEXT (JSON array)  |
| `radio`       | radio group         | `string_value`     | TEXT (option key)  |
| `user`        | user picker         | `string_value`     | TEXT (user UUID)   |
| `url`         | URL input           | `string_value`     | TEXT               |

**Renderer selection is deterministic.** Custom apps do not pick a renderer — they pass the schema row and the SDK chooses. This keeps render behaviour consistent across all apps.

---

## `samantha.portfolio.fields.getSchema(artefactType)`

Returns the active field definitions for the caller's workspace + artefact type.

### Signature

```ts
samantha.portfolio.fields.getSchema(artefactType: ArtefactType): Promise<SchemaField[]>
```

### `ArtefactType` (Phase 1)

```ts
type ArtefactType =
  | "execution_user_stories"
  | "execution_defects"
  | "execution_tasks"
  | "execution_test_cases"
  | "strategic"
```

### `SchemaField` shape

```ts
interface SchemaField {
  id: string                  // UUID
  field_name: string          // stable key, e.g. "f_severity"
  label: string               // human label, e.g. "Severity"
  type: FieldKind             // one of the 11 kinds above
  required: boolean
  position: number            // ascending; UI render order
  default_value: string | null
  options_json: string | null // JSONB for select/multiselect/radio
  config_json: string | null  // JSONB for renderer-specific config
  // Audit fields are omitted from the SDK surface
}
```

### Backend route

`GET /api/artefacts/:type/schema` — accessible to all authenticated users (read-only).
`POST/PATCH/DELETE` are **padmin-only** (gated by `RequireRole(RolePAdmin)` middleware).

### Ordering

Returns fields in `position ASC, field_name ASC`. Archived rows are excluded.

---

## `samantha.portfolio.fields.getValue(artefactID, fieldName)` and `getValues(artefactID)`

Reads values for an artefact.

### Single

```ts
samantha.portfolio.fields.getValue(
  artefactID: string,
  fieldName: string
): Promise<FieldValue | null>
```

Returns `null` when no value has been written for that field on that artefact.

### Bulk

```ts
samantha.portfolio.fields.getValues(artefactID: string): Promise<FieldValue[]>
```

Returns all field values for the artefact, ordered by `field_name`.

### `FieldValue` shape

```ts
interface FieldValue {
  id: string                       // UUID
  field_name: string               // matches schema row
  schema_field_id: string | null   // null if schema row was archived
  string_value: string | null
  number_value: string | null      // string to preserve NUMERIC precision
  text_value: string | null
  date_value: string | null        // ISO date "YYYY-MM-DD"
}
```

**Only one typed column is non-null per row.** The SDK provides a helper to extract the active value:

```ts
samantha.portfolio.fields.unwrap(value: FieldValue, schema: SchemaField): unknown
```

`unwrap` returns the typed JS value (`number` for integer/decimal, `Date` for date, `boolean` for boolean, `string[]` for multiselect, `string` otherwise).

### Backend route

`GET /api/artefacts/:type/:id/fields` — visibility-filtered by user role; cross-tenant reads are impossible.

---

## `samantha.portfolio.fields.setValue(artefactID, fieldName, value)` and `setValues(artefactID, values)`

Writes values for an artefact. Upsert semantics — `(artefact_id, field_name)` is unique.

### Single

```ts
samantha.portfolio.fields.setValue(
  artefactID: string,
  fieldName: string,
  value: unknown // typed per the field's `type` — see coercion table below
): Promise<FieldValue>
```

### Bulk

```ts
samantha.portfolio.fields.setValues(
  artefactID: string,
  values: Record<string, unknown>
): Promise<FieldValue[]>
```

### Value coercion

The SDK looks up the schema for `fieldName`, picks the correct typed column, and zeros the others. Inputs are coerced:

| Field `type`              | Accepted JS input                      | Stored in           |
|---------------------------|----------------------------------------|---------------------|
| `textbox`, `url`          | `string`                               | `string_value`      |
| `richtext`                | `string` (HTML or markdown)            | `text_value`        |
| `integer`                 | `number` or numeric `string`           | `number_value`      |
| `decimal`                 | `number` or numeric `string`           | `number_value`      |
| `date`                    | `Date`, ISO `string`, or `null`        | `date_value`        |
| `boolean`                 | `boolean`                              | `string_value` (`"true"`/`"false"`) |
| `select`, `radio`         | `string` (option key)                  | `string_value`      |
| `multiselect`             | `string[]`                             | `string_value` (JSON) |
| `user`                    | `string` (user UUID)                   | `string_value`      |

Coercion failures throw `SamanthaTypeError` synchronously before any network call.

### Backend routes

- `PUT /api/artefacts/:type/:id/fields/:field_name` — single upsert
- `POST /api/artefacts/:type/:id/fields/bulk` — bulk upsert (one DB transaction)

---

## Staged-Write Flow (New Artefacts)

Creating a new artefact with field values is a two-step flow:

```ts
// 1. Create the core row
const artefact = await samantha.portfolio.artefacts.create("execution_defects", {
  title: "Login button stuck",
  owner_id: currentUser.id
})

// 2. Bulk-write field values
await samantha.portfolio.fields.setValues(artefact.id, {
  f_severity: "high",
  f_steps_to_reproduce: "<p>Click login</p>",
  f_first_seen: "2026-04-30"
})
```

**Why two steps:** field values reference `artefact_id`, which doesn't exist until step 1 commits. The SDK does not paper over this — surfacing it makes failure modes obvious (e.g., step 2 fails → custom app can decide to archive the half-written artefact or retry).

A future `createWithFields` helper is in scope but not Phase 1.

---

## `f_` Prefix Convention

Custom field names in API responses **must** be prefixed with `f_` to avoid colliding with reserved core field names (`id`, `title`, `description`, `owner_id`, `created_at`, etc.).

- ✅ `f_severity`
- ✅ `f_steps_to_reproduce`
- ❌ `severity` (reserved namespace)

The backend does not enforce this prefix at write time (yet) — it's a contract custom apps follow. The reference SDK helpers (`samantha.portfolio.fields.create`) prepend `f_` automatically when a name is missing it.

---

## Schema Mutation (Padmin Only)

Custom apps cannot mutate the schema by default — schema management is reserved for padmins via the gated routes:

```
POST   /api/artefacts/:type/schema           — create field
PATCH  /api/artefacts/:type/schema/:id       — update field
DELETE /api/artefacts/:type/schema/:id       — archive field
```

If a custom app needs to define its own fields at install time, it must be installed by a padmin who explicitly approves the schema additions. The install flow is out of scope for this doc.

### Type Immutability

`type` is immutable once any `*_field_values` row references the schema row. The backend checks this on PATCH:

```sql
SELECT COUNT(*) FROM <_field_values> WHERE schema_field_id = $1
```

If `count > 0`, type changes are rejected (the API doesn't even expose `type` on PatchSchemaInput — defence in depth).

### `ON DELETE SET NULL`

When a schema row is archived, existing field values **survive**. Their `schema_field_id` is set to NULL but `field_name` remains denormalised, so the value is still readable. This means archiving a field doesn't lose user data — it just hides the field from new writes.

---

## Error Taxonomy

The SDK surfaces these typed errors:

| Class                    | Cause                                   | HTTP    |
|--------------------------|-----------------------------------------|---------|
| `SamanthaNotFoundError`  | artefact or schema row missing/archived | 404     |
| `SamanthaTypeError`      | client-side coercion failure            | (none)  |
| `SamanthaInvalidKindError` | server rejected unknown `type`        | 400     |
| `SamanthaTypeConflictError` | type change blocked by existing values | 409   |
| `SamanthaForbiddenError` | non-padmin attempted schema mutation    | 403     |
| `SamanthaServerError`    | 5xx — unexpected backend failure        | 500     |

All errors carry `.code`, `.message`, and `.requestID` for tracing.

---

## What's Not in Scope (Phase 1)

- **Field-level visibility / role gating** — column-level access control is Phase 2. Today, all fields visible to a user with artefact-read permission are returned.
- **Field validation rules beyond type + required** — regex, min/max, custom validators are Phase 2.
- **Computed fields / formulas** — Phase 3.
- **Field history / audit trail** — partial (via `o_audit_log`); SDK surface for it is Phase 2.
- **Real-time field subscriptions** — no websocket/SSE surface yet; custom apps must poll.
- **`createWithFields` helper** — Phase 2 ergonomic wrapper around the staged-write flow.

---

## Reference: Backend Implementation

- `backend/internal/artefacts/types.go` — registry, sentinel errors, DTOs
- `backend/internal/artefacts/service.go` — CRUD + schema + field-values logic
- `backend/internal/artefacts/handler.go` — HTTP handlers + error mapping
- `db/schema/060_artefact_schema_tables.sql` — `*_schema` tables
- `db/schema/061_artefact_field_values_reshape.sql` — typed columns + FK

The search index outbox (story 00156) reads from these tables to keep the TSVECTOR + pgvector embedding columns in sync. Custom apps don't interact with that pipeline directly — `setValue` writes trigger the outbox automatically (presumed via the migration 058 trigger).
