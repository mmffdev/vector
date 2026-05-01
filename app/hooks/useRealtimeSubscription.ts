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
import { getApiToken } from "@/app/lib/api";

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

    const wsURL = (() => {
      // Convert http(s) → ws(s) and append the access token as a query
      // param — browsers cannot set Authorization on WS upgrade.
      const base = API_BASE.replace(/^http/i, "ws");
      const token = getApiToken();
      const tokenParam = token ? `?access_token=${encodeURIComponent(token)}` : "";
      return `${base}/ws${tokenParam}`;
    })();

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(wsURL);

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

      ws.addEventListener("close", () => {
        if (cancelled) return;
        // Exponential backoff with jitter: 0.5, 1, 2, 4, 8, … capped
        // at 30s. ±25% jitter avoids thundering herd on backend
        // restart.
        const base = Math.min(500 * 2 ** retry, 30_000);
        const jitter = base * (0.75 + Math.random() * 0.5);
        retry++;
        reconnectTimer = setTimeout(connect, jitter);
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
      ws?.close();
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
