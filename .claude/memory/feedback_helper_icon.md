---
name: Helper icon — always wire through <Panel>, never inline
description: When user says "helper icon" / "help hexagon" / "help button" — wrap the host block in <Panel name="..." title="..."> so it ties into Page Help admin via the addressable substrate. Never render an inline TbHelpHexagon + popover.
type: feedback
---

When the user asks to add a "helper icon", "help hexagon", "help button", or "help" on any page, the answer is **always** the same: wrap the relevant block in `<Panel name="snake_case" title="Title">` from `app/components/Panel.tsx`. Do not invent an inline TbHelpHexagon + popover.

**Why:** `<Panel>` registers itself in the addressable substrate via `useRegisterAddressable({kind: "panel", name})`, which:
- Posts to `/addressables/register` → row in `page_addressables` with address `samantha._viewport.<slot>._panel.<name>` (or nested under a parent if mounted inside another addressable).
- Wires the help button (`TbHelpHexagon`) into the panel header automatically.
- Lazy-fetches `/page-help/<addressable_id>` on first open → shows backend-authored help, with SDK manifest defaults as fallback, with empty state last.
- Surfaces the address in the Dev → Page Help admin tab so gadmin can author help body without a code change.

An inline help button **bypasses all of this** — the help text becomes hard-coded JSX, invisible to Page Help admin, and uneditable. That is the wrong shape. The user told me this on 2026-05-12: "just because they dont use independant help id's and share doesnt mean it shouldnt tie back to the page help page, thats its whole point".

**How to apply:**

1. **One Panel per logical scope.** If many rows on a page share the same help (e.g. transition-rules has many flow rows but the help text is identical), wrap the *page description / intro* block once with `<Panel name="page_root">` — that is the page-level help. Do NOT put a Panel on every row with the same `name` — sibling collisions throw (`useRegisterAddressable` detects `claimMount > 1` for the same derived address).
2. **Choose the right `name`.** Snake-case, `^[a-z0-9_]{1,64}$`. Describe the scope: `transition_rules`, `roles_admin`, `topology_canvas`. Names compose into the full address — keep them short and stable.
3. **Pick the visual mode:**
   - **Default `<Panel>`** — `<section class="panel">` with surface, border, padding, header bar with title + help button top-right. Use when the block stands alone as a card.
   - **`<Panel className="panel--bare">`** — zero box (no border, no surface, no padding). Use when wrapping pre-styled content (e.g. `.fs-page-description`) where the substrate is the only thing you want, not the chrome.
4. **Strip any inline help machinery.** Remove `TbHelpHexagon` imports, helpOpen state, helpBtnRef, ESC/outside-click effects, popover JSX, and the corresponding `__help-pop / __help-title / __help-list` CSS. If the inline button needed `position: relative` on a parent or `padding-right: <N>px` on a sibling title, strip those too.
5. **Help body authoring:** once the address is registered, gadmin authors help via PUT `/page-help/admin/<addressable_id>` (which upserts). Currently the Dev Page Help admin list is read-only over `JOIN page_help` — addresses with no `page_help` row don't appear there. Mention this to the user only if they ask why a freshly-registered Panel isn't showing in the editor; do not "fix" it speculatively.

**Reference files:**
- [`app/components/Panel.tsx`](../../app/components/Panel.tsx) — the primitive
- [`app/contexts/DomRegistryContext.tsx`](../../app/contexts/DomRegistryContext.tsx) — `useRegisterAddressable`, runtime register POST, collision detection
- [`docs/c_c_addressables.md`](../../docs/c_c_addressables.md) — substrate doc
- [`backend/internal/addressables/service.go`](../../backend/internal/addressables/service.go) — `AdminListHelp` query showing why only rows with `page_help` entries appear in Dev → Page Help

**Example — what NOT to do (inline, hard-coded):**
```tsx
const [helpOpen, setHelpOpen] = useState(false);
return (
  <div className="my-block">
    <button onClick={() => setHelpOpen(v => !v)}><TbHelpHexagon /></button>
    {helpOpen && <div className="my-block__help-pop">Hard-coded text…</div>}
  </div>
);
```

**Example — what TO do (substrate-tied):**
```tsx
return (
  <Panel name="my_block" title="My Block">
    {/* existing content */}
  </Panel>
);
```
