# c_research-paper-format — Research Paper TSX Format (Shared)

**Loaded on demand — read this file when `c_write-research-paper.md` or `c_update-research-paper.md` needs the canonical TSX shape.**

This file owns the **template, meta shape, and version-badge JSX** for all research papers. Both the CREATE flow (`c_write-research-paper.md`) and the UPDATE flow (`c_update-research-paper.md`) reference this file so the rules stay in one place.

---

## Meta shape

Every paper must export `meta` with exactly these fields:

```ts
export const meta = {
  id: 'RXXX',                        // R001, R002, ... (zero-padded, 3 digits)
  title: 'TITLE',                    // human-readable
  category: 'CATEGORY',              // e.g. 'DevOps', 'Security', 'Research'
  date: 'YYYY-MM-DD HH:MM',          // creation timestamp, never changes
  version: 'v1.0.0',                 // semver; starts at v1.0.0 on create
  revised: null,                     // null until first update; then 'YYYY-MM-DD HH:MM'
};
```

- `date` is stamped **once** at creation time (`date "+%Y-%m-%d %H:%M"`).
- `version` starts at `v1.0.0` and is bumped by `c_update-research-paper.md`.
- `revised` stays `null` until the first `<updatepaper>` call, then mirrors the update timestamp.

## Version badge JSX

Every paper must render the version top-right of the h1. Wrap the existing h1 in a flex container with the version span:

```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
  <h1 className="ui-page-heading prefix-dev">RXXX — TITLE</h1>
  <span className="prefix-dev" style={{ fontSize: '0.85rem', opacity: 0.75 }}>{meta.version}</span>
</div>
```

`{meta.version}` must reference the exported meta so bumps flow through automatically.

## H2 rule

All `<h2>` tags inside a research paper use `style={h2Style}`:

```tsx
const h2Style: React.CSSProperties = { color: 'var(--color-primary)' };
```

## Full skeleton (CREATE)

```tsx
import React from 'react';
import { FeatureTable, type Column } from '../../features/tables/feature_table_index';

export const meta = {
  id: 'RXXX',
  title: 'TITLE',
  category: 'CATEGORY',
  date: 'YYYY-MM-DD HH:MM',
  version: 'v1.0.0',
  revised: null,
};

const h2Style: React.CSSProperties = { color: 'var(--color-primary)' };

interface ActionPlanRow {
  id: string;
  story: string;
  estimate: number;
  category: string;
  status: string;
}

const actionPlanData: ActionPlanRow[] = [
  // Populated by c_addpaper-stories.md after user accepts stories
];

const actionPlanCols: Column<ActionPlanRow>[] = [
  { key: 'id', label: 'ID', width: '1%', render: (v) => <code>{String(v)}</code> },
  { key: 'story', label: 'Proposed Story' },
  { key: 'estimate', label: 'Pts', width: '1%' },
  { key: 'category', label: 'Category', width: '1%' },
  { key: 'status', label: 'Status', width: '1%' },
];

const ResearchRXXX: React.FC = () => (
  <>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <h1 className="ui-page-heading prefix-dev">RXXX — TITLE</h1>
      <span className="prefix-dev" style={{ fontSize: '0.85rem', opacity: 0.75 }}>{meta.version}</span>
    </div>

    <h2 style={h2Style}>1. Executive Summary</h2>
    <p>
      COMPILED_CONTENT_SUMMARY_HERE — 3–5 sentence synthesis of the research problem and key findings.
    </p>
    <hr />

    <h2 style={h2Style}>2. Action Plan</h2>
    {actionPlanData.length === 0 ? (
      <p>No action items — pure intelligence gathering.</p>
    ) : (
      <FeatureTable columns={actionPlanCols} data={actionPlanData} hideFilterBar initialPageSize={0} itemLabel="stories" />
    )}
    <hr />

    <h2 style={h2Style}>3. Detailed Findings</h2>
    <p>
      COMPILED_CONTENT_HERE
    </p>

    <p className="doc-subtitle">Research compiled YYYY-MM-DD HH:MM — CATEGORY research document</p>
  </>
);

export default ResearchRXXX;
```

## Rules

- Keep `actionPlanData` as an empty array on create (unless stories were accepted in-flow).
- Export **both** `meta` and the default component.
- Use `FeatureTable` with the exact column set shown — no modifications.
- The flex wrapper around the h1 is mandatory so the version badge displays top-right.
- The file is the source of truth — the frontend reads meta via `import.meta.glob` from `web/src/components-dev/research/ResearchR*.tsx`.
