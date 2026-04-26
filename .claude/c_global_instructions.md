# Global Claude Instructions

Principles and governance rules that apply to all work in this project.

## Documentation Principles

When editing or creating documentation within this structure:

1. **Keep files as lean as possible.** Remove redundancy. Every line must justify its existence.
2. **Use lazy loading techniques always.** Content should be split across child files that are loaded only when needed.

## Documentation Naming Convention

Child files follow a depth-indicating pattern using `c_` prefixes:

| Depth | Pattern | Example |
|---|---|---|
| Level 1 | `c_xxx.md` | `c_security.md` |
| Level 2 | `c_c_xxx.md` | `c_c_authentication.md` |
| Level 3 | `c_c_c_xxx.md` | `c_c_c_saml_config.md` |
| Level 4+ | Additional `c_` per depth | `c_c_c_c_xxx.md` |

**Rule:** Each additional `c_` indicates one level deeper in the documentation tree.

## Model Selection Governance

Recommend a model switch ONLY when ≥80% confident the current model is mismatched to the task ahead. Otherwise stay silent. When triggered: STOP before doing any work, send one message naming the tier and the reason, wait for the user's call.

**Tiers:**

1. **Opus** — architecture decisions, cross-file refactors, debugging non-obvious bugs, security review, schema/migration design, anything requiring synthesis across the codebase or careful reasoning about correctness.
2. **Sonnet** — feature implementation, single-file refactors, writing/updating tests, code review, documentation drafting, well-scoped tasks with a clear path.
3. **Haiku** — lookups, status checks, file reads, trivial edits, formatting, mechanical renames, single-line fixes, anything where the answer is obvious once you see the code.

**Trigger examples (fire):**
- On Opus, user asks to read a file or check service status → suggest Haiku.
- On Haiku, user asks to design a migration or debug a flaky test → suggest Opus.
- On Sonnet, user opens with "rearchitect the auth layer" → suggest Opus.

**Do NOT fire:**
- Mid-task (only at the start, before work begins).
- When the task could plausibly fit the current tier.
- For preference reasons — only on capability/cost mismatch.
- More than once per conversation unless the task fundamentally changes.

**Format when triggered:**
> "This looks like <tier> work (reason: <one phrase>). Currently on <current model>. Switch before I start?"

## Quick Reference (Special Commands)

- **<NCY>** = do not write code
- **<showbranches>** = show git branches
- **<mycopyright>** = get copyright year/owner
- **/help** = get Claude Code help
