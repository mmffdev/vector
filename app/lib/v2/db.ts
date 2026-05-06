// Phase 2 PoC: direct pg client to vector_artefacts.
//
// This is intentionally separate from the Go backend - per the project brief
// the API gets backfilled in Go once the PoC sticks. Until then, server-side
// route handlers under app/api/v2/* talk to vector_artefacts through this
// pool.
//
// `globalThis` cache keeps a single pool across HMR reloads in dev so we
// don't leak connections every time a route module recompiles.

import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __vectorArtefactsPool: Pool | undefined;
}

function buildPool(): Pool {
  const url = process.env.VECTOR_ARTEFACTS_DB_URL;
  if (!url) {
    throw new Error(
      "VECTOR_ARTEFACTS_DB_URL is not set. " +
      "Add it to .env.local at the project root.",
    );
  }
  return new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
}

export function pool(): Pool {
  if (!globalThis.__vectorArtefactsPool) {
    globalThis.__vectorArtefactsPool = buildPool();
  }
  return globalThis.__vectorArtefactsPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[] }> {
  const res = await pool().query(text, params as never);
  return { rows: res.rows as T[] };
}

// Phase 2 PoC scope: single fixture subscription. Real auth wiring comes with
// the API backfill - until then every v2 endpoint operates against this
// subscription, which the Phase 1 seed populated with the 4 system work types.
export const POC_SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000001";
export const POC_WORKSPACE_ID    = "00000000-0000-0000-0000-000000000002";
export const POC_USER_ID         = "00000000-0000-0000-0000-000000000099";
