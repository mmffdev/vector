import { test, expect, Page } from "@playwright/test";

// E2E spec for the work-items drag-and-drop adoption (PLA-0003).
// Mirrors dev/tests/playwright/rank-drag.spec.ts but is scoped to
// /work-items and asserts:
//   1. A leaf-row drag persists across reload (the server committed
//      the move — not just optimistic state).
//   2. Dragging a parent row paints every visible descendant with
//      the dragging style, demonstrating the visual subtree-bundle
//      ghost shipped in story 00215.
//
// Auth: uses the dedicated test user `claude@mmffdev.com / password`
// created on 2026-05-02 (see memory: test_account_claude.md).

const LOGIN_EMAIL = "claude@mmffdev.com";
const LOGIN_PASSWORD = "password";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(LOGIN_EMAIL);
  await page.getByLabel(/password/i).fill(LOGIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Title is the 4th td.table__cell on a work-items row (after drag,
// toggle, tag). Read it instead of relying on a class that doesn't
// exist on the row (rank-drag.spec.ts uses .wi-row__title which is a
// future selector — keep this spec tied to current markup).
async function visibleWorkItemTitles(page: Page): Promise<string[]> {
  return page.$$eval("tr[data-rank-row-id]", (rows) =>
    rows
      .map((r) => {
        const cells = r.querySelectorAll<HTMLTableCellElement>("td.table__cell");
        // Cells in order: toggle, tag, title, status, priority, points.
        return cells[2]?.textContent?.trim() ?? "";
      })
      .filter(Boolean)
  );
}

test.describe("work-items drag-and-drop", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("leaf row drag persists across reload", async ({ page }) => {
    await page.goto("/work-items");
    // Wait for at least one rendered row before snapshotting.
    await page.locator("tr[data-rank-row-id]").first().waitFor();

    const before = await visibleWorkItemTitles(page);
    test.skip(before.length < 2, "need at least 2 work items to test drag");

    const handle1 = page
      .locator(`tr[data-rank-row-id]`)
      .nth(0)
      .locator(".drag-handle-cell");
    const target = page.locator(`tr[data-rank-row-id]`).nth(1);

    await handle1.hover();
    await page.mouse.down();
    const box = await target.boundingBox();
    if (!box) throw new Error("target row has no bounding box");
    // Drop into the lower half of row 2 → "below" intent.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
    await page.mouse.up();

    // Optimistic order should diverge from `before`. Poll briefly to
    // tolerate the optimistic-then-server-reconcile cycle.
    await expect
      .poll(async () => visibleWorkItemTitles(page))
      .not.toEqual(before);
    const afterOptimistic = await visibleWorkItemTitles(page);

    await page.reload();
    await page.locator("tr[data-rank-row-id]").first().waitFor();
    const afterReload = await visibleWorkItemTitles(page);
    expect(afterReload).toEqual(afterOptimistic);
  });

  test("dragging a parent paints its descendants with the dragging style", async ({
    page,
  }) => {
    await page.goto("/work-items");
    await page.locator("tr[data-rank-row-id]").first().waitFor();

    // A parent row carries an active expander button (collapsed
    // children also count — clicking it expands, after which the
    // descendants render). We need a parent whose children are
    // visible so the subtree-ghost can be observed.
    const expander = page
      .locator("tr[data-rank-row-id] button.btn--row-expander")
      .first();
    test.skip(
      !(await expander.count()),
      "no parent rows visible — fixture lacks hierarchy"
    );

    // Expand if collapsed (icon class --open is the open marker).
    const isOpen = await expander
      .locator(".work-items-tree__expander-icon--open")
      .count();
    if (!isOpen) await expander.click();

    // Wait for at least one child row to render.
    await expect
      .poll(async () => page.locator("tr[data-rank-row-id]").count())
      .toBeGreaterThan(1);

    const parentRow = expander.locator("xpath=ancestor::tr[1]");
    const handle = parentRow.locator(".drag-handle-cell");

    await handle.hover();
    await page.mouse.down();
    // Hold the drag mid-screen so the dragging styles settle. We do
    // NOT release — releasing would either drop on self (no-op) or
    // commit a real move (out of scope for this assertion).
    await page.mouse.move(200, 400);

    const draggingRows = page.locator("tr.drag-row--dragging");
    // Parent + at least one descendant must carry the dragging class.
    await expect
      .poll(async () => draggingRows.count())
      .toBeGreaterThan(1);
    await page.mouse.up();
  });
});
