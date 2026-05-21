"use client";

// ObjectTreeV2 wizard-JSON loader — Slice 1.5 of the ObjectTree refactor
// (docs/c_c_objecttree_refactor_plan.md).
//
// Walks a wizard-config object and replaces string refs with the values
// they point to in the registries (registry.ts) + the context (context.ts).
// The output is a "resolved config" — the same shape minus the
// indirection — that the V2 shell consumes directly.
//
// String refs in the JSON follow a stable naming convention:
//
//   "<categoryRef>": "<key>"
//
// where the suffix `Ref` on a field name marks it as a registry lookup
// and the string value is the registry key. The loader walks known
// suffixes and resolves them; everything else is forwarded verbatim.
//
// Recognised suffixes (Slice 1.5; grows as new categories appear):
//
//   *ComponentRef   → componentRegistry lookup
//   *RuleRef        → ruleRegistry lookup
//   *PluginRef      → pluginRegistry lookup (returns a loader promise,
//                     not the plugin itself — caller decides when to
//                     resolve)
//
// Slice 1.5's job is to LAND the loader contract so future slices can
// move configs from "imported as TypeScript" to "JSON with refs"
// incrementally. The work-items config is still imported as TypeScript
// at this slice (no migration yet) — the loader is exercised in the
// example JSON at docs/examples/p_wizard_workitems_v2.json which will
// drive Slice 6's real consumers.

import {
  componentRegistry,
  getComponent,
  getRule,
  loadPlugin,
  ruleRegistry,
  type ComponentRegistryKey,
  type RuleRegistryKey,
} from "@/app/components/ObjectTreeV2/registry";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * A raw wizard config — JSON-shaped, may carry `*Ref` string fields.
 * Recursive `Record<string, unknown>` so the loader can walk arbitrarily-
 * deep shapes (layout trees, column catalogues with nested options, …).
 */
export type RawWizardConfig = Record<string, unknown>;

/**
 * A resolved wizard config — same keys minus the `Ref` suffix where
 * lookups happened. The value at each resolved key is the actual
 * registry entry (component, rule fn, plugin loader). Non-ref fields
 * pass through unchanged.
 */
export type ResolvedWizardConfig = Record<string, unknown>;

// ── Suffix → resolver map ───────────────────────────────────────────────────

interface SuffixHandler {
  /** Strip this suffix from the key to get the resolved field name. */
  suffix: string;
  /** Resolve a string ref value to the actual thing. */
  resolve: (key: string) => unknown;
}

const SUFFIX_HANDLERS: SuffixHandler[] = [
  {
    suffix: "ComponentRef",
    resolve: (key) => getComponent(key as ComponentRegistryKey),
  },
  {
    suffix: "RuleRef",
    resolve: (key) => getRule(key as RuleRegistryKey),
  },
  {
    // Plugin refs resolve to the loader promise, NOT the plugin itself.
    // Bundle-splitting plays out at the caller's choosing — Suspense
    // boundary inside the shell, prefetch on idle, whatever.
    suffix: "PluginRef",
    resolve: (key) => () => loadPlugin(key),
  },
];

// ── Walker ──────────────────────────────────────────────────────────────────

/**
 * Resolve a wizard config recursively. Walks every level of the object;
 * arrays are walked element by element. String refs become real values;
 * everything else passes through.
 *
 * Pure / deterministic — same input → same output. Throws if a
 * referenced key is missing from its registry (loud failure beats
 * silent fallback).
 */
export function resolveWizardConfig(raw: RawWizardConfig): ResolvedWizardConfig {
  return walkObject(raw) as ResolvedWizardConfig;
}

function walkValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(walkValue);
  if (typeof v === "object") return walkObject(v as Record<string, unknown>);
  return v;
}

function walkObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const handler = SUFFIX_HANDLERS.find((h) => key.endsWith(h.suffix));
    if (handler && typeof value === "string") {
      // Strip the suffix to get the resolved field name.
      const resolvedKey = key.slice(0, -handler.suffix.length);
      if (resolvedKey.length === 0) {
        throw new Error(
          `[ObjectTreeV2 loader] ref key "${key}" has no name body (just the suffix). ` +
            `Expected e.g. "detailFlyoutComponentRef": "flyout.shell".`,
        );
      }
      out[resolvedKey] = handler.resolve(value);
      continue;
    }
    out[key] = walkValue(value);
  }
  return out;
}

// ── Sanity helpers (for tests and debug) ────────────────────────────────────

/**
 * Returns the list of registered component keys. Use in dev tooling
 * (e.g. /dev/objecttree-v2 registry inspector) to see what's available
 * before authoring a config.
 */
export function listRegisteredComponents(): string[] {
  return Object.keys(componentRegistry);
}

export function listRegisteredRules(): string[] {
  return Object.keys(ruleRegistry);
}
