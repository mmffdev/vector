# FE — Feature Scaffold

**Loaded on demand — read this file when the user writes `<FE>` followed by a description.**

When the user writes **`<FE>`** followed by a description, scaffold a new feature directory with standard files.

## File Structure

All frontend features follow this pattern:

```
web/src/features/<feature-name>/
  feature_<area>-<name>_index.ts      # barrel export
  feature_<area>-<name>.tsx            # main component
  feature_<area>-<name>_logic.ts       # business logic (optional)
  feature_<area>-<name>.css            # scoped styles
```

## Process

1. Prompt for **area** (e.g. `network`, `docker`, `build`) and **name** (e.g. `ping`, `grid`, `wizard`) if not clear from context
2. Create the directory and files following the pattern above
3. Feature CSS uses bare block naming (no `ui-` prefix) — the feature name IS the block

**Example**: `<FE> network ping tool` → `web/src/features/network-ping/feature_network-ping_index.ts` etc.

## CSS Naming Rule

Feature block names describe FUNCTION not LOCATION (e.g. `network-ping` not `feature-toolbar`). The feature name IS the block — no `ui-` prefix.

## Integration

- Import into `App.tsx`
- Update `<PA>` (Platform Architecture) if adding a new feature directory
- Follow all rules from `~/.claude/c_code-standards.md` for CSS naming, import ordering, and tables/grids
