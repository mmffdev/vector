import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DevErdPanel from "../../../dev/pages/DevErdPanel";

vi.mock("../../../dev/pages/DevErdCanvas", () => ({
  default: () => <div data-testid="erd-canvas-stub" />,
}));

vi.mock("../../../app/components/Panel", () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid={`panel-${title.toLowerCase()}`}>{children}</div>
  ),
}));

const fixture = {
  generated_at: "2026-05-27T00:00:00Z",
  databases: [
    { name: "vector_artefacts", table_count: 2, fk_count: 1 },
    { name: "mmff_library", table_count: 0, fk_count: 0 },
  ],
  groups: [
    { id: "sentinel", label: "Sentinel", source: "erd_groups.yaml" },
    { id: "uncatalogued", label: "Uncatalogued", source: "fallback" },
  ],
  nodes: [
    {
      id: "vector_artefacts.users",
      database: "vector_artefacts",
      table: "users",
      group: "sentinel",
      row_count: 142,
      columns: [
        { name: "users_id", type: "uuid", is_pk: true, is_fk: false, nullable: false },
      ],
    },
  ],
  edges: [],
};

global.fetch = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => fixture,
})) as unknown as typeof fetch;

describe("DevErdPanel", () => {
  it("renders the three-column shell with toolbar after fetch", async () => {
    render(<DevErdPanel />);
    expect(await screen.findByTestId("erd-canvas-stub")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /snapshot/i })).toBeInTheDocument();
  });

  it("shows database and group filters", async () => {
    render(<DevErdPanel />);
    await screen.findByTestId("erd-canvas-stub");
    expect(screen.getByLabelText("vector_artefacts")).toBeInTheDocument();
    expect(screen.getByLabelText("Sentinel")).toBeInTheDocument();
  });
});
