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
//   V3 = the code intelligence atlas - persona lenses, risk/evidence
//        mining, graph map, hotspot ranking and source inspector.
//
//   V4 = the 3D code atlas — Emerge-inspired structural explorer with
//        Louvain clustering, criticality glow, multi-term live search.
//        Driven by the enriched audit fields (sloc, fan_in, fan_out,
//        criticality). No time/git axis — pure relationship view.
//
// Adding a new version is two lines: import the component, push it onto
// the VERSIONS array. Each version is fully self-contained; they share
// no React state, only the /_site/admin/dev/codegraph data feed.

import { useState } from "react";
import Panel from "@/app/components/Panel";
import DevVisualiserPanelV1 from "./DevVisualiserPanelV1";
import DevVisualiserPanelV2 from "./DevVisualiserPanelV2";
import DevVisualiserPanelV2A from "./DevVisualiserPanelV2A";
import DevVisualiserPanelV3 from "./DevVisualiserPanelV3";
import DevVisualiserPanelV4 from "./DevVisualiserPanelV4";

type Version = "v1" | "v2" | "v2a" | "v3" | "v4";

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
    subtitle: "Relationship Explorer (baseline)",
    Component: DevVisualiserPanelV2,
  },
  {
    id: "v2a",
    label: "V2A",
    subtitle: "V2 + 31-filter left rail (A/B variant)",
    Component: DevVisualiserPanelV2A,
  },
  {
    id: "v3",
    label: "V3",
    subtitle: "Code Intelligence Atlas",
    Component: DevVisualiserPanelV3,
  },
  {
    id: "v4",
    label: "V4",
    subtitle: "3D Code Atlas (Emerge-inspired)",
    Component: DevVisualiserPanelV4,
  },
];

export default function DevVisualiserPanel() {
  // V4 is the active build; V1–V3 are kept as regression references.
  const [version, setVersion] = useState<Version>("v4");
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
