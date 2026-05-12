"use client";

import dynamic from "next/dynamic";
import PageContent from "@/app/components/PageContent";

const PortfolioModelPage = dynamic(() => import("@/app/(user)/portfolio-model/page"), {
  ssr: false,
  loading: () => <div className="topology-tab-host__loading">Loading portfolio model…</div>,
});

export default function PortfolioModelTabPage() {
  return (
    <PageContent>
    <div className="ws-tab-embed">
      <PortfolioModelPage />
    </div>
    </PageContent>
  );
}
