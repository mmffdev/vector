import { test, expect, Page } from "@playwright/test";

// E2E test for the generic ranking feature: a padmin can grab the
// drag handle on a work-item row, drop it above/below another row,
// and the new order persists across a page reload (the server has
// committed the move, not just shifted client state).
//
// The "subtree bundles with parent" assertion lives at the visual
// level — when dragging a parent, every visible descendant row also
// shows the dragging style (opacity 0.5, .drag-row--dragging class).
// We do NOT try to drop into a different parent; v1 blocks
// reparenting and the spec asserts that path is unreachable.

const LOGIN_EMAIL = "padmin@mmffdev.com";
const LOGIN_PASSWORD = "TestPass1!";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(LOGIN_EMAIL);
  await page.getByLabel(/password/i).fill(LOGIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function visibleWorkItemTitles(page: Page): Promise<string[]> {
  return page.$$eval(
    "tr[data-rank-row-id]",
    (rows) =>
      rows
        .map((r) => r.querySelector(".wi-row__title")?.textContent?.trim() ?? "")
        .filter(Boolean)
  );
}

test.describe("rank drag-and-drop", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("dropping row 2 above row 1 reorders and persists", async ({ page }) => {
    await page.goto("/work-items");
    const before = await visibleWorkItemTitles(page);
    test.skip(before.length < 2, "need at least 2 work items to test drag");

    const handle1 = page.locator(`tr[data-rank-row-id]`).nth(0).locator(".drag-handle-cell");
    const target = page.locator(`tr[data-rank-row-id]`).nth(1);

    await handle1.hover();
    await page.mouse.down();
    const box = await target.boundingBox();
    if (!box) throw new Error("target row has no bounding box");
    // Drop into the lower half of row 2 → "below"
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
    await page.mouse.up();

    await expect.poll(async () => visibleWorkItemTitles(page)).not.toEqual(before);
    const afterOptimistic = await visibleWorkItemTitles(page);

    await page.reload();
    const afterReload = await visibleWorkItemTitles(page);
    expect(afterReload).toEqual(afterOptimistic);
  });

  test("dragging a parent shows its children with the dragging style", async ({ page }) => {
    await page.goto("/work-items");
    const parent = page.locator("tr[data-rank-row-id][data-has-children='true']").first();
    test.skip(!(await parent.count()), "no parent rows visible — fixture lacks hierarchy");

    const handle = parent.locator(".drag-handle-cell");
    await handle.hover();
    await page.mouse.down();
    // Hold the drag mid-screen so the styles settle; we don't drop.
    await page.mouse.move(200, 400);

    const draggingRows = page.locator("tr.drag-row--dragging");
    const count = await draggingRows.count();
    expect(count).toBeGreaterThan(1); // parent + at least one child
    await page.mouse.up();
  });
});
