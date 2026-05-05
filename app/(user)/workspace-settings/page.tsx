"use client";

/**
 * /workspace-settings — Story 00101 restyle.
 * gadmin-only tenant administration. Tables compose from the
 * canonical .tree_accordion-dense__* catalog — sunken thead with
 * sticky header (overflow:auto on the scroll wrapper). Status is
 * conveyed by .pill variants only (active=success, inactive=neutral,
 * pending pw=warning). No box-shadow, no gradient, no lime-green;
 * one primary button per region (the "+ New user" toolbar action).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { MdOutlineEdit } from "react-icons/md";
import { useTabState } from "@/app/hooks/useTabState";
import ToggleBtn from "@/app/components/ToggleBtn";
import PageShell from "@/app/components/PageShell";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import Table from "@/app/components/Table";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { api, ApiError } from "@/app/lib/api";
import { workspacesApi, emitWorkspacesChanged, type Workspace } from "@/app/lib/workspacesApi";

// Topology canvas is the same React Flow page mounted at /topology —
// we render it inline inside the tab so the gadmin sees the live
// editable canvas the moment they land on the tab. Dynamic+ssr:false
// because the page pulls in @xyflow/react (DOM-only) and
// useSearchParams (client-only).
const TopologyOverlayPage = dynamic(() => import("@/app/(overlay)/topology/page"), {
  ssr: false,
  loading: () => <div className="topology-tab-host__loading">Loading topology…</div>,
});

// Portfolio Model wizard mounted inline as a tab. The standalone
// /portfolio-model route still exists (deep-link target), but the
// canonical surface is now this tab so the gadmin reaches model
// adoption from one place — Workspace Settings.
const PortfolioModelPage = dynamic(() => import("@/app/(user)/portfolio-model/page"), {
  ssr: false,
  loading: () => <div className="topology-tab-host__loading">Loading portfolio model…</div>,
});

// AdminUser.role here is the bare role code string returned by
// /api/admin/users — that DTO has not been migrated to the structured
// role row yet (TD-PERM-004). Once it is, this alias is removed and
// the filter switches to comparing role.code on a structured payload.
type AdminUserRole = string;

interface AdminUser {
  id: string;
  subscription_id: string;
  email: string;
  role: AdminUserRole;
  is_active: boolean;
  first_name: string | null;
  last_name: string | null;
  department: string | null;
  last_login: string | null;
  force_password_change: boolean;
  created_at: string;
}

// RoleSummary is the subset of /api/roles/ row fields the workspace
// users tab consumes — id and code drive the picker payload, label
// renders option text, is_external drives the "external" chip and
// the is-external filter. (PLA-0007 / 00303.)
interface RoleSummary {
  id: string;
  code: string;
  label: string;
  is_external: boolean;
  is_system: boolean;
  rank: number;
}

const TABS = ["organization", "workspaces", "users", "permissions", "topology", "portfolio_model", "work_items"] as const;

const TAB_HEADERS: Record<typeof TABS[number], { title: string; subtitle: string }> = {
  organization: {
    title: "Organization",
    subtitle: "Workspace identity, region, and support contact",
  },
  workspaces: {
    title: "Workspaces",
    subtitle: "Active and archived workspaces in this tenant",
  },
  users: {
    title: "Users",
    subtitle: "Invite, manage, and assign roles to tenant members",
  },
  permissions: {
    title: "Permissions",
    subtitle: "Capabilities granted to each role in this tenant",
  },
  topology: {
    title: "Topology",
    subtitle: "Federated org canvas — offices, teams, and reporting lines",
  },
  portfolio_model: {
    title: "Portfolio Model",
    subtitle: "Adopt a model or preview your subscription's adopted bundle",
  },
  work_items: {
    title: "Work Items",
    subtitle: "Flows for system, portfolio, and custom artefact types",
  },
};

export default function WorkspaceSettingsPage() {
  const { user } = useAuth();
  const canAdminWorkspace = useHasPermission("workspace.archive");
  const canManageFlows = useHasPermission("flows.manage");
  const router = useRouter();
  const [tab, setTab] = useTabState(TABS, "organization");

  useEffect(() => {
    if (user && !canAdminWorkspace) router.replace("/dashboard");
  }, [user, canAdminWorkspace, router]);

  if (!user || !canAdminWorkspace) return null;

  // Story 00104 — Organization tab added as the default landing
  // tab so the workspace identity (display name, region, support
  // contact) is visible at a glance. Users + Permissions remain
  // the operational tabs that come after.
  const header = TAB_HEADERS[tab];

  return (
    <PageShell title={header.title} subtitle={header.subtitle} barTitle="Workspace Settings">
      <SecondaryNavigation<typeof TABS[number]>
        ariaLabel="Workspace settings sections"
        pageId="workspace-settings"
        reorderable
        active={tab}
        onChange={setTab}
        items={[
          { key: "organization", label: "Organization", sortKey: "Organization" },
          { key: "workspaces", label: "Workspaces", sortKey: "Workspaces" },
          { key: "users", label: "Users", sortKey: "Users" },
          { key: "permissions", label: "Permissions", sortKey: "Permissions" },
          { key: "topology", label: "Topology", sortKey: "Topology" },
          { key: "portfolio_model", label: "Portfolio Model", sortKey: "Portfolio Model" },
          ...(canManageFlows ? [{ key: "work_items" as const, label: "Work Items", sortKey: "Work Items" }] : []),
        ]}
      />
      {tab === "organization" && <OrganizationTab />}
      {tab === "workspaces" && <WorkspacesTab />}
      {tab === "users" && <UsersTab />}
      {tab === "permissions" && <PermissionsTab />}
      {tab === "topology" && <TopologyTab />}
      {tab === "portfolio_model" && <PortfolioModelTab />}
      {tab === "work_items" && canManageFlows && <WorkItemsTab />}
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

// PLA-0006 / story 00380 — Manage Workspaces panel.
// Lists live (non-archived) workspaces for the caller's tenant via
// workspacesApi.list(), supports inline rename (workspacesApi.rename
// — PATCH /api/workspaces/{id}), archive (workspacesApi.archive —
// gated on useHasPermission('workspace.archive')), and a "+ New
// workspace" form (workspacesApi.create) that surfaces the backend's
// slug_taken 409 inline (an archived workspace may share the slug —
// the gate is "live workspaces only"). After every mutation we call
// emitWorkspacesChanged() so the topology workspace switcher (story
// 00379) refetches without a page reload.
//
// PLA-0006 / story 00381 — Archived Workspaces section.
// When the caller holds `workspace.view_archived` we mount a second
// table below the live one, populated from
// workspacesApi.listArchived() (GET /api/workspaces?archived=true).
// Each row exposes a "Restore" button gated on `workspace.restore`;
// on success we call emitWorkspacesChanged() so the topology
// switcher (story 00379) refetches its dropdown without a page
// reload, then refetch BOTH the live + archived lists locally so the
// row jumps from the archived table back into the live table. When
// the caller lacks `workspace.view_archived` the entire section
// (heading + table + empty state) is hidden — there is nothing to
// see and no API call is made.

function WorkspacesTab() {
  const canArchive       = useHasPermission("workspace.archive");
  const canViewArchived  = useHasPermission("workspace.view_archived");
  const canRestore       = useHasPermission("workspace.restore");

  const [rows, setRows] = useState<Workspace[] | null>(null);
  const [archivedRows, setArchivedRows] = useState<Workspace[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [archivedErr, setArchivedErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await workspacesApi.list();
      setRows(data);
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Failed to load");
    }
  }, []);

  // 00381 — fetch the archived list only when the caller holds the
  // view_archived permission. Skipping the call entirely when the
  // permission is absent keeps a 403 from showing up in the network
  // panel for ordinary users.
  const loadArchived = useCallback(async () => {
    if (!canViewArchived) return;
    setArchivedErr(null);
    try {
      const data = await workspacesApi.listArchived();
      setArchivedRows(data);
    } catch (e) {
      setArchivedErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Failed to load archived workspaces");
    }
  }, [canViewArchived]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadArchived(); }, [loadArchived]);

  async function renameWorkspace(id: string, name: string) {
    await workspacesApi.rename(id, name);
    emitWorkspacesChanged();
    setEditingId(null);
    await load();
  }

  async function archiveWorkspace(id: string) {
    await workspacesApi.archive(id);
    emitWorkspacesChanged();
    // Workspace just left the live list; refetch BOTH lists so the
    // row appears under "Archived" without a manual reload.
    await Promise.all([load(), loadArchived()]);
  }

  async function restoreWorkspace(id: string) {
    await workspacesApi.restore(id);
    emitWorkspacesChanged();
    // Workspace just rejoined the live list; refetch BOTH lists so
    // the topology switcher and the on-page tables stay in sync.
    await Promise.all([load(), loadArchived()]);
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar__meta">
          {rows ? `${rows.length} workspace${rows.length === 1 ? "" : "s"}` : "Loading…"}
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn--primary">
          + New workspace
        </button>
      </div>

      {err && <div className="form__error">{err}</div>}

      <Table<Workspace>
        pageId="workspace-settings"
        slot="workspaces"
        ariaLabel="Workspaces"
        rows={rows}
        rowKey={(w) => w.id}
        loading={!rows}
        empty='No live workspaces. Use "+ New workspace" to create one.'
        columns={[
          {
            key: "name",
            header: "Name",
            kind: "custom",
            render: (w) => (
              <WorkspaceNameCell
                w={w}
                isEditing={editingId === w.id}
                canArchive={canArchive}
                onStartEdit={() => setEditingId(w.id)}
                onCancelEdit={() => setEditingId(null)}
                onRename={(name) => renameWorkspace(w.id, name)}
              />
            ),
          },
          { key: "slug", header: "Slug", width: 200, kind: "mono" },
          {
            key: "created",
            header: "Created",
            width: 140,
            kind: "custom",
            render: (w) => new Date(w.created_at).toLocaleDateString(),
          },
          {
            key: "actions",
            header: "",
            width: 200,
            kind: "custom",
            render: (w) => (
              <WorkspaceActionsCell
                w={w}
                isEditing={editingId === w.id}
                canArchive={canArchive}
                onStartEdit={() => setEditingId(w.id)}
                onArchive={() => archiveWorkspace(w.id)}
              />
            ),
          },
        ]}
      />

      {/* 00381 — Archived section. Entirely hidden (heading, error,
          and table all suppressed) when the caller lacks
          workspace.view_archived. AC1. */}
      {canViewArchived && (
        <ArchivedWorkspacesSection
          rows={archivedRows}
          err={archivedErr}
          canRestore={canRestore}
          onRestore={restoreWorkspace}
        />
      )}

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

// ArchivedWorkspacesSection — story 00381. Renders the read-only
// archived list with an optional Restore action. Caller decides
// whether to mount this at all (via workspace.view_archived); the
// component itself only gates the action button on workspace.restore.
function ArchivedWorkspacesSection({
  rows,
  err,
  canRestore,
  onRestore,
}: {
  rows: Workspace[] | null;
  err: string | null;
  canRestore: boolean;
  onRestore: (id: string) => Promise<void>;
}) {
  return (
    <>
      <h3 className="eyebrow">Archived workspaces</h3>
      {err && <div className="form__error">{err}</div>}
      {rows && (
        <Table<Workspace>
          pageId="workspace-settings"
          slot="archived_workspaces"
          ariaLabel="Archived workspaces"
          rows={rows}
          rowKey={(w) => w.id}
          empty="No archived workspaces."
          columns={[
            { key: "name", header: "Name" },
            { key: "slug", header: "Slug", width: 200, kind: "mono" },
            {
              key: "archived",
              header: "Archived",
              width: 140,
              kind: "custom",
              render: (w) =>
                w.archived_at ? new Date(w.archived_at).toLocaleDateString() : "—",
            },
            {
              key: "actions",
              header: "",
              width: 160,
              kind: "custom",
              render: (w) => (
                <ArchivedWorkspaceActionsCell
                  w={w}
                  canRestore={canRestore}
                  onRestore={() => onRestore(w.id)}
                />
              ),
            },
          ]}
        />
      )}
    </>
  );
}

function ArchivedWorkspaceActionsCell({
  w,
  canRestore,
  onRestore,
}: {
  w: Workspace;
  canRestore: boolean;
  onRestore: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!canRestore) return null;

  async function restore() {
    if (!confirm(`Restore workspace "${w.name}" to the live list?`)) return;
    setErr(null);
    setBusy(true);
    try {
      await onRestore();
    } catch (e) {
      setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="u-row u-row--gap-2">
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={restore}
        disabled={busy}
      >
        {busy ? "Restoring…" : "Restore"}
      </button>
      {err && <span className="form__error">{err}</span>}
    </div>
  );
}

function WorkspaceNameCell({
  w,
  isEditing,
  onCancelEdit,
  onRename,
}: {
  w: Workspace;
  isEditing: boolean;
  canArchive: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onRename: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(w.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setName(w.name);
      setErr(null);
    }
  }, [isEditing, w.name]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === w.name) {
      onCancelEdit();
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await onRename(trimmed);
    } catch (e) {
      setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isEditing) return <span>{w.name}</span>;
  return (
    <div className="u-row u-row--gap-2">
      <input
        type="text"
        className="form__input form__input--sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
        }}
      />
      <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onCancelEdit} disabled={busy}>
        Cancel
      </button>
      {err && <span className="form__error">{err}</span>}
    </div>
  );
}

function WorkspaceActionsCell({
  w,
  isEditing,
  canArchive,
  onStartEdit,
  onArchive,
}: {
  w: Workspace;
  isEditing: boolean;
  canArchive: boolean;
  onStartEdit: () => void;
  onArchive: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function archive() {
    if (!confirm(`Archive workspace "${w.name}"?`)) return;
    setBusy(true);
    try {
      await onArchive();
    } catch (e) {
      setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Archive failed");
    } finally {
      setBusy(false);
    }
  }

  if (isEditing) return null;
  return (
    <div className="u-row u-row--gap-2">
      <button
        type="button"
        className="btn btn--icon btn--ghost btn--sm"
        aria-label="Rename workspace"
        title="Rename workspace"
        onClick={onStartEdit}
      >
        <MdOutlineEdit size={14} />
      </button>
      {canArchive && (
        <button type="button" className="btn btn--danger btn--sm" onClick={archive} disabled={busy}>
          {busy ? "Archiving…" : "Archive"}
        </button>
      )}
      {err && <span className="form__error">{err}</span>}
    </div>
  );
}

function CreateWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const desc = description.trim();
      await workspacesApi.create({
        name: name.trim(),
        slug: slug.trim(),
        ...(desc ? { description: desc } : {}),
      });
      emitWorkspacesChanged();
      onCreated();
    } catch (e) {
      // Backend returns {error: "slug_taken"} on duplicate-slug 409 (only
      // among LIVE workspaces — same slug from an archived row is
      // allowed). Surface that inline so the user can pick a new slug
      // without leaving the form.
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | string | undefined;
        const code = typeof body === "object" && body ? body.error : undefined;
        setErr(code === "slug_taken"
          ? "A live workspace already uses that slug. Pick a different slug."
          : `Conflict: ${String(body ?? "")}`);
      } else {
        setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Create failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New workspace">
      <form onSubmit={onSubmit} className="form">
        <label className="form__label">
          Name
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form__input"
            autoFocus
          />
        </label>
        <label className="form__label">
          Slug
          <input
            type="text"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="form__input t-mono"
            pattern="[a-z0-9][a-z0-9-]*"
            title="Lowercase letters, numbers, and hyphens; must start with a letter or number."
          />
          <span className="form__hint">Lowercase letters, numbers, hyphens. Must be unique among live workspaces.</span>
        </label>
        <label className="form__label">
          Description
          <textarea
            className="form__input form__textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {err && <div className="form__error">{err}</div>}
        <div className="modal__actions">
          <button type="button" onClick={onClose} className="btn btn--secondary" disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim() || !slug.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type PageSize = "all" | 10 | 25 | 50 | 100;

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  // visibleRoles is every role the actor can see (system + own-tenant)
  // from /api/roles/ — used to (a) populate the role filter, (b) look
  // up is_external for the chip on each user row, and (c) seed the
  // edit-panel role picker (the actor can always assign whatever role
  // a user already has if they can see it; but the edit picker also
  // augments with /api/roles/creatable for safety).
  const [visibleRoles, setVisibleRoles] = useState<RoleSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUrl, setResetUrl] = useState<{ email: string; url: string } | null>(null);

  // Filters + pagination state
  const [search, setSearch]         = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<"" | AdminUserRole>("");
  const [externalOnly, setExternalOnly] = useState(false);
  const [pageSize, setPageSize]     = useState<PageSize>(25);
  const [page, setPage]             = useState(1);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [data, roles] = await Promise.all([
        api<AdminUser[]>("/api/admin/users"),
        api<RoleSummary[]>("/api/roles/"),
      ]);
      setUsers(data);
      setVisibleRoles(roles);
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // code → role summary, for chip + filter lookups.
  const roleByCode = useMemo(() => {
    const m = new Map<string, RoleSummary>();
    for (const r of visibleRoles ?? []) m.set(r.code, r);
    return m;
  }, [visibleRoles]);

  // Distinct departments for the filter dropdown.
  const departments = useMemo(() => {
    if (!users) return [];
    const set = new Set<string>();
    for (const u of users) {
      const d = (u.department ?? "").trim();
      if (d) set.add(d);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [users]);

  // Filter + sort.
  const filtered = useMemo(() => {
    if (!users) return null;
    const q = search.trim().toLowerCase();
    return [...users]
      .filter((u) => {
        if (deptFilter && (u.department ?? "") !== deptFilter) return false;
        if (roleFilter && u.role !== roleFilter) return false;
        if (externalOnly && !roleByCode.get(u.role)?.is_external) return false;
        if (!q) return true;
        const hay = [
          u.email, u.first_name ?? "", u.last_name ?? "", u.department ?? "", u.role,
        ].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const an = (a.last_name ?? "").localeCompare(b.last_name ?? "");
        if (an !== 0) return an;
        return a.email.localeCompare(b.email);
      });
  }, [users, search, deptFilter, roleFilter, externalOnly, roleByCode]);

  // Reset to page 1 whenever filters change.
  useEffect(() => { setPage(1); }, [search, deptFilter, roleFilter, externalOnly, pageSize]);

  // Page meta — slicing now lives inside <Table>; we only need total + safePage
  // for the toolbar meta string and the pagination config wiring.
  const total      = filtered?.length ?? 0;
  const sizeNumber = pageSize === "all" ? Math.max(total, 1) : pageSize;
  const pageCount  = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / sizeNumber));
  const safePage   = Math.min(page, pageCount);

  async function patchUser(id: string, patch: Partial<{
    role: AdminUserRole; is_active: boolean;
    first_name: string; last_name: string; department: string;
  }>) {
    await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await load();
  }

  async function issueReset(id: string) {
    const resp = await api<{ email: string; reset_url?: string }>(
      `/api/admin/users/${id}/password-reset`,
      { method: "POST" },
    );
    setResetUrl({ email: resp.email, url: resp.reset_url ?? "" });
  }

  async function deleteUser(id: string) {
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    await load();
  }

  const usersFiltered = filtered;
  const paginationConfig =
    pageSize === "all" || total <= pageSize
      ? undefined
      : { pageSize, page: safePage - 1, onPageChange: (n: number) => setPage(n + 1) };

  return (
    <div>
      {err && <div className="form__error">{err}</div>}

      {usersFiltered && (
        <Table<AdminUser>
          pageId="workspace-settings"
          slot="users"
          ariaLabel="Users"
          rows={usersFiltered}
          rowKey={(u) => u.id}
          empty="No users match the current filters."
          expandable={{
            renderPanel: (u) => (
              <UserEditPanel
                u={u}
                onSave={patchUser}
                onIssueReset={issueReset}
                onDelete={() => deleteUser(u.id)}
              />
            ),
            canExpand: () => true,
          }}
          pagination={paginationConfig}
          toolbar={{
            search: {
              value: search,
              onChange: setSearch,
              placeholder: "Search name, email, department…",
            },
            filters: [
              {
                key: "department",
                label: "Department",
                value: deptFilter,
                onChange: setDeptFilter,
                options: [
                  { value: "", label: "All departments" },
                  ...departments.map((d) => ({ value: d, label: d })),
                ],
              },
              {
                key: "role",
                label: "Role",
                value: roleFilter,
                onChange: (v) => setRoleFilter(v as "" | AdminUserRole),
                options: [
                  { value: "", label: "All roles" },
                  ...(visibleRoles ?? []).map((r) => ({
                    value: r.code,
                    label: `${r.label}${r.is_external ? " (external)" : ""}`,
                  })),
                ],
              },
            ],
            meta: filtered ? `${total} user${total === 1 ? "" : "s"}` : "Loading…",
            actions: (
              <>
                <label
                  className="form__label form__label--inline"
                  title="Show only users on roles flagged is_external"
                >
                  <input
                    type="checkbox"
                    checked={externalOnly}
                    onChange={(e) => setExternalOnly(e.target.checked)}
                  />
                  <span>External only</span>
                </label>
                <select
                  className="form__select form__select--sm"
                  value={String(pageSize)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPageSize(v === "all" ? "all" : (Number(v) as PageSize));
                  }}
                  aria-label="Page size"
                >
                  <option value="all">All</option>
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
                <button onClick={() => setShowCreate(true)} className="btn btn--primary">
                  + New user
                </button>
              </>
            ),
          }}
          columns={[
            { key: "expander", width: 40, kind: "expander" },
            {
              key: "last_name",
              header: "Last name",
              width: 160,
              kind: "custom",
              render: (u) => u.last_name ?? <span>—</span>,
            },
            {
              key: "first_name",
              header: "First name",
              width: 160,
              kind: "custom",
              render: (u) => u.first_name ?? <span>—</span>,
            },
            {
              key: "email",
              header: "Email",
              kind: "custom",
              render: (u) => (
                <div className="u-row u-row--gap-2">
                  <span>{u.email}</span>
                  {roleByCode.get(u.role)?.is_external && (
                    <span
                      className="pill pill--neutral"
                      title="Role is flagged external (e.g. partner / contractor)"
                    >
                      external
                    </span>
                  )}
                  {u.force_password_change && (
                    <span className="pill pill--warning" title="Must change password on next login">
                      pending pw
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "department",
              header: "Department",
              width: 200,
              kind: "custom",
              render: (u) => u.department ?? <span>—</span>,
            },
            {
              key: "status",
              header: "Status",
              width: 110,
              kind: "pill",
              pillVariant: (u) => (u.is_active ? "success" : "neutral"),
              pillLabel: (u) => (u.is_active ? "Active" : "Inactive"),
            },
          ]}
        />
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

function UserEditPanel({
  u,
  onSave,
  onIssueReset,
  onDelete,
}: {
  u: AdminUser;
  onSave: (id: string, patch: Partial<{ role: AdminUserRole; is_active: boolean; first_name: string; last_name: string; department: string }>) => Promise<void>;
  onIssueReset: (id: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [firstName, setFirstName] = useState(u.first_name ?? "");
  const [lastName,  setLastName]  = useState(u.last_name ?? "");
  const [department, setDepartment] = useState(u.department ?? "");
  const [role, setRole] = useState<AdminUserRole>(u.role);
  const [isActive, setIsActive] = useState(u.is_active);
  const [removeBusy, setRemoveBusy] = useState(false);
  // Creatable role list for the role <select>. Augmented with the
  // user's CURRENT role even if not creatable so the selected option
  // never silently disappears (e.g. when editing a user whose role
  // the actor lacks the matching users.create.<role> code for, but
  // who they can still see + leave on that role).
  const [creatable, setCreatable] = useState<RoleSummary[] | null>(null);

  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<RoleSummary[]>("/api/roles/creatable")
      .then((rows) => { if (!cancelled) setCreatable(rows); })
      .catch(() => { if (!cancelled) setCreatable([]); });
    return () => { cancelled = true; };
  }, []);

  // Re-sync local form state if the underlying row reloads.
  useEffect(() => {
    setFirstName(u.first_name ?? "");
    setLastName(u.last_name ?? "");
    setDepartment(u.department ?? "");
    setRole(u.role);
    setIsActive(u.is_active);
  }, [u.id, u.first_name, u.last_name, u.department, u.role, u.is_active]);

  // Role options = creatable roles + current role (if not present).
  const roleOptions = useMemo<RoleSummary[]>(() => {
    const list = [...(creatable ?? [])];
    if (!list.some((r) => r.code === u.role)) {
      list.unshift({ id: `current-${u.role}`, code: u.role, label: u.role, is_external: false, is_system: true, rank: 0 });
    }
    return list;
  }, [creatable, u.role]);

  const dirty =
    firstName !== (u.first_name ?? "") ||
    lastName  !== (u.last_name  ?? "") ||
    department !== (u.department ?? "") ||
    role !== u.role ||
    isActive !== u.is_active;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      await onSave(u.id, {
        first_name: firstName,
        last_name:  lastName,
        department: department,
        role,
        is_active: isActive,
      });
      setInfo("Changes saved.");
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    setErr(null);
    setInfo(null);
    setResetBusy(true);
    try {
      await onIssueReset(u.id);
      setInfo(`Password reset link sent to ${u.email}.`);
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Reset failed");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="users-edit-panel">
      <form className="form" onSubmit={onSubmit}>
        <div className="form__grid">
          <label className="form__label">
            First name
            <input
              type="text"
              className="form__input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </label>
          <label className="form__label">
            Last name
            <input
              type="text"
              className="form__input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </label>
          <label className="form__label">
            Department
            <input
              type="text"
              className="form__input"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </label>
          <label className="form__label">
            Email
            <input type="email" className="form__input" value={u.email} disabled />
            <span className="form__hint">Email cannot be changed from this panel.</span>
          </label>
          <label className="form__label">
            Role
            <select
              className="form__select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={creatable === null}
            >
              {roleOptions.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.label}{r.is_external ? " (external)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {err && <div className="form__error">{err}</div>}
        {info && <div className="form__info">{info}</div>}

        <div className="users-edit-panel__actions">
          <div className="users-edit-panel__actions-left">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={sendReset}
              disabled={resetBusy || busy}
              title="Generate a password reset link and email it to the user's registered address."
            >
              {resetBusy ? "Sending…" : "Send password reset"}
            </button>
          </div>
          <div className="users-edit-panel__actions-right">
            {isActive !== u.is_active && (
              <span
                className="users-edit-panel__state-confirm-msg"
                role="status"
                aria-live="polite"
              >
                {isActive
                  ? "Make this user account active? Click Confirm changes to apply."
                  : "Disable this user account? Click Confirm changes to apply."}
              </span>
            )}
            <span className="users-edit-panel__state" aria-label="Account state">
              <ToggleBtn
                value={!isActive}
                onChange={(v) => setIsActive(!v)}
                labels={["Active", "Inactive"]}
              />
            </span>
            <button
              type="button"
              className="btn btn--danger users-edit-panel__remove-btn"
              onClick={async () => {
                if (removeBusy) return;
                setRemoveBusy(true);
                setErr(null);
                try {
                  await onDelete();
                } catch (e) {
                  setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Remove failed");
                } finally {
                  setRemoveBusy(false);
                }
              }}
              disabled={busy || resetBusy || removeBusy}
            >
              {removeBusy ? "Removing…" : "Remove user"}
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!dirty || busy}
            >
              {busy ? "Saving…" : "Confirm changes"}
            </button>
          </div>
        </div>
      </form>
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
  const [role, setRole] = useState<AdminUserRole>("");
  // /api/roles/creatable returns the subset of roles the actor may
  // assign to a NEW user, gated by the per-target users.create.<role>
  // creator-matrix codes. The new-user form must only offer roles
  // from this list (PLA-0007 / 00303). null = still loading; [] =
  // actor has no users.create.* code, in which case the create
  // button never opened the modal in the first place.
  const [creatable, setCreatable] = useState<RoleSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<RoleSummary[]>("/api/roles/creatable")
      .then((rows) => {
        if (cancelled) return;
        setCreatable(rows);
        // Default to the lowest-rank role (most restrictive) the
        // actor can assign. Falls back to first row if rank ties.
        const def = [...rows].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0];
        if (def) setRole(def.code);
      })
      .catch(() => { if (!cancelled) setCreatable([]); });
    return () => { cancelled = true; };
  }, []);

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

  const noRoles = creatable !== null && creatable.length === 0;

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
            onChange={(e) => setRole(e.target.value)}
            className="form__select"
            disabled={creatable === null || noRoles}
          >
            {creatable === null && <option value="">Loading…</option>}
            {noRoles && <option value="">No assignable roles</option>}
            {(creatable ?? []).map((r) => (
              <option key={r.id} value={r.code}>
                {r.label}{r.is_external ? " (external)" : ""}
              </option>
            ))}
          </select>
        </label>
        {err && <div className="form__error">{err}</div>}
        <div className="modal__actions">
          <button type="button" onClick={onClose} className="btn btn--secondary" disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || creatable === null || noRoles || !role}>
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
    <Modal onClose={onClose} title="Password reset link">
      <div className="u-stack">
        <p className="auth-card__subtitle">
          A reset link was generated and emailed to <strong>{email}</strong>. The link expires in 1 hour.
          You can also copy it below and send it to them directly.
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

// Story 00102 — Permissions tab renders the role/capability matrix
// via the canonical .tree_accordion-dense__* table catalog. Cells
// render a .pill (--success grant, --neutral deny) so granted vs
// denied is visible at a glance without colour saturation. The
// backend grid (/api/admin/permissions) will hydrate
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

const ROLES: AdminUserRole[] = ["user", "padmin", "gadmin"];

const DEFAULT_GRID: Record<AdminUserRole, Record<string, boolean>> = {
  user: { read: true, comment: true, create: true, edit_own: true, edit_any: false, publish: false, manage_users: false, manage_billing: false },
  padmin: { read: true, comment: true, create: true, edit_own: true, edit_any: true, publish: true, manage_users: false, manage_billing: false },
  gadmin: { read: true, comment: true, create: true, edit_own: true, edit_any: true, publish: true, manage_users: true, manage_billing: true },
};

function PermissionsTab() {
  const columns = [
    { key: "label", header: "Capability", width: 220 },
    ...ROLES.map((role) => ({
      key: role,
      header: role,
      width: 120,
      kind: "pill" as const,
      pillVariant: (row: { key: string }) =>
        (DEFAULT_GRID[role][row.key] ? "success" : "neutral") as "success" | "neutral",
      pillLabel: (row: { key: string }) => (DEFAULT_GRID[role][row.key] ? "Allow" : "Deny"),
    })),
  ];

  return (
    <Table<{ key: string; label: string }>
      pageId="workspace-settings"
      slot="permissions"
      ariaLabel="Permissions"
      columns={columns}
      rows={CAPABILITIES}
      rowKey={(r) => r.key}
      toolbar={{
        meta: `${CAPABILITIES.length} capabilities × ${ROLES.length} roles`,
        actions: (
          <button type="button" className="btn btn--primary" disabled>
            Save changes
          </button>
        ),
      }}
    />
  );
}

// PLA-0006 — Topology tab embeds the same React Flow canvas mounted
// at /topology. The host element is `position: relative` so the
// overlay's `position: absolute; inset: 0` shell fills it instead of
// the viewport. The overlay's "Finish" button is styled out of this
// embedded view (it would just router.back to the previous tab,
// which is confusing) — gadmins switch tabs to leave.
function TopologyTab() {
  return (
    <div className="topology-tab-host">
      <TopologyOverlayPage />
    </div>
  );
}

// PortfolioModelTab mounts the same /portfolio-model page used by
// the standalone route. Same host wrapper as TopologyTab — the
// nested PageShell from the inner page is intentional, matching
// the established Topology-as-tab pattern.
function PortfolioModelTab() {
  return (
    <div className="ws-tab-embed">
      <PortfolioModelPage />
    </div>
  );
}

interface FlowState {
  id: string;
  flow_position: number;
  name: string;
  canonical_code: string;
  description?: string | null;
}

interface FlowGroup {
  target_kind: "system" | "tenant" | "portfolio";
  target_id: string;
  target_label: string;
  states: FlowState[] | null;
}

interface FlowsResponse {
  system: FlowGroup[] | null;
  tenant: FlowGroup[] | null;
  portfolio: FlowGroup[] | null;
}

function WorkItemsTab() {
  const [data, setData] = useState<FlowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<FlowsResponse>("/api/flows/")
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof ApiError ? e.message : String(e);
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="empty-state">Loading flows…</div>;
  if (error) return <div className="empty-state">Could not load flows: {error}</div>;
  if (!data) return null;

  const sections: Array<{ title: string; subtitle: string; groups: FlowGroup[] }> = [
    {
      title: "System types",
      subtitle: "Vendor-defined artefact types (work items, defects, tasks, test cases, epics, strategic).",
      groups: data.system ?? [],
    },
    {
      title: "Portfolio layers",
      subtitle: "Each strategy layer your tenant has defined (Feature, Initiative, Theme, …) has its own independent flow.",
      groups: data.portfolio ?? [],
    },
    {
      title: "Custom types",
      subtitle: "Tenant-invented artefact types. Empty until a gadmin creates one.",
      groups: data.tenant ?? [],
    },
  ];

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar__meta">
          Read-only view — editing arrives in the next iteration. Each row below is a state in the named flow, in execution order.
        </div>
      </div>

      {sections.map((section) => (
        <section key={section.title} className="flow-editor__section">
          <h3 className="flow-editor__section-title">{section.title}</h3>
          <p className="flow-editor__section-subtitle">{section.subtitle}</p>

          {section.groups.length === 0 ? (
            <div className="empty-state">No flows in this section.</div>
          ) : (
            <div className="u-stack--gap-3">
              {section.groups.map((g) => (
                <div key={g.target_id}>
                  <Table<FlowState>
                    pageId="workspace-settings"
                    slot={`flows__${g.target_id.replace(/-/g, "_")}`}
                    ariaLabel={g.target_label}
                    rows={g.states ?? []}
                    rowKey={(s) => s.id}
                    toolbar={{ meta: <strong>{g.target_label}</strong> }}
                    cellClassName={(_s, c) =>
                      c.key === "flow_position" ? "tree_accordion-dense__cell--mono" : undefined
                    }
                    columns={[
                      { key: "flow_position", header: "#", width: 56, kind: "numeric" },
                      { key: "name", header: "Name", width: 200 },
                      {
                        key: "canonical_code",
                        header: "Canonical",
                        width: 160,
                        kind: "pill",
                        pillVariant: () => "neutral",
                        pillLabel: (s) => s.canonical_code,
                      },
                      {
                        key: "description",
                        header: "Description",
                        kind: "custom",
                        render: (s) => s.description ?? "",
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
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
          <button onClick={onClose} className="btn btn--icon btn--ghost modal__close" aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

