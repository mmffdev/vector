// filterRegistry.ts — the static schema for the V2A 31-filter rail.
//
// Each filter is a declarative record: how it's grouped, what it reads
// from the audit, what UI archetype renders it, and whether it ships
// in Phase A (today's data), B (audit tag extension), or C (graph
// pre-compute). The rail renderer is data-driven from this registry.
//
// Adding a new filter = adding one entry here + (if Phase A) one case
// in the dimNode predicate + (if A) one renderer in the rail.

export type Phase = "A" | "B" | "C";

export type FilterArchetype =
  | "chips"            // multi-select chips
  | "radio"            // single-select pill out of N
  | "range"            // numeric range slider
  | "toggle"           // boolean
  | "node-seeded";     // requires a "from" node selection first

export type FilterGroupId =
  | "structure"
  | "connections"
  | "criticality"
  | "surface"
  | "stateStyle"
  | "provenance";

export type FilterDef = {
  id: string;
  label: string;
  group: FilterGroupId;
  archetype: FilterArchetype;
  phase: Phase;
  description: string;
  // Tooltip explaining what data the filter needs when phase ≠ A.
  requires?: string;
};

export const FILTER_GROUPS: { id: FilterGroupId; label: string; subtitle: string }[] = [
  { id: "structure",    label: "Structure",    subtitle: "What kind of file" },
  { id: "connections",  label: "Connections",  subtitle: "How it connects" },
  { id: "criticality",  label: "Criticality",  subtitle: "Risk / blast radius" },
  { id: "surface",      label: "Surface",      subtitle: "Touches X" },
  { id: "stateStyle",   label: "State & Style", subtitle: "Cross-cutting" },
  { id: "provenance",   label: "Provenance",   subtitle: "Where it came from" },
];

export const FILTERS: FilterDef[] = [
  // ── Group 1: Structure ────────────────────────────────────────────────────
  { id: "layer",          label: "Layer",                group: "structure",   archetype: "chips",       phase: "A", description: "page · component · hook · lib · handler · service · sql · …" },
  { id: "side",           label: "Runtime Side",         group: "structure",   archetype: "radio",       phase: "A", description: "frontend · backend · all" },
  { id: "system",         label: "System / Feature Area", group: "structure",  archetype: "chips",       phase: "A", description: "Sentinel · Topology · Roles · Library · Visualiser · …" },
  { id: "uiComposition",  label: "UI Composition",       group: "structure",   archetype: "radio",       phase: "A", description: "page → layout → component → hook ladder" },

  // ── Group 2: Connections ─────────────────────────────────────────────────
  { id: "importDirection", label: "Import Direction",   group: "connections", archetype: "node-seeded", phase: "A", description: "incoming · outgoing · bidirectional · all (requires selected node)" },
  { id: "depth",           label: "Dependency Depth",    group: "connections", archetype: "node-seeded", phase: "A", description: "1-hop · 2-hop · 3-hop · ∞ (requires selected node)" },
  { id: "bridgeKinds",     label: "Bridge Type",         group: "connections", archetype: "chips",       phase: "A", description: "import · bridge (HTTP) — future: event, DB, realtime" },
  { id: "boundaryCrossings", label: "Boundary Crossings", group: "connections", archetype: "toggle",    phase: "A", description: "Show only edges where source.side ≠ target.side" },
  { id: "apiSurface",      label: "API Surface",         group: "connections", archetype: "chips",       phase: "B", description: "callers · handlers · services · DTOs", requires: "Audit tag-system extension (Phase B)" },

  // ── Group 3: Criticality ─────────────────────────────────────────────────
  { id: "fanIn",          label: "Fan-In",               group: "criticality", archetype: "range",       phase: "A", description: "Files imported by many others" },
  { id: "fanOut",         label: "Fan-Out",              group: "criticality", archetype: "range",       phase: "A", description: "Files importing many others" },
  { id: "orphans",        label: "Orphan Nodes",         group: "criticality", archetype: "toggle",      phase: "A", description: "fan_in === 0 (nothing imports this)" },
  { id: "deadEnds",       label: "Dead-End Nodes",       group: "criticality", archetype: "toggle",      phase: "A", description: "fan_out === 0 (imports nothing local)" },
  { id: "cycles",         label: "Circular Dependencies", group: "criticality", archetype: "toggle",     phase: "A", description: "Files in any cycle / loop", requires: "Tarjan SCC runs in audit (now landed)" },
  { id: "criticalPath",   label: "Critical Path",        group: "criticality", archetype: "chips",       phase: "A", description: "Reachable from app boot / login / sentinel boot / api root / tenant switch" },
  { id: "complexity",     label: "Complexity Score",     group: "criticality", archetype: "range",       phase: "A", description: "Composite (0–100): sloc + fan + sensitive tags + bridges + no-test penalty" },

  // ── Group 4: Surface ─────────────────────────────────────────────────────
  { id: "authSurface",    label: "Authentication",       group: "surface",     archetype: "toggle",      phase: "A", description: "Login · sessions · cookies · JWT · DPoP" },
  { id: "authzSurface",   label: "Authorization",        group: "surface",     archetype: "toggle",      phase: "A", description: "Roles · permissions · RBAC checks · route guards" },
  { id: "auditSurface",   label: "Audit / Evidence",     group: "surface",     archetype: "toggle",      phase: "A", description: "Audit logs · history tables · compliance records" },
  { id: "securitySurface", label: "Security-Sensitive",  group: "surface",     archetype: "toggle",      phase: "A", description: "CSRF · DPoP · secrets · credentials · CSP" },
  { id: "errorSurface",   label: "Error Handling",       group: "surface",     archetype: "toggle",      phase: "A", description: "Create · map · display · report errors" },
  { id: "dbSurface",      label: "Database",             group: "surface",     archetype: "toggle",      phase: "A", description: "SQL files · migrations · repo files · transactions" },
  { id: "configSurface",  label: "Configuration / Env",  group: "surface",     archetype: "toggle",      phase: "A", description: "env vars · feature flags · API base URLs" },

  // ── Group 5: State & Style ──────────────────────────────────────────────
  { id: "stateSurface",   label: "State Management",     group: "stateStyle",  archetype: "toggle",      phase: "A", description: "contexts · reducers · localStorage · IndexedDB" },
  { id: "styling",        label: "Styling Dependency",   group: "stateStyle",  archetype: "chips",       phase: "A", description: "Catalog CSS · dev-UI catalog · bespoke classes" },
  { id: "generated",      label: "Generated vs Handwritten", group: "stateStyle", archetype: "radio",    phase: "A", description: "Generated clients/schemas/types vs authored code" },
  { id: "visibility",     label: "Public vs Internal",   group: "stateStyle",  archetype: "radio",       phase: "A", description: "Exported surface vs internal helpers" },

  // ── Group 6: Provenance ─────────────────────────────────────────────────
  { id: "testCoverage",   label: "Test Coverage Proxy",  group: "provenance",  archetype: "radio",       phase: "A", description: "Has sibling test · no test · all" },
  { id: "changeVolatility", label: "Change Volatility",  group: "provenance",  archetype: "range",       phase: "C", description: "Commits in last 90d", requires: "git log pass not yet wired (deferred per user direction)" },
  { id: "ownership",      label: "Ownership / Domain",   group: "provenance",  archetype: "chips",       phase: "C", description: "By folder owner / feature team", requires: "CODEOWNERS or ownership.yaml registry (not present)" },
];

// Sanity-check at module load: every filter belongs to a real group;
// no duplicate ids. Throws at import time if registry is mis-edited.
const seen = new Set<string>();
for (const f of FILTERS) {
  if (seen.has(f.id)) throw new Error(`filterRegistry: duplicate id ${f.id}`);
  seen.add(f.id);
  if (!FILTER_GROUPS.find(g => g.id === f.group)) {
    throw new Error(`filterRegistry: filter ${f.id} has unknown group ${f.group}`);
  }
}

export function filtersInGroup(group: FilterGroupId): FilterDef[] {
  return FILTERS.filter(f => f.group === group);
}
