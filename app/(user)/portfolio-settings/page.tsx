"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";

export default function PortfolioSettingsPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user && user.role === "user") router.replace("/dashboard");
  }, [user, router]);

  if (!user || user.role === "user") return null;

  return (
    <PageShell title="Portfolio Settings" subtitle="Manage portfolios, products, and stakeholders">
      <div className="placeholder">
        <h3 className="placeholder__title">Coming soon</h3>
        <p className="placeholder__body">
          Portfolio Manager — create and edit portfolios, assign products, manage stakeholders.
          Lands with the next delivery, once entity-backed nav catalogue entries come online.
        </p>
      </div>
    </PageShell>
  );
}
