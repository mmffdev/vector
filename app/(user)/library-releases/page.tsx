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
import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";
import { api, ApiError } from "@/app/lib/api";

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
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [acking, setAcking] = useState<string | null>(null);

  // Role gate: only gadmin sees this page. Others bounce to dashboard.
  useEffect(() => {
    if (user && user.role !== "gadmin") router.replace("/dashboard");
  }, [user, router]);

  useEffect(() => {
    if (!user || user.role !== "gadmin") return;
    void loadReleases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadReleases() {
    setState({ kind: "loading" });
    try {
      const data = await api<ListResponse>("/api/library/releases");
      setState({ kind: "ready", releases: data.releases });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `Error ${e.status}: ${typeof e.body === "string" ? e.body : "request failed"}`
          : "Failed to load releases";
      setState({ kind: "error", message: msg });
    }
  }

  async function ack(releaseId: string, actionKey: ActionDTO["action_key"]) {
    setAcking(releaseId);
    try {
      await api(`/api/library/releases/${releaseId}/ack`, {
        method: "POST",
        body: JSON.stringify({ action_taken: actionKey }),
      });
      // Drop the acked release from the list locally — avoids the round trip.
      if (state.kind === "ready") {
        setState({
          kind: "ready",
          releases: state.releases.filter((r) => r.id !== releaseId),
        });
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `Error ${e.status}: ${typeof e.body === "string" ? e.body : "ack failed"}`
          : "Acknowledgement failed";
      // Surface the error inline so the user sees what happened.
      alert(msg);
    } finally {
      setAcking(null);
    }
  }

  if (!user || user.role !== "gadmin") return null;

  return (
    <PageShell
      title="Library Releases"
      subtitle="Acknowledge updates published to the MMFF library on behalf of your subscription"
    >
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
        // Story 00099 — list rendered as a Vector table. Surface +
        // 1px --border + --radius-lg from .table-wrap; sunken thead
        // with eyebrow column heads + 48px rows from the base
        // .table block. Severity uses .pill variants per AC:
        // CRITICAL/breaking=danger, action=warning, info=info,
        // unknown/low=neutral.
        <div className="table-wrap">
          <table className="table">
            <thead className="table__head">
              <tr className="table__row">
                <th className="table__cell">Version</th>
                <th className="table__cell">Title</th>
                <th className="table__cell">Severity</th>
                <th className="table__cell">Released</th>
                <th className="table__cell" style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {state.releases.map((r) => (
                <ReleaseRow
                  key={r.id}
                  release={r}
                  acking={acking === r.id}
                  onAck={ack}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}

function severityPillClass(s: Severity): string {
  switch (s) {
    case "breaking":
      return "pill--danger";
    case "action":
      return "pill--warning";
    case "info":
    default:
      return "pill--info";
  }
}

function ReleaseRow({
  release,
  acking,
  onAck,
}: {
  release: ReleaseDTO;
  acking: boolean;
  onAck: (releaseId: string, actionKey: ActionDTO["action_key"]) => void;
}) {
  const sortedActions = [...release.actions].sort(
    (a, b) => a.sort_order - b.sort_order
  );
  const primaryAction = sortedActions[0];
  const releasedAt = new Date(release.released_at).toLocaleDateString();

  return (
    <tr className="table__row">
      <td className="table__cell t-mono">v{release.library_version}</td>
      <td className="table__cell">
        <div style={{ color: "var(--ink)" }}>{release.title}</div>
        <div style={{ color: "var(--ink-muted)", fontSize: "var(--text-xs)" }}>
          {release.summary_md}
        </div>
      </td>
      <td className="table__cell">
        <span className={`pill ${severityPillClass(release.severity)}`}>
          {release.severity.toUpperCase()}
        </span>
      </td>
      <td className="table__cell table__cell--muted">{releasedAt}</td>
      <td className="table__cell" style={{ textAlign: "right" }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={acking}
          onClick={() =>
            onAck(release.id, primaryAction?.action_key ?? "dismissed")
          }
        >
          {acking ? "Acknowledging…" : (primaryAction?.label ?? "Acknowledge")}
        </button>
      </td>
    </tr>
  );
}
