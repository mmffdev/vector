"use client";

// useNodeMembership — FB1.3.6
//
// Checks whether the calling user is an explicit member of the given
// topology node (i.e. has a row in topology_nodes_members).
//
// Uses GET /_site/topology/{nodeId}/members (FB1.2.4 — topologyMembers
// in apiSite) and cross-references the returned user_ids against the
// caller's sentinel_user.id.
//
// 403 from the endpoint is treated as "caller is not in scope / not a
// member" — isMember: false, error: null.  Any other error surfaces via
// the `error` field so callers can decide how to handle it.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSentinel } from "@/app/sentinel";
import { topologyMembers } from "@/app/lib/apiSite";
import { ApiError } from "@/app/lib/api";

// ── Public surface ────────────────────────────────────────────────────────────

export interface UseNodeMembershipResult {
  isMember: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useNodeMembership(nodeId: string): UseNodeMembershipResult {
  const sentinel = useSentinel();

  const [isMember, setIsMember] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Stale-response guard: increment on each new fetch.
  const genRef = useRef(0);

  const check = useCallback(async (signal: AbortSignal) => {
    // Wait for sentinel to resolve before issuing any request — prevents
    // premature calls with an unresolved user identity.
    if (sentinel.sentinel_loading || !sentinel.sentinel_user) {
      return;
    }

    const callerId = sentinel.sentinel_user.id;

    genRef.current += 1;
    const myGen = genRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const members = await topologyMembers.listNodeMembers(nodeId);

      if (genRef.current !== myGen || signal.aborted) return;

      const found = members.some((m) => m.user_id === callerId);
      setIsMember(found);
    } catch (err: unknown) {
      if (signal.aborted) return;
      if (genRef.current !== myGen) return;

      // 403 = caller is out of scope for this node → treated as non-member,
      // not a reportable error (expected path for non-members per AC 1).
      if (err instanceof ApiError && err.status === 403) {
        setIsMember(false);
        setError(null);
      } else {
        setIsMember(false);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (genRef.current === myGen && !signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [nodeId, sentinel.sentinel_loading, sentinel.sentinel_user]);

  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    return () => {
      controller.abort();
    };
  }, [check]);

  // While sentinel is still booting, stay in loading state.
  const effectiveLoading = isLoading || sentinel.sentinel_loading;

  return { isMember, isLoading: effectiveLoading, error };
}
