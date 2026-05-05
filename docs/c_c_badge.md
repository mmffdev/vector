# Badge primitive

`<Badge>` ([app/components/Badge.tsx](../app/components/Badge.tsx)) is the React surface for the design system's `.pill` class family ([app/globals.css](../app/globals.css), Vector Design System story 00076). One component, one CSS rule, one prop schema — used wherever a small inline status indicator, counter bubble, or letter tag is rendered.

## Why it exists

Before this, the site had at least seven bespoke `*-badge` classes: `users-table__status-badge`, `app-header-wrapper__badge`, `bell-badge`, `tree_accordion-dense__type-badge`, `nav-prefs__core-badge`, `theme-lib__active-badge`, plus the stateful `env-badge` widget. Each invented its own colour rules and drifted from the design tokens. `<Badge>` collapses the presentational ones into the canonical `.pill` family.

## Kinds

| Kind | Shape | When to use |
|---|---|---|
| `status` | `.pill` (inline) | Active/Inactive/Pending — derives tone from `state` via `STATUS_TONES`. |
| `count` | `.pill .pill--count` (round 18px counter) | Notification badges — header bell, unread counts. Renders `null` when `value <= 0`. |
| `letter` | `.pill .pill--letter` (22×22 mono square) | One- or two-letter codes — env letters, work-item-type tags. |
| `tag` | `.pill` (inline, label-only) | Free-form short labels — "Core", theme name. |

## Tones

Semantic-only (`success | warning | danger | info | neutral | brand`). Resolves to `var(--success-bg)` etc. **No hex, no inline `style` for colour, no user-supplied colour values.** Custom apps will pick from a vetted palette later — see plan §5 in the API launch story.

## Props

```ts
type BadgeProps = {
  kind: "status" | "count" | "letter" | "tag";
  tone?: BadgeTone;          // explicit override; otherwise derived
  state?: string;            // status kind: "active", "inactive", …
  label?: string;            // explicit override; otherwise derived
  value?: number;            // count kind only
  domain?: string;           // letter kind: "work-item-type" | "env" | …
  domainValue?: string;      // value within that domain
  iconRef?: string;          // reserved for API launch — registered icon name
  icon?: ReactNode;          // platform-side raw SVG (not exposed to API)
  title?: string;
  href?: string;             // turns the badge into a <Link>
  onClick?: () => void;      // turns the badge into a <button>
  size?: "sm" | "md";        // default sm
};
```

## Tone resolution

1. Explicit `tone` wins.
2. `kind="status"` → looks up `state` in `STATUS_TONES` (active→success, failed→danger, …).
3. `kind="letter"` → looks up `(domain, domainValue)` in `DOMAIN_TONES` (`work-item-type`, `env`).
4. Fallback `neutral`.

Unknown states/domains never throw — they fall through to `neutral`. Safe by construction for any payload, including the future custom-app API.

## API-driven shape (`BadgeSpec`)

`BadgeSpec` is the JSON-serialisable subset of `BadgeProps` (no `icon`, no `onClick`). When the custom-app API ships, an endpoint can return a `BadgeSpec` and the table/cell/header renders `<Badge {...spec} />` directly. The schema describes **state**, never **presentation**:

```json
{ "kind": "status", "state": "active" }
{ "kind": "count",  "value": 7 }
{ "kind": "letter", "domain": "work-item-type", "domainValue": "epic" }
```

## Migration targets (presentational badges only)

These are the bespoke classes `<Badge>` replaces; each is its own story:

- `users-table__status-badge--active/inactive` → `<Badge kind="status" state={…} />`
- `app-header-wrapper__badge` (header count bubble) → `<Badge kind="count" value={…} />`
- `bell-badge` (duplicate of above) — delete.
- `tree_accordion-dense__type-badge--epic/story/task/defect` → `<Badge kind="letter" domain="work-item-type" domainValue={…} />`
- `nav-prefs__core-badge`, `theme-lib__active-badge` → `<Badge kind="tag" label={…} />`

## Out of scope

- **`EnvBadge`** is a *control* (polls `/api/status/pipeline`, opens a menu, holds 3s for prod). It can later compose `<Badge kind="letter">` as its visual shell, but it is not a `<Badge>`. Tracked in [c_tech_debt.md](c_tech_debt.md) as S3.
- **User-supplied colours.** Deferred until the API launch — at which point custom apps pick slots from a platform-vetted palette (see plan §5), never raw hex. Until then, only platform code instantiates `<Badge>` and chooses tones.
