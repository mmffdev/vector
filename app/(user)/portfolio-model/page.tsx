"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import BlockingReleaseGate from "@/app/components/BlockingReleaseGate";
import { useAuth } from "@/app/contexts/AuthContext";
import { api, ApiError } from "@/app/lib/api";

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

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; bundle: BundleDTO };

export default function PortfolioModelPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (user && user.role === "user") router.replace("/dashboard");
  }, [user, router]);

  useEffect(() => {
    if (!user || user.role === "user") return;
    let cancelled = false;
    (async () => {
      try {
        const bundle = await api<BundleDTO>(
          `/api/portfolio-models/${SEEDED_FAMILY_ID}/latest`
        );
        if (!cancelled) setState({ kind: "ready", bundle });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setState({ kind: "missing" });
        } else {
          const msg =
            e instanceof ApiError
              ? `Error ${e.status}: ${typeof e.body === "string" ? e.body : "request failed"}`
              : "Failed to load portfolio model";
          setState({ kind: "error", message: msg });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || user.role === "user") return null;

  return (
    <BlockingReleaseGate>
    <PageShell
      title="Portfolio Model"
      subtitle="Preview the MMFF-authored portfolio model bundle"
    >
      {state.kind === "loading" && (
        <div className="placeholder">
          <h3 className="placeholder__title">Loading…</h3>
        </div>
      )}
      {state.kind === "missing" && (
        <div className="placeholder">
          <h3 className="placeholder__title">No bundle available</h3>
          <p className="placeholder__body">
            The library has no published bundle for the seeded MMFF family yet.
          </p>
        </div>
      )}
      {state.kind === "error" && (
        <div className="form__error">{state.message}</div>
      )}
      {state.kind === "ready" && <BundleView bundle={state.bundle} />}
    </PageShell>
    </BlockingReleaseGate>
  );
}

function BundleView({ bundle }: { bundle: BundleDTO }) {
  const layerOrder = useMemo(
    () => [...bundle.layers].sort((a, b) => a.sort_order - b.sort_order),
    [bundle.layers]
  );
  const workflowsByLayer = useMemo(() => {
    const m = new Map<string, WorkflowDTO[]>();
    for (const w of bundle.workflows) {
      const arr = m.get(w.layer_id) ?? [];
      arr.push(w);
      m.set(w.layer_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [bundle.workflows]);
  const stateById = useMemo(() => {
    const m = new Map<string, WorkflowDTO>();
    for (const w of bundle.workflows) m.set(w.id, w);
    return m;
  }, [bundle.workflows]);
  const transitionsByLayer = useMemo(() => {
    const m = new Map<string, TransitionDTO[]>();
    for (const t of bundle.transitions) {
      const from = stateById.get(t.from_state_id);
      if (!from) continue;
      const arr = m.get(from.layer_id) ?? [];
      arr.push(t);
      m.set(from.layer_id, arr);
    }
    return m;
  }, [bundle.transitions, stateById]);

  const m = bundle.model;

  return (
    <div className="model-preview">
      <header className="model-preview__header">
        <div className="model-preview__title-row">
          <h2 className="model-preview__title">{m.name}</h2>
          <span className="tag tag--good">v{m.version}</span>
          <span className="tag">{m.scope}</span>
          <span className="tag tag--muted">{m.visibility}</span>
        </div>
        {m.description && (
          <p className="model-preview__description">{m.description}</p>
        )}
        <dl className="model-preview__meta">
          <div className="model-preview__meta-row">
            <dt>Family ID</dt>
            <dd className="u-mono">{m.model_family_id}</dd>
          </div>
          <div className="model-preview__meta-row">
            <dt>Key</dt>
            <dd className="u-mono">{m.key}</dd>
          </div>
          {m.library_version && (
            <div className="model-preview__meta-row">
              <dt>Library version</dt>
              <dd className="u-mono">{m.library_version}</dd>
            </div>
          )}
        </dl>
      </header>

      <Section title="Layers">
        <div className="table-wrap">
          <table className="table">
            <thead className="table__head">
              <tr className="table__row">
                <th className="table__cell">Order</th>
                <th className="table__cell">Tag</th>
                <th className="table__cell">Name</th>
                <th className="table__cell">Description</th>
              </tr>
            </thead>
            <tbody>
              {layerOrder.map((l) => (
                <tr key={l.id} className="table__row">
                  <td className="table__cell table__cell--numeric">{l.sort_order}</td>
                  <td className="table__cell u-mono">{l.tag}</td>
                  <td className="table__cell">{l.name}</td>
                  <td className="table__cell table__cell--muted">
                    {l.description_md ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Workflows">
        <div className="model-preview__workflows">
          {layerOrder.map((l) => {
            const states = workflowsByLayer.get(l.id) ?? [];
            const transitions = transitionsByLayer.get(l.id) ?? [];
            return (
              <div key={l.id} className="model-preview__workflow">
                <h4 className="model-preview__workflow-title">
                  <span className="u-mono">{l.tag}</span> {l.name}
                </h4>
                <ul className="model-preview__states">
                  {states.map((s) => (
                    <li key={s.id} className="model-preview__state">
                      <span className="u-mono">{s.state_key}</span>
                      <span className="model-preview__state-label">{s.state_label}</span>
                      {s.is_initial && <span className="tag tag--muted">initial</span>}
                      {s.is_terminal && <span className="tag tag--good">terminal</span>}
                    </li>
                  ))}
                </ul>
                {transitions.length > 0 && (
                  <ul className="model-preview__transitions">
                    {transitions.map((t) => {
                      const from = stateById.get(t.from_state_id);
                      const to = stateById.get(t.to_state_id);
                      return (
                        <li key={t.id} className="model-preview__transition">
                          <span className="u-mono">{from?.state_key ?? "?"}</span>
                          <span aria-hidden="true"> → </span>
                          <span className="u-mono">{to?.state_key ?? "?"}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
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
                      <span className="tag tag--good">on</span>
                    ) : (
                      <span className="tag tag--muted">off</span>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="model-preview__section">
      <h3 className="model-preview__section-title">{title}</h3>
      {children}
    </section>
  );
}
