# Handoff Prompt: Planka Cycle Time Analysis Tools

## Overview

root/.planka/ is the only folder you need, do not leave the folder as it contains and needed files :

Implement cycle time tracking and analysis tools for the Planka MCP kanban board. The Planka API already provides timestamps for card movements (`listChangedAt`, `prevListId`) which enable calculation of workflow velocity and cycle time metrics.

## Current State
- ✅ Card list repo cloned to `.planka/` folder
- ✅ Base MCP tools implemented (lists, cards, boards, etc.)
- ✅ List card counts added to display (e.g., "To Do (4)")
- ✅ Available timing data identified in card objects

## Available Data Fields (in `src/lib/planka.ts`)
Each card in the Planka API response includes:
- **`createdAt`**: Card creation timestamp
- **`updatedAt`**: Last modification timestamp
- **`listChangedAt`**: When card entered current list (ISO datetime)
- **`listId`**: Current list ID
- **`prevListId`**: Previous list ID (null if first list)
- **`stopwatch`**: Optional manual timer value
- **`boardId`**: Board identifier

## Work to Implement

### 1. Create New Tool: `analyze_cycle_time` 
**File**: `src/tools/cycle-time.ts` (new file)

**Functionality**:
- Input: `boardId` and optional `listId`
- Calculates for each card:
  - Time in current list: `now - listChangedAt`
  - Total card lifetime: `now - createdAt`
  - Status indicator (recent move, stuck, etc.)
- Return formatted output with all timings

### 2. Create New Tool: `list_cycle_time_statistics`
**File**: `src/tools/cycle-time.ts`

**Functionality**:
- Input: `boardId`, optional list sequence (e.g., ["To Do", "In Progress", "Done"])
- Analyze all cards on board
- Calculate per-list statistics:
  - Average time in each list
  - Median time in each list
  - Min/max time in each list
  - Card count per list
- Return summary table showing cycle time metrics

### 3. Extend Card Type in `src/lib/planka.ts`
**Update**: `PlankaGetBoardByIdResponse` card object type

Add calculated fields:
```typescript
timeInCurrentList?: number; // milliseconds
totalLifetime?: number; // milliseconds
cycleState?: 'recent' | 'normal' | 'stuck' | 'done'; // based on thresholds
```

### 4. Create Cycle Time Analysis Utility
**File**: `src/lib/cycle-time-utils.ts` (new file)

**Functions**:
- `calculateTimeInList(listChangedAt: string): number` - Returns ms
- `calculateCardLifetime(createdAt: string): number` - Returns ms
- `calculateListAverageTime(cards: Card[], listId: string): number` - Returns ms
- `getCycleState(timeInList: number, listName: string): 'recent' | 'normal' | 'stuck' | 'done'`
  - Thresholds: recent < 1hr, stuck > 7 days (or config)
- `formatDuration(ms: number): string` - Returns "2d 3h 45m"
- `calculateThroughput(cards: Card[], boardId: string, days: number): number` - Cards completed per day

## Technical Details

### Register Tools in Main Index
Update `src/index.ts` to register new cycle-time tools alongside existing tools.

### Date/Time Handling
- Use native JavaScript `Date` objects
- All Planka timestamps are ISO 8601 format
- Ensure timezone-aware calculations
- Format output in human-readable format (e.g., "2 days 3 hours")

### List Sequence Logic
- Build workflow sequence from board lists
- Handle special lists: "trash", "archive" (filter out)
- Allow optional user-provided sequence for non-standard boards
- Calculate time between consecutive lists for velocity

### Thresholds (Configurable)
- "Recent": < 1 hour in list
- "Normal": 1 hour to 7 days
- "Stuck": > 7 days
- Adjust based on board type (use description or custom field hints)

## Output Format Examples

### Example 1: Cycle Time for Single Card
```
Card: "Fix login bug" 
  Created: 2026-04-20 10:30 (5 days ago)
  Current List: In Progress
  Time in current list: 2 days 4 hours
  Previous list: To Do → In for 3 days 2 hours
  Total lifetime: 5 days
  Status: STUCK (threshold: 7 days)
```

### Example 2: List Statistics
```
List Cycle Time Statistics (Board: Backlog)

| List | Avg Time | Median | Min | Max | Cards |
|------|----------|--------|-----|-----|-------|
| To Do | 2d 4h | 1d 12h | 4h | 8d | 12 |
| In Progress | 3d 8h | 3d | 2h | 15d | 4 |
| Done | 4d 20h | 4d | 1d | 9d | 8 |

Throughput: 2.1 cards/day (last 7 days)
Cycle Time (To Do → Done): 10 days 12 hours avg
```

## File Structure
```
.planka/src/
├── tools/
│   ├── cycle-time.ts (NEW)
│   ├── lists.ts (exists)
│   └── cards.ts (exists)
├── lib/
│   ├── cycle-time-utils.ts (NEW)
│   ├── planka.ts (update types)
│   └── ...
└── index.ts (update registrations)
```

## Testing Checklist
- [ ] Tool returns correct timings for cards
- [ ] List statistics aggregate correctly
- [ ] Timezone handling is correct
- [ ] Edge cases handled (null `listChangedAt`, single-card lists)
- [ ] Output formatting is readable
- [ ] Integration with existing tools works

## Assumptions
- Planka API response always includes `listChangedAt` and `prevListId`
- Board lists are ordered (position field) for workflow logic
- User timezone is handled by client display layer
- No database needed; all analysis from live API data

## Next Phase (Future)
- Historical tracking (store daily snapshots)
- Trend analysis (cycle time getting better/worse?)
- Bottleneck identification (which list slows work most?)
- Forecasting (ETA based on velocity)

---

**Start with**: Implement `analyze_cycle_time` tool first, then `list_cycle_time_statistics`, then utilities. Test against live board data in `.planka`.
