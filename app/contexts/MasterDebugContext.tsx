"use client";

import React, { createContext, useContext, useState } from "react";

interface MasterDebugContextValue {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

const MasterDebugContext = createContext<MasterDebugContextValue | null>(null);

export function MasterDebugProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <MasterDebugContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </MasterDebugContext.Provider>
  );
}

export function useMasterDebug(): MasterDebugContextValue {
  const ctx = useContext(MasterDebugContext);
  if (!ctx) throw new Error("useMasterDebug must be inside MasterDebugProvider");
  return ctx;
}
