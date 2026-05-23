import { defineConfig } from "@playwright/test";

// Sentinel-specific Playwright config (PLA062). Run with:
//   npm run test:sentinel:e2e
//   playwright test --config dev/tests/playwright/playwright.sentinel.config.ts
//   playwright test --config dev/tests/playwright/playwright.sentinel.config.ts --grep "@sentinel"
//
// Specs live at the repo's e2e/ root and are named sentinel_*.spec.mjs.
// Tagged with @sentinel in the spec title so --grep "@sentinel" selects them
// even if a future config widens testDir.
//
// Assumes:
//  - Next.js dev server on http://localhost:3000 (or PW_BASE_URL)
//  - Backend on http://localhost:5100 (set via NEXT_PUBLIC_API_BASE)
//  - Two fixture tenants seeded (alice@tenant-a / bob@tenant-b)
//  - Sentinel middleware mounted (S05 done)

export default defineConfig({
  testDir: "../../../e2e",
  testMatch: /sentinel_.*\.spec\.mjs$/,
  timeout: 45_000,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/sentinel-e2e.json" }]],
  use: {
    baseURL: process.env.PW_BASE_URL ?? "http://localhost:3000",
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
