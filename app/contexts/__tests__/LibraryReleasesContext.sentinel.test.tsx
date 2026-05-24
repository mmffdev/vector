import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// PLA062 S17 — LibraryReleasesContext migrated useHasPermission →
// sentinel_can. The provider gates its polling loop on
// `library.releases.view`. This test pins the sentinel_can wiring
// contract: the migrated provider MUST query that exact permission
// when it mounts.

const sentinelCan = vi.fn((_code: string) => false);

vi.mock("@/app/sentinel", () => ({
  __esModule: true,
  useSentinel: () => ({ sentinel_can: sentinelCan }),
}));

vi.mock("@/app/lib/api", () => ({
  __esModule: true,
  apiSite: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

import { LibraryReleasesProvider } from "@/app/contexts/LibraryReleasesContext";

describe("LibraryReleasesContext — sentinel_can gating (PLA062 S17)", () => {
  it("calls sentinel_can('library.releases.view') on mount", () => {
    sentinelCan.mockClear();
    sentinelCan.mockImplementation(() => false);
    render(<LibraryReleasesProvider><div /></LibraryReleasesProvider>);
    expect(sentinelCan).toHaveBeenCalledWith("library.releases.view");
  });
});
