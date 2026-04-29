"use client";

/**
 * /workspace-settings — Story 00101 restyle.
 * gadmin-only tenant administration. The Users tab renders a
 * Vector .table-wrap + .table — sunken thead with eyebrow column
 * heads, 48px rows, hover lifts to --surface-sunken. Status
 * conveyed by .pill variants only (active=success, inactive=neutral,
 * pending pw=warning). Dates render in --ink-muted with
 * tabular-nums. No box-shadow, no gradient, no lime-green; one
 * primary button per region (the "+ New user" toolbar action).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTabState } from "@/app/hooks/useTabState";
import ToggleBtn from "@/app/components/ToggleBtn";
import PageShell from "@/app/components/PageShell";
import { useAuth, type Role } from "@/app/contexts/AuthContext";
import { api, ApiError } from "@/app/lib/api";

interface AdminUser {
  id: string;
  subscription_id: string;
  email: string;
  role: Role;
  is_active: boolean;
  last_login: string | null;
  force_password_change: boolean;
  created_at: string;
}

const TABS = ["organization", "users", "permissions"] as const;

export default function WorkspaceSettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useTabState(TABS, "organization");

  useEffect(() => {
    if (user && user.role !== "gadmin") router.replace("/dashboard");
  }, [user, router]);

  if (!user || user.role !== "gadmin") return null;

  // Story 00104 — Organization tab added as the default landing
  // tab so the workspace identity (display name, region, support
  // contact) is visible at a glance. Users + Permissions remain
  // the operational tabs that come after.
  return (
    <PageShell title="Workspace Settings" subtitle="Organization, user management, and tenant-level configuration">
      <div className="tabs">
        <TabButton active={tab === "organization"} onClick={() => setTab("organization")}>
          Organization
        </TabButton>
        <TabButton active={tab === "users"} onClick={() => setTab("users")}>
          Users
        </TabButton>
        <TabButton active={tab === "permissions"} onClick={() => setTab("permissions")}>
          Permissions
        </TabButton>
      </div>
      {tab === "organization" && <OrganizationTab />}
      {tab === "users" && <UsersTab />}
      {tab === "permissions" && <PermissionsTab />}
    </PageShell>
  );
}

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

function detectRegion(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.startsWith("America/")) {
      const east = ["America/New_York","America/Detroit","America/Indiana","America/Kentucky","America/Toronto","America/Montreal","America/Nassau","America/Havana","America/Port-au-Prince","America/Jamaica"];
      const sao  = ["America/Sao_Paulo","America/Fortaleza","America/Recife","America/Belem","America/Manaus","America/Cuiaba","America/Maceio","America/Buenos_Aires","America/Argentina","America/Lima","America/Bogota","America/Caracas","America/La_Paz","America/Santiago","America/Montevideo","America/Asuncion","America/Guayaquil","America/Cayenne","America/Paramaribo","America/Guyana"];
      if (sao.some(z => tz === z || tz.startsWith(z))) return "sae1";
      if (east.some(z => tz === z || tz.startsWith(z))) return "use1";
      if (tz === "America/Vancouver" || tz === "America/Los_Angeles") return "usw2";
      if (tz.startsWith("America/")) return "use1";
    }
    if (tz.startsWith("Europe/")) {
      if (["Europe/London","Europe/Dublin","Europe/Guernsey","Europe/Jersey","Europe/Isle_of_Man"].includes(tz)) return "euw2";
      if (["Europe/Paris","Europe/Brussels","Europe/Amsterdam","Europe/Luxembourg"].includes(tz)) return "euw3";
      if (["Europe/Berlin","Europe/Vienna","Europe/Zurich","Europe/Prague","Europe/Warsaw","Europe/Budapest","Europe/Bratislava","Europe/Bucharest","Europe/Belgrade","Europe/Zagreb","Europe/Ljubljana","Europe/Sarajevo","Europe/Skopje","Europe/Tirane"].includes(tz)) return "euc1";
      if (["Europe/Stockholm","Europe/Helsinki","Europe/Oslo","Europe/Copenhagen","Europe/Riga","Europe/Tallinn","Europe/Vilnius"].includes(tz)) return "eun1";
      return "euw1";
    }
    if (tz.startsWith("Asia/")) {
      if (["Asia/Tokyo","Asia/Sapporo"].includes(tz)) return "apne1";
      if (tz === "Asia/Seoul") return "apne2";
      if (["Asia/Singapore","Asia/Kuala_Lumpur"].includes(tz)) return "apse1";
      if (["Asia/Hong_Kong","Asia/Macau"].includes(tz)) return "ape1";
      if (["Asia/Kolkata","Asia/Calcutta","Asia/Colombo","Asia/Dhaka"].includes(tz)) return "aps1";
      if (["Asia/Dubai","Asia/Muscat","Asia/Riyadh","Asia/Kuwait","Asia/Qatar","Asia/Bahrain"].includes(tz)) return "mes1";
      return "apse1";
    }
    if (tz.startsWith("Australia/") || tz.startsWith("Pacific/")) return "apse2";
    if (tz.startsWith("Africa/")) return "afs1";
  } catch { /* fall through */ }
  return "use1";
}

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

function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.some(t => t.value === tz)) return tz;
    if (tz.startsWith("America/Indiana") || tz.startsWith("America/Kentucky")) return "America/New_York";
    if (tz.startsWith("America/North_Dakota")) return "America/Chicago";
    if (tz === "America/Montevideo" || tz === "America/Fortaleza") return "America/Sao_Paulo";
    if (tz === "Europe/Dublin" || tz === "Europe/Lisbon") return "Europe/London";
    if (["Europe/Warsaw","Europe/Vienna","Europe/Prague","Europe/Budapest"].includes(tz)) return "Europe/Berlin";
    if (tz === "Asia/Seoul" || tz === "Asia/Sapporo") return "Asia/Tokyo";
    if (tz === "Asia/Calcutta") return "Asia/Kolkata";
    if (tz.startsWith("Australia/")) return "Australia/Sydney";
  } catch { /* fall through */ }
  return "Europe/London";
}

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

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const WEEKDAYS: Array<{ key: DayKey; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function WorkdaysPicker({
  value,
  onChange,
}: {
  value: Set<DayKey>;
  onChange: (next: Set<DayKey>) => void;
}) {
  function toggle(day: DayKey) {
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
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="feature-toggle">
      <div className="feature-toggle__text">
        <span className="feature-toggle__label">{label}</span>
        <span className="feature-toggle__hint">{hint}</span>
      </div>
      <ToggleBtn value={value} onChange={onChange} size="sm" />
    </div>
  );
}

function OrganizationTab() {
  const [region, setRegion]                         = useState<string>(() => detectRegion());
  const [regionAutoDetected, setRegionAutoDetected] = useState(true);
  const [timezone, setTimezone]                     = useState<string>(() => detectTimezone());
  const [dateFormat, setDateFormat]                 = useState("DD/MM/YYYY");
  const [datetimeFormat, setDatetimeFormat]         = useState("DD/MM/YYYY HH:mm");
  const [workdays, setWorkdays]                     = useState<Set<DayKey>>(() => new Set<DayKey>(["mon","tue","wed","thu","fri"]));
  const [weekStart, setWeekStart]                   = useState<"mon" | "sun">("mon");
  const [projectAccess, setProjectAccess]           = useState("no_access");
  const [buildChangeset, setBuildChangeset]         = useState(false);
  const [autoUnblock, setAutoUnblock]               = useState(true);
  const [timeTracker, setTimeTracker]               = useState(false);
  const [rankMethod, setRankMethod]                 = useState<"manual" | "dragdrop">("dragdrop");
  const [notes, setNotes]                           = useState("");

  return (
    <div className="settings-panel">

      {/* ── Identity ─────────────────────────────────────────── */}
      <h3 className="eyebrow">Identity</h3>
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <div className="form__row">
          <label className="form__label">
            Workspace name
            <input type="text" className="form__input" defaultValue="MMFF Standard" />
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Description
            <textarea className="form__input form__textarea" rows={3} placeholder="A brief description of this workspace and its purpose." />
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Owner
            <select className="form__select" defaultValue="">
              <option value="" disabled>Select owner…</option>
              <option value="self">Me (current user)</option>
            </select>
            <span className="form__hint">The user responsible for this workspace.</span>
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Subscription ID
            <input type="text" className="form__input t-mono" value="sub_01HXKP9QV4ZK2N7M3BC5YJ8DRA" disabled />
            <span className="form__hint">Reference this when contacting support.</span>
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Data region
            <select
              className="form__select"
              value={region}
              onChange={(e) => { setRegion(e.target.value); setRegionAutoDetected(false); }}
            >
              {REGIONS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {regionAutoDetected && (
              <span className="form__hint">Auto-detected from your browser timezone.</span>
            )}
          </label>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">Save identity</button>
        </div>
      </form>

      {/* ── Time & Dates ──────────────────────────────────────── */}
      <h3 className="eyebrow">Time &amp; Dates</h3>
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <div className="form__row">
          <label className="form__label">
            Time zone
            <select className="form__select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
            <span className="form__hint">Dates represent fixed points in time for distributed team consistency.</span>
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Date format
            <select className="form__select" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              {DATE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Date &amp; time format
            <select className="form__select" value={datetimeFormat} onChange={(e) => setDatetimeFormat(e.target.value)}>
              {DATETIME_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">Save time &amp; dates</button>
        </div>
      </form>

      {/* ── Workdays ─────────────────────────────────────────── */}
      <h3 className="eyebrow">Workdays</h3>
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <div className="form__row">
          <label className="form__label">Active workdays</label>
          <WorkdaysPicker value={workdays} onChange={setWorkdays} />
          <span className="form__hint">
            {workdays.size === 0
              ? "No workdays selected — at least one day is required."
              : `${workdays.size} day${workdays.size === 1 ? "" : "s"} per week.`}
          </span>
        </div>
        <div className="form__row">
          <label className="form__label">
            Week starts on
            <select className="form__select" value={weekStart} onChange={(e) => setWeekStart(e.target.value as "mon" | "sun")}>
              <option value="mon">Monday</option>
              <option value="sun">Sunday</option>
            </select>
          </label>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">Save workdays</button>
        </div>
      </form>

      {/* ── Project defaults ─────────────────────────────────── */}
      <h3 className="eyebrow">Project defaults</h3>
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <div className="form__row">
          <label className="form__label">
            Default access for new users
            <select className="form__select" value={projectAccess} onChange={(e) => setProjectAccess(e.target.value)}>
              <option value="no_access">No Access</option>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <span className="form__hint">What new workspace members can do before being explicitly assigned to a project.</span>
          </label>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">Save defaults</button>
        </div>
      </form>

      {/* ── Planning ─────────────────────────────────────────── */}
      <h3 className="eyebrow">Planning</h3>
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <div className="form__row">
          <label className="form__label">Ranking method</label>
          <ToggleBtn
            value={rankMethod === "dragdrop"}
            onChange={(v) => setRankMethod(v ? "dragdrop" : "manual")}
            labels={["Manual ranking", "Drag & drop ranking"]}
          />
          <span className="form__hint">
            {rankMethod === "manual"
              ? "Users enter a numeric rank to set relative priority on backlog items."
              : "Users drag items on backlog and board views to establish priority."}
          </span>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">Save planning</button>
        </div>
      </form>

      {/* ── Features ─────────────────────────────────────────── */}
      <h3 className="eyebrow">Features</h3>
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <FeatureToggle
          label="Build &amp; changeset tracking"
          hint="Allows connectors (e.g. GitHub) to associate commits and build runs with work items."
          value={buildChangeset}
          onChange={setBuildChangeset}
        />
        <FeatureToggle
          label="Automatically unblock portfolio items"
          hint="When a portfolio item's state is updated, any blocking flags are cleared automatically."
          value={autoUnblock}
          onChange={setAutoUnblock}
        />
        <FeatureToggle
          label="Time Tracker"
          hint="Enables timesheets and time reporting across the workspace."
          value={timeTracker}
          onChange={setTimeTracker}
        />
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">Save features</button>
        </div>
      </form>

      {/* ── Notes ────────────────────────────────────────────── */}
      <h3 className="eyebrow">Notes</h3>
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <div className="form__row">
          <label className="form__label">
            Workspace notes
            <textarea
              className="form__input form__textarea"
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes, links, or context about this workspace."
            />
          </label>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">Save notes</button>
        </div>
      </form>

      {/* ── Support contact ──────────────────────────────────── */}
      <h3 className="eyebrow">Support contact</h3>
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <div className="form__row">
          <label className="form__label">
            Primary contact email
            <input type="email" className="form__input" defaultValue="" placeholder="ops@example.com" />
            <span className="form__hint">Where MMFF support and incident notifications are sent.</span>
          </label>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">Save contact</button>
        </div>
      </form>

      {/* ── Danger zone ──────────────────────────────────────── */}
      <h3 className="eyebrow">Danger zone</h3>
      <div className="danger-zone">
        <div>
          <p className="danger-zone__title">Archive workspace</p>
          <p className="danger-zone__desc">Removes user access and freezes content. Requires platform-admin confirmation.</p>
        </div>
        <button type="button" className="btn btn--danger" disabled>Archive…</button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls = active ? "tabs__tab tabs__tab--active" : "tabs__tab";
  return (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUrl, setResetUrl] = useState<{ email: string; url: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await api<AdminUser[]>("/api/admin/users");
      setUsers(data);
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function updateUser(id: string, patch: { role?: Role; is_active?: boolean }) {
    setPendingId(id);
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Update failed");
    } finally {
      setPendingId(null);
    }
  }

  const sorted = useMemo(
    () => (users ? [...users].sort((a, b) => a.email.localeCompare(b.email)) : null),
    [users]
  );

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar__meta">
          {sorted ? `${sorted.length} user${sorted.length === 1 ? "" : "s"}` : "Loading…"}
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn--primary">
          + New user
        </button>
      </div>

      {err && <div className="form__error">{err}</div>}

      {sorted && (
        <div className="table-wrap">
          <table className="table">
            <thead className="table__head">
              <tr className="table__row">
                <th className="table__cell">Email</th>
                <th className="table__cell">Role</th>
                <th className="table__cell">Status</th>
                <th className="table__cell">Last login</th>
                <th className="table__cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id} className="table__row">
                  <td className="table__cell">
                    <div className="table__cell-meta">
                      <span>{u.email}</span>
                      {u.force_password_change && (
                        <span className="pill pill--warning" title="Must change password on next login">
                          pending pw
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="table__cell">
                    <select
                      value={u.role}
                      disabled={pendingId === u.id}
                      onChange={(e) => updateUser(u.id, { role: e.target.value as Role })}
                      className="form__select form__select--sm"
                    >
                      <option value="user">user</option>
                      <option value="padmin">padmin</option>
                      <option value="gadmin">gadmin</option>
                    </select>
                  </td>
                  <td className="table__cell">
                    <label className="form__switch" title="Toggle account active state">
                      <input
                        type="checkbox"
                        checked={u.is_active}
                        disabled={pendingId === u.id}
                        onChange={(e) => updateUser(u.id, { is_active: e.target.checked })}
                      />
                      <span className={`pill ${u.is_active ? "pill--success" : "pill--neutral"}`}>
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </label>
                  </td>
                  <td className="table__cell table__cell--muted t-mono">{fmtDate(u.last_login)}</td>
                  <td className="table__cell table__cell--muted t-mono">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(email, url) => {
            setResetUrl({ email, url });
            setShowCreate(false);
            load();
          }}
        />
      )}

      {resetUrl && <ResetLinkModal email={resetUrl.email} url={resetUrl.url} onClose={() => setResetUrl(null)} />}
    </div>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (email: string, resetUrl: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const resp = await api<{ user: AdminUser; reset_url?: string }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      onCreated(resp.user.email, resp.reset_url ?? "");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErr("That email is already registered.");
      else setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New user">
      <form onSubmit={onSubmit} className="form">
        <label className="form__label">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="form__input"
            autoFocus
          />
        </label>
        <label className="form__label">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="form__select"
          >
            <option value="user">user</option>
            <option value="padmin">padmin</option>
            <option value="gadmin">gadmin</option>
          </select>
        </label>
        {err && <div className="form__error">{err}</div>}
        <div className="modal__actions">
          <button type="button" onClick={onClose} className="btn btn--secondary" disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetLinkModal({ email, url, onClose }: { email: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  return (
    <Modal onClose={onClose} title="User created">
      <div className="u-stack">
        <p className="auth-card__subtitle">
          <strong>{email}</strong> was created with a temporary password and must set their own via the link below.
          Copy it and send it to them — it expires in 1 hour.
        </p>
        <code className="code-block">{url || "(no link — EMAIL_MODE is not console)"}</code>
        <div className="modal__actions">
          <button type="button" onClick={onClose} className="btn btn--secondary">
            Close
          </button>
          <button type="button" onClick={copy} className="btn btn--primary" disabled={!url}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Story 00102 — Permissions tab uses a Vector .table-wrap +
// .table to render the role/capability matrix. Cells render a
// .pill (--success grant, --neutral deny) so granted vs denied is
// visible at a glance without colour saturation. Header row uses
// the sunken thead with eyebrow column heads from the base table
// block. The backend grid (/api/admin/permissions) will hydrate
// these cells once the projects module ships; for now the matrix
// is rendered from STATIC defaults so the visual contract is
// locked.
const CAPABILITIES: Array<{ key: string; label: string }> = [
  { key: "read", label: "Read content" },
  { key: "comment", label: "Comment" },
  { key: "create", label: "Create items" },
  { key: "edit_own", label: "Edit own items" },
  { key: "edit_any", label: "Edit any item" },
  { key: "publish", label: "Publish releases" },
  { key: "manage_users", label: "Manage users" },
  { key: "manage_billing", label: "Manage billing" },
];

const ROLES: Role[] = ["user", "padmin", "gadmin"];

const DEFAULT_GRID: Record<Role, Record<string, boolean>> = {
  user: { read: true, comment: true, create: true, edit_own: true, edit_any: false, publish: false, manage_users: false, manage_billing: false },
  padmin: { read: true, comment: true, create: true, edit_own: true, edit_any: true, publish: true, manage_users: false, manage_billing: false },
  gadmin: { read: true, comment: true, create: true, edit_own: true, edit_any: true, publish: true, manage_users: true, manage_billing: true },
};

function PermissionsTab() {
  return (
    <div>
      <div className="toolbar">
        <div className="toolbar__meta">
          {CAPABILITIES.length} capabilities &times; {ROLES.length} roles
        </div>
        <button type="button" className="btn btn--primary" disabled>
          Save changes
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead className="table__head">
            <tr className="table__row">
              <th className="table__cell">Capability</th>
              {ROLES.map((r) => (
                <th key={r} className="table__cell">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((c) => (
              <tr key={c.key} className="table__row">
                <td className="table__cell">{c.label}</td>
                {ROLES.map((r) => {
                  const granted = DEFAULT_GRID[r][c.key];
                  return (
                    <td key={r} className="table__cell">
                      <span className={`pill ${granted ? "pill--success" : "pill--neutral"}`}>
                        {granted ? "Allow" : "Deny"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button onClick={onClose} className="modal__close" aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
