# Feature label registry (FE-SECNNNN)

One feature label per discrete feature/section. Every story card must carry exactly one `FE-SEC*` label so the board can be filtered to a single feature's cards.

## Allocation

- Format: `FE-SECNNNN` (4-digit zero-padded counter, no gaps reserved).
- Allocated sequentially when a new feature appears that doesn't fit any existing label.
- Storify proposes `FE-SECNNNN` when no existing label matches; user confirms or picks an existing one.
- Once allocated, never renamed (cards reference the label by ID, but humans recognise the name).

## Registry

| Label | Planka label ID | Color | Meaning |
|---|---|---|---|
| `FE-SEC0001` | `1760810747115341214` | tank-green | Portfolio-model adoption / wizard (Phase 4) |
| `FE-SEC0002` | `1760821853498115528` | tank-green | Role boundary / page gating (padmin vs gadmin) |
| `FE-SEC0003` | `1760826753166607866` | tank-green | Test infrastructure / canary integrity |

## Adding a new feature label

1. Pick the next sequential number (`FE-SEC0002`, `FE-SEC0003`, ...).
2. Create the label on Planka via `create_label` with color `tank-green` (all FE labels share this color).
3. Append a row to the registry above with the Planka label ID.
4. Apply to all cards in the feature.
