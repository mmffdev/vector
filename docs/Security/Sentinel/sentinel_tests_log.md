# Sentinel — Tests Log (per-pass RED-GREEN record)

> **Purpose of this file:** Every test written under PLA062 records its RED state, every GREEN attempt, and the eventual GREEN. Audit trail for SOC2 procurement: "Show me the test, the failure, the fix, the proof."
> **Protocol:** [`sentinel_docs.md`](sentinel_docs.md) § Process.

---

## Per-test record schema

Every entry in this file follows this exact shape. Copy the template; don't improvise.

```markdown
### <test_name> (<story_id>)

**File.** `<absolute repo path>`
**Story.** [<story_id> in sentinel_backlog.md](sentinel_backlog.md#<anchor>)
**Tier.** `sentinel.unit` | `sentinel.page.<route>` | `sentinel.e2e`
**Assertions.** (what this test claims, in 1–3 sentences)

#### RED

**Date.** YYYY-MM-DD
**Run command.** `<exact CLI>`
**Output (verbatim).**

```
<paste verbatim, including stack traces, assertion messages, build errors>
```

**Cause.** (one sentence — why it's red: package doesn't exist / behaviour wrong / etc.)

#### GREEN attempts

| Attempt | Date | What changed | Output / verdict |
|---|---|---|---|
| 1 | YYYY-MM-DD | <one-line summary of the change> | <pass/fail + assertion that flipped> |
| 2 | … | … | … |

#### GREEN

**Date.** YYYY-MM-DD
**Run command.** `<exact CLI>`
**Output (verbatim).**

```
<paste verbatim — at minimum the PASS line and the assertion count>
```

**Attempts to green.** <integer>
**Commit.** <SHA short>
```

---

## Why verbatim

Procurement / SOC2 audit narrative depends on this file being **not** a paraphrase. "The test failed because of X" is a claim; the verbatim assertion message is evidence. We paste the actual `expected …, got …` lines, the actual stack trace, the actual `cannot find package "sentinel"` build error. The auditor reads what the test runner said.

## What does NOT go in this file

- Marketing language ("we caught it!").
- Summaries instead of verbatim output.
- Hidden failures — if a test was flaky or skipped, that gets its own entry with `tier = skip` and the reason.

---

## Tests

(none yet — first entry lands with S03)
