"use client";

// ArtefactInlineForm — public entry point.
//
// Renders a CSS-animated wrapper that slides open below the tree when
// `artefactId` is set, and collapses to 0px when null. Mounted at the
// BOTTOM of the ObjectTree (after the ResourceTree) so the user can
// see all sibling rows above while editing — no half-empty whitespace,
// no layering over the tree.
//
// On open transition (null → non-null), the wrapper scrolls its top
// edge into view so the form is always visible regardless of which row
// triggered it. Scrolls AFTER the slide-down animation completes so the
// destination is correct.

import React, { useEffect, useRef } from "react";
import { ArtefactInlineForm as Body } from "./ArtefactInlineForm";
import type { ArtefactInlineFormProps } from "./types";

export type { ArtefactInlineFormProps } from "./types";

// Animation duration in the CSS (.artefact-inline-form transition) is
// 220ms; wait a touch longer before scrolling so the form has resolved
// to its final height and scrollIntoView lands on the correct rect.
const OPEN_ANIM_MS = 240;

export default function ArtefactInlineForm(props: ArtefactInlineFormProps) {
  const isOpen = props.artefactId !== null;
  const ref = useRef<HTMLElement | null>(null);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = isOpen;
    // Only scroll on the closed → open transition. Re-opening to a
    // different artefact id (e.g. user clicks a different row's badge
    // while the form is open) also re-scrolls so the new content is
    // visible.
    if (!isOpen) return;
    const node = ref.current;
    if (!node) return;
    // Wait for the slide-down animation to finish, then scroll the
    // form's top edge into view. block: "start" puts the form's top
    // at the viewport's top edge; the user can still see the tree row
    // they clicked because the tree sits ABOVE the form in document
    // order, so scrolling to the form keeps the row in the visible
    // area immediately above.
    const t = setTimeout(() => {
      node.scrollIntoView({ block: "start", behavior: "smooth" });
    }, wasOpen ? 60 : OPEN_ANIM_MS);
    return () => clearTimeout(t);
  }, [isOpen, props.artefactId]);

  return (
    <section
      ref={ref}
      className="artefact-inline-form"
      data-open={isOpen ? "true" : "false"}
      role="region"
      aria-label="Artefact detail editor"
      aria-hidden={!isOpen}
    >
      {isOpen ? <Body {...props} /> : null}
    </section>
  );
}
