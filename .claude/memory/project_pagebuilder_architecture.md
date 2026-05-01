---
name: PageBuilder Architecture & Scope
description: Paywalled, standalone page builder with Elementor-style container model (Section→Row→Column→Widget); 5-phase build plan spanning 14 stories (00188–00201)
type: project
originSessionId: 61c5b70d-2a0b-4954-8ef1-13568114b22a
---
## PageBuilder Overview

PageBuilder is a **standalone, paywalled feature** for Vector that enables teams to build custom dashboards and intranet spaces. It is architecturally isolated in its own component tree/namespace, separate from the main app (apart from shared database).

## Container Model Architecture (Elementor-Based)

**Why Elementor-style?** Initial flat grid model (12-col) was too inflexible. Hierarchical containers provide nesting, dynamic grid counts per row, responsive breakpoints, drag-to-nest, and preset layouts.

### Element Types
- **Section** — top-level container, full-width or boxed, contains Rows
- **Row** — horizontal container, specifies column count (1–6+), contains Columns  
- **Column** — grid cell within Row, auto-sized via flex or manual %, contains Widgets  
- **Widget** — leaf node (terminal), renders content (git-graph, text, charts), binds to data source

### Key Learnings from Elementor Source
1. JSON as primary format (stored as JSONB, portable for export/import)
2. Three structural tiers: General Structure, Page Settings, Page Content
3. Per-element responsive overrides via `breakpoints` object (desktop/tablet/mobile)
4. Repeaters for dynamic element groups (future feature: data-driven repetition)
5. Global styles for theme switching (CSS variables, cascading)
6. Frontend renderer traverses JSON tree recursively per breakpoint

## Build Plan (5 Phases, 14 Stories)

**Phase 1 (3 stories, 6 weeks):** Canvas + hierarchy + properties panel + serialization  
**Phase 2 (2 stories, 4 weeks):** Palette + preset layouts (1-col, 2-col, 3-col, 4-col)  
**Phase 3 (3 stories, 6 weeks):** Widget registry + data binding UI + real-time subscriptions  
**Phase 4 (2 stories, 4 weeks):** Responsive breakpoints editor + preview  
**Phase 5 (4 stories, 6 weeks):** Team scoping + PO aggregation + theme editor + export/share  

## Story Allocation

Stories: 00188–00201 (14 total)  
Feature area: **FE-PGB** (13 labels pre-allocated; story count now 14, will need 1 additional label)  
Phase label: **PH-0005**  

## Key Design Decisions

1. **Standalone namespace** — all PageBuilder code lives in dedicated component structure, no code in main app router or global nav
2. **Paywall gating** — feature behind permission check / subscription gate
3. **JSON serialization** — page layouts stored as JSONB in `user_custom_page_layouts` table
4. **Data binding at leaf level only** — Widgets (leaves) bind to data sources; containers are structural only
5. **Immer-based state** — nested element mutations via Immer (like Craft.js)
6. **Preset templates** — 1-col, 2-col, 3-col, 4-col pre-built section templates for rapid composition

## Next Steps (When Ready to Storify)

1. Run `/stories` skill with decomposed story list (14 stories, 5 phases, FE-PGB area)
2. Step 0: Allocate IDs 00188–00201, confirm PH-0005, propose FE-PGB feature area
3. Step 3: Confidence gate — all 14 stories must pass 85% confidence thresholds
4. Step 5c: Label verification — ensure all cards carry AIGEN + PH-0005 + FE-PGB + EST + RISK
5. Step 6: Update story index to "Last issued: 00201"
6. Step 7: Report and wait for user approval to move from Backlog → To Do

## Technical Debt & Flags

- **S2 (Cap Now):** Custom page layouts table schema design—needs query optimization for complex nested JSON (index on page_id, consider JSONB operators for filtering)
- **S3 (Record):** Future expansion—Repeaters for data-driven widget generation (e.g., iterate over repos, teams), Accordion/Tab containers, masonry layouts

---
**Status:** Research complete (R019.json updated with Elementor analysis). Ready for `/stories` when user approves scope.
