#!/usr/bin/env node
// import_reports.mjs — bulk-load reports from dev/<type>/ into dev_reports.
//
// Reads JSON files off disk, normalises them to the dev_reports schema, and
// POSTs each one to the backend's /_site/admin/dev/reporting handler using
// the dev API key. No browser session required.
//
// Usage:
//   node dev/scripts/import_reports.mjs research
//   node dev/scripts/import_reports.mjs research --dry-run
//   node dev/scripts/import_reports.mjs all
//
// Type → directory + ID prefix mapping:
//   research → dev/research/R###.json   → RES###
//   plan     → dev/plans/PLA-####.json  → PLA####
//   security → dev/security-audits/SA*  → SEC###
//   retro    → dev/retros/RETRO-###     → RET###
//   code     → dev/code/CO###           → COD###
//   api      → dev/audits/              → API### (sparse — read on the fly)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:5100";
const ENDPOINT = `${BACKEND}/_site/admin/dev/reporting/`;
const API_KEY = process.env.DEV_API_KEY
  // Fallback to the value in backend/.env.dev — read once at startup so this
  // script works without exporting env vars first.
  ?? (() => {
    try {
      const env = fs.readFileSync(path.join(ROOT, "backend", ".env.dev"), "utf8");
      const m = env.match(/^DEV_API_KEY=(\S+)/m);
      return m?.[1];
    } catch { return null; }
  })();

if (!API_KEY) {
  console.error("DEV_API_KEY not set and not found in backend/.env.dev");
  process.exit(1);
}

// Per-type adapter: takes a parsed JSON object and returns the wire payload
// the backend expects (UpsertInput), or null to skip.

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slug(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Render the body of one plan field. Handles all four shapes seen in
// dev/plans/PLA-####.json: HTML string, list of strings, list of AC-style
// objects ({criterion,proven_by,...}), list of risk objects, list of work
// item objects, list of reference objects.
function renderField(value, opts = {}) {
  if (value == null) return "";
  if (typeof value === "string") {
    return value.trim() ? value : "";
  }
  if (!Array.isArray(value) || value.length === 0) return "";

  // List of plain strings → ordered list.
  if (value.every((v) => typeof v === "string")) {
    return `<ol>${value.map((v) => `<li>${v}</li>`).join("")}</ol>`;
  }

  // List of objects — branch on the keys we know about.
  return `<ol>${value
    .map((row) => {
      if (typeof row !== "object" || row === null) return `<li>${escapeHtml(String(row))}</li>`;
      // Acceptance criterion
      if ("criterion" in row) {
        const done = row.done ? " ✓" : "";
        const proven = row.proven_by ? `<br><em>Proven by:</em> ${row.proven_by}` : "";
        const story = row.story_id ? `<br><em>Story:</em> ${escapeHtml(row.story_id)}` : "";
        return `<li><strong>${escapeHtml(row.criterion)}</strong>${done}${proven}${story}</li>`;
      }
      // Risk
      if ("risk" in row) {
        const impact = row.impact != null ? ` <small>(impact ${row.impact})</small>` : "";
        const mit = row.mitigation ? `<br><em>Mitigation:</em> ${row.mitigation}` : "";
        return `<li><strong>${escapeHtml(row.risk)}</strong>${impact}${mit}</li>`;
      }
      // Work item
      if ("title" in row && ("status" in row || "card_url" in row)) {
        const status = row.status ? ` <code>${escapeHtml(row.status)}</code>` : "";
        const notes = row.notes ? `<br>${row.notes}` : "";
        const link = row.card_url ? `<br><a href="${escapeHtml(row.card_url)}">card</a>` : "";
        return `<li><strong>${escapeHtml(row.title)}</strong>${status}${notes}${link}</li>`;
      }
      // Reference
      if ("label" in row && "href" in row) {
        return `<li><a href="${escapeHtml(row.href)}">${escapeHtml(row.label)}</a>${row.kind ? ` <small>(${escapeHtml(row.kind)})</small>` : ""}</li>`;
      }
      // Unknown shape — dump JSON so the data isn't lost.
      return `<li><pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre></li>`;
    })
    .join("")}</ol>`;
}

// Wrap a section in an h2 with a slugified id so the panel's scroll-spy picks
// it up as a TOC anchor. Returns "" when the field is empty so the caller's
// filter(Boolean).join() drops it cleanly.
function section(heading, value) {
  const body = renderField(value);
  if (!body) return "";
  return `<h2 id="${slug(heading)}">${heading}</h2>${body}`;
}

const ADAPTERS = {
  research: (j, file) => {
    if (!j?.id || !j?.title || !j?.content) return null;
    const m = j.id.match(/^R(\d+)$/);
    if (!m) return null; // skip non-numbered outliers like _pla0011_cards.json
    const num = m[1].padStart(3, "0");
    return {
      id: `RES${num}`,
      type: "research",
      title: j.title,
      category: j.category ?? "",
      topic: j.topic ?? "",
      summary: j.summary ?? "",
      content: j.content,
      report_date: j.date ?? "",
      payload: { source_file: path.basename(file), original_id: j.id },
    };
  },

  // Plans (PLA-####.json). Skips .md plans for now — they need a markdown
  // pass before they're storable as HTML. Concatenates the structured
  // sections into one HTML body so each section becomes a TOC anchor.
  plan: (j, file) => {
    if (!j?.id || !j?.title) return null;
    const m = j.id.match(/^PLA-?(\d+)$/);
    if (!m) return null;
    const num = m[1].padStart(4, "0");
    const phase = j.phase ?? j.phase_id ?? "";
    const status = j.status ? ` · <strong>Status:</strong> ${j.status}` : "";
    const value = j.value
      ? `<p><strong>Value:</strong> ${j.value}</p>`
      : "";
    const dates = [
      j.date_created && `Created ${j.date_created}`,
      j.date_started && `Started ${j.date_started}`,
      j.date_last_updated && `Updated ${j.date_last_updated}`,
      j.date_finished && `Finished ${j.date_finished}`,
    ].filter(Boolean).join(" · ");
    const head = `<p>${dates}${status}</p>${value}`;
    const body = [
      head,
      section("Scope", j.scope),
      section("Acceptance criteria", j.acceptance_criteria),
      section("Existing acceptance criteria", j.acceptance_criteria_existing),
      section("Feature list", j.feature_list),
      section("Features extended", j.features_extended),
      section("Features removed", j.features_removed),
      section("Implementation plan", j.implementation_plan),
      section("Workflow", j.workflow_table),
      section("Areas impacted", j.areas_impacted),
      section("Work item backlog", j.work_item_backlog),
      section("Work item roadmap", j.work_item_backlog_roadmap),
      section("Risks", j.risks),
      section("Open decisions (locked)", j.open_decisions_locked),
      section("Out of scope", j.out_of_scope),
      section("References", j.references),
      section("Status note", j.status_note),
    ].filter(Boolean).join("");
    if (body.trim() === head.trim()) return null; // empty plan, skip
    return {
      id: `PLA${num}`,
      type: "plan",
      title: j.title,
      category: phase || "",
      topic: j.tracker_group ?? "",
      summary: j.value ?? j.status_note ?? "",
      content: body,
      report_date: j.date_last_updated || j.date_started || j.date_created || "",
      payload: {
        source_file: path.basename(file),
        original_id: j.id,
        phase, phase_id: j.phase_id, status: j.status,
        tracker_group: j.tracker_group,
      },
    };
  },

  // Codebase analyses (CO###.json) — same shape as research.
  code: (j, file) => {
    if (!j?.id || !j?.title || !j?.content) return null;
    const m = j.id.match(/^CO(\d+)$/);
    if (!m) return null;
    const num = m[1].padStart(3, "0");
    return {
      id: `COD${num}`,
      type: "code",
      title: j.title,
      category: j.category ?? "",
      topic: j.topic ?? "",
      summary: j.summary ?? "",
      content: j.content,
      report_date: j.date ?? "",
      payload: { source_file: path.basename(file), original_id: j.id },
    };
  },

  // Security audits (SA###.json) — same shape as research.
  security: (j, file) => {
    if (!j?.id || !j?.title || !j?.content) return null;
    const m = j.id.match(/^SA(\d+)$/);
    if (!m) return null;
    const num = m[1].padStart(3, "0");
    return {
      id: `SEC${num}`,
      type: "security",
      title: j.title,
      category: j.category ?? "",
      topic: j.topic ?? "",
      summary: j.summary ?? "",
      content: j.content,
      report_date: j.date ?? "",
      payload: { source_file: path.basename(file), original_id: j.id },
    };
  },
};

const TYPE_DIRS = {
  research: "dev/research",
  plan:     "dev/plans",
  code:     "dev/code",
  security: "dev/security-audits",
};

function listFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .filter(f => f.endsWith(".json"))
    .sort()
    .map(f => path.join(abs, f));
}

async function uploadOne(payload) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { status: res.status, body };
}

async function runType(type, { dryRun }) {
  const dir = TYPE_DIRS[type];
  const adapter = ADAPTERS[type];
  if (!dir || !adapter) {
    console.error(`unknown type "${type}"`);
    return { ok: 0, skip: 0, fail: 0 };
  }
  const files = listFiles(dir);
  console.log(`\n=== ${type} — ${files.length} candidate file(s) in ${dir} ===`);
  let ok = 0, skip = 0, fail = 0;
  for (const file of files) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) {
      console.log(`  SKIP  ${path.basename(file)} — malformed JSON`);
      skip++; continue;
    }
    const payload = adapter(parsed, file);
    if (!payload) {
      console.log(`  SKIP  ${path.basename(file)} — adapter returned null`);
      skip++; continue;
    }
    if (dryRun) {
      console.log(`  DRY   ${path.basename(file)} → ${payload.id} (${payload.title.slice(0, 60)})`);
      ok++; continue;
    }
    const res = await uploadOne(payload);
    if (res.status >= 200 && res.status < 300) {
      console.log(`  OK    ${path.basename(file)} → ${payload.id}`);
      ok++;
    } else {
      console.log(`  FAIL  ${path.basename(file)} → ${payload.id} [${res.status}] ${res.body.slice(0, 200)}`);
      fail++;
    }
  }
  return { ok, skip, fail };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const types = args.filter(a => !a.startsWith("--"));
  if (types.length === 0) {
    console.error("usage: node dev/scripts/import_reports.mjs <type|all> [--dry-run]");
    console.error("types: " + Object.keys(ADAPTERS).join(", "));
    process.exit(2);
  }
  const targetTypes = types.includes("all") ? Object.keys(ADAPTERS) : types;
  const totals = { ok: 0, skip: 0, fail: 0 };
  for (const t of targetTypes) {
    const r = await runType(t, { dryRun });
    totals.ok += r.ok; totals.skip += r.skip; totals.fail += r.fail;
  }
  console.log(`\n=== summary === ok=${totals.ok} skip=${totals.skip} fail=${totals.fail}`);
  process.exit(totals.fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
