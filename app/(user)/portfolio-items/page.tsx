"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";

export default function PortfolioItemsPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user && user.role === "gadmin") router.replace("/dashboard");
  }, [user, router]);

  if (!user || user.role === "gadmin") return null;

  return (
    <PageShell
      title="Portfolio Items"
      subtitle="Items rolled up from the active portfolio"
    >
      <div className="placeholder">
        <p>No portfolio items yet.</p>
      </div>
    </PageShell>
  );
}
