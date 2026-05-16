import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tenantSettingsApi } from "@/app/lib/tenantSettingsApi";
import { ApiError } from "@/app/lib/api";
import { installFetchStub, restoreFetch, type FetchStub } from "./_fetchStub";

// TD-TEST-003 remainder — wire-shape contract tests for the
// tenant-settings typed client (PLA-0050 / Story 00571).
//
// Goal: lock in the contract that the frontend depends on, so a future
// rename of a JSON tag, a route change, or a switch from PATCH-with-JSON
// to something else breaks at `npm test`, not at "the page shows
// 'Something went wrong'".
//
// Covered surface:
//   1. GET hits /_site/tenant-settings with no body, returns parsed JSON.
//   2. PATCH sends JSON body, sets Content-Type, returns parsed JSON.
//   3. PATCH respects "empty string clears nullable" empty-string contract.
//   4. 422 responses turn into ApiError carrying the violations[] array.
//   5. 500 responses turn into ApiError carrying status/detail.
//
// Out of scope (already covered by handler tests):
//   - Auth refresh-and-retry flow (app/lib/api.ts _fetch path).
//   - CSRF cookie handling (covered by AuthContext tests).

const SITE_BASE = "http://localhost:5100/_site";

describe("tenantSettingsApi (TD-TEST-003 remainder)", () => {
  let fx: FetchStub;
  beforeEach(() => {
    fx = installFetchStub();
  });
  afterEach(() => {
    restoreFetch();
  });

  it("GET hits /_site/tenant-settings and returns parsed JSON", async () => {
    const fixture = {
      tenant_id: "00000000-0000-0000-0000-000000000001",
      tenant_name: "MMFFDev",
      tenant_description: null,
      tenant_primary_contact_email: null,
      tenant_data_region: "use1",
      tenant_timezone: "Europe/London",
      tenant_date_format: "DD/MM/YYYY",
      tenant_datetime_format: "DD/MM/YYYY HH:mm",
      tenant_workdays: ["mon", "tue", "wed", "thu", "fri"],
      tenant_week_start: "mon",
      tenant_rank_method: "dragdrop",
      tenant_build_changeset_tracking: false,
      tenant_notes: null,
      tenant_created_at: "2026-05-15T16:18:24.492023Z",
      tenant_updated_at: "2026-05-15T16:18:24.492023Z",
      tenant_archived_at: null,
    };
    fx.queue.push({ status: 200, body: fixture });

    const got = await tenantSettingsApi.get();

    expect(fx.calls).toHaveLength(1);
    expect(fx.calls[0].url).toBe(`${SITE_BASE}/tenant-settings`);
    expect(fx.calls[0].method).toBe("GET");
    expect(fx.calls[0].body).toBeUndefined();
    expect(got).toEqual(fixture);
  });

  it("PATCH sends JSON body and Content-Type, returns parsed JSON", async () => {
    const before = {
      tenant_id: "00000000-0000-0000-0000-000000000001",
      tenant_name: "MMFFDev",
      tenant_timezone: "Europe/London",
    };
    const after = { ...before, tenant_timezone: "America/New_York" };
    fx.queue.push({ status: 200, body: after });

    const got = await tenantSettingsApi.patch({ tenant_timezone: "America/New_York" });

    expect(fx.calls).toHaveLength(1);
    expect(fx.calls[0].url).toBe(`${SITE_BASE}/tenant-settings`);
    expect(fx.calls[0].method).toBe("PATCH");
    // Headers are case-insensitive; the global `Headers` object lower-cases
    // every key, so we look it up in both spellings to make this assertion
    // robust to future capitalisation drift in _fetch.
    const contentType = fx.calls[0].headers["content-type"] ?? fx.calls[0].headers["Content-Type"];
    expect(contentType).toBe("application/json");
    expect(fx.calls[0].body).toEqual({ tenant_timezone: "America/New_York" });
    expect(got.tenant_timezone).toBe("America/New_York");
  });

  it("PATCH preserves explicit null for nullable text (clear-via-null contract)", async () => {
    fx.queue.push({ status: 200, body: { tenant_notes: null } });

    await tenantSettingsApi.patch({ tenant_notes: null });

    // JSON.stringify keeps `null` in the payload — that's how the backend
    // distinguishes "absent" (no change) from "explicit null" (clear).
    expect(fx.calls[0].body).toEqual({ tenant_notes: null });
  });

  it("422 ValidationError surfaces ApiError.violations[]", async () => {
    fx.queue.push({
      status: 422,
      body: {
        type: "about:blank",
        title: "Unprocessable Entity",
        status: 422,
        detail: "validation failed",
        violations: [
          { field: "tenant_data_region", message: "not a valid region code" },
        ],
      },
    });

    let err: unknown;
    try {
      await tenantSettingsApi.patch({ tenant_data_region: "not-a-region" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    const ae = err as ApiError;
    expect(ae.status).toBe(422);
    expect(ae.violations).toEqual([
      { field: "tenant_data_region", message: "not a valid region code" },
    ]);
  });

  it("500 InternalError surfaces ApiError with status+detail", async () => {
    fx.queue.push({
      status: 500,
      body: {
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "Something went wrong on our end. Please try again.",
      },
    });

    let err: unknown;
    try {
      await tenantSettingsApi.get();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    const ae = err as ApiError;
    expect(ae.status).toBe(500);
    expect(ae.detail).toBe("Something went wrong on our end. Please try again.");
  });
});
