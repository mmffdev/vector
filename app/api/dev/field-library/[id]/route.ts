// /api/dev/field-library/[id]
//
// Internal BFF — see ../route.ts header.
//
// GET    - fetch one field
// PATCH  - rename label / change description / replace options_json|config_json
//          (field_type and field_name slug are intentionally immutable here;
//          changing them once values exist would need a schema migration).
// DELETE - soft-archive (archived_at = now()). Refuses if any artefact_type
//          still binds the field; caller must unbind first.

import { NextRequest, NextResponse } from "next/server";
import { query, POC_SUBSCRIPTION_ID } from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

interface FieldLibraryRow {
  id: string;
  field_name: string;
  label: string;
  field_type: string;
  description: string | null;
  options_json: unknown;
  config_json: unknown;
  created_at: string;
  updated_at: string;
}

function parseJsonish(v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const { rows } = await query<FieldLibraryRow>(
      `SELECT id, field_name, label, field_type, description,
              options_json, config_json, created_at, updated_at
         FROM artefact_field_library
        WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
      [id, POC_SUBSCRIPTION_ID],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ item: rows[0] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      label?:        string;
      description?:  string | null;
      options_json?: unknown;
      config_json?:  unknown;
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (body.label !== undefined) {
      const trimmed = body.label.trim();
      if (!trimmed) {
        return NextResponse.json({ error: "label cannot be empty" }, { status: 400 });
      }
      sets.push(`label = $${p++}`);
      params.push(trimmed);
    }
    if (body.description !== undefined) {
      sets.push(`description = $${p++}`);
      params.push(body.description);
    }
    if (body.options_json !== undefined) {
      const parsed = parseJsonish(body.options_json);
      sets.push(`options_json = $${p++}`);
      params.push(parsed === null ? null : JSON.stringify(parsed));
    }
    if (body.config_json !== undefined) {
      const parsed = parseJsonish(body.config_json);
      sets.push(`config_json = $${p++}`);
      params.push(parsed === null ? null : JSON.stringify(parsed));
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    params.push(id, POC_SUBSCRIPTION_ID);
    const res = await query<{ id: string }>(
      `UPDATE artefact_field_library
          SET ${sets.join(", ")}
        WHERE id = $${p++}
          AND subscription_id = $${p}
          AND archived_at IS NULL
        RETURNING id`,
      params,
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ id: res.rows[0].id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;

    const adoptions = await query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM artefact_type_fields WHERE field_library_id = $1`,
      [id],
    );
    if (Number(adoptions.rows[0]?.cnt ?? 0) > 0) {
      return NextResponse.json(
        { error: "field is still bound to one or more artefact types - unbind first" },
        { status: 409 },
      );
    }

    const res = await query<{ id: string }>(
      `UPDATE artefact_field_library
          SET archived_at = now()
        WHERE id = $1
          AND subscription_id = $2
          AND archived_at IS NULL
        RETURNING id`,
      [id, POC_SUBSCRIPTION_ID],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ id: res.rows[0].id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
