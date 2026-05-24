// @sentinel — PLA062 S23 — cross-tenant isolation e2e (Playwright).
//
// Procurement-grade proof that Sentinel's clamp prevents one tenant's
// session from reading another tenant's artefacts. Three assertions:
//
//   1. Login as Alice (tenant A) and Bob (tenant B) sequentially.
//      Each /work-items list payload returns rows; assert ZERO overlap
//      of artefact IDs between the two responses.
//
//   2. Capture an artefact ID from Bob's payload; with Alice's session
//      cookies still loaded, attempt GET /samantha/v2/work-items/<bob_id>.
//      Assert 403 application/problem+json with type:
//      "/errors/sentinel/focus-not-in-tenant" (or "/cross-tenant" if a
//      future Sentinel error code distinguishes the two — see below).
//
//   3. Probe a forged focus param — Alice's JWT + ?focus=<bob_node_id>.
//      Assert 403 problem+json type "/errors/sentinel/focus-not-in-tenant"
//      AND that the inner handler did NOT run (no rows leaked).
//
// Fixtures required (DEFERRED — seed via S26 prerequisite work):
//   - claude-sentinel-a@mmffdev.com (tenant A, ≥1 work-item)
//   - claude-sentinel-b@mmffdev.com (tenant B, ≥1 work-item)
//   - Both with password "password" (matching the project's other
//     Playwright fixtures — never the human gadmin/padmin/user accounts;
//     the CLAUDE.md HARD RULE forbids touching those).
//
// Until the fixture seeding lands, this spec is intentionally RED. It
// runs under `npm run test:sentinel:e2e` and the failure mode IS the
// signal: "two-tenant fixtures missing."

import { test, expect } from "@playwright/test";

const TENANT_A = { email: "claude-sentinel-a@mmffdev.com", password: "password" };
const TENANT_B = { email: "claude-sentinel-b@mmffdev.com", password: "password" };

async function login(page, creds) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByLabel(/password/i).press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 8000 });
}

async function listWorkItems(page) {
  // Re-issue the /work-items list call directly so we capture the wire
  // payload, not the rendered grid. Routes through the same JWT cookie
  // the browser session holds.
  const response = await page.request.get("/_site/work-items?limit=100");
  expect(response.status(), `work-items list status for ${page.url()}`).toBe(200);
  const body = await response.json();
  return body.items ?? body.rows ?? [];
}

test.describe("@sentinel cross-tenant isolation (PLA062 S23)", () => {
  test("two tenants' /work-items lists have zero overlap of artefact IDs", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await login(pageA, TENANT_A);
    await login(pageB, TENANT_B);

    const itemsA = await listWorkItems(pageA);
    const itemsB = await listWorkItems(pageB);

    expect(itemsA.length, "tenant A should have ≥1 work-item fixture").toBeGreaterThan(0);
    expect(itemsB.length, "tenant B should have ≥1 work-item fixture").toBeGreaterThan(0);

    const idsA = new Set(itemsA.map((x) => x.id));
    const overlap = itemsB.filter((x) => idsA.has(x.id));
    expect(overlap, "tenant A and tenant B must NOT share artefact IDs").toEqual([]);

    await ctxA.close();
    await ctxB.close();
  });

  test("Alice's session GET on Bob's artefact returns 403 problem+json (cross-tenant clamp)", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await login(pageA, TENANT_A);
    await login(pageB, TENANT_B);

    const itemsB = await listWorkItems(pageB);
    expect(itemsB.length).toBeGreaterThan(0);
    const bobId = itemsB[0].id;

    // Alice's session tries to read Bob's artefact directly.
    const response = await pageA.request.get(`/samantha/v2/work-items/${bobId}`);
    expect(response.status(), "cross-tenant GET must be denied").toBe(403);

    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType, "must be RFC 9457 problem+json").toContain("application/problem+json");

    const body = await response.json();
    expect(body.type, "problem+json type must indicate the Sentinel cross-tenant clamp").toMatch(
      /\/errors\/sentinel\/(focus-not-in-tenant|cross-tenant)/,
    );

    await ctxA.close();
    await ctxB.close();
  });

  test("Alice's JWT + Bob's ?focus= returns 403 focus-not-in-tenant (forged focus)", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await login(pageA, TENANT_A);
    await login(pageB, TENANT_B);

    // Get one of Bob's grants — its node_id is the topology node we
    // forge into Alice's ?focus=. Sentinel's middleware MUST refuse it.
    const sentinelB = await pageB.request.get("/_site/sentinel/boot");
    expect(sentinelB.status()).toBe(200);
    const bootB = await sentinelB.json();
    const bobNodeId = bootB?.grants?.[0]?.node_id;
    expect(bobNodeId, "tenant B fixture must seed at least one grant").toBeTruthy();

    const response = await pageA.request.get(`/_site/work-items?focus=${bobNodeId}&limit=10`);
    expect(response.status(), "forged focus must be rejected by Sentinel").toBe(403);

    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/problem+json");
    const body = await response.json();
    expect(body.type).toBe("/errors/sentinel/focus-not-in-tenant");

    await ctxA.close();
    await ctxB.close();
  });
});
