"use client";

// Page-top description panel rendered through <Panel> so the helper-icon
// pattern (HARD RULE in MEMORY.md: feedback_helper_icon) is wired
// automatically. Title defaults to the deepest active secondary-nav tab
// label so the page name follows the navigation without per-page wiring.
// String children are wrapped in <p className="form__hint"> for default
// hint styling; element children pass through untouched so pages can
// render lists or rich content.

import { isValidElement, type ReactNode } from "react";
import Panel from "@/app/components/Panel";
import { useActiveNav } from "@/app/contexts/ActiveNavContext";

interface PageDescriptionProps {
  title?: ReactNode;
  children?: ReactNode;
}

function isPlainText(node: ReactNode): boolean {
  if (typeof node === "string" || typeof node === "number") return true;
  if (Array.isArray(node)) return node.every(isPlainText);
  if (isValidElement(node)) return false;
  return false;
}

export default function PageDescription({ title, children }: PageDescriptionProps) {
  const { deepestLabel } = useActiveNav();
  const resolvedTitle = title ?? deepestLabel ?? "";

  return (
    <div className="page-description">
      <Panel name="page_description" title={resolvedTitle}>
        {isPlainText(children) ? <p className="form__hint">{children}</p> : children}
      </Panel>
    </div>
  );
}
