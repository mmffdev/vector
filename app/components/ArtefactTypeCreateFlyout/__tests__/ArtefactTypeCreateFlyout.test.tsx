import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Stub <Panel> to a passthrough — these tests target the flyout's form DOM
// (scope radios, Tag/Name inputs, the two selects, impact list, buttons), not
// Panel's addressable substrate (which needs a DomRegistry provider). Panel is
// exercised by its own suite. Matches the house pattern in PageSummaryHeader.test.
vi.mock("@/app/components/Panel", () => ({
  __esModule: true,
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <section className={`panel ${className ?? ""}`} data-testid="panel-stub">
      {children}
    </section>
  ),
}));

import { ArtefactTypeCreateFlyout } from "../index";
import { artefactTypesApi } from "@/app/lib/artefactTypesApi";

vi.mock("@/app/lib/artefactTypesApi", () => ({
  artefactTypesApi: {
    create: vi.fn(),
    previewInsertLayer: vi.fn(),
    insertLayer: vi.fn(),
  },
}));

const TYPES = [
  { id: "s", scope: "work", prefix: "US", name: "Story", slot: "wrk_story", parent_type_id: null, execution_parent_slots: ["str_feature"], layer_depth: null },
  { id: "th", scope: "strategy", prefix: "TH", name: "Theme", slot: null, parent_type_id: "pr", execution_parent_slots: null, layer_depth: 3 },
  { id: "fe", scope: "strategy", prefix: "FE", name: "Feature", slot: "str_feature", parent_type_id: "th", execution_parent_slots: null, layer_depth: null },
  { id: "pr", scope: "strategy", prefix: "PR", name: "Product", slot: null, parent_type_id: "prw", execution_parent_slots: null, layer_depth: 1 },
  { id: "prw", scope: "strategy", prefix: "PRW", name: "Portfolio Runway", slot: null, parent_type_id: null, execution_parent_slots: null, layer_depth: 0 },
] as any;

describe("ArtefactTypeCreateFlyout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("work scope shows Behaves-like select", () => {
    render(<ArtefactTypeCreateFlyout types={TYPES} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /work/i }));
    expect(screen.getByLabelText(/behaves like/i)).toBeInTheDocument();
  });

  it("strategy scope disables Confirm until preview returns", async () => {
    (artefactTypesApi.previewInsertLayer as any).mockResolvedValue({
      parent_layer: { id: "th", name: "Theme" }, child_layer: { id: "fe", name: "Feature" },
      impacted: [{ id: "x", name: "Login", current_parent_name: "Theme A" }],
      passthrough_count: 1, rejection: null,
    });
    render(<ArtefactTypeCreateFlyout types={TYPES} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /strategy/i }));
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull(); // not until previewed
    fireEvent.change(screen.getByLabelText(/tag/i), { target: { value: "SO" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Strategic Objective" } });
    // Choose a gap (Theme → Feature) — the Preview button is disabled until a
    // child type is selected, mirroring the real user flow.
    fireEvent.change(screen.getByLabelText(/insert between/i), { target: { value: "fe" } });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    await waitFor(() => expect(screen.getByText(/Login/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /confirm/i })).toBeEnabled();
  });
});
