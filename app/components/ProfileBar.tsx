"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useNavPrefs, type NavProfile } from "@/app/contexts/NavPrefsContext";

export const MAX_PROFILES = 10;
const MAX_LABEL = 32;

// Entrance animation tunables — kept together so the choreography is
// adjustable in one place. See `useEffect` near the JSX return.
//
// Slinky-collapse physics: every pill is its own object. All pills launch
// from the same off-screen-right offset at t=0, but each has its own
// velocity drawn from a linear ramp — leftmost (front) = fastest,
// rightmost (back) = slowest. The front pill lands first with a soft
// `back.out` settle; each trailing pill arrives later and compresses into
// the established row with progressively stronger overshoot, producing
// the visual of a slinky's coils telescoping together.
//
// Velocity, duration, and overshoot are recomputed every entrance from
// the live pill count, so adding/removing profiles always rebalances.
const ENTRANCE_FROM_X        = 240;   // px each pill travels (relative offset)
const ENTRANCE_BASE_DURATION = 0.55;  // seconds for the FRONT (fastest) pill
const ENTRANCE_SLOW_FACTOR   = 0.45;  // back pill speed = front × this (so 0.45 ≈ 2.2× longer)
const BOUNCE_FRONT           = 0.8;   // back.out overshoot for the front pill (mild settle)
const BOUNCE_REAR            = 2.2;   // back.out overshoot for the rear pill (hard collision)
const MIST_FADE_DURATION     = 0.5;
const MIST_FADE_OVERLAP      = 0.35;  // mist begins dissolving this many seconds before the last pill lands

type EditState =
  | { mode: "idle" }
  | { mode: "creating" }
  | { mode: "renaming"; id: string };

export default function ProfileBar({ animateEntrance = false }: { animateEntrance?: boolean } = {}) {
  const {
    profiles,
    activeProfileId,
    setActiveProfile,
    createProfile,
    renameProfile,
    deleteProfile,
    reorderProfiles,
    loading,
  } = useNavPrefs();

  const [edit, setEdit] = useState<EditState>({ mode: "idle" });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const mistRef = useRef<HTMLDivElement | null>(null);

  // Drag state — local-only; on drop we fire reorderProfiles and let
  // refetch reconcile. The optimistic order lives in `pendingOrder`
  // so the UI stays smooth during the in-flight PUT.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);

  useEffect(() => {
    if (edit.mode !== "idle") inputRef.current?.focus();
  }, [edit.mode]);

  // Mount entrance: pills slide horizontally from far right to home,
  // sliding under a right-anchored gradient mist that dissolves once they
  // land. Only runs when `animateEntrance` is true (the nav-prefs page);
  // the sidebar instance opts out so the bar just appears.
  // useLayoutEffect (not useEffect): runs synchronously before paint so
  // the pills never flash at their home position before the slide-in.
  useLayoutEffect(() => {
    if (loading) return;
    if (!animateEntrance) {
      // Sidebar (or any other consumer) — no animation. Hide the mist
      // since the CSS default leaves it visible for the entrance.
      if (mistRef.current) mistRef.current.style.opacity = "0";
      return;
    }
    const bar = barRef.current;
    const mist = mistRef.current;
    if (!bar) return;
    const cells = Array.from(
      bar.querySelectorAll<HTMLElement>(".profile-bar__cell, .profile-bar__add")
    );
    if (cells.length === 0) return;

    const reduced = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      if (mist) mist.style.opacity = "0";
      return;
    }

    // Per-pill physics — recomputed every entrance from live pill count.
    // t = 0 (front, fastest, mild settle) → t = 1 (back, slowest, hard collision).
    const N = cells.length;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const specs = cells.map((_, i) => {
      const t = N === 1 ? 0 : i / (N - 1);
      const speedFactor = lerp(1, ENTRANCE_SLOW_FACTOR, t);
      return {
        duration:  ENTRANCE_BASE_DURATION / speedFactor,
        overshoot: lerp(BOUNCE_FRONT, BOUNCE_REAR, t),
      };
    });
    const slowestDuration = Math.max(...specs.map((s) => s.duration));

    const ctx = gsap.context(() => {
      gsap.set(cells, { x: ENTRANCE_FROM_X, opacity: 0, willChange: "transform, opacity" });
      if (mist) gsap.set(mist, { opacity: 1 });

      const tl = gsap.timeline({
        onComplete: () => {
          gsap.set(cells, { clearProps: "willChange,transform,opacity" });
        },
      });

      // All pills launch at t=0. Differing velocities create the visible
      // slinky compression — front pills land first, rear pills catch up
      // and settle into the established row with stronger overshoot.
      cells.forEach((cell, i) => {
        const { duration, overshoot } = specs[i];
        tl.to(cell, {
          x: 0,
          opacity: 1,
          duration,
          ease: `back.out(${overshoot})`,
        }, 0);
      });

      if (mist) {
        tl.to(mist, {
          opacity: 0,
          duration: MIST_FADE_DURATION,
          ease: "power2.out",
        }, Math.max(0, slowestDuration - MIST_FADE_OVERLAP));
      }
    }, bar);

    return () => ctx.revert();
  }, [loading, animateEntrance]);

  // Drop the optimistic order once the server's authoritative order arrives.
  useEffect(() => {
    if (pendingOrder === null) return;
    const serverOrder = profiles
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((p) => p.id);
    if (
      serverOrder.length === pendingOrder.length &&
      serverOrder.every((id, i) => id === pendingOrder[i])
    ) {
      setPendingOrder(null);
    }
  }, [profiles, pendingOrder]);

  const reset = useCallback(() => {
    setEdit({ mode: "idle" });
    setDraft("");
    setError(null);
  }, []);

  const startCreate = useCallback(() => {
    setEdit({ mode: "creating" });
    setDraft("");
    setError(null);
  }, []);

  const startRename = useCallback((p: NavProfile) => {
    setEdit({ mode: "renaming", id: p.id });
    setDraft(p.label);
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Name required");
      return;
    }
    if (trimmed.length > MAX_LABEL) {
      setError(`Max ${MAX_LABEL} characters`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (edit.mode === "creating") {
        await createProfile(trimmed);
      } else if (edit.mode === "renaming") {
        await renameProfile(edit.id, trimmed);
      }
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [draft, edit, createProfile, renameProfile, reset]);

  const remove = useCallback(async (p: NavProfile) => {
    if (p.is_default) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProfile(p.id);
      setConfirmingDeleteId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [deleteProfile]);

  // ---- Drag handlers ------------------------------------------------
  // Compute the target order: remove dragId, insert before overId. If
  // overId is null (drop at end) append. Returns null if the order
  // didn't actually change (no point firing the PUT).
  const computeReorder = useCallback(
    (currentIds: string[], from: string, to: string | null): string[] | null => {
      const without = currentIds.filter((id) => id !== from);
      let next: string[];
      if (to === null || to === from) {
        next = [...without, from];
      } else {
        const insertAt = without.indexOf(to);
        if (insertAt < 0) next = [...without, from];
        else next = [...without.slice(0, insertAt), from, ...without.slice(insertAt)];
      }
      const same =
        next.length === currentIds.length &&
        next.every((id, i) => id === currentIds[i]);
      return same ? null : next;
    },
    [],
  );

  const onDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      if (edit.mode !== "idle" || busy) {
        e.preventDefault();
        return;
      }
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
      // Required for Firefox to actually fire dragover/drop
      e.dataTransfer.setData("text/plain", id);
    },
    [edit.mode, busy],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent, id: string | null) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (id !== overId) setOverId(id);
    },
    [dragId, overId],
  );

  const onDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent, id: string | null) => {
      if (!dragId) return;
      e.preventDefault();
      const sourceOrder = (pendingOrder ??
        profiles.slice().sort((a, b) => a.position - b.position).map((p) => p.id));
      const next = computeReorder(sourceOrder, dragId, id);
      setDragId(null);
      setOverId(null);
      if (!next) return;
      setPendingOrder(next);
      setBusy(true);
      setError(null);
      try {
        await reorderProfiles(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reorder failed");
        setPendingOrder(null); // fall back to server order
      } finally {
        setBusy(false);
      }
    },
    [dragId, profiles, pendingOrder, computeReorder, reorderProfiles],
  );

  // Only hide on the very first load. During subsequent refetches
  // (profile switch, rename, reorder) the previous profiles are still
  // in state — keep them rendered so the bar doesn't disappear and the
  // entrance animation doesn't replay on every interaction.
  if (profiles.length === 0) return null;

  // Apply optimistic order if a reorder is in flight; otherwise sort by position.
  const baseSorted = profiles.slice().sort((a, b) => a.position - b.position);
  const ordered = pendingOrder
    ? (pendingOrder
        .map((id) => baseSorted.find((p) => p.id === id))
        .filter((p): p is NavProfile => Boolean(p)))
    : baseSorted;
  const atCap = profiles.length >= MAX_PROFILES;
  const dragActive = dragId !== null;

  return (
    <div
      ref={barRef}
      className="profile-bar"
      role="tablist"
      aria-label="Navigation profiles"
      onDragOver={(e) => onDragOver(e, null)}
      onDrop={(e) => void onDrop(e, null)}
    >
      <div ref={mistRef} className="profile-bar__mist" aria-hidden />
      {ordered.map((p) => {
        const active = p.id === activeProfileId;
        const renamingThis = edit.mode === "renaming" && edit.id === p.id;

        if (renamingThis) {
          return (
            <span key={p.id} className="profile-bar__edit">
              <input
                ref={inputRef}
                type="text"
                className="profile-bar__input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  if (e.key === "Escape") reset();
                }}
                onBlur={() => { if (!busy) reset(); }}
                disabled={busy}
                maxLength={MAX_LABEL}
                aria-label="Rename profile"
              />
            </span>
          );
        }

        const dragging = dragId === p.id;
        const dragOver = overId === p.id && dragId !== p.id;

        return (
          <span
            key={p.id}
            className={[
              "profile-bar__cell",
              dragging ? "dragging" : "",
              dragOver ? "drag-over" : "",
              confirmingDeleteId === p.id ? "confirming-delete" : "",
            ].filter(Boolean).join(" ")}
            draggable={edit.mode === "idle" && !busy}
            onDragStart={(e) => onDragStart(e, p.id)}
            onDragEnd={onDragEnd}
            onDragOver={(e) => onDragOver(e, p.id)}
            onDrop={(e) => { e.stopPropagation(); void onDrop(e, p.id); }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className={`profile-bar__pill ${active ? "active" : ""}`}
              onClick={() => { if (!active) void setActiveProfile(p.id); }}
              title={p.label}
            >
              {p.label}
            </button>
            <span className="profile-bar__cell-actions">
              {confirmingDeleteId === p.id ? (
                <>
                  <button
                    type="button"
                    className="profile-bar__icon-btn profile-bar__icon-btn--confirm"
                    onClick={(e) => { e.stopPropagation(); void remove(p); }}
                    title="Confirm delete"
                    aria-label={`Confirm delete ${p.label}`}
                    disabled={busy}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="profile-bar__icon-btn"
                    onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(null); }}
                    title="Cancel"
                    aria-label="Cancel delete"
                    disabled={busy}
                  >
                    ×
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="profile-bar__icon-btn"
                    onClick={(e) => { e.stopPropagation(); startRename(p); }}
                    title="Rename profile"
                    aria-label={`Rename ${p.label}`}
                    disabled={busy}
                  >
                    ✎
                  </button>
                  {!p.is_default && (
                    <button
                      type="button"
                      className="profile-bar__icon-btn profile-bar__icon-btn--danger"
                      onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(p.id); }}
                      title="Delete profile"
                      aria-label={`Delete ${p.label}`}
                      disabled={busy}
                    >
                      ×
                    </button>
                  )}
                </>
              )}
            </span>
          </span>
        );
      })}

      {edit.mode === "creating" ? (
        <span className="profile-bar__edit">
          <input
            ref={inputRef}
            type="text"
            className="profile-bar__input"
            value={draft}
            placeholder="Profile name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") reset();
            }}
            onBlur={() => { if (!busy) reset(); }}
            disabled={busy}
            maxLength={MAX_LABEL}
            aria-label="New profile name"
          />
        </span>
      ) : (
        !dragActive && (
          <button
            type="button"
            className="profile-bar__add"
            onClick={startCreate}
            disabled={atCap || busy}
            title={atCap ? `Profile limit reached (${MAX_PROFILES})` : "New profile"}
            aria-label="New profile"
          >
            +
          </button>
        )
      )}

      {error && (
        <span className="profile-bar__error" role="alert">{error}</span>
      )}
    </div>
  );
}
