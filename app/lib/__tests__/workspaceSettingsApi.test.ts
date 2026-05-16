import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  workspaceSettingsApi,
  INHERITABLE_FIELDS,
  type FieldSource,
  type WorkspaceSettings,
} from "@/app/lib/workspaceSettingsApi";
import { ApiError } from "@/app/lib/api";
import { installFetchStub, restoreFetch, type FetchStub } from "./_fetchStub";

// TD-TEST-003 remainder + PLA-0051 wire-shape lock-in — vitest specs
// for the workspace-settings typed client. Distinct from
// tenantSettingsApi specs because this client carries the inheritance
// contract: per-field `*_source` markers + `clear_overrides[]` PATCH
// semantics.
//
// Covered surface:
//   1. GET hits /_site/workspace-settings, returns parsed JSON with the
//      per-field _source markers.
//   2. PATCH with `clear_overrides` round-trips that array verbatim.
//   3. PATCH with an explicit value sends the value.
//   4. INHERITABLE_FIELDS const is the canonical list — locked here so a
//      mid-refactor edit doesn't silently shrink the set.
//   5. 422 ValidationError surfaces via ApiError.violations[].
//
// Out of scope (covered elsewhere):
//   - Backend COALESCE merge — service_inheritance_test.go (Go).
//   - Indicator render states — InheritanceIndicator.test.tsx.

const SITE_BASE = "http://localhost:5100/_site";

describe("workspaceSettingsApi (TD-TEST-003 + PLA-0051)", () => {
  let fx: FetchStub;
  beforeEach(() => {
    fx = installFetchStub();
  });
  afterEach(() => {
    restoreFetch();
  });

  it("GET returns Settings with per-field _source markers", async () => {
    const fixture: WorkspaceSettings = {
      tenant_id: "9f3a-…",
      tenant_name: "Engineering",
      tenant_description: null,
      tenant_owner_user_id: null,
      tenant_primary_contact_email: null,
      tenant_data_region: "use1",
      tenant_data_region_source: "tenant" as FieldSource,
      tenant_timezone: "Europe/London",
      tenant_timezone_source: "workspace" as FieldSource,
      tenant_date_format: "DD/MM/YYYY",
      tenant_date_format_source: "system_default" as FieldSource,
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

    const got = await workspaceSettingsApi.get();

    expect(fx.calls[0].url).toBe(`${SITE_BASE}/workspace-settings`);
    expect(fx.calls[0].method).toBe("GET");
    expect(got.tenant_data_region_source).toBe("tenant");
    expect(got.tenant_timezone_source).toBe("workspace");
    expect(got.tenant_date_format_source).toBe("system_default");
  });

  it("PATCH with clear_overrides[] round-trips the array verbatim", async () => {
    fx.queue.push({ status: 200, body: { tenant_id: "9f3a-…" } });

    await workspaceSettingsApi.patch({
      clear_overrides: ["tenant_timezone", "tenant_data_region"],
    });

    expect(fx.calls[0].method).toBe("PATCH");
    expect(fx.calls[0].body).toEqual({
      clear_overrides: ["tenant_timezone", "tenant_data_region"],
    });
  });

  it("PATCH with an explicit value sends the value", async () => {
    fx.queue.push({ status: 200, body: { tenant_id: "9f3a-…" } });

    await workspaceSettingsApi.patch({ tenant_timezone: "Asia/Tokyo" });

    expect(fx.calls[0].body).toEqual({ tenant_timezone: "Asia/Tokyo" });
  });

  it("INHERITABLE_FIELDS lists the 11 canonical fields", () => {
    expect(INHERITABLE_FIELDS).toEqual([
      "tenant_data_region",
      "tenant_timezone",
      "tenant_date_format",
      "tenant_datetime_format",
      "tenant_workdays",
      "tenant_week_start",
      "tenant_rank_method",
      "tenant_build_changeset_tracking",
      "tenant_primary_contact_email",
      "tenant_description",
      "tenant_notes",
    ]);
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
          { field: "clear_overrides[0]", message: "not an inheritable field" },
        ],
      },
    });

    let err: unknown;
    try {
      await workspaceSettingsApi.patch({
        // @ts-expect-error — sending an unknown clear_overrides entry to
        // exercise the backend's validation error surface.
        clear_overrides: ["unknown_field"],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    const ae = err as ApiError;
    expect(ae.status).toBe(422);
    expect(ae.violations?.[0]).toEqual({
      field: "clear_overrides[0]",
      message: "not an inheritable field",
    });
  });
});
