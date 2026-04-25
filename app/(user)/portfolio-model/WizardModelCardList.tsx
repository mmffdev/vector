"use client";

// WizardModelCardList — Card 00019 (Phase 5 padmin adoption wizard).
//
// Renders a horizontal row of MMFF-published portfolio model cards from
// GET /api/portfolio-models. Single-select; the Confirm button POSTs to
// /api/portfolio-models/{id}/adopt and signals the parent (00015 smart
// router) via `onAdoptStarted` so the parent can mount the adoption
// overlay (owned by 00017).
//
// Integration boundary
//   - Does NOT modify page.tsx; the smart router mounts this component.
//   - Does NOT mount or render the adoption overlay; only signals.
//   - Reuses adoptionConstants.ts for endpoint paths (additive exports).
//
// Props contract (consumed by 00015):
//   onAdoptStarted(stateId: string, modelId: string): void
//     Fired exactly once after a successful POST to the adopt endpoint.
//     stateId comes from `state_id` in AdoptionResult; modelId echoes
//     the selected card id (also returned as `model_id`).
//   onCancel?: () => void
//     Optional — invoked when the user clicks the secondary Cancel
//     button. The router can use this to dismiss the wizard.

import { useEffect, useState } from "react";
import { api, ApiError } from "@/app/lib/api";
import {
  PORTFOLIO_MODELS_LIST_PATH,
  adoptModelPath,
} from "./adoptionConstants";

// Wire shape of one entry returned by GET /api/portfolio-models. Mirrors
// modelListItemDTO in backend/internal/portfoliomodels/list.go.
export interface PortfolioModelListItem {
  id: string;
  name: string;
  description: string | null;
  layer_summary: string;
  layer_count: number;
  version: number;
  model_family_id: string;
}

interface ModelListResponse {
  models: PortfolioModelListItem[];
}

// AdoptionResult mirrors backend/internal/portfoliomodels/adopt.go.
interface AdoptionResult {
  state_id: string;
  model_id: string;
  status: string;
  adopted_at: string;
}

type FetchState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; models: PortfolioModelListItem[] };

export interface WizardModelCardListProps {
  // Fired once the adopt POST returns 2xx with a state row id. The
  // smart router (00015) is expected to mount the overlay (00017) at
  // this point and stop rendering the wizard.
  onAdoptStarted: (stateId: string, modelId: string) => void;
  // Optional: lets the parent dismiss the wizard from a Cancel click.
  onCancel?: () => void;
}

export default function WizardModelCardList({
  onAdoptStarted,
  onCancel,
}: WizardModelCardListProps) {
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<ModelListResponse>(PORTFOLIO_MODELS_LIST_PATH);
        if (cancelled) return;
        const models = res.models ?? [];
        if (models.length === 0) {
          setFetchState({ kind: "empty" });
        } else {
          setFetchState({ kind: "ready", models });
        }
      } catch (e) {
        if (cancelled) return;
        const message =
          e instanceof ApiError
            ? `Error ${e.status}: ${
                typeof e.body === "string" ? e.body : "request failed"
              }`
            : "Failed to load portfolio models";
        setFetchState({ kind: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConfirm() {
    if (!selectedId || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api<AdoptionResult>(adoptModelPath(selectedId), {
        method: "POST",
      });
      onAdoptStarted(res.state_id, res.model_id);
    } catch (e) {
      const message =
        e instanceof ApiError
          ? `Error ${e.status}: ${
              typeof e.body === "string"
                ? e.body
                : (e.body as { code?: string })?.code ?? "request failed"
            }`
          : "Failed to start adoption";
      setSubmitError(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="wizard-model-cards">
      <header className="wizard-model-cards__header">
        <h2 className="wizard-model-cards__title">Choose a portfolio model</h2>
        <p className="wizard-model-cards__subtitle">
          Pick a published model to adopt for your subscription. You can
          customise it after adoption.
        </p>
      </header>

      {fetchState.kind === "loading" && (
        <div className="placeholder">
          <h3 className="placeholder__title">Loading models…</h3>
        </div>
      )}

      {fetchState.kind === "empty" && (
        <div className="placeholder">
          <h3 className="placeholder__title">No models available</h3>
          <p className="placeholder__body">
            The library has no MMFF-published portfolio models yet.
          </p>
        </div>
      )}

      {fetchState.kind === "error" && (
        <div className="form__error">{fetchState.message}</div>
      )}

      {fetchState.kind === "ready" && (
        <ul
          className="wizard-model-cards__list"
          role="radiogroup"
          aria-label="Available portfolio models"
        >
          {fetchState.models.map((m) => {
            const isSelected = m.id === selectedId;
            return (
              <li key={m.id} className="wizard-model-cards__item">
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={
                    "wizard-model-cards__card" +
                    (isSelected ? " wizard-model-cards__card--selected" : "")
                  }
                  onClick={() => setSelectedId(m.id)}
                  disabled={submitting}
                >
                  <div className="wizard-model-cards__card-header">
                    <h3 className="wizard-model-cards__card-name">{m.name}</h3>
                    <span className="tag tag--good">v{m.version}</span>
                  </div>
                  {m.description && (
                    <p className="wizard-model-cards__card-description">
                      {m.description}
                    </p>
                  )}
                  <dl className="wizard-model-cards__card-meta">
                    <div className="wizard-model-cards__card-meta-row">
                      <dt>Layers</dt>
                      <dd>{m.layer_count}</dd>
                    </div>
                    {m.layer_summary && (
                      <div className="wizard-model-cards__card-meta-row">
                        <dt>Hierarchy</dt>
                        <dd className="wizard-model-cards__card-summary">
                          {m.layer_summary}
                        </dd>
                      </div>
                    )}
                  </dl>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {submitError && <div className="form__error">{submitError}</div>}

      <footer className="wizard-model-cards__actions">
        {onCancel && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary wizard-model-cards__confirm"
          onClick={handleConfirm}
          disabled={!selectedId || submitting || fetchState.kind !== "ready"}
        >
          {submitting ? "Starting adoption…" : "Confirm"}
        </button>
      </footer>
    </div>
  );
}
