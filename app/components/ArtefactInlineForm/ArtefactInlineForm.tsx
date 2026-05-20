"use client";

import React, { useEffect, useState } from "react";
import {
  topology,
  sprints,
  releases,
  milestones,
  lookups,
  workItems,
  type OrgNode,
  type Timebox,
  type Milestone,
  type UserInScope,
} from "@/app/lib/apiSite";
import { useActiveWorkspace } from "@/app/hooks/useActiveWorkspace";
import { useScope } from "@/app/contexts/ScopeContext";
import { ColourPicker } from "@/app/components/ColourPicker";
import { ArtefactNodeDiagram } from "@/app/components/ArtefactNodeDiagram";
import { RichTextField } from "@/app/components/RichTextField";
import { BlockedToggle } from "./BlockedToggle";
import { useArtefactInline } from "./useArtefactInline";
import { useParentCandidates } from "./useParentCandidates";
import type { ArtefactInlineFormProps } from "./types";

interface FlowStateLite {
  id: string;
  name: string;
  flow_position?: number;
  canonical_code?: string;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Body of the inline form — assumes `artefactId` is non-null. The
// `<index.tsx>` envelope handles the open/closed animation and only
// mounts this body when an id is set, so we don't fetch on a closed
// pane.
export function ArtefactInlineForm({
  artefactId,
  resourceUrl,
  scope,
  onClose,
  onSaved,
  onDuplicate,
  onAddTasks,
  onDependencies,
  onDiscussion,
  onHistory,
  onDelete,
  onNavigate,
  isDuplicate,
}: ArtefactInlineFormProps) {
  const workspaceId = useActiveWorkspace();
  const { activeNodeId: activeScopeNodeId } = useScope();
  const { artefact, loading, error, patch } = useArtefactInline({
    artefactId,
    resourceUrl,
    onSaved,
  });

  // Local mirrors for text fields so the user can type without each
  // keystroke triggering a re-render of the whole form. Committed via
  // onBlur ⇒ patch(). Description is owned by the RichTextField itself
  // (JSON doc) — no draft mirror here.
  const [titleDraft, setTitleDraft] = useState("");
  const [pointsDraft, setPointsDraft] = useState("");

  // Delete-confirm guard. First Delete click flips this true → the
  // title head goes red, the Delete button becomes "Confirm Delete",
  // and the Duplicate slot becomes a "Cancel" that reverts everything.
  // Auto-cleared whenever the loaded artefact id changes (user navigated
  // to a different row mid-confirm) so we don't carry a confirm-armed
  // state across artefacts.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => {
    setConfirmingDelete(false);
  }, [artefactId]);

  useEffect(() => {
    setTitleDraft(artefact?.title ?? "");
    setPointsDraft(
      artefact?.story_points == null ? "" : String(artefact.story_points),
    );
  }, [artefact?.id, artefact?.title, artefact?.story_points]);

  // Right-column dropdown sources.
  const [topologyNodes, setTopologyNodes] = useState<OrgNode[]>([]);
  const [flowStates, setFlowStates] = useState<FlowStateLite[]>([]);
  const [users, setUsers] = useState<UserInScope[]>([]);
  const [sprintList, setSprintList] = useState<Timebox[]>([]);
  const [releaseList, setReleaseList] = useState<Timebox[]>([]);
  const [milestoneList, setMilestoneList] = useState<Milestone[]>([]);

  const { candidates: parentCandidates } = useParentCandidates({
    typePrefix: artefact?.type_prefix ?? null,
    scope,
    workspaceId,
  });

  useEffect(() => {
    if (!artefact || !workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const [topo, fs, us, sp, rel, ms] = await Promise.all([
          // GET /_site/topology/tree — backend resolves workspace via
          // JWT clamp and narrows the result by the active topology
          // scope (?meg= header forwarded by apiSite()). Bare array
          // response, not { nodes: ... }.
          topology.tree().catch(() => [] as OrgNode[]),
          // GET /_site/work-items/flow-states?artefact_type_id=<id>
          // returns ONLY this artefact's type's flow states. Without
          // the filter the backend falls back to "first work-scoped
          // type" which doesn't match e.g. Risk or custom types.
          workItems
            .listFlowStates(`artefact_type_id=${encodeURIComponent(artefact.artefact_type_id)}`)
            .catch(() => ({ flow_states: [] as unknown[] })),
          lookups.usersInScope().catch(() => ({ users: [] as UserInScope[], count: 0 })),
          sprints.list(`workspace_id=${workspaceId}`).catch(() => ({ sprints: [] as Timebox[] })),
          releases.list(`workspace_id=${workspaceId}`).catch(() => ({ releases: [] as Timebox[] })),
          milestones.list(`workspace_id=${workspaceId}`).catch(() => ({ milestones: [] as Milestone[], count: 0 })),
        ]);
        if (cancelled) return;
        setTopologyNodes(Array.isArray(topo) ? topo : []);
        setFlowStates(((fs as { flow_states: unknown[] }).flow_states ?? []) as FlowStateLite[]);
        setUsers((us as { users: UserInScope[] }).users ?? []);
        setSprintList((sp as { sprints: Timebox[] }).sprints ?? []);
        setReleaseList((rel as { releases: Timebox[] }).releases ?? []);
        setMilestoneList((ms as { milestones: Milestone[] }).milestones ?? []);
      } catch {
        // Falls through to empty dropdowns; individual catches above
        // mean any one source failing doesn't poison the others.
      }
    })();
    return () => { cancelled = true; };
  }, [artefact?.id, workspaceId]);

  if (loading && !artefact) {
    return (
      <div className="artefact-inline-form__Container_Loading">
        Loading…
      </div>
    );
  }
  if (error || !artefact) {
    return (
      <div className="artefact-inline-form__Container_Error">
        {error ?? "No artefact loaded."}
      </div>
    );
  }

  // The artefact's id is used to key the rendered children so React
  // resets local state cleanly when the user moves to a different row.
  // Add Tasks is only meaningful for execution-leaf parents — Defects
  // and User Stories. Epics and the strategic ladder (Theme / BO /
  // Feature / Product / Runway) don't directly own Task children.
  const canAddTasks =
    artefact.type_prefix === "DE" || artefact.type_prefix === "US";

  return (
    <div className="artefact-inline-form__Container" key={artefact.id}>
      <header
        className={
          "artefact-inline-form__Container_Head" +
          // --deleting wins over --duplicate when both apply: confirming
          // a delete on a freshly-duplicated row should show the danger
          // colour, not the amber clone colour.
          (confirmingDelete
            ? " artefact-inline-form__Container_Head--deleting"
            : isDuplicate
            ? " artefact-inline-form__Container_Head--duplicate"
            : "")
        }
      >
        <h3 className="artefact-inline-form__Container_Head_Title">
          {artefact.type_prefix}-{artefact.key_num} — {artefact.title || "(untitled)"}
        </h3>
      </header>

      {/* Action bar — same height + padding as ObjectTree's top action
          bar. Border-bottom (not top) so it visually separates from the
          form fields below while keeping the title head flush above.
          Handlers are blank for now; wire individually as features
          ship. */}
      <div
        className="artefact-inline-form__Actionbar"
        role="toolbar"
        aria-label="Artefact actions"
      >
        {/* Two layouts:
            - Normal: Duplicate | Add Tasks? | Dependencies | Discussion
              | History | (spacer) | Delete  — Delete moved to be the
              last left-cluster button (just right of the others, before
              the flex spacer pushes anything else away). Spacer kept
              so the bar still stretches edge-to-edge.
            - Confirming: Cancel | Confirm Delete only, both far-left.
              Everything else is hidden (not just disabled) so the user
              focuses on the choice they're making. */}
        {confirmingDelete ? (
          <>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--sm artefact-inline-form__Actionbar_Btn--danger artefact-inline-form__Actionbar_Btn--confirm"
              onClick={() => onDelete?.(artefact)}
            >
              Confirm Delete
            </button>
            <span className="artefact-inline-form__Actionbar_Spacer" />
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onDuplicate?.(artefact)}
            >
              Duplicate
            </button>
            {canAddTasks && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onAddTasks?.(artefact)}
              >
                Add Tasks
              </button>
            )}
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onDependencies?.(artefact)}
            >
              Dependencies
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onDiscussion?.(artefact)}
            >
              Discussion
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onHistory?.(artefact)}
            >
              History
            </button>
            <button
              type="button"
              className="btn btn--sm artefact-inline-form__Actionbar_Btn--danger"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </button>
            <span className="artefact-inline-form__Actionbar_Spacer" />
          </>
        )}
      </div>

      <div className="artefact-inline-form__Container_Cols">
        {/* ── Left column ─────────────────────────────────────────── */}
        <div className="artefact-inline-form__Container_Cols_Left">
          <label className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Title</span>
            <input
              type="text"
              className="artefact-inline-form__Field_Input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                if (titleDraft !== artefact.title) patch({ title: titleDraft });
              }}
            />
          </label>

          <div className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Description</span>
            {/* RichTextField — TipTap-backed editor. JSON doc as source
                of truth (description_doc); blur-save patches the doc.
                If the artefact only has a legacy `description` TEXT
                value (no doc yet) we seed the editor with that text as
                a single paragraph so existing content survives the
                cutover. */}
            <RichTextField
              key={artefact.id}
              value={
                (artefact.description_doc as object | null) ??
                (artefact.description
                  ? {
                      type: "doc",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: artefact.description }],
                        },
                      ],
                    }
                  : null)
              }
              onBlur={(doc) => patch({ description_doc: doc })}
              placeholder="Add a description…"
            />
          </div>

          <div className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Attachments</span>
            <div className="artefact-inline-form__Field_Stub">
              Drop files here (wiring pending — TD-ATTACHMENTS-WIRING)
            </div>
          </div>

          <div className="artefact-inline-form__Field_Meta">
            <span><strong>Created:</strong> {formatDateTime(artefact.created_at)}</span>
            <span><strong>Last updated:</strong> {formatDateTime(artefact.updated_at)}</span>
          </div>

          {/* Hierarchy snapshot — parent (top) + selected/siblings
              (bottom). Clicking a sibling's ID link re-loads the form
              with that artefact via the host's onNavigate handler. */}
          <ArtefactNodeDiagram
            artefactId={artefact.id}
            resourceUrl={resourceUrl}
            scope={scope}
            parentId={artefact.parent_id}
            selected={{
              id: artefact.id,
              type_prefix: artefact.type_prefix,
              key_num: artefact.key_num,
              title: artefact.title,
            }}
            onNavigate={(id) => onNavigate?.(id)}
          />
        </div>

        {/* ── Right column ────────────────────────────────────────── */}
        <div className="artefact-inline-form__Container_Cols_Right">
          <BlockedToggle
            isBlocked={artefact.is_blocked}
            blockedReason={artefact.blocked_reason}
            onToggle={(next) => patch({ is_blocked: next })}
            onReasonChange={(reason) => patch({ blocked_reason: reason })}
          />

          <label className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Topology node</span>
            <select
              className="artefact-inline-form__Field_Input"
              value={artefact.topology_node_id ?? ""}
              onChange={(e) => patch({ topology_node_id: e.target.value })}
            >
              <option value="">— Unassigned —</option>
              {topologyNodes.map((n) => {
                const labelText = n.label_override ?? n.name;
                const isActive = activeScopeNodeId && n.id === activeScopeNodeId;
                return (
                  <option key={n.id} value={n.id}>
                    {isActive ? `★ ${labelText} (current scope)` : labelText}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Colour</span>
            <ColourPicker
              value={artefact.colour ?? null}
              onChange={(hex) => patch({ colour: hex ?? "" })}
            />
          </div>

          <label className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Owner</span>
            <select
              className="artefact-inline-form__Field_Input"
              value={artefact.owner_id ?? ""}
              onChange={(e) => patch({ owned_by_user_id: e.target.value })}
            >
              <option value="">— Unassigned —</option>
              {/* Show current owner even if not in the list (e.g. stale membership). */}
              {artefact.owner_id && !users.some((u) => u.id === artefact.owner_id) && (
                <option value={artefact.owner_id}>(current)</option>
              )}
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name}</option>
              ))}
            </select>
          </label>

          <label className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">
              Flow state
              {(artefact.children_count ?? 0) > 0 && (
                <span
                  className="artefact-inline-form__Field_Label_Hint"
                  title="Derived from children — change a child's state to update this row"
                >
                  &nbsp;(derived from children)
                </span>
              )}
            </span>
            <select
              className="artefact-inline-form__Field_Input"
              value={artefact.flow_state_id ?? ""}
              onChange={(e) => patch({ flow_state_id: e.target.value })}
              disabled={(artefact.children_count ?? 0) > 0}
            >
              <option value="">— None —</option>
              {flowStates.map((fs) => (
                <option key={fs.id} value={fs.id}>{fs.name}</option>
              ))}
            </select>
          </label>

          <label className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Plan estimate (points)</span>
            <input
              type="number"
              step={1}
              min={0}
              className="artefact-inline-form__Field_Input"
              value={pointsDraft}
              onChange={(e) => setPointsDraft(e.target.value)}
              onBlur={() => {
                const next = pointsDraft === "" ? null : parseInt(pointsDraft, 10);
                if (next !== artefact.story_points) {
                  patch({ story_points: Number.isFinite(next) ? next : null });
                }
              }}
            />
          </label>

          <label className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Parent</span>
            <select
              className="artefact-inline-form__Field_Input"
              value={artefact.parent_id ?? ""}
              onChange={(e) => patch({ parent_artefact_id: e.target.value })}
            >
              <option value="">— No parent —</option>
              {parentCandidates.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Sprint</span>
            <select
              className="artefact-inline-form__Field_Input"
              value={artefact.sprint_id ?? ""}
              onChange={(e) => patch({ sprint_id: e.target.value })}
            >
              <option value="">— Unscheduled —</option>
              {sprintList.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>

          <label className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Release</span>
            <select
              className="artefact-inline-form__Field_Input"
              value={artefact.release_id ?? ""}
              onChange={(e) => patch({ release_id: e.target.value })}
            >
              <option value="">— Unscheduled —</option>
              {releaseList.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>

          <label className="artefact-inline-form__Field">
            <span className="artefact-inline-form__Field_Label">Milestone</span>
            <select
              className="artefact-inline-form__Field_Input"
              value={artefact.milestone_id ?? ""}
              onChange={(e) => patch({ milestone_id: e.target.value })}
            >
              <option value="">— None —</option>
              {milestoneList.map((m) => (
                <option key={m.timeboxes_milestones_id} value={m.timeboxes_milestones_id}>
                  {m.timeboxes_milestones_name} ({m.timeboxes_milestones_date_target})
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="artefact-inline-form__Actions">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={onClose}
        >
          Finished
        </button>
      </div>
    </div>
  );
}
