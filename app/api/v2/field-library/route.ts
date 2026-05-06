// /api/v2/field-library
//
// GET  - list every workspace-wide field-library entry in the PoC
//        subscription with adoption counts (how many artefact types bind it).
// POST - create a new field. field_name slug is derived from label if the
//        client does not supply one; uniqueness is enforced by a partial
//        unique index on (subscription_id, field_name) WHERE archived_at IS NULL.

import { NextRequest, NextResponse } from "next/server";
import { query, POC_SUBSCRIPTION_ID } from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

const FIELD_TYPES = [
  "textbox", "richtext", "integer", "decimal", "date", "boolean",
  "select", "multiselect", "radio", "user", "url",
] as const;
type FieldType = typeof FIELD_TYPES[number];

interface FieldLibraryRow {
  id: string;
  field_name: string;
  label: string;
  field_type: FieldType;
  description: string | null;
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

export async function GET() {
  try {
    const { rows } = await query<FieldLibraryRow>(
      `SELECT
          fl.id,
          fl.field_name,
          fl.label,
          fl.field_type,
          fl.description,
          COALESCE(adopt.cnt, 0)::int AS adoption_count,
          fl.created_at,
          fl.updated_at
        FROM field_library fl
        LEFT JOIN (
          SELECT field_library_id, COUNT(*) AS cnt
            FROM artefact_type_fields
           GROUP BY field_library_id
        ) adopt ON adopt.field_library_id = fl.id
        WHERE fl.subscription_id = $1
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
      label?:       string;
      field_type?:  string;
      field_name?:  string;
      description?: string | null;
    };
    if (!body.label?.trim() || !body.field_type) {
      return NextResponse.json(
        { error: "label and field_type are required" },
        { status: 400 },
      );
    }
    if (!FIELD_TYPES.includes(body.field_type as FieldType)) {
      return NextResponse.json(
        { error: `field_type must be one of: ${FIELD_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    const fieldName = (body.field_name?.trim() || slugify(body.label)).toLowerCase();

    const insert = await query<{ id: string }>(
      `INSERT INTO field_library (
          subscription_id, field_name, label, field_type, description
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        POC_SUBSCRIPTION_ID,
        fieldName,
        body.label.trim(),
        body.field_type,
        body.description ?? null,
      ],
    );
    return NextResponse.json({ id: insert.rows[0].id }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const status = /unique|duplicate/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
