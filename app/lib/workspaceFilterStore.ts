// PLA-0054 / story 00591 — per-workspace filter persistence.
//
// Chip filter selection (e.g. `{ item_type_id: ['uuid-1', 'uuid-2'] }`)
// is round-tripped via localStorage under a workspace-scoped key so
// switching workspace drops the previous selection naturally — no
// explicit teardown, just a new key.
//
// Schema: JSON object keyed by query-param name, values are string[].
// Storage is plain localStorage; if the runtime doesn't expose it
// (SSR, restricted iframe, jsdom misconfig), reads return null and
// writes are silently dropped so callers can branch on null without
// try/catch noise.

const STORAGE_PREFIX = "vector:wsfilter:";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = window.localStorage;
    if (ls == null) return null;
    if (typeof ls.getItem !== "function") return null;
    if (typeof ls.setItem !== "function") return null;
    return ls;
  } catch {
    return null;
  }
}

function keyFor(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

export function readFilterFor(workspaceId: string): Record<string, string[]> | null {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(keyFor(workspaceId));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return null;
    return parsed as Record<string, string[]>;
  } catch {
    return null;
  }
}

export function writeFilterFor(workspaceId: string, filter: Record<string, string[]>): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(keyFor(workspaceId), JSON.stringify(filter));
  } catch {
    // Quota or restricted storage — drop silently. Filter persistence
    // is convenience, not correctness; in-page state still works.
  }
}

export function clearFilterFor(workspaceId: string): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.removeItem(keyFor(workspaceId));
  } catch {
    // ignore
  }
}
