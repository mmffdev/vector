"use client";

import { useState } from "react";
import ToggleBtn from "@/app/components/ToggleBtn";

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

export default function OrganizationPage() {
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

      {/* ── Color Code Work Items (placeholder) ──────────────── */}
      <h3 className="eyebrow">Color Code Work Items</h3>
      <p className="form__hint">Placeholder — work item type colours will be configurable here.</p>

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
