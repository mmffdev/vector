"use client";

import dynamic from "next/dynamic";

const TopologyOverlayPage = dynamic(() => import("@/app/(overlay)/topology/page"), {
  ssr: false,
  loading: () => <div className="topology-tab-host__loading">Loading topology…</div>,
});

export default function TopologyPage() {
  return (
    <div className="topology-tab-host">
      <TopologyOverlayPage />
    </div>
  );
}
