// /api/v2/work-items/[id]
//
// GET    - fetch one artefact (work or strategy) by id, scoped to PoC
// PATCH  - rename, re-describe, transition flow state, reassign, reposition
// DELETE - soft archive (sets archived_at)

import { NextRequest, NextResponse } from "next/server";
import { query, POC_SUBSCRIPTION_ID } from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

interface ArtefactDetailRow {
  id: string;
  number: number;
  title: string;
  description: string | null;
  position: number;
  type_id: string;
  type_name: string;
  type_prefix: string;
  type_scope: string;
  state_id: string | null;
  state_name: string | null;
  state_kind: string | null;
  flow_id: string | null;
  parent_artefact_id: string | null;
  created_at: string;
  updated_at: string;
}

async function loadOne(id: string) {
  const { rows } = await query<ArtefactDetailRow>(
    `SELECT
        a.id, a.number, a.title, a.description, a.position,
        at.id     AS type_id,
        at.name   AS type_name,
        at.prefix AS type_prefix,
        at.scope  AS type_scope,
        fs.id     AS state_id,
        fs.name   AS state_name,
        fs.kind   AS state_kind,
        fs.flow_id AS flow_id,
        a.parent_artefact_id,
        a.created_at, a.updated_at
       FROM artefacts a
       JOIN artefact_types at ON at.id = a.artefact_type_id
       LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
      WHERE a.id = $1
        AND a.subscription_id = $2
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
    flow_state_id: string | null;
    position: number;
  }>;

  const sets: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (body.title !== undefined)        { sets.push(`title = $${p++}`);         values.push(body.title); }
  if (body.description !== undefined)  { sets.push(`description = $${p++}`);   values.push(body.description); }
  if (body.flow_state_id !== undefined){ sets.push(`flow_state_id = $${p++}`); values.push(body.flow_state_id); }
  if (body.position !== undefined)     { sets.push(`position = $${p++}`);      values.push(body.position); }

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
