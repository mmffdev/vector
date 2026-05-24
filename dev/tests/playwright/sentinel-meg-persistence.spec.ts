import { test, expect, Page } from "@playwright/test";

// E2E test for the Sentinel ?meg= URL-mirror contract.
//
// Bug origin (2026-05-24, fix commit c52af181):
//   `app/sentinel/SentinelProvider.tsx` URL-mirror effect was missing
//   `pathname` from its dep array. Next.js router.push() drops query
//   params; without the dep, the effect didn't re-fire on the new
//   route and ?meg= stayed bare after every navigation. Every page
//   that mounted ObjectTreeV2 then sent scope-less wire requests
//   under (work-items|portfolio-items)/*, which combined with the
//   ghost-localStorage fallback in api.ts::withForwardedMeg (also
//   fixed in the same commit) led to 403 scope_read_denied and an
//   empty grid.
//
// Pinned at the unit level by Case 20 in
// `app/sentinel/__tests__/sentinel_provider.test.tsx`. THIS spec
// pins it at the integration level — a real browser, a real login,
// real Next.js client-side navigation across multiple routes,
// asserting ?meg= is in the URL at every landing.
//
// See:
//   - TD-SCOPE-GHOST-LS-READS (S1) in docs/c_tech_debt.md
//   - TD-SENT-URL-MIRROR-PATHNAME (S2) in docs/c_tech_debt.md
//   - docs/Security/Sentinel/sentinel_docs.md

const LOGIN_EMAIL = "padmin@mmffdev.com";
const LOGIN_PASSWORD = "TestPass1!";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(LOGIN_EMAIL);
  await page.getByLabel(/password/i).fill(LOGIN_PASSWORD);
  // Submit via Enter — `next dev --turbo` mounts a <nextjs-portal>
  // overlay that intercepts pointer events on the submit button.
  await page.getByLabel(/password/i).press("Enter");
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 3000 });
  } catch {
    await page.getByRole("button", { name: /sign in/i }).click({ force: true });
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns the value of the ?meg= query param on the current page URL,
// or null if absent. Polls briefly because the URL-mirror effect runs
// in a useEffect after boot, so the URL may not be stamped on the
// first render of a freshly-navigated route.
async function megParam(page: Page, timeoutMs = 3000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = new URL(page.url());
    const meg = url.searchParams.get("meg");
    if (meg) return meg;
    await page.waitForTimeout(100);
  }
  const url = new URL(page.url());
  return url.searchParams.get("meg");
}

test.describe("Sentinel ?meg= URL persistence across navigation (TD-SENT-URL-MIRROR-PATHNAME)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("?meg= is present on every navigation target — Dashboard → Value Status → Work Items → Value Sprint", async ({ page }) => {
    // Step 1 — fresh login lands somewhere (default: /dashboard). The
    // URL-mirror effect runs after boot and stamps ?meg=<focus>.
    await page.waitForLoadState("networkidle");
    const megDashboard = await megParam(page);
    expect(megDashboard, "post-login landing page must carry ?meg=").not.toBeNull();
    expect(megDashboard).toMatch(UUID_RE);

    // Step 2 — navigate to Value Status (a meg-less page that mounts
    // no ObjectTreeV2). Without the pathname dep on the URL-mirror
    // effect, the URL would arrive bare and never be re-stamped.
    await page.goto("/value-status");
    await page.waitForLoadState("networkidle");
    const megValueStatus = await megParam(page);
    expect(megValueStatus, "Value Status must carry ?meg= after navigation").not.toBeNull();
    expect(megValueStatus).toMatch(UUID_RE);
    expect(megValueStatus).toBe(megDashboard); // focus doesn't change on nav

    // Step 3 — navigate to Work Items (mounts ObjectTreeV2 + fires
    // /_site/work-items/facets|flow-states|... which depend on ?meg=
    // being correct on the wire request).
    await page.goto("/work-items");
    await page.waitForLoadState("networkidle");
    const megWorkItems = await megParam(page);
    expect(megWorkItems, "Work Items must carry ?meg= after navigation").not.toBeNull();
    expect(megWorkItems).toBe(megDashboard);

    // Step 4 — navigate to Value Sprint (the original repro page).
    // This is the canonical regression site: pre-fix, ObjectTreeV2
    // rendered empty because the wire layer sent scope-less requests
    // (or worse, stale ghost-localStorage UUIDs) and the backend
    // returned 403 scope_read_denied.
    await page.goto("/value-sprint");
    await page.waitForLoadState("networkidle");
    const megValueSprint = await megParam(page);
    expect(megValueSprint, "Value Sprint must carry ?meg= after navigation").not.toBeNull();
    expect(megValueSprint).toBe(megDashboard);
  });

  test("hard refresh on a meg-less URL re-stamps ?meg= from Sentinel state", async ({ page }) => {
    // Navigate so the URL is established, then manually strip ?meg=
    // via history.replaceState (mirrors a bookmark / hand-typed URL
    // without the param).
    await page.goto("/value-sprint");
    await page.waitForLoadState("networkidle");
    expect(await megParam(page)).not.toBeNull();

    // Strip the query and hard-reload — the URL-mirror effect must
    // re-stamp ?meg= after Sentinel boots on the fresh page load.
    await page.evaluate(() => {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    const meg = await megParam(page);
    expect(meg, "?meg= must be re-stamped after hard-refresh of a meg-less URL").not.toBeNull();
    expect(meg).toMatch(UUID_RE);
  });
});
