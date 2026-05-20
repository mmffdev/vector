"use client";

/**
 * NotificationBell — the in-app bell + dropdown.
 *
 * Scaffold for B11.4 / B11.5. Not yet placed in the chrome — drop
 * this into the user avatar menu or the top-right of the page shell
 * when the visual layout is decided.
 *
 * Backend: /_site/notifications (list + unread-count + mark-read).
 * Real-time nudges arrive on the topic "notifications:<user_id>" via
 * the existing realtime hub — the useNotificationsStream hook
 * subscribes when the bell is mounted and triggers refetch on each
 * nudge.
 *
 * Each notification row is server-built (title + body resolved from
 * notifications.Templates at delivery time); the client renders what
 * the backend gave it without re-templating.
 */

import { useCallback, useEffect, useState } from "react";

import { notifications, type UserNotification } from "../lib/apiSite";

import { useNotificationsStream } from "../hooks/useNotificationsStream";

const POLL_FALLBACK_MS = 60_000; // safety net when SSE/WS is down

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await notifications.unreadCount();
      setUnread(res.unread);
    } catch {
      // Silent — bell counter is non-critical UI.
    }
  }, []);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await notifications.list(false, 50);
      setItems(res.notifications);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + periodic poll fallback.
  useEffect(() => {
    refreshCount();
    const id = window.setInterval(refreshCount, POLL_FALLBACK_MS);
    return () => window.clearInterval(id);
  }, [refreshCount]);

  // Real-time nudges. The hook resolves to a no-op when the stream
  // can't connect, so the polling above is the safety net.
  useNotificationsStream(() => {
    refreshCount();
    if (open) refreshList();
  });

  // Refetch list when the dropdown opens.
  useEffect(() => {
    if (open) refreshList();
  }, [open, refreshList]);

  async function handleMarkRead(id: string) {
    try {
      await notifications.markRead(id);
      setItems((prev) =>
        prev.map((n) =>
          n.users_notifications_id === id
            ? { ...n, users_notifications_read_at: new Date().toISOString() }
            : n,
        ),
      );
      refreshCount();
    } catch {
      // Non-critical; UI will reconverge on next refresh.
    }
  }

  async function handleMarkAllRead() {
    try {
      await notifications.markAllRead();
      setItems((prev) =>
        prev.map((n) => ({ ...n, users_notifications_read_at: new Date().toISOString() })),
      );
      setUnread(0);
    } catch {
      // Non-critical.
    }
  }

  return (
    <div className="notification-bell">
      <button
        type="button"
        className="btn btn--ghost notification-bell__Trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="pill pill--accent notification-bell__Trigger_badge">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="notification-bell__Panel" role="dialog" aria-label="Notifications">
          <div className="notification-bell__Panel_Header">
            <span className="notification-bell__Panel_Header_title">Notifications</span>
            <button
              type="button"
              className="btn btn--ghost notification-bell__Panel_Header_mark-all"
              onClick={handleMarkAllRead}
              disabled={unread === 0}
            >
              Mark all read
            </button>
          </div>

          <div className="notification-bell__Panel_List" role="list">
            {loading && <div className="notification-bell__Panel_state">Loading…</div>}
            {error && (
              <div className="notification-bell__Panel_state is-error">{error}</div>
            )}
            {!loading && !error && items.length === 0 && (
              <div className="notification-bell__Panel_state">No notifications.</div>
            )}
            {items.map((n) => {
              const unread = !n.users_notifications_read_at;
              return (
                <button
                  key={n.users_notifications_id}
                  type="button"
                  role="listitem"
                  className={`notification-bell__Panel_List_item${unread ? " is-unread" : ""}`}
                  onClick={() => handleMarkRead(n.users_notifications_id)}
                >
                  <span className="notification-bell__Panel_List_item-title">
                    {n.users_notifications_title}
                  </span>
                  {n.users_notifications_body && (
                    <span className="notification-bell__Panel_List_item-body">
                      {n.users_notifications_body}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
