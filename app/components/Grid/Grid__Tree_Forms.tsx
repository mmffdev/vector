"use client";

// Grid__Tree_Forms — the payload of the reference extension (expandable rows with
// flyout-below). A thin host that renders the EXISTING ArtefactInlineForm (the
// always-editable, auto-saving edit surface OTV2 uses) inside a tree row's
// detail slot. Grid__Tree_Branch places it in grid__Tree_Branch_Detail — between the row
// and its _Children — so it never grows an elbow or disturbs a sibling's
// :last-child connector.
//
// No `mode` branching this pass — the form is always the editable surface,
// matching today's DataGrid + OTV2 reality. view / create / duplicate modes
// are deferred (TD-GRID-FORM-MODES); `create` has no form yet at all.
//
// The capability that OPENS this lives in the hook (useTree({expandable})) +
// the skin's openDetailId; this component is purely the rendered body.

import { ArtefactInlineForm } from "@/app/components/ArtefactInlineForm/ArtefactInlineForm";
import type { ArtefactDetail } from "@/app/components/ArtefactInlineForm/types";

export interface GridTreeFormsProps {
  /** UUID of the artefact to edit. */
  artefactId: string;
  /** Backend resource prefix — "/work-items" | "/portfolio-items". */
  resourceUrl: string;
  /** Parent-candidate routing scope. */
  scope: "work" | "strategy";
  /** Collapse the flyout (host clears openDetailId). */
  onClose: () => void;
  /** Optimistic mirror of a PATCH into the host's tree row. */
  onSaved?: (body: Record<string, unknown>) => void;
  /** Action-bar pass-throughs — host owns what each does. */
  onDuplicate?: (artefact: ArtefactDetail) => void;
  onDelete?: (artefact: ArtefactDetail) => void;
  onNavigate?: (artefactId: string) => void;
}

export function GridTreeForms({
  artefactId,
  resourceUrl,
  scope,
  onClose,
  onSaved,
  onDuplicate,
  onDelete,
  onNavigate,
}: GridTreeFormsProps) {
  return (
    <div className="grid__Tree_Forms">
      <ArtefactInlineForm
        artefactId={artefactId}
        resourceUrl={resourceUrl}
        scope={scope}
        onClose={onClose}
        onSaved={onSaved}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onNavigate={onNavigate}
      />
    </div>
  );
}
