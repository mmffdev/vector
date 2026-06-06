"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { GridSprintReview } from "./GridSprintReview";
import RadialPillMenu from "@/app/components/RadialPillMenu/p_RadialPillMenu";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useSentinel } from "@/app/sentinel";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { useNextSprint, type SprintWireRow } from "@/app/hooks/useNextSprint";
import { sprints as sprintsApi } from "@/app/lib/apiSite";
import { ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { MdChevronLeft, MdChevronRight, MdOutlineFlag } from "react-icons/md";
import { BsCalendar3 } from "react-icons/bs";
import { usePageSavedViews } from "@/app/components/SavedViews/PageSavedViewsControl";
import { usePageHeader } from "@/app/contexts/PageHeaderContext";
import { SprintBurndownChart } from "@/app/components/SprintBurndownChart";
import { TaskBurndownChart } from "@/app/components/TaskBurndownChart";
import { useSprintMetrics } from "@/app/hooks/useSprintMetrics";
import { useTaskMetrics } from "@/app/hooks/useTaskMetrics";
import { useTeamVelocity } from "@/app/hooks/useTeamVelocity";

// Display rule for sprint identifiers — matches the backend's projection
// (backend/internal/timeboxsprints/sql.go and artefactitems/sql.go):
//   "<name> — <suffix>"  when suffix is non-empty
//   "<name>"             otherwise
// Backend stores name + suffix separately so renames don't disturb the
// numeric series; the UI joins them everywhere a sprint is identified.
function formatSprintLabel(s: SprintWireRow | null | undefined): string {
  if (!s) return "";
  const name = s.timeboxes_sprints_name ?? "";
  const suffix = (s.timeboxes_sprints_suffix ?? "").trim();
  return suffix ? `${name} — ${suffix}` : name;
}

// Page-level saved-views target. Single grid on this page (panel only).
// Body shape:
//   { grids: { panel: { visible_columns } } }
// See app/components/SavedViews/PageSavedViewsControl.tsx for the
// design + partial-body rule.
const SAVED_VIEW_TARGET_PAGE = "page:value_sprint_review";

export default function ValueSprintReview() {
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
    sentinel_can,
  } = useSentinel();
  const activeNodeId = sentinel_focus_node;
  const direction = sentinel_scope_down ? "descend" : sentinel_scope_up ? "ascend" : "none";

  // Page-level saved views — single dropdown rendered in the shell
  // header (left of the personal nav pill). One grid on this page
  // (the sprint-scoped review tree).
  const savedViewGrids = useMemo(() => ["panel"], []);
  const pageSavedViews = usePageSavedViews({
    target: SAVED_VIEW_TARGET_PAGE,
    grids: savedViewGrids,
    currentUserID: sentinel_user?.id ?? "",
    currentNodeID: activeNodeId,
    currentWorkspaceID: sentinel_user?.workspace_id ?? "",
    canShareToNode: !!activeNodeId,
    // Proxy: workspace.archive stands in for "can share to workspace
    // scope" until a dedicated workspace.share_views code exists. Same
    // TD as the per-grid SavedViewsControl — TD-SAVEDVIEWS-WORKSPACE-SHARE-PERM-CODE.
    canShareToWorkspace: sentinel_can("workspace.archive"),
  });
  // The saved-views header dropdown stays (page chrome). Its per-grid column
  // control (`bind("panel")`) is intentionally NOT wired to GridSprintReview:
  // the Grid primitive has no column show/hide concept yet — see
  // TD-GRID-SAVEDVIEWS-COLUMNS. The dropdown still persists the view name/scope;
  // column visibility lands when the primitive gains it.
  usePageHeader({
    title: full,
    actions: pageSavedViews.node,
  });

  // Live "next sprint" lookup for the panel. The wire's workspace_id is
  // the tenant/subscription root UUID (see the live /timeboxes/sprints
  // response). That maps to sentinel_user.tenant_id, NOT
  // sentinel_user.workspace_id — they are distinct fields on
  // SentinelUser. The topology focus node is passed so the backend's
  // ancestor walk fires when the user is viewing a child node of a
  // propagated sprint.
  const workspaceId = sentinel_user?.tenant_id ?? null;
  const {
    sprint: nextSprint,
    upcoming: upcomingSprints,
    chronological: allSprints,
    refetch: refetchNextSprint,
  } = useNextSprint(workspaceId, activeNodeId, 8);

  const [filters] = useState({ sprint_id: "" });

  // Radial picker open state. Single shared instance, mode-tagged so
  // onPick knows what to do with the picked id:
  //
  //   { mode: "switch-panel",   anchor }  — Switch Sprint affordance
  //                                          on the sprint panel header
  //   { mode: "status-panel",   anchor }  — Sprint Status picker
  //                                          (planned / active / completed).
  //                                          Backend enforces forward-only
  //                                          transitions; pills for illegal
  //                                          transitions render disabled.
  type TargetMenuMode =
    | { mode: "switch-panel"; anchor: HTMLElement | null }
    | { mode: "status-panel"; anchor: HTMLElement | null };
  const [targetMenu, setTargetMenu] = useState<TargetMenuMode | null>(null);

  // Sprint-panel tree state. The panel shows the work items assigned
  // to a specific sprint. `panelSprintIdOverride` lets the user pick a
  // different sprint via the Switch Sprint affordance; when null we
  // fall through to useNextSprint's pick.
  const [panelSprintIdOverride, setPanelSprintIdOverride] = useState<string | null>(null);

  // Date-driven "current" sprint — the sprint whose [start, end] window
  // contains today. This is the page's DEFAULT landing target and powers the
  // "Current sprint" jump button. Wire dates are ISO YYYY-MM-DD with no time
  // component, so a string compare against today's local-date ISO works without
  // timezone juggling.
  //
  // Overlap tiebreak: sprint windows CAN overlap (e.g. Sprint 1 — Alpha
  // 05-28→06-10 and Sprint 1 — Red 06-02→06-15 both contain 06-06). When more
  // than one window contains today we pick the MOST-RECENTLY-STARTED one — the
  // freshest active sprint — so the page lands on the sprint the team most
  // recently kicked off, not an older still-open one.
  //
  // Returns null only when today falls in NO sprint window (e.g. a gap between
  // two planned sprints) — the panelSprintId fallback chain handles that.
  const currentSprint = useMemo<SprintWireRow | null>(() => {
    if (allSprints.length === 0) return null;
    const t = new Date();
    const todayISO = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const containing = allSprints.filter((s) => {
      const start = s.timeboxes_sprints_date_start;
      const end = s.timeboxes_sprints_date_end;
      if (!start || !end) return false;
      return start <= todayISO && todayISO <= end;
    });
    if (containing.length === 0) return null;
    return containing.reduce((latest, s) =>
      (s.timeboxes_sprints_date_start ?? "") >
      (latest.timeboxes_sprints_date_start ?? "")
        ? s
        : latest,
    );
  }, [allSprints]);

  // Resolved sprint id for the panel. Precedence:
  //   1. panelSprintIdOverride — an explicit user pick (Switch / Prev / Next /
  //      Current), or the auto-advance landing the current sprint once
  //      allSprints loads.
  //   2. currentSprint — the sprint whose date window contains TODAY. The
  //      page's intended default: it always lands on the in-flight sprint by
  //      date range, NOT the next upcoming one.
  //   3. nextSprint — only when today is in NO sprint window (a gap between
  //      sprints); falling forward to the next-up sprint is the sensible
  //      degrade.
  const panelSprintId =
    panelSprintIdOverride ??
    currentSprint?.timeboxes_sprints_id ??
    nextSprint?.timeboxes_sprints_id ??
    null;
  // Resolve from `allSprints` first so Prev/Next navigation into completed
  // sprints (which are excluded from `upcomingSprints`) still surfaces the
  // correct title / dates / status. Fall back to upcoming + nextSprint
  // for the initial render path where allSprints hasn't loaded yet.
  const panelSprint = useMemo(
    () =>
      allSprints.find((s) => s.timeboxes_sprints_id === panelSprintId) ??
      upcomingSprints.find((s) => s.timeboxes_sprints_id === panelSprintId) ??
      nextSprint,
    [allSprints, upcomingSprints, panelSprintId, nextSprint],
  );

  // Sprint burndown — reads the on-demand metrics engine for the
  // currently-displayed sprint. Subscribes to the same sprint rank topic
  // the tree uses so it wakes on pushes; the hook's 60s poll + the ↻
  // button are the reliable freshness path until the rank trigger fires
  // on flow-state/sprint-membership changes (TD-SPRINT-BURN-REALTIME-NOTIFY).
  const burndownTopic =
    sentinel_tenant?.id && panelSprintId
      ? rankTopic("work_item", sentinel_tenant.id, "sprint", panelSprintId)
      : null;
  const {
    model: burndownModel,
    loading: burndownLoading,
    refetch: refetchBurndown,
  } = useSprintMetrics(panelSprintId, burndownTopic);

  // Task-count burndown — engineering-team view, beside the story chart. Same
  // sprint + rank topic; a separate engine (taskmetrics) so the two never
  // couple. Burns at the engineer's "done", not the PO's "accepted".
  const {
    model: taskModel,
    loading: taskLoading,
    refetch: refetchTask,
  } = useTaskMetrics(panelSprintId, burndownTopic);

  // Cross-sprint team velocity — workspace-level, independent of the displayed
  // sprint. Shown as a distinct KPI in the burndown strip.
  const { data: teamVelocity, refresh: refreshTeamVelocity } = useTeamVelocity();

  // Refresh both metrics together — an acceptance moves the burndown AND can
  // change team velocity (once the sprint is past-dated).
  const refreshMetrics = useCallback(() => {
    void refetchBurndown();
    void refreshTeamVelocity();
    void refetchTask();
  }, [refetchBurndown, refreshTeamVelocity, refetchTask]);

  // Hide the button when the panel is already on the current sprint
  // (no-op affordance reads as clutter), or when there's no current
  // sprint to jump to.
  const showCurrentSprintBtn =
    !!currentSprint &&
    currentSprint.timeboxes_sprints_id !== panelSprintId;

  // Auto-advance to the new active sprint when the date rolls past a
  // sprint boundary — BUT only if the user hasn't manually navigated
  // away. We track the last currentSprint id we auto-advanced TO; if the
  // panel override matches that, we move forward when currentSprint
  // changes. If the user picked something else (override doesn't match
  // the last auto-advance), we don't yank them.
  const autoAdvancedToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentSprint) return;
    const newId = currentSprint.timeboxes_sprints_id;
    const userPickedDifferent =
      panelSprintIdOverride !== null &&
      panelSprintIdOverride !== autoAdvancedToRef.current;
    if (userPickedDifferent) return;
    if (panelSprintIdOverride === newId) return;
    setPanelSprintIdOverride(newId);
    autoAdvancedToRef.current = newId;
  }, [currentSprint, panelSprintIdOverride]);

  // Switch-sprint button anchor ref. Lives on the panel header so the
  // user can flip between sprints without scrolling away.
  const switchSprintBtnRef = useRef<HTMLButtonElement | null>(null);
  // Prev/Next sprint navigators walk the `upcoming` list by index, anchored
  // to their own buttons. They're index-only — no menu opens — so no
  // anchor is strictly needed, but refs make focus-after-click hygienic.
  const prevSprintBtnRef = useRef<HTMLButtonElement | null>(null);
  const nextSprintBtnRef = useRef<HTMLButtonElement | null>(null);
  // Sprint Status button anchor — opens the radial picker with the three
  // lifecycle states (Planning / In Flight / Completed). The picker
  // greys-out illegal transitions; the backend re-enforces them.
  const statusSprintBtnRef = useRef<HTMLButtonElement | null>(null);

  // The sprint backlog tree now lives in <GridSprintReview> (the Grid
  // primitive). It owns its own type clamp (story tier), data fetch, realtime,
  // and inline-form wiring — see GridSprintReview.tsx. The page keeps only the
  // sprint-selection chrome (header, nav/status buttons, burndown).

  // Realtime refetch — refreshes the sprint header (name / dates / status) so
  // out-of-band sprint changes surface without a manual reload. The grid
  // refreshes itself via its own rank subscription.
  const refetch = useCallback(async () => {
    await refetchNextSprint();
  }, [refetchNextSprint]);

  useEffect(() => {
    void refetch();
  }, [refetch, activeNodeId, direction]);

  // Prev/Next sprint navigation. Walks the `chronological` list (all
  // statuses, sorted ascending by start_date) so users can step BACK into
  // completed sprints to reflect. The step-target is computed from the
  // currently-displayed sprint id, not from a local pointer, so
  // out-of-band changes (a sprint deleted in another tab, the
  // chronological list refetched) settle correctly on the next render.
  const stepSprint = useCallback(
    (dir: -1 | 1) => {
      if (!panelSprintId || allSprints.length === 0) return;
      const i = allSprints.findIndex(
        (s) => s.timeboxes_sprints_id === panelSprintId,
      );
      if (i < 0) return;
      const next = allSprints[i + dir];
      if (!next) return;
      setPanelSprintIdOverride(next.timeboxes_sprints_id);
    },
    [panelSprintId, allSprints],
  );

  const sprintNavState = useMemo(() => {
    const i = panelSprintId
      ? allSprints.findIndex((s) => s.timeboxes_sprints_id === panelSprintId)
      : -1;
    return {
      hasPrev: i > 0,
      hasNext: i >= 0 && i < allSprints.length - 1,
    };
  }, [allSprints, panelSprintId]);

  // Sprint Status transitions. The backend is the gate: `planned → active`
  // via /sprints/{id}/start, `active → completed` via /sprints/{id}/close.
  // No path back: a started sprint cannot be un-started, a completed
  // sprint cannot be re-opened. The radial picker renders illegal
  // transitions disabled (mirror state below), and this callback also
  // refuses no-ops + illegal moves with a toast — defence-in-depth in
  // case a stale render somehow fires through.
  const setSprintStatus = useCallback(
    async (target: "planned" | "active" | "completed") => {
      if (!panelSprint || !workspaceId || !activeNodeId) return;
      const scopeParams = new URLSearchParams({
        workspace_id: workspaceId,
        org_node_id: activeNodeId,
      }).toString();
      const current = panelSprint.timeboxes_sprints_status ?? "";
      if (current === target) return;
      try {
        if (current === "planned" && target === "active") {
          await sprintsApi.start(panelSprint.timeboxes_sprints_id, scopeParams);
          notify.success("Sprint started.");
        } else if (current === "active" && target === "completed") {
          await sprintsApi.close(panelSprint.timeboxes_sprints_id, scopeParams);
          notify.success("Sprint completed.");
        } else {
          notify.error(
            `Cannot move sprint from "${current}" to "${target}".`,
          );
          return;
        }
        await refetch();
      } catch (err) {
        notify.apiError(err as ApiError, "Failed to change sprint status.");
      }
    },
    [panelSprint, workspaceId, activeNodeId, refetch],
  );

  const subscriptionID = sentinel_tenant?.id ?? null;
  const sprintID = filters.sprint_id || null;
  const topic = subscriptionID
    ? sprintID
      ? rankTopic("work_item", subscriptionID, "sprint", sprintID)
      : rankTopic("work_item", subscriptionID, "backlog", subscriptionID)
    : null;
  useRefetchOnPush({ topic, refetch });

  return (
    <PageContent className="value-sprint-review">
      <>
        <PageHeading
          level={1}
          title={full}
          subtitle="Track sprints in flight — defaults to today's active sprint and auto-advances when a new sprint becomes active."
        />
        <PageDescription>
          Review sprint progress with full work-item hierarchy. State changes on child items roll up to their parents automatically.
        </PageDescription>

        {/* Two burndowns side-by-side at 50% each — the PO view (story points,
            earned at Accepted) and the engineering-team view (task count,
            earned at the engineer's Done). Story = the problem; task = the
            solution. Separate engines (sprintmetrics / taskmetrics) so they
            never couple. Stacks to one column below 900px. */}
        {/* Shared refresh — one ↻ for BOTH charts (refreshMetrics refetches
            story + task + team velocity together). Lives above the row so
            neither panel carries extra chrome that would offset its plot and
            break the two charts' row-alignment. */}
        <div className="value-sprint-review__burndown-bar">
          <button
            type="button"
            className="btn"
            onClick={() => refreshMetrics()}
            aria-label="Refresh burndown charts"
            title="Refresh burndown charts"
          >
            <span>↻ Refresh</span>
          </button>
        </div>

        <div className="value-sprint-review__burndown-row">
          <div className="value-sprint-review__burndown-col">
            <Panel
              name="panel_value_sprint_review_burndown"
              className="page-panel-heading"
              title="Sprint burndown"
              description="Story points remaining vs. the ideal pace, with forecast cone and scope-change history."
            >
              {burndownModel ? (
                <SprintBurndownChart model={burndownModel} teamVelocity={teamVelocity} />
              ) : (
                <p className="text-size-90">
                  {burndownLoading
                    ? "Loading burndown…"
                    : panelSprintId
                      ? "No burndown data for this sprint yet — it populates as items are added and accepted."
                      : "Select a sprint to see its burndown."}
                </p>
              )}
            </Panel>
          </div>

          <div className="value-sprint-review__burndown-col">
            <Panel
              name="panel_value_sprint_review_task_burndown"
              className="page-panel-heading"
              title="Task burndown"
              description="Tasks completed vs. the ideal pace — the engineering-team view. A task burns when its owner marks it done."
            >
              {taskModel ? (
                <TaskBurndownChart model={taskModel} />
              ) : (
                <p className="text-size-90">
                  {taskLoading
                    ? "Loading task burndown…"
                    : panelSprintId
                      ? "This sprint has no tasks under its stories yet — the chart appears as soon as a story in the sprint has Task children."
                      : "Select a sprint to see its task burndown."}
                </p>
              )}
            </Panel>
          </div>
        </div>

        {/* Sprint-scoped panel — title + description reflect the
            currently-displayed sprint (which defaults to useNextSprint's
            pick but can be overridden via the Switch Sprint button).
            The body is a live ObjectTreeV2 clamped to the sprint's
            work items, rendered WITH chevrons so children expand
            inline. */}
        <Panel
          name="panel_value_sprint_review_target"
          className="page-panel-heading value-sprint-review__target"
          title={panelSprint ? formatSprintLabel(panelSprint) : "No upcoming sprint"}
          description={
            panelSprint ? (
              <>
                <BsCalendar3 aria-hidden /> {panelSprint.timeboxes_sprints_date_start ?? "—"} → {panelSprint.timeboxes_sprints_date_end ?? "—"} · status {panelSprint.timeboxes_sprints_status ?? "—"}
              </>
            ) : (
              "Create a planned sprint to begin — the next future-dated sprint will surface here automatically."
            )
          }
        >
          {/* The sprint backlog is the Grid primitive (GridSprintReview),
              clamped to the panel sprint + the story tier. The outer Panel
              owns the chrome; the grid owns the table + its own action bar.
              Mounted only when a sprint is loaded — an unresolved clamp
              returns nothing, so there's no point mounting before then.

              The sprint Prev / Next / Current / Switch / Status buttons are
              injected onto the grid's action bar via the `leading` slot so
              they sit at the start of the band, exactly as before. */}
          {panelSprintId && (
            <GridSprintReview
              panelSprintId={panelSprintId}
              onMembershipChanged={refreshMetrics}
              actionBarLeading={
                <>
                  {sprintNavState.hasPrev && (
                    <button
                      ref={prevSprintBtnRef}
                      type="button"
                      className="btn"
                      onClick={() => stepSprint(-1)}
                      aria-label="Previous sprint"
                      title="Previous sprint"
                    >
                      <span className="btn__icon">
                        <MdChevronLeft size={14} />
                      </span>
                      <span>Prev</span>
                    </button>
                  )}
                  {sprintNavState.hasNext && (
                    <button
                      ref={nextSprintBtnRef}
                      type="button"
                      className="btn"
                      onClick={() => stepSprint(1)}
                      aria-label="Next sprint"
                      title="Next sprint"
                    >
                      <span>Next</span>
                      <span className="btn__icon">
                        <MdChevronRight size={14} />
                      </span>
                    </button>
                  )}
                  {showCurrentSprintBtn && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (currentSprint) {
                          setPanelSprintIdOverride(
                            currentSprint.timeboxes_sprints_id,
                          );
                        }
                      }}
                      aria-label="Jump to the current sprint (today's date)"
                      title="Jump to the sprint that today's date falls within"
                    >
                      <span className="btn__icon">
                        <BsCalendar3 aria-hidden />
                      </span>
                      <span>Current sprint</span>
                    </button>
                  )}
                  <button
                    ref={switchSprintBtnRef}
                    type="button"
                    className="btn"
                    disabled={upcomingSprints.length < 2}
                    onClick={() =>
                      setTargetMenu({
                        mode: "switch-panel",
                        anchor: switchSprintBtnRef.current,
                      })
                    }
                    aria-label="Switch the displayed sprint"
                  >
                    <span>Switch sprint</span>
                  </button>
                  <button
                    ref={statusSprintBtnRef}
                    type="button"
                    className="btn"
                    disabled={!panelSprint}
                    onClick={() =>
                      setTargetMenu({
                        mode: "status-panel",
                        anchor: statusSprintBtnRef.current,
                      })
                    }
                    aria-label={`Sprint status — ${panelSprint?.timeboxes_sprints_status ?? "—"}`}
                    title="Change sprint status"
                  >
                    <span className="btn__icon">
                      <MdOutlineFlag size={14} />
                    </span>
                    <span>Sprint Status</span>
                  </button>
                </>
              }
            />
          )}
        </Panel>

        {/* Radial picker. Open state is page-owned so the same instance
            services the Switch Sprint affordance AND the Sprint Status
            picker. Items + aria-label switch on mode; the onPick id is
            a sprint UUID for switch-panel and one of
            "planned"/"active"/"completed" for status-panel. */}
        <RadialPillMenu
          open={!!targetMenu}
          anchor={targetMenu?.anchor ?? null}
          items={
            targetMenu?.mode === "status-panel"
              ? (() => {
                  // Backend state machine (timeboxsprints/sql.go):
                  //   planned → active   via /sprints/{id}/start
                  //   active  → completed via /sprints/{id}/close
                  // No reverse paths; PATCH on status is also blocked
                  // for these transitions. The pill list always shows
                  // all 3 states so the user has the full mental model,
                  // but illegal moves render disabled.
                  const cur = panelSprint?.timeboxes_sprints_status ?? "";
                  const legal = (target: string): boolean => {
                    if (cur === target) return false;
                    if (cur === "planned" && target === "active") return true;
                    if (cur === "active" && target === "completed") return true;
                    return false;
                  };
                  return [
                    { id: "planned", label: "Planning", disabled: !legal("planned"), current: cur === "planned" },
                    { id: "active", label: "In Flight", disabled: !legal("active"), current: cur === "active" },
                    { id: "completed", label: "Completed", disabled: !legal("completed"), current: cur === "completed" },
                  ];
                })()
              : upcomingSprints.map((s) => ({
                  id: s.timeboxes_sprints_id,
                  label: formatSprintLabel(s) || "Sprint",
                }))
          }
          maxItems={8}
          ariaLabel={
            targetMenu?.mode === "status-panel"
              ? "Pick a sprint status"
              : "Pick a target sprint"
          }
          onPick={(pickedId) => {
            if (!targetMenu) return;
            switch (targetMenu.mode) {
              case "switch-panel":
                // Switch the panel's currently-displayed sprint.
                // Local state only; the data hook on the sprint
                // ObjectTree re-fires when resourceUrl changes (it
                // carries panelSprintId).
                setPanelSprintIdOverride(pickedId);
                break;
              case "status-panel":
                // pickedId is the target lifecycle state, not a UUID.
                if (pickedId === "planned" || pickedId === "active" || pickedId === "completed") {
                  void setSprintStatus(pickedId);
                }
                break;
            }
          }}
          onClose={() => setTargetMenu(null)}
        />
      </>
    </PageContent>
  );
}
