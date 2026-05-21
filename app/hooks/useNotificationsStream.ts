"use client";

/**
 * useNotificationsStream — opens an EventSource against
 * /_site/notifications/stream and invokes the callback on each
 * `notification.created` event.
 *
 * The payload from the backend is a nudge, not the full body:
 *   { type: "notification.created", kind: "<kind>" }
 *
 * Callers refetch from notifications.list / unreadCount in response —
 * the read-model is the source of truth (handover_rmq.md § "Why
 * nudge-only on SSE").
 *
 * EventSource can't set Authorization headers, so the JWT goes in
 * ?access_token=<...> (same pattern as the WebSocket route uses, see
 * backend/internal/auth/middleware.go RequireAuth).
 *
 * Lifecycle:
 *   - Reconnects automatically when the EventSource emits `error`
 *     (the browser also retries by default; we close+reopen to make
 *     it deterministic across stale auth, network blips).
 *   - Silently no-ops when there is no auth token (logged-out / boot)
 *   - Closes on unmount.
 */

import { useEffect, useRef } from "react";

import { API_SITE_BASE, getApiToken } from "@/app/lib/api";

// Streaming endpoints compose their own URL because EventSource
// isn't a fetch — apiSite() can't be used here. lint:api-caller-
// discipline + lint:api-helper-exclusive exemption registered in
// dev/registries/api_caller_exempt.json.
const STREAM_PATH = "/notifications/stream";

export type StreamEvent =
  | { type: "notification.created"; kind?: string }
  | { type: string; [k: string]: unknown };

export function useNotificationsStream(onEvent: (e: StreamEvent) => void) {
  // Hold the latest callback in a ref so the effect below doesn't
  // re-subscribe on every render (would tear-down + reopen the SSE
  // connection on parent re-render, defeating the purpose).
  const cbRef = useRef(onEvent);
  useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const token = getApiToken();
    if (!token) return; // not signed in — bell falls back to polling

    const url = `${API_SITE_BASE}${STREAM_PATH}?access_token=${encodeURIComponent(token)}`;
    let es: EventSource | null = null;
    let closed = false;
    let reopenTimer: number | null = null;

    function open() {
      if (closed) return;
      try {
        es = new EventSource(url);
      } catch {
        // Browser without EventSource (rare today). Skip silently.
        return;
      }

      es.onmessage = (ev) => {
        if (!ev.data) return;
        try {
          const parsed = JSON.parse(ev.data) as StreamEvent;
          cbRef.current(parsed);
        } catch {
          // Malformed payload — ignore.
        }
      };

      es.onerror = () => {
        // EventSource auto-reconnects, but its retry timing isn't
        // visible from JS. Close and re-open after a small delay so
        // the wait is bounded; lets us recover from token rotation
        // (the new token will be picked up on the next open()).
        if (es) {
          es.close();
          es = null;
        }
        if (!closed) {
          reopenTimer = window.setTimeout(open, 3000);
        }
      };
    }

    open();

    return () => {
      closed = true;
      if (reopenTimer !== null) window.clearTimeout(reopenTimer);
      if (es) es.close();
    };
  }, []);
}
