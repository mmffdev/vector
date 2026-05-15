# `<r>` — Retro Perspective Protocol

Full protocol for the retro skill. The skill entrypoint at `.claude/skills/retro/SKILL.md` references this file.

> **Standing rule (hard):** every write path in this skill goes through the **sync function** below. Step 8 (self-check + rollback) is non-optional. A retro that "succeeded" but failed self-check is a defect — roll it back and report failure.

---

## Inputs

- **Trigger** — `user` (default) or `loop-detector` (auto, when `/tmp/.claude-retro-loop-trigger` exists).
- **Scope** — `segment` (default; from last "go"/"start"/approval message) or `full` (entire jsonl).
- **Note** — optional one-liner from the user passed via `--note "..."`.

## Pre-flight

1. Read `docs/c_retro_index.md` (Last issued).
2. Scan `dev/retros/RETRO-*.json` for highest existing N.
3. `RETRO_ID = "RETRO-" + str(max(file, scan) + 1).zfill(3)`.
4. Read `dev/retros/LEDGER.json` (or seed `{ "version": 1, "entries": [] }` if absent).
5. Snapshot byte-length of `docs/c_tech_debt.md` and `docs/c_retro_index.md` for rollback.

---

## Gate 1 — Collect signals

From the current session jsonl (path: `~/.claude/projects/<slug>/<session-id>.jsonl`):

- Count tool uses by name in the segment.
- Count error tool results (any `is_error: true` or stderr-like content).
- Count files **read** vs **written**; identify files re-read more than 2× (a strong signal of confusion).
- Identify retries: same tool + same file/url within 2 minutes.
- Wallclock minutes from first user message of segment to now.
- Tool call count.
- Linked plan: scan recent context for `PLA-NNNN`.

Persist these as `signals` in the retro JSON (schema below).

## Gate 2 — Cluster into findings

Group raw signals into discrete findings. **One finding = one observable issue or win.** Examples:

- Multiple `Bash` retries hitting the same exit-1 → ONE finding (not five).
- Three different error classes → THREE findings.
- Significant unblock that took <5 min → Table 2 win.

Hard rule: at least **one** Table 1 finding AND at least **one** Table 2 win per retro. If everything was painful, find the single most-painless thing. If everything went perfectly, find the single biggest opportunity to do even better.

## Gate 3 — 5 Whys + reversal (Table 1 only)

For each Table 1 finding:

```
WHY-1: <root observation>
   ↓ because
WHY-2: <one level deeper>
   ↓ because
WHY-3: ...
   ↓ because
WHY-4: ...
   ↓ because
WHY-5: <root cause>

REVERSAL CHAIN:
   Given WHY-5 → WHY-4 is inevitable because <chain>
   Given WHY-4 → WHY-3 is inevitable because <chain>
   Given WHY-3 → WHY-2 is inevitable because <chain>
   Given WHY-2 → WHY-1 is inevitable because <chain>
```

**Reversal validation rule:** every reversal step must use a concrete causal verb (`forces`, `requires`, `produces`, `blocks`, `prevents from observing`). Words that signal hand-waving and FAIL the reversal: `correlates with`, `is associated with`, `often leads to`, `tends to`. If a reversal fails, mark `chain_broken_at: WHY-N` in the JSON and cap severity at 3.

### Fingerprint (used by Gate 5)

After scoring, compute the fingerprint for ledger lookup:

```
fingerprint = "<error_class>:<file_or_endpoint>:<symptom_hash>"
```

- `error_class` — one of: `stale-binary`, `port-collision`, `route-shadow`, `null-deref`, `auth-fail`, `migration-drift`, `prompt-misread`, `tool-loop`, `doc-drift`, `css-bespoke`, `mock-pollution`, `other:<slug>`.
- `file_or_endpoint` — the most-touched file, route, or service surface in the finding (relative path or `:port/path`).
- `symptom_hash` — first 8 hex chars of `sha256(canonical_symptom_string)`. Canonical symptom: lowercased, whitespace-collapsed, error message OR human description if no error.

## Gate 4 — Heatmap scoring

**HARD RULE — dev-ui catalog only.** The Retros tab is a Dev Setup page, so [`DevRetrosPanel.tsx`](../../dev/pages/DevRetrosPanel.tsx) renders the heatmap from `severity` integers (1–5) using `.dui-pill--h1` … `.dui-pill--h5` (Table 1) and `.dui-pill--w1` … `.dui-pill--w5` (Table 2) — defined in [`dev/styles/dev-ui.css`](../../dev/styles/dev-ui.css). The retro JSON output stores **only the integer**; the panel owns class translation. Do not bake class strings into the JSON. See [`docs/c_c_dev_ui_primitives.md`](../../docs/c_c_dev_ui_primitives.md).

**Table 1 (Root Cause):** linear 1–5

| Score | Pill (rendered) | Meaning |
|---|---|---|
| 5 | `.dui-pill--h5` | Recurrent, blocking, or safety-critical. This will keep biting us. |
| 4 | `.dui-pill--h4` | Significant friction; cost ≥30 min. |
| 3 | `.dui-pill--h3` | Notable; cost 10–30 min. |
| 2 | `.dui-pill--h2` | Minor; cost <10 min. |
| 1 | `.dui-pill--h1` | Barely worth noting; logged for trend tracking. |

If `chain_broken_at` is set, severity is capped at 3 regardless of impact.

**Table 2 (What Went Well):** linear 1–5, all green-shaded

| Score | Pill (rendered) | Meaning |
|---|---|---|
| 5 | `.dui-pill--w5` | Amazing — repeat exactly this. |
| 4 | `.dui-pill--w4` | Strong — keep doing this. |
| 3 | `.dui-pill--w3` | Good — solid baseline. |
| 2 | `.dui-pill--w2` | Okay — small win. |
| 1 | `.dui-pill--w1` | Tiny — barely a win, logged for shape. |

## Gate 5 — Ledger sync

Read `dev/retros/LEDGER.json`. For each Table 1 finding:

1. Compute fingerprint per Gate 3.
2. If exact fingerprint exists in `entries[]`:
   - `hit_count += 1`
   - Append `{ retro_id, severity, prompt_excerpt, chain_of_events, hit_at }` to that entry's `hits[]`.
   - Update `last_seen = today`.
   - Recompute `severity_trend` = last 3 severities, formatted `"3→4→4"`.
   - If `hit_count >= 3` AND `status != "resolved"` AND no entry with this fingerprint already exists in `docs/c_tech_debt.md`'s S1 section: append S1 entry referencing `RETRO-NNN` and the ledger entry id.
3. If fingerprint is new:
   - Append new entry: `{ id: "LDG-NNN" (zero-padded), fingerprint, area, hit_count: 1, first_seen, last_seen, severity_trend, status: "open", hits: [...] }`.

Ledger entry shape:

```json
{
  "id": "LDG-001",
  "fingerprint": "stale-binary:tmp/vector-backend:a3f2b1c0",
  "area_of_concern": "Launcher backend stale binary",
  "hit_count": 3,
  "first_seen": "2026-04-30",
  "last_seen": "2026-05-05",
  "severity_trend": "4→5→5",
  "status": "open",
  "resolved_by": null,
  "hits": [
    {
      "retro_id": "RETRO-001",
      "severity": 4,
      "prompt_excerpt": "first 160 chars of the user prompt that surfaced the issue",
      "chain_of_events": "build → exec → in-memory cache → /tmp overwrite ignored",
      "hit_at": "2026-04-30T15:22:10Z"
    }
  ]
}
```

## Gate 6 — Auto-actions (no gate)

Per user directive 2026-05-04: auto-actions execute immediately on retro completion. No approval prompt. Quotas:

- **Tech-debt appends** — to `docs/c_tech_debt.md`. Idempotent on `RETRO-NNN` reference. S1 promotion when ledger hit_count ≥ 3 unresolved. S2 cap when severity = 4 and not yet recurring.
- **CLAUDE.md proposals** — write to `dev/retros/RETRO-NNN.proposed-claudemd.md` ONLY. Never edit CLAUDE.md directly. The proposed file shows the exact diff the user can apply.

## Gate 7 — Persist retro JSON

Schema for `dev/retros/RETRO-NNN.json`:

```json
{
  "id": "RETRO-NNN",
  "title": "<one-line summary>",
  "date": "2026-05-05",
  "triggered_by": "user|loop-detector",
  "scope": "segment|full",
  "session_jsonl": "/Users/rick/.claude/projects/<slug>/<sid>.jsonl",
  "linked_plan": "PLA-NNNN",
  "signals": {
    "wallclock_minutes": 47,
    "tool_call_count": 132,
    "error_count": 9,
    "files_read": 41,
    "files_re_read": 6,
    "files_written": 8,
    "tool_repeats_max": 4,
    "loop_signals": null
  },
  "honest_assessment": "<HTML body — 1–3 short paragraphs, plain language, no excuses>",
  "table_1_root_causes": [
    {
      "order": 1,
      "ref": "RETRO-NNN/01",
      "category": "Process|Tooling|Knowledge|Env",
      "issue": "one-line",
      "whys": [
        { "depth": 1, "statement": "..." },
        { "depth": 2, "statement": "..." },
        { "depth": 3, "statement": "..." },
        { "depth": 4, "statement": "..." },
        { "depth": 5, "statement": "..." }
      ],
      "reversal": [
        { "from": 5, "to": 4, "verb": "forces", "chain": "..." },
        { "from": 4, "to": 3, "verb": "produces", "chain": "..." },
        { "from": 3, "to": 2, "verb": "...", "chain": "..." },
        { "from": 2, "to": 1, "verb": "...", "chain": "..." }
      ],
      "chain_broken_at": null,
      "resolution_steps": ["1. ...", "2. ..."],
      "severity": 4,
      "confidence": 0.92,
      "fingerprint": "stale-binary:tmp/vector-backend:a3f2b1c0",
      "ledger_entry_id": "LDG-001",
      "tech_debt_ref": "S1#23"
    }
  ],
  "table_2_what_went_well": [
    {
      "order": 1,
      "ref": "RETRO-NNN/W01",
      "category": "Process|Tooling|Knowledge|Env",
      "win": "one-line",
      "why_it_worked": "...",
      "score": 5
    }
  ],
  "loop_signals": null,
  "claudemd_proposals_path": "dev/retros/RETRO-NNN.proposed-claudemd.md"
}
```

## Sync function (single write path) — Gate 8 (self-check + rollback)

Every retro write goes through this function. **Do not bypass.**

```
def sync_retro(retro_doc):
    # 1. Snapshot pre-state for rollback
    snap = {
        "ledger":     read_or_none("dev/retros/LEDGER.json"),
        "tech_debt":  read_or_none("docs/c_tech_debt.md"),
        "index":      read_or_none("docs/c_retro_index.md"),
        "claudemd":   None,  # we never write CLAUDE.md
    }

    try:
        # 2. Write retro JSON
        write_json(f"dev/retros/{retro_doc.id}.json", retro_doc)

        # 3. Update ledger (per Gate 5)
        update_ledger(retro_doc)

        # 4. Append tech debt (per Gate 6) — idempotent on RETRO-NNN ref
        append_tech_debt_if_warranted(retro_doc)

        # 5. Bump index
        bump_retro_index(retro_doc.id)

        # 6. Write CLAUDE.md proposals (NEVER edit CLAUDE.md)
        if retro_doc.claudemd_proposals:
            write(f"dev/retros/{retro_doc.id}.proposed-claudemd.md", retro_doc.claudemd_proposals)

        # 7. SELF-CHECK — re-read every touched file and verify
        self_check(retro_doc)

    except SelfCheckFailure as e:
        # Rollback in reverse order
        rollback_to(snap)
        raise

def self_check(retro_doc):
    failures = []

    # 7a. Retro JSON parses and id matches
    parsed = read_json(f"dev/retros/{retro_doc.id}.json")
    if parsed.get("id") != retro_doc.id: failures.append("id mismatch")

    # 7b. Every ledger entry referenced in JSON contains back-reference to RETRO-NNN
    ledger = read_json("dev/retros/LEDGER.json")
    for f in retro_doc.table_1_root_causes:
        if f.ledger_entry_id:
            entry = next((e for e in ledger["entries"] if e["id"] == f.ledger_entry_id), None)
            if not entry: failures.append(f"ledger {f.ledger_entry_id} missing")
            elif retro_doc.id not in [h["retro_id"] for h in entry["hits"]]:
                failures.append(f"ledger {f.ledger_entry_id} missing back-ref to {retro_doc.id}")

    # 7c. tech_debt appends reference RETRO-NNN
    debt = read("docs/c_tech_debt.md")
    for f in retro_doc.table_1_root_causes:
        if f.tech_debt_ref and retro_doc.id not in debt:
            failures.append(f"tech debt missing {retro_doc.id} ref")

    # 7d. Index counter bumped
    idx = read("docs/c_retro_index.md")
    if retro_doc.id not in idx: failures.append("index not bumped")

    if failures:
        raise SelfCheckFailure(failures)
```

**On failure:** print every failure line to chat, restore each snapshot, delete the retro JSON, and tell the user "Retro `RETRO-NNN` failed self-check; rolled back. Reasons: ..." Do NOT clear the loop sentinel.

**On success (loop-detector trigger only):** delete `/tmp/.claude-retro-loop-trigger` so the next session starts clean.

---

## Loop-detector contract (used by hook)

The hook writes a JSON sidecar at `/tmp/.claude-retro-loop-state.json` (rolling window) and a sentinel at `/tmp/.claude-retro-loop-trigger` when ALL signals fire. The retro reads the sidecar to populate `loop_signals` in the JSON. Sidecar shape:

```json
{
  "window_started": "2026-05-05T15:00:00Z",
  "tool_repeats": { "Bash": 6, "Read": 2 },
  "files_read_unique": 3,
  "user_messages_in_window": 0,
  "consecutive_same_error_class": 4,
  "edit_or_write_success_in_window": false,
  "triggered_at": "2026-05-05T15:09:18Z"
}
```

Five signals all true within 10-min window → trigger fires:

1. `max(tool_repeats.values()) >= 4`
2. `files_read_unique == 0` (no NEW files read in window — re-reads don't count)
3. `user_messages_in_window == 0`
4. `consecutive_same_error_class >= 3`
5. `edit_or_write_success_in_window == false`

When triggered: hook writes sentinel, UserPromptSubmit hook injects a `<system-reminder>` on next turn telling agent to invoke `<r> --auto-loop`. The agent's hard-rule clause in CLAUDE.md says: **on LOOP DETECTED reminder, you MUST run `<r> --auto-loop` before any further tool use except Read.**

---

## Index file shape (`docs/c_retro_index.md`)

```
# Retro index

**Last issued:** `RETRO-NNN`

**Counter rule:** zero-padded 3 digits; allocate by `max(file, scan) + 1`.

## Registry

| ID | Title | Date | Trigger | Severity max |
|---|---|---|---|---|
| `RETRO-001` | ... | 2026-05-05 | user | 5 |

## Deletion log

(intentionally append-only)
```

---

## Cross-references

- Skill entrypoint: [`.claude/skills/retro/SKILL.md`](../skills/retro/SKILL.md)
- Loop detector hook: [`.claude/hooks/loop-detector.sh`](../hooks/loop-detector.sh)
- Loop injector hook: [`.claude/hooks/loop-injector.sh`](../hooks/loop-injector.sh)
- Tech-debt register: [`docs/c_tech_debt.md`](../../docs/c_tech_debt.md)
- Dev panel: [`dev/pages/DevRetrosPanel.tsx`](../../dev/pages/DevRetrosPanel.tsx)
- API: [`app/api/dev/retros/route.ts`](../../app/api/dev/retros/route.ts)
