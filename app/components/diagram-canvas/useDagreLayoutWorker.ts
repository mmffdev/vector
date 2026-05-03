"use client";

// PLA-0006 / 00275 — dagre layout worker hook.
//
// Owns one Worker per <DiagramCanvas> instance. Exposes a Promise-based
// runLayout() that resolves with positions + elapsed ms. Stale requests
// (newer reqId already in flight) get dropped silently — the caller is
// guaranteed a result for the most recent call only, in order.
//
// Worker construction (`new Worker(new URL("./layoutWorker.ts", import.meta.url))`)
// is unreliable under Turbopack dev mode. When it fails — at construction,
// via an `error` event, or by exceeding WORKER_TIMEOUT_MS without a reply —
// we fall back to running dagre in-thread via runDagreLayout. This keeps
// the perf contract honest in dev while the worker remains the prod path.

import { useCallback, useEffect, useRef } from "react";
import { runDagreLayout, type DagreLayoutArgs } from "./runDagreLayout";

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
  args: DagreLayoutArgs;
  resolve: (r: LayoutResult) => void;
  reject: (e: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

const WORKER_TIMEOUT_MS = 5000;

function clearPendingTimeout(p: PendingResolver | null) {
  if (p?.timeoutId !== null && p?.timeoutId !== undefined) {
    clearTimeout(p.timeoutId);
  }
}

export function useDagreLayoutWorker() {
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef<number>(0);
  const pendingRef = useRef<PendingResolver | null>(null);
  // Sticky: once we've fallen back, stay on the main thread for this
  // mount so we don't keep paying the worker-construction cost.
  const fallbackRef = useRef<boolean>(false);

  useEffect(() => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL("./layoutWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      fallbackRef.current = true;
      return;
    }
    w.addEventListener("message", (evt: MessageEvent) => {
      const msg = evt.data as { type?: string; reqId?: number };
      if (!msg || msg.type !== "layout:done") return;
      const pending = pendingRef.current;
      if (!pending || pending.reqId !== msg.reqId) return;
      clearPendingTimeout(pending);
      pendingRef.current = null;
      const r = msg as { positions: LayoutResult["positions"]; ms: number };
      pending.resolve({ positions: r.positions, ms: r.ms });
    });
    w.addEventListener("error", () => {
      fallbackRef.current = true;
      const pending = pendingRef.current;
      if (!pending) return;
      clearPendingTimeout(pending);
      pendingRef.current = null;
      try {
        pending.resolve(runDagreLayout(pending.args));
      } catch (e) {
        pending.reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    workerRef.current = w;
    return () => {
      w?.terminate();
      workerRef.current = null;
      clearPendingTimeout(pendingRef.current);
      pendingRef.current = null;
    };
  }, []);

  const runLayout = useCallback((args: RunLayoutArgs): Promise<LayoutResult> => {
    const reqId = ++reqIdRef.current;
    const fullArgs: DagreLayoutArgs = {
      nodes: args.nodes,
      edges: args.edges,
      rankdir: args.rankdir ?? "TB",
      nodesep: args.nodesep ?? 30,
      ranksep: args.ranksep ?? 60,
    };

    const runOnMainThread = (): LayoutResult => runDagreLayout(fullArgs);

    const w = workerRef.current;
    if (!w || fallbackRef.current) {
      return Promise.resolve().then(runOnMainThread);
    }

    return new Promise<LayoutResult>((resolve, reject) => {
      // Drop any in-flight request — only the most recent caller matters.
      const prev = pendingRef.current;
      if (prev) {
        clearPendingTimeout(prev);
        prev.reject(new Error("superseded"));
      }
      const timeoutId = setTimeout(() => {
        const pending = pendingRef.current;
        if (pending?.reqId !== reqId) return;
        pendingRef.current = null;
        fallbackRef.current = true;
        try {
          resolve(runOnMainThread());
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }, WORKER_TIMEOUT_MS);
      pendingRef.current = { reqId, args: fullArgs, resolve, reject, timeoutId };
      try {
        w.postMessage({
          type: "layout",
          reqId,
          nodes: fullArgs.nodes,
          edges: fullArgs.edges,
          rankdir: fullArgs.rankdir,
          nodesep: fullArgs.nodesep,
          ranksep: fullArgs.ranksep,
        });
      } catch {
        clearTimeout(timeoutId);
        pendingRef.current = null;
        fallbackRef.current = true;
        try {
          resolve(runOnMainThread());
        } catch (inner) {
          reject(inner instanceof Error ? inner : new Error(String(inner)));
        }
      }
    });
  }, []);

  return { runLayout };
}
