"use client";

// /notifications — Notifications Manager (stub).
// First page in the new Notifications bucket (mig 192). The real feature
// surface lands later — this stub keeps the rail item clickable and the
// PageDescription panel wired up so the Page Help admin can attach
// content to it via the addressable substrate.

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";

export default function NotificationsManagerPage() {
  return (
    <PageContent>
      <StrictRoute>
        <PageDescription>
          Manage how and when you receive notifications from Vector. The full notifications surface lands in a future release; this stub holds the rail entry and the addressable substrate.
        </PageDescription>
        <Panel
          name="panel_notifications_placeholder"
          title="Coming soon"
          description="Notification routing, channels, and digest preferences will live here."
        >
          <p className="form__hint u-mt-2">
            This page is intentionally minimal. Subscribe to release notes for the rollout date.
          </p>
        </Panel>
      </StrictRoute>
    </PageContent>
  );
}
