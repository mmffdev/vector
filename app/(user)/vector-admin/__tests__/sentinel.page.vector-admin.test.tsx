/**
 * Sentinel migration regression-guard for the vector-admin cluster (PLA062 S15).
 *
 * Static-grep checks across the 4 routes under app/(user)/vector-admin/.
 * Same pattern as the workspace-admin cluster-guard (S14) — see
 * docs/Security/Sentinel/sentinel_docs.md § Process.
 *
 * Only `tenant-settings/page.tsx` had old-hook imports before S15;
 * the api-manager routes were already clean. All 4 pages get
 * regression coverage so future edits can't silently regress.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGES = [
  "tenant-settings/page.tsx",
  "api-manager/page.tsx",
  "api-manager/asset-register/page.tsx",
  "api-manager/webhooks/page.tsx",
];

describe("sentinel.page.vector-admin (cluster regression-guard)", () => {
  for (const rel of PAGES) {
    it(`AC1 — ${rel} has no old-hook imports`, () => {
      const src = readFileSync(resolve(__dirname, "..", rel), "utf-8");
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      expect(code).not.toMatch(/from "@\/app\/contexts\/AuthContext"/);
      expect(code).not.toMatch(/from "@\/app\/contexts\/ScopeContext"/);
      expect(code).not.toMatch(/from "@\/app\/contexts\/TenantContext"/);
      expect(code).not.toMatch(/\buseAuth\s*[(]/);
      expect(code).not.toMatch(/\buseScope\s*[(]/);
      expect(code).not.toMatch(/\buseTenant\s*[(]/);
      expect(code).not.toMatch(/\buseHasPermission\s*[(]/);
      expect(code).not.toMatch(/(?<!sentinel_)user[?]?\.subscription_id/);
      expect(code).not.toMatch(/(?<!sentinel_)user[?]?\.workspace_id/);
    });
  }
});
