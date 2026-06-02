import type { SentinelGrant } from "@/app/sentinel/types";

export interface TimeboxOption {
  id: string;
  label: string;
}

export function resolveWorkspaceId(
  userTenantId: string | null | undefined,
  userWorkspaceId: string | null | undefined,
  grants: ReadonlyArray<SentinelGrant>,
  focusNodeId: string | null | undefined,
): string | null {
  // Timebox endpoints currently key `timeboxes_*_id_workspace` with the
  // tenant id used by the sprint/release/milestone pages. Keep this helper
  // aligned with TimeboxObjectTree until that table contract is renamed.
  const tenant = userTenantId?.trim();
  if (tenant) return tenant;
  const direct = userWorkspaceId?.trim();
  if (direct) return direct;
  const focused = grants.find(
    (grant) => grant.node_id === focusNodeId && grant.workspace_id,
  )?.workspace_id;
  if (focused) return focused;
  return grants.find((grant) => grant.workspace_id)?.workspace_id ?? null;
}

export function nodeRelativeTimeboxParams(
  workspaceId: string,
  nodeId: string,
): string {
  return new URLSearchParams({
    workspace_id: workspaceId,
    org_node_id: nodeId,
  }).toString();
}

export function timeboxOption(raw: unknown, kind: "sprint" | "release"): TimeboxOption | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const prefix = kind === "sprint" ? "timeboxes_sprints" : "timeboxes_releases";
  const id = typeof r.id === "string" ? r.id : r[`${prefix}_id`];
  const name = typeof r.label === "string" ? r.label : r[`${prefix}_name`];
  const suffix = r[`${prefix}_suffix`];
  if (typeof id !== "string" || typeof name !== "string") return null;
  const suffixText = typeof suffix === "string" && suffix.trim() ? ` - ${suffix.trim()}` : "";
  return { id, label: `${name}${suffixText}` };
}

export function timeboxOptions(raw: unknown, kind: "sprint" | "release"): TimeboxOption[] {
  const items = (raw as { items?: unknown[] })?.items ?? [];
  return items
    .map((item) => timeboxOption(item, kind))
    .filter((item): item is TimeboxOption => item !== null);
}
