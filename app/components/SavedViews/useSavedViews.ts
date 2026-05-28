"use client";

// useSavedViews — headless state machine + apiSite calls for the
// saved-views substrate. Schema-agnostic about the view body: callers
// pass a body when saving, receive it when loading, never expose the
// hook to its interior.
//
// Pattern mirrors useFieldsForType + useColumnCatalogue — apiSite
// helper, cancelled flag for unmount safety, error-string
// normalisation.
//
// Spec: docs/superpowers/specs/2026-05-28-saved-views-design.md §11

import { useCallback, useEffect, useState } from "react";
import { apiSite } from "@/app/lib/api";
import type {
  View,
  ListResponse,
  Kind,
  CreateRequest,
  UpdateBodyRequest,
  UpdateScopeRequest,
} from "./types";

export interface UseSavedViewsParams {
  kind: Kind;
  target: string;
}

export interface UseSavedViewsResult {
  views: View[];
  activeView: View | null;
  loading: boolean;
  error: string | null;
  // Activate a view by ID; caller reads activeView.saved_views_body
  loadView: (viewID: string) => void;
  clearView: () => void;
  // Reload the list from the server (after writes invalidate)
  refresh: () => Promise<void>;
  // Writes — all return the new/updated view on success
  saveChanges: (req: UpdateBodyRequest) => Promise<View>;
  saveAsNew: (req: Omit<CreateRequest, "kind" | "target">) => Promise<View>;
  deleteView: (viewID: string) => Promise<void>;
  renameView: (viewID: string, name: string) => Promise<View>;
  updateScope: (viewID: string, req: UpdateScopeRequest) => Promise<View>;
}

export function useSavedViews(params: UseSavedViewsParams): UseSavedViewsResult {
  const { kind, target } = params;

  const [views, setViews] = useState<View[]>([]);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiSite<ListResponse>(
        `/saved-views?kind=${encodeURIComponent(kind)}&target=${encodeURIComponent(target)}`,
      );
      setViews(res.views ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load saved views");
    } finally {
      setLoading(false);
    }
  }, [kind, target]);

  useEffect(() => {
    let cancelled = false;
    if (!kind || !target) return;
    setLoading(true);
    setError(null);
    apiSite<ListResponse>(
      `/saved-views?kind=${encodeURIComponent(kind)}&target=${encodeURIComponent(target)}`,
    )
      .then((res) => {
        if (cancelled) return;
        setViews(res.views ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load saved views");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, target]);

  const activeView = activeID ? (views.find((v) => v.saved_views_id === activeID) ?? null) : null;

  const loadView = useCallback((viewID: string) => {
    setActiveID(viewID);
  }, []);

  const clearView = useCallback(() => {
    setActiveID(null);
  }, []);

  const saveChanges = useCallback(
    async (req: UpdateBodyRequest) => {
      if (!activeID) throw new Error("No active view to save");
      const updated = await apiSite<View>(`/saved-views/${activeID}`, {
        method: "PATCH",
        body: JSON.stringify(req),
      });
      await fetchList();
      return updated;
    },
    [activeID, fetchList],
  );

  const saveAsNew = useCallback(
    async (req: Omit<CreateRequest, "kind" | "target">) => {
      const created = await apiSite<View>(`/saved-views`, {
        method: "POST",
        body: JSON.stringify({ ...req, kind, target } as CreateRequest),
      });
      await fetchList();
      setActiveID(created.saved_views_id);
      return created;
    },
    [kind, target, fetchList],
  );

  const deleteView = useCallback(
    async (viewID: string) => {
      await apiSite<void>(`/saved-views/${viewID}`, { method: "DELETE" });
      if (activeID === viewID) setActiveID(null);
      await fetchList();
    },
    [activeID, fetchList],
  );

  const renameView = useCallback(
    async (viewID: string, name: string) => {
      const updated = await apiSite<View>(`/saved-views/${viewID}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await fetchList();
      return updated;
    },
    [fetchList],
  );

  const updateScope = useCallback(
    async (viewID: string, req: UpdateScopeRequest) => {
      const updated = await apiSite<View>(`/saved-views/${viewID}/scope`, {
        method: "PATCH",
        body: JSON.stringify(req),
      });
      await fetchList();
      return updated;
    },
    [fetchList],
  );

  return {
    views,
    activeView,
    loading,
    error,
    loadView,
    clearView,
    refresh: fetchList,
    saveChanges,
    saveAsNew,
    deleteView,
    renameView,
    updateScope,
  };
}
