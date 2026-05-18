"use client";

import { useCallback, useEffect, useState } from "react";
import { apiSite } from "@/app/lib/api";

/**
 * Reads and writes a single per-user preference value stored at
 * users.preferences[prefKey] via /_site/me/preferences/{key}.
 *
 * Seed-once pattern (mirrors ScopeContext.profileSeededRef):
 *   1. On mount, GET the namespace; if present, hydrate local state.
 *   2. State lives in useState — UI reads from there for instant paint.
 *   3. Every change updates state optimistically + fires a PUT.
 *   4. PUT failures swallow; next reload reconciles from server.
 *
 * Why this exists: TD-URL-FILTER-CHIPS / TD-URL-TAB-STATE retired the
 * URL-query-state pattern (PLA-0053 / feedback_url_is_path_only). This
 * hook is the canonical replacement for any state that needs to
 * persist across reload/tab-close/device but must not live in the
 * address bar.
 *
 * @param prefKey      Namespace under /_site/me/preferences/{key}.
 *                     Must match the regex enforced server-side:
 *                     lowercase alphanumeric + dot/dash/underscore
 *                     separators, no consecutive separators, 1–80 chars.
 *                     Examples: "workitems.filters", "tab.backlog".
 * @param defaultValue Value to use until the server seed lands and
 *                     when the namespace is absent on the server.
 */
export function useUserPreference<T>(
  prefKey: string,
  defaultValue: T,
): {
  value: T;
  setValue: (next: T) => void;
  seeded: boolean;
} {
  const [value, setLocalValue] = useState<T>(defaultValue);
  const [seeded, setSeeded] = useState(false);

  // Seed once per prefKey. Changing prefKey mid-mount re-seeds.
  useEffect(() => {
    let cancelled = false;
    apiSite<{ value: T | null }>(`/me/preferences/${encodeURIComponent(prefKey)}`)
      .then((r) => {
        if (cancelled) return;
        if (r.value !== null && r.value !== undefined) setLocalValue(r.value);
        setSeeded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // 4xx/5xx → keep default; mark seeded so writes still fire.
        setSeeded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [prefKey]);

  const setValue = useCallback(
    (next: T) => {
      setLocalValue(next);
      apiSite(`/me/preferences/${encodeURIComponent(prefKey)}`, {
        method: "PUT",
        body: JSON.stringify({ value: next }),
      }).catch(() => {
        /* fire-and-forget; reload reconciles */
      });
    },
    [prefKey],
  );

  return { value, setValue, seeded };
}
