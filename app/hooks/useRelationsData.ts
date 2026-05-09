"use client";

import { useCallback, useEffect, useState } from "react";
import type { RelationsPayload } from "@/app/api/v2/work-items/relations/route";

// The relations endpoint lives in Next.js (app/api/v2/work-items/relations/route.ts),
// not in the Go backend on :5100, so we hit it via a raw fetch rather than
// apiSite(). When B19.6.x lifts the route into Go, switch to apiSite.
const RELATIONS_PATH = "/api/v2/work-items/relations";

export type UseRelationsDataResult = {
  data: RelationsPayload | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

export function useRelationsData(): UseRelationsDataResult {
  const [data, setData] = useState<RelationsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(RELATIONS_PATH, { credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as RelationsPayload;
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
