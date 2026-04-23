"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import {
  DRAFT_SCHEMA_VERSION,
  deleteDraft,
  readDraft,
  writeDraft,
  type DraftRecord,
} from "@/app/lib/draftStore";

const DEBOUNCE_MS = 500;
const MAX_DRAFT_BYTES = 500 * 1024;

export interface UseDraftArgs<T> {
  formKey: string;
  scopeKey?: string | null;
  initial: T;
}

export interface RestoredDraft<T> {
  values: T;
  savedAt: string;          // ISO timestamp
  apply: () => void;        // copy `values` into the form's controlled state
  dismiss: () => void;      // discard the draft (deletes from IDB) & hide banner
}

export interface UseDraftResult<T> {
  save: (partial: Partial<T>) => void;     // debounced
  clear: () => Promise<void>;              // call on confirmed 2xx submit
  restored: RestoredDraft<T> | null;       // null if no eligible draft on mount
}

// useDraft persists a controlled form's values to IndexedDB on a 500ms
// debounce. Restoration is opt-in via the returned `restored` handle —
// the form decides when to call `apply()` (typically from a banner).
//
// The hook is a no-op when there is no signed-in user, when the user
// changes mid-render, or when IDB is unavailable.
export function useDraft<T extends Record<string, unknown>>(
  { formKey, scopeKey = null, initial }: UseDraftArgs<T>,
  onApply: (values: T) => void,
): UseDraftResult<T> {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [restored, setRestored] = useState<RestoredDraft<T> | null>(null);
  const valuesRef = useRef<T>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);

  // Hydrate restored draft on mount / when identity changes.
  useEffect(() => {
    cancelled.current = false;
    if (!userId) {
      setRestored(null);
      return;
    }
    void readDraft<T>(userId, formKey, scopeKey).then((rec) => {
      if (cancelled.current) return;
      if (!rec) {
        setRestored(null);
        return;
      }
      setRestored({
        values: rec.values,
        savedAt: rec.savedAt,
        apply: () => {
          valuesRef.current = rec.values;
          onApply(rec.values);
          setRestored(null);
        },
        dismiss: () => {
          void deleteDraft(userId, formKey, scopeKey);
          setRestored(null);
        },
      });
    });
    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // onApply is intentionally not in deps — callers usually pass a fresh
    // closure each render and we only care about the *latest* one at
    // restore time. We capture it via the ref-free closure above; if a
    // caller needs the freshest setter, they can re-key the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, formKey, scopeKey]);

  const save = useCallback(
    (partial: Partial<T>) => {
      if (!userId) return;
      valuesRef.current = { ...valuesRef.current, ...partial };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const rec: DraftRecord<T> = {
          formKey,
          scopeKey,
          values: valuesRef.current,
          savedAt: new Date().toISOString(),
          userId,
          schemaVersion: DRAFT_SCHEMA_VERSION,
        };
        // Cheap size guard — oversized payloads (e.g. base64 images in a
        // rich-text editor) just skip the write rather than blow the quota.
        try {
          const serialized = JSON.stringify(rec);
          if (serialized.length > MAX_DRAFT_BYTES) return;
        } catch {
          return;
        }
        void writeDraft(rec);
      }, DEBOUNCE_MS);
    },
    [userId, formKey, scopeKey],
  );

  const clear = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!userId) return;
    await deleteDraft(userId, formKey, scopeKey);
    setRestored(null);
  }, [userId, formKey, scopeKey]);

  return { save, clear, restored };
}
