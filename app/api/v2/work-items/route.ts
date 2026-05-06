// /api/v2/work-items
//
// GET  - list every work-scope artefact in the PoC subscription with its
//        type, public ID (prefix-number), current state, and assignee
// POST - create a new work-scope artefact under the chosen type, placing it
//        on that type's default flow's initial state. Allocates the next
//        per-(subscription, type) number atomically.

import { NextRequest, NextResponse } from "next/server";
import {
  query,
  POC_SUBSCRIPTION_ID,
  POC_WORKSPACE_ID,
  POC_USER_ID,
} from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

interface WorkItemRow {
  id: string;
  number: number;
  title: string;
  description: string | null;
  position: number;
  type_name: string;
  type_prefix: string;
  state_name: string | null;
  state_kind: string | null;
  parent_artefact_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  try {
    const { rows } = await query<WorkItemRow>(
      `SELECT
          a.id,
          a.number,
          a.title,
          a.description,
          a.position,
          at.name   AS type_name,
          at.prefix AS type_prefix,
          fs.name   AS state_name,
          fs.kind   AS state_kind,
          a.parent_artefact_id,
          a.created_at,
          a.updated_at
        FROM artefacts a
        JOIN artefact_types at ON at.id = a.artefact_type_id
        LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
        WHERE a.subscription_id = $1
          AND at.scope = 'work'
          AND a.archived_at IS NULL
        ORDER BY at.sort_order, a.position, a.number`,
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
      artefact_type_id?: string;
      title?: string;
      description?: string | null;
    };
    if (!body.artefact_type_id || !body.title?.trim()) {
      return NextResponse.json(
        { error: "artefact_type_id and title are required" },
        { status: 400 },
      );
    }

    // Verify type belongs to PoC subscription and is work scope.
    const typeCheck = await query<{ scope: string }>(
      `SELECT scope FROM artefact_types
        WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
      [body.artefact_type_id, POC_SUBSCRIPTION_ID],
    );
    if (typeCheck.rows.length === 0) {
      return NextResponse.json({ error: "type not found" }, { status: 404 });
    }
    if (typeCheck.rows[0].scope !== "work") {
      return NextResponse.json(
        { error: "this endpoint creates work-scope artefacts only" },
        { status: 400 },
      );
    }

    // Initial state on the type's default flow (may be NULL for tenant types
    // without a flow yet - the column is nullable).
    const initial = await query<{ id: string }>(
      `SELECT fs.id
         FROM flow_states fs
         JOIN flows f ON f.id = fs.flow_id
        WHERE f.artefact_type_id = $1
          AND f.is_default = TRUE
          AND f.archived_at IS NULL
          AND fs.is_initial = TRUE
          AND fs.archived_at IS NULL
        LIMIT 1`,
      [body.artefact_type_id],
    );
    const initialStateId = initial.rows[0]?.id ?? null;

    // Next per-(subscription, type) counter. SELECT ... FOR UPDATE would be
    // safer under concurrency; for the PoC the simple max + 1 is fine.
    const numberRow = await query<{ next_number: number }>(
      `SELECT COALESCE(MAX(number), 0) + 1 AS next_number
         FROM artefacts
        WHERE subscription_id = $1 AND artefact_type_id = $2`,
      [POC_SUBSCRIPTION_ID, body.artefact_type_id],
    );
    const nextNumber = numberRow.rows[0].next_number;

    const insert = await query<{ id: string }>(
      `INSERT INTO artefacts (
          subscription_id, workspace_id, artefact_type_id, number,
          title, description, flow_state_id, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        POC_SUBSCRIPTION_ID,
        POC_WORKSPACE_ID,
        body.artefact_type_id,
        nextNumber,
        body.title.trim(),
        body.description ?? null,
        initialStateId,
        POC_USER_ID,
      ],
    );

    return NextResponse.json({ id: insert.rows[0].id, number: nextNumber }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
