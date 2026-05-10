// /api/dev/artefact-types/[id]/fields/[fieldLibraryId]
//
// PATCH  - update binding-level state (position / required / default_value)
// DELETE - unbind a field from this type (does NOT archive the field itself)

import { NextRequest, NextResponse } from "next/server";
import { query, POC_SUBSCRIPTION_ID } from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

async function assertTypeOwned(typeId: string): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM artefact_types
      WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
    [typeId, POC_SUBSCRIPTION_ID],
  );
  return rows.length > 0;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; fieldLibraryId: string }> },
) {
  try {
    const { id, fieldLibraryId } = await ctx.params;
    if (!(await assertTypeOwned(id))) {
      return NextResponse.json({ error: "artefact type not found" }, { status: 404 });
    }

    const body = (await req.json()) as {
      position?:      number;
      required?:      boolean;
      default_value?: string | null;
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (body.position !== undefined) {
      sets.push(`position = $${p++}`);
      params.push(body.position);
    }
    if (body.required !== undefined) {
      sets.push(`required = $${p++}`);
      params.push(body.required);
    }
    if (body.default_value !== undefined) {
      sets.push(`default_value = $${p++}`);
      params.push(body.default_value);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    params.push(id, fieldLibraryId);
    const res = await query<{ id: string }>(
      `UPDATE artefact_type_fields
          SET ${sets.join(", ")}
        WHERE artefact_type_id = $${p++}
          AND field_library_id = $${p}
        RETURNING id`,
      params,
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "binding not found" }, { status: 404 });
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
  ctx: { params: Promise<{ id: string; fieldLibraryId: string }> },
) {
  try {
    const { id, fieldLibraryId } = await ctx.params;
    if (!(await assertTypeOwned(id))) {
      return NextResponse.json({ error: "artefact type not found" }, { status: 404 });
    }

    const res = await query<{ id: string }>(
      `DELETE FROM artefact_type_fields
        WHERE artefact_type_id = $1
          AND field_library_id = $2
        RETURNING id`,
      [id, fieldLibraryId],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "binding not found" }, { status: 404 });
    }
    return NextResponse.json({ id: res.rows[0].id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
