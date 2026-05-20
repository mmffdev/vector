"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workItems, portfolioItems } from "@/app/lib/apiSite";
import type { ArtefactDetail } from "./types";

interface UseArtefactInlineParams {
  artefactId: string | null;
  resourceUrl: string; // "/work-items" | "/portfolio-items"
  onSaved?: (body: Record<string, unknown>) => void;
}

interface UseArtefactInlineResult {
  artefact: ArtefactDetail | null;
  loading: boolean;
  error: string | null;
  patch: (body: Record<string, unknown>) => Promise<void>;
}

// Picks the right apiSite bundle. The two surfaces share a backend
// handler (artefactitems) so the wire shape is identical — only the
// URL prefix differs.
function pickBundle(resourceUrl: string) {
  if (resourceUrl.includes("/portfolio-items")) return portfolioItems;
  return workItems;
}

export function useArtefactInline({
  artefactId,
  resourceUrl,
  onSaved,
}: UseArtefactInlineParams): UseArtefactInlineResult {
  const [artefact, setArtefact] = useState<ArtefactDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!artefactId) {
      setArtefact(null);
      setError(null);
      return;
    }
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);

    const bundle = pickBundle(resourceUrl);
    bundle
      .get(artefactId)
      .then((data) => {
        if (reqIdRef.current !== myId) return;
        setArtefact(data as ArtefactDetail);
      })
      .catch((e: unknown) => {
        if (reqIdRef.current !== myId) return;
        setError(e instanceof Error ? e.message : "Failed to load artefact");
      })
      .finally(() => {
        if (reqIdRef.current !== myId) return;
        setLoading(false);
      });
  }, [artefactId, resourceUrl]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      if (!artefactId) return;
      const bundle = pickBundle(resourceUrl);
      try {
        const updated = (await bundle.patch(artefactId, body)) as ArtefactDetail;
        setArtefact(updated);
        onSaved?.(body);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    },
    [artefactId, resourceUrl, onSaved],
  );

  return { artefact, loading, error, patch };
}
