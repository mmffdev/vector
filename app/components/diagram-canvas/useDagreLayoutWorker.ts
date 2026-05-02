"use client";

// PLA-0006 / 00275 — dagre layout worker hook.
//
// Owns one Worker per <DiagramCanvas> instance. Exposes a Promise-based
// runLayout() that resolves with positions + elapsed ms. Stale requests
// (newer reqId already in flight) get dropped silently — the caller is
// guaranteed a result for the most recent call only, in order.

import { useCallback, useEffect, useRef } from "react";

interface LayoutInputNode {
  id: string;
  width: number;
  height: number;
}

interface LayoutInputEdge {
  source: string;
  target: string;
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  ms: number;
}

export interface RunLayoutArgs {
  nodes: LayoutInputNode[];
  edges: LayoutInputEdge[];
  rankdir?: "TB" | "LR";
  nodesep?: number;
  ranksep?: number;
}

interface PendingResolver {
  reqId: number;
  resolve: (r: LayoutResult) => void;
  reject: (e: Error) => void;
}

export function useDagreLayoutWorker() {
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef<number>(0);
  const pendingRef = useRef<PendingResolver | null>(null);

  useEffect(() => {
    const w = new Worker(new URL("./layoutWorker.ts", import.meta.url), {
      type: "module",
    });
    w.addEventListener("message", (evt: MessageEvent) => {
      const msg = evt.data as { type?: string; reqId?: number };
      if (!msg || msg.type !== "layout:done") return;
      const pending = pendingRef.current;
      if (!pending || pending.reqId !== msg.reqId) return;
      pendingRef.current = null;
      const r = msg as { positions: LayoutResult["positions"]; ms: number };
      pending.resolve({ positions: r.positions, ms: r.ms });
    });
    w.addEventListener("error", () => {
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        pending.reject(new Error("layout worker error"));
      }
    });
    workerRef.current = w;
    return () => {
      w.terminate();
      workerRef.current = null;
      pendingRef.current = null;
    };
  }, []);

  const runLayout = useCallback((args: RunLayoutArgs): Promise<LayoutResult> => {
    const w = workerRef.current;
    if (!w) return Promise.reject(new Error("layout worker not ready"));
    const reqId = ++reqIdRef.current;
    return new Promise<LayoutResult>((resolve, reject) => {
      // Drop any in-flight request — only the most recent caller matters.
      if (pendingRef.current) {
        pendingRef.current.reject(new Error("superseded"));
      }
      pendingRef.current = { reqId, resolve, reject };
      w.postMessage({
        type: "layout",
        reqId,
        nodes: args.nodes,
        edges: args.edges,
        rankdir: args.rankdir ?? "TB",
        nodesep: args.nodesep ?? 30,
        ranksep: args.ranksep ?? 60,
      });
    });
  }, []);

  return { runLayout };
}
