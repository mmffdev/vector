"use client";

// /user/notifications/notifications — Notifications inbox.
//
// Strawman implementation (B11.4 follow-up). Inbox-style list of
// user_notifications rows for the signed-in user. Two-line cards,
// toolbar with search + filters + mark-all-read, client-side
// pagination over a single fetched batch.
//
// Filtering + search are intentionally client-side on the
// pre-fetched batch (limit=200) — keeps this slice to one round
// trip and lets us shape the UX without committing to a server
// surface. Move filtering server-side when volumes justify it.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { notifications, type UserNotification } from "@/app/lib/apiSite";

const PAGE_SIZE = 20;
const FETCH_LIMIT = 200;

type WhenFilter = "any" | "today" | "week" | "older";
type UnreadFilter = "all" | "unread" | "read";

export default function NotificationsListPage() {
  const [rows, setRows] = useState<UserNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Toolbar state.
  const [search, setSearch] = useState("");
  const [unreadFilter, setUnreadFilter] = useState<UnreadFilter>("all");
  // Tag is the bucket added by migration 236; falls back to kind for
  // pre-migration rows where tag was backfilled to match kind.
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [whenFilter, setWhenFilter] = useState<WhenFilter>("any");
  const [page, setPage] = useState(1);

  // Fetch the batch once on mount + on demand after mark-read actions.
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await notifications.list(false, FETCH_LIMIT);
      setRows(res.notifications);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications.");
      setRows([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tags that actually appear in the data — drives the filter chip
  // so we don't list buckets the user never receives. Falls back to
  // kind when tag is NULL (pre-migration-236 rows).
  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    (rows ?? []).forEach((r) => {
      const t =
        (r as { users_notifications_tag?: string | null }).users_notifications_tag ??
        r.users_notifications_kind;
      if (t) set.add(t);
    });
    return ["all", ...Array.from(set).sort()];
  }, [rows]);

  // Apply toolbar filters + search to the in-memory batch.
  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const dayMs = 86400_000;
    return rows.filter((r) => {
      const isUnread = !r.users_notifications_read_at;
      if (unreadFilter === "unread" && !isUnread) return false;
      if (unreadFilter === "read" && isUnread) return false;
      if (tagFilter !== "all") {
        const t =
          (r as { users_notifications_tag?: string | null }).users_notifications_tag ??
          r.users_notifications_kind;
        if (t !== tagFilter) return false;
      }
      if (whenFilter !== "any") {
        const age = now - new Date(r.users_notifications_created_at).getTime();
        if (whenFilter === "today" && age > dayMs) return false;
        if (whenFilter === "week" && age > 7 * dayMs) return false;
        if (whenFilter === "older" && age <= 7 * dayMs) return false;
      }
      if (q) {
        const hay = [
          r.users_notifications_title,
          r.users_notifications_body,
          r.users_notifications_context_label ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, unreadFilter, tagFilter, whenFilter]);

  // Page-window the filtered set.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  // Reset to page 1 whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [search, unreadFilter, tagFilter, whenFilter]);

  const unreadCount = useMemo(
    () => (rows ?? []).filter((r) => !r.users_notifications_read_at).length,
    [rows],
  );

  async function handleMarkRead(id: string) {
    try {
      await notifications.markRead(id);
      setRows((prev) =>
        prev
          ? prev.map((r) =>
              r.users_notifications_id === id
                ? { ...r, users_notifications_read_at: new Date().toISOString() }
                : r,
            )
          : prev,
      );
    } catch {
      // Silent; user can refresh.
    }
  }

  async function handleMarkAllRead() {
    if (unreadCount === 0) return;
    try {
      await notifications.markAllRead();
      const now = new Date().toISOString();
      setRows((prev) =>
        prev
          ? prev.map((r) =>
              r.users_notifications_read_at
                ? r
                : { ...r, users_notifications_read_at: now },
            )
          : prev,
      );
    } catch {
      // Silent.
    }
  }

  return (
    <PageContent>
      <StrictRoute>
        <PageDescription>
          Your notifications inbox. Mentions, library updates, and other events land here — click any row to jump to its context.
        </PageDescription>

        <Panel
          name="panel_notifications_inbox"
          title="Inbox"
          description={
            rows === null
              ? "Loading…"
              : `${rows.length} notification${rows.length === 1 ? "" : "s"} · ${unreadCount} unread`
          }
        >
          {/* Toolbar — mirrors the shape used by Table.toolbar */}
          <div className="toolbar">
            <input
              type="search"
              className="form__input form__input--sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications…"
              aria-label="Search notifications"
            />
            <label className="u-row u-row--gap-2">
              <span>Status</span>
              <select
                className="form__select form__select--sm"
                value={unreadFilter}
                onChange={(e) => setUnreadFilter(e.target.value as UnreadFilter)}
              >
                <option value="all">All</option>
                <option value="unread">Unread only</option>
                <option value="read">Read only</option>
              </select>
            </label>
            <label className="u-row u-row--gap-2">
              <span>Tag</span>
              <select
                className="form__select form__select--sm"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                {tagOptions.map((k) => (
                  <option key={k} value={k}>
                    {k === "all" ? "All tags" : k}
                  </option>
                ))}
              </select>
            </label>
            <label className="u-row u-row--gap-2">
              <span>When</span>
              <select
                className="form__select form__select--sm"
                value={whenFilter}
                onChange={(e) => setWhenFilter(e.target.value as WhenFilter)}
              >
                <option value="any">Any time</option>
                <option value="today">Last 24 hours</option>
                <option value="week">Last 7 days</option>
                <option value="older">Older than 7 days</option>
              </select>
            </label>
            <div className="toolbar__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleMarkAllRead}
                disabled={unreadCount === 0}
              >
                Mark all read
              </button>
              <Link
                href="/user/notifications/settings"
                className="btn btn--ghost"
              >
                Settings
              </Link>
            </div>
          </div>

          {/* List */}
          <ul className="notifications-inbox__list" role="list">
            {error && (
              <li className="notifications-inbox__state is-error">{error}</li>
            )}
            {rows === null && (
              <li className="notifications-inbox__state">Loading…</li>
            )}
            {rows !== null && filtered.length === 0 && !error && (
              <li className="notifications-inbox__state">
                {rows.length === 0
                  ? "No notifications yet."
                  : "No notifications match your filters."}
              </li>
            )}
            {pageRows.map((n) => (
              <NotificationCard
                key={n.users_notifications_id}
                row={n}
                onMarkRead={handleMarkRead}
              />
            ))}
          </ul>

          {/* Pagination */}
          {filtered.length > PAGE_SIZE && (
            <div className="notifications-inbox__pagination">
              <span className="notifications-inbox__pagination_meta">
                Page {safePage} of {totalPages} · {filtered.length} result
                {filtered.length === 1 ? "" : "s"}
              </span>
              <div className="notifications-inbox__pagination_controls">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </Panel>
      </StrictRoute>
    </PageContent>
  );
}

// ─── Per-row card ───────────────────────────────────────────────

interface CardProps {
  row: UserNotification;
  onMarkRead: (id: string) => void;
}

function NotificationCard({ row, onMarkRead }: CardProps) {
  const isUnread = !row.users_notifications_read_at;
  const href = contextHref(row);

  function handleClick() {
    if (isUnread) onMarkRead(row.users_notifications_id);
  }

  const Inner = (
    <>
      <div className="notifications-inbox__item_Lead">
        <span
          className={`notifications-inbox__item_Lead_dot${isUnread ? " is-unread" : ""}`}
          aria-hidden="true"
        />
        <span className={`pill pill--${pillToneForKind(row.users_notifications_kind)} notifications-inbox__item_Lead_kind`}>
          {row.users_notifications_kind}
        </span>
      </div>

      <div className="notifications-inbox__item_Body">
        <div className="notifications-inbox__item_Body_TitleRow">
          <span className="notifications-inbox__item_Body_title">
            {row.users_notifications_title}
          </span>
          <time
            className="notifications-inbox__item_Body_time"
            dateTime={row.users_notifications_created_at}
            title={new Date(row.users_notifications_created_at).toLocaleString()}
          >
            {formatRelative(row.users_notifications_created_at)}
          </time>
        </div>
        {row.users_notifications_body && (
          <div className="notifications-inbox__item_Body_snippet">
            {row.users_notifications_body}
          </div>
        )}
        {row.users_notifications_context_label && (
          <div className="notifications-inbox__item_Body_context">
            <span className="pill pill--neutral">
              {row.users_notifications_context_label}
            </span>
          </div>
        )}
      </div>

      <div className="notifications-inbox__item_Trail">
        {isUnread && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMarkRead(row.users_notifications_id);
            }}
            aria-label="Mark this notification as read"
          >
            Mark read
          </button>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <li className={`notifications-inbox__item${isUnread ? " is-unread" : ""}`}>
        <Link href={href} className="notifications-inbox__item_link" onClick={handleClick}>
          {Inner}
        </Link>
      </li>
    );
  }
  return (
    <li className={`notifications-inbox__item${isUnread ? " is-unread" : ""}`}>
      <div
        className="notifications-inbox__item_link"
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick();
        }}
      >
        {Inner}
      </div>
    </li>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function contextHref(n: UserNotification): string | null {
  const kind = n.users_notifications_context_kind;
  const id = n.users_notifications_context_id;
  if (!kind || !id) return null;
  switch (kind) {
    case "defect":
    case "story":
    case "task":
    case "risk":
      return `/work-items?focus=${encodeURIComponent(id)}`;
    case "library_release":
      return `/library-releases`;
    default:
      return null;
  }
}

function pillToneForKind(kind: string): string {
  switch (kind) {
    case "mention":
      return "info";
    case "library_release":
      return "success";
    case "assignment":
      return "warning";
    default:
      return "neutral";
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
