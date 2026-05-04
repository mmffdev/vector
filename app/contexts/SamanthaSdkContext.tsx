"use client";

// PLA-0005 — Samantha SDK runtime context for custom apps.
// PLA-0008 — helpDefaults values may now be a HelpDocFragment carrying
//            title + body + videos + images, not just an HTML string.
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
import type { UiAppHelpDocFragment } from "@/app/store/shared/types";

export type SdkHelpValue = string | UiAppHelpDocFragment;
export type SdkHelpDefaults = Record<string, SdkHelpValue>;

interface SamanthaSdkContextValue {
  customAppId: string | null;
  helpDefaults: SdkHelpDefaults;
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
  helpDefaults?: SdkHelpDefaults;
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

// Resolve a help value from a manifest's helpDefaults map for a given
// (kind, name). Match order: exact "<kind>:<name>", then wildcard
// "<kind>:*". Returns null if neither matches.
export function resolveSdkHelp(
  helpDefaults: SdkHelpDefaults,
  kind: string,
  name: string,
): SdkHelpValue | null {
  const exact = helpDefaults[`${kind}:${name}`];
  if (exact !== undefined && exact !== "") return exact;
  const wildcard = helpDefaults[`${kind}:*`];
  if (wildcard !== undefined && wildcard !== "") return wildcard;
  return null;
}

// Normalise either string-form or fragment-form into a UiAppHelpDocFragment
// so callers can read uniform fields regardless of authoring style.
export function helpValueAsFragment(v: SdkHelpValue): UiAppHelpDocFragment {
  if (typeof v === "string") return { body_html: v };
  return v;
}
