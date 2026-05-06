// Compile-time contract test for samantha.portfolio.fields (story 00444).
//
// TypeScript MUST fail to compile this file if any method signature on
// samantha.portfolio.fields diverges from docs/c_samantha_sdk_fields.md.
//
// Run:  npx tsc --noEmit
// No runtime exports — this file exists for the type-checker only.

import type {
  samantha as SamanthaType,
  ArtefactType,
  SchemaField,
  FieldValue,
} from "./samantha";

// Utility: asserts T is assignable to U (compilation fails otherwise).
type Assignable<T, U extends T> = U;

// ── getSchema ─────────────────────────────────────────────────────────────
export type _GetSchema = Assignable<
  (artefactType: ArtefactType) => Promise<SchemaField[]>,
  typeof SamanthaType.portfolio.fields.getSchema
>;

// ── getValues ─────────────────────────────────────────────────────────────
export type _GetValues = Assignable<
  (artefactType: ArtefactType, artefactID: string) => Promise<FieldValue[]>,
  typeof SamanthaType.portfolio.fields.getValues
>;

// ── getValue ──────────────────────────────────────────────────────────────
export type _GetValue = Assignable<
  (artefactType: ArtefactType, artefactID: string, fieldName: string) => Promise<FieldValue | null>,
  typeof SamanthaType.portfolio.fields.getValue
>;

// ── setValue ──────────────────────────────────────────────────────────────
export type _SetValue = Assignable<
  (artefactType: ArtefactType, artefactID: string, fieldName: string, value: unknown) => Promise<FieldValue>,
  typeof SamanthaType.portfolio.fields.setValue
>;

// ── setValues ─────────────────────────────────────────────────────────────
export type _SetValues = Assignable<
  (artefactType: ArtefactType, artefactID: string, values: Record<string, unknown>) => Promise<FieldValue[]>,
  typeof SamanthaType.portfolio.fields.setValues
>;

// ── unwrap ────────────────────────────────────────────────────────────────
export type _Unwrap = Assignable<
  (value: FieldValue, schema: SchemaField) => unknown,
  typeof SamanthaType.portfolio.fields.unwrap
>;
