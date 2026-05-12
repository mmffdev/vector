"use client";

import { useMemo } from "react";
import { useNavPrefs } from "@/app/contexts/NavPrefsContext";
import { useFilteredPerspectives } from "./useFilteredPerspectives";
import type { Perspective, NavSection } from "@/app/lib/nav-v2";

/**
 * Section IDs in the redesign perspective data map to canonical
 * `page_tags.tag_enum` values driven by NavPrefs. Sections whose enum is not
 * in NavPrefs (e.g. perspective-specific sections like Developer or Vista)
 * are left in their authored order, after the NavPrefs-ordered sections.
 */
const SECTION_ID_TO_TAG_ENUM: Record<string, string> = {
  home: "personal",
  personal: "personal",
  admin: "admin_settings",
  planning: "planning",
  strategic: "strategic",
};

export function useNavOrderedPerspectives(): Perspective[] {
  const filtered = useFilteredPerspectives();
  const { tags } = useNavPrefs();

  return useMemo(() => {
    if (tags.length === 0) return filtered;
    const orderByEnum = new Map<string, number>();
    const visibleEnums = new Set<string>();
    for (const t of tags) {
      orderByEnum.set(t.enum, t.defaultOrder);
      if (!t.isAdminMenu) visibleEnums.add(t.enum);
    }

    return filtered.map((p) => {
      const tagged: Array<{ section: NavSection; order: number }> = [];
      const untagged: NavSection[] = [];
      for (const s of p.sections) {
        const tagEnum = SECTION_ID_TO_TAG_ENUM[s.id];
        if (tagEnum && orderByEnum.has(tagEnum)) {
          if (!visibleEnums.has(tagEnum)) continue;
          tagged.push({ section: s, order: orderByEnum.get(tagEnum)! });
        } else {
          untagged.push(s);
        }
      }
      tagged.sort((a, b) => a.order - b.order);
      return { ...p, sections: [...tagged.map((t) => t.section), ...untagged] };
    });
  }, [filtered, tags]);
}
