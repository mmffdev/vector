"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/app/components/AppShell";
import AppViewport from "@/app/components/AppViewport";
import PageWrapper from "@/app/components/PageWrapper";
import AppSidebar_2 from "@/app/components/AppSidebar_2";
import AppFooter from "@/app/components/AppFooter";
import PageHeaderBar from "@/app/components/PageHeaderBar";
import { PageHeaderProvider } from "@/app/contexts/PageHeaderContext";
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
    <PageHeaderProvider>
      <div className="app-root">
        <PageHeaderBar />
        <AppShell className="app-shell">
          <AppSidebar_2 />
          <div className="app-main-column">
            <AppViewport className="app-viewport-container">
              <PageWrapper className="page-wrapper">{children}</PageWrapper>
              <main className="page-content-wrapper"></main>
            </AppViewport>
            <AppFooter />
          </div>
        </AppShell>
      </div>
    </PageHeaderProvider>
  );
}
