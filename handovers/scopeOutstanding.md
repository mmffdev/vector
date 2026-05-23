# Handover — Scope Outstanding (post-PLA061 landing)

**Created:** 2026-05-24
**Source session:** Next.js library research → PLA061 → scope hand-off (Phase 1 + Phase 2)
**Vector_Scope.md version at handover:** **2.55**

---

## TL;DR

The previous session researched the 2026 Next.js / React ecosystem (7 parallel sub-agents, 7 axes), distilled the findings into **PLA061** (`Next.js Ecosystem Library Adoption — Shortlist`) filed to `dev_reports`, then routed the proposed stories through `<scope> -a` in two waves:

- **Phase 1 (6 stories, all 🔵 IN FLIGHT)** — perf + theme + perimeter rate-limit
- **Phase 2 (8 stories: 6 cold + 2 promoted IN FLIGHT)** — deferred candidates + procurement-bar promotions (helmet+CSP, DOMPurify)

The session ended with a **full outstanding-scope enumeration** showing **20 actually-IN-FLIGHT items** (not the 32 the SessionStart digest counts — that overcounts strikethrough-children-under-done-parents) and **238 scoped-cold**. The next agent's job is **not** to start coding any of the IN FLIGHT items — it's to help the user decide what to actually pick up first, or to run `<scope> -r` to triage the parked sections and forcing-function near-misses.

---

## What is DONE this session

**Reports filed to `dev_reports` (visible on /dev/reporting Plan tab):**
- **PLA061** — `Next.js Ecosystem Library Adoption — Shortlist`. Three Change Log entries (initial · repo links injected · benefit scores added). 6 Phase-1 proposed stories with full AC; 8 Phase-2 deferred candidates with triggers; per-item benefit scores 1–5 on every entry.

**`Vector_Scope.md` writes:**
- New top-level section **F2. Frontend Stack (PLA061)** between F1 and M1 — entries F2.1–F2.10 (F2.1–F2.4 🔵 IN FLIGHT; F2.5–F2.10 scoped-cold, awaiting trigger).
- **B16.14 → B16.17** appended to Security & Auth — all 🔵 IN FLIGHT, all [P2]. B16.14/15 = perimeter rate-limit pair (decision + middleware). B16.16/17 = procurement-bar promotions from Phase 2 deferred (helmet+CSP, isomorphic-dompurify).
- ToC updated with F2 entry.
- Doc version 2.53 → 2.54 → 2.55. Last-updated note prepended twice with PLA061 Phase 1 + Phase 2 summaries.

**`.claude/scope-refs.map` writes:**
- 14 new lines (6 Phase 1 + 8 Phase 2), keywords harvested from titles AND AC bullets so commits referencing e.g. `perimeter.ratelimit.deny`, `material-color-utilities`, or `isomorphic-dompurify` resolve to the right ref. Map at 300 lines.

**No commits, no code changes.** Pure scope + planning work.

---

## Where to pick up next

The user ended the session with a list-everything-outstanding request. The natural next moves, in order of likely value:

1. **Run `<scope> -r`** — read-and-discuss on the 20 IN FLIGHT items + the parked sections (FE-POR-0003 25 items, B-SHARE 8 items, both parked). Two of the FORCING FUNCTION items (FE-POR-0002 ★) are close to done — worth a codebase check to confirm done-ness and mark ✅.
2. **Decide what to actually start.** RF2 has 12 IN FLIGHT but is gated by `RF2.0.1` stop-gate (pattern doc must be reviewed-and-confirmed by user before any Phase 1 commit lands — see the stop-gate hard rule in the entry body). The 8 PLA061 IN FLIGHT items (F2.1–F2.4, B16.14–B16.17) are ungated and small — natural quick-win cycle.
3. **Phase 2 cold candidates** (F2.5–F2.10) are listed in scope but their TD entries in `docs/c_tech_debt.md` are NOT yet filed — that's **F2.4's job**. Don't double-file. F2.4 is the work that creates the canonical stack-picks doc AND the 8 TD rows in one go.

### Quick recommendation pick-up order (the user did not commit to one)

If picking from the 8 PLA061 IN FLIGHT items, my session-end suggestion was:

**B16.14 (decision story, no code) → F2.1 (react-scan, dev-only drop-in) → B16.15 (perimeter middleware) → F2.4 (stack-picks doc + 8 TD rows) → F2.3 (theme math migration) → F2.2 (Million, measure-then-keep) → B16.16 (helmet+CSP) → B16.17 (DOMPurify scaffolding).**

Rationale: alternates between low-risk drop-ins and procurement-bar work; F2.4 lands in the middle so the deferred TDs exist before later F2 work hits the doc.

The user has not confirmed this order — treat as a suggestion, not a directive.

---

## Known caveats

- **WIP cap.** `Vector_Scope.md` header says "Solo-dev mode — WIP cap 5" but the active board now sits at **20 🔵 IN FLIGHT** (12 RF2 + 8 PLA061). The user explicitly waived the cap mid-session: *"ignore wip these are all expidited"*. Don't re-litigate the cap or suggest reverting markers; the override stands. A future `<scope> -r` retro can revisit if it bites.
- **Stop-gate on RF2.** `RF2.0.1` carries an explicit "stop gate: this story stays ⏳ until user explicitly reviews and confirms — no Phase 1 code commit until RF2.0.1 flips to ✅ CLEARED" hard rule in its body. **Do not start any RF2.x.y work** until the user signs off on the pattern doc (`docs/c_c_service_depth_pattern.md`) referenced in that gate. Even though 12 RF2 stories are marked 🔵 IN FLIGHT, the gate blocks committing against any of them.
- **B16.17 DOMPurify is admitted scaffolding.** Its body explicitly says "until a user-HTML surface lands, this is scaffolding with no caller (bundle cost only; no behaviour change)." User confirmed they want it IN FLIGHT anyway on procurement-narrative grounds. Don't push back unless asked.
- **F2.4 is the trigger for 8 deferred TD rows.** The Phase 2 cold entries (F2.5–F2.10) ALREADY exist in `Vector_Scope.md` as scope rows but their `docs/c_tech_debt.md` rows do NOT exist yet — F2.4's AC says it creates them. Skipping F2.4 in favour of starting another F2 means the TD register stays out of sync with the scope.
- **`/tmp/report.json` is now PLA061's body** with both link-injection and benefit-score Change Log entries. **It was overwritten mid-session by a research report (RES058 — Rally portfolio-item hierarchy reorder) for a separate, unrelated session.** Do NOT assume `/tmp/report.json` reflects PLA061 anymore. To touch PLA061 again, GET it fresh from the backend:
  ```bash
  KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)
  curl -s -H "Authorization: Bearer $KEY" \
    "http://localhost:5100/_site/admin/dev/reporting/PLA061" > /tmp/PLA061.json
  ```
- **The SessionStart digest's "32 in flight" is wrong.** The real count is 20. The digest hook over-matches `🔵 IN FLIGHT` in lines under done parents. Don't quote the 32 figure to the user.
- **`<report> -p` plans land in `dev_reports` as `PLA###` (3-digit, no hyphen).** The legacy `dev/plans/PLA-NNNN.json` series is frozen at PLA-0055 and not extended. PLA061 follows the new convention.
- **Visualiser column-ordering issue** surfaced mid-session in a screenshot (EP-11890/EP-11914/US-17359/EP-11885/RSK-256 crossings). Diagnosis: barycenter/median sweep in the layered layout isn't running enough iterations, or the virtual `Orphaned` sink is dragging the calculation. **User said "that wasn't for you"** — do not pre-emptively investigate. Mentioned here only so the next agent recognises the topic if it returns.

---

## Pointers (read these, don't paraphrase)

- **PLA061 in `dev_reports`** — fetch via the curl above; on /dev/reporting → Plan tab.
- **`Vector_Scope.md`** — current source of truth, v2.55. F2 section + B16.14–B16.17 are the new entries.
- **`.claude/scope-refs.map`** — commit-message → scope-ref keyword index. 300 lines after Phase 2.
- **`docs/c_c_db_routing.md`** — service → pool → DB → tables map. Mandatory read before any `psql` per the hard rule.
- **`docs/c_c_transport_segregation.md`** — PLA-0039 transport split (relevant to B16.14/15 middleware placement).
- **`docs/c_c_perimeter_ratelimit_pick.md`** — does NOT exist yet. B16.14's AC creates it. The next agent should NOT pre-write it without doing the comparison work.
- **`/tmp/scope_outstanding_2.tsv`** — 258-line TSV dump of every non-done scope ref (section · ref · prio · flight · title). Survives across sessions only if /tmp does; regenerate from `Vector_Scope.md` if missing.

---

## Skills the next session is likely to want

- **`<scope> -r`** — read-and-discuss the outstanding board, surface things-that-look-done, surface unprioritised items.
- **`<scope> -a [message]`** — only if more stories need adding. Not expected for any PLA061 work since all 14 are scoped.
- **`<scope> -u`** — codebase-check pass to mark obviously-done items ✅. Worth running periodically; not urgent now.
- **`<report> -p`** — if a new plan is needed (e.g. for picking up B19 work-item-relations graph or B5 RBAC permissions-collapse, neither of which has a recent plan).
- **`<update> -c <name>`** — if the user wants to refresh a Dev → Components entry for a system that was touched (e.g. theme system after F2.3 lands).
- **`<verify>`** — if any of the PLA061 IN FLIGHT items actually start and finish, verify the AC click-paths before reporting done.

Do NOT invoke `<tdd>`, `<diagnose>`, `<migration>`, `<artefacts>`, `<chart>`, `<theme>`, or `<makeskill>` unless the user's next message directly maps to them.

---

## Conversation context worth preserving

- **User's stated 7th-axis addition.** Mid-session the user added `vercel/ai` to the research sweep with "adding agents is on our list". The Vercel AI SDK fit assessment landed as PLA061's F2.7 (deferred, trigger = first agent feature enters scope). The agent-roadmap framing is real, not aspirational — when an agent feature scopes, F2.7 triggers.
- **User's framing preference.** Per `context/USER.md` and confirmed mid-session, the user thinks in **systems / outcomes / UX**, not code mechanics. Frame recommendations as architectural/UX trade-offs first, implementation second. They have strong DoD discipline — never ship partial work.
- **Defence + finance buyer profile.** Confirmed 2026-05-18. Every security decision should reach for **compensating controls** rather than answering "out of scope". This is why B16.16 + B16.17 were promoted from deferred — procurement narrative trumps "no trigger yet". When in doubt, default to defence/finance bar.
- **`/report -r` confusion early in session.** User typed `<report> -r` when /tmp/report.json was already populated from a prior PLA060 work-item. Agent should have caught that the `-r` flag also needs `<url> "<topic>"` args. Eventually resolved by routing to `<report> -p` instead. Worth noting: the `-r` and `-p` flags of `<report>` aren't symmetric — `-r` requires URL+topic args, `-p` accepts optional focus phrase.
