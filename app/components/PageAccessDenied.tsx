"use client";

// PageAccessDenied — in-place denial card for revoked page access.
// PLA-0049 Phase 0.5.5.
//
// Renders inside the page (URL preserved) when usePageAccess()
// returns allowed=false. Two actions: Back (history.back) and
// Dashboard (route to /dashboard).
//
// Intentionally uses only existing primitives (PageContent, PageHeading,
// Panel, .btn) so no new CSS class names are introduced — adheres to
// the project's catalogue-class-first rule.

import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";

interface Props {
  /** What was the user trying to reach. Optional — used in the message. */
  pageLabel?: string;
}

export default function PageAccessDenied({ pageLabel }: Props) {
  const router = useRouter();
  const what = pageLabel ?? "this page";
  return (
    <PageContent>
      <PageHeading
        level={1}
        title="Access denied"
        subtitle={`Your role does not currently have access to ${what}.`}
      />
      <Panel
        name="panel_page_access_denied"
        className="page-panel-heading"
        title="Access revoked"
        description="If you believe this is an error, contact a Global Admin. Your access set is checked live; this card will lift automatically if your role is granted access again."
      >
        <div className="btn-group">
          <button type="button" className="btn btn--secondary" onClick={() => router.back()}>
            ← Back
          </button>
          <button type="button" className="btn btn--primary" onClick={() => router.replace("/dashboard")}>
            Go to Dashboard
          </button>
        </div>
      </Panel>
    </PageContent>
  );
}
