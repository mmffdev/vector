"use client";

// Organisation settings page — single-record editor for master_record_tenant.
// Backend: backend/internal/tenantsettings (PATCH validates server-side
// and returns 422 with violations[] on failure). Wire shape lives in
// app/lib/workspaceSettingsApi.ts.
//
// UX contract:
//   • Form state is seeded from the server on mount; every field is
//     controlled, including ones that previously used `defaultValue`.
//   • tenant_id is a static identifier — rendered disabled with a
//     hint so users know not to ask support to "change" it.
//   • Each field tracks its dirty state by comparison against the
//     last-saved snapshot. The UnsavedChangesBar appears the moment
//     anything diverges; clicking Discard reverts to the snapshot,
//     clicking Accept PATCHes only the changed keys.
//   • Server-side validation errors land as ApiError.violations and
//     are rendered inline beneath the offending field. Client-side
//     mirrors the same rules so users get immediate feedback.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import ToggleBtn from "@/app/components/ToggleBtn";
import UnsavedChangesBar from "@/app/components/UnsavedChangesBar";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { useTenant } from "@/app/contexts/TenantContext";
import { ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import {
  workspaceSettingsApi,
  type DayCode,
  type RankMethod,
  type WorkspaceSettings,
  type WorkspaceSettingsPatch,
  type WeekStart,
} from "@/app/lib/workspaceSettingsApi";

const REGIONS: Array<{ group: string; options: Array<{ value: string; label: string }> }> = [
  {
    group: "North America",
    options: [
      { value: "use1",  label: "US East (N. Virginia)" },
      { value: "use2",  label: "US East (Ohio)" },
      { value: "usw2",  label: "US West (Oregon)" },
      { value: "usw1",  label: "US West (N. California)" },
      { value: "cac1",  label: "Canada (Central)" },
      { value: "caw1",  label: "Canada (Calgary)" },
    ],
  },
  {
    group: "South America",
    options: [
      { value: "sae1",  label: "South America (São Paulo)" },
    ],
  },
  {
    group: "Europe",
    options: [
      { value: "euw1",  label: "Europe (Ireland)" },
      { value: "euw2",  label: "Europe (London)" },
      { value: "euw3",  label: "Europe (Paris)" },
      { value: "euc1",  label: "Europe (Frankfurt)" },
      { value: "eun1",  label: "Europe (Stockholm)" },
    ],
  },
  {
    group: "Middle East & Africa",
    options: [
      { value: "mec1",  label: "Middle East (UAE)" },
      { value: "mes1",  label: "Middle East (Bahrain)" },
      { value: "afs1",  label: "Africa (Cape Town)" },
    ],
  },
  {
    group: "Asia Pacific",
    options: [
      { value: "aps1",  label: "Asia Pacific (Mumbai)" },
      { value: "apse1", label: "Asia Pacific (Singapore)" },
      { value: "apne1", label: "Asia Pacific (Tokyo)" },
      { value: "apne2", label: "Asia Pacific (Seoul)" },
      { value: "apse2", label: "Asia Pacific (Sydney)" },
      { value: "ape1",  label: "Asia Pacific (Hong Kong)" },
    ],
  },
];

const TIMEZONES = [
  { value: "Pacific/Pago_Pago",              label: "(UTC−11:00) Samoa" },
  { value: "Pacific/Honolulu",               label: "(UTC−10:00) Hawaii" },
  { value: "America/Anchorage",              label: "(UTC−09:00) Alaska" },
  { value: "America/Los_Angeles",            label: "(UTC−08:00) Pacific Time (US & Canada)" },
  { value: "America/Denver",                 label: "(UTC−07:00) Mountain Time (US & Canada)" },
  { value: "America/Phoenix",                label: "(UTC−07:00) Arizona" },
  { value: "America/Chicago",                label: "(UTC−06:00) Central Time (US & Canada)" },
  { value: "America/Mexico_City",            label: "(UTC−06:00) Mexico City" },
  { value: "America/New_York",               label: "(UTC−05:00) Eastern Time (US & Canada)" },
  { value: "America/Bogota",                 label: "(UTC−05:00) Bogota, Lima" },
  { value: "America/Caracas",                label: "(UTC−04:30) Caracas" },
  { value: "America/Halifax",                label: "(UTC−04:00) Atlantic Time (Canada)" },
  { value: "America/Santiago",               label: "(UTC−04:00) Santiago" },
  { value: "America/St_Johns",               label: "(UTC−03:30) Newfoundland" },
  { value: "America/Sao_Paulo",              label: "(UTC−03:00) Brasilia" },
  { value: "America/Argentina/Buenos_Aires", label: "(UTC−03:00) Buenos Aires" },
  { value: "Atlantic/Azores",                label: "(UTC−01:00) Azores" },
  { value: "Europe/London",                  label: "(UTC+00:00) London, Dublin, Edinburgh" },
  { value: "Europe/Paris",                   label: "(UTC+01:00) Paris, Amsterdam, Brussels" },
  { value: "Europe/Berlin",                  label: "(UTC+01:00) Berlin, Rome, Stockholm" },
  { value: "Europe/Madrid",                  label: "(UTC+01:00) Madrid, Barcelona" },
  { value: "Europe/Athens",                  label: "(UTC+02:00) Athens, Helsinki, Bucharest" },
  { value: "Europe/Istanbul",                label: "(UTC+03:00) Istanbul" },
  { value: "Europe/Moscow",                  label: "(UTC+03:00) Moscow, St. Petersburg" },
  { value: "Asia/Riyadh",                    label: "(UTC+03:00) Riyadh, Kuwait, Baghdad" },
  { value: "Asia/Tehran",                    label: "(UTC+03:30) Tehran" },
  { value: "Asia/Dubai",                     label: "(UTC+04:00) Dubai, Abu Dhabi, Muscat" },
  { value: "Asia/Kabul",                     label: "(UTC+04:30) Kabul" },
  { value: "Asia/Karachi",                   label: "(UTC+05:00) Islamabad, Karachi" },
  { value: "Asia/Kolkata",                   label: "(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi" },
  { value: "Asia/Kathmandu",                 label: "(UTC+05:45) Kathmandu" },
  { value: "Asia/Dhaka",                     label: "(UTC+06:00) Dhaka, Astana" },
  { value: "Asia/Rangoon",                   label: "(UTC+06:30) Yangon (Rangoon)" },
  { value: "Asia/Bangkok",                   label: "(UTC+07:00) Bangkok, Hanoi, Jakarta" },
  { value: "Asia/Singapore",                 label: "(UTC+08:00) Singapore, Kuala Lumpur" },
  { value: "Asia/Hong_Kong",                 label: "(UTC+08:00) Hong Kong, Beijing, Taipei" },
  { value: "Australia/Perth",                label: "(UTC+08:00) Perth" },
  { value: "Asia/Tokyo",                     label: "(UTC+09:00) Tokyo, Seoul, Osaka" },
  { value: "Australia/Darwin",               label: "(UTC+09:30) Darwin" },
  { value: "Australia/Adelaide",             label: "(UTC+09:30) Adelaide" },
  { value: "Australia/Sydney",               label: "(UTC+10:00) Sydney, Melbourne, Canberra" },
  { value: "Australia/Brisbane",             label: "(UTC+10:00) Brisbane" },
  { value: "Pacific/Noumea",                 label: "(UTC+11:00) Solomon Islands, Magadan" },
  { value: "Pacific/Auckland",               label: "(UTC+12:00) Auckland, Wellington" },
  { value: "Pacific/Fiji",                   label: "(UTC+12:00) Fiji" },
  { value: "Pacific/Apia",                   label: "(UTC+13:00) Samoa (Apia)" },
];

const DATE_FORMATS = [
  { value: "DD/MM/YYYY",   label: "DD/MM/YYYY  (e.g. 29/04/2026)" },
  { value: "MM/DD/YYYY",   label: "MM/DD/YYYY  (e.g. 04/29/2026)" },
  { value: "YYYY-MM-DD",   label: "YYYY-MM-DD  (e.g. 2026-04-29)" },
  { value: "DD-MMM-YYYY",  label: "DD-MMM-YYYY  (e.g. 29-Apr-2026)" },
  { value: "D MMMM YYYY",  label: "D MMMM YYYY  (e.g. 29 April 2026)" },
  { value: "MMMM D, YYYY", label: "MMMM D, YYYY  (e.g. April 29, 2026)" },
];

const DATETIME_FORMATS = [
  { value: "DD/MM/YYYY HH:mm",   label: "DD/MM/YYYY HH:mm  (e.g. 29/04/2026 14:30)" },
  { value: "MM/DD/YYYY hh:mm a", label: "MM/DD/YYYY hh:mm a  (e.g. 04/29/2026 02:30 PM)" },
  { value: "YYYY-MM-DD HH:mm",   label: "YYYY-MM-DD HH:mm  (e.g. 2026-04-29 14:30)" },
  { value: "D MMM YYYY, HH:mm",  label: "D MMM YYYY, HH:mm  (e.g. 29 Apr 2026, 14:30)" },
];

const WEEKDAYS: Array<{ key: DayCode; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

// Fields the form actually edits. Keep this in sync with WorkspaceSettingsPatch.
type FormState = {
  tenant_name: string;
  tenant_description: string;
  tenant_data_region: string;
  tenant_timezone: string;
  tenant_date_format: string;
  tenant_datetime_format: string;
  tenant_workdays: Set<DayCode>;
  tenant_week_start: WeekStart;
  tenant_rank_method: RankMethod;
  tenant_build_changeset_tracking: boolean;
  tenant_notes: string;
  tenant_primary_contact_email: string;
};

function fromServer(row: WorkspaceSettings): FormState {
  return {
    tenant_name: row.tenant_name,
    tenant_description: row.tenant_description ?? "",
    tenant_data_region: row.tenant_data_region,
    tenant_timezone: row.tenant_timezone,
    tenant_date_format: row.tenant_date_format,
    tenant_datetime_format: row.tenant_datetime_format,
    tenant_workdays: new Set<DayCode>(row.tenant_workdays),
    tenant_week_start: row.tenant_week_start,
    tenant_rank_method: row.tenant_rank_method,
    tenant_build_changeset_tracking: row.tenant_build_changeset_tracking,
    tenant_notes: row.tenant_notes ?? "",
    tenant_primary_contact_email: row.tenant_primary_contact_email ?? "",
  };
}

// Build a minimal PATCH body containing only the keys that diverge
// from the original server snapshot. Sets are compared by membership;
// a nullable text that the user has cleared is sent as null so the
// server stores NULL rather than an empty string.
function diffPatch(orig: FormState, cur: FormState): WorkspaceSettingsPatch {
  const out: WorkspaceSettingsPatch = {};
  if (cur.tenant_name !== orig.tenant_name) out.tenant_name = cur.tenant_name;
  if (cur.tenant_description !== orig.tenant_description) out.tenant_description = cur.tenant_description === "" ? null : cur.tenant_description;
  if (cur.tenant_data_region !== orig.tenant_data_region) out.tenant_data_region = cur.tenant_data_region;
  if (cur.tenant_timezone !== orig.tenant_timezone) out.tenant_timezone = cur.tenant_timezone;
  if (cur.tenant_date_format !== orig.tenant_date_format) out.tenant_date_format = cur.tenant_date_format;
  if (cur.tenant_datetime_format !== orig.tenant_datetime_format) out.tenant_datetime_format = cur.tenant_datetime_format;
  if (!sameSet(orig.tenant_workdays, cur.tenant_workdays)) out.tenant_workdays = sortedDays(cur.tenant_workdays);
  if (cur.tenant_week_start !== orig.tenant_week_start) out.tenant_week_start = cur.tenant_week_start;
  if (cur.tenant_rank_method !== orig.tenant_rank_method) out.tenant_rank_method = cur.tenant_rank_method;
  if (cur.tenant_build_changeset_tracking !== orig.tenant_build_changeset_tracking) out.tenant_build_changeset_tracking = cur.tenant_build_changeset_tracking;
  if (cur.tenant_notes !== orig.tenant_notes) out.tenant_notes = cur.tenant_notes === "" ? null : cur.tenant_notes;
  if (cur.tenant_primary_contact_email !== orig.tenant_primary_contact_email) out.tenant_primary_contact_email = cur.tenant_primary_contact_email === "" ? null : cur.tenant_primary_contact_email;
  return out;
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function sortedDays(s: Set<DayCode>): DayCode[] {
  const order: DayCode[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return order.filter((d) => s.has(d));
}

// Mirror of backend validation. Keys match the server field names so
// violations[] from a 422 can merge into the same error map.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validateClient(s: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  const name = s.tenant_name.trim();
  if (name.length === 0) e.tenant_name = "Tenant name is required.";
  else if (name.length > 128) e.tenant_name = "Tenant name must be 128 characters or fewer.";
  if (s.tenant_description.length > 2000) e.tenant_description = "Description must be 2000 characters or fewer.";
  if (s.tenant_notes.length > 4000) e.tenant_notes = "Notes must be 4000 characters or fewer.";
  if (s.tenant_primary_contact_email.trim() !== "" && !EMAIL_RE.test(s.tenant_primary_contact_email.trim())) {
    e.tenant_primary_contact_email = "Enter a valid email address.";
  }
  if (s.tenant_workdays.size === 0) e.tenant_workdays = "Select at least one workday.";
  return e;
}

function WorkdaysPicker({
  value,
  onChange,
}: {
  value: Set<DayCode>;
  onChange: (next: Set<DayCode>) => void;
}) {
  function toggle(day: DayCode) {
    const next = new Set(value);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onChange(next);
  }
  return (
    <div className="workdays-picker">
      {WEEKDAYS.map((d) => (
        <button
          key={d.key}
          type="button"
          className={`workdays-picker__day${value.has(d.key) ? " workdays-picker__day--on" : ""}`}
          onClick={() => toggle(d.key)}
          aria-pressed={value.has(d.key)}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

function FeatureToggle({
  field,
  label,
  hint,
  value,
  onChange,
}: {
  field: string;
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="feature-toggle" data-field={field}>
      <div className="feature-toggle__text">
        <span className="feature-toggle__label">{label}</span>
        <span className="feature-toggle__hint">{hint}</span>
      </div>
      <ToggleBtn value={value} onChange={onChange} size="sm" />
    </div>
  );
}

export default function OrganisationPage() {
  const { user } = useAuth();
  const canAccess = useHasPermission("workspace.archive");
  const { setSettings: setTenantCtx } = useTenant();
  const router = useRouter();
  const { full } = usePageTitle();

  useEffect(() => {
    if (user && !canAccess) router.replace("/workspace-settings");
  }, [user, canAccess, router]);

  if (!user || !canAccess) return null;

  const [original, setOriginal] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Reflects the row's tenant_id from the server; falls back to
  // the auth context subscription_id if the fetch hasn't completed yet.
  const subscriptionId = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const row = await workspaceSettingsApi.get();
      subscriptionId.current = row.tenant_id;
      const seeded = fromServer(row);
      setOriginal(seeded);
      setForm(cloneState(seeded));
      setErrors({});
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!original || !form) return false;
    return Object.keys(diffPatch(original, form)).length > 0;
  }, [original, form]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  }, []);

  const onAccept = useCallback(async () => {
    if (!original || !form) return;
    const localErrors = validateClient(form);
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      notify.error("Please fix the highlighted fields before saving.");
      return;
    }
    const patch = diffPatch(original, form);
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const fresh = await workspaceSettingsApi.patch(patch);
      setTenantCtx(fresh);
      const seeded = fromServer(fresh);
      setOriginal(seeded);
      setForm(cloneState(seeded));
      setErrors({});
      notify.success("Tenant settings saved.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.violations) {
        const mapped: Record<string, string> = {};
        for (const v of err.violations) mapped[v.field] = v.message;
        setErrors(mapped);
        notify.error("Some fields failed validation. Please review and resave.");
      } else {
        notify.apiError(err, "Failed to save tenant settings.");
      }
    } finally {
      setSaving(false);
    }
  }, [original, form]);

  const onDiscard = useCallback(() => {
    if (!original) return;
    setForm(cloneState(original));
    setErrors({});
  }, [original]);

  if (loading) {
    return (
      <PageContent>
      <div className="settings-panel">
        <p className="form__hint">Loading tenant settings…</p>
      </div>
      </PageContent>
    );
  }

  if (loadError || !form || !original) {
    return (
      <PageContent>
      <div className="settings-panel">
        <p className="form__error">{loadError ?? "Could not load tenant settings."}</p>
        <div className="form__actions">
          <button type="button" className="btn btn--ghost" onClick={load}>Retry</button>
        </div>
      </div>
      </PageContent>
    );
  }

  const subId = subscriptionId.current ?? user?.subscription_id ?? "";

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Configure organisation structure and tenant master record settings." />
      <Panel
        name="panel_organisation_header"
        className="page-panel-heading"
        title="Organisation"
        description="Manage the tenant organisation record, including name, address, and structural configuration."
      />
    <div className="settings-panel">

      {/* ── Color Code Work Items (placeholder) ──────────────── */}
      <h3 className="eyebrow">Color Code Work Items</h3>
      <p className="form__hint">Placeholder — work item type colours will be configurable here.</p>

      {/* ── Identity ─────────────────────────────────────────── */}
      <h3 className="eyebrow">Identity</h3>
      <div className="form">
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_name">
            Tenant name
            <input
              type="text"
              id="tenant_name"
              name="tenant_name"
              className={`form__input${errors.tenant_name ? " has-error" : ""}`}
              value={form.tenant_name}
              maxLength={128}
              onChange={(e) => update("tenant_name", e.target.value)}
            />
            {errors.tenant_name && <span className="form__error">{errors.tenant_name}</span>}
          </label>
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_description">
            Description
            <textarea
              id="tenant_description"
              name="tenant_description"
              className={`form__input form__textarea${errors.tenant_description ? " has-error" : ""}`}
              rows={3}
              value={form.tenant_description}
              maxLength={2000}
              onChange={(e) => update("tenant_description", e.target.value)}
              placeholder="A brief description of this tenant and its purpose."
            />
            {errors.tenant_description && <span className="form__error">{errors.tenant_description}</span>}
          </label>
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_id">
            Tenant ID
            <input type="text" id="tenant_id" name="tenant_id" className="form__input t-mono" value={subId} disabled readOnly />
            <span className="form__hint">Static identifier for this tenant — reference this when contacting support. Cannot be edited.</span>
          </label>
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_data_region">
            Data region
            <select
              id="tenant_data_region"
              name="tenant_data_region"
              className={`form__select${errors.tenant_data_region ? " has-error" : ""}`}
              value={form.tenant_data_region}
              onChange={(e) => update("tenant_data_region", e.target.value)}
            >
              {REGIONS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {errors.tenant_data_region && <span className="form__error">{errors.tenant_data_region}</span>}
          </label>
        </div>
      </div>

      {/* ── Time & Dates ──────────────────────────────────────── */}
      <h3 className="eyebrow">Time &amp; Dates</h3>
      <div className="form">
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_timezone">
            Time zone
            <select
              id="tenant_timezone"
              name="tenant_timezone"
              className={`form__select${errors.tenant_timezone ? " has-error" : ""}`}
              value={form.tenant_timezone}
              onChange={(e) => update("tenant_timezone", e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
            {errors.tenant_timezone && <span className="form__error">{errors.tenant_timezone}</span>}
            <span className="form__hint">Dates represent fixed points in time for distributed team consistency.</span>
          </label>
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_date_format">
            Date format
            <select
              id="tenant_date_format"
              name="tenant_date_format"
              className={`form__select${errors.tenant_date_format ? " has-error" : ""}`}
              value={form.tenant_date_format}
              onChange={(e) => update("tenant_date_format", e.target.value)}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            {errors.tenant_date_format && <span className="form__error">{errors.tenant_date_format}</span>}
          </label>
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_datetime_format">
            Date &amp; time format
            <select
              id="tenant_datetime_format"
              name="tenant_datetime_format"
              className={`form__select${errors.tenant_datetime_format ? " has-error" : ""}`}
              value={form.tenant_datetime_format}
              onChange={(e) => update("tenant_datetime_format", e.target.value)}
            >
              {DATETIME_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            {errors.tenant_datetime_format && <span className="form__error">{errors.tenant_datetime_format}</span>}
          </label>
        </div>
      </div>

      {/* ── Workdays ─────────────────────────────────────────── */}
      <h3 className="eyebrow">Workdays</h3>
      <div className="form">
        <div className="form__row" data-field="tenant_workdays">
          <label className="form__label">Active workdays</label>
          <WorkdaysPicker value={form.tenant_workdays} onChange={(next) => update("tenant_workdays", next)} />
          {errors.tenant_workdays
            ? <span className="form__error">{errors.tenant_workdays}</span>
            : <span className="form__hint">
                {form.tenant_workdays.size === 0
                  ? "No workdays selected — at least one day is required."
                  : `${form.tenant_workdays.size} day${form.tenant_workdays.size === 1 ? "" : "s"} per week.`}
              </span>
          }
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_week_start">
            Week starts on
            <select
              id="tenant_week_start"
              name="tenant_week_start"
              className={`form__select${errors.tenant_week_start ? " has-error" : ""}`}
              value={form.tenant_week_start}
              onChange={(e) => update("tenant_week_start", e.target.value as WeekStart)}
            >
              <option value="mon">Monday</option>
              <option value="sun">Sunday</option>
            </select>
            {errors.tenant_week_start && <span className="form__error">{errors.tenant_week_start}</span>}
          </label>
        </div>
      </div>

      {/* ── Planning ─────────────────────────────────────────── */}
      <h3 className="eyebrow">Planning</h3>
      <div className="form">
        <div className="form__row" data-field="tenant_rank_method">
          <label className="form__label">Ranking method</label>
          <ToggleBtn
            value={form.tenant_rank_method === "dragdrop"}
            onChange={(v) => update("tenant_rank_method", v ? "dragdrop" : "manual")}
            labels={["Manual ranking", "Drag & drop ranking"]}
          />
          <span className="form__hint">
            {form.tenant_rank_method === "manual"
              ? "Users enter a numeric rank to set relative priority on backlog items."
              : "Users drag items on backlog and board views to establish priority."}
          </span>
        </div>
      </div>

      {/* ── Features ─────────────────────────────────────────── */}
      <h3 className="eyebrow">Features</h3>
      <div className="form">
        <FeatureToggle
          field="tenant_build_changeset_tracking"
          label="Build & changeset tracking"
          hint="Allows connectors (e.g. GitHub) to associate commits and build runs with work items."
          value={form.tenant_build_changeset_tracking}
          onChange={(v) => update("tenant_build_changeset_tracking", v)}
        />
      </div>

      {/* ── Notes ────────────────────────────────────────────── */}
      <h3 className="eyebrow">Notes</h3>
      <div className="form">
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_notes">
            Tenant notes
            <textarea
              id="tenant_notes"
              name="tenant_notes"
              className={`form__input form__textarea${errors.tenant_notes ? " has-error" : ""}`}
              rows={5}
              value={form.tenant_notes}
              maxLength={4000}
              onChange={(e) => update("tenant_notes", e.target.value)}
              placeholder="Internal notes, links, or context about this tenant."
            />
            {errors.tenant_notes && <span className="form__error">{errors.tenant_notes}</span>}
          </label>
        </div>
      </div>

      {/* ── Support contact ──────────────────────────────────── */}
      <h3 className="eyebrow">Support contact</h3>
      <div className="form">
        <div className="form__row">
          <label className="form__label" htmlFor="tenant_primary_contact_email">
            Primary contact email
            <input
              type="email"
              id="tenant_primary_contact_email"
              name="tenant_primary_contact_email"
              className={`form__input${errors.tenant_primary_contact_email ? " has-error" : ""}`}
              value={form.tenant_primary_contact_email}
              onChange={(e) => update("tenant_primary_contact_email", e.target.value)}
              placeholder="ops@example.com"
            />
            {errors.tenant_primary_contact_email && <span className="form__error">{errors.tenant_primary_contact_email}</span>}
            <span className="form__hint">Where MMFF support and incident notifications are sent.</span>
          </label>
        </div>
      </div>

      {/* ── Danger zone ──────────────────────────────────────── */}
      <h3 className="eyebrow">Danger zone</h3>
      <div className="danger-zone">
        <div>
          <p className="danger-zone__title">Archive tenant</p>
          <p className="danger-zone__desc">Removes user access and freezes content. Requires platform-admin confirmation.</p>
        </div>
        <button type="button" className="btn btn--danger" disabled>Archive…</button>
      </div>

      <UnsavedChangesBar
        dirty={dirty}
        saving={saving}
        message="You have unsaved changes to your tenant settings."
        onAccept={onAccept}
        onDiscard={onDiscard}
      />
    </div>
    </PageContent>
  );
}

function cloneState(s: FormState): FormState {
  return { ...s, tenant_workdays: new Set(s.tenant_workdays) };
}
