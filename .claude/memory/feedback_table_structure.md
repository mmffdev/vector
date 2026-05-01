---
name: Canonical table HTML structure
description: Every table must use thead/tbody/table__head/table__row/table__cell — never table__head on a tr inside tbody
type: feedback
originSessionId: 1cc1402b-cf28-4e3f-abce-e87c7cd19978
---
Always use this exact HTML pattern for every table in the app:

```jsx
<div className="table-wrap">
  <table className="table" aria-label="…">
    <colgroup>…</colgroup>
    <thead className="table__head">
      <tr>
        <th className="table__cell">Column</th>
      </tr>
    </thead>
    <tbody>
      <tr className="table__row">
        <td className="table__cell">Value</td>
      </tr>
    </tbody>
  </table>
</div>
```

**Why:** Different tables were built with different markup (e.g. `<tr className="table__head">` inside `<tbody>`), causing visual inconsistency across the app. LayersTable was the offender — fixed by introducing `.layers-editor__zone-head` for in-body zone headers.

**How to apply:** `table__head` on `<thead>` only. In-body section headers (zone separators etc.) get a component-scoped class, never a reuse of `table__head`. Full canonical pattern documented in `docs/css-guide.md` Tables section.
