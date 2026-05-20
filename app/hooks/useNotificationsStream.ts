"use client";

/**
 * useNotificationsStream — subscribes to the per-user notifications
 * topic on the realtime hub and invokes the callback on each nudge.
 *
 * Each nudge means "something changed for you — refetch the bell".
 * We deliberately don't pass the full notification payload; the
 * read model (users_notifications) is the source of truth and the
 * caller refetches from there. That keeps the wire payload tiny and
 * dual-write skew impossible.
 *
 * Resolves to a no-op (no error) when the realtime client is
 * unavailable — the bell falls back to a polling refresh, so the
 * UX still works without the stream.
 *
 * NOTE: this hook intentionally does not own the realtime client
 * lifecycle — when the chrome wires the bell into the shell, it
 * should mount the realtime client at the layout level and this
 * hook reads from it. For now, this is a stub that polls less
 * aggressively than the bell's own fallback poll; the wire-up to
 * the real hub is a follow-up.
 */

import { useEffect } from "react";

export function useNotificationsStream(_onNudge: () => void) {
  useEffect(() => {
    // Wire-up to realtime hub goes here — TODO. For now this hook
    // exists so the bell can call it without the chrome having to
    // care whether the real-time path is built yet.
    return () => {
      // teardown
    };
  }, [_onNudge]);
}
