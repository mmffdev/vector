"use client";

// <ObjectTreeDetailFlyout> — generic detail-flyout shell for ObjectTreeV2.
// Slice 2 of the ObjectTree refactor plan
// (docs/c_c_objecttree_refactor_plan.md).
//
// THE SHELL OWNS the interaction contract — same UX on every grid that
// mounts the V2 tree. THE BODY is whatever component the config supplies:
// ArtefactInlineForm for work-items / portfolio-items / risks today;
// TimeboxInlineForm for sprints/releases in Slice 6; anything else in
// the future.
//
// ── Interaction contract (NON-NEGOTIABLE, identical across every grid) ──
//
//   Trigger     The grid's primary-ID column (a column-renderer concern,
//               not the shell's). The IdCell calls back to the parent
//               with the row id; the parent passes that id to this shell
//               as `openId`. The shell does NOT detect clicks itself —
//               trigger lives in the column renderer.
//
//   Open        When `openId` is non-null, render the body keyed on the
//               id. When it changes from null → id, animate the height
//               from 0 to its natural value. When it swaps id → id', keep
//               the mount but rerender (the body owns its own content
//               swap; loading skeleton during async hydration is the
//               body's responsibility, since hydration shape is domain-
//               specific).
//
//   Close       Esc OR outside-click. Both fire `onClose()` which the
//               parent uses to set `openId = null`. Re-clicking the
//               trigger row is the parent's job to handle as a toggle —
//               the shell only knows "open with this id" vs "closed".
//
//   Single-open Enforced by the parent (only one `openId` at a time per
//               grid). The shell renders exactly one body.
//
//   Position    Inline beneath the grid, full-width. Pushes nothing —
//               siblings render around it. The shell does NOT modal,
//               drawer, or float.
//
// Anti-patterns we explicitly don't support: modals, side-drawers,
// hover-cards, multi-open, full-row click triggers. The whole point is
// that "click an ID, get a form below it" works identically on every
// grid — user learns the pattern once.
//
// ── What this shell does NOT do (named so the gap is intentional) ──
//
//   - Trigger detection (lives in the column renderer's IdCell button).
//   - Loading skeleton during data hydration (the body owns this; only
//     the body knows what fields are pending).
//   - Animation between open IDs (the body re-renders inline; no flicker
//     because the mount is preserved).
//   - Banner state (normal / amber-duplicate / red-confirm-delete). All
//     three are body-level UI in the current ArtefactInlineForm; future
//     bodies own their own banner.

import React, { useCallback, useEffect, useRef } from "react";

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Props the parent passes to the body component. Every body needs at
 * minimum the id, a close callback, and a save callback. Domain-specific
 * extras (onDuplicate, onDelete, isDuplicate, etc.) come through as
 * additional props — TypeScript lets the body widen this type.
 *
 * `rowId` is nullable here because the shell ALWAYS mounts the body
 * (lifecycle preservation — see § Implementation notes below). When
 * the flyout is conceptually closed, rowId is null and the body is
 * expected to render nothing / collapse internally. This mirrors how
 * ArtefactInlineForm already works.
 */
export interface DetailFlyoutBodyProps {
  /** The row id whose detail is being rendered. Null when closed. */
  rowId: string | null;
  /** Called by Esc / outside-click / body's own close button. */
  onClose: () => void;
  /**
   * Called by the body after a successful save. The shell doesn't care
   * what's in the patch; the parent forwards it to the data hook so the
   * row updates optimistically.
   */
  onSaved?: (patch: Record<string, unknown>) => void;
}

/**
 * Generic over the body's full prop shape. The body must accept the
 * base DetailFlyoutBodyProps (rowId, onClose, onSaved); any extra props
 * it needs are provided via `bodyProps`, typed as Omit of the base.
 * Catches "I forgot to pass X to the adapter" at compile time without
 * forcing every domain to declare an empty Record<string, unknown>.
 */
export interface ObjectTreeDetailFlyoutProps<TBody extends DetailFlyoutBodyProps = DetailFlyoutBodyProps> {
  /** Open state. Null = closed. Non-null = open on that row id. */
  openId: string | null;
  /**
   * The body component the config supplies. Domain-specific (form, panel,
   * whatever). Receives `rowId` + `onClose` + `onSaved` as props plus
   * any extras passed via `bodyProps`.
   */
  Body: React.ComponentType<TBody>;
  /**
   * Extra props for the body — anything the body needs beyond the base
   * three. Required when the body has extras; type-checked against the
   * body's actual prop shape.
   */
  bodyProps?: Omit<TBody, keyof DetailFlyoutBodyProps>;
  /** Called when Esc or an outside-click fires. Parent clears openId. */
  onClose: () => void;
  /**
   * Forwarded to the body's onSaved. Parent uses this to thread the
   * patch into the data hook's optimistic update path.
   */
  onSaved?: (patch: Record<string, unknown>) => void;
}

// ── Implementation ───────────────────────────────────────────────────────────

export function ObjectTreeDetailFlyout<TBody extends DetailFlyoutBodyProps>({
  openId,
  Body,
  bodyProps,
  onClose,
  onSaved,
}: ObjectTreeDetailFlyoutProps<TBody>) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Esc key → close. Attached at document level so the flyout doesn't need
  // focus to receive it; the parent grid still has focus while editing
  // inline cells. We only attach when open to avoid leaking a listener on
  // every grid mount.
  useEffect(() => {
    if (openId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId, onClose]);

  // Outside-click → close. Fires when a click lands outside the flyout's
  // root AND outside any element with `data-objecttree-flyout-trigger`
  // (so re-clicking the same ID-cell button doesn't fight the toggle
  // logic the parent owns). Pointerdown so it fires before any focused
  // editor's blur handler — keeps the close from racing the body's
  // own save-on-blur path.
  useEffect(() => {
    if (openId == null) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      // Allow clicks on any trigger button (the IdCell's button carries
      // this data-attr) so the parent can drive toggle/swap semantics
      // without the shell short-circuiting them.
      const el = target as Element;
      if (el.closest?.("[data-objecttree-flyout-trigger]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openId, onClose]);

  // Always render the wrapper + body so the body's lifecycle survives
  // open → close → open without remount. Bodies that fetch on mount
  // (e.g. ArtefactInlineForm with useArtefactInline) check `rowId !=
  // null` internally and render nothing / fetch nothing when closed.
  // The wrapper's data attribute lets CSS animate the collapse if a
  // future slice wants to (Slice 4.6 may add a height transition).
  return (
    <div
      ref={rootRef}
      className="objecttree-v2-flyout__root"
      data-objecttree-flyout={openId == null ? "closed" : "open"}
      role="region"
      aria-label="Row detail"
      aria-hidden={openId == null}
    >
      {/* The full prop bag is built explicitly with `as` because TS
          can't statically verify that the spread satisfies TBody (which
          may carry props beyond the base three). The composition is
          safe at runtime — bodyProps supplies the extras, the three
          base props come from above — and the cast localises the only
          type-system loophole to one spot. */}
      <Body
        {...({
          ...(bodyProps ?? {}),
          rowId: openId,
          onClose,
          onSaved,
        } as TBody)}
      />
    </div>
  );
}

// ── Trigger-button helper ────────────────────────────────────────────────────
//
// Marker attribute every primary-ID click target should carry so the
// shell's outside-click listener ignores it. Column renderers (today:
// IdCell in work-items-tree-config.tsx) should put this on their
// trigger button:
//
//   <button data-objecttree-flyout-trigger onClick={() => onOpenForm(row.id)}>
//     {idText}
//   </button>
//
// Exported as a constant so consumers don't have to remember the
// attribute name verbatim.
export const FLYOUT_TRIGGER_ATTR = "data-objecttree-flyout-trigger";

// Convenience: ergonomic JSX prop spread for trigger buttons.
//
//   <button {...flyoutTriggerProps()} onClick={...}>{idText}</button>
//
// Beats `data-objecttree-flyout-trigger=""` typo-risk.
export function flyoutTriggerProps(): Record<string, string> {
  return { [FLYOUT_TRIGGER_ATTR]: "" };
}

// useCallback re-export so consumers don't import React just for this
// pattern — keeps the public API tidy.
export { useCallback as useFlyoutCallback };
