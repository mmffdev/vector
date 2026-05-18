"use client";

// B16.8.10 — Active sessions UI.
//
// Shows every live session the user holds, marks the current one
// (matched on the JWT's sid claim, returned as is_current by the
// backend), lets the user revoke any non-current session or "log out
// all other sessions" in one action.
//
// Threat-model anchor: the per-request session check from B16.8.11
// step 3 means revocation here takes effect on the next request the
// target device makes — typically <1s in practice.

import { useCallback, useEffect, useMemo, useState } from "react";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import Table, { type Column } from "@/app/components/Table";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { apiSite as api, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

interface SessionRow {
  id: string;
  created_at: string;
  last_activity_at: string;
  ip_address?: string;
  user_agent?: string;
  is_current: boolean;
}

interface ListResp {
  sessions: SessionRow[];
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

// Short-form user agent. Browser detection is imperfect on the wire
// (UA strings lie) — this is best-effort labelling for "is this me?",
// not a security signal.
function shortUA(ua?: string): string {
  if (!ua) return "Unknown device";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
  if (ua.startsWith("curl/")) return "curl";
  return ua.slice(0, 40) + (ua.length > 40 ? "…" : "");
}

export default function SessionsPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const res = await api<ListResp>("/auth/sessions");
      setSessions(res.sessions ?? []);
    } catch (e) {
      setLoadErr(e instanceof ApiError ? (e.detail ?? "Failed to load sessions") : "Failed to load sessions");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revokeOne = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      // Optimistic: remove the row locally rather than re-fetch.
      setSessions((prev) => (prev ?? []).filter((s) => s.id !== id));
      notify.success("Session revoked.");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 404) {
        // Already gone — fold into the optimistic path.
        setSessions((prev) => (prev ?? []).filter((s) => s.id !== id));
      } else {
        notify.error("Could not revoke session. Please try again.");
      }
    } finally {
      setBusyId(null);
    }
  }, []);

  const revokeOthers = useCallback(async () => {
    if (!confirm("Sign out everywhere except this device?")) return;
    setRevokingOthers(true);
    try {
      await api("/auth/sessions/revoke-others", { method: "POST" });
      setSessions((prev) => (prev ?? []).filter((s) => s.is_current));
      notify.success("Other sessions signed out.");
    } catch {
      notify.error("Could not sign out other sessions. Please try again.");
    } finally {
      setRevokingOthers(false);
    }
  }, []);

  const columns = useMemo<Column<SessionRow>[]>(() => [
    {
      key: "device",
      header: "Device",
      kind: "custom",
      render: (s) => (
        <>
          {shortUA(s.user_agent)}
          {s.is_current && <span className="pill pill--success" style={{ marginLeft: 8 }}>This session</span>}
        </>
      ),
    },
    {
      key: "ip",
      header: "IP",
      kind: "mono",
      render: (s) => <>{s.ip_address ?? "—"}</>,
    },
    {
      key: "created_at",
      header: "Started",
      render: (s) => <>{fmtTime(s.created_at)}</>,
    },
    {
      key: "last_activity_at",
      header: "Last activity",
      render: (s) => <>{fmtTime(s.last_activity_at)}</>,
    },
    {
      key: "revoke",
      header: "",
      kind: "center",
      render: (s) => (
        <button
          className="btn btn--ghost"
          onClick={() => revokeOne(s.id)}
          disabled={s.is_current || busyId === s.id}
          title={s.is_current ? "Use Sign out to end this session" : "Revoke this session"}
        >
          {busyId === s.id ? "Revoking…" : "Revoke"}
        </button>
      ),
    },
  ], [busyId, revokeOne]);

  if (!user) return null;

  const otherCount = (sessions ?? []).filter((s) => !s.is_current).length;

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="See and manage every device signed in to your account." />
      <PageDescription>
        Each row below is an active session — a browser or device that holds a refresh token issued under your account. Revoke any you don't recognise. The current device shows a marker; you can't revoke it from here (use Sign out instead).
      </PageDescription>

      <Panel
        name="panel_sessions_list"
        title="Active sessions"
        description="Sessions are removed automatically when you sign out, when they idle past 30 minutes, or when a refresh token expires (default 7 days)."
      >
        {loadErr && <div className="login__error is-visible" role="alert">{loadErr}</div>}

        {!loadErr && (
          <>
            <div className="u-mb-4" style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn btn--secondary"
                onClick={revokeOthers}
                disabled={revokingOthers || otherCount === 0 || sessions === null}
              >
                {revokingOthers ? "Signing out…" : `Sign out all other sessions${otherCount > 0 ? ` (${otherCount})` : ""}`}
              </button>
            </div>

            <Table<SessionRow>
              pageId="account-settings.sessions"
              slot="active-sessions"
              ariaLabel="Active sessions"
              columns={columns}
              rows={sessions}
              rowKey={(s) => s.id}
              loading={sessions === null}
              empty="No active sessions."
              noScroll
            />
          </>
        )}
      </Panel>
    </PageContent>
  );
}
