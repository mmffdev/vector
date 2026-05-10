// /api/dev/field-library
//
// Internal BFF for the workspace Custom Fields admin UI. NOT a public API
// surface — this lives under /api/dev/* alongside other tenant-internal admin
// operations (plans, library, services). The public Samantha contract for
// reading bound fields stays at GET /workspace/:id/fields on the Go server.
//
// GET  - list every field-library entry in the PoC subscription with adoption
//        counts (how many artefact types bind it).
// POST - create a new field. field_name slug is derived from label if the
//        client does not supply one; uniqueness is enforced by a partial
//        unique index on (subscription_id, field_name) WHERE archived_at IS NULL.
//        Accepts optional options_json (required for select/multiselect/radio)
//        and config_json.

import { NextRequest, NextResponse } from "next/server";
import { query, POC_SUBSCRIPTION_ID } from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

const FIELD_TYPES = [
  "textbox", "richtext", "integer", "decimal", "date", "boolean",
  "select", "multiselect", "radio", "user", "url",
] as const;
type FieldType = typeof FIELD_TYPES[number];

const NEEDS_OPTIONS = new Set<FieldType>(["select", "multiselect", "radio"]);

interface FieldLibraryRow {
  id: string;
  field_name: string;
  label: string;
  field_type: FieldType;
  description: string | null;
  options_json: unknown;
  config_json: unknown;
  adoption_count: number;
  created_at: string;
  updated_at: string;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "field";
}

function parseJsonish(v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
}

export async function GET() {
  try {
    const { rows } = await query<FieldLibraryRow>(
      `SELECT
          fl.id,
          fl.field_name,
          fl.label,
          fl.field_type,
          fl.description,
          fl.options_json,
          fl.config_json,
          COALESCE(adopt.cnt, 0)::int AS adoption_count,
          fl.created_at,
          fl.updated_at
        FROM artefact_field_library fl
        LEFT JOIN (
          SELECT field_library_id, COUNT(*) AS cnt
            FROM artefact_type_fields
           GROUP BY field_library_id
        ) adopt ON adopt.field_library_id = fl.id
        WHERE fl.subscription_id = $1
          AND fl.scope = 'tenant'
          AND fl.archived_at IS NULL
        ORDER BY fl.label`,
      [POC_SUBSCRIPTION_ID],
    );
    return NextResponse.json({ items: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      label?:        string;
      // The component sends `type` (legacy) but new callers may send `field_type`.
      field_type?:   string;
      type?:         string;
      field_name?:   string;
      description?:  string | null;
      options_json?: unknown;
      config_json?:  unknown;
    };

    const fieldType = (body.field_type ?? body.type) as FieldType | undefined;

    if (!body.label?.trim() || !fieldType) {
      return NextResponse.json(
        { error: "label and field_type are required" },
        { status: 400 },
      );
    }
    if (!FIELD_TYPES.includes(fieldType)) {
      return NextResponse.json(
        { error: `field_type must be one of: ${FIELD_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    const optionsJson = parseJsonish(body.options_json);
    const configJson  = parseJsonish(body.config_json);

    if (NEEDS_OPTIONS.has(fieldType)) {
      if (!Array.isArray(optionsJson) || optionsJson.length === 0) {
        return NextResponse.json(
          { error: `field_type "${fieldType}" requires a non-empty options_json array` },
          { status: 400 },
        );
      }
    }

    const fieldName = (body.field_name?.trim() || slugify(body.label)).toLowerCase();

    const insert = await query<{ id: string }>(
      `INSERT INTO artefact_field_library (
          subscription_id, scope, field_name, label, field_type, description,
          options_json, config_json
       ) VALUES ($1, 'tenant', $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        POC_SUBSCRIPTION_ID,
        fieldName,
        body.label.trim(),
        fieldType,
        body.description ?? null,
        optionsJson === null ? null : JSON.stringify(optionsJson),
        configJson  === null ? null : JSON.stringify(configJson),
      ],
    );
    return NextResponse.json({ id: insert.rows[0].id }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const status = /unique|duplicate/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
