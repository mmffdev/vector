"use client";

import { useEffect, useState } from "react";

export const SERVICE_HEALTH_POLL_MS = 10_000;

export type ServiceStatus = "up" | "down" | "degraded";

export type ServiceResult = {
  id: string;
  label: string;
  status: ServiceStatus;
  latencyMs?: number;
  detail?: string;
  active?: boolean;
};

export type CheckResult = {
  services: ServiceResult[];
  checkedAt: string;
  activeEnv?: string;
};

export type ServiceHealthState = {
  result: CheckResult | null;
  loading: boolean;
  /** monotonically increments after every successful refresh — drives the progress-bar reset */
  tick: number;
};

// Module-level singleton so multiple consumers (float dot + panel) share a
// single fetch loop. Polling runs while subscriber count > 0.
let state: ServiceHealthState = { result: null, loading: false, tick: 0 };
const subscribers = new Set<(s: ServiceHealthState) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

function emit() {
  for (const fn of subscribers) fn(state);
}

async function check() {
  if (inflight) return inflight;
  state = { ...state, loading: true };
  emit();
  inflight = (async () => {
    try {
      const res = await fetch("/api/dev/services", { cache: "no-store" });
      if (res.ok) {
        const result = await res.json() as CheckResult;
        state = { result, loading: false, tick: state.tick + 1 };
      } else {
        state = { ...state, loading: false };
      }
    } catch {
      state = { ...state, loading: false };
    } finally {
      inflight = null;
      emit();
    }
  })();
  return inflight;
}

function start() {
  if (timer) return;
  check();
  timer = setInterval(check, SERVICE_HEALTH_POLL_MS);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function useServiceHealth() {
  const [snap, setSnap] = useState(state);
  useEffect(() => {
    subscribers.add(setSnap);
    if (subscribers.size === 1) start();
    setSnap(state);
    return () => {
      subscribers.delete(setSnap);
      if (subscribers.size === 0) stop();
    };
  }, []);
  return { ...snap, refresh: check };
}
