"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/app/components/AppShell";
import AppViewport from "@/app/components/AppViewport";
import PageWrapper from "@/app/components/PageWrapper";
import AppSidebar_2 from "@/app/components/AppSidebar_2";
import AppFooter from "@/app/components/AppFooter";
import AppHeader from "@/app/components/AppHeader";
import AppContent from "@/app/components/AppContent";
import { useAuth } from "@/app/contexts/AuthContext";

export default function UserLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.force_password_change) {
      router.replace("/change-password");
    }
  }, [loading, user, router]);

  if (loading || !user || user.force_password_change) return null;

  return (
    <AppShell className="app-shell">
      <AppHeader />
      <AppContent className="app-content-container">
        <AppSidebar_2 />
        <AppViewport className="app-viewport-container">
          <PageWrapper className="page-wrapper">{children}</PageWrapper>
          <main className="page-content-wrapper"></main>
        </AppViewport>
      </AppContent>
      <AppFooter />
    </AppShell>
  );
}
