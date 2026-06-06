// buildCreateRequests — the PURE core of the artefact create flow, extracted
// from ObjectTreeV2's submitCreate (p_ObjectTree.tsx ~L1588) so it can be unit
// tested without a DOM or network. Given the form draft + the chosen type's
// capability flags, it returns the two wire shapes the create flow issues:
//
//   1. a POST  { item_type, title, description?, parent_id?, sprint_id?,
//                story_points?, custom_fields? }  to  <resourceUrl>[?meg=<node>]
//   2. a follow-up PATCH for the fields the create handler does NOT accept yet
//      (release_id, milestone_id, flow_state_id, owned_by_user_id, colour,
//      description_doc) — applied to <resourceUrl>/<newId>.
//
// Splitting create-vs-patch this way keeps the artefact atomic from the user's
// view even though the backend contract is two round-trips. Native acceptance
// of the patch-only fields is tracked as TD-CREATE-ATOMIC-NATIVE-FIELDS.
//
// Pure: no React, no apiSite, no Date/Math.random. The component does the I/O;
// this decides WHAT to send. The path-strip (resourceUrl may carry GET-only
// query params like /risk's ?item_type_id=) and the ?meg= rule live here so a
// test pins the exact param that the Dependencies-style URL bugs come from.

import type { JSONContent } from "@tiptap/react";

export interface CreateDraft {
  title: string;
  description_doc: JSONContent | null;
  parent_id: string;
  topology_node_id: string;
  flow_state_id: string;
  owner_id: string;
  sprint_id: string;
  release_id: string;
  milestone_id: string;
  story_points: string;
  colour: string;
}

export interface CreateTypeFlags {
  // Lowercased artefact-type name the POST handler keys on (e.g. "story").
  itemType: string;
  showSprint: boolean;
  showRelease: boolean;
  showPlanEstimate: boolean;
}

// Where the new artefact lands in the Prio rank. "bottom" is the default
// (Rally-parity); "top" sends it to the front; "after" (duplicate-only) sits it
// beneath afterArtefactId. The backend falls back to "bottom" for anything it
// doesn't recognise, so omitting the field is always safe.
export type RankPlacement = "top" | "bottom" | "after";

export interface BuildCreateInput {
  draft: CreateDraft;
  flags: CreateTypeFlags;
  // Plaintext extracted from description_doc (caller runs docToPlainText —
  // kept out of here so this stays free of TipTap traversal concerns).
  descriptionPlaintext: string;
  // Already-shaped custom-field wire entries (customFieldsToWire output).
  customWire: unknown[];
  // The page's resource base (may carry GET-only query params to strip).
  resourceUrl: string;
  // Active sentinel focus node — the fallback ?meg= when the form's
  // topology dropdown is left unset.
  activeScopeNodeId: string | null;
  // Rank placement for the new row. Omitted/"bottom" → no field on the wire
  // (backend defaults to bottom). "after" additionally requires afterArtefactId.
  rankPlacement?: RankPlacement;
  // Source artefact UUID for "after" placement (duplicate). Ignored otherwise.
  afterArtefactId?: string | null;
}

export interface BuildCreateResult {
  // Path the POST goes to, including ?meg= when a scope node is known.
  postUrl: string;
  postBody: Record<string, unknown>;
  // The bare resource path (no query) — caller appends /<newId> for the PATCH.
  postPath: string;
  // Fields deferred to the follow-up PATCH. Empty object ⇒ no patch needed.
  patchBody: Record<string, unknown>;
}

// Strip any GET-only query string (e.g. /risk's "?item_type_id=<uuid>") so a
// later `${path}?meg=` or `${path}/<id>` concat can't produce a malformed URL.
function stripQuery(resourceUrl: string): string {
  return resourceUrl.split("?")[0];
}

export function buildCreateRequests(input: BuildCreateInput): BuildCreateResult {
  const {
    draft,
    flags,
    descriptionPlaintext,
    customWire,
    resourceUrl,
    activeScopeNodeId,
    rankPlacement,
    afterArtefactId,
  } = input;

  const postBody: Record<string, unknown> = {
    item_type: flags.itemType,
    title: draft.title.trim(),
  };
  if (descriptionPlaintext.trim()) postBody.description = descriptionPlaintext.trim();
  if (draft.parent_id) postBody.parent_id = draft.parent_id;
  if (flags.showSprint && draft.sprint_id) postBody.sprint_id = draft.sprint_id;
  if (customWire.length > 0) postBody.custom_fields = customWire;
  if (flags.showPlanEstimate) {
    const sp = draft.story_points.trim();
    if (sp !== "") {
      const n = parseInt(sp, 10);
      if (Number.isFinite(n)) postBody.story_points = n;
    }
  }
  // Rank placement — only sent when non-default. "bottom" is the backend
  // default, so omitting it keeps the wire lean and matches every legacy
  // caller. "after" carries the source id (duplicate's "under original").
  if (rankPlacement && rankPlacement !== "bottom") {
    postBody.rank_placement = rankPlacement;
    if (rankPlacement === "after" && afterArtefactId) {
      postBody.after_artefact_id = afterArtefactId;
    }
  }

  const postPath = stripQuery(resourceUrl);
  // Prefer the form's topology pick; fall back to the active scope clamp.
  const meg = draft.topology_node_id || activeScopeNodeId || "";
  const postUrl = meg
    ? `${postPath}?meg=${encodeURIComponent(meg)}`
    : postPath;

  // Follow-up PATCH — only the fields the create POST doesn't accept yet, and
  // only when the user actually set them ("absent ⇒ no change").
  const patchBody: Record<string, unknown> = {};
  if (flags.showRelease && draft.release_id) patchBody.release_id = draft.release_id;
  if (draft.milestone_id) patchBody.milestone_id = draft.milestone_id;
  if (draft.flow_state_id) patchBody.flow_state_id = draft.flow_state_id;
  if (draft.owner_id) patchBody.owned_by_user_id = draft.owner_id;
  if (draft.colour) patchBody.colour = draft.colour;
  if (draft.description_doc) patchBody.description_doc = draft.description_doc;

  return { postUrl, postBody, postPath, patchBody };
}
