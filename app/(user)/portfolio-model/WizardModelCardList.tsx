"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiSite, ApiError } from "@/app/lib/api";
import Panel from "@/app/components/Panel";
import {
  PORTFOLIO_MODELS_LIST_PATH,
  adoptModelPath,
} from "./adoptionConstants";

export interface TemplateLayer {
  tag: string;
  name: string;
}

export interface PortfolioModelListItem {
  id: string;
  name: string;
  description: string | null;
  layers: TemplateLayer[];
}

interface ModelListResponse {
  models: PortfolioModelListItem[];
}

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
  onAdoptStarted: (stateId: string, modelId: string) => void;
  onCancel?: () => void;
}

function ModelTip() {
  return (
    <div className="tip-box">
      <div className="tip-box__icon-col">
        <span className="tip-box__icon" aria-hidden="true">i</span>
      </div>
      <div className="tip-box__text-col">
        <p className="tip-box__label">Tip</p>
        <p className="tip-box__body">
          Your selection is not a permanent commitment. If your requirements change — or a different model better reflects how your organisation works — you can switch portfolio models at any time after adoption, and your existing work will carry forward into the new structure.
        </p>
      </div>
    </div>
  );
}

function adoptErrMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "Failed to start adoption";
  const code =
    e.body && typeof e.body === "object"
      ? (e.body as { code?: string }).code
      : undefined;
  switch (code) {
    case "ADOPT_ALREADY_ADOPTED":
      return "This subscription already has an adopted portfolio model.";
    case "ADOPT_IN_FLIGHT":
      return "An adoption is already in progress. Please wait and try again.";
    case "ADOPT_BUNDLE_NOT_FOUND":
      return "The selected portfolio model is no longer available.";
    case "ADOPT_STEP_FAIL_LAYERS":
    case "ADOPT_INTERNAL":
      return "Adoption failed due to an internal error. Please try again or contact support.";
    default:
      return code
        ? `Adoption failed: ${code}`
        : `Error ${e.status}: request failed`;
  }
}

export default function WizardModelCardList({
  onAdoptStarted,
  onCancel,
}: WizardModelCardListProps) {
  const router = useRouter();
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiSite<ModelListResponse>(PORTFOLIO_MODELS_LIST_PATH);
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

  async function handleConfirm(modelId: string) {
    if (submittingId) return;
    setSubmittingId(modelId);
    setSubmitError(null);
    try {
      const res = await apiSite<AdoptionResult>(adoptModelPath(modelId), {
        method: "POST",
      });
      onAdoptStarted(res.state_id, res.model_id);
    } catch (e) {
      setSubmitError(adoptErrMessage(e));
      setSubmittingId(null);
    }
  }

  function toggle(id: string) {
    setOpenId((prev) => (prev === id ? null : id));
  }

  // PLA-0006/00336 — registers the strategy-wizard page under
  // samantha._viewport.app._kind.panel.portfolio_strategy_wizard so
  // Samantha can target the model-chooser. `panel--bare` strips Panel
  // chrome; the existing .wizard-model-cards header stays as the
  // visual surface unchanged.
  return (
    <Panel name="portfolio_strategy_wizard" className="panel--bare">
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
        <div className="accordion" role="list">
          {fetchState.models.map((m) => {
            const isOpen = openId === m.id;
            const layers = m.layers ?? [];
            return (
              <div
                key={m.id}
                className="accordion__item"
                role="listitem"
              >
                <button
                  type="button"
                  className="accordion__toggle"
                  onClick={() => toggle(m.id)}
                  aria-expanded={isOpen}
                >
                  <span
                    className={
                      "accordion__chevron" +
                      (isOpen ? "" : " accordion__chevron--closed")
                    }
                  />
                  <span className="accordion__toggle-name">
                    {m.name}
                  </span>
                </button>

                {isOpen && (
                  <div className="accordion__body">
                    <table className="model-chooser-grid">
                      <tbody>
                        <tr>
                          <td className="model-chooser-grid__cell model-chooser-grid__cell--desc">
                            {m.description ? (
                              <>
                                {m.description.split("\n\n").map((para, i) => {
                                  const h = para.match(/^\*\*(.+)\*\*$/);
                                  return h
                                    ? <p key={i} className="model-chooser-grid__heading"><strong>{h[1]}</strong></p>
                                    : <p key={i} className="model-chooser-grid__para">{para}</p>;
                                })}
                                <ModelTip />
                              </>
                            ) : (
                              <svg
                                className="wizard-model-cards__card-description-placeholder"
                                viewBox="0 0 100 50"
                                preserveAspectRatio="none"
                                aria-hidden="true"
                              >
                                <rect x="0" y="0" width="100" height="50" fill="none" />
                                <line x1="0" y1="0" x2="100" y2="50" />
                                <line x1="100" y1="0" x2="0" y2="50" />
                              </svg>
                            )}
                          </td>
                          <td className="model-chooser-grid__cell model-chooser-grid__cell--count">
                            {layers.length} Layer{layers.length === 1 ? "" : "s"}
                          </td>
                          <td className="model-chooser-grid__cell">
                            {layers.length > 0 && (
                              <ol
                                className="layer-hierarchy"
                                aria-label={`${m.name} layer hierarchy`}
                              >
                                {layers.flatMap((layer, i) => {
                                  const nodes: React.ReactNode[] = [
                                    <li
                                      key={`${m.id}-layer-${i}`}
                                      className="layer-hierarchy__box"
                                    >
                                      <span className="layer-hierarchy__tag u-mono">{layer.tag}</span>
                                      <span className="layer-hierarchy__name">{layer.name}</span>
                                    </li>,
                                  ];
                                  if (i < layers.length - 1) {
                                    nodes.push(
                                      <li
                                        key={`${m.id}-arrow-${i}`}
                                        className="layer-hierarchy__arrow"
                                        aria-hidden="true"
                                      />
                                    );
                                  }
                                  return nodes;
                                })}
                              </ol>
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td
                            colSpan={3}
                            className="model-chooser-grid__footer-cell"
                          >
                            <div className="model-chooser-grid__footer-inner">
                              <button
                                type="button"
                                className="btn btn--primary model-chooser-accept"
                                onClick={() => handleConfirm(m.id)}
                                disabled={submittingId !== null}
                              >
                                {submittingId === m.id
                                  ? "Starting adoption…"
                                  : "Accept"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {/* Build your own */}
          <div
            className="accordion__item accordion__item--alt"
            role="listitem"
          >
            <button
              type="button"
              className="accordion__toggle"
              onClick={() => toggle("custom")}
              aria-expanded={openId === "custom"}
            >
              <span
                className={
                  "accordion__chevron" +
                  (openId === "custom"
                    ? ""
                    : " accordion__chevron--closed")
                }
              />
              <span className="accordion__toggle-name">
                Build your own
              </span>
              <span className="wizard-model-cards__card-version">+</span>
            </button>

            {openId === "custom" && (
              <div className="accordion__body">
                <table className="model-chooser-grid">
                  <tbody>
                    <tr>
                      <td className="model-chooser-grid__cell model-chooser-grid__cell--desc">
                        <span className="wizard-model-cards__card-custom-hint">
                          Start with an empty hierarchy and define your own layers.
                        </span>
                        <ModelTip />
                      </td>
                      <td className="model-chooser-grid__cell model-chooser-grid__cell--count">
                        —
                      </td>
                      <td className="model-chooser-grid__cell" />
                    </tr>
                    <tr>
                      <td
                        colSpan={3}
                        className="model-chooser-grid__footer-cell"
                      >
                        <div className="model-chooser-grid__footer-inner">
                          <button
                            type="button"
                            className="btn btn--primary model-chooser-accept"
                            onClick={() =>
                              router.push("/portfolio-model/custom")
                            }
                            disabled={submittingId !== null}
                          >
                            Accept
                          </button>
                          <span className="wizard-model-cards__card-version">
                            +
                          </span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {submitError && <div className="form__error">{submitError}</div>}

      {onCancel && (
        <footer className="wizard-model-cards__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onCancel}
            disabled={submittingId !== null}
          >
            Cancel
          </button>
        </footer>
      )}
    </div>
    </Panel>
  );
}
