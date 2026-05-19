"use client";

// PLA-0008 / 00327 — /help/<addressable_id> full-page help route.
//
// Renders a HelpDoc in its full variant for any addressable in the
// substrate. Linked to from every Panel popover ("Open full help page →"),
// shareable as a URL. No auth gate — help copy is public-by-design (the
// substrate already gates read at the addressable level).
//
// 404 if the addressable does not exist; empty-state if it exists but
// has no help body yet.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import HelpDocRenderer, { type HelpDoc } from "@/app/components/HelpDocRenderer";
import { apiSite, ApiError } from "@/app/lib/api";

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; doc: HelpDoc }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export default function HelpPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({ kind: "loading" });
    apiSite<Partial<HelpDoc>>(`/page-help/${encodeURIComponent(id)}`)
      .then((data) => {
        if (cancelled) return;
        setState({
          kind: "ready",
          doc: {
            addressable_id: id,
            title: data.title ?? null,
            body_html: data.body_html ?? "",
            video_embeds: data.video_embeds ?? [],
            image_urls: data.image_urls ?? [],
          },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: "not_found" });
          return;
        }
        if (err instanceof ApiError) {
          setState({ kind: "error", message: `HTTP ${err.status}` });
          return;
        }
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <main className="help-page">
      <div className="help-page__inner">
        {state.kind === "loading" ? (
          <p className="help-page__status">Loading help…</p>
        ) : state.kind === "not_found" ? (
          <div className="help-page__status">
            <h1 className="help-page__heading">Help page not found</h1>
            <p>
              The element <code className="help-page__id">{id}</code> is not
              registered in the addressable substrate.
            </p>
          </div>
        ) : state.kind === "error" ? (
          <div className="help-page__status">
            <h1 className="help-page__heading">Help unavailable</h1>
            <p>Could not load help: {state.message}</p>
          </div>
        ) : (
          <>
            <HelpDocRenderer
              doc={state.doc}
              variant="full"
              showOpenFullLink={false}
              emptyState={
                <p className="help-page__status">
                  No help has been written for this element yet.
                </p>
              }
            />
            <p className="help-page__id-line">
              Address: <code className="help-page__id">{id}</code>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
