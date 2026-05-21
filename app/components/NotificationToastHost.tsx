"use client";

/**
 * NotificationToastHost — top-right stack of incoming notification
 * toasts. Mounted once in the shell. Listens on the SSE stream via
 * useNotificationsStream; on each nudge, fetches the newest unread
 * row from the API and pushes a toast onto the stack.
 *
 * Stack rules (handover_rmq.md § design choices):
 *  - Max 3 visible at once; older overflow collapses to "+N more"
 *  - 5s auto-dismiss; pauses on hover
 *  - Click toast → navigate to context + auto-mark-read
 *  - Slide in from the right; stack downward
 *
 * Why this is a separate component from NotificationBell: the bell
 * lives inside the rail and only owns the count. The toast lives
 * over the page chrome and reacts to live arrivals. They both read
 * the same data but render different surfaces.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/app/contexts/AuthContext";
import { notifications, type UserNotification } from "@/app/lib/apiSite";

import { useNotificationsStream } from "../hooks/useNotificationsStream";

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 5000;

interface Toast {
  /** Stable identity so React keys + dismiss-by-id work. */
  id: string;
  notification: UserNotification;
  /** Wall-clock when this toast was created (for auto-dismiss timer). */
  shownAt: number;
}

export default function NotificationToastHost() {
  const { user } = useAuth();
  const [stack, setStack] = useState<Toast[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Seen-set so a single SSE nudge doesn't re-toast on every poll.
  // We track which notification IDs we've already pushed to the stack
  // (or seen historically). Drops to a snapshot of latest unread IDs
  // on first load so existing notifications don't auto-toast.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  // On mount, seed the seen-set with whatever unread already exists,
  // so we only toast for *new* arrivals after this point.
  useEffect(() => {
    if (!user || seededRef.current) return;
    seededRef.current = true;
    void notifications.list(true, 50).then((res) => {
      res.notifications.forEach((n) => seenIdsRef.current.add(n.users_notifications_id));
    }).catch(() => {
      // Silent — if seeding fails the first nudge toast may be a
      // historical row, which is recoverable (user can dismiss).
    });
  }, [user]);

  // Fetch latest unread + push any unseen rows as toasts.
  const ingest = useCallback(async () => {
    try {
      const res = await notifications.list(true, 10);
      const fresh: Toast[] = [];
      // Iterate newest → oldest; if anything is unseen, queue it.
      for (const n of res.notifications) {
        if (seenIdsRef.current.has(n.users_notifications_id)) continue;
        seenIdsRef.current.add(n.users_notifications_id);
        fresh.push({
          id: n.users_notifications_id,
          notification: n,
          shownAt: Date.now(),
        });
      }
      if (fresh.length === 0) return;
      // Newest fresh row appears on top of the stack.
      setStack((prev) => [...fresh.reverse(), ...prev]);
    } catch {
      // Silent — toast is supplemental UX.
    }
  }, []);

  // Subscribe to SSE; ingest on each notification.created nudge.
  useNotificationsStream((event) => {
    if (event.type === "notification.created") {
      void ingest();
    }
  });

  // Auto-dismiss timer. Each toast has its own timeout; hover pauses
  // by skipping the dismiss while hoveredId matches.
  useEffect(() => {
    if (stack.length === 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setStack((prev) =>
        prev.filter((t) => {
          if (t.id === hoveredId) return true; // paused
          return now - t.shownAt < AUTO_DISMISS_MS;
        }),
      );
    }, 500);
    return () => window.clearInterval(id);
  }, [stack.length, hoveredId]);

  function dismiss(id: string) {
    setStack((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleClick(t: Toast) {
    // Mark read in the background; navigation handled by the <Link>
    // wrapping the card.
    try {
      await notifications.markRead(t.notification.users_notifications_id);
    } catch {
      // Best-effort.
    }
    dismiss(t.id);
  }

  if (!user || stack.length === 0) return null;

  const visible = stack.slice(0, MAX_VISIBLE);
  const overflow = stack.length - visible.length;

  return (
    <div
      className="notification-toast-host"
      role="region"
      aria-label="New notifications"
      aria-live="polite"
    >
      {visible.map((t) => {
        const n = t.notification;
        const href = contextHref(n);
        const inner = (
          <>
            <div className="notification-toast__Header">
              <span className="pill pill--info notification-toast__Header_kind">
                {n.users_notifications_kind}
              </span>
              <button
                type="button"
                className="notification-toast__Header_close"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dismiss(t.id);
                }}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <div className="notification-toast__Body">
              <div className="notification-toast__Body_title">
                {n.users_notifications_title}
              </div>
              {n.users_notifications_body && (
                <div className="notification-toast__Body_snippet">
                  {n.users_notifications_body}
                </div>
              )}
              {n.users_notifications_context_label && (
                <div className="notification-toast__Body_context">
                  {n.users_notifications_context_label}
                </div>
              )}
            </div>
          </>
        );
        const onEnter = () => setHoveredId(t.id);
        const onLeave = () => setHoveredId((cur) => (cur === t.id ? null : cur));
        if (href) {
          return (
            <Link
              key={t.id}
              href={href}
              className="notification-toast"
              onClick={() => handleClick(t)}
              onMouseEnter={onEnter}
              onMouseLeave={onLeave}
            >
              {inner}
            </Link>
          );
        }
        return (
          <div
            key={t.id}
            className="notification-toast"
            role="button"
            tabIndex={0}
            onClick={() => handleClick(t)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleClick(t);
            }}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
          >
            {inner}
          </div>
        );
      })}
      {overflow > 0 && (
        <Link
          href="/user/notifications/notifications"
          className="notification-toast notification-toast--overflow"
        >
          +{overflow} more
        </Link>
      )}
    </div>
  );
}

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
