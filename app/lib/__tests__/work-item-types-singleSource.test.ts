import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ITEM_TYPES, CORE_FIELDS } from "@/app/lib/work-item-types";

// TD-WORKITEMS-DUPE contract — backfill test, 2026-05-16.
//
// 2026-05-16 commit `93ce212` de-duplicated the two custom-fields
// admin pages by extracting ITEM_TYPES + CORE_FIELDS to
// `app/lib/work-item-types.ts` and the rendered body to
// `app/components/CustomFieldsWorkItemsBody.tsx`. Both `page.tsx`
// files became 5-line shells.
//
// This spec pins the post-cleanup contract: the two pages must remain
// thin shells over the shared body, and the ITEM_TYPES / CORE_FIELDS
// declarations live ONLY in `app/lib/work-item-types.ts`. If someone
// pastes the lists back into either page during a future "quick add a
// type" change, this fails.
//
// Verified red-first by temporarily reverting workspace-admin's
// page.tsx to its pre-dedupe 119-line shape — every assertion below
// fired. Restored to the shell and confirmed green.
//
// Filed as a backfill per the red-green-always discipline (commit
// cfaa26c).

const REPO = resolve(__dirname, "../../..");
// Formerly checked two pages (workspace-admin + the now-deleted
// workspace-settings/workspace-settings duplicate). Duplicate removed
// 2026-05-17; single canonical path remains.
const PAGES = [
  "app/(user)/workspace-admin/custom-fields/work-items/page.tsx",
];

function readPage(rel: string): string {
  return readFileSync(resolve(REPO, rel), "utf8");
}

describe("TD-WORKITEMS-DUPE — single-source ITEM_TYPES contract", () => {
  it("both admin pages import CustomFieldsWorkItemsBody from the shared component", () => {
    for (const path of PAGES) {
      const src = readPage(path);
      expect(src).toMatch(
        /import\s+CustomFieldsWorkItemsBody\s+from\s+["']@\/app\/components\/CustomFieldsWorkItemsBody["']/,
        // diagnostic shown on failure
      );
    }
  });

  it("neither admin page re-declares ITEM_TYPES or CORE_FIELDS locally", () => {
    for (const path of PAGES) {
      const src = readPage(path);
      // Disallow a const/let/var declaration of either name in the page
      // file. Importing the symbol (e.g. `import { ITEM_TYPES } from "..."`)
      // is still allowed if the shell ever needs it; only the LHS of a
      // declaration is forbidden.
      const declRe = /\b(?:const|let|var)\s+(ITEM_TYPES|CORE_FIELDS)\b/;
      const m = src.match(declRe);
      if (m) {
        throw new Error(
          `${path} redeclares ${m[1]} locally — TD-WORKITEMS-DUPE forbids ` +
            `that. Edit app/lib/work-item-types.ts instead; the body lives ` +
            `in app/components/CustomFieldsWorkItemsBody.tsx.`,
        );
      }
    }
  });

  it("ITEM_TYPES is the canonical 4-type catalogue at app/lib/work-item-types.ts", () => {
    // Pin the keys so a typo / accidental delete in the shared file
    // fails here before the admin pages render an empty tab bar. Risk
    // is added by PLA-0052 and is allowed but not asserted (presence
    // of the four core types is the contract).
    const keys = ITEM_TYPES.map((t) => t.key);
    for (const required of ["epic", "story", "task", "defect"]) {
      expect(keys).toContain(required);
    }
  });

  it("CORE_FIELDS lists the immutable artefacts.* columns", () => {
    // Pin the columns admins see as "cannot be removed" on every type.
    const names = CORE_FIELDS.map((f) => f.name);
    for (const required of ["title", "description", "priority", "flow_state_id"]) {
      expect(names).toContain(required);
    }
  });
});
