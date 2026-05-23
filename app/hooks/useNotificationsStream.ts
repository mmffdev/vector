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
 * EventSource can't set Authorization or DPoP headers, so both ride
 * on the URL: ?access_token=<jwt>&dpop=<proof>. TD-SEC-DPOP-BINDING
 * Phase 5 requires every authed call to carry a DPoP proof — the
 * backend's RequireAuth middleware reads the query param when the
 * header is absent (see backend/internal/auth/middleware.go:128-141).
 * The proof is bound to method+htu, so a fresh one is minted on every
 * open() — re-using a proof past its iat freshness window 401s with
 * reason=dpop_replay.
 *
 * Lifecycle:
 *   - Reconnects with exponential backoff (3s → 6s → 12s → 30s → 60s)
 *     when the EventSource emits `error`. Backoff resets on a
 *     successful `onopen` so a transient network blip recovers fast
 *     but a persistent failure (revoked session, server down) stops
 *     hammering quickly.
 *   - Each reopen reads the token fresh from getApiToken() so a
 *     post-mount token rotation is picked up. If the token has gone
 *     away (sign-out), the reconnect stops until the hook is remounted.
 *   - Hard-cap at MAX_CONSECUTIVE_ERRORS (10) consecutive failures with
 *     no successful open — an idle tab shouldn't poll forever.
 *   - Silently no-ops when there is no auth token (logged-out / boot)
 *   - Closes on unmount.
 */

import { useEffect, useRef } from "react";

import { API_SITE_BASE, getApiToken } from "@/app/lib/api";
import { hasActiveKeypair, mintProof } from "@/app/lib/dpop";

// Streaming endpoints compose their own URL because EventSource
// isn't a fetch — apiSite() can't be used here. lint:api-caller-
// discipline + lint:api-helper-exclusive exemption registered in
// dev/registries/api_caller_exempt.json.
const STREAM_PATH = "/notifications/stream";

const BACKOFF_MS = [3_000, 6_000, 12_000, 30_000, 60_000];
const MAX_CONSECUTIVE_ERRORS = 10;

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
    if (!getApiToken()) return; // not signed in — bell falls back to polling

    let es: EventSource | null = null;
    let closed = false;
    let reopenTimer: number | null = null;
    let errorCount = 0;

    async function open() {
      if (closed) return;

      // Re-read the token each open so a rotation since mount is
      // picked up. If it's gone (sign-out), stop the loop — a fresh
      // sign-in will remount this hook.
      const token = getApiToken();
      if (!token) return;

      // Mint a fresh DPoP proof per open (htm + htu bound, single-use
      // jti). The backend rejects proofs older than DPoPProofMaxAge or
      // proofs reused within the freshness window, so we cannot cache
      // across opens. The proof must NOT include the query string in
      // htu — mintProof strips ? and # internally to mirror the
      // backend's stripHTUExtras (backend/internal/auth/dpop.go).
      const baseURL = `${API_SITE_BASE}${STREAM_PATH}`;
      const tokenParam = `?access_token=${encodeURIComponent(token)}`;
      let url = `${baseURL}${tokenParam}`;
      if (hasActiveKeypair()) {
        const proof = await mintProof({
          htm: "GET",
          htu: baseURL,
          accessToken: token,
        });
        if (proof) {
          url = `${url}&dpop=${encodeURIComponent(proof)}`;
        }
      }
      if (closed) return;

      try {
        es = new EventSource(url);
      } catch {
        // Browser without EventSource (rare today). Skip silently.
        return;
      }

      es.onopen = () => {
        errorCount = 0;
      };

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
        if (es) {
          es.close();
          es = null;
        }
        if (closed) return;

        errorCount += 1;
        if (errorCount > MAX_CONSECUTIVE_ERRORS) {
          // Stop hammering — server is down, token is dead, or the
          // tab is in some other persistent-fail state.
          return;
        }
        const delay =
          BACKOFF_MS[Math.min(errorCount - 1, BACKOFF_MS.length - 1)];
        reopenTimer = window.setTimeout(open, delay);
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
