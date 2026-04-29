---
name: Sanity-check ACs that name an output format against each listed target
description: When writing user stories, verify each target entity actually supports the output format the AC assumes — catches bundled ambiguity before implementation
type: feedback
originSessionId: 2ae83362-dabc-4472-8a8f-7b89c9458d58
---
When an acceptance criterion names an output format (e.g. "migration adds columns", "POST endpoint accepts field X", "DB row stamps creator_id") and then lists targets, walk each target and check it actually has the thing the AC assumes.

**Why:** USR-02 bundled DB-backed (sprints, backlog_items, changelog_entries) and code-defined entities (audits, research papers — TSX files with meta exports) under one "migration adds the three nullable columns to each target table" rubric. Audits have no table; the AC couldn't apply. The ambiguity only surfaced during implementation, forcing a mid-flight scope split (USR-11). A 30-second sanity pass at story-writing time would have caught it.

**How to apply:** When drafting or reviewing an AC with a format-specific clause + a target list, run the format through each target before committing the story. If one target doesn't fit the format, either narrow the story's target list or acknowledge the format mismatch explicitly in the AC (e.g. "columns for DB-backed entities; meta-export fields for code-defined entities"). Better to split or rephrase upfront than discover it during build.
