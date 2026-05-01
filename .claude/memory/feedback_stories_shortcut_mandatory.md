---
name: All stories MUST go through the /stories shortcut
description: Every story created — without exception — must be created via the /stories skill (7-gate system). No direct Planka card creation, no informal "just add a card", no shortcuts around the gates.
type: feedback
originSessionId: a5f9602b-0644-4cea-999f-b70468753594
---
Every story that ever gets made MUST go through the `/stories` (a.k.a. `<stories>`) shortcut. No exceptions.

**Why:** The `/stories` skill is the only path that runs the 7-gate acceptance system, allocates the next ID from `docs/c_story_index.md`, attaches the mandatory label set (AIGEN + phase + feature + EST + RISK), enforces the 85% confidence thresholds, and auto-splits F21+ work. Bypassing it produces under-labelled cards, breaks the global story counter, skips estimation/risk discipline, and leaves cards the librarian and reporting skills can't reason about.

**How to apply:**
- When the user describes work that needs tracking, route it through `/stories` even if it feels small ("just one card", "quick fix", "trivial"). Card size is decided by F0–F1, not by skipping the skill.
- Never use `mcp__planka__create_card` directly to create a story. The only direct Planka writes allowed are lifecycle moves on existing cards (Backlog → To Do → Doing → Completed) and label retries within the `/stories` flow itself.
- Decompose across all layers (backend, frontend, migration, tests) BEFORE invoking `/stories` — a feature is not complete until every observable layer has a card.
- If you catch yourself about to write a card without `/stories`, stop and run `/stories` instead.
