// /api/dev/artefact-types
//
// Internal BFF — see ../field-library/route.ts for the BFF/API distinction.
// Lists every live artefact type (work + strategy) for the PoC subscription.
// The Custom Fields admin uses this to render the type selector and to look
// up an id given a prefix (EP, US, TA, DE, …).

import { NextResponse } from "next/server";
import { query, POC_SUBSCRIPTION_ID } from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

interface ArtefactTypeRow {
  id: string;
  scope: "work" | "strategy";
  source: "system" | "tenant";
  name: string;
  prefix: string;
  parent_type_id: string | null;
  sort_order: number;
}

export async function GET() {
  try {
    const { rows } = await query<ArtefactTypeRow>(
      `SELECT id, scope, source, name, prefix, parent_type_id, sort_order
         FROM artefact_types
        WHERE subscription_id = $1
          AND archived_at IS NULL
        ORDER BY scope, sort_order`,
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
