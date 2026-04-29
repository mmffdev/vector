"use client";

import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * Syncs a tab selection to a URL search param so tabs are bookmarkable,
 * shareable, and survive page reload. Uses router.replace (not push) so
 * tab switches don't pollute browser history — Back takes you to the
 * previous page, not the previous tab.
 *
 * @param validTabs  - exhaustive list of legal tab values
 * @param defaultTab - value used when the param is absent or unrecognised
 * @param paramName  - search-param key (default "tab"); use a distinct name
 *                     per group when a page has multiple independent tab sets
 */
export function useTabState<T extends string>(
  validTabs: readonly T[],
  defaultTab: T,
  paramName = "tab",
): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get(paramName) as T | null;
  const activeTab =
    raw && (validTabs as readonly string[]).includes(raw) ? raw : defaultTab;

  const setTab = useCallback(
    (next: T) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(paramName, next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, paramName],
  );

  return [activeTab, setTab];
}
