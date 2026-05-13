"use client";

// /portfolio-model — smart router (Card 00015).
//
// Branch logic:
//   1. Role gate runs FIRST. gadmin and "user" roles are redirected to
//      /dashboard before any portfolio-model fetch is fired (avoids
//      leaking the request from non-padmin roles even though the
//      backend rejects them).
//   2. Padmin → fetch GET /api/portfolio-models/adoption-state.
//   3. Branch on the response and local overlay state:
//        - adopted=true                 → render BundleView (existing
//                                          model preview).
//        - adopted=false, no overlay     → render WizardModelCardList
//                                          (00019).
//        - adopted=false, overlay active → render AdoptionOverlay
//                                          (00017) using the (modelId,
//                                          stateId) handed up by the
//                                          wizard's onAdoptStarted, or
//                                          a resumed in-flight session.
//   4. On overlay onDone → re-fetch adoption-state; the next render
//      lands in the adopted=true branch and the preview shows.
//   5. On overlay onFail → unmount the overlay and fall back to the
//      wizard. The overlay's own UI surfaces the failure to the user
//      (00018); this router just stops rendering it.
//
// Subscription ID for the overlay comes from the auth/session context
// (`useAuth().user.subscription_id`) — the same source other padmin
// surfaces use; never the URL.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import Table from "@/app/components/Table";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { api, apiSite, ApiError } from "@/app/lib/api";
import { useHintOnce } from "@/app/lib/hints";
import { workspacesApi } from "@/app/lib/workspacesApi";
import WizardModelCardList from "./WizardModelCardList";
import AdoptionOverlay, {
  type AdoptionDoneEvent,
  type AdoptionFailEvent,
} from "./AdoptionOverlay";
import LayersPreviewTable from "./LayersPreviewTable";

export interface LayerDTO {
  id: string;
  name: string;
  tag: string;
  sort_order: number;
  description_md: string | null;
}

// Post-R010: portfolio_templates are flat — no family, no version. The
// preview fetches the adopted template by its UUID (from
// adoption-state.model_id). The legacy /{id}/latest route is kept for
// path stability; backend now resolves it to the same template fetch.
interface ModelDTO {
  id: string;
  name: string;
  description: string | null;
}

interface WorkflowDTO {
  id: string;
  layer_id: string;
  state_key: string;
  state_label: string;
  sort_order: number;
  is_initial: boolean;
  is_terminal: boolean;
}

interface TransitionDTO {
  id: string;
  from_state_id: string;
  to_state_id: string;
}

interface ArtifactDTO {
  id: string;
  artifact_key: string;
  enabled: boolean;
}

interface TerminologyDTO {
  id: string;
  key: string;
  value: string;
}

interface BundleDTO {
  model: ModelDTO;
  layers: LayerDTO[];
  workflows: WorkflowDTO[];
  transitions: TransitionDTO[];
  artifacts: ArtifactDTO[];
  terminology: TerminologyDTO[];
}

// PLA-0026 / Story 00507 (F1) — wire shape of GET /api/portfolio/master_record.
// Backend reads the persistent portfolio model record from
// vector_artefacts.master_record_portfolio. model_name + model_description
// are the prose copied at adoption time and are the ONLY runtime read of
// adopted-model identity — the legacy mmff_library bundle is never used
// as a display source after adoption (see backend handler comment).
interface MasterRecordDTO {
  workspace_id: string;
  model_id: string | null;
  model_name: string;
  model_description: string | null;
  adopted_at: string;
  adopted_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

// Wire shape of GET /api/portfolio-models/adoption-state. The endpoint
// only returns `adopted=true` for status='completed' rows; in-flight
// saga rows are reported as adopted=false (see backend
// adoption_state.go). That means cross-session resume cannot be driven
// from this response alone — the in-flight branch is entered locally
// when the wizard hands us a (stateId, modelId) via onAdoptStarted.
interface AdoptionStateDTO {
  adopted: boolean;
  model_id?: string;
  adopted_at?: string;
  adopted_by_user_id?: string;
}

type StateView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "wizard" }
  | { kind: "overlay"; modelId: string; stateId: string }
  | { kind: "adopted"; modelId: string }
  | { kind: "missing-bundle" }
  | { kind: "preview"; bundle: BundleDTO; workspaceId: string };

export default function PortfolioModelPage() {
  const { full } = usePageTitle();
  const { user, loading: authLoading } = useAuth();
  const canEditModel = useHasPermission("portfolio.model.edit");
  const router = useRouter();
  const [view, setView] = useState<StateView>({ kind: "loading" });

  useHintOnce("PORTFOLIO_MODEL_FIRST_VISIT", canEditModel);

  // Step 1 — capability gate. Run BEFORE any fetch so unprivileged users
  // never fire the adoption-state request.
  useEffect(() => {
    if (authLoading) return;
    if (!user) return; // AuthProvider will redirect to /login
    if (!canEditModel) {
      router.replace("/dashboard");
    }
  }, [authLoading, user, canEditModel, router]);

  // Step 2 — fetch adoption state for padmins only.
  const fetchAdoptionState = useCallback(async () => {
    setView({ kind: "loading" });
    try {
      const res = await api<AdoptionStateDTO>(
        "/portfolio-models/adoption-state"
      );
      if (res.adopted && res.model_id) {
        setView({ kind: "adopted", modelId: res.model_id });
      } else {
        setView({ kind: "wizard" });
      }
    } catch (e) {
      const message =
        e instanceof ApiError
          ? `Error ${e.status}: ${
              typeof e.body === "string" ? e.body : "request failed"
            }`
          : "Failed to load adoption state";
      setView({ kind: "error", message });
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !canEditModel) return;
    void fetchAdoptionState();
  }, [authLoading, user, canEditModel, fetchAdoptionState]);

  // Step 3 — fetch the bundle preview when adopted. Kept as a separate
  // effect so re-rendering the preview after onDone doesn't re-fetch
  // the adoption-state row.
  //
  // PLA-0026 / Story 00507 (F1): the legacy /api/portfolio-models/:id
  // call (mmff_library bundle read) is replaced by a vector_artefacts
  // master_record_portfolio read keyed on workspace_id. The library is
  // never a runtime display source after adoption — model_name and
  // model_description were copied into master_record_portfolio at
  // adoption time. layers/workflows/transitions/artifacts/terminology
  // are re-derived from artefact_types (F3 swap) and are not part of
  // BundleView's master-record-driven render.
  useEffect(() => {
    if (view.kind !== "adopted") return;
    let cancelled = false;
    (async () => {
      try {
        // Resolve the caller's live workspace. The frontend has no
        // shared current-workspace context yet (S3 deferred — see PLA-
        // 0026 follow-ups); per the per-tenant cutover, padmins have
        // exactly one live workspace today, so first-row is correct.
        const workspaces = await workspacesApi.list();
        if (cancelled) return;
        if (workspaces.length === 0) {
          setView({ kind: "missing-bundle" });
          return;
        }
        const workspaceId = workspaces[0].id;

        const mr = await apiSite<MasterRecordDTO>(
          `/portfolio/master_record?workspace_id=${encodeURIComponent(workspaceId)}`,
        );
        if (cancelled) return;

        // BundleView only renders model.name + model.description; the
        // remaining BundleDTO fields are placeholders for type-shape
        // compatibility (LayersPreviewTable reads from a separate
        // /api/subscription/layers fetch — F3 swaps that next).
        const bundle: BundleDTO = {
          model: {
            id: mr.model_id ?? "",
            name: mr.model_name,
            description: mr.model_description,
          },
          layers: [],
          workflows: [],
          transitions: [],
          artifacts: [],
          terminology: [],
        };
        setView({ kind: "preview", bundle, workspaceId });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setView({ kind: "missing-bundle" });
          return;
        }
        const message =
          e instanceof ApiError
            ? `Error ${e.status}: ${
                typeof e.body === "string" ? e.body : "request failed"
              }`
            : "Failed to load portfolio model";
        setView({ kind: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  // Wizard → overlay handoff (Step 4).
  const handleAdoptStarted = useCallback(
    (stateId: string, modelId: string) => {
      setView({ kind: "overlay", modelId, stateId });
    },
    []
  );

  // Overlay finished — refresh adoption state so the preview branch
  // takes over (Step 5).
  const handleOverlayDone = useCallback(
    (_evt: AdoptionDoneEvent) => {
      void fetchAdoptionState();
    },
    [fetchAdoptionState]
  );

  // Overlay exhausted retries — fall back to wizard (Step 6). The
  // overlay (00018) renders its own user-facing error UI; this router
  // simply unmounts it and lets the user pick again.
  const handleOverlayFail = useCallback((_evt: AdoptionFailEvent) => {
    setView({ kind: "wizard" });
  }, []);

  // Render guard for the capability gate. The redirect runs in an
  // effect, so suppress all output until permission is confirmed.
  if (authLoading || !user || !canEditModel) return null;

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Review and configure the portfolio layer model." />
      <Panel
        name="panel_portfolio_model_header"
        className="page-panel-heading"
        title="Portfolio Model"
        description="View and manage the portfolio layer model that structures items in this workspace."
      />
    <StrictRoute>
      <PortfolioRouterBody
        view={view}
        subscriptionId={user.subscription_id}
        onAdoptStarted={handleAdoptStarted}
        onOverlayDone={handleOverlayDone}
        onOverlayFail={handleOverlayFail}
      />
    </StrictRoute>
    </PageContent>
  );
}

interface RouterBodyProps {
  view: StateView;
  subscriptionId: string;
  onAdoptStarted: (stateId: string, modelId: string) => void;
  onOverlayDone: (evt: AdoptionDoneEvent) => void;
  onOverlayFail: (evt: AdoptionFailEvent) => void;
}

function PortfolioRouterBody({
  view,
  subscriptionId,
  onAdoptStarted,
  onOverlayDone,
  onOverlayFail,
}: RouterBodyProps) {
  if (view.kind === "loading") {
    return (
      <div className="placeholder">
        <h3 className="placeholder__title">Loading…</h3>
      </div>
    );
  }
  if (view.kind === "error") {
    return <div className="form__error">{view.message}</div>;
  }
  if (view.kind === "wizard") {
    return <WizardModelCardList onAdoptStarted={onAdoptStarted} />;
  }
  if (view.kind === "overlay") {
    return (
      <AdoptionOverlay
        modelId={view.modelId}
        subscriptionId={subscriptionId}
        onDone={onOverlayDone}
        onFail={onOverlayFail}
      />
    );
  }
  if (view.kind === "adopted") {
    // Transitional state while the bundle preview loads after a
    // successful adoption; same loader as the initial fetch.
    return (
      <div className="placeholder">
        <h3 className="placeholder__title">Loading model…</h3>
      </div>
    );
  }
  if (view.kind === "missing-bundle") {
    return (
      <div className="placeholder">
        <h3 className="placeholder__title">No bundle available</h3>
        <p className="placeholder__body">
          The library has no published bundle for the seeded MMFF family
          yet.
        </p>
      </div>
    );
  }
  return <BundleView bundle={view.bundle} workspaceId={view.workspaceId} />;
}

function BundleView({ bundle, workspaceId }: { bundle: BundleDTO; workspaceId: string }) {
  // PLA-0026 / Story 00509 (F3): layers come from
  // vector_artefacts.artefact_types (scope='strategy', live, ordered by
  // sort_order) via GET /api/workspace/{id}/portfolio/layers — the
  // legacy /api/subscription/layers route (mmff_vector
  // obj_strategy_types_layers mirror) is retired post-cutover. The
  // library bundle is never used as a display source after adoption.
  const [localLayers, setLocalLayers] = useState<LayerDTO[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiSite<LayerDTO[]>(`/workspace/${encodeURIComponent(workspaceId)}/portfolio/layers`).then((rows) => {
      if (!cancelled) setLocalLayers(rows.sort((a, b) => a.sort_order - b.sort_order));
    }).catch(() => {
      // On error fall back to bundle layers so the page isn't blank.
      // Post-F1 the BundleDTO carries an empty layers array, so this
      // surfaces as an empty preview rather than stale library prose.
      if (!cancelled) setLocalLayers([...bundle.layers].sort((a, b) => a.sort_order - b.sort_order));
    });
    return () => { cancelled = true; };
  }, [bundle.layers, workspaceId]);

  const m = bundle.model;

  return (
    <>
      <Panel name="portfolio_model_active" title={m.name}>
        {m.description && (
          <div className="model-preview__description">
            {m.description.split("\n\n").map((para, i) => {
              const h = para.match(/^\*\*(.+)\*\*$/);
              return h
                ? <p key={i} className="model-preview__description-heading"><strong>{h[1]}</strong></p>
                : <p key={i} className="model-preview__description-para">{para}</p>;
            })}
          </div>
        )}
      </Panel>

      <Panel name="portfolio_model_hierarchy" title="Portfolio Hierarchy">
        {localLayers === null
          ? <div className="placeholder"><h3 className="placeholder__title">Loading…</h3></div>
          : <LayersPreviewTable
              layers={localLayers}
              fixedItems={STRATEGY_FIXED_ITEMS}
              topAnchorTag="PRW"
              panelNum="01"
              panelTitle="Layers"
              panelSubtitle="Strategy zone above, execution zone below. Click a cell to edit."
              onCommitLayer={(id, field, next) => {
                const trimmed = next.trim();
                if (field === "tag" && (trimmed.length < 2 || trimmed.length > 4)) return false;
                if (field === "name" && trimmed.length === 0) return false;
                setLocalLayers((prev) =>
                  prev === null
                    ? prev
                    : prev.map((l) =>
                        l.id === id
                          ? { ...l, [field]: field === "description_md" ? (trimmed || null) : trimmed }
                          : l
                      )
                );
                return true;
              }}
            />
        }
      </Panel>

      {bundle.artifacts.length > 0 && (
        <Panel name="portfolio_model_artifacts" title="Artifacts">
          <Table<ArtifactDTO>
            pageId="portfolio-model"
            slot="artifacts"
            ariaLabel="Artifacts"
            rows={bundle.artifacts}
            rowKey={(a) => a.id}
            columns={[
              { key: "artifact_key", header: "Key", kind: "mono" },
              {
                key: "enabled",
                header: "Enabled",
                width: 110,
                kind: "pill",
                pillVariant: (a) => (a.enabled ? "success" : "neutral"),
                pillLabel: (a) => (a.enabled ? "on" : "off"),
              },
            ]}
          />
        </Panel>
      )}

      {bundle.terminology.length > 0 && (
        <Panel name="portfolio_model_terminology" title="Terminology">
          <Table<TerminologyDTO>
            pageId="portfolio-model"
            slot="terminology"
            ariaLabel="Terminology"
            rows={bundle.terminology}
            rowKey={(t) => t.id}
            columns={[
              { key: "key", header: "Key", kind: "mono" },
              { key: "value", header: "Value" },
            ]}
          />
        </Panel>
      )}
    </>
  );
}

// sort_order encodes the fixed hierarchy position: Story=2, Task=1, Defect=0 (no number).
// Sortable layers display as sort_order + max(fixed sort_orders) = sort_order + 2.
const STRATEGY_FIXED_ITEMS: LayerDTO[] = [
  { id: "fixed-str", tag: "STR", name: "User Story", sort_order: 2, description_md: "A user-facing capability described from the end-user perspective" },
  { id: "fixed-tsk", tag: "TSK", name: "Task", sort_order: 1, description_md: "A unit of technical work required to deliver a story" },
  { id: "fixed-def", tag: "DEF", name: "Defect", sort_order: 0, description_md: "A deviation from expected behaviour requiring a fix" },
];

