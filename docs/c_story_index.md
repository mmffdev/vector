# Story ID index

Last issued: **00030**

Single global counter for story cards. Storify, backlog-cmd, and any agent creating cards on the Planka board must:

1. Read this number.
2. Cross-check by scanning Planka card titles for the highest `NNNNN —` prefix; use whichever is higher.
3. Allocate sequential IDs from `last_issued + 1`.
4. Update this file with the new high-water mark immediately after card creation.

**IDs never reused, even after deletion.** Gaps are evidence a card was killed and should remain visible.

## Card title format

`NNNNN — <Story title>` (5-digit zero-padded, em dash separator, then the story name).

Example: `00021 — Frontend: full-screen adoption overlay`.

## Labels every card must carry

- **`PH-NNNN`** — phase label (e.g. `PH-0004`). One per phase.
- **`FE-SECNNNN`** — feature label from `c_feature_labels.md`. One per feature.
- **`storify`** (or `backlog-cmd` / `manual`) — creation source.
- **`MULTI AGENT`** (berry-red) — only when story qualifies for parallel dispatch (see `c_c_backlog_agent.md`).

## Deletion log

| ID | Title | Reason |
|---|---|---|
| 00016 | Wizard padmin fallback | Obsolete after role flip — padmin is the adopter, not waiting on gadmin. |
