"use client";

import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";

export default function AccountSettingsPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <PageShell title="Account Settings" subtitle="Your profile, password, and personal preferences">
      <div className="placeholder">
        <h3 className="placeholder__title">Coming soon</h3>
        <p className="placeholder__body">
          Change password, display name, and notification preferences will live here.
          Signed in as <strong>{user.email}</strong>.
        </p>
      </div>
    </PageShell>
  );
}
