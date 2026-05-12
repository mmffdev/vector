"use client";

/**
 * /library-releases — Phase 3 of the mmff_library plan, §12.
 *
 * Gadmin-only page that lists outstanding releases from the library
 * channel and lets the gadmin acknowledge each on behalf of the
 * subscription. Severity controls visual treatment per plan §12.6:
 *   info     — neutral background, single dismiss action
 *   action   — yellow accent, primary CTA + dismiss
 *   breaking — red accent, primary CTA only (no dismiss; gadmin must act)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { apiSite as api } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

type Severity = "info" | "action" | "breaking";

interface ActionDTO {
  id: string;
  action_key: "upgrade_model" | "review_terminology" | "enable_flag" | "dismissed";
  label: string;
  payload: Record<string, unknown> | null;
  sort_order: number;
}

interface ReleaseDTO {
  id: string;
  library_version: string;
  title: string;
  summary_md: string;
  body_md: string | null;
  severity: Severity;
  affects_model_family_id: string | null;
  released_at: string;
  expires_at: string | null;
  actions: ActionDTO[];
}

interface ListResponse {
  count: number;
  releases: ReleaseDTO[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; releases: ReleaseDTO[] };

export default function LibraryReleasesPage() {
  const { user } = useAuth();
  const canViewReleases = useHasPermission("library.releases.view");
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [acking, setAcking] = useState<string | null>(null);

  useEffect(() => {
    if (user && !canViewReleases) router.replace("/dashboard");
  }, [user, canViewReleases, router]);

  useEffect(() => {
    if (!user || !canViewReleases) return;
    void loadReleases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, canViewReleases]);

  async function loadReleases() {
    setState({ kind: "loading" });
    try {
      const data = await api<ListResponse>("/library/releases");
      setState({ kind: "ready", releases: data.releases });
    } catch (e) {
      notify.apiError(e, "Failed to load releases");
      setState({ kind: "error", message: "Failed to load releases" });
    }
  }

  async function ack(releaseId: string, actionKey: ActionDTO["action_key"]) {
    setAcking(releaseId);
    try {
      await api(`/library/releases/${releaseId}/ack`, {
        method: "POST",
        body: JSON.stringify({ action_taken: actionKey }),
      });
      notify.success("Release acknowledged.");
      // Drop the acked release from the list locally — avoids the round trip.
      if (state.kind === "ready") {
        setState({
          kind: "ready",
          releases: state.releases.filter((r) => r.id !== releaseId),
        });
      }
    } catch (e) {
      notify.apiError(e, "Failed to acknowledge release");
    } finally {
      setAcking(null);
    }
  }

  if (!user || !canViewReleases) return null;

  return (
    <PageContent>
    <StrictRoute>
      <Panel name="library_releases_outstanding" title="Outstanding releases">
        {state.kind === "loading" && (
          <div className="placeholder">
            <h3 className="placeholder__title">Loading…</h3>
          </div>
        )}
        {state.kind === "error" && <div className="form__error">{state.message}</div>}
        {state.kind === "ready" && state.releases.length === 0 && (
          <div className="placeholder">
            <h3 className="placeholder__title">All caught up</h3>
            <p className="placeholder__body">No outstanding library releases.</p>
          </div>
        )}
        {state.kind === "ready" && state.releases.length > 0 && (
          <Table<ReleaseDTO>
            pageId="library-releases"
            slot="outstanding"
            ariaLabel="Outstanding releases"
            rows={state.releases}
            rowKey={(r) => r.id}
            columns={[
              {
                key: "library_version",
                header: "Version",
                width: 120,
                kind: "mono",
                render: (r) => `v${r.library_version}`,
              },
              {
                key: "title",
                header: "Title",
                kind: "custom",
                render: (r) => (
                  <>
                    <div>{r.title}</div>
                    <div className="release-row__summary">{r.summary_md}</div>
                  </>
                ),
              },
              {
                key: "severity",
                header: "Severity",
                width: 130,
                kind: "pill",
                pillVariant: (r) =>
                  r.severity === "breaking"
                    ? "danger"
                    : r.severity === "action"
                    ? "warning"
                    : "info",
                pillLabel: (r) => r.severity.toUpperCase(),
              },
              {
                key: "released_at",
                header: "Released",
                width: 140,
                kind: "custom",
                render: (r) => new Date(r.released_at).toLocaleDateString(),
              },
              {
                key: "action",
                header: "Action",
                width: 160,
                kind: "custom",
                render: (r) => {
                  const sortedActions = [...r.actions].sort(
                    (a, b) => a.sort_order - b.sort_order
                  );
                  const primaryAction = sortedActions[0];
                  return (
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={acking === r.id}
                      onClick={() =>
                        ack(r.id, primaryAction?.action_key ?? "dismissed")
                      }
                    >
                      {acking === r.id
                        ? "Acknowledging…"
                        : primaryAction?.label ?? "Acknowledge"}
                    </button>
                  );
                },
              },
            ]}
          />
        )}
      </Panel>
    </StrictRoute>
    </PageContent>
  );
}

