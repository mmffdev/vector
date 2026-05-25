# ObjectTreeV2 bulk-create is timeboxes-only

ObjectTreeV2 bulk-create (the `{ kind: "bulk" }` variant of `CreateActionConfig`) is **scoped to timeboxes only** — sprints + releases. Never propose bulk-create for work-items, portfolio-items, risks, or any future ObjectTreeV2 consumer. Single-item create via the inline flyout is the universal pattern; the bulk-create sheet exists solely because timebox sequences have cadence/date-cascade semantics nothing else shares.

**Why:** confirmed 2026-05-21 during slice 6 design fork — Rick called bulk-create "a main feature" for timeboxes, but flagged it as scoped to that domain so the `CreateActionConfig` `bulk` variant doesn't bleed into other kinds.

**How to apply:** when extending V2 to a new domain, the default is `{ kind: "single" }` or `{ kind: "type_picker" }`. Only timebox configs (`p_wizard_sprints.json`, `p_wizard_releases.json`) declare `{ kind: "bulk" }`.
