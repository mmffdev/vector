"use client";

/**
 * DevScopeActionsPanel — scope-targeting action runner for Dev Setup.
 *
 * A cascading scope selector (Subscription → Workspace → Topology Node →
 * Artefact Type) feeds two scoped/destructive dev-DB actions:
 *   1. Reseed Flows — rebuilds flow snapshots/states for the chosen scope.
 *   2. Fixture Cleanup — one-time drop of synthetic FlowLayer* test types and
 *      Old/Pending artefacts (independent of the scope selector).
 *
 * Every action is gated behind a Preview → typed-confirm → Run sequence so the
 * user can review the blast radius before anything touches the DB. The
 * resolved scope is shown as a readable breadcrumb; whole-tenant targeting is
 * called out prominently in the danger tone.
 *
 * Mirrors the .dev-* idioms of DevPage.tsx (Panel, dev-p, dev-btn, dev-alert,
 * dev-confirm-input, dev-btn-group) — no inline style, no .dui-* mixing.
 */

import { useCallback, useEffect, useState } from "react";
import Panel from "@/app/components/Panel";
import {
  admin,
  type DevScope,
  type DevScopeOption,
  type DevReseedPreview,
  type DevReseedResult,
  type DevFixtureCleanupPreview,
  type DevFixtureCleanupResult,
} from "@/app/lib/apiSite";

// Sentinel value for the "— all —" option in each native <select>. Empty
// string is a legitimate option meaning "everything below this level".
const ALL = "";

// Confirm words the user must type before a destructive Run fires.
const RESEED_CONFIRM_WORD = "reseed";
const CLEANUP_CONFIRM_WORD = "cleanup";

const errMsg = (e: unknown, fallback: string): string =>
  e instanceof Error ? e.message : fallback;

export default function DevScopeActionsPanel() {
  // ─── Scope selector state ────────────────────────────────────────────────
  const [subscriptionOptions, setSubscriptionOptions] = useState<DevScopeOption[]>([]);
  const [workspaceOptions, setWorkspaceOptions] = useState<DevScopeOption[]>([]);
  const [topologyOptions, setTopologyOptions] = useState<DevScopeOption[]>([]);
  const [artefactTypeOptions, setArtefactTypeOptions] = useState<DevScopeOption[]>([]);

  const [subscriptionId, setSubscriptionId] = useState<string>(ALL);
  const [workspaceId, setWorkspaceId] = useState<string>(ALL);
  const [topologyNodeId, setTopologyNodeId] = useState<string>(ALL);
  const [artefactTypeId, setArtefactTypeId] = useState<string>(ALL);

  const [subsLoading, setSubsLoading] = useState(false);
  const [childLoading, setChildLoading] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);

  // ─── Reseed Flows action state ───────────────────────────────────────────
  const [includeCustomFlows, setIncludeCustomFlows] = useState(true);
  const [reseedPreview, setReseedPreview] = useState<DevReseedPreview | null>(null);
  const [reseedWholeTenant, setReseedWholeTenant] = useState(false);
  const [reseedPreviewLoading, setReseedPreviewLoading] = useState(false);
  const [reseedRunLoading, setReseedRunLoading] = useState(false);
  const [reseedConfirmText, setReseedConfirmText] = useState("");
  const [reseedResult, setReseedResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // ─── Fixture Cleanup action state ────────────────────────────────────────
  const [cleanupPreview, setCleanupPreview] = useState<DevFixtureCleanupPreview | null>(null);
  const [cleanupPreviewLoading, setCleanupPreviewLoading] = useState(false);
  const [cleanupRunLoading, setCleanupRunLoading] = useState(false);
  const [cleanupConfirmText, setCleanupConfirmText] = useState("");
  const [cleanupResult, setCleanupResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Reset the reseed confirm/preview gate. Called whenever the scope or
  // include-custom toggle changes so a stale preview can't be confirmed.
  const resetReseedGate = useCallback(() => {
    setReseedPreview(null);
    setReseedWholeTenant(false);
    setReseedConfirmText("");
    setReseedResult(null);
  }, []);

  // ─── Load subscriptions on mount ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSubsLoading(true);
      setScopeError(null);
      try {
        const res = await admin.devScopeSubscriptions();
        if (!cancelled) setSubscriptionOptions(res.options ?? []);
      } catch (e: unknown) {
        if (!cancelled) setScopeError(errMsg(e, "Failed to load subscriptions."));
      } finally {
        if (!cancelled) setSubsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Cascade: subscription change → reset + reload workspaces ────────────
  const handleSubscriptionChange = useCallback(
    async (next: string) => {
      setSubscriptionId(next);
      // Reset everything below.
      setWorkspaceId(ALL);
      setTopologyNodeId(ALL);
      setArtefactTypeId(ALL);
      setWorkspaceOptions([]);
      setTopologyOptions([]);
      setArtefactTypeOptions([]);
      resetReseedGate();
      setScopeError(null);
      if (next === ALL) return;
      setChildLoading(true);
      try {
        const res = await admin.devScopeWorkspaces(next);
        setWorkspaceOptions(res.options ?? []);
      } catch (e: unknown) {
        setScopeError(errMsg(e, "Failed to load workspaces."));
      } finally {
        setChildLoading(false);
      }
    },
    [resetReseedGate],
  );

  // ─── Cascade: workspace change → reset + reload nodes + types ────────────
  const handleWorkspaceChange = useCallback(
    async (next: string) => {
      setWorkspaceId(next);
      setTopologyNodeId(ALL);
      setArtefactTypeId(ALL);
      setTopologyOptions([]);
      setArtefactTypeOptions([]);
      resetReseedGate();
      setScopeError(null);
      if (next === ALL) return;
      setChildLoading(true);
      try {
        const [nodes, types] = await Promise.all([
          admin.devScopeTopologyNodes(next),
          admin.devScopeArtefactTypes(next),
        ]);
        setTopologyOptions(nodes.options ?? []);
        setArtefactTypeOptions(types.options ?? []);
      } catch (e: unknown) {
        setScopeError(errMsg(e, "Failed to load topology nodes / artefact types."));
      } finally {
        setChildLoading(false);
      }
    },
    [resetReseedGate],
  );

  const handleTopologyChange = useCallback(
    (next: string) => {
      setTopologyNodeId(next);
      resetReseedGate();
    },
    [resetReseedGate],
  );

  const handleArtefactTypeChange = useCallback(
    (next: string) => {
      setArtefactTypeId(next);
      resetReseedGate();
    },
    [resetReseedGate],
  );

  const handleIncludeCustomChange = useCallback(
    (checked: boolean) => {
      setIncludeCustomFlows(checked);
      resetReseedGate();
    },
    [resetReseedGate],
  );

  // ─── Resolved scope (for the API payload + breadcrumb) ───────────────────
  const scope: DevScope = {
    subscription_id: subscriptionId || null,
    workspace_id: workspaceId || null,
    topology_node_id: topologyNodeId || null,
    artefact_type_id: artefactTypeId || null,
  };

  const nameOf = (opts: DevScopeOption[], id: string): string =>
    opts.find((o) => o.id === id)?.name ?? id;

  const isWholeTenant = subscriptionId === ALL;

  // Readable breadcrumb segments — each level falls back to "all …".
  const breadcrumbSegments: string[] = isWholeTenant
    ? []
    : [
        nameOf(subscriptionOptions, subscriptionId),
        workspaceId ? nameOf(workspaceOptions, workspaceId) : "all workspaces",
        topologyNodeId ? nameOf(topologyOptions, topologyNodeId) : "all nodes",
        artefactTypeId ? nameOf(artefactTypeOptions, artefactTypeId) : "all types",
      ];

  // ─── Reseed: preview ─────────────────────────────────────────────────────
  const handleReseedPreview = async () => {
    setReseedPreviewLoading(true);
    setReseedPreview(null);
    setReseedWholeTenant(false);
    setReseedConfirmText("");
    setReseedResult(null);
    try {
      const res = await admin.devFlowReseedPreview({
        scope,
        include_custom_flows: includeCustomFlows,
      });
      setReseedPreview(res.preview);
      setReseedWholeTenant(res.whole_tenant);
    } catch (e: unknown) {
      setReseedResult({ ok: false, message: errMsg(e, "Preview failed.") });
    } finally {
      setReseedPreviewLoading(false);
    }
  };

  // ─── Reseed: run ─────────────────────────────────────────────────────────
  const handleReseedRun = async () => {
    setReseedRunLoading(true);
    setReseedResult(null);
    try {
      const res = await admin.devFlowReseedRun({
        scope,
        include_custom_flows: includeCustomFlows,
        confirm: "yes",
      });
      const r: DevReseedResult = res.result;
      setReseedResult({
        ok: true,
        message:
          `Reseed complete — ${r.types_processed} type(s) processed, ` +
          `${r.snapshots_rebuilt} snapshot(s) + ${r.flows_rebuilt} flow(s) rebuilt, ` +
          `${r.artefacts_rebound} artefact(s) rebound, ` +
          `${r.states_deleted} state(s) deleted / ${r.states_inserted} inserted, ` +
          `${r.transitions_rebuilt} transition(s) rebuilt. ` +
          `Backup saved: *_bak_${res.backup_suffix}. Reversible.`,
      });
      // Collapse the confirm gate after a successful run.
      setReseedPreview(null);
      setReseedWholeTenant(false);
      setReseedConfirmText("");
    } catch (e: unknown) {
      setReseedResult({ ok: false, message: errMsg(e, "Reseed failed.") });
    } finally {
      setReseedRunLoading(false);
    }
  };

  // ─── Cleanup: preview ────────────────────────────────────────────────────
  const handleCleanupPreview = async () => {
    setCleanupPreviewLoading(true);
    setCleanupPreview(null);
    setCleanupConfirmText("");
    setCleanupResult(null);
    try {
      const res = await admin.devFixtureCleanupPreview();
      setCleanupPreview(res.preview);
    } catch (e: unknown) {
      setCleanupResult({ ok: false, message: errMsg(e, "Preview failed.") });
    } finally {
      setCleanupPreviewLoading(false);
    }
  };

  // ─── Cleanup: run ────────────────────────────────────────────────────────
  const handleCleanupRun = async () => {
    setCleanupRunLoading(true);
    setCleanupResult(null);
    try {
      const res = await admin.devFixtureCleanupRun({ confirm: "yes" });
      const r: DevFixtureCleanupResult = res.result;
      setCleanupResult({
        ok: true,
        message:
          `Cleanup complete — ${r.flow_layer_types_deleted} FlowLayer type(s) + ` +
          `${r.flow_layer_flows_deleted} flow(s) (${r.flow_layer_flow_states_deleted} state(s)) deleted, ` +
          `${r.old_pending_artefacts_deleted} Old/Pending artefact(s) across ` +
          `${r.old_pending_types_deleted} type(s) deleted. ` +
          `Backup saved: *_bak_${res.backup_suffix}. Reversible.`,
      });
      setCleanupPreview(null);
      setCleanupConfirmText("");
    } catch (e: unknown) {
      setCleanupResult({ ok: false, message: errMsg(e, "Cleanup failed.") });
    } finally {
      setCleanupRunLoading(false);
    }
  };

  const reseedConfirmReady = reseedConfirmText === RESEED_CONFIRM_WORD;
  const cleanupConfirmReady = cleanupConfirmText === CLEANUP_CONFIRM_WORD;
  const anyReseedBusy = reseedPreviewLoading || reseedRunLoading;
  const anyCleanupBusy = cleanupPreviewLoading || cleanupRunLoading;

  return (
    <>
      {/* ─── Scope selector ──────────────────────────────────────────────── */}
      <Panel name="dev_scope_selector" title="Scope Target">
        <p className="dev-p">
          Pick how wide the actions below reach. Each level is optional — leaving
          a dropdown on <strong>&ldquo;— all —&rdquo;</strong> means
          &ldquo;everything below it&rdquo;. Choosing nothing targets the{" "}
          <strong>entire tenant DB</strong>.
        </p>

        <div className="dev-scope-grid">
          <label className="dev-scope-field">
            <span className="dev-scope-field__label">Subscription</span>
            <select
              className="dev-scope-select"
              value={subscriptionId}
              disabled={subsLoading}
              onChange={(e) => handleSubscriptionChange(e.target.value)}
            >
              <option value={ALL}>{subsLoading ? "Loading…" : "— all —"}</option>
              {subscriptionOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>

          <label className="dev-scope-field">
            <span className="dev-scope-field__label">Workspace</span>
            <select
              className="dev-scope-select"
              value={workspaceId}
              disabled={subscriptionId === ALL || childLoading}
              onChange={(e) => handleWorkspaceChange(e.target.value)}
            >
              <option value={ALL}>— all —</option>
              {workspaceOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>

          <label className="dev-scope-field">
            <span className="dev-scope-field__label">Topology Node</span>
            <select
              className="dev-scope-select"
              value={topologyNodeId}
              disabled={workspaceId === ALL || childLoading}
              onChange={(e) => handleTopologyChange(e.target.value)}
            >
              <option value={ALL}>— all —</option>
              {topologyOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>

          <label className="dev-scope-field">
            <span className="dev-scope-field__label">Artefact Type</span>
            <select
              className="dev-scope-select"
              value={artefactTypeId}
              disabled={workspaceId === ALL || childLoading}
              onChange={(e) => handleArtefactTypeChange(e.target.value)}
            >
              <option value={ALL}>— all —</option>
              {artefactTypeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className={`dev-scope-breadcrumb${
            isWholeTenant ? " dev-scope-breadcrumb--tenant" : ""
          }`}
        >
          <span className="dev-scope-breadcrumb__label">Scope</span>
          <span className="dev-scope-breadcrumb__path">
            {isWholeTenant
              ? "ENTIRE TENANT (all subscriptions)"
              : breadcrumbSegments.join("  ›  ")}
          </span>
        </div>

        {scopeError && (
          <div className="dev-alert dev-alert--error">{scopeError}</div>
        )}
      </Panel>

      {/* ─── Reseed Flows ────────────────────────────────────────────────── */}
      <Panel name="dev_scope_reseed" title="Reseed Flows">
        <p className="dev-p">
          Rebuilds flow snapshots, states, and transitions for the scope above,
          and repoints in-scope artefacts to their initial state. Preview first —
          the run is gated behind a typed confirmation and writes{" "}
          <code>*_bak_&lt;suffix&gt;</code> backup tables so it is reversible.
        </p>

        <label className="dev-scope-check">
          <input
            type="checkbox"
            checked={includeCustomFlows}
            disabled={anyReseedBusy}
            onChange={(e) => handleIncludeCustomChange(e.target.checked)}
          />
          Include custom (non-default) flows
        </label>

        <div className="dev-btn-group">
          <button
            onClick={handleReseedPreview}
            disabled={anyReseedBusy}
            className="dev-btn dev-btn--primary"
          >
            {reseedPreviewLoading ? "Previewing…" : "Preview"}
          </button>
        </div>

        {reseedPreview && (
          <>
            <div className="dev-scope-preview">
              Would rebuild <strong>{reseedPreview.default_flows}</strong> default
              + <strong>{reseedPreview.custom_flows}</strong> custom flow(s)
              {" "}(<strong>{reseedPreview.flows_total}</strong> total) across{" "}
              <strong>{reseedPreview.types}</strong> type(s); repoint{" "}
              <strong>{reseedPreview.artefacts_repoint}</strong> artefact(s) to
              their initial state.
              {!reseedPreview.include_custom_flows && (
                <> Custom flows are <strong>excluded</strong> from this run.</>
              )}
            </div>

            {reseedWholeTenant && (
              <div className="dev-scope-warn">
                ⚠ This targets the ENTIRE tenant DB — every subscription, every
                workspace. Make sure that is what you intend before running.
              </div>
            )}

            <div className="dev-btn-group">
              <input
                autoFocus
                value={reseedConfirmText}
                onChange={(e) => setReseedConfirmText(e.target.value)}
                className={`dev-confirm-input${
                  reseedConfirmReady ? " dev-confirm-input--ready" : ""
                }`}
                placeholder={`Type ${RESEED_CONFIRM_WORD}`}
                disabled={reseedRunLoading}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && reseedConfirmReady && !reseedRunLoading) {
                    handleReseedRun();
                  }
                }}
              />
              <button
                onClick={handleReseedRun}
                disabled={!reseedConfirmReady || reseedRunLoading}
                className="dev-btn dev-btn--danger"
              >
                {reseedRunLoading ? "Running…" : "Run reseed"}
              </button>
              <span className="dev-confirm-hint">
                Type <strong>{RESEED_CONFIRM_WORD}</strong> to enable the run.
              </span>
            </div>
          </>
        )}

        {reseedResult && (
          <div
            className={`dev-alert dev-alert--${reseedResult.ok ? "success" : "error"}`}
          >
            {reseedResult.message}
          </div>
        )}
      </Panel>

      {/* ─── Fixture Cleanup ─────────────────────────────────────────────── */}
      <Panel name="dev_scope_cleanup" title="Fixture Cleanup (one-time)">
        <p className="dev-p">
          Drops synthetic <code>FlowLayer*</code> test types and the Old/Pending
          artefacts. One-time dev-DB cleanup, <strong>independent of the scope
          above</strong>. Writes <code>*_bak_&lt;suffix&gt;</code> backups so it
          is reversible.
        </p>

        <div className="dev-btn-group">
          <button
            onClick={handleCleanupPreview}
            disabled={anyCleanupBusy}
            className="dev-btn dev-btn--primary"
          >
            {cleanupPreviewLoading ? "Previewing…" : "Preview"}
          </button>
        </div>

        {cleanupPreview && (
          <>
            <div className="dev-scope-preview">
              <strong>{cleanupPreview.flow_layer_types}</strong> FlowLayer type(s)
              / <strong>{cleanupPreview.flow_layer_flows}</strong> flow(s);{" "}
              <strong>{cleanupPreview.old_pending_artefacts}</strong> Old/Pending
              artefact(s) across <strong>{cleanupPreview.old_pending_types}</strong>{" "}
              type(s) will be DELETED. Child artefacts will be orphaned (parent
              set to null).
            </div>

            <div className="dev-btn-group">
              <input
                autoFocus
                value={cleanupConfirmText}
                onChange={(e) => setCleanupConfirmText(e.target.value)}
                className={`dev-confirm-input${
                  cleanupConfirmReady ? " dev-confirm-input--ready" : ""
                }`}
                placeholder={`Type ${CLEANUP_CONFIRM_WORD}`}
                disabled={cleanupRunLoading}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cleanupConfirmReady && !cleanupRunLoading) {
                    handleCleanupRun();
                  }
                }}
              />
              <button
                onClick={handleCleanupRun}
                disabled={!cleanupConfirmReady || cleanupRunLoading}
                className="dev-btn dev-btn--danger"
              >
                {cleanupRunLoading ? "Running…" : "Run cleanup"}
              </button>
              <span className="dev-confirm-hint">
                Type <strong>{CLEANUP_CONFIRM_WORD}</strong> to enable the run.
              </span>
            </div>
          </>
        )}

        {cleanupResult && (
          <div
            className={`dev-alert dev-alert--${cleanupResult.ok ? "success" : "error"}`}
          >
            {cleanupResult.message}
          </div>
        )}
      </Panel>
    </>
  );
}
