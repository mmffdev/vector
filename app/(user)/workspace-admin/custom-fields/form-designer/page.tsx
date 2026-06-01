"use client";

// Vector Form Designer — dedicated route for the Form Layout Builder.
//
// Why its own route (Rick, 2026-06-01): the designer also lives inline on the
// Custom Fields page (via the same FormBuilderLaunchPanel), but that mount has
// no URL of its own, so a browser refresh bounced the user back to the main
// page. This route gives it a stable, refreshable URL
// (/workspace-admin/custom-fields/form-designer) AND a rail-2 nav entry under
// the workspace-settings bucket. The Custom Fields dropdown entry still works
// exactly as before — this is an additional, not a replacement, entry point.
//
// On entry the page shows its OWN panel (title + description) and the existing
// artefact-type selector. Picking a type from the selector is what opens the
// builder — so the page never loads a blank builder with no focus; the user is
// told up front to choose a form type first.

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { FormBuilderLaunchPanel } from "@/app/components/FormLayoutBuilder/FormBuilderLaunchPanel";

export default function FormDesignerPage() {
  const { full } = usePageTitle();

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Design the form layout teams see per artefact type." />
      <PageDescription title="Vector Form Designer">
        <p className="form__hint">
          The Form Designer lets you lay out the form teams see when they create
          or edit an artefact on this node — which fields appear, where, and how
          they group. The layout travels with each artefact across team
          hand-offs.
        </p>
        <p className="form__hint">
          <strong>Select a form type from the selector below to begin.</strong>{" "}
          Choosing a type opens the full-screen designer for the current scope
          node and that type — until you pick one, there is nothing to design,
          so the canvas stays closed.
        </p>
      </PageDescription>

      {/* The launch panel carries the artefact-type selector and opens the
          full-screen FormBuilderShell on pick — the SAME entry used inline on
          the Custom Fields page. No URL params needed: it resolves the node from
          the sentinel focus and tracks the selected type in local state. */}
      <FormBuilderLaunchPanel />
    </PageContent>
  );
}
