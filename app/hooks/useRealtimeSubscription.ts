"use client";

/**
 * useRealtimeSubscription — opens a WebSocket to the backend's /ws
 * endpoint, subscribes to a topic, and calls `onMessage` for every
 * payload published to that topic by the rank listener (or any future
 * realtime channel).
 *
 *   useRealtimeSubscription({
 *     topic: `rank:work_item:${subscriptionID}:sprint:${sprintID}`,
 *     onMessage: () => refetch(),
 *   })
 *
 * Topics carry the subscriber's subscription_id as the third
 * colon-separated segment; the backend rejects subscribes that do not
 * match the connection's bound user (tenant isolation). Construct
 * topics with the helpers below — never accept a topic from
 * untrusted input.
 *
 * Reconnect: jittered exponential backoff, capped at 30s. The hook
 * resubscribes on every reconnect because the server forgets
 * subscriptions when the socket drops.
 */

import { useEffect, useRef } from "react";
import { getApiToken, getRefreshCallback } from "@/app/lib/api";
import { handleSessionCloseCode } from "@/app/lib/wsClose";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100";

export type RealtimeMessage = {
  resource_type: string;
  subscription_id: string;
  scope: "backlog" | "sprint";
  scope_id?: string | null;
  row_id: string;
  op: "INSERT" | "UPDATE" | "DELETE";
};

export type UseRealtimeSubscriptionOptions = {
  /** Full topic, e.g. "rank:work_item:<sub>:sprint:<sprint_id>". */
  topic: string | null;
  onMessage: (msg: RealtimeMessage) => void;
};

export function useRealtimeSubscription(opts: UseRealtimeSubscriptionOptions) {
  const onMessageRef = useRef(opts.onMessage);
  onMessageRef.current = opts.onMessage;

  useEffect(() => {
    if (!opts.topic) return;
    const topic = opts.topic;

    let ws: WebSocket | null = null;
    let cancelled = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Build the WS URL fresh each time — captures the current access token
    // so reconnects after token refresh carry the new JWT, not the expired one.
    const buildWsURL = () => {
      const base = API_BASE.replace(/^http/i, "ws");
      const token = getApiToken();
      const tokenParam = token ? `?access_token=${encodeURIComponent(token)}` : "";
      return `${base}/ws${tokenParam}`;
    };

    const scheduleReconnect = (wasAuthFailure: boolean) => {
      if (cancelled) return;
      const backoffBase = Math.min(500 * 2 ** retry, 30_000);
      const jitter = backoffBase * (0.75 + Math.random() * 0.5);
      retry++;
      if (wasAuthFailure) {
        // Token expired — refresh first, then reconnect immediately so we
        // don't spin reconnects with the same dead token.
        const refresh = getRefreshCallback();
        if (refresh) {
          reconnectTimer = setTimeout(() => {
            if (cancelled) return;
            refresh().finally(() => { if (!cancelled) connect(); });
          }, jitter);
          return;
        }
      }
      reconnectTimer = setTimeout(connect, jitter);
    };

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(buildWsURL());

      ws.addEventListener("open", () => {
        retry = 0;
        ws?.send(JSON.stringify({ subscribe: topic }));
      });

      ws.addEventListener("message", (e) => {
        try {
          const data = JSON.parse(e.data) as RealtimeMessage;
          onMessageRef.current(data);
        } catch {
          // Server only ever sends JSON; ignore malformed frames so
          // a bad publish doesn't tear down the connection.
        }
      });

      ws.addEventListener("close", (ev) => {
        if (cancelled) return;
        // B16.8.12: WS session enforcement may close us with code 4001
        // (session revoked) or 4002 (session idle expired). Those are
        // terminal — handleSessionCloseCode fires hardLogout and we
        // bail out instead of reconnecting against a dead session.
        if (handleSessionCloseCode(ev)) return;
        // code 4401 = backend explicit auth rejection (set by WS upgrade handler).
        // code 1006 = abnormal close (HTTP 401/403 during upgrade — no close frame).
        const isAuthFailure = ev.code === 4401 || ev.code === 1006;
        scheduleReconnect(isAuthFailure);
      });

      ws.addEventListener("error", () => {
        // Let close handler do the reconnect — error fires before close.
        ws?.close();
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (!ws) return;
      // Closing during the upgrade handshake produces a noisy
      // "WebSocket is closed before the connection is established"
      // browser warning — common under React StrictMode's double-mount
      // in dev. Defer the close until open if we're still connecting.
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener("open", () => ws?.close(1000, "cleanup"), { once: true });
      } else if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "cleanup");
      }
    };
  }, [opts.topic]);
}

/** Build a rank topic. Use this rather than concatenating by hand. */
export function rankTopic(
  resourceType: string,
  subscriptionID: string,
  scope: "backlog" | "sprint",
  scopeID?: string | null
): string {
  return `rank:${resourceType}:${subscriptionID}:${scope}:${scopeID ?? ""}`;
}
