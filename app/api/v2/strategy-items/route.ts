// /api/v2/strategy-items
//
// GET  - list every strategy-scope artefact in the PoC subscription with its
//        type, public ID (prefix-number), and parent (if any).
// POST - create a new strategy artefact under the chosen type. If the type
//        has a parent_type_id, parent_artefact_id is required and must point
//        to an artefact whose artefact_type_id == parent_type_id.

import { NextRequest, NextResponse } from "next/server";
import {
  query,
  POC_SUBSCRIPTION_ID,
  POC_WORKSPACE_ID,
  POC_USER_ID,
} from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

interface StrategyItemRow {
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

export async function GET() {
  try {
    const { rows } = await query<StrategyItemRow>(
      `SELECT
          a.id,
          a.number,
          a.title,
          a.description,
          a.position,
          at.id     AS type_id,
          at.name   AS type_name,
          at.prefix AS type_prefix,
          at.layer_depth,
          a.parent_artefact_id,
          pa.title  AS parent_title,
          pat.prefix AS parent_prefix,
          pa.number  AS parent_number,
          a.created_at,
          a.updated_at
        FROM artefacts a
        JOIN artefact_types at ON at.id = a.artefact_type_id
        LEFT JOIN artefacts pa  ON pa.id = a.parent_artefact_id
        LEFT JOIN artefact_types pat ON pat.id = pa.artefact_type_id
        WHERE a.subscription_id = $1
          AND at.scope = 'strategy'
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
      parent_artefact_id?: string | null;
    };
    if (!body.artefact_type_id || !body.title?.trim()) {
      return NextResponse.json(
        { error: "artefact_type_id and title are required" },
        { status: 400 },
      );
    }

    const typeRow = await query<{ scope: string; parent_type_id: string | null }>(
      `SELECT scope, parent_type_id FROM artefact_types
        WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
      [body.artefact_type_id, POC_SUBSCRIPTION_ID],
    );
    if (typeRow.rows.length === 0) {
      return NextResponse.json({ error: "type not found" }, { status: 404 });
    }
    const { scope, parent_type_id } = typeRow.rows[0];
    if (scope !== "strategy") {
      return NextResponse.json(
        { error: "this endpoint creates strategy-scope artefacts only" },
        { status: 400 },
      );
    }

    // Parent rules: if the type expects a parent, parent_artefact_id is
    // required AND must point at an artefact of that parent type.
    if (parent_type_id) {
      if (!body.parent_artefact_id) {
        return NextResponse.json(
          { error: "parent_artefact_id is required for this type" },
          { status: 400 },
        );
      }
      const parent = await query<{ artefact_type_id: string }>(
        `SELECT artefact_type_id FROM artefacts
          WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
        [body.parent_artefact_id, POC_SUBSCRIPTION_ID],
      );
      if (parent.rows.length === 0) {
        return NextResponse.json({ error: "parent not found" }, { status: 404 });
      }
      if (parent.rows[0].artefact_type_id !== parent_type_id) {
        return NextResponse.json(
          { error: "parent type does not match this type's parent_type_id" },
          { status: 400 },
        );
      }
    } else if (body.parent_artefact_id) {
      return NextResponse.json(
        { error: "this type does not allow a parent" },
        { status: 400 },
      );
    }

    const numberRow = await query<{ next_number: string }>(
      `SELECT COALESCE(MAX(number), 0) + 1 AS next_number
         FROM artefacts
        WHERE subscription_id = $1 AND artefact_type_id = $2`,
      [POC_SUBSCRIPTION_ID, body.artefact_type_id],
    );
    const nextNumber = numberRow.rows[0].next_number;

    const insert = await query<{ id: string }>(
      `INSERT INTO artefacts (
          subscription_id, workspace_id, artefact_type_id, number,
          title, description, parent_artefact_id, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        POC_SUBSCRIPTION_ID,
        POC_WORKSPACE_ID,
        body.artefact_type_id,
        nextNumber,
        body.title.trim(),
        body.description ?? null,
        body.parent_artefact_id ?? null,
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
