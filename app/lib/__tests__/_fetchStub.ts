// Tiny shared fetch stub for typed-client wire-shape tests
// (TD-TEST-003 remainder, 2026-05-16).
//
// We deliberately avoid msw here — the typed clients are thin wrappers
// over `fetch`, so a single global stub gives us full coverage with zero
// additional dependencies. Each spec calls installFetchStub({ ... }) in
// beforeEach and the helper:
//   • captures every fetch call (URL, method, headers, body)
//   • replies with the configured ok/json or error/json shape
//   • restores the original fetch in afterEach
//
// The stub is intentionally tiny — if we ever grow a need for streaming
// or multi-step matching, msw becomes the right tool. For now this
// suffices.

import { vi } from "vitest";

export type StubResponse = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export type CapturedCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

export type FetchStub = {
  calls: CapturedCall[];
  /** Set the next response in the queue. If empty when fetch is called,
   *  the default ({status: 200, body: null}) is returned. */
  queue: StubResponse[];
};

export function installFetchStub(): FetchStub {
  const state: FetchStub = { calls: [], queue: [] };

  const stub: typeof fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init.method ?? "GET").toUpperCase();
    const rawBody = init.body;
    let parsedBody: unknown = rawBody;
    if (typeof rawBody === "string") {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        // leave as string
      }
    }
    const headers: Record<string, string> = {};
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) headers[k] = v;
    } else if (init.headers && typeof init.headers === "object") {
      Object.assign(headers, init.headers as Record<string, string>);
    }
    state.calls.push({ url, method, headers, body: parsedBody });

    const next = state.queue.shift() ?? { status: 200, body: null };
    const bodyText = next.body == null ? "" : JSON.stringify(next.body);
    return new Response(bodyText, {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json", ...(next.headers ?? {}) },
    });
  };

  vi.stubGlobal("fetch", stub);
  return state;
}

export function restoreFetch() {
  vi.unstubAllGlobals();
}
