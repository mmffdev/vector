"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import ObjectTree, { type WorkItem, type ObjectTreeDataConfig } from "@/app/components/ObjectTreeV2/p_ObjectTree";
import type { RowButton } from "@/app/components/ResourceTree";
import RadialPillMenu from "@/app/components/RadialPillMenu/p_RadialPillMenu";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useSentinel } from "@/app/sentinel";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { resolveWizardConfig, buildWorkItemsFunctions } from "@/app/lib/wizardLoader";
import { resolveSlotRefs } from "@/app/lib/sidecarSlotResolver";
import workItemsWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_workitems.json";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { useNextSprint } from "@/app/hooks/useNextSprint";
import { workItems } from "@/app/lib/apiSite";
import { ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

// Column drops for the value-sprint trees. The rowButtons column adds
// ~244px of horizontal chrome (Add to Sprint + Target Sprint chips),
// which pushes the right-edge columns past the table's overflow:hidden
// clamp. Sprint planning doesn't need Parent (the panel tree already
// shows hierarchy via indent), Due (sprint commitment is the date
// here), or Priority (deferred from this surface).
//
// Backlog drops Sprint on top — rows there are by definition unassigned;
// the column would only ever read "—". The page's whole task is to
// assign them, so the Add-to-Sprint / Target-Sprint chips ARE the
// affordance and the column is dead weight.
const PANEL_DROP_COLS   = ["parent", "due", "priority"] as const;
const BACKLOG_DROP_COLS = ["parent", "due", "priority", "sprint"] as const;

const SAVED_VIEW_TARGET_PANEL   = "objecttree:value_sprint_panel";
const SAVED_VIEW_TARGET_BACKLOG = "objecttree:value_sprint_backlog";

export default function ValueSprint() {
  const { full } = usePageTitle();

  // Sentinel clamp — copied verbatim from app/(user)/work-items/page.tsx.
  // Identity + tenant + scope flow through Sentinel; `direction` is derived
  // from sentinel_scope_up / sentinel_scope_down (Rally idiom).
  const {
    sentinel_tenant,
    sentinel_focus_node,
    sentinel_scope_up,
    sentinel_scope_down,
    sentinel_user,
  } = useSentinel();
  const activeNodeId = sentinel_focus_node;
  const direction = sentinel_scope_down ? "descend" : sentinel_scope_up ? "ascend" : "none";

  // Slice 1 — live "next sprint" lookup for the top panel. The wire's
  // workspace_id is the tenant/subscription root UUID (see the live
  // /timeboxes/sprints response: timeboxes_sprints_id_workspace =
  // 00000000-0000-0000-0000-000000000001 on the dev seed). That maps to
  // sentinel_user.tenant_id, NOT sentinel_user.workspace_id — they are
  // distinct fields on SentinelUser, and the working /sprints page
  // (app/(user)/sprints/page.tsx) confirms tenant_id is the correct one
  // for this endpoint. The topology focus node is passed so the
  // backend's slice-5B ancestor walk fires when the user is viewing a
  // child node of a propagated sprint, same as TimeboxObjectTree's
  // reload().
  const workspaceId = sentinel_user?.tenant_id ?? null;
  // PERF (2026-05-28) — single hook returns both the picked next sprint
  // AND the next-up-to-8 upcoming sprints (for the "Target Sprint"
  // radial picker). Was two hooks firing /timeboxes/sprints twice with
  // identical params; collapsed to one fetch.
  const {
    sprint: nextSprint,
    upcoming: upcomingSprints,
    refetch: refetchNextSprint,
  } = useNextSprint(workspaceId, activeNodeId, 8);

  const [filters] = useState({ sprint_id: "" });
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  // Slice 7 — separate selection state for the sprint-panel tree so a
  // click on a panel row doesn't flip the backlog tree's open inline
  // form (and vice versa).
  const [panelSelectedItem, setPanelSelectedItem] = useState<WorkItem | null>(null);
  // Slice 3 — backlog multi-select. p_ObjectTree owns the live Set and
  // mirrors it here on each change so the page can drive bulk-action
  // chrome of its own (slice 6 wires the buttons; slice 3 just plumbs).
  const [backlogSelectedIds, setBacklogSelectedIds] = useState<Set<string>>(new Set());

  // Slice 5 — imperative handle so the page can force the backlog tree
  // to refetch its window after an out-of-band PATCH (the row buttons
  // hit apiSite.workItems.patch directly; the tree's internal patch
  // wrapper isn't involved).
  const backlogRefetchRef = useRef<(() => Promise<void>) | null>(null);

  // Slice 5/6/7 — radial picker open state. Single shared instance,
  // mode-tagged so onPick knows what to do with the picked sprint id:
  //
  //   { mode: "row-backlog",    rowId, anchor }    — per-row "Target Sprint"
  //                                                  on the backlog (slice 5)
  //   { mode: "row-panel",      rowId, anchor }    — per-row "Move to Sprint"
  //                                                  on the sprint panel (slice 7)
  //   { mode: "bulk-backlog",   anchor }           — bulk on backlog (slice 6)
  //   { mode: "bulk-panel",     anchor }           — bulk on sprint panel (slice 7)
  //   { mode: "switch-panel",   anchor }           — Switch Sprint affordance
  //                                                  on the sprint panel header (slice 7)
  type TargetMenuMode =
    | { mode: "row-backlog"; rowId: string; anchor: HTMLElement | null }
    | { mode: "row-panel"; rowId: string; anchor: HTMLElement | null }
    | { mode: "bulk-backlog"; anchor: HTMLElement | null }
    | { mode: "bulk-panel"; anchor: HTMLElement | null }
    | { mode: "switch-panel"; anchor: HTMLElement | null };
  const [targetMenu, setTargetMenu] = useState<TargetMenuMode | null>(null);
  // Slice 6 — anchor ref for the bulk "Target Sprint" button in the
  // BulkActionBar. We can't grab activeElement at click-time the way
  // row buttons do (the bar's children are inside a host-owned subtree
  // we can't bind a ref into); instead we look up the button by its
  // data-action attribute once on click, which BulkActionBar stamps for
  // every leading button.
  const bulkBarRef = useRef<HTMLDivElement | null>(null);
  // Track which selection set this batch is operating against so a
  // racy click (selection changed mid-flight) doesn't quietly mutate
  // newer-selected rows.
  const bulkSelectionRef = useRef<Set<string>>(new Set());

  // Slice 7 — sprint-panel tree state. The panel shows the work items
  // assigned to a specific sprint. `panelSprintIdOverride` lets the
  // user pick a different sprint via the Switch Sprint affordance;
  // when null we fall through to useNextSprint's pick. Selection +
  // refetch + bulk snapshot mirror the backlog tree.
  const [panelSprintIdOverride, setPanelSprintIdOverride] = useState<string | null>(null);
  const [panelSelectedIds, setPanelSelectedIds] = useState<Set<string>>(new Set());
  const panelRefetchRef = useRef<(() => Promise<void>) | null>(null);
  // bulkSelectionRef (declared above) is REUSED for both backlog and
  // panel bulk paths — radial menu's bulk-* modes both read it on pick.
  // A separate ref isn't needed because only one bulk operation can be
  // in flight at a time (radial menu is a singleton).
  // Wrap the sprint-panel ObjectTree in its own ref'd div so the bulk
  // Move-to-Sprint button can locate itself via [data-action="…"]
  // without colliding with the backlog tree's bulk bar.
  const panelBulkBarRef = useRef<HTMLDivElement | null>(null);

  // Resolved sprint id for the panel — override wins, else fall back
  // to useNextSprint's pick. The matching SprintWireRow comes from the
  // upcomingSprints list (which already covers planned + active).
  const panelSprintId =
    panelSprintIdOverride ?? nextSprint?.timeboxes_sprints_id ?? null;
  const panelSprint = useMemo(
    () => upcomingSprints.find((s) => s.timeboxes_sprints_id === panelSprintId) ?? nextSprint,
    [upcomingSprints, panelSprintId, nextSprint],
  );

  // Switch-sprint button anchor ref. Lives on the panel header so the
  // user can flip between sprints without scrolling away.
  const switchSprintBtnRef = useRef<HTMLButtonElement | null>(null);

  // ObjectTreeV2 sidecars — base config is the Work Items wizard, but
  // the value-sprint backlog is intentionally narrower: stories +
  // defects only (no epics, no tasks). We override two fields after
  // slot→UUID resolution:
  //   1. createableTypeSlots → just story/defect, so the "Add" picker
  //      and create-flyout match the visible row set.
  //   2. resourceUrl → append ?item_type_id=<story_uuid>,<defect_uuid>
  //      so the backend `/work-items` handler clamps the LIST query
  //      with ANY($N::uuid[]) — same shape used by the user-facing
  //      type chip.
  const { types, loading: catalogueLoading } = useArtefactTypeCatalogue();
  // PERF (2026-05-28) — gate both ObjectTree mounts on the catalogue
  // being resolved. Without this gate, the page mounts the backlog tree
  // with `types=[]` (allowedIds resolves to empty, wizardConfig builds a
  // URL with NO item_type clamp), fires a throwaway /work-items + prefs
  // GET, then re-mounts a moment later when `types` populates — that
  // second mount fires the GETs AGAIN with the proper clamp. Net: 3
  // extra round-trips per page load (one throwaway list call + one
  // duplicate prefs + one duplicate facets, all serial). The gate
  // collapses both trees into a single correct mount once catalogue is
  // ready.
  const catalogueReady = !catalogueLoading && types.length > 0;

  // Slice 7 — factored sidecar resolver. Both the backlog tree and the
  // sprint-panel tree share the same base wizard (story + defect only)
  // but want different wire clamps:
  //   backlog: ?item_type_id=<ids>          — everything in scope
  //   panel:   ?item_type_id=<ids>&sprint_id=<sprintId>
  //                                         — items assigned to the panel sprint
  // The factory takes optional extra params + a treeName so each tree
  // gets its own private filter/sort prefs namespace.
  const buildWizardConfig = useCallback(
    (treeName: string, extraParams: string | null): ObjectTreeDataConfig => {
      const ALLOWED_SLOTS = ["wrk_story", "wrk_defect"] as const;
      const bySlot = new Map(types.map((t) => [t.slot, t.id]));
      const allowedIds = ALLOWED_SLOTS
        .map((s) => bySlot.get(s))
        .filter((id): id is string => !!id);
      const baseSidecar = {
        ...(workItemsWizardJson as unknown as Record<string, unknown>),
        createableTypeSlots: [...ALLOWED_SLOTS],
      };
      const resolvedSlots = resolveSlotRefs(baseSidecar, types);
      const resolved = resolveWizardConfig(resolvedSlots as any);
      const funcs = buildWorkItemsFunctions();
      const baseUrl = (resolved.resourceUrl as string | undefined) ?? "/work-items";
      const sep1 = baseUrl.includes("?") ? "&" : "?";
      let url = allowedIds.length
        ? `${baseUrl}${sep1}item_type_id=${allowedIds.join(",")}`
        : baseUrl;
      if (extraParams) {
        const sep2 = url.includes("?") ? "&" : "?";
        url = `${url}${sep2}${extraParams}`;
      }
      return {
        ...resolved,
        resourceUrl: url,
        treeName,
        getParentId: funcs.getParentId,
        getChildrenCount: funcs.getChildrenCount,
        searchAccessor: funcs.searchAccessor,
      } as ObjectTreeDataConfig;
    },
    [types],
  );

  const wizardConfig = useMemo<ObjectTreeDataConfig>(
    () => buildWizardConfig("valuesprintbacklog", null),
    [buildWizardConfig],
  );

  // Slice 7 — sprint-panel wizard. Clamps to ?sprint_id=<panelSprintId>
  // so the tree only shows work items currently assigned to the panel
  // sprint. When panelSprintId is null we still mount the tree (with a
  // sentinel-empty clamp), so the user gets a "no sprint loaded" empty
  // state inside the panel rather than an unmounted void.
  // Only built when a real sprint id is loaded. The tree below is
  // gated on the same panelSprintId — no point asking the backend
  // for "sprint = none" (an earlier sentinel value of __none__ tripped
  // a 500 on the work-items handler's UUID parse).
  const panelWizardConfig = useMemo<ObjectTreeDataConfig | null>(
    () =>
      panelSprintId
        ? buildWizardConfig(
            "valuesprintplanned",
            `sprint_id=${panelSprintId}`,
          )
        : null,
    [buildWizardConfig, panelSprintId],
  );

  // Realtime refetch — same topic shape as Work Items so backlog stays
  // in sync when other clients mutate work items in this tenant. We also
  // refetch the sprint panel header so sprint name / date changes pushed
  // from another tab surface here without a manual reload.
  const refetch = useCallback(async () => {
    await refetchNextSprint();
    await backlogRefetchRef.current?.();
    await panelRefetchRef.current?.();
  }, [refetchNextSprint]);

  // Slice 5 — single-row assignment. PATCH work-item with the target
  // sprint_id, then refetch the backlog window + sprint panel so the
  // moved row drops out of the backlog clamp (when slice 7 clamps it)
  // and the panel's counters refresh. Tolerates 4xx/5xx by toasting
  // the API error verbatim — server stays the gate.
  const assignToSprint = useCallback(
    async (workItemId: string, sprintId: string | null) => {
      try {
        await workItems.patch(workItemId, { sprint_id: sprintId ?? "" });
        // Refetch both surfaces. Order doesn't matter — they're independent.
        await refetch();
        notify.success(
          sprintId ? "Added to sprint." : "Removed from sprint.",
        );
      } catch (err) {
        notify.apiError(err as ApiError, "Failed to update sprint assignment.");
      }
    },
    [refetch],
  );
  useEffect(() => {
    void refetch();
  }, [refetch, activeNodeId, direction]);

  // Slice 6 — bulk equivalent of assignToSprint. Iterates over the
  // selected ids and fires PATCHes in parallel via Promise.all so the
  // user doesn't wait n × RTT. Failures are surfaced individually as
  // toasts; a partial-failure mode (some succeed, some don't) is
  // honest about it rather than blocking the whole batch on the first
  // error. The selection set is captured at call time so a racy
  // selection change mid-flight doesn't widen the operation.
  const assignManyToSprint = useCallback(
    async (ids: string[], sprintId: string | null) => {
      if (!ids.length) return;
      const results = await Promise.allSettled(
        ids.map((id) => workItems.patch(id, { sprint_id: sprintId ?? "" })),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      await refetch();
      if (failed === 0) {
        notify.success(
          sprintId
            ? `Added ${ids.length} item${ids.length === 1 ? "" : "s"} to sprint.`
            : `Removed ${ids.length} item${ids.length === 1 ? "" : "s"} from sprint.`,
        );
      } else if (failed === ids.length) {
        notify.error(`Failed to update ${ids.length} item${ids.length === 1 ? "" : "s"}.`);
      } else {
        notify.error(
          `Updated ${ids.length - failed} of ${ids.length} — ${failed} failed.`,
        );
      }
    },
    [refetch],
  );

  // Slice 5 — per-row action buttons. "Add to Sprint" assigns the row
  // to the current next-sprint (disabled when none loaded). "Target
  // Sprint" opens the radial picker anchored to that button. The
  // callback closes over nextSprint + assignToSprint; each row's
  // buttons get fresh closures per render (cheap).
  const backlogRowButtons = useCallback(
    (row: WorkItem): RowButton[] => {
      const currentSprintId = nextSprint?.timeboxes_sprints_id ?? null;
      const currentSprintName =
        nextSprint?.timeboxes_sprints_name ?? "current sprint";
      return [
        {
          key: "add-to-sprint",
          label: "Add to Sprint",
          ariaLabel: currentSprintId
            ? `Add ${row.title ?? row.id} to ${currentSprintName}`
            : "No upcoming sprint to add to",
          disabled: !currentSprintId,
          onClick: () => {
            if (currentSprintId) void assignToSprint(row.id, currentSprintId);
          },
          variant: "primary",
        },
        {
          key: "target-sprint",
          label: "Target Sprint",
          ariaLabel: `Pick a sprint to target for ${row.title ?? row.id}`,
          disabled: upcomingSprints.length === 0,
          onClick: () => {
            // Capture the anchoring element from the event-time
            // document focus / activeElement target. We use the
            // matching DOM node via the row's data-selection-row-id
            // hook is brittle — instead grab the currentTarget at
            // click time via the surrounding button. Stored on the
            // RowButton handler so the event captures it directly.
            // Pull the anchor off the activeElement once the click
            // fires; React already focused the button.
            const anchorEl =
              (document.activeElement as HTMLElement | null) ?? null;
            setTargetMenu({ mode: "row-backlog", rowId: row.id, anchor: anchorEl });
          },
          variant: "secondary",
        },
      ];
    },
    [nextSprint, upcomingSprints.length, assignToSprint],
  );

  // Slice 6 — bulk action buttons surfaced on the BulkActionBar (left
  // side). "Add to Sprint" runs assignManyToSprint with the current
  // sprint id; "Target Sprint" opens the same radial picker as the
  // per-row button, but with rowId: null so the onPick path knows to
  // operate over the captured selection set rather than a single row.
  // Both are disabled when their precondition isn't met (no current
  // sprint / no upcoming sprints).
  const bulkLeadingButtons = useMemo(() => {
    if (backlogSelectedIds.size === 0) return undefined;
    const currentSprintId = nextSprint?.timeboxes_sprints_id ?? null;
    return [
      {
        key: "bulk-add-to-sprint",
        label: `Add ${backlogSelectedIds.size} to Sprint`,
        ariaLabel: currentSprintId
          ? `Add ${backlogSelectedIds.size} selected item${backlogSelectedIds.size === 1 ? "" : "s"} to ${nextSprint?.timeboxes_sprints_name ?? "sprint"}`
          : "No upcoming sprint to add to",
        disabled: !currentSprintId,
        onClick: currentSprintId
          ? () => {
              const ids = Array.from(backlogSelectedIds);
              void assignManyToSprint(ids, currentSprintId);
            }
          : undefined,
        variant: "primary" as const,
      },
      {
        key: "bulk-target-sprint",
        label: "Target Sprint",
        ariaLabel: `Pick a target sprint for ${backlogSelectedIds.size} selected item${backlogSelectedIds.size === 1 ? "" : "s"}`,
        disabled: upcomingSprints.length === 0,
        onClick:
          upcomingSprints.length === 0
            ? undefined
            : () => {
                // Snapshot the selection at click time. The radial
                // menu callback later reads bulkSelectionRef so a
                // selection change between click and pick doesn't
                // widen the batch.
                bulkSelectionRef.current = new Set(backlogSelectedIds);
                const btn = bulkBarRef.current?.querySelector(
                  '[data-action="bulk-target-sprint"]',
                ) as HTMLElement | null;
                setTargetMenu({ mode: "bulk-backlog", anchor: btn });
              },
        variant: "secondary" as const,
      },
    ];
  }, [
    backlogSelectedIds,
    nextSprint,
    upcomingSprints.length,
    assignManyToSprint,
  ]);

  // Slice 7 — per-row buttons for the SPRINT PANEL tree. Mirrors the
  // backlog tree's buttons but in reverse: "Remove from Sprint" pushes
  // the row back to the backlog (sprint_id = ""), and "Move to Sprint"
  // re-targets it to a different sprint via the same radial picker.
  const panelRowButtons = useCallback(
    (row: WorkItem): RowButton[] => {
      return [
        {
          key: "remove-from-sprint",
          label: "Remove",
          ariaLabel: `Remove ${row.title ?? row.id} from this sprint`,
          onClick: () => void assignToSprint(row.id, null),
          variant: "secondary",
        },
        {
          key: "move-to-sprint",
          label: "Move to Sprint",
          ariaLabel: `Pick a different sprint for ${row.title ?? row.id}`,
          disabled: upcomingSprints.length === 0,
          onClick: () => {
            const anchorEl =
              (document.activeElement as HTMLElement | null) ?? null;
            setTargetMenu({ mode: "row-panel", rowId: row.id, anchor: anchorEl });
          },
          variant: "ghost",
        },
      ];
    },
    [assignToSprint, upcomingSprints.length],
  );

  // Slice 7 — bulk-leading buttons for the SPRINT PANEL tree.
  // "Remove from Sprint Backlog" clears sprint_id on every selected row.
  // "Move to Sprint" opens the radial picker in bulk-panel mode.
  const panelBulkLeadingButtons = useMemo(() => {
    if (panelSelectedIds.size === 0) return undefined;
    return [
      {
        key: "panel-bulk-remove",
        label: `Remove ${panelSelectedIds.size} from Sprint Backlog`,
        ariaLabel: `Remove ${panelSelectedIds.size} selected item${panelSelectedIds.size === 1 ? "" : "s"} from sprint`,
        onClick: () => {
          const ids = Array.from(panelSelectedIds);
          void assignManyToSprint(ids, null);
        },
        variant: "secondary" as const,
      },
      {
        key: "panel-bulk-move",
        label: "Move to Sprint",
        ariaLabel: `Pick a target sprint for ${panelSelectedIds.size} selected item${panelSelectedIds.size === 1 ? "" : "s"}`,
        disabled: upcomingSprints.length === 0,
        onClick:
          upcomingSprints.length === 0
            ? undefined
            : () => {
                // bulkSelectionRef is reused by the radial onPick handler
                // for bulk-panel mode (same callback shape as bulk-backlog).
                bulkSelectionRef.current = new Set(panelSelectedIds);
                const btn = panelBulkBarRef.current?.querySelector(
                  '[data-action="panel-bulk-move"]',
                ) as HTMLElement | null;
                setTargetMenu({ mode: "bulk-panel", anchor: btn });
              },
        variant: "primary" as const,
      },
    ];
  }, [panelSelectedIds, upcomingSprints.length, assignManyToSprint]);

  const subscriptionID = sentinel_tenant?.id ?? null;
  const sprintID = filters.sprint_id || null;
  const topic = subscriptionID
    ? sprintID
      ? rankTopic("work_item", subscriptionID, "sprint", sprintID)
      : rankTopic("work_item", subscriptionID, "backlog", subscriptionID)
    : null;
  useRefetchOnPush({ topic, refetch });

  return (
    <PageContent>
      <>
        <PageHeading
          level={1}
          title={full}
          subtitle={
            backlogSelectedIds.size > 0
              ? `${backlogSelectedIds.size} selected — use the bulk bar to add or target a sprint.`
              : "Plan the active sprint — drag items from the backlog into the sprint panel."
          }
        />
        <PageDescription>
          Manage the active sprint. The top panel holds the sprint scope; the bottom grid is the workspace backlog (same clamp as Work Items). Drag stories from the backlog onto the sprint to commit them.
        </PageDescription>

        {/* Top panel — sprint scope. Title + description reflect the
            currently-displayed sprint (which defaults to useNextSprint's
            pick but can be overridden via the Switch Sprint button).
            The body is now a live ObjectTreeV2 clamped to the sprint's
            work items rather than a static drop-zone placeholder. */}
        <Panel
          name="panel_value_sprint_target"
          className="page-panel-heading value-sprint__target"
          title={panelSprint?.timeboxes_sprints_name ?? "No upcoming sprint"}
          description={
            panelSprint
              ? `${panelSprint.timeboxes_sprints_date_start ?? "—"} → ${panelSprint.timeboxes_sprints_date_end ?? "—"} · status ${panelSprint.timeboxes_sprints_status ?? "—"}`
              : "Create a planned sprint to begin — the next future-dated sprint will surface here automatically."
          }
        >
          {/* Switch Sprint affordance — opens a radial picker with all
              planned + active sprints, up to 8. Disabled when fewer than
              two options exist (no point switching away from the only
              candidate). Placement: a small button row above the tree
              so it sits inside the panel chrome. */}
          <div className="value-sprint__PanelHeaderActions" role="toolbar" aria-label="Sprint panel actions">
            <button
              ref={switchSprintBtnRef}
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={upcomingSprints.length < 2}
              onClick={() =>
                setTargetMenu({
                  mode: "switch-panel",
                  anchor: switchSprintBtnRef.current,
                })
              }
              aria-label="Switch the displayed sprint"
            >
              Switch sprint
            </button>
          </div>

          {/* Sprint-backlog tree renders BARE (no title / addressableName)
              so it doesn't nest a Panel inside this outer Panel. The
              outer Panel owns the chrome; the tree owns the table.
              Mounted only when a sprint is loaded — see panelWizardConfig
              for the rationale. */}
          {catalogueReady && panelWizardConfig && (
            <div ref={panelBulkBarRef}>
              <ObjectTree
                selectedId={panelSelectedItem?.id ?? null}
                onSelect={setPanelSelectedItem}
                wizardConfig={panelWizardConfig}
                multiSelectEnabled
                onSelectionChange={setPanelSelectedIds}
                rowButtons={panelRowButtons}
                hideCogMenu
                dropColumnKeys={PANEL_DROP_COLS}
                refetchRef={panelRefetchRef}
                bulkLeadingButtons={panelBulkLeadingButtons}
                savedViews={{ kind: "objecttree", target: SAVED_VIEW_TARGET_PANEL }}
              />
            </div>
          )}
        </Panel>

        {/* Bottom panel — workspace backlog (ObjectTreeV2, clamp = Work Items).
            Renders unconditionally; ObjectTree shows its own loader while the
            artefact-type catalogue resolves. Work Items keeps the types guard
            because its summary cells depend on the catalogue; we don't. */}
        {/* Wrap the backlog ObjectTree in a ref'd div so the bulk
            "Target Sprint" button click handler can locate itself via
            [data-action="bulk-target-sprint"] for the radial menu's
            anchor. The data-action attribute is stamped on every leading
            button by BulkActionBar. */}
        <div ref={bulkBarRef}>
          {catalogueReady && (
            <ObjectTree
              title="Backlog"
              addressableName="value_sprint_backlog_tree_ll"
              subtitleBadge="00"
              subtitle="Workspace backlog"
              description="All work items in scope. Drag rows onto the sprint above to commit them."
              selectedId={selectedItem?.id ?? null}
              onSelect={setSelectedItem}
              wizardConfig={wizardConfig}
              multiSelectEnabled
              onSelectionChange={setBacklogSelectedIds}
              rowButtons={backlogRowButtons}
              hideCogMenu
              dropColumnKeys={BACKLOG_DROP_COLS}
              refetchRef={backlogRefetchRef}
              bulkLeadingButtons={bulkLeadingButtons}
              savedViews={{ kind: "objecttree", target: SAVED_VIEW_TARGET_BACKLOG }}
            />
          )}
        </div>

        {/* Slice 5 — radial picker. Open state is page-owned so the same
            instance services every row's "Target Sprint" button. We
            re-bind onPick to the currently-open row id so a stale
            closure can't fire a PATCH against the wrong work item. */}
        <RadialPillMenu
          open={!!targetMenu}
          anchor={targetMenu?.anchor ?? null}
          items={upcomingSprints.map((s) => ({
            id: s.timeboxes_sprints_id,
            label: s.timeboxes_sprints_name ?? "Sprint",
          }))}
          maxItems={8}
          ariaLabel="Pick a target sprint"
          onPick={(sprintId) => {
            if (!targetMenu) return;
            switch (targetMenu.mode) {
              case "row-backlog":
                void assignToSprint(targetMenu.rowId, sprintId);
                break;
              case "row-panel":
                // Move from one sprint to another — same PATCH, just
                // anchored on a panel row.
                void assignToSprint(targetMenu.rowId, sprintId);
                break;
              case "bulk-backlog": {
                const ids = Array.from(bulkSelectionRef.current);
                void assignManyToSprint(ids, sprintId);
                break;
              }
              case "bulk-panel": {
                const ids = Array.from(bulkSelectionRef.current);
                void assignManyToSprint(ids, sprintId);
                break;
              }
              case "switch-panel":
                // Slice 7 — switch the panel's currently-displayed
                // sprint. Local state only; the data hook on the
                // sprint-backlog ObjectTree re-fires when resourceUrl
                // changes (it carries panelSprintId).
                setPanelSprintIdOverride(sprintId);
                break;
            }
          }}
          onClose={() => setTargetMenu(null)}
        />
      </>
    </PageContent>
  );
}
