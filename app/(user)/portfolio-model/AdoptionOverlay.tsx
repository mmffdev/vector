"use client";

/**
 * AdoptionOverlay — full-screen adoption progress UI.
 *
 * Mounted by 00015's smart router when an adoption is in flight. Replaces the
 * page content entirely (position: fixed, inset: 0).
 *
 * Phase 1: centered loader. Held during the 5-second confidence pause
 *   (ADOPTION_CONFIDENCE_PAUSE_MS) so the user sees the connection succeed.
 * Phase 2: horizontal block-diagram of seven progress boxes (one per step in
 *   ADOPTION_STEPS). Boxes flip from idle -> in-progress -> complete as
 *   `event: step` SSE messages arrive. The terminal `event: done` flips every
 *   box to complete.
 *
 * SSE lifecycle: the component owns its EventSource (open on mount, close on
 * unmount). It listens to events at GET /_site/portfolio-models/{modelId}/adopt/stream.
 *
 * Error / retry (card 00018):
 *   - On `event: fail` the failing step flips to `--failed`, an error banner
 *     renders the `error_code` + `message` from the SSE payload, and an
 *     auto-retry kicks in after a backoff (see ADOPTION_RETRY_BACKOFF_MS).
 *   - A retry re-POSTs /_site/portfolio-models/{modelId}/adopt and re-opens the
 *     SSE stream — the orchestrator's saga is idempotent on
 *     (subscription_id, source_library_id) and resumes from the failed step.
 *   - After ADOPTION_MAX_RETRIES (5) we stop auto-retrying, surface the
 *     failure via reportError, and show a manual "Try again" button which
 *     resets the retry counter and re-triggers the flow.
 *   - If the user dismisses after exhaustion they hit the Cancel button which
 *     fires onCancel (optional) and onFail with the last failure payload so
 *     00015's parent can route accordingly.
 *
 * Integration boundary:
 *   - This file does NOT modify page.tsx (00015 owns the smart router).
 *
 * Props:
 *   - modelId:        portfolio model UUID adoption is running against
 *   - subscriptionId: caller-controlled identifier (passed through for 00015 /
 *                     downstream telemetry; not used to construct the URL).
 *   - onDone?:        optional callback when SSE emits `event: done`
 *   - onFail?:        optional callback when SSE emits `event: fail` (00018)
 *   - onCancel?:      optional callback when the user dismisses after retries
 *                     are exhausted (00018; additive, optional).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ADOPTION_CONFIDENCE_PAUSE_MS,
  ADOPTION_MAX_RETRIES,
  ADOPTION_RETRY_BACKOFF_MS,
  ADOPTION_STEPS,
  ADOPTION_STEP_LABELS,
  adoptModelPath,
  adoptStreamPath,
  type AdoptionStepName,
} from "./adoptionConstants";
import { apiSite as api, getApiToken } from "@/app/lib/api";
import { reportError } from "@/app/lib/reportError";

type StepStatus = "idle" | "in-progress" | "complete" | "failed";

export interface AdoptionDoneEvent {
  state_id: string;
  status: string;
  adopted_at: string;
}

export interface AdoptionFailEvent {
  step: string;
  error_code: string;
  message: string;
}

// Terminal phase of the SSE-driven state machine. Once `done` or `fail` is
// reached, subsequent `step` frames are ignored — the saga is over.
export type AdoptionTerminal = "running" | "done" | "fail";

/**
 * Pure state machine for adoption SSE frames.
 *
 * Mirrors the side-effect-free portion of the runtime SSE handler so it can
 * be unit-tested without mounting the component or stubbing the network.
 * Given the current state and an inbound frame, returns the next state.
 *
 * Contract:
 *   - "step" frames advance per-step status; an in-progress step also
 *     promotes any earlier idle/in-progress steps to complete (catch-up
 *     behaviour matches the runtime closure).
 *   - "done" frame flips every non-failed step to complete and sets the
 *     terminal to "done".
 *   - "fail" frame flips the named step to failed and sets the terminal
 *     to "fail".
 *   - Once the terminal is "done" or "fail", further "step" frames are
 *     ignored. This guarantees no further visual progress after a
 *     terminal event — the contract assertion the F2 tests pin down.
 *
 * Malformed JSON in `data` returns the input state unchanged.
 */
export interface AdoptionMachineState {
  statuses: Record<AdoptionStepName, StepStatus>;
  terminal: AdoptionTerminal;
  lastFail: AdoptionFailEvent | null;
  doneEvent: AdoptionDoneEvent | null;
}

export function initialAdoptionState(): AdoptionMachineState {
  return {
    statuses: initialStatuses(),
    terminal: "running",
    lastFail: null,
    doneEvent: null,
  };
}

export function dispatchFrame(
  state: AdoptionMachineState,
  eventName: string,
  data: string,
): AdoptionMachineState {
  if (eventName === "step") {
    if (state.terminal !== "running") return state;
    let payload: StepEventPayload;
    try {
      payload = JSON.parse(data) as StepEventPayload;
    } catch {
      return state;
    }
    const name = payload.name as AdoptionStepName;
    if (!ADOPTION_STEPS.includes(name)) return state;
    const next: Record<AdoptionStepName, StepStatus> = { ...state.statuses };
    if (payload.status === "fail") {
      next[name] = "failed";
    } else if (payload.status === "complete" || payload.status === "done") {
      next[name] = "complete";
    } else {
      next[name] = "in-progress";
      const idx = ADOPTION_STEPS.indexOf(name);
      for (let i = 0; i < idx; i++) {
        const earlier = ADOPTION_STEPS[i];
        if (next[earlier] === "idle" || next[earlier] === "in-progress") {
          next[earlier] = "complete";
        }
      }
    }
    return { ...state, statuses: next };
  }
  if (eventName === "done") {
    let donePayload: AdoptionDoneEvent | null = null;
    try {
      donePayload = JSON.parse(data) as AdoptionDoneEvent;
    } catch {
      // still complete even if payload is malformed
    }
    const next: Record<AdoptionStepName, StepStatus> = { ...state.statuses };
    for (const s of ADOPTION_STEPS) {
      if (next[s] !== "failed") next[s] = "complete";
    }
    return {
      statuses: next,
      terminal: "done",
      lastFail: null,
      doneEvent: donePayload,
    };
  }
  if (eventName === "fail") {
    let failPayload: AdoptionFailEvent | null = null;
    try {
      failPayload = JSON.parse(data) as AdoptionFailEvent;
    } catch {
      return state;
    }
    if (!failPayload) return state;
    const next: Record<AdoptionStepName, StepStatus> = { ...state.statuses };
    if (ADOPTION_STEPS.includes(failPayload.step as AdoptionStepName)) {
      next[failPayload.step as AdoptionStepName] = "failed";
    }
    return {
      ...state,
      statuses: next,
      terminal: "fail",
      lastFail: failPayload,
    };
  }
  return state;
}

export interface AdoptionOverlayProps {
  modelId: string;
  subscriptionId: string;
  onDone?: (evt: AdoptionDoneEvent) => void;
  onFail?: (evt: AdoptionFailEvent) => void;
  onCancel?: () => void;
}

type Phase = "loader" | "steps";

interface StepEventPayload {
  index: number;
  name: string;
  status: string;
  error_code?: string;
}

function initialStatuses(): Record<AdoptionStepName, StepStatus> {
  const out = {} as Record<AdoptionStepName, StepStatus>;
  for (const s of ADOPTION_STEPS) out[s] = "idle";
  return out;
}

function backoffFor(attempt: number): number {
  if (ADOPTION_RETRY_BACKOFF_MS.length === 0) return 2000;
  const i = Math.min(attempt, ADOPTION_RETRY_BACKOFF_MS.length - 1);
  return ADOPTION_RETRY_BACKOFF_MS[i];
}

export default function AdoptionOverlay({
  modelId,
  subscriptionId,
  onDone,
  onFail,
  onCancel,
}: AdoptionOverlayProps) {
  const [phase, setPhase] = useState<Phase>("loader");
  const [statuses, setStatuses] =
    useState<Record<AdoptionStepName, StepStatus>>(initialStatuses);
  const [allDone, setAllDone] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [lastFail, setLastFail] = useState<AdoptionFailEvent | null>(null);
  // Bumped on each manual reset to force the SSE effect to re-run.
  const [streamEpoch, setStreamEpoch] = useState(0);

  // AbortController for the fetch-based SSE stream.
  const abortRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  // Keep ref in sync so the SSE handler closure can read the current value
  // without re-binding all listeners on every retry.
  useEffect(() => {
    retryCountRef.current = retryCount;
  }, [retryCount]);

  // Phase 1 -> Phase 2 transition after the confidence pause. Only on first
  // mount — retries should not re-show the loader.
  useEffect(() => {
    const t = setTimeout(() => setPhase("steps"), ADOPTION_CONFIDENCE_PAUSE_MS);
    return () => clearTimeout(t);
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // Schedule a retry: re-POST /adopt then bump streamEpoch so the SSE effect
  // closes the old stream and opens a fresh one. The saga is idempotent so
  // it resumes from the failed step.
  const scheduleRetry = useCallback(
    (attempt: number) => {
      clearRetryTimer();
      const delay = backoffFor(attempt);
      retryTimerRef.current = setTimeout(async () => {
        retryTimerRef.current = null;
        try {
          await api(adoptModelPath(modelId), { method: "POST" });
        } catch {
          // If the re-POST itself errors we still try to reopen the stream;
          // the orchestrator may already be running, in which case the SSE
          // stream will pick up state. If not, the stream will emit fail
          // again and the normal retry loop continues.
        }
        // Flip the failed step back to in-progress visually; subsequent SSE
        // events will move it to complete (or fail again).
        setStatuses((prev) => {
          const next = { ...prev };
          for (const s of ADOPTION_STEPS) {
            if (next[s] === "failed") next[s] = "in-progress";
          }
          return next;
        });
        setStreamEpoch((n) => n + 1);
      }, delay);
    },
    [clearRetryTimer, modelId],
  );

  // Ref to track the current machine state so handleFrame can invoke dispatchFrame
  // without depending on stale closures. This mirrors the statuses/terminal/lastFail
  // React state, synced via useEffect to avoid setState delays.
  const machineStateRef = useRef<AdoptionMachineState>(initialAdoptionState());
  useEffect(() => {
    machineStateRef.current = {
      statuses,
      terminal: allDone ? "done" : lastFail ? "fail" : "running",
      lastFail,
      doneEvent: null,
    };
  }, [statuses, allDone, lastFail]);

  // SSE lifecycle: uses fetch() so Authorization: Bearer is sent correctly.
  // EventSource cannot set custom headers; the backend requires Bearer auth.
  // Re-runs when streamEpoch bumps (after a retry) so a fresh stream opens.
  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const token = getApiToken();
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    // Minimal SSE line parser — handles `event:`, `data:`, and blank-line
    // frame boundaries. Comments (`:`) are ignored.
    let curEvent = "";
    let curData = "";

    // Closure-local runtime handler. Delegates state transitions to the pure
    // `dispatchFrame` function (which unit tests verify), then applies
    // React side-effects (setState, ctrl.abort, retry scheduling, etc).
    function handleFrame(eventName: string, data: string) {
      const currentState = machineStateRef.current;
      const nextState = dispatchFrame(currentState, eventName, data);
      if (nextState === currentState) return;

      setStatuses(nextState.statuses);
      if (nextState.terminal === "done" && currentState.terminal !== "done") {
        setAllDone(true);
        setLastFail(null);
        if (nextState.doneEvent && onDone) onDone(nextState.doneEvent);
        ctrl.abort();
      } else if (nextState.terminal === "fail" && currentState.terminal !== "fail") {
        setLastFail(nextState.lastFail);
        ctrl.abort();
        const attempt = retryCountRef.current;
        if (attempt < ADOPTION_MAX_RETRIES && nextState.lastFail) {
          setRetryCount(attempt + 1);
          scheduleRetry(attempt);
        } else if (nextState.lastFail) {
          setExhausted(true);
          void reportError(nextState.lastFail.error_code, {
            surface: "AdoptionOverlay",
            model_id: modelId,
            subscription_id: subscriptionId,
            step: nextState.lastFail.step,
            message: nextState.lastFail.message,
            retries: attempt,
          });
          if (onFail) onFail(nextState.lastFail);
        }
      }
    }

    void (async () => {
      try {
        const API_BASE =
          (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100") + "/_site";
        const res = await fetch(API_BASE + adoptStreamPath(modelId), {
          headers,
          credentials: "include",
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line === "") {
              // Frame boundary — dispatch if we have an event name.
              if (curEvent) handleFrame(curEvent, curData);
              curEvent = "";
              curData = "";
            } else if (line.startsWith(":")) {
              // Heartbeat comment — ignore.
            } else if (line.startsWith("event: ")) {
              curEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              curData += (curData ? "\n" : "") + line.slice(6);
            }
          }
        }
      } catch {
        // AbortError on cleanup or network failure — no action needed.
      }
    })();

    return () => {
      ctrl.abort();
      abortRef.current = null;
    };
    // subscriptionId is passed through for telemetry; not in dep array.
    // streamEpoch forces re-open after a retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, streamEpoch]);

  // Cleanup any pending retry timer on unmount.
  useEffect(() => {
    return () => {
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  // Manual "Try again" — reset retry counter and start a fresh attempt now.
  const handleTryAgain = useCallback(() => {
    clearRetryTimer();
    setRetryCount(0);
    setExhausted(false);
    setStatuses((prev) => {
      const next = { ...prev };
      for (const s of ADOPTION_STEPS) {
        if (next[s] === "failed") next[s] = "in-progress";
      }
      return next;
    });
    // Re-POST + reopen SSE immediately (no backoff for a manual click).
    void (async () => {
      try {
        await api(adoptModelPath(modelId), { method: "POST" });
      } catch {
        // Same as scheduleRetry — fall through to reopen the stream.
      }
      setStreamEpoch((n) => n + 1);
    })();
  }, [clearRetryTimer, modelId]);

  const handleCancel = useCallback(() => {
    clearRetryTimer();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (onCancel) onCancel();
  }, [clearRetryTimer, onCancel]);

  const showError = lastFail !== null && !allDone;
  const isRetrying = showError && !exhausted;

  return (
    <div
      className="adoption-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Adopting portfolio model"
      data-subscription-id={subscriptionId}
    >
      {phase === "loader" ? (
        <div className="adoption-overlay__phase-loader">
          <div className="adoption-overlay__spinner" aria-hidden="true" />
          <p className="adoption-overlay__loader-text">
            Connecting adoption stream…
          </p>
        </div>
      ) : (
        <div className="adoption-overlay__phase-steps">
          <h2 className="adoption-overlay__title">
            {allDone ? "Adoption complete" : "Adopting portfolio model"}
          </h2>
          <ol className="adoption-overlay__steps">
            {ADOPTION_STEPS.map((name, i) => {
              const status = statuses[name];
              const cls = [
                "adoption-overlay__step",
                `adoption-overlay__step--${status}`,
              ].join(" ");
              return (
                <li key={name} className={cls} data-step={name}>
                  <span className="adoption-overlay__step-index">{i + 1}</span>
                  <span className="adoption-overlay__step-label">
                    {ADOPTION_STEP_LABELS[name]}
                  </span>
                </li>
              );
            })}
          </ol>
          {showError && (
            <div
              className="adoption-overlay__error"
              role="alert"
              data-exhausted={exhausted ? "true" : "false"}
            >
              <div className="adoption-overlay__error-code">
                {lastFail!.error_code}
              </div>
              <div className="adoption-overlay__error-message">
                {lastFail!.message}
              </div>
              {isRetrying && (
                <div className="adoption-overlay__error-retry">
                  Retrying… (attempt {retryCount} of {ADOPTION_MAX_RETRIES})
                </div>
              )}
              {exhausted && (
                <div className="adoption-overlay__error-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm adoption-overlay__error-button adoption-overlay__error-button--primary"
                    onClick={handleTryAgain}
                  >
                    Try again
                  </button>
                  {onCancel && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm adoption-overlay__error-button"
                      onClick={handleCancel}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {allDone && (
            <p className="adoption-overlay__success">
              Your portfolio model is ready.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
