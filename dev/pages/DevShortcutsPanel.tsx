"use client";

import { Fragment } from "react";

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
        tag: "<b> -N",
        desc: "Session boot file manager — numbered snapshots. Lazy-load on read: surfaces only branch, story counter, and What's next by default. Remaining sections available on explicit request.",
        flags: [
          { label: "-N -R", note: "Read into context (lazy surface only, no writes)" },
          { label: "-N -C", note: "Create or update snapshot with git state + story counter; adds MEMORY.md pointer for new files" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_boot.md"],
      },
      {
        tag: "<b> -A",
        desc: "Session boot file manager — master record. Writes bootA.md: all cards touched, all uncommitted changes, key decisions, full commit log, and every next step across all work streams.",
        flags: [
          { label: "-A -R", note: "Load master record into context (lazy surface)" },
          { label: "-A -C", note: "Write full-session bootA.md — always overwrites, never added to MEMORY.md" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_boot.md"],
      },
      {
        tag: "<?>",
        desc: "Open this shortcuts reference page in the browser.",
        flags: [
          { label: "-u", note: "Rescan all command + skill docs, regenerate page, then open" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_shortcuts.md"],
      },
    ],
  },
  {
    name: "Dev Services",
    shortcuts: [
      {
        tag: "<services>",
        desc: "Read-only status check for SSH tunnel (:5434), Go backend (:5100), Next.js frontend (:5101). Compares running backend commit against HEAD and flags stale builds.",
        flags: [
          { label: "-s", note: "Append live app user list from DB + Planka board credentials" },
        ],
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
        tag: "<seleniumup>",
        desc: "Ping the Selenium Grid hub then open http://localhost:4444/ui/ in the browser. Also surfaces the noVNC live viewer at :7900 (password: secret).",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_selenium.md"],
      },
      {
        tag: "<playwright>",
        desc: "Playwright MCP — 21 browser automation tools. Disabled by default; Crawlio is preferred. Enable by renaming .mcp.json.disabled → .mcp.json in the project root.",
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
        desc: "Dump the remote mmff_vector DB via SSH tunnel (:5434) to a timestamped SQL file tagged with the current HEAD short SHA. Output: local-assets/backups/YYYYMMDD_HHMMSS_<sha>.sql.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_db-backup.md"],
      },
    ],
  },
  {
    name: "Credentials",
    shortcuts: [
      {
        tag: "<accounts>",
        desc: "Source of truth for all dev user accounts, passwords, and Planka credentials. Queries live DB for current users; credential locations for DB, MASTER_KEY, JWT; password reset procedure.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_accounts.md"],
      },
    ],
  },
  {
    name: "Backlog & Stories",
    shortcuts: [
      {
        tag: "<backlog>",
        desc: "Planka kanban management via MCP. Tunnel required (:3333). Reads, creates, moves, and accepts cards. Entry point: .claude/bin/planka — never use curl directly.",
        flags: [
          { label: "-a",      note: "List all cards" },
          { label: "-n",      note: "New card" },
          { label: "-d",      note: "Done / move card" },
          { label: "-accept", note: "Approve a card" },
          { label: "-view",   note: "Open dev/planning/c_backlog.md in VS Code (long-range roadmap)" },
          { label: "-h",      note: "Help" },
        ],
        loadPath: ["CLAUDE.md", "docs/c_backlog.md"],
      },
      {
        tag: "/stories",
        desc: "7-gate story acceptance system. Decomposes a feature description into shippable user stories, creates Planka Backlog cards with AIGEN + Phase + Feature + EST + RISK labels. Fibonacci F0–F13; F21+ auto-splits. 85%+ confidence required on all 7 gates.",
        flags: [
          { label: "description", note: "Pass a free-form feature plan as input" },
        ],
        loadPath: ["CLAUDE.md", "skills/stories/SKILL.md"],
      },
    ],
  },
  {
    name: "Scaffolding",
    shortcuts: [
      {
        tag: "<makeapp>",
        desc: "Scaffold a user-facing UI app in app/store/ui_apps/ui_app_<name>/. Creates manifest, index component, scoped CSS, and registers the app in app/store/registry.ts.",
        flags: [
          { label: "-name",  note: "Slug (lowercase, a-z0-9_)" },
          { label: "-scope", note: "One-line description stored in manifest + used to seed component body" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_make-app.md"],
      },
      {
        tag: "<makedevapp>",
        desc: "Scaffold a dev-only UI app in dev/store/ui_apps/ui_app_<name>/. Uses d_ file prefix, defaults to gadmin role only, NOT registered in app/store/registry.ts.",
        flags: [
          { label: "-name",  note: "Slug" },
          { label: "-scope", note: "Description. Never expose to user or padmin." },
        ],
        loadPath: ["CLAUDE.md", "commands/c_make-dev-app.md"],
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
          { label: "-context",     note: "Industry or audience note — calibrates warmth and vocabulary" },
          { label: "-h",           note: "Print flag reference; no copy generated" },
        ],
        loadPath: ["CLAUDE.md", "skills/writeweb/SKILL.md"],
      },
    ],
  },
  {
    name: "Research",
    shortcuts: [
      {
        tag: "/research",
        desc: "Research agent — crawls websites, searches the web, and compiles structured reports. Use --page to save as a numbered JSON entry viewable in Dev → Research tab.",
        flags: [
          { label: "--page",        note: "Save as RXXX.json in dev/research/ (HTML content, viewable in Dev → Research tab)" },
          { label: "--output path", note: "Save markdown report to the specified file path" },
          { label: "(no flag)",     note: "Display compiled report in chat" },
        ],
        loadPath: ["CLAUDE.md", "commands/c_research.md"],
      },
    ],
  },
  {
    name: "Documentation",
    shortcuts: [
      {
        tag: "<librarian>",
        desc: "Sync docs with code and scan for security violations. Runs as background subagent. Patches drift in-place, creates new leaves when concepts appear. Never commits — human commits on next natural boundary.",
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
        tag: "<tree>",
        desc: "Audit the docs tree shape against the Authoring rule. Every index entry must be one line (bold label → link → half-sentence hook). Patches violations in-place. Never commits.",
        flags: [],
        loadPath: ["CLAUDE.md", "commands/c_tree.md"],
      },
    ],
  },
];

function LoadPath({ path }: { path: string[] }) {
  return (
    <div className="dev-sc-path">
      {path.map((seg, i) => (
        <span key={i} className="dev-sc-path__item">
          {i > 0 && <span className="dev-sc-path__arrow">→</span>}
          <code className={`dev-sc-path__seg${i === 0 ? " dev-sc-path__seg--root" : ""}`}>{seg}</code>
        </span>
      ))}
    </div>
  );
}

export default function DevShortcutsPanel() {
  return (
    <div className="dev-sc">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr className="table__head">
              <th className="table__cell" style={{ width: "10%" }}>Shortcut</th>
              <th className="table__cell" style={{ width: "50%" }}>What it does</th>
              <th className="table__cell" style={{ width: "20%" }}>Flags</th>
              <th className="table__cell" style={{ width: "20%" }}>Load path</th>
            </tr>
          </thead>
          <tbody>
            {DATA.map((cat) => (
              <Fragment key={cat.name}>
                <tr className="dev-sc-category">
                  <td className="dev-sc-cell" colSpan={4}>{cat.name}</td>
                </tr>
                {cat.shortcuts.map((sc) => (
                  <tr key={sc.tag} className="table__row">
                    <td className="table__cell dev-sc-cell">
                      <span className="dev-sc-tag">{sc.tag}</span>
                    </td>
                    <td className="table__cell dev-sc-cell dev-sc-desc">{sc.desc}</td>
                    <td className="table__cell dev-sc-cell">
                      {sc.flags.length === 0 ? (
                        <span className="dev-sc-noflag">—</span>
                      ) : (
                        <div className="dev-sc-flags">
                          {sc.flags.map((f) => (
                            <div key={f.label} className="dev-sc-flag-row">
                              <code className="dev-sc-flag">{f.label}</code>
                              {f.note && <span className="dev-sc-flag-note">{f.note}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="table__cell dev-sc-cell">
                      <LoadPath path={sc.loadPath} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dev-sc-footer">
        Run <code>&lt;?&gt; -u</code> in Claude Code to rescan and regenerate from source.
      </p>
    </div>
  );
}
