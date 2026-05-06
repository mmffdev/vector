// /api/v2/strategy-items/[id]
//
// GET    - fetch one strategy artefact by id, scoped to PoC subscription.
// PATCH  - rename, re-describe, reposition, reparent.
// DELETE - soft archive (sets archived_at).

import { NextRequest, NextResponse } from "next/server";
import { query, POC_SUBSCRIPTION_ID } from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

interface StrategyDetailRow {
  id: string;
  number: string;
  title: string;
  description: string | null;
  position: number;
  type_id: string;
  type_name: string;
  type_prefix: string;
  layer_depth: number | null;
  parent_artefact_id: string | null;
  parent_title: string | null;
  parent_prefix: string | null;
  parent_number: string | null;
  created_at: string;
  updated_at: string;
}

async function loadOne(id: string) {
  const { rows } = await query<StrategyDetailRow>(
    `SELECT
        a.id, a.number, a.title, a.description, a.position,
        at.id     AS type_id,
        at.name   AS type_name,
        at.prefix AS type_prefix,
        at.layer_depth,
        a.parent_artefact_id,
        pa.title  AS parent_title,
        pat.prefix AS parent_prefix,
        pa.number  AS parent_number,
        a.created_at, a.updated_at
       FROM artefacts a
       JOIN artefact_types at ON at.id = a.artefact_type_id
       LEFT JOIN artefacts pa ON pa.id = a.parent_artefact_id
       LEFT JOIN artefact_types pat ON pat.id = pa.artefact_type_id
      WHERE a.id = $1
        AND a.subscription_id = $2
        AND at.scope = 'strategy'
        AND a.archived_at IS NULL`,
    [id, POC_SUBSCRIPTION_ID],
  );
  return rows[0] ?? null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const row = await loadOne(id);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as Partial<{
    title: string;
    description: string | null;
    parent_artefact_id: string | null;
    position: number;
  }>;

  const sets: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (body.title !== undefined)              { sets.push(`title = $${p++}`);              values.push(body.title); }
  if (body.description !== undefined)        { sets.push(`description = $${p++}`);        values.push(body.description); }
  if (body.parent_artefact_id !== undefined) { sets.push(`parent_artefact_id = $${p++}`); values.push(body.parent_artefact_id); }
  if (body.position !== undefined)           { sets.push(`position = $${p++}`);           values.push(body.position); }

  if (sets.length === 0) return NextResponse.json({ ok: true });

  values.push(id, POC_SUBSCRIPTION_ID);
  try {
    await query(
      `UPDATE artefacts SET ${sets.join(", ")}
        WHERE id = $${p++} AND subscription_id = $${p}`,
      values,
    );
    const row = await loadOne(id);
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await query(
      `UPDATE artefacts SET archived_at = now()
        WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
      [id, POC_SUBSCRIPTION_ID],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
