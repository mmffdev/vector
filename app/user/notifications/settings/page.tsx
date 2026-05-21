"use client";

// /user/notifications/settings — Notifications settings tab (stub).
// Second tab of the Notifications avatar-bucket surface. The real prefs UI
// (channels, digest cadence, per-event toggles) lands later; this stub
// keeps the route + addressables wired so the Page Help admin can attach
// content.

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";

export default function NotificationsSettingsPage() {
  return (
    <PageContent>
      <StrictRoute>
        <PageDescription>
          Configure how Vector reaches you — channels, digest cadence, and per-event toggles. The full settings surface lands in a future release; this stub holds the tab entry and the addressable substrate.
        </PageDescription>
        <Panel
          name="panel_notifications_settings_placeholder"
          title="Coming soon"
          description="Channel routing (email, Slack), digest schedules, and per-event toggles will live here."
        >
          <p className="form__hint u-mt-2">
            This tab is intentionally minimal. Subscribe to release notes for the rollout date.
          </p>
        </Panel>
      </StrictRoute>
    </PageContent>
  );
}
