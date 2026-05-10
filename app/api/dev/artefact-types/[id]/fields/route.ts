// /api/dev/artefact-types/[id]/fields
//
// Bindings between an artefact type and field_library entries. The Custom
// Fields admin uses this to: (a) render the per-type field list, (b) bind a
// new field, (c) reorder/flag required.
//
// GET  - list bindings for the type (joined with field_library for label/type)
// POST - bind one field_library entry to the type. Body:
//          { field_library_id, position?, required?, default_value? }
//        Idempotent within a type — duplicate binding returns 409.

import { NextRequest, NextResponse } from "next/server";
import { query, POC_SUBSCRIPTION_ID } from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

interface BindingRow {
  id: string;
  field_library_id: string;
  field_name: string;
  label: string;
  field_type: string;
  options_json: unknown;
  position: number;
  required: boolean;
  default_value: string | null;
}

async function assertTypeOwned(typeId: string): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM artefact_types
      WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
    [typeId, POC_SUBSCRIPTION_ID],
  );
  return rows.length > 0;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!(await assertTypeOwned(id))) {
      return NextResponse.json({ error: "artefact type not found" }, { status: 404 });
    }

    const { rows } = await query<BindingRow>(
      `SELECT
          atf.id,
          atf.field_library_id,
          fl.field_name,
          fl.label,
          fl.field_type,
          fl.options_json,
          atf.position,
          atf.required,
          atf.default_value
        FROM artefact_type_fields atf
        JOIN artefact_field_library fl ON fl.id = atf.field_library_id
       WHERE atf.artefact_type_id = $1
         AND fl.archived_at IS NULL
       ORDER BY atf.position, fl.label`,
      [id],
    );
    return NextResponse.json({ items: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!(await assertTypeOwned(id))) {
      return NextResponse.json({ error: "artefact type not found" }, { status: 404 });
    }

    const body = (await req.json()) as {
      field_library_id?: string;
      position?:         number;
      required?:         boolean;
      default_value?:    string | null;
    };
    if (!body.field_library_id) {
      return NextResponse.json({ error: "field_library_id required" }, { status: 400 });
    }

    // Verify the field-library entry exists in the same subscription
    // (or is global). Workspace-scope rows aren't valid binding sources from
    // the tenant-wide admin UI.
    const flCheck = await query<{ id: string }>(
      `SELECT id FROM artefact_field_library
        WHERE id = $1
          AND archived_at IS NULL
          AND ( (scope = 'tenant' AND subscription_id = $2)
             OR  scope = 'global' )`,
      [body.field_library_id, POC_SUBSCRIPTION_ID],
    );
    if (flCheck.rows.length === 0) {
      return NextResponse.json({ error: "field_library entry not found" }, { status: 404 });
    }

    const insert = await query<{ id: string }>(
      `INSERT INTO artefact_type_fields (
          artefact_type_id, field_library_id, position, required, default_value
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        id,
        body.field_library_id,
        body.position ?? 100,
        body.required ?? false,
        body.default_value ?? null,
      ],
    );
    return NextResponse.json({ id: insert.rows[0].id }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const status = /unique|duplicate/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
