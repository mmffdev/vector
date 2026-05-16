# MMFFDev Builder Brief — Generic Multi-Agent Build Protocol

> Reusable brief for any "research → design → build → test → publish" engagement where the user wants a professional-grade deliverable produced autonomously by an orchestrator + sub-agent team. Fill in the `{{PLACEHOLDERS}}` and pass this file (or its content) as the kickoff prompt.

---

## 1. Mission template

> **Mission:** Research, design, build, test, and publish `{{DELIVERABLE_NAME}}` — a STABLE / DEPENDABLE / FUNCTIONAL `{{DELIVERABLE_TYPE}}` that `{{ONE_LINE_PURPOSE}}`.

**Prime objective (always):** STABLE / DEPENDABLE / FUNCTIONAL. Surprise via UX polish, not via novel orchestration tricks.

---

## 2. Hard rules (passed to every agent)

Customise per engagement. The italicised lines are *defaults* — keep, drop, or replace as needed.

1. **Confidence threshold.** No production recommendation goes into the final report below **95%** confidence. Both orchestrator AND every named sub-agent must clear this bar. If an agent finishes below 95%, it is allowed to escalate to a follow-up sub-agent rather than ship a weaker recommendation.
2. **STABLE > clever.** Default to the boring, dependable solution.
3. **Testable.** Every behavioural recommendation must come with a test (unit, integration, or e2e simulation) recorded in the agent's test table.
4. **Logged, not dumped.** Every agent maintains a running log under `local-assets/{{PROJECT_SLUG}}/agents/<Name>.md`, updated as work progresses, not in one final dump.
5. _**NO GIT** — do not run any `git` command. Files in the working tree are fine; just no commits, branches, resets, pushes._  *(drop this if you DO want commits)*
6. _**Coexist** — do not modify or remove `{{EXISTING_TOOLING_LIST}}`._  *(drop if greenfield)*
7. _**Don't interact until handover.** The user has explicitly opted into autonomous mode and won't review intermediate steps._  *(drop if user wants checkpoints)*

---

## 3. Agent roster (named, up to 10)

Use the canonical 10-name roster below. Each name is a stable identity: same name = same domain, run after run, so test tables and reports are comparable across builds. **Drop any agent whose slice doesn't apply** to the current engagement; do not invent new names.

| # | Name | Default domain (specialise per build) |
|---|---|---|
| 1 | **Calliope** | App architecture & build/bundling system |
| 2 | **Boreas** | Network / transport / external service orchestration |
| 3 | **Demeter** | Process / lifecycle supervision |
| 4 | **Eros** | Logging, observability, tail/rotation |
| 5 | **Fenrir** | Bridges, IPC, cross-surface integration |
| 6 | **Gaia** | Test architecture (unit / integration / e2e) |
| 7 | **Helios** | Charts, graphs, data visualisation |
| 8 | **Iris** | Security, signing, sandbox, gatekeeping |
| 9 | **Janus** | Health probes, retry/backoff, contracts |
| 10 | **Kratos** | Existing-tooling integration & coexistence map |

**Coverage allocation must sum to 100%.** The orchestrator assigns weights up front (e.g. Calliope 15%, Boreas 10% …). Weights drive the slice tests each agent owns.

---

## 4. Each agent's deliverable (fixed template)

Agents write to `local-assets/{{PROJECT_SLUG}}/agents/<Name>.md`. The orchestrator must enforce this exact shape so the final report can stitch outputs without per-agent special-casing.

```markdown
# Agent: <Name>
**Role:** <one line>
**Scope assigned by orchestrator:** <bullets>
**Status:** starting | researching | drafting | testing | complete
**Confidence:** <0–100%>   ← must be ≥95% to mark complete
**Last update (UTC):** <ISO timestamp>

## Running log
- [<UTC>] action — outcome
- [<UTC>] action — outcome

## Findings
### Recommendation
<paragraph or bullets — must be implementable>

### Dead ends explored
- <approach> — why discarded

### Sources
- <url or repo path> — why useful

## Contribution
- Effort: <agent-turns or rough hours>
- Coverage of overall project: <%> (orchestrator-assigned slice weight)
- Files produced or modified: <list>

## Test strategy (this agent's slice)
| ID | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result (PASS/FAIL/SKIP) | Root cause if FAIL | Repeatable? | Action to repeat |
|---|---|---|---|---|---|---|---|---|---|
| <NAME>-T01 | … | … | … | … | … | … | … | … | … |

## Overall test-coverage understanding
<paragraph — your slice's place in the whole>

## Handover note to orchestrator
<paragraph — what's solid, what's still uncertain, what to integrate next>
```

**Failure recursion (hard).** When a slice test FAILs, the owning agent must record root cause + repeatability in its table, then either (a) propose and run the fix itself, or (b) escalate to a sibling agent or a fresh sub-agent. The orchestrator never silently drops a FAIL.

---

## 5. Deliverables (fixed)

The orchestrator produces exactly these artifacts. Paths use `{{PROJECT_SLUG}}` so multiple builds can coexist.

| # | Artifact | Path |
|---|---|---|
| 1 | The runnable thing | `{{ARTIFACT_PATH}}` (e.g. `MyApp.app/`, `dist/myservice`, `pkg/lib.tar.gz`) |
| 2 | Master orchestrator log | `local-assets/{{PROJECT_SLUG}}/MASTER.md` |
| 3 | Synthesised spec | `local-assets/{{PROJECT_SLUG}}/spec/SPEC.md` |
| 4 | Test plan + run log | `local-assets/{{PROJECT_SLUG}}/spec/TESTPLAN.md` |
| 5 | Charts (≥5 SVGs) | `local-assets/{{PROJECT_SLUG}}/charts/*.svg` |
| 6 | Per-agent logs | `local-assets/{{PROJECT_SLUG}}/agents/<Name>.md` × N |
| 7 | Final report (publishable) | `dev/research/RNNN.json` (next free RNNN, viewable in Dev → Research) |
| 8 | Shortcut doc | `.claude/commands/c_{{shortcut}}.md` + one-line entry in `.claude/CLAUDE.md` |
| 9 | Memory entry | `project_{{slug}}_backlog.md` in auto-memory |
| 10 | Handover document | `local-assets/{{PROJECT_SLUG}}/HANDOVER.md` |

---

## 6. Test plan structure (TESTPLAN.md)

Three tiers, with strict separation:

| Tier | Coverage target | Owns |
|---|---|---|
| **Unit** | ≥85% line / ≥90% branch on owned modules | Pure logic, parsers, state machines, math |
| **Integration** | ≥70% on glue | Probe contracts, process spawn/kill, bridge auth, fixture-driven flows |
| **E2E** | All happy paths + key sad paths (drop+recover, auth-fail, env switch, adoption, security) | Cross-cutting flows; orchestrator-driven |

**Master test table columns (mandatory).** Every row, every tier, no exceptions:

| ID | Title | Description (incl. anticipated action) | Itemised Steps | Expected | Actual / Recorded | Result | Root cause if FAIL | Repeatable? | Action to repeat |

Always include both **happy paths** and **sad paths** (drop, refuse, timeout, malformed input, race, partial failure, double-spawn, stale binary, etc.).

A live **Run log** section (TESTPLAN.md §7) appends real results as they happen, with PASS/FAIL counts and timestamps. Pending tiers are listed explicitly with the gating reason.

---

## 7. Charts (Helios)

Generate **at least 5** inline SVGs based on the data points the spec actually surfaces. Defaults that cover most builds — substitute as the domain demands:

1. Startup latency p50/p95 per component
2. Uptime / availability over a representative window
3. Retries (or errors) stacked by tag
4. Error rate per tag/category
5. A "frequency of operation X" chart from the run log
6. Time-to-first-healthy (or equivalent SLI)
7. Test results summary — stacked bar, PASS/FAIL/PENDING, with a dashed line at the 95% confidence threshold

**Quality bar:** every SVG must validate under `xmllint --noout`, include `role="img"` + `aria-labelledby` + `<title>` + `<desc>`, and be safe to inline into HTML/JSX.

---

## 8. Final report (`dev/research/RNNN.json`)

The publishable record. JSON wrapper around HTML content so it renders in Dev → Research. Fields (mandatory):

- `id`: `"R{{NNN}}"` — next free three-digit number
- `title`: human-readable
- `category`: one of `Engineering | Product | Research | Ops`
- `date`: ISO date
- `summary`: one paragraph
- `content`: HTML — see structure below

**`content` HTML structure (mandatory sections, in order):**

1. Overview (mission + confidence)
2. Agent roster table (name, slice, coverage %, status, confidence)
3. Spec → Implementation walk-through
4. Test results matrix (per slice + aggregate)
5. Charts (inline SVG references + captions)
6. Coexistence table (if applicable)
7. Findings (key decisions, gotchas)
8. Dead ends explored
9. How to run (code blocks)
10. Where things live (file map)
11. Sources
12. Gaps / next phase
13. Confidence statement

---

## 9. Orchestrator playbook (the order of operations)

The orchestrator runs in **phases**. Use a TodoList so progress is visible. Default phases:

- **P0** — Master file, agent log template, dirs, toolchain probe.
- **P1** — Spawn the named agents in parallel (one tool message, multiple Agent calls). Each agent writes its log + slice test table + recommendation.
- **P2** — Synthesise SPEC.md and TESTPLAN.md from agent outputs. Reject anything below 95% confidence — recurse on it.
- **P3** — Scaffold the project skeleton.
- **P4** — Build foundation modules (logging, retry, health, locks, supervision).
- **P5** — Build managers / domain modules.
- **P6** — Build the user surface (UI / CLI / API).
- **P7** — Build the bridge / external surface (if any).
- **P8a** — Run unit tier; record every result in TESTPLAN.md §7.
- **P8b** — Build fixtures and run integration tier.
- **P8c** — Run e2e tier.
- **P9** — Generate the SVG charts.
- **P10** — Compile and publish `dev/research/RNNN.json`.
- **P11** — Write the shortcut doc + memory entry + handover note. Hand back to user.

**Pause-points (only these):** if a hard rule would be broken (destructive git, modifying coexisting tooling without permission, sending data externally), stop and ask. Otherwise continue.

---

## 10. Reporting requirements (always)

- **Effort %** per agent (rough, agent-turns or hours).
- **Coverage %** per agent (the slice weight assigned at P0; sums to 100).
- **Confidence %** per agent (must be ≥95% to mark complete).
- **Findings** as bullet points — the non-obvious things future-you needs to know.
- **Dead ends** explicitly recorded — the approaches you rejected and why.
- **Sources** — every URL or repo path consulted, with one phrase on why it mattered.

The orchestrator's MASTER.md log mirrors the agent template at the project level: running log, recommendation, dead ends, sources, contribution, test strategy, handover note.

---

## 11. Confidence escalation

If an agent or the orchestrator can't reach 95%:

1. **Read more source.** Skip second-hand summaries — read the canonical code/docs.
2. **Spawn a focused sub-sub-agent** scoped to the single open question.
3. **If still below 95% after that** — record the gap explicitly in the final report under "Gaps / next phase" with the precise unknown, the workaround used, and the trigger condition that should resume the work.

Never ship a recommendation under 95% as if it were settled.

---

## 12. Handover document (final)

The handover lives at `local-assets/{{PROJECT_SLUG}}/HANDOVER.md` and links the user to everything in one place:

- What you're getting (1 paragraph)
- How to run (code block)
- Where everything lives (table)
- Multi-agent contribution table
- Test results summary
- Key findings & decisions
- Dead ends explored
- Charts list
- Coexistence map (if applicable)
- What's NOT in v0.1 (deferred to v0.2)
- Next steps when the user resumes

This is the file the user reads first when work resumes. It must be self-sufficient.

---

## 13. Kickoff prompt template

When invoking the orchestrator (this brief in hand), the user's first message looks like:

> "Build `{{DELIVERABLE_NAME}}`. Use the MMFFDev Builder Brief. Mission: `{{ONE_LINE_PURPOSE}}`. Hard rules: `{{ANY_OVERRIDES}}` (else use defaults). Coexist with: `{{TOOLING_OR_'greenfield'}}`. I won't interact until handover."

The orchestrator then writes MASTER.md, spawns the named agents, and proceeds through P0..P11 autonomously, pausing only on the hard-rule violations listed in §9.
