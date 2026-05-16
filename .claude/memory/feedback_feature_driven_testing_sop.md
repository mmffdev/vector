---
name: feedback-feature-driven-testing-sop
description: Every story belongs to a feature group; every feature has exactly one feature_test suite registered in Tracker's regression library; red-green ordering is enforced by the /stories skill. Tests live at the feature level, not the story level.
metadata:
  type: feedback
---

**Tests live at the feature level, not the story level. Tracker is the long-term regression library; every test written today is a permanent re-run gate against all future code.**

**Why:** Rick named this 2026-05-16 after PLA-0053/0054/0055 were drafted with hand-rolled "RED-GREEN PROTOCOL" + "TRACKER REGRESSION LIBRARY" blocks copy-pasted into every plan's `implementation_plan` and per-story `**Feature membership:**` markers in every description. Two principles emerged:

1. **Per-story tests are plumbing noise.** Twenty-three green unit tests against twenty-three story implementations does not prove the feature works. One end-to-end feature-test suite asserting the slice as a whole is the meaningful unit of coverage. The 23 unit tests are bloat in the long-term regression library.
2. **Tracker is the permanent regression library.** Every test ever written is a re-run gate against every future plan's pre-merge run. The library is the long-term asset; individual PR test runs are transient.

The first principle drove the new `feature_test` work-item kind. The second drove the `tracker_group` plan field and the regression-lock AC on every feature_test.

**How to apply:**

- All test work flows through `/stories` (per [[feedback_stories_shortcut_mandatory]]). The skill (`.claude/skills/stories/SKILL.md`) now enforces, at gates 1.b, 3, 5, 6.5.d, and 6.6:
  - Every implementation story carries `FEAT-N` tag pointing to an approved feature.
  - Every feature group has exactly one `feature_test` work item.
  - Feature_test stories carry `kind`, `feature_id`, `feature_name`, `covers`, `tracker_group` as schema fields.
  - The feature_test's red commit ships before any covered implementation story.
  - Every plan declares a top-level `tracker_group` (kebab `<scope>-<plan-slug>`).
- Single-story features are legitimate — when a story is its own observable slice (a docs page, a standalone migration with no service consumer yet), the feature group is 1 story and the feature_test is calibrated to what is actually observable (a migration smoke check, a build-render check).
- A feature_test that cannot be paired with at least one implementation story in the same `/stories` invocation is rejected at Step 6.6 — feature tests cannot be authored in isolation.
- Long-lived red commits (red landed, implementation never followed) must carry a TD-RED-<story_id> entry (S2) with trigger "close when feature ships OR delete suite on date X if descoped". Orphan red runs pollute the regression library.

**Open verification (TD-RG-RUNNER-DOCS):** the exact `cmd/rg-runner` flag syntax lives in the sibling `MMFFDev - Tracker` repo and was not verifiable from this repo when the SOP shipped. Confirm against `cmd/rg-runner --help` before the first feature_test commit and patch SKILL.md §5.d with the verified command.

**Related:**
- [[feedback_red_green_always]] — red-green-refactor is non-negotiable; this SOP encodes the discipline at the feature level.
- [[feedback_stories_all_layers]] — decompose across backend/frontend/migration/tests BEFORE invoking `/stories`; complementary (spread rule + clustering rule).
- [[feedback_stories_system]] — 7-gate acceptance system; FEAT-N is the 9th mandatory attribute.
- [[feedback_stories_shortcut_mandatory]] — every story routes through `/stories`; that is the enforcement point for this SOP.
- [[project_tracker_rg_api_key]] — `RG_API_KEY=trk_xxx` for runner auth; project-clamped to Vector.
- [[user_stakeholder_foundation_mode]] — "do it right" over "ship today"; the SOP exists because Rick chose foundation over patch.
- Design document: [`dev/research/R055_red_green_feature_sop.json`](../../dev/research/R055_red_green_feature_sop.json).
