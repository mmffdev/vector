// Shared config for Selenium E2E tests.
// Override via env vars; defaults match the local Vector-Selenium container.

export const SELENIUM_URL = process.env.SELENIUM_URL || "http://localhost:4444/wd/hub";

// Browser hits localhost:5101 (matches the backend's CORS allowlist).
// driver.mjs installs Chrome host-resolver rules so "localhost" inside the
// Selenium container actually resolves to the Mac via host.docker.internal.
export const BASE_URL = process.env.BASE_URL || "http://localhost:5101";

export const BROWSER = process.env.BROWSER || "chrome";

// Per-action waits. Selenium-webdriver doesn't auto-wait, so individual
// findElement/click calls in helpers should respect this.
export const DEFAULT_TIMEOUT_MS = Number(process.env.DEFAULT_TIMEOUT_MS || 10000);
