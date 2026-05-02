"use client";

// PLA-0005 — Samantha SDK runtime context for custom apps.
//
// Wrap a custom-app frame in <SamanthaSdkProvider customAppId={…}
// helpDefaults={manifest.helpDefaults}> so the addressable substrate can:
//   1. Tag every addressable registered inside the frame with
//      source='custom_app' + custom_app_id (backend handles dedup +
//      collision via ErrCustomAppCollision).
//   2. Fall back to the manifest's helpDefaults when neither page_help
//      nor library_help_defaults has copy for the addressable's
//      (kind, name).
//
// This keeps custom apps zero-config: the operator authors a manifest
// once, mounts the frame anywhere on /dashboard (or any other page),
// and the substrate threads identity + help copy through automatically.

import { createContext, useContext, ReactNode } from "react";

interface SamanthaSdkContextValue {
  customAppId: string | null;
  helpDefaults: Record<string, string>;
}

const SamanthaSdkContext = createContext<SamanthaSdkContextValue>({
  customAppId: null,
  helpDefaults: {},
});

export function useSamanthaSdk(): SamanthaSdkContextValue {
  return useContext(SamanthaSdkContext);
}

interface SamanthaSdkProviderProps {
  customAppId: string;
  helpDefaults?: Record<string, string>;
  children: ReactNode;
}

export function SamanthaSdkProvider({
  customAppId,
  helpDefaults,
  children,
}: SamanthaSdkProviderProps) {
  const value: SamanthaSdkContextValue = {
    customAppId,
    helpDefaults: helpDefaults ?? {},
  };
  return (
    <SamanthaSdkContext.Provider value={value}>{children}</SamanthaSdkContext.Provider>
  );
}

// Resolve a help body from a manifest's helpDefaults map for a given
// (kind, name). Match order: exact "<kind>:<name>", then wildcard
// "<kind>:*". Returns null if neither matches.
export function resolveSdkHelp(
  helpDefaults: Record<string, string>,
  kind: string,
  name: string,
): string | null {
  const exact = helpDefaults[`${kind}:${name}`];
  if (exact) return exact;
  const wildcard = helpDefaults[`${kind}:*`];
  if (wildcard) return wildcard;
  return null;
}
