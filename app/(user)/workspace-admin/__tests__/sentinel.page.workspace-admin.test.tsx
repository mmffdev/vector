/**
 * Sentinel migration regression-guard for the workspace-admin cluster (PLA062 S14).
 *
 * Cheap, fast static-grep checks across 6 migrated pages in
 * `app/(user)/workspace-admin/*`. Mount-style tests would require
 * 6 × 100 lines of vi.mock boilerplate; the migration's true
 * contract is "no old-hook imports", and grep tests that directly.
 *
 * The 4 pages NOT in scope here:
 *   - artefact-types/, artefacts/artefact-types/, custom-fields/* —
 *     use useActiveWorkspace, migration belongs to S18
 *   - artefacts/page.tsx, artefacts/flow-states-v2/, work-items/,
 *     workspaces/page.tsx, portfolio-model/ — already clean of all
 *     old-hook imports (no migration needed)
 *
 * Two sibling specs for the topology pair sit in their own __tests__
 * dirs (sentinel.page.topology + sentinel.page.topology-map) — they
 * include the heavier mount-smoke AC alongside this static check.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGES = [
  "cost-centres/page.tsx",
  "transition-rules/page.tsx",
  "artefacts/transition-rules/page.tsx",
  "flow-states/page.tsx",
  "workspace-details/page.tsx",
  "workspaces/page.tsx",
];

describe("sentinel.page.workspace-admin (cluster regression-guard)", () => {
  for (const rel of PAGES) {
    it(`AC1 — ${rel} has no old-hook imports`, () => {
      const src = readFileSync(resolve(__dirname, "..", rel), "utf-8");
      // Strip out comments first so doc-mentions of legacy hook names
      // (e.g. "// useTenant().setSettings used to ...") don't trip the
      // negative checks. Then assert only against runtime code.
      const code = src
        // strip /* … */ block comments
        .replace(/\/\*[\s\S]*?\*\//g, "")
        // strip // line comments
        .replace(/^\s*\/\/.*$/gm, "");

      // Negative: old-hook imports MUST be gone.
      expect(code).not.toMatch(/from "@\/app\/contexts\/AuthContext"/);
      expect(code).not.toMatch(/from "@\/app\/contexts\/ScopeContext"/);
      expect(code).not.toMatch(/from "@\/app\/contexts\/TenantContext"/);
      expect(code).not.toMatch(/\buseAuth\s*[(]/);
      expect(code).not.toMatch(/\buseScope\s*[(]/);
      expect(code).not.toMatch(/\buseTenant\s*[(]/);
      expect(code).not.toMatch(/\buseHasPermission\s*[(]/);
      // Direct legacy-shape reads: match `user.workspace_id` /
      // `user?.workspace_id` but NOT `sentinel_user.workspace_id` /
      // `sentinel_user?.workspace_id` (Sentinel exposes the field by
      // design — that's the migration target, not the smell).
      expect(code).not.toMatch(/(?<!sentinel_)user[?]?\.subscription_id/);
      expect(code).not.toMatch(/(?<!sentinel_)user[?]?\.workspace_id/);
    });

    it(`AC2 — ${rel} imports useSentinel`, () => {
      const src = readFileSync(resolve(__dirname, "..", rel), "utf-8");
      expect(src).toMatch(/from "@\/app\/sentinel"/);
      expect(src).toMatch(/useSentinel\s*[(]/);
    });
  }
});
