"use client";

// useTopologyHandoffs — subscribes to the per-user "topology:handoff:<uid>"
// realtime topic and pipes incoming GrantNotification payloads to a
// caller-supplied handler.
//
// This is the frontend half of story 00283 (handoff inbox). The
// backend publishes on a fresh role grant via orgdesign.HubNotifier;
// this hook surfaces that event so the UI can show a toast or a
// banner with a deep-link to /topology?focus=:nodeId.

import { useEffect, useRef } from "react";
import { getApiToken } from "@/app/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100";

export type TopologyHandoff = {
  grant_id: string;
  node_id: string;
  node_name: string;
  label_override?: string | null;
  role: "admin" | "editor" | "viewer";
  granted_by: string;
  granted_at: string;
};

export function useTopologyHandoffs(
  userID: string | null,
  onHandoff: (h: TopologyHandoff) => void
) {
  const handlerRef = useRef(onHandoff);
  handlerRef.current = onHandoff;

  useEffect(() => {
    if (!userID) return;
    const topic = `topology:handoff:${userID}`;

    let ws: WebSocket | null = null;
    let cancelled = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const wsURL = (() => {
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
          const data = JSON.parse(e.data) as TopologyHandoff;
          if (data && data.grant_id && data.node_id) {
            handlerRef.current(data);
          }
        } catch {
          // ignore malformed frames
        }
      });

      ws.addEventListener("close", () => {
        if (cancelled) return;
        const base = Math.min(500 * 2 ** retry, 30_000);
        const jitter = base * (0.75 + Math.random() * 0.5);
        retry++;
        reconnectTimer = setTimeout(connect, jitter);
      });

      ws.addEventListener("error", () => {
        ws?.close();
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      // Closing while readyState === CONNECTING logs a noisy
      // "closed before connection established" warning (especially
      // under React 19 StrictMode double-invoke + HMR). Defer the
      // close until the handshake finishes.
      const sock = ws;
      if (!sock) return;
      if (sock.readyState === WebSocket.CONNECTING) {
        sock.addEventListener("open", () => sock.close(), { once: true });
      } else if (sock.readyState === WebSocket.OPEN) {
        sock.close();
      }
    };
  }, [userID]);
}
