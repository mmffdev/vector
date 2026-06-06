"use client";

// ArtefactCreateFlyout — the create-new form, extracted from ObjectTreeV2
// (p_ObjectTree.tsx createFlyoutNode + submitCreate + the per-type data
// effects) into a self-contained, reusable component so the Grid surfaces
// (/work-items today, /scope + /artefacts later) get a working "Create new"
// without ObjectTreeV2. Pays down TD-GRID-FORM-MODES (create mode).
//
// Self-sourcing: given an armed type id, it fetches its own option lists
// (topology nodes, flow states, users, sprints, releases, milestones, parent
// candidates, custom-field bindings) via the same hooks/endpoints OTV2 used.
// The consumer only owns open/close + a created callback — no prop-drilling of
// eight option arrays.
//
// Wire contract (unchanged from OTV2): a POST creates the artefact with the
// fields the handler accepts, then a follow-up PATCH applies the rest. The
// pure split lives in ./buildCreateRequests (unit-tested).

import { useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { apiSite } from "@/app/lib/api";
import {
  sprints,
  releases,
  milestones,
  lookups,
  workItems as workItemsLookup,
  type Milestone,
  type UserInScope,
} from "@/app/lib/apiSite";
import { useSentinel } from "@/app/sentinel";
import { useScopedTopologyNodes } from "@/app/components/topology/useScopedTopologyNodes";
import { useParentCandidates } from "@/app/components/ArtefactInlineForm/useParentCandidates";
import { ColourPicker } from "@/app/components/ColourPicker";
import { RichTextField } from "@/app/components/RichTextField";
import { useFieldsForType } from "@/app/components/ObjectTreeV2/hooks/useFieldsForType";
import {
  CreateCustomFields,
  customFieldsToWire,
  type CustomFieldValues,
} from "@/app/components/ObjectTreeV2/sheets/CreateCustomFields";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import {
  resolveWorkspaceId,
  nodeRelativeTimeboxParams,
  timeboxOptions,
  type TimeboxOption,
} from "@/app/components/ArtefactInlineForm/timeboxOptions";
import { notify } from "@/app/lib/toast";
import { useUserPreference } from "@/app/hooks/useUserPreference";
import {
  buildCreateRequests,
  type CreateDraft,
  type RankPlacement,
} from "./buildCreateRequests";

// Sticky per-user pref: where new artefacts land in the Prio rank. Defaults to
// "bottom" (Rally-parity) on first use, then remembers the last pick. Only
// "top"/"bottom" are user-selectable on create — "after" is duplicate-only and
// set programmatically, never persisted here.
const RANK_PREF_KEY = "workitems.create.rank";

// Walks a TipTap JSON doc into a single plain string — the description
// plaintext for the legacy `description` column (the rich JSON ships via the
// follow-up PATCH into description_doc). Mirrors OTV2's docToPlainText.
function docToPlainText(node: JSONContent | null | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  const parts: string[] = [];
  for (const child of node.content ?? []) parts.push(docToPlainText(child));
  return parts.join(node.type === "doc" ? "\n" : "");
}

const EMPTY_DRAFT: CreateDraft = {
  title: "",
  description_doc: null,
  parent_id: "",
  topology_node_id: "",
  flow_state_id: "",
  owner_id: "",
  sprint_id: "",
  release_id: "",
  milestone_id: "",
  story_points: "",
  colour: "",
};

export interface ArtefactCreateFlyoutProps {
  /** Armed type id (artefact_type uuid). Empty string ⇒ flyout closed. */
  actionTypeId: string;
  /** Human label for the armed type (e.g. "Story"). */
  actionTypeLabel: string | null;
  /** Resource base for the POST/PATCH (e.g. "/work-items"). */
  resourceUrl: string;
  /** Sidecar scope — "work" | "strategy". Drives sprint/release visibility. */
  scope: "work" | "strategy";
  /** Close the flyout (clears the armed type on the consumer's side). */
  onClose: () => void;
  /**
   * Fired after a successful create so the host can refresh and (optionally)
   * open + green-flag the new row's flyout. `id` is the new artefact UUID;
   * `rowId` is its human id (TYPE-num) when the POST response carried the
   * prefix/key, else null.
   */
  onCreated: (created: { id: string; rowId: string | null }) => void;
}

export function ArtefactCreateFlyout({
  actionTypeId,
  actionTypeLabel,
  resourceUrl,
  scope,
  onClose,
  onCreated,
}: ArtefactCreateFlyoutProps) {
  const open = !!actionTypeId;
  const { sentinel_user, sentinel_grants, sentinel_focus_node } = useSentinel();
  const activeScopeNodeId = sentinel_focus_node ?? null;
  const { types: typeCatalogue } = useArtefactTypeCatalogue();

  // Sticky rank-placement choice (Top / Bottom). Persisted per-user; only
  // "top"/"bottom" here — "after" is the duplicate path's concern.
  const { value: rankPref, setValue: setRankPref } = useUserPreference<RankPlacement>(
    RANK_PREF_KEY,
    "bottom",
  );

  const selectedType = useMemo(
    () => typeCatalogue.find((x) => x.id === actionTypeId) ?? null,
    [typeCatalogue, actionTypeId],
  );
  const actionTypePrefix = selectedType?.prefix ?? null;
  const isStrategic = scope === "strategy";
  const isTopLevel = selectedType?.layer_depth === 0;
  const isRisk = selectedType?.slot === "wrk_risk";
  const showSprint = !isStrategic && !isRisk;
  const showRelease = !isStrategic && !isRisk;
  const showPlanEstimate = !isStrategic;

  const workspaceId = resolveWorkspaceId(
    sentinel_user?.tenant_id,
    sentinel_user?.workspace_id,
    sentinel_grants,
    activeScopeNodeId,
  );

  const { nodes: createTopologyNodes } = useScopedTopologyNodes();
  const [createFlowStates, setCreateFlowStates] = useState<
    Array<{ id: string; name: string; flow_position?: number }>
  >([]);
  const [createUsers, setCreateUsers] = useState<UserInScope[]>([]);
  const [createSprints, setCreateSprints] = useState<TimeboxOption[]>([]);
  const [createReleases, setCreateReleases] = useState<TimeboxOption[]>([]);
  const [createMilestones, setCreateMilestones] = useState<Milestone[]>([]);

  const {
    strategic: createParentStrategic,
    execution: createParentExecution,
  } = useParentCandidates({
    typePrefix: actionTypePrefix,
    scope,
    workspaceId,
  });

  const { bindings: customFieldBindings } = useFieldsForType(
    resourceUrl,
    actionTypeId || null,
  );
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValues>({});
  useEffect(() => {
    setCustomFieldValues({});
  }, [actionTypeId]);

  // Risk-only cross-scope parent candidates — spans execution + strategic
  // within the active clamp (a risk can hang off a Theme OR a Story).
  const [riskParentExec, setRiskParentExec] = useState<
    Array<{ id: string; type_prefix: string; key_num: number; title: string }>
  >([]);
  const [riskParentStrat, setRiskParentStrat] = useState<
    Array<{ id: string; type_prefix: string; key_num: number; title: string }>
  >([]);
  useEffect(() => {
    if (!isRisk || !actionTypeId) return;
    let cancelled = false;
    (async () => {
      try {
        const qs = "page_size=500";
        const [exec, strat] = await Promise.all([
          apiSite<{ items: unknown[] }>(`/work-items?${qs}`).catch(() => ({ items: [] })),
          apiSite<{ items: unknown[] }>(`/portfolio-items?${qs}`).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        const shape = (rows: unknown[]) =>
          (rows as Array<{ id?: string; type_prefix?: string; key_num?: number; title?: string }>)
            .filter((r) => r && r.id && r.type_prefix && typeof r.key_num === "number")
            .map((r) => ({
              id: r.id!,
              type_prefix: r.type_prefix!,
              key_num: r.key_num!,
              title: r.title ?? "",
            }));
        setRiskParentExec(shape(exec.items ?? []));
        setRiskParentStrat(shape(strat.items ?? []));
      } catch {
        /* falls through to empty — dropdown shows "— None (root) —" only */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isRisk, actionTypeId]);

  // Per-type catalogues — fetched whenever the user arms a new type. Timeboxes
  // are node-relative, so the active focus participates. Each source has its
  // own catch so one failure doesn't poison the others.
  useEffect(() => {
    if (!actionTypeId || !workspaceId || !activeScopeNodeId) return;
    const timeboxParams = nodeRelativeTimeboxParams(workspaceId, activeScopeNodeId);
    let cancelled = false;
    (async () => {
      try {
        const [fs, us, sp, rel, ms] = await Promise.all([
          workItemsLookup
            .listFlowStates(`artefact_type_id=${encodeURIComponent(actionTypeId)}`)
            .catch(() => ({ flow_states: [] as unknown[] })),
          lookups.usersInScope().catch(() => ({ users: [] as UserInScope[], count: 0 })),
          sprints.list(timeboxParams).catch(() => ({ items: [] as unknown[] })),
          releases.list(timeboxParams).catch(() => ({ items: [] as unknown[] })),
          milestones.list(timeboxParams).catch(() => ({ milestones: [] as Milestone[], count: 0 })),
        ]);
        if (cancelled) return;
        setCreateFlowStates(
          ((fs as { flow_states: unknown[] }).flow_states ?? []) as Array<{
            id: string;
            name: string;
            flow_position?: number;
          }>,
        );
        setCreateUsers((us as { users: UserInScope[] }).users ?? []);
        setCreateSprints(timeboxOptions(sp, "sprint"));
        setCreateReleases(timeboxOptions(rel, "release"));
        setCreateMilestones((ms as { milestones: Milestone[] }).milestones ?? []);
      } catch {
        /* per-source catches above keep one failure from poisoning the rest */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actionTypeId, workspaceId, activeScopeNodeId]);

  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft when the armed type changes (or flyout closes). Topology
  // defaults to the active clamp so the new row lands on the current scope.
  useEffect(() => {
    setDraft({ ...EMPTY_DRAFT, topology_node_id: activeScopeNodeId ?? "" });
    setError(null);
  }, [actionTypeId, activeScopeNodeId]);

  // Default flow state to the type's lowest-position state once known.
  useEffect(() => {
    if (!actionTypeId || draft.flow_state_id || createFlowStates.length === 0) return;
    const sorted = [...createFlowStates].sort(
      (a, b) => (a.flow_position ?? 0) - (b.flow_position ?? 0),
    );
    setDraft((d) => ({ ...d, flow_state_id: sorted[0]?.id ?? "" }));
  }, [actionTypeId, createFlowStates, draft.flow_state_id]);

  const tab = (active: boolean) => (active ? 0 : -1);

  const submitCreate = async () => {
    if (!actionTypeId || !selectedType) return;
    const title = draft.title.trim();
    if (!title) {
      setError("Title is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { postUrl, postBody, postPath, patchBody } = buildCreateRequests({
        draft,
        flags: {
          itemType: selectedType.name.toLowerCase(),
          showSprint,
          showRelease,
          showPlanEstimate,
        },
        descriptionPlaintext: docToPlainText(draft.description_doc),
        customWire: customFieldsToWire(customFieldValues, customFieldBindings),
        resourceUrl,
        activeScopeNodeId,
        rankPlacement: rankPref,
      });

      const created = (await apiSite<{
        id: string;
        type_prefix?: string;
        key_num?: number;
      }>(postUrl, {
        method: "POST",
        body: JSON.stringify(postBody),
      })) as { id?: string; type_prefix?: string; key_num?: number } | null;

      const newId = created?.id;
      if (newId && Object.keys(patchBody).length > 0) {
        try {
          await apiSite(`${postPath}/${newId}`, {
            method: "PATCH",
            body: JSON.stringify(patchBody),
          });
        } catch {
          notify.info("Artefact created — some fields couldn't be applied. Open it to fix.");
        }
      }

      notify.success(`${actionTypeLabel ?? "Artefact"} created.`);
      // Close the create form FIRST so it can never be left open by anything
      // the host's onCreated handler does (a throw in refresh / row-open must
      // not strand the form open — the bug this ordering fixes). Then hand the
      // host the new row's human id (TYPE-num) so it can open + green-flag the
      // freshly-created row's flyout (parity with Duplicate). rowId is null when
      // the POST response lacked the prefix/key — host still refreshes on id.
      onClose();
      if (newId) {
        const rowId =
          created?.type_prefix && created?.key_num != null
            ? `${created.type_prefix}-${created.key_num}`
            : null;
        onCreated({ id: newId, rowId });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="tree_accordion-dense__createflyout"
      data-open={open ? "true" : "false"}
      role="region"
      aria-label={actionTypeLabel ? `New ${actionTypeLabel} form` : "New artefact form"}
      aria-hidden={!open}
    >
      <div className="tree_accordion-dense__createflyout-inner">
        <header className="tree_accordion-dense__createflyout-head">
          <h3 className="tree_accordion-dense__createflyout-title">
            New {actionTypeLabel ?? "artefact"}
          </h3>
          <button
            type="button"
            className="tree_accordion-dense__createflyout-close"
            aria-label="Close form"
            tabIndex={tab(open)}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <form
          className="tree_accordion-dense__createflyout-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCreate();
          }}
        >
          <div className="tree_accordion-dense__createflyout-section">
            <label className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">
                Title <span className="tree_accordion-dense__createflyout-required">*</span>
              </span>
              <input
                type="text"
                className="tree_accordion-dense__createflyout-input"
                placeholder={actionTypeLabel ? `${actionTypeLabel} title…` : "Title…"}
                tabIndex={tab(open)}
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                autoFocus={open}
                required
              />
            </label>

            <div className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">Description</span>
              <RichTextField
                key={actionTypeId || "empty"}
                value={draft.description_doc}
                onChange={(doc) => setDraft((d) => ({ ...d, description_doc: doc }))}
                placeholder="Add a description…"
              />
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              {!isTopLevel && (
                <label className="tree_accordion-dense__createflyout-field">
                  <span className="tree_accordion-dense__createflyout-field-label">
                    Parent artefact
                  </span>
                  <select
                    className="tree_accordion-dense__createflyout-input"
                    tabIndex={tab(open)}
                    value={draft.parent_id}
                    onChange={(e) => setDraft((d) => ({ ...d, parent_id: e.target.value }))}
                  >
                    <option value="">— None (root) —</option>
                    {isRisk ? (
                      <>
                        {riskParentStrat.length > 0 && (
                          <optgroup label="Strategic Items">
                            {riskParentStrat.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.type_prefix}-{r.key_num} — {r.title}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {riskParentExec.length > 0 && (
                          <optgroup label="Execution Items">
                            {riskParentExec.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.type_prefix}-{r.key_num} — {r.title}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    ) : (
                      <>
                        {createParentStrategic.length > 0 && (
                          <optgroup label="Strategic Items">
                            {createParentStrategic.map((c) => (
                              <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                          </optgroup>
                        )}
                        {createParentExecution.length > 0 && (
                          <optgroup label="Execution Items">
                            {createParentExecution.map((c) => (
                              <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    )}
                  </select>
                </label>
              )}

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Topology node
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(open)}
                  value={draft.topology_node_id}
                  onChange={(e) => setDraft((d) => ({ ...d, topology_node_id: e.target.value }))}
                >
                  <option value="">— Unassigned —</option>
                  {createTopologyNodes.map((n) => {
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
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Flow state
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(open)}
                  value={draft.flow_state_id}
                  onChange={(e) => setDraft((d) => ({ ...d, flow_state_id: e.target.value }))}
                >
                  <option value="">— Initial —</option>
                  {createFlowStates.map((fs) => (
                    <option key={fs.id} value={fs.id}>{fs.name}</option>
                  ))}
                </select>
              </label>

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Owner
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(open)}
                  value={draft.owner_id}
                  onChange={(e) => setDraft((d) => ({ ...d, owner_id: e.target.value }))}
                >
                  <option value="">— Me —</option>
                  {createUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.display_name}</option>
                  ))}
                </select>
              </label>
            </div>

            {(showSprint || showRelease) && (
              <div className="tree_accordion-dense__createflyout-row">
                {showSprint && (
                  <label className="tree_accordion-dense__createflyout-field">
                    <span className="tree_accordion-dense__createflyout-field-label">
                      Sprint
                    </span>
                    <select
                      className="tree_accordion-dense__createflyout-input"
                      tabIndex={tab(open)}
                      value={draft.sprint_id}
                      onChange={(e) => setDraft((d) => ({ ...d, sprint_id: e.target.value }))}
                    >
                      <option value="">— Unscheduled —</option>
                      {createSprints.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {showRelease && (
                  <label className="tree_accordion-dense__createflyout-field">
                    <span className="tree_accordion-dense__createflyout-field-label">
                      Release
                    </span>
                    <select
                      className="tree_accordion-dense__createflyout-input"
                      tabIndex={tab(open)}
                      value={draft.release_id}
                      onChange={(e) => setDraft((d) => ({ ...d, release_id: e.target.value }))}
                    >
                      <option value="">— Unscheduled —</option>
                      {createReleases.map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Milestone
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(open)}
                  value={draft.milestone_id}
                  onChange={(e) => setDraft((d) => ({ ...d, milestone_id: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {createMilestones.map((m) => (
                    <option
                      key={m.timeboxes_milestones_id}
                      value={m.timeboxes_milestones_id}
                    >
                      {m.timeboxes_milestones_name} ({m.timeboxes_milestones_date_target})
                    </option>
                  ))}
                </select>
              </label>

              {showPlanEstimate && (
                <label className="tree_accordion-dense__createflyout-field">
                  <span className="tree_accordion-dense__createflyout-field-label">
                    Plan estimate (points)
                  </span>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    className="tree_accordion-dense__createflyout-input"
                    tabIndex={tab(open)}
                    value={draft.story_points}
                    onChange={(e) => setDraft((d) => ({ ...d, story_points: e.target.value }))}
                  />
                </label>
              )}
            </div>

            <div className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">
                Colour
              </span>
              <ColourPicker
                value={draft.colour || null}
                onChange={(hex) => setDraft((d) => ({ ...d, colour: hex ?? "" }))}
              />
            </div>

            <p className="tree_accordion-dense__createflyout-meta">
              <span>Type: <strong>{actionTypeLabel ?? "—"}</strong></span>
              <span>Number: <strong>auto</strong></span>
              <span>Created by: <strong>me</strong></span>
              <span>
                Scope:{" "}
                <strong>
                  {activeScopeNodeId
                    ? createTopologyNodes.find((n) => n.id === activeScopeNodeId)?.label_override ??
                      createTopologyNodes.find((n) => n.id === activeScopeNodeId)?.name ??
                      "active node"
                    : "no active node"}
                </strong>
              </span>
            </p>
            {error && (
              <p
                className="tree_accordion-dense__createflyout-meta"
                role="alert"
                style={{ color: "var(--danger, #c00)" }}
              >
                {error}
              </p>
            )}
          </div>

          <CreateCustomFields
            bindings={customFieldBindings}
            values={customFieldValues}
            onChange={setCustomFieldValues}
            tabIndex={tab(open)}
          />

          <div className="tree_accordion-dense__createflyout-actions">
            {/* Rank placement — sticky Top / Bottom segmented toggle. Rally
                pins new items to the bottom with no choice; this is the Vector
                differentiator. Sits left of the action buttons. */}
            <div
              className="createflyout-rank"
              role="radiogroup"
              aria-label="Where the new item lands in priority"
            >
              <span className="createflyout-rank__label">Rank</span>
              <div className="createflyout-rank__toggle">
                <button
                  type="button"
                  role="radio"
                  aria-checked={rankPref === "top"}
                  className="createflyout-rank__opt"
                  data-active={rankPref === "top"}
                  tabIndex={tab(open)}
                  onClick={() => setRankPref("top")}
                >
                  Top
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={rankPref === "bottom"}
                  className="createflyout-rank__opt"
                  data-active={rankPref === "bottom"}
                  tabIndex={tab(open)}
                  onClick={() => setRankPref("bottom")}
                >
                  Bottom
                </button>
              </div>
            </div>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              tabIndex={tab(open)}
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--sm btn--primary"
              tabIndex={tab(open)}
              disabled={submitting || !draft.title.trim()}
            >
              {submitting ? "Creating…" : `+ Create ${actionTypeLabel ?? "artefact"}`}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
