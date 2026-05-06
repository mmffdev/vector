// Phase 2 PoC: standalone /v2/* layout. Deliberately bypasses the (user)
// AuthContext gate so the PoC pages can be exercised without depending on
// the production Go session — the v2 surface talks to vector_artefacts via
// /api/v2/* route handlers using fixture subscription/user IDs and is not
// part of the production authz boundary.
//
// DomRegistryProvider is here only because <Panel> and <Table> register
// themselves as addressables; nothing reads the registry on /v2/*.

"use client";

import { DomRegistryProvider, ViewportSlot } from "@/app/contexts/DomRegistryContext";

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <DomRegistryProvider>
      <ViewportSlot kind="app">
        <div className="page-wrapper" style={{ padding: "24px" }}>
          {children}
        </div>
      </ViewportSlot>
    </DomRegistryProvider>
  );
}
