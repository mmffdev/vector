---
name: Use FeatureTable and its CSS for all tables
description: When building any table UI, use the feature_table component and feature_table.css classes — never create bespoke table/filter styles
type: feedback
originSessionId: 1714cc1e-104e-445b-ac26-da30bbda934f
---
Always use FeatureTable (`features/tables/feature_table_index`) and `feature_table.css` classes when building tables. For filter bars and toggle buttons, use the global `ui-filterbar` classes from `global.css` — never create one-off button/filter styles in feature CSS.

**Why:** User caught bespoke `log-viewer__level-btn` classes duplicating what `ui-filterbar__pagesize` + `btn btn-ghost btn-sm` already provide. Tables and their chrome should be standardised through the shared feature.

**How to apply:** Before writing any table markup, import `FeatureTable` and define columns via the `Column<T>[]` interface. For any filter/toggle buttons adjacent to tables, use `ui-filterbar__options` + `btn btn-ghost btn-sm ui-filterbar__pagesize` pattern. Only add feature-scoped CSS for genuinely unique visual elements (e.g. colour-coded log lines).
