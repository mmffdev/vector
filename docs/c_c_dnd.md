# Drag-and-drop convention — `@dnd-kit`

`@dnd-kit` is the project's canonical drag-and-drop library. Do not introduce a competing one (`react-beautiful-dnd`, `react-dnd`, native HTML5 DnD wrappers, etc.). If a use case feels like it doesn't fit, extend the existing primitives rather than reach for an alternative.

## Pinned packages

```
@dnd-kit/core       ^6.3.1
@dnd-kit/sortable   ^10.0.0
@dnd-kit/utilities  ^3.2.2
```

Source of truth: [`package.json`](../package.json).

## When to use which package

| Need | Package | Pattern |
|---|---|---|
| Sortable list (rows, tabs, chips) | `@dnd-kit/sortable` | `SortableContext` + `useSortable` per item |
| Free-form drag (drag a card onto a target) | `@dnd-kit/core` | `DndContext` + `useDraggable` / `useDroppable` |
| Transform style helper | `@dnd-kit/utilities` | `CSS.Transform.toString(transform)` |

Almost everything in this codebase is "sortable list" — start with `@dnd-kit/sortable` unless the interaction is genuinely free-form.

## Existing adopters

- **[`app/(user)/preferences/navigation/page.tsx`](../app/(user)/preferences/navigation/page.tsx)** — sortable navigation entries; uses `DndContext` + `SortableContext` + `CSS` transform helper.
- **[`app/components/DragHandleColumn.tsx`](../app/components/DragHandleColumn.tsx)** + **[`app/hooks/useResourceRank.ts`](../app/hooks/useResourceRank.ts)** + **[`app/hooks/useOptimisticReorder.ts`](../app/hooks/useOptimisticReorder.ts)** — generic table-row ranking primitives shipped in PLA-0003 ([plan](../dev/plans/PLA-0003.json)). Used by [`app/(user)/work-items/page.tsx`](../app/(user)/work-items/page.tsx).
- **`SecondaryNavigation` reorder mode (PLA-0014)** — sortable tabs in the secondary tabstrip; per-user, per-page persistence.

## Ground rules

1. **Reuse before reinvent.** Tables → `DragHandleColumn` + the rank hooks. Tabs → `SecondaryNavigation` reorder mode. Lists → mirror `preferences/navigation/page.tsx`. New patterns only when none of these fit.
2. **Server is the order of truth.** The client sends the new full ordering on drop; the server replaces it in a transaction. Never compute "fractional positions" client-side and trust them.
3. **Debounce the save.** 250 ms collapser is the default — fast successive drags should produce one PUT, not five.
4. **Sliding indicators / hover transitions** must be suppressed while a drag is in progress to avoid the indicator chasing the dragged item.
5. **Accessibility:** keyboard sensors are required for any sortable surface. `@dnd-kit/core`'s `KeyboardSensor` + `sortableKeyboardCoordinates` is the only supported keyboard path.

## Anti-patterns

- Adding `react-beautiful-dnd` "just for this one screen". Refused on review.
- Native HTML5 `draggable` attribute for anything that ships to users. Reserved for dev-only debug surfaces.
- Persisting client-computed `position: 1.5` floats. The server owns ordering.
- Storing per-user ordering in localStorage. Use the per-user table (`user_tab_order` / `user_nav_prefs`) so the order travels with the account.
