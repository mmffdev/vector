"use client";

// ObjectTreeV2 registry — Slice 1.5 of the ObjectTree refactor
// (docs/c_c_objecttree_refactor_plan.md).
//
// Single source of truth for "which name → which thing" lookups that
// JSON wizard configs use. Three categories:
//
//   componentRegistry  React components the shell mounts: detail
//                      flyouts, cell renderers, chrome components.
//                      Lazy-imported via React.lazy when bundle-split
//                      matters; eagerly imported for the small pieces.
//
//   ruleRegistry       Pure-function predicates from domain configs.
//                      Today: reparent rules. Future: filter encoders,
//                      sort comparators, cascade-trigger checkers.
//
//   pluginRegistry     Heavy capability modules dynamically imported
//                      only when a config's `capabilities` block flags
//                      them on (drag engine, cascade engine, scope-
//                      propagation overlay). Empty at this slice — the
//                      capabilities-flag wiring lands when sprints/
//                      releases configs land in Slice 6.
//
// JSON configs reference entries here by string key. The loader (see
// loader.ts) resolves a config's string refs into actual values at
// mount time. The shell consumes the resolved config; the registries
// themselves are an implementation detail.
//
// IMPORTANT: adding a registry entry is the SAFE way to extend V2 —
// adds a new key without touching the shell. Adding a new REGISTRY
// CATEGORY (e.g. a fourth bucket) IS a breaking change to the
// loader contract and needs the plan + handover doc updated.

import type React from "react";

// ── Component registry ──────────────────────────────────────────────────────
//
// React components referenced by name in wizard JSON. Currently used for
// detail flyout bodies; will grow to cover cell renderers, chrome
// variants, and any future "this kind of UI here" lookups.
//
// Eager-imported at this slice. When bundle sizes start to matter
// (Slice 1.5 plan called this out), swap individual entries to
// `React.lazy(() => import(...))` — the public API stays the same.

import { ObjectTreeDetailFlyout } from "@/app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout";
import { DenseGridHeader } from "@/app/components/ObjectTreeV2/kinds/DenseGridHeader";
import { ActionBar } from "@/app/components/ObjectTreeV2/kinds/ActionBar";

export const componentRegistry = {
  // Flyout shell — generic; same component every grid mounts.
  "flyout.shell": ObjectTreeDetailFlyout,

  // Chrome kinds — generic; consumed by configs that declare matching
  // layout nodes (Slice 6+ when the layout array is wired).
  "kind.DenseGridHeader": DenseGridHeader,
  "kind.ActionBar": ActionBar,

  // Domain-specific flyout bodies are registered NEAR their config.
  // See app/components/ObjectTreeV2/configs/registerWorkItems.ts for
  // the work-items ArtefactBody registration (added when Slice 6
  // brings the timebox flyout into the mix).
} as const;

export type ComponentRegistryKey = keyof typeof componentRegistry;

// ── Rule registry ───────────────────────────────────────────────────────────
//
// Pure-function rules looked up by string name. Used for things that are
// "the same SHAPE but different IMPLEMENTATION per domain" — reparent
// legality being the canonical example. Other future inhabitants:
// filter encoders, search accessors, cascade-trigger checkers.

import {
  workItemsCanReparent,
  workItemsGetCandidateIds,
} from "@/app/components/ObjectTreeV2/configs/workItemsReparentRules";

export const ruleRegistry = {
  "reparent.workItems.canReparent": workItemsCanReparent,
  "reparent.workItems.getCandidateIds": workItemsGetCandidateIds,
} as const;

export type RuleRegistryKey = keyof typeof ruleRegistry;

// ── Plugin registry ─────────────────────────────────────────────────────────
//
// Heavy modules that should ONLY load when a config's capabilities flag
// turns them on. Use the lazy-promise pattern so unreferenced plugins
// never enter the bundle.
//
// Empty until Slice 6's sprints/releases configs declare their
// capability flags. Today's V2 imports its drag and cascade behaviour
// directly (slice scope was generalisation, not bundle-splitting).

export const pluginRegistry: Record<string, () => Promise<{ default: React.ComponentType<unknown> }>> = {
  // Example shape — wired in Slice 6+:
  //
  // "plugin.dragEngine": () => import("./plugins/DragEngine"),
  // "plugin.cascadeEngine": () => import("./plugins/CascadeEngine"),
  // "plugin.scopePropagation": () => import("./plugins/ScopePropagation"),
};

// ── Public lookup helpers ───────────────────────────────────────────────────
//
// Strict accessors that throw on miss. Wizard configs reference by
// string and the loader needs to fail LOUD if a config references a
// key that doesn't exist — silent fallback hides typos and config
// drift, which is the exact problem the registry was meant to solve.

export function getComponent(key: ComponentRegistryKey): typeof componentRegistry[ComponentRegistryKey] {
  const entry = componentRegistry[key];
  if (!entry) {
    throw new Error(`[ObjectTreeV2 registry] no component registered for key "${key}"`);
  }
  return entry;
}

export function getRule(key: RuleRegistryKey): typeof ruleRegistry[RuleRegistryKey] {
  const entry = ruleRegistry[key];
  if (!entry) {
    throw new Error(`[ObjectTreeV2 registry] no rule registered for key "${key}"`);
  }
  return entry;
}

export function loadPlugin(key: string): Promise<{ default: React.ComponentType<unknown> }> {
  const loader = pluginRegistry[key];
  if (!loader) {
    return Promise.reject(
      new Error(`[ObjectTreeV2 registry] no plugin registered for key "${key}"`),
    );
  }
  return loader();
}
