// ArtefactInlineForm — shared types.
//
// Reusable inline form rendered below an ObjectTree row when the user
// clicks the coloured artefact-type badge. Driven entirely by props so
// the same component lives in work-items, portfolio-items, sprints,
// releases, and any future artefact-listing surface.

export interface ArtefactInlineFormProps {
  // null → form is collapsed. Setting to a non-null id triggers fetch
  // + open animation.
  artefactId: string | null;
  // Backend resource prefix — "/work-items" or "/portfolio-items".
  // Picks which apiSite namespace handles the read/write.
  resourceUrl: string;
  // For routing parent-candidate queries. "work" or "strategy".
  scope: "work" | "strategy";
  // Collapse the form. Pure UX — no save flush needed since auto-save
  // on blur is already flushed.
  onClose: () => void;
  // Mirror PATCH into the host's tree row optimistically.
  onSaved?: (body: Record<string, unknown>) => void;

  // ── Action-bar handlers ────────────────────────────────────────────
  // Each receives the loaded ArtefactDetail so the host has every id +
  // clamp it needs (artefact.id, subscription_id, artefact_type_id,
  // topology_node_id, parent_id, key_num, type_prefix). The form is a
  // pure surface — it doesn't open modals, navigate, or call mutation
  // APIs itself; the host decides what each action does. All optional;
  // a button whose handler is undefined still renders but is a no-op
  // (visual placeholder for in-progress wiring).
  onDuplicate?: (artefact: ArtefactDetail) => void;
  onAddTasks?: (artefact: ArtefactDetail) => void;
  onDependencies?: (artefact: ArtefactDetail) => void;
  onDiscussion?: (artefact: ArtefactDetail) => void;
  onHistory?: (artefact: ArtefactDetail) => void;
  onDelete?: (artefact: ArtefactDetail) => void;
}

// Wire shape returned by workItems.get / portfolioItems.get plus the
// first-class columns added in migration 084 + 085 + 087. Mirrors
// backend/internal/artefactitems/types.go WorkItem. Action handlers
// (onDuplicate, onAddTasks, onDelete, etc.) receive this shape so the
// host has every id + clamp it needs without re-fetching.
//
// Required fields are those the backend ALWAYS returns (verified
// against artefactitems/sql.go sqlWorkItemColumns + scanWorkItemRow).
// Nullable columns use `... | null`; truly optional fields use `?`.
export interface ArtefactDetail {
  id: string;
  subscription_id: string;
  key_num: number;
  item_type: string;
  type_prefix: string;
  artefact_type_id: string;
  title: string;
  description: string | null;
  status: string;
  flow_state_id: string;
  flow_state_name: string;
  flow_state_code: string;
  priority_id: string;
  story_points: number | null;
  sprint_id: string | null;
  parent_id: string | null;
  owner_id: string;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  topology_node_id: string | null;
  // ArtefactInlineForm first-class columns.
  colour: string | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  release_id: string | null;
  milestone_id: string | null;
}

export interface ParentOption {
  id: string;
  label: string;       // e.g. "EP-12 — Onboarding revamp"
  prefix: string;
  key_num: number;
}

// Allowed-parent prefix map. Hard-coded for v1 — promotion to dynamic
// resolution via artefact_types.parent_type_id is tracked as
// TD-PARENT-CANDIDATES-DYNAMIC in docs/c_tech_debt.md.
export const PARENT_PREFIX_MAP: Record<string, string[]> = {
  TA: ["DE", "US"],         // Task → Defect or Story
  US: ["FE", "EP"],         // Story → Feature or Epic
  DE: ["EP", "US"],         // Defect → Epic or Story
};
