"use client";

import { useContext } from "react";
import { SentinelCtx } from "./SentinelProvider";
import type { SentinelState } from "./types";

/**
 * useSentinel — the only hook handlers should reach for to read the
 * user / tenant / scope state on the client. Returns the full
 * `sentinel_*` state bag exposed by SentinelProvider.
 *
 * Throws when called outside <SentinelProvider>. This is the negative-
 * test case 6 in sentinel_provider.test.tsx — no silent zero-value, so
 * an unmounted provider can never accidentally render permissive UI.
 */
export function useSentinel(): SentinelState {
  const ctx = useContext(SentinelCtx);
  if (ctx === null) {
    throw new Error(
      "useSentinel() must be used inside <SentinelProvider>. Mount the provider at " +
        "the topmost layout for the route group — see PLA062 S09.",
    );
  }
  return ctx;
}
