"use client";

// PLA-0054 / story 00591 — Status chip reducer module.
//
// Re-exports the pure reducer from useStatusChipOptions so tests and
// any non-React caller can pull it from a dedicated path without
// importing the hook (which would otherwise drag in React context).

export { reduceStatusChange } from "@/app/hooks/useStatusChipOptions";

// Hook form — minimal; pages typically inline the reducer call inside
// their `setFilter('type', …)` handler. Kept exported so the F6 test's
// `mod.useStatusChipReducer` lookup resolves to something callable.
export function useStatusChipReducer(): { reduce: typeof import("@/app/hooks/useStatusChipOptions").reduceStatusChange } {
  // Lazy require so the hook can sit at the module top-level without
  // creating an import cycle with consumers.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { reduceStatusChange } = require("@/app/hooks/useStatusChipOptions") as typeof import("@/app/hooks/useStatusChipOptions");
  return { reduce: reduceStatusChange };
}
