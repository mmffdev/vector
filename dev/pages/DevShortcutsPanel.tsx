"use client";

import { Fragment } from "react";
import Panel from "@/app/components/Panel";

type Flag = { label: string; note?: string };

type Shortcut = {
  tag: string;
  desc: string;
  flags: Flag[];
  loadPath: string[];
};

type Category = {
  name: string;
  shortcuts: Shortcut[];
};

const DATA: Category[] = [
  {
    name: "Session & Navigation",
    shortcuts: [
      {
        tag: "<?>",
        desc: "Open this shortcuts reference page in the browser. Pass -u to rescan all command and skill docs and regenerate this list first.",
        flags: [
          { label: "-u", note: "Rescan .claude/commands/c_*.md + .claude/skills/*/SKILL.md, regenerate page" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_shortcuts.md"],
      },
      {
        tag: "<handoff>",
        desc: "Compact the current conversation into a handoff document for another agent to pick up. Writes to a temp markdown file; suggests follow-up skills for the next session.",
        flags: [
          { label: '"focus note"', note: "Optional arg — one-liner describing what the next session will focus on" },
        ],
        loadPath: ["CLAUDE.md", "skills/handoff/SKILL.md"],
      },
      {
        tag: "<memory>",
        desc: ".claude/ context scanner — health-checks Memory, Skills, Commands, Hooks, and Agents. Writes a timestamped JSON report to dev/reports/ rendered by the Dev → Reports tab.",
        flags: [
          { label: "-A", note: "Scan all areas" },
          { label: "-M", note: "Memory files only" },
          { label: "-S", note: "Skills only" },
          { label: "-C", note: "Commands only" },
          { label: "-H", note: "Hooks only" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_memory.md"],
      },
      {
        tag: "<caveman>",
        desc: "Ultra-compressed communication mode. Cuts token usage ~75% by dropping filler, articles, and pleasantries while keeping full technical accuracy. Persistent until 'stop caveman'.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/caveman/SKILL.md"],
      },
      {
        tag: "<zoom-out>",
        desc: "Tell the agent to zoom out and give a higher-level perspective. Returns a map of relevant modules and callers using the project's domain vocabulary.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/zoom-out/SKILL.md"],
      },
    ],
  },
  {
    name: "Dev Services",
    shortcuts: [
      {
        tag: "<services>",
        desc: "Read-only status check for active-env DB tunnel, Go backend (:5100), Next.js frontend (:5101). Compares running backend commit against HEAD and flags stale builds.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_services.md"],
      },
      {
        tag: "<npm>",
        desc: "Start the Next.js dev server on :5101. Detects an existing instance and reports its URL instead of starting a duplicate. Logs to /tmp/mmff-next.log.",
        flags: [
          { label: "-where", note: "Report running URL" },
          { label: "-stop",  note: "Kill the server" },
          { label: "-restart", note: "Kill then restart" },
          { label: "-PORT",  note: "Start on a custom port" },
          { label: "-h",     note: "Help + all flag details" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_npm.md"],
      },
      {
        tag: "<server>",
        desc: "Switch backend DB env (dev / staging / production). Restarts Go on :5100, ensures Next on :5101, rewrites ACTIVE_BACKEND_ENV marker in CLAUDE.md. Env is pinned to dev by HARD RULE — Claude must not invoke this.",
        flags: [
          { label: "-d", note: "dev" },
          { label: "-s", note: "staging" },
          { label: "-p", note: "production (requires typed confirmation)" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_server.md"],
      },
      {
        tag: "<launcher>",
        desc: "MMFF Vector Launcher.app — native SwiftUI macOS dashboard that orchestrates SSH tunnel → Go backend → Next.js → Docusaurus with start/stop/restart-all + per-component controls and env switching.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_launcher.md"],
      },
      {
        tag: "<seleniumup>",
        desc: "Ping the Selenium Grid hub then open http://localhost:4444/ui/ in the browser. Also surfaces the noVNC live viewer at :7900 (password: secret).",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_selenium.md"],
      },
      {
        tag: "<playwright>",
        desc: "Playwright MCP — 21 browser automation tools. Disabled by default; Crawlio is preferred. Reference doc only.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_playwright.md"],
      },
    ],
  },
  {
    name: "Database",
    shortcuts: [
      {
        tag: "<backupsql>",
        desc: "Snapshot all three remote Postgres databases (mmff_vector, mmff_library, vector_artefacts) via the SSH tunnel. Tagged with HEAD short SHA + env. Mirrors to iCloud Drive after local dump.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_db-backup.md"],
      },
      {
        tag: "<migration>",
        desc: "Scaffold + apply a file-based SQL migration against one of the three dev DBs. Picks next NNN, writes header + BEGIN/COMMIT skeleton, dry-runs, applies, verifies schema_migrations. Never assumes a DB.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/migration/SKILL.md"],
      },
      {
        tag: "<cookbook>",
        desc: "Harvest ~/.psql_history since last run into docs/c_sql_cookbook_staging.md for next-session curation. Filters trivial queries and dedupes against the main cookbook.",
        flags: [
          { label: "-s", note: "Dry-run — show what would be harvested" },
          { label: "-r", note: "Reset the last-harvest marker (re-scan everything)" },
          { label: "-c", note: "Curate staging into the main cookbook" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_cookbook.md"],
      },
    ],
  },
  {
    name: "Credentials & Tests",
    shortcuts: [
      {
        tag: "<accounts>",
        desc: "Source of truth for all dev user accounts, passwords, and Planka credentials. Queries live DB for current users; credential locations for DB, MASTER_KEY, JWT; password reset procedure.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_accounts.md"],
      },
      {
        tag: "<tests>",
        desc: "Query Tracker red-green tests for this project (Vector). Default = tests for current/recent work (resolved by parsing recent commits' story refs). Flags filter by group / plan / status.",
        flags: [
          { label: "-g <slug>",     note: "Show tests for a Tracker group" },
          { label: "-p PLA-NNNN",   note: "Show tests for a plan" },
          { label: "-G",            note: "List all registered groups in the project" },
          { label: "-r",            note: "Show recent runs (latest 10)" },
          { label: "-f",            note: "Filter to failing/red tests only" },
          { label: "-h",            note: "Help" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_tests.md"],
      },
    ],
  },
  {
    name: "Backlog, Scope & Stories",
    shortcuts: [
      {
        tag: "<backlog>",
        desc: "Opens the root BACKLOG.md — Rick-owned module roadmap (VECTOR, ORIGO, SIGMA, FLUX, SPINE, OPERATOR PLATFORM).",
        flags: [
          { label: "-l", note: "List all module codenames + their one-line meaning" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_backlog.md"],
      },
      {
        tag: "<scope>",
        desc: "Manage Vector_Scope.md as the single source of truth for product scope, priorities, and progress. Discusses IN FLIGHT items, suggests priorities, updates state.",
        flags: [
          { label: "-r", note: "Read & discuss" },
          { label: "-a", note: "Add" },
          { label: "-u", note: "Update" },
        ],
        loadPath: ["CLAUDE.md", "skills/scope/SKILL.md"],
      },
      {
        tag: "/stories",
        desc: "Story creation. Solo-dev mode (default) — title + 1–3 AC, one-line entry appended to Vector_Scope.md. Prod-ready mode (--full) — original 7-gate flow with Fibonacci, EST/RISK tags, PLA plan files.",
        flags: [
          { label: "--full", note: "Prod-ready mode (when first external user committed or launch dated)" },
        ],
        loadPath: ["CLAUDE.md", "skills/stories/SKILL.md"],
      },
      {
        tag: "<r>",
        desc: "Honest retrospective on the last work segment. 5 Whys with reversal validation, two-table heatmap, recurring-issue ledger sync, auto-promotion to S1 tech debt after 3+ hits. Auto-fires when loop-detector trips.",
        flags: [
          { label: "--auto-loop",          note: "Auto-fires from loop-detector hook" },
          { label: "--scope full|segment", note: "Default = segment (since last 'go')" },
          { label: '--note "..."',         note: "Optional one-liner from the user" },
        ],
        loadPath: ["CLAUDE.md", "skills/retro/SKILL.md"],
      },
    ],
  },
  {
    name: "Scaffolding",
    shortcuts: [
      {
        tag: "<makeapp>",
        desc: "Scaffold a user-facing UI app in app/store/ui_apps/ui_app_<name>/. Creates manifest, index component, scoped CSS, and registers in app/store/registry.ts.",
        flags: [
          { label: "-<name>",  note: "Slug (lowercase, a-z0-9_)" },
          { label: "-<scope>", note: "One-line description" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_make-app.md"],
      },
      {
        tag: "<makedevapp>",
        desc: "Scaffold a dev-only UI app in dev/store/ui_apps/ui_app_<name>/. Uses d_ prefix, defaults to gadmin role, NOT registered in app/store/registry.ts.",
        flags: [
          { label: "-<name>",  note: "Slug" },
          { label: "-<scope>", note: "Description. Never expose to user or padmin." },
        ],
        loadPath: ["CLAUDE.md", "commands/c_make-dev-app.md"],
      },
      {
        tag: "<makeskill>",
        desc: "Meta-skill — generate a NEW audit/report skill from the user's preceding chat statement + a name flag. Generated skill follows the canonical audit → HTML+TOC → JSON → next-R### pipeline and writes into dev/research/.",
        flags: [
          { label: "-<name>",  note: "The new skill's tag (required)" },
          { label: "-<scope>", note: "One of frontend | backend | db | docs | all (default all)" },
        ],
        loadPath: ["CLAUDE.md", "skills/makeskill/SKILL.md"],
      },
      {
        tag: "<write-a-skill>",
        desc: "Create new agent skills with proper structure, progressive disclosure, and bundled resources. Used when a skill needs more than the <makeskill> audit-pipeline template.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/write-a-skill/SKILL.md"],
      },
      {
        tag: "<chart>",
        desc: "Build a new chart component in app/components/, themed with the active CSS pack, with stub data + a sanitised preview-only random generator. Adds the chart to the dashboard catalog.",
        flags: [
          { label: "-m",        note: "MAKE — user attaches an image; build chart matching the diagram" },
          { label: '-m "Name"', note: "MAKE with explicit component name" },
        ],
        loadPath: ["CLAUDE.md", "skills/chart/SKILL.md"],
      },
      {
        tag: "<theme>",
        desc: "Generate a Vector theme pack from an attached image (or hex list). Extracts palette, applies role-mapping rules, writes CSS, registers it in the theme picker.",
        flags: [
          { label: '"Name"', note: "Optional theme name — otherwise inferred from image" },
        ],
        loadPath: ["CLAUDE.md", "skills/theme/SKILL.md"],
      },
      {
        tag: "<prototype>",
        desc: "Build a throwaway prototype to flesh out a design before committing. Routes to either a runnable terminal app (state/logic questions) or several radically different UI variations on one route (visual exploration).",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/prototype/SKILL.md"],
      },
    ],
  },
  {
    name: "Code Quality & Audits",
    shortcuts: [
      {
        tag: "<codebase>",
        desc: "Run a full codebase quality audit (7-dimension research-paper review). Saves to dev/research/ as the next sequential R### entry, viewable in Dev → Research. One-shot — no other shortcut required.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/codebase/SKILL.md"],
      },
      {
        tag: "<sec>",
        desc: "Run a full codebase security audit. Saves to dev/security-audits/ as a numbered SA### entry viewable in Dev → Security Audits. Categories: data/user security, access control, storage, code quality, common guidelines.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/sec/SKILL.md"],
      },
      {
        tag: "<diagnose>",
        desc: "Disciplined diagnosis loop for hard bugs and performance regressions. Reproduce → minimise → hypothesise → instrument → fix → regression-test.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/diagnose/SKILL.md"],
      },
      {
        tag: "<tdd>",
        desc: "Test-driven development with red-green-refactor loop. Tests verify behaviour through public interfaces, not implementation details. Used when building features or fixing bugs test-first.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/tdd/SKILL.md"],
      },
      {
        tag: "<improve-codebase-architecture>",
        desc: "Find deepening opportunities in a codebase — refactors that turn shallow modules into deep ones. Informed by domain language in CONTEXT.md and decisions in ADRs. Aims for testability and AI-navigability.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/improve-codebase-architecture/SKILL.md"],
      },
      {
        tag: "<css>",
        desc: "Audit a named UI element against the CSS/HTML naming convention and propose corrected class names. Pattern: root-block__Container_Child_leaf. Can apply fixes after confirmation.",
        flags: [
          { label: "--apply",        note: "Patch in place after confirmation" },
          { label: "--strip-debug",  note: "Remove debug-only attributes" },
        ],
        loadPath: ["CLAUDE.md", "skills/css/SKILL.md"],
      },
      {
        tag: "<code-standards>",
        desc: "Code standards reference — CSS naming, state classes, dev-tree rules. Lazy-loaded before writing or editing code.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_code-standards.md"],
      },
    ],
  },
  {
    name: "Search & Navigation",
    shortcuts: [
      {
        tag: "<search>",
        desc: "Fan-out targeted full-repo search. Spawns 4 parallel Haiku sub-agents across the four major buckets of the tree; each returns a compiled list of hits (file:line + 1-line context). Case-insensitive by default.",
        flags: [
          { label: "<term>", note: "Any literal string or name. Reserve for genuinely unknown territory — prefer direct Grep/Glob when the area is known." },
        ],
        loadPath: ["CLAUDE.md", "skills/search/SKILL.md"],
      },
      {
        tag: "<tree>",
        desc: "Audit the docs tree shape against the Authoring rule. Every index entry must be one line (bold label → link → half-sentence hook). Patches violations in-place. Never commits.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_tree.md"],
      },
      {
        tag: "<treelist>",
        desc: "Reference pattern for rendering a recursive tree structure with correct connector lines (│ ├ └) at any depth. Use whenever building or fixing a tree-view list component.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/treelist/SKILL.md"],
      },
    ],
  },
  {
    name: "Documentation & Research",
    shortcuts: [
      {
        tag: "<librarian>",
        desc: "Sync docs with code and scan for security violations. Runs as background subagent. Patches drift in-place, creates new leaves when concepts appear. Never commits.",
        flags: [
          { label: "schema"   },
          { label: "auth"     },
          { label: "backend"  },
          { label: "app"      },
          { label: "devops"   },
          { label: "security" },
          { label: "full",    note: "Audit all leaves regardless of changes (slow — for pre-release)" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_librarian.md"],
      },
      {
        tag: "/research",
        desc: "Spawn the research agent to crawl a website and compile a structured report. Saves to dev/research/ as a numbered JSON entry viewable in the Dev → Research tab.",
        flags: [
          { label: "--page",        note: "Save as next R### entry in dev/research/" },
          { label: "--output path", note: "Save markdown report to the specified file path" },
          { label: "(no flag)",     note: "Display compiled report in chat" },
        ],
        loadPath: ["CLAUDE.md", "skills/research/SKILL.md"],
      },
      {
        tag: "<addpaper>",
        desc: "Lightweight web-search-only research-paper shorthand. Hands off to c_write-research-paper.md which writes the JSON to dev/research/RNNN.json. For URL crawling + search, use <research> instead.",
        flags: [
          { label: "<topic>", note: "Free-form topic. Example: <addpaper> Docker Swarm networking" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_addpaper.md"],
      },
    ],
  },
  {
    name: "Issue Tracker (Matt Pocock skills)",
    shortcuts: [
      {
        tag: "<triage>",
        desc: "Triage issues through a state machine driven by triage roles. Use when creating an issue, reviewing incoming bugs, preparing issues for an AFK agent, or managing the issue workflow.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/triage/SKILL.md"],
      },
      {
        tag: "<to-issues>",
        desc: "Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/to-issues/SKILL.md"],
      },
      {
        tag: "<to-prd>",
        desc: "Turn the current conversation context into a PRD and publish it to the project issue tracker. Synthesises from existing context — does not interview the user.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/to-prd/SKILL.md"],
      },
    ],
  },
  {
    name: "Collaboration",
    shortcuts: [
      {
        tag: "<grill-me>",
        desc: "Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. One question at a time.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/grill-me/SKILL.md"],
      },
      {
        tag: "<grill-with-docs>",
        desc: "Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise.",
        flags: [],
        loadPath: ["CLAUDE.md", "skills/grill-with-docs/SKILL.md"],
      },
    ],
  },
  {
    name: "Content",
    shortcuts: [
      {
        tag: "/writeweb",
        desc: "Human-AI collaborative website copy. Produces text that reads like an expert and an AI worked together — professional yet warm, precise yet conversational. Pass -h to print flag reference.",
        flags: [
          { label: "-t hero",      note: "20–50 words. Hook sentence, strong verb, no lists" },
          { label: "-t feature",   note: "80–150 words. Benefit-led, one optional short list" },
          { label: "-t faq",       note: "60–100 words/answer. Direct answer in first sentence" },
          { label: "-t about",     note: "150–300 words. Warmer register, narrative voice" },
          { label: "-t explainer", note: "Full prose, scales with -len. Default type" },
          { label: "-len short|medium|long", note: "Word count target (ignored by -t hero)" },
          { label: "-context",     note: "Industry or audience note" },
          { label: "-h",           note: "Print flag reference; no copy generated" },
        ],
        loadPath: ["CLAUDE.md", "skills/writeweb/SKILL.md"],
      },
    ],
  },
];

function LoadPath({ path }: { path: string[] }) {
  return (
    <div className="dui-breadcrumb">
      {path.map((seg, i) => (
        <span key={i} className="dui-breadcrumb__item">
          {i > 0 && <span className="dui-breadcrumb__sep">→</span>}
          <code className={`dui-breadcrumb__seg${i === 0 ? " dui-breadcrumb__seg--root" : ""}`}>{seg}</code>
        </span>
      ))}
    </div>
  );
}

export default function DevShortcutsPanel() {
  return (
    <Panel name="dev_shortcuts" title="Shortcuts">
      <div className="dui-page">
        <table className="dui-table">
          <thead>
            <tr>
              <th>Shortcut</th>
              <th>What it does</th>
              <th>Flags</th>
              <th>Load path</th>
            </tr>
          </thead>
          <tbody>
            {DATA.map((cat) => (
              <Fragment key={cat.name}>
                <tr className="dui-table__group">
                  <td colSpan={4}>{cat.name}</td>
                </tr>
                {cat.shortcuts.map((sc) => (
                  <tr key={sc.tag}>
                    <td className="dui-table__cell--rich dui-table__cell--shrink">
                      <span className="dui-tag">{sc.tag}</span>
                    </td>
                    <td className="dui-table__cell--rich dui-table__cell--lede">{sc.desc}</td>
                    <td className="dui-table__cell--rich">
                      {sc.flags.length === 0 ? (
                        <span className="dui-kbd-list__empty">—</span>
                      ) : (
                        <div className="dui-kbd-list">
                          {sc.flags.map((f) => (
                            <div key={f.label} className="dui-kbd-list__row">
                              <code className="dui-kbd">{f.label}</code>
                              {f.note && <span className="dui-kbd-list__note">{f.note}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="dui-table__cell--rich">
                      <LoadPath path={sc.loadPath} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        <p className="dui-page__subtitle">
          Run <code className="dui-kbd">&lt;?&gt; -u</code> in Claude Code to rescan and regenerate from source.
        </p>
      </div>
    </Panel>
  );
}
