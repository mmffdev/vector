"use client";

/**
 * useRefetchOnPush — convenience wrapper around useRealtimeSubscription
 * that turns every push into a debounced refetch. Use this when you
 * have a list view that re-queries the server for the canonical
 * ordering whenever anything in the subscribed scope changes
 * (insert/update/delete/move).
 *
 *   useRefetchOnPush({
 *     topic: rankTopic("work_item", subID, "sprint", sprintID),
 *     refetch: () => mutateList(),
 *   })
 *
 * Debounce defaults to 150ms. A burst of notifications (rebalance +
 * a follow-up move + the user's own optimistic move's confirmation)
 * collapses into a single refetch on the trailing edge.
 */

import { useEffect, useRef } from "react";
import {
  useRealtimeSubscription,
  type RealtimeMessage,
} from "@/app/hooks/useRealtimeSubscription";

export type UseRefetchOnPushOptions = {
  topic: string | null;
  refetch: () => void | Promise<void>;
  debounceMs?: number;
  /** Predicate to skip refetch for irrelevant pushes (e.g. own write echo). */
  shouldRefetch?: (msg: RealtimeMessage) => boolean;
};

export function useRefetchOnPush(opts: UseRefetchOnPushOptions) {
  const refetchRef = useRef(opts.refetch);
  refetchRef.current = opts.refetch;
  const shouldRefetchRef = useRef(opts.shouldRefetch);
  shouldRefetchRef.current = opts.shouldRefetch;
  const debounceMs = opts.debounceMs ?? 150;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useRealtimeSubscription({
    topic: opts.topic,
    onMessage: (msg) => {
      if (shouldRefetchRef.current && !shouldRefetchRef.current(msg)) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void refetchRef.current();
      }, debounceMs);
    },
  });
}
