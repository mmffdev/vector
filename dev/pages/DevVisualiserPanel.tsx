"use client";

// DevVisualiserPanel — the entry component registered against the
// /dev/visualiser tab in app/(user)/dev/[tab]/page.tsx. It hosts a thin
// version switcher between iterative visualiser builds:
//
//   V1 = the original cubes + cluster-drag + click-to-frame + (broken)
//        File Explorer prototype. Preserved untouched as a historical
//        reference so we can compare every new build against where we
//        started.
//
//   V2 = the next-gen SCADA-shell relationship explorer — top KPI
//        strip, left icon rail, multi-panel system, K-hops isolate,
//        lasso groups, snapshot diff, expand-to-fullscreen.
//
// Adding V3 is two lines: import the new component, push it onto the
// VERSIONS array. Each version is a fully self-contained component;
// they share no React state, only the underlying
// /_site/admin/dev/codegraph data feed.

import { useState } from "react";
import Panel from "@/app/components/Panel";
import DevVisualiserPanelV1 from "./DevVisualiserPanelV1";
import DevVisualiserPanelV2 from "./DevVisualiserPanelV2";

type Version = "v1" | "v2";

const VERSIONS: { id: Version; label: string; subtitle: string; Component: React.ComponentType }[] = [
  {
    id: "v1",
    label: "V1",
    subtitle: "Original cubes + cluster drag",
    Component: DevVisualiserPanelV1,
  },
  {
    id: "v2",
    label: "V2",
    subtitle: "Relationship Explorer (next-gen)",
    Component: DevVisualiserPanelV2,
  },
];

export default function DevVisualiserPanel() {
  // V2 is the active build; V1 is kept as a regression reference.
  const [version, setVersion] = useState<Version>("v2");
  const active = VERSIONS.find(v => v.id === version) ?? VERSIONS[0];
  const ActiveComponent = active.Component;

  return (
    <Panel name="dev_visualiser" title="Visualiser">
      <div className="dui-viz-shell">
        <div className="dui-viz-shell__tabs" role="tablist" aria-label="Visualiser version">
          {VERSIONS.map(v => (
            <button
              key={v.id}
              role="tab"
              aria-selected={version === v.id}
              aria-controls={`viz-tabpanel-${v.id}`}
              id={`viz-tab-${v.id}`}
              className={`dui-viz-shell__tab${version === v.id ? " is-active" : ""}`}
              onClick={() => setVersion(v.id)}
            >
              <span className="dui-viz-shell__tab-label">{v.label}</span>
              <span className="dui-viz-shell__tab-subtitle">{v.subtitle}</span>
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`viz-tabpanel-${active.id}`}
          aria-labelledby={`viz-tab-${active.id}`}
          className="dui-viz-shell__body"
        >
          <ActiveComponent />
        </div>
      </div>
    </Panel>
  );
}
