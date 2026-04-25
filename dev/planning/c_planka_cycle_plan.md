# Plan: Planka Cycle Time Analysis Tools

## Context

The Planka MCP server in `.planka/` already exposes the timing fields needed for workflow analytics (`createdAt`, `listChangedAt`, `prevListId`, `listId`) on every card returned by `getBoardById`. We want to add two new MCP tools — `analyze_cycle_time` (per-card) and `list_cycle_time_statistics` (per-board aggregate) — so the LLM can reason about how long work items sit in each list, where the bottlenecks are, and what the throughput looks like.

No new API calls are required: a single `planka.getBoardById(boardId)` returns every card with the timestamps we need. All calculations are pure functions over that response.

## Scope deviation from the handoff (one call-out)

The handoff suggests adding `timeInCurrentList`, `totalLifetime`, and `cycleState` directly onto the card type inside `PlankaGetBoardByIdResponse` in `src/lib/planka.ts`. **Recommendation: don't.** That type mirrors the wire shape of the Planka REST response; mixing derived/calculated fields onto it muddles the contract and risks a future API-shape change silently breaking our derived fields. Instead, define an `EnrichedCard` type in the new utils module that extends the wire card via `PlankaGetBoardByIdResponse["included"]["cards"][number] & { ...derived }`. Same data, cleaner separation. Flagging this so the user can reject if they prefer the handoff version literally.

## Files

**New:**
- `.planka/src/lib/cycle-time-utils.ts` — pure functions: duration math, formatting, state classification, list-statistics aggregation, throughput calc. No I/O.
- `.planka/src/tools/cycle-time.ts` — MCP tool registrations: `analyze_cycle_time`, `list_cycle_time_statistics`. Default-exports `(server, planka) => { ... }`, picked up automatically by the dynamic loader in `src/index.ts:42-57`.

**Untouched:**
- `.planka/src/index.ts` — auto-registers any `*.js` in `dist/tools/` after build, so a new `cycle-time.ts` is wired up by adding the file. No edit.
- `.planka/src/lib/planka.ts` — no edits (see deviation above).

## Implementation details

### `src/lib/cycle-time-utils.ts`

```ts
import type { PlankaGetBoardByIdResponse } from "./planka.js";

export type BoardCard = PlankaGetBoardByIdResponse["included"]["cards"][number];
export type BoardList = PlankaGetBoardByIdResponse["included"]["lists"][number];

export type CycleState = "recent" | "normal" | "stuck" | "done";

export interface EnrichedCard extends BoardCard {
  listName: string;
  prevListName: string | null;
  timeInCurrentList: number; // ms
  totalLifetime: number;     // ms
  cycleState: CycleState;
}

export interface ListStats {
  listId: string;
  listName: string;
  cardCount: number;
  avgMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
}

// Configurable thresholds (ms)
export const RECENT_THRESHOLD_MS = 60 * 60 * 1000;          // 1h
export const STUCK_THRESHOLD_MS  = 7 * 24 * 60 * 60 * 1000; // 7d
```

Functions (all pure, no `Date.now()` injected — accept `now: number = Date.now()` as last arg so tests/callers stay deterministic):

- `calculateTimeInList(listChangedAt: string, now?: number): number`
- `calculateCardLifetime(createdAt: string, now?: number): number`
- `getCycleState(timeInListMs: number, listName: string): CycleState`
  - Treat lists whose lowercased name matches `/done|completed|shipped|closed/` as `"done"` regardless of duration.
  - Filter out `trash`/`archive` lists upstream (in the tool layer), not here.
- `formatDuration(ms: number): string` — produces `"2d 3h 45m"`; `"<1m"` for sub-minute; drops zero units except for the leading one.
- `enrichCard(card: BoardCard, lists: BoardList[], now?: number): EnrichedCard`
- `calculateListStats(cards: BoardCard[], list: BoardList, now?: number): ListStats` — uses `timeInCurrentList` for cards currently *in* that list. Median = sorted middle (avg of two middles for even counts). Empty list → all zeros.
- `calculateThroughput(cards: BoardCard[], doneListIds: string[], windowDays: number, now?: number): number` — counts cards whose `listChangedAt` is within `windowDays` AND whose `listId` ∈ `doneListIds`; returns cards/day.
- `formatStatsTable(stats: ListStats[]): string` — markdown pipe table matching the handoff's "Example 2".

### `src/tools/cycle-time.ts`

Mirror the existing tool shape from `src/tools/lists.ts`:

```ts
export default (server: McpServer, planka: Planka) => {
  server.registerTool("analyze_cycle_time", {
    title: "Analyze cycle time",
    description: "Per-card cycle-time analysis for a board (or a single list).",
    inputSchema: {
      boardId: z.string().describe("Board to analyze"),
      listId: z.string().optional().describe("Filter to a single list"),
      stuckThresholdDays: z.number().optional().describe("Override default 7d stuck threshold"),
    },
  }, async ({ boardId, listId, stuckThresholdDays }) => { ... });

  server.registerTool("list_cycle_time_statistics", {
    title: "List cycle time statistics",
    description: "Aggregate per-list cycle-time statistics + throughput for a board.",
    inputSchema: {
      boardId: z.string().describe("Board to analyze"),
      listSequence: z.array(z.string()).optional().describe("Ordered list names defining the workflow; defaults to lists in position order minus trash/archive"),
      throughputWindowDays: z.number().optional().describe("Window for throughput calc (default 7)"),
    },
  }, async ({ boardId, listSequence, throughputWindowDays }) => { ... });
};
```

Both handlers:
1. Call `planka.getBoardById(boardId)`.
2. Skip cards whose `listId` belongs to a list named `trash` or `archive` (case-insensitive).
3. Build a `listId → listName` map from `included.lists` (also resolving `prevListId`).
4. Enrich cards via `enrichCard`.
5. Return MCP response shape: `{ content: [{ type: "text", text: <human readable> }], items: <enriched cards or stats> }` — same convention as `src/tools/lists.ts:50` / `src/tools/cards.ts`.

`analyze_cycle_time` text format follows the handoff "Example 1" (one block per card). `list_cycle_time_statistics` text format follows "Example 2" (markdown table + throughput line + overall To-Do→Done cycle time avg using `listSequence[0]` and `listSequence[-1]`).

### Edge cases handled

- `listChangedAt` missing/null → fall back to `createdAt`.
- Single-card list → median = avg = min = max.
- Empty board → friendly "No cards found" text, empty `items: []`.
- Unknown `prevListId` (list deleted/archived) → render `null`.
- `listSequence` contains a name not on the board → ignore that entry, warn in the text output.

## Build & smoke test

This repo uses Node + TypeScript (`package.json`), not Bun. No test framework is present; verification is manual against a live board.

1. **Build:** `cd .planka && npm run build` — confirms TypeScript compiles cleanly. (No tests to run.)
2. **Boot the MCP server** the way it's already wired in the user's MCP config (the planka MCP is registered per `MEMORY.md`).
3. **Smoke test via MCP** against the live Planka backlog board:
   - Call `mcp__planka__get_boards` → grab the Backlog board id.
   - Call the new `analyze_cycle_time` with that boardId; spot-check that "Time in current list" matches `now - listChangedAt` for one card.
   - Call `list_cycle_time_statistics`; verify the To Do / Doing / Completed rows have non-zero counts and the throughput number is plausible.
4. **Edge sanity:** call `analyze_cycle_time` with a `listId` for a near-empty list and confirm the empty-state path renders cleanly.

If the user wants automated coverage later, the pure functions in `cycle-time-utils.ts` are trivially testable with `node:test` or `vitest` — flag this in the tech-debt register (S3) but don't add a framework now (per the user's "no debt" feedback rule, the absence of tests was already there; we're not adding new untested surface area beyond the existing untested codebase).

## Out of scope (per handoff "Next Phase")

Historical snapshots, trend analysis, bottleneck ranking, ETA forecasting. None of these are needed for the first cut and all require persistence, which the current MCP has none of.
