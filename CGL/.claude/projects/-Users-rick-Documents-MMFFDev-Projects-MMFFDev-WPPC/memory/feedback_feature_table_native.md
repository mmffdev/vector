---
name: Use FeatureTable native features, don't suppress them
description: When integrating FeatureTable into pages, use its built-in filterbar, search, buttonFilter, and column filters — don't hide them with hideFilterBar
type: feedback
originSessionId: 884d3afe-84ae-4bdd-9194-a2c15afea02f
---
When building page-specific tables, lean into FeatureTable's native features rather than building custom UI that duplicates them. Confirmed approach on LogsPage:

- Use `buttonFilter` prop for categorical toggles (severity, status) — matches Planning page style
- Use built-in search instead of custom search inputs
- Use `filterable: true` on columns for dropdown filters
- Keep page-level pre-filtering only for layout-specific controls (e.g. sidebar source navigation)
- The result is consistent UX across all pages and less custom CSS/state management

**Why:** User confirmed this produced the best UI/UX yet — consistency with the Planning page button style was key. Custom bespoke controls looked disconnected from the rest of the app.

**How to apply:** When adding tables to new pages, start with FeatureTable's full feature set enabled. Only suppress features if there's a genuine conflict, not as a default.
