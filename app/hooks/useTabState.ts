"use client";

import { useCallback } from "react";
import { useUserPreference } from "@/app/hooks/useUserPreference";

/**
 * Per-user tab selection persistence. The active tab survives reload,
 * tab close, and device switch by storing the value at
 * users.preferences[prefKey] via /_site/me/preferences/{key}.
 *
 * Pre-2026-05-18: this hook wrote `?tab=<value>` into the address bar
 * via router.replace. Retired with TD-URL-TAB-STATE / PLA-0053
 * (feedback_url_is_path_only). Address bar stays path-only; tab
 * identity lives server-side.
 *
 * Validation note: when the stored value isn't in `validTabs`
 * (renamed tab, stale preference), the hook silently falls back to
 * `defaultTab` — same defensive collapse used by useWorkItemsSort
 * for unknown sort keys.
 *
 * @param validTabs  - exhaustive list of legal tab values
 * @param defaultTab - value used when the pref is absent or unrecognised
 * @param prefKey    - users.preferences namespace (e.g. "tab.backlog").
 *                     Must be a stable per-page string so independent
 *                     tab groups don't collide.
 */
export function useTabState<T extends string>(
  validTabs: readonly T[],
  defaultTab: T,
  prefKey: string,
): [T, (next: T) => void] {
  const { value, setValue } = useUserPreference<T>(prefKey, defaultTab);

  const activeTab: T =
    value && (validTabs as readonly string[]).includes(value) ? value : defaultTab;

  const setTab = useCallback(
    (next: T) => {
      setValue(next);
    },
    [setValue],
  );

  return [activeTab, setTab];
}
