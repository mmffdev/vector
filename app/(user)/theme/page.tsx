"use client";

import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";

export default function ThemePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <PageShell title="Theme" subtitle="Choose how Vector looks for you">
      <div className="placeholder">
        <h3 className="placeholder__title">Coming soon</h3>
        <p className="placeholder__body">
          Light/dark mode, accent colours, and density options will live here.
        </p>
      </div>
    </PageShell>
  );
}
