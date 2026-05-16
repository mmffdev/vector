"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type IndicatorPhase = "idle" | "stretch" | "settle";

export interface IndicatorBox {
  top: number;
  height: number;
}

interface UseTravelIndicatorOptions {
  // Padding shaved off the top/bottom of the target element so the bar sits
  // inside the row rather than spanning its full height. Rail 1 uses 8 (large
  // square buttons); Rail 2 uses ~4 (thin 32px rows).
  inset?: number;
  // Duration of the stretch phase before contracting onto the target. Must
  // match the stretch transition in shell.css.
  stretchMs?: number;
}

/**
 * Shared travelling-indicator logic for both nav rails.
 *
 * Phases:
 *   • stretch — bar spans old→new (140ms linear).
 *   • settle  — bar contracts onto the target with a soft overshoot (520ms).
 *
 * Caller registers each target via the returned `setTarget(key, el)` ref
 * callback, then renders <TravelIndicator indicator={...} phase={...} />
 * inside a positioned container.
 */
export function useTravelIndicator(
  containerRef: { readonly current: HTMLElement | null },
  activeKey: string | null,
  { inset = 0, stretchMs = 140 }: UseTravelIndicatorOptions = {},
) {
  const targetRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const [indicator, setIndicator] = useState<IndicatorBox | null>(null);
  const [phase, setPhase] = useState<IndicatorPhase>("idle");
  const settleTimerRef = useRef<number | null>(null);

  const setTarget = useCallback((key: string, el: HTMLElement | null) => {
    if (el) targetRefs.current.set(key, el);
    else targetRefs.current.delete(key);
  }, []);

  useLayoutEffect(() => {
    if (activeKey == null) {
      setIndicator(null);
      setPhase("idle");
      return;
    }

    const target = targetRefs.current.get(activeKey);
    const container = containerRef.current;
    if (!target || !container) return;

    const newBox: IndicatorBox = {
      top: target.offsetTop + inset,
      height: target.offsetHeight - inset * 2,
    };

    if (indicator === null) {
      setIndicator(newBox);
      setPhase("idle");
      return;
    }

    const oldTop = indicator.top;
    const oldBottom = indicator.top + indicator.height;
    const newTop = newBox.top;
    const newBottom = newBox.top + newBox.height;

    const bridgeTop = Math.min(oldTop, newTop);
    const bridgeBottom = Math.max(oldBottom, newBottom);

    setIndicator({ top: bridgeTop, height: bridgeBottom - bridgeTop });
    setPhase("stretch");

    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      setIndicator(newBox);
      setPhase("settle");
    }, stretchMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
  }, []);

  return { indicator, phase, setTarget };
}

export function TravelIndicator({
  indicator,
  phase,
  id,
}: {
  indicator: IndicatorBox | null;
  phase: IndicatorPhase;
  id?: string;
}) {
  if (!indicator) return null;
  return (
    <span
      id={id}
      className={`nav-travel-indicator nav-travel-indicator-${phase}`}
      style={{ top: indicator.top, height: indicator.height }}
      aria-hidden
    />
  );
}
