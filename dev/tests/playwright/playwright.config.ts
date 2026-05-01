import { defineConfig } from "@playwright/test";

// Minimal config for ranking-feature E2E tests. Run with:
//   npx playwright test --config dev/tests/playwright/playwright.config.ts
//
// Assumes:
//  - Next.js dev server on http://localhost:3000
//  - Backend on http://localhost:5100 (set via NEXT_PUBLIC_API_BASE)
//  - Migrations 068 + 069 applied to the connected DB
//  - dev login user padmin@mmffdev.com / TestPass1! exists
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.PW_BASE_URL ?? "http://localhost:3000",
    actionTimeout: 10_000,
    trace: "on-first-retry",
  },
});
