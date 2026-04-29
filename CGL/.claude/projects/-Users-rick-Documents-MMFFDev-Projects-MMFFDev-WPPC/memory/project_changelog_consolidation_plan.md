---
name: <plan> Changelog consolidation
description: Pending plan to consolidate changelog writes — remove from mstories, keep only sprint-close Phase 2.5 + manual <changelog>
type: project
originSessionId: bd7f0e8b-6ef2-40b1-90a8-f58c319cd912
---
**What:** Remove changelog POST from `<mstories>` step 6. The only automated changelog generation becomes sprint-close Phase 2.5. Manual `<changelog>` command stays for ad-hoc entries.

**Why:** Two automated writers (mstories + sprint-close) causes duplication and confusion. Sprint-close Phase 2.5 is already idempotent — it checks for existing entries before generating. Single point of automated generation is cleaner.

**Files to edit:**

1. `~/.claude/CLAUDE.md` — remove mstories step 6 (lines ~98–107): delete the entire "After insertion, for each story that represents a user-visible feature change, POST a changelog entry" block and its sub-bullets (type, feature, description, report ref_ids).

2. `.claude/CLAUDE.md` — same removal, same lines.

3. `.claude/commands/sprint-close.md` — enhance Phase 2.5 (lines ~111–125):
   - For each delivered story, derive `type` (added/removed/updated) from story context — not just default to `added`
   - Use the story's `user_story` text to generate a meaningful `description`
   - Present generated entries in a table for user review BEFORE posting (same as mstories review pattern)
   - Report all generated `ref_id` values

**Verification:**
1. Read both CLAUDE.md files → mstories has no step 6, no changelog POST
2. Read sprint-close.md → Phase 2.5 has review step, type inference, description generation
3. Run `<mstories>` in future session → no changelog entries created
4. Run `<stopsprint>` → changelog entries generated for all delivered items missing coverage

**Status:** Blocked by Data Service initiative (DS-01–DS-12) which may restructure the changelog flow further.
