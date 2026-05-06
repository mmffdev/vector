// Contextual hints — one-shot toasts that fire on first interaction with a
// surface and never again. Suppression is persisted in localStorage so the
// user is not re-onboarded across reloads.
//
// Add a new hint by appending an entry to HINTS, then call `useHintOnce`
// (or the imperative `showHintOnce`) at the trigger point. The key is the
// suppression identifier; bumping the wording does not re-fire.

'use client';

import { useEffect } from 'react';

import { notify } from './toast';

const STORAGE_KEY = 'mmff:hints:seen';

export const HINTS = {
  WORK_ITEMS_FIRST_VISIT:
    'Use the column chooser to show or hide fields like type, flow state, and assignee.',
  PORTFOLIO_MODEL_FIRST_VISIT:
    'Drag a layer row to reorder; double-click a name to rename it.',
  ARCHIVE_MAP_FIRST_OPEN:
    'Archived items show a breadcrumb of where they used to live. Tap restore to bring one back.',
  PROFILE_BAR_FIRST_USE:
    'Profiles save your column choices, filters, and sort order. Switch any time.',
} as const;

export type HintKey = keyof typeof HINTS;

function readSeen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(seen)));
  } catch {
    // localStorage may be unavailable (private mode, quota); silent fail —
    // the worst case is the hint shows again on the next visit.
  }
}

export function hasSeenHint(key: HintKey): boolean {
  return readSeen().has(key);
}

export function showHintOnce(key: HintKey): boolean {
  const seen = readSeen();
  if (seen.has(key)) return false;
  notify.hint(HINTS[key]);
  seen.add(key);
  writeSeen(seen);
  return true;
}

export function useHintOnce(key: HintKey, when = true): void {
  useEffect(() => {
    if (!when) return;
    showHintOnce(key);
  }, [key, when]);
}

export function resetHints(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
