"use client";

import dynamic from "next/dynamic";

const PortfolioModelPage = dynamic(() => import("@/app/(user)/portfolio-model/page"), {
  ssr: false,
  loading: () => <div className="topology-tab-host__loading">Loading portfolio model…</div>,
});

export default function PortfolioModelTabPage() {
  return (
    <div className="ws-tab-embed">
      <PortfolioModelPage />
    </div>
  );
}
