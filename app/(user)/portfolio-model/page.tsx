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
import PageShell from "@/app/components/PageShell";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { api, ApiError } from "@/app/lib/api";
import WizardModelCardList from "./WizardModelCardList";
import AdoptionOverlay, {
  type AdoptionDoneEvent,
  type AdoptionFailEvent,
} from "./AdoptionOverlay";
import { type LayerDTO } from "./LayersTable";
import LayersPreviewTable from "./LayersPreviewTable";

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
  | { kind: "preview"; bundle: BundleDTO };

export default function PortfolioModelPage() {
  const { user, loading: authLoading } = useAuth();
  const canEditModel = useHasPermission("portfolio.model.edit");
  const router = useRouter();
  const [view, setView] = useState<StateView>({ kind: "loading" });

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
        "/api/portfolio-models/adoption-state"
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
  useEffect(() => {
    if (view.kind !== "adopted") return;
    const adoptedModelId = view.modelId;
    let cancelled = false;
    (async () => {
      try {
        const bundle = await api<BundleDTO>(
          `/api/portfolio-models/${adoptedModelId}`
        );
        if (cancelled) return;
        setView({ kind: "preview", bundle });
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
    <StrictRoute>
      <PageShell
        title="Portfolio Model"
        subtitle="Adopt a model or preview your subscription's adopted bundle"
      >
        <PortfolioRouterBody
          view={view}
          subscriptionId={user.subscription_id}
          onAdoptStarted={handleAdoptStarted}
          onOverlayDone={handleOverlayDone}
          onOverlayFail={handleOverlayFail}
        />
      </PageShell>
    </StrictRoute>
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
  return <BundleView bundle={view.bundle} />;
}

function BundleView({ bundle }: { bundle: BundleDTO }) {
  // Layers come exclusively from subscription_layers — the tenant's own
  // copy written at adoption time. The library bundle is never used as a
  // display source after adoption so library-side edits never bleed through.
  const [localLayers, setLocalLayers] = useState<LayerDTO[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<LayerDTO[]>("/api/subscription/layers").then((rows) => {
      if (!cancelled) setLocalLayers(rows.sort((a, b) => a.sort_order - b.sort_order));
    }).catch(() => {
      // On error fall back to bundle layers so the page isn't blank,
      // but edits will fail since these IDs are library UUIDs not subscription UUIDs.
      if (!cancelled) setLocalLayers([...bundle.layers].sort((a, b) => a.sort_order - b.sort_order));
    });
    return () => { cancelled = true; };
  }, [bundle.layers]);

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
          <div className="table-wrap">
            <table className="table">
              <thead className="table__head">
                <tr className="table__row">
                  <th className="table__cell">Key</th>
                  <th className="table__cell">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {bundle.artifacts.map((a) => (
                  <tr key={a.id} className="table__row">
                    <td className="table__cell u-mono">{a.artifact_key}</td>
                    <td className="table__cell">
                      {a.enabled ? (
                        <span className="pill pill--success">on</span>
                      ) : (
                        <span className="pill pill--neutral">off</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {bundle.terminology.length > 0 && (
        <Panel name="portfolio_model_terminology" title="Terminology">
          <div className="table-wrap">
            <table className="table">
              <thead className="table__head">
                <tr className="table__row">
                  <th className="table__cell">Key</th>
                  <th className="table__cell">Value</th>
                </tr>
              </thead>
              <tbody>
                {bundle.terminology.map((t) => (
                  <tr key={t.id} className="table__row">
                    <td className="table__cell u-mono">{t.key}</td>
                    <td className="table__cell">{t.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

