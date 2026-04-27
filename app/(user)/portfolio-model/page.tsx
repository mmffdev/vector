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
import { useAuth } from "@/app/contexts/AuthContext";
import { api, ApiError } from "@/app/lib/api";
import WizardModelCardList from "./WizardModelCardList";
import AdoptionOverlay, {
  type AdoptionDoneEvent,
  type AdoptionFailEvent,
} from "./AdoptionOverlay";
import LayersTable from "./LayersTable";

// Phase 5 will list bundles via a /api/portfolio-models endpoint; until
// then the seeded MMFF Standard family id is the only thing to render.
// See TD-LIB-006 in docs/c_tech_debt.md.
const SEEDED_FAMILY_ID = "00000000-0000-0000-0000-00000000a000";

interface ModelDTO {
  id: string;
  model_family_id: string;
  key: string;
  name: string;
  description: string | null;
  instructions_md: string | null;
  scope: string;
  visibility: string;
  version: number;
  library_version: string | null;
  archived_at: string | null;
}

interface LayerDTO {
  id: string;
  name: string;
  tag: string;
  sort_order: number;
  description_md: string | null;
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
  const router = useRouter();
  const [view, setView] = useState<StateView>({ kind: "loading" });

  // Step 1 — role gate. Run BEFORE any fetch so non-padmin roles never
  // fire the adoption-state request.
  useEffect(() => {
    if (authLoading) return;
    if (!user) return; // AuthProvider will redirect to /login
    if (user.role !== "padmin") {
      router.replace("/dashboard");
    }
  }, [authLoading, user, router]);

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
    if (!user || user.role !== "padmin") return;
    void fetchAdoptionState();
  }, [authLoading, user, fetchAdoptionState]);

  // Step 3 — fetch the bundle preview when adopted. Kept as a separate
  // effect so re-rendering the preview after onDone doesn't re-fetch
  // the adoption-state row.
  useEffect(() => {
    if (view.kind !== "adopted") return;
    let cancelled = false;
    (async () => {
      try {
        const bundle = await api<BundleDTO>(
          `/api/portfolio-models/${SEEDED_FAMILY_ID}/latest`
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

  // Render guard for the role gate. The redirect runs in an effect, so
  // suppress all output until we know we're on a padmin.
  if (authLoading || !user || user.role !== "padmin") return null;

  return (
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
  // localLayers seeds from bundle for immediate render, then is replaced
  // by a GET /api/subscription/layers fetch so IDs are subscription UUIDs
  // (required by PATCH /api/subscription/layers/batch).
  const [localLayers, setLocalLayers] = useState<LayerDTO[]>(() =>
    [...bundle.layers].sort((a, b) => a.sort_order - b.sort_order)
  );

  useEffect(() => {
    let cancelled = false;
    api<LayerDTO[]>("/api/subscription/layers").then((rows) => {
      if (!cancelled) setLocalLayers(rows.sort((a, b) => a.sort_order - b.sort_order));
    }).catch(() => {
      // Keep bundle seed on error — table will show but PATCH will fail
    });
    return () => { cancelled = true; };
  }, []);

  const m = bundle.model;

  return (
    <div className="model-preview">
      <header className="model-preview__header">
        <div className="model-preview__title-row">
          <h2 className="model-preview__title">{m.name}</h2>
          <span className="pill pill--success">v{m.version}</span>
          <span className="pill pill--neutral">{m.scope}</span>
          <span className="pill pill--neutral">{m.visibility}</span>
        </div>
        {m.description && (
          <p className="model-preview__description">{m.description}</p>
        )}
        <dl className="model-preview__meta">
          <div className="model-preview__meta-row">
            <dt>Library version</dt>
            <dd className="u-mono">{m.library_version ?? "—"}</dd>
          </div>
        </dl>
      </header>

      <Section title="Strategy">
        <LayersTable
          initialLayers={localLayers}
          onLayersUpdated={setLocalLayers}
        />
      </Section>

      <Section title="Strategy Layer">
        <StrategyLayerTable />
      </Section>

      <Section title="Artifacts">
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
      </Section>

      <Section title="Terminology">
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
      </Section>
    </div>
  );
}

const STRATEGY_ARTEFACTS = [
  { tag: "STR", name: "User Story", description: "A user-facing capability described from the end-user perspective" },
  { tag: "TSK", name: "Task", description: "A unit of technical work required to deliver a story" },
  { tag: "DEF", name: "Defect", description: "A deviation from expected behaviour requiring a fix" },
];

function StrategyLayerTable() {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead className="table__head">
          <tr className="table__row">
            <th className="table__cell">Tag</th>
            <th className="table__cell">Name</th>
            <th className="table__cell">Description</th>
          </tr>
        </thead>
        <tbody>
          {STRATEGY_ARTEFACTS.map((a) => (
            <tr key={a.tag} className="table__row">
              <td className="table__cell u-mono">{a.tag}</td>
              <td className="table__cell">{a.name}</td>
              <td className="table__cell table__cell--muted">{a.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="model-preview__section">
      <h3 className="model-preview__section-title">{title}</h3>
      {children}
    </section>
  );
}
