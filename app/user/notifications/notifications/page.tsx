"use client";

// /user/notifications/notifications — Notifications list tab (stub).
// First tab of the Notifications avatar-bucket surface. The real list +
// mark-read controls land later; this stub keeps the route + addressables
// wired so the Page Help admin can attach content.

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";

export default function NotificationsListPage() {
  return (
    <PageContent>
      <StrictRoute>
        <PageDescription>
          Your notifications inbox. Mentions, assignments, and library updates land here. The full list surface lands in a future release; this stub holds the tab entry and the addressable substrate.
        </PageDescription>
        <Panel
          name="panel_notifications_list_placeholder"
          title="Coming soon"
          description="Inbox, filters, and mark-all-read controls will live here."
        >
          <p className="form__hint u-mt-2">
            This tab is intentionally minimal. Subscribe to release notes for the rollout date.
          </p>
        </Panel>
      </StrictRoute>
    </PageContent>
  );
}
