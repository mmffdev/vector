---
title: Rally Data Model & Schema Analysis
author: Claude Code Research
date: 2026-04-25
scope: Architecture comparison for portfolio/backlog systems
---

# Rally: Data Model & Schema Research

This document provides a comprehensive analysis of Rally's (Broadcom CA Agile Central) data model, schema structure, and key design patterns to inform architectural decisions for our similar project.

## Executive Summary

Rally uses a hierarchical, work-item-centric data model with **4 core entity types**: Portfolio Items, User Stories, Defects, and Tasks/Test Cases. The system supports both **timeboxed planning (Iterations/Releases)** and **flow-based kanban workflows**. A critical distinction exists between **Schedule State** (workspace-level workflow standard) and **Flow State** (team-level Kanban column customization).

---

## Core Entity Hierarchy

### 1. Portfolio Items (Highest Level)

**Purpose:** Strategic-to-tactical work planning at organizational level  
**Hierarchy Depth:** 3 levels (Theme > Initiative > Feature)  
*Source: [Portfolio Item Types](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/administration/managing-your-workspace/customizing-portfolio-item-types/portfolio-item-types.html)*

**Standard Subtypes:**
- Theme (Level 3 - product strategy)
- Strategy (organizational-level planning)
- Initiative (Level 2 - cross-team initiatives)
- Feature (Level 1 - lowest, flows to execution teams)

*Source: [Portfolio Item Types](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/administration/managing-your-workspace/customizing-portfolio-item-types/portfolio-item-types.html)*

**Key Design Pattern:** Only the lowest-level portfolio item type flows to user stories for implementation. Higher tiers aggregate status from children.

*Source: [Portfolio Item Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/managing-portfolio-items/portfolio-item-planning/creating-portfolio-items/portfolio-item-fields.html) - "Only the lowest level of portfolio item type flows through execution teams to be implemented in a series of user stories."*

### 2. User Stories (Execution Level)

**Purpose:** Primary work unit for development teams  
**Parent Options:** Feature (lowest portfolio item) OR free-standing  
*Source: [User Story Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/user-stories/user-story-fields.html)*

**Constraints:**
- Parent stories cannot have tasks or timeboxes
  *Source: [User Stories](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/user-stories.html) - "Parent stories cannot have tasks, timeboxes, or plan estimates assigned to them"*
- If child stories added to existing story, child tasks moved to first child
  *Source: [User Stories](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/user-stories.html)*
- Can be hierarchical (parent + child stories)
  *Source: [User Story Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/user-stories/user-story-fields.html)*

### 3. Defects

**Purpose:** Issue tracking and remediation  
**Parent Options:** User Story OR Portfolio Item (mutually exclusive)  
*Source: [Defect Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-defects-and-defect-suites/defects/defect-fields.html) - "Defects can parent to either a user story OR portfolio item (mutually exclusive, not both)"*

**Conversion Capability:** Defects can convert to User Stories (defect moved to Closed, resolution=Converted)
*Source: [User Stories](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/user-stories.html) - "You can convert defects to user stories...when you convert a defect, it is moved to closed state, the resolution is changed to Converted"*

### 4. Tasks

**Purpose:** Sub-work decomposition  
**Parent Options:** User Story OR Defect  
**Key Constraint:** Tasks roll up Estimate, To Do, Actual to parent

### 5. Test Cases

**Purpose:** Validation and acceptance criteria  
**Association:** Linked to User Stories or Defects via Work Product field  
**Execution Model:** Test Case Results capture verdicts and execution history

---

## Entity Relationship Model

```
Portfolio Item (Theme/Initiative/Feature)
  └── Parent → Child Portfolio Items (hierarchical)
      └── Children → User Stories (Feature only)
          ├── Parent → Defects (alternative parent)
          ├── Children → User Stories (nested)
          ├── Child → Tasks
          └── Association → Test Cases
                └── Test Case Results (execution log)

User Story / Defect (parallel parents)
  ├── Child → Tasks (with rollup aggregation)
  └── Association → Test Cases

Defect (alternative to User Story)
  ├── Child → Tasks
  └── Association → Test Cases

Timeboxes (Releases / Iterations)
  └── Schedule → User Stories / Defects
```

---

## Data Model: Core Fields by Entity Type

### Portfolio Item Fields (65+ total)

**Identity & Classification:**
- Name (required)
- ID (system-assigned)
- Portfolio Item Type (required dropdown)
- Project (required)

**Planning & Estimation:**
- Preliminary Estimate (T-shirt: S/M/L/XL)
- Refined Estimate (story points)
- Refined Work Item Count Estimate
- Plan Estimate (points for children)
- Investment Category (budget allocation)

**Timeline Tracking:**
- Planned Start Date
- Planned End Date
- Actual Start Date (first child In-Progress)
- Actual End Date (final child Accepted)
- State Changed Date
- Creation Date

**Status & Progress:**
- State (Kanban column mapping)
- Status (Ready / Blocked)
- Blocked (boolean)
- Blocked Reason
- Percent Done by Story Plan Estimate
- Percent Done by Story Count
- Percent Done By Total Plan Estimate
- Percent Done By Total Count
- Total Accepted Children %
- Last Rollup Date

**Rollup Fields** (aggregations from children):
- Accepted Defect Count Rollup
- Accepted Defect Estimate Total Rollup
- Accepted Leaf Story Count
- Accepted Leaf Story Plan Estimate Total
- Accepted Total Count Rollup
- Accepted Total Estimate Rollup
- Defect Count Rollup
- Defect Plan Estimate Total Rollup
- Leaf Story Count
- Leaf Story Plan Estimate Total
- Total Count Rollup
- Total Estimate Rollup
- Un-estimated Defect Count Rollup
- Un-estimated Leaf Story Count
- Un-estimated Total Count Rollup

**Scoring & Prioritization:**
- Risk Score
- Value Score
- WSJF Score (Weighted Shortest Job First)

**Hierarchy & Relationships:**
- Parent (Portfolio Item parent only)
- Children (collection)
- Ancestors (hierarchy path)
- Dependencies (predecessors/successors count)

**Metadata:**
- Description (rich text)
- Notes
- Owner
- Created By
- Tags (multiple)
- Archived (soft-delete)
- Attachments (images, PDFs, files)
- Release (lowest level only)
- Discussions (collaboration)
- Revision History
- Capacity Plans
- Late Child Count

### User Story Fields (35+ total)

**Core Identity:**
- Name (required)
- ID (system-generated unique)
- Description (required, rich text)
- Owner (user selection)
- Project (required, reference)

**Schedule & Planning:**
- Schedule State (Defined → In Progress → Completed → Accepted) ★ **key workflow field**
- Flow State (customizable team-level status, distinct from Schedule State)
- Iteration (timebox assignment, dropdown)
- Release (product release scheduling)
- Plan Estimate (story points, 3 digits + 2 decimals)
- Accepted Date (when reached Accepted state)

**Hierarchy & Relationships:**
- Parent (user story or portfolio item)
- Ancestors (full hierarchy)
- Feature (lowest portfolio item parent, auto-populated)
- Children (nested stories, read-only)

**Status & Flow:**
- Status (Ready or Blocked)
- Blocked (boolean)
- Blocked Reason (text)
- Ready (signals next phase readiness)
- Expedite (Kanban prioritization flag)

**Related Work Items:**
- Defects (collection of linked defects)
- Defect Status (summary of linked defect states)
- Task Status (summary of task states)
- Task Rollup (Estimate, To Do, Actual aggregates)
- Test Cases (collection)
- Test Case Status (execution status summary)

**Documentation & Collaboration:**
- Notes (team decisions, customer input)
- Discussions (rich text collaboration)
- Attachments (≤50 MB, 256 byte description)
- Affects Doc (documentation impact checkbox)
- Tags (categorization)
- Risks (associated risks collection)

**Audit & Metadata:**
- Created By (auto-populated)
- Submitted By (defaults to creator)
- Last Updated
- Last Run (test execution date)
- Last Verdict (test result)

### Defect Fields

**Core Fields:**
- ID (system-generated unique)
- Description (rich text with images)
- Owner (defaults to creator)
- Project (required)

**Tracking & Status:**
- Priority (customizable dropdown)
- Severity (customizable dropdown)
- State (customizable dropdown)
- Resolution (customizable dropdown)
- Schedule State (Defined → In Progress → Completed → Accepted)
- Found in Build/Release
- Fixed in Build / Target Build

**Status Indicators:**
- Blocked (boolean)
- Blocked Reason (text)
- Ready (boolean)
- Expedite (boolean for Kanban)

**Relationships:**
- Parent (User Story OR Portfolio Item, mutually exclusive)
- Child Tasks (collection, rollup: Estimate, To Do, Actual)
- Associated Test Cases (from which defect created)
- Test Cases validating fix (separate collection)

### Task Fields

**Identity:**
- FormattedID (read-only, system-generated, customizable prefix)
  *Source: [Task Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/defining-tasks/task-fields.html) - "A system-generated ID...unique and will never change"*
- Description (brief summary, rich text)

**Work Tracking:**
- Notes (team decisions, comments)
  *Source: [Task Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/defining-tasks/task-fields.html) - "team decisions, customer input, or discussion results"*
- Blocked (boolean, rolls up to parent)
  *Source: [Task Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/defining-tasks/task-fields.html) - "Any task that is blocked will automatically rollup to the related scheduled item"*
- Blocked Reason (text, conditional display)
- Ready (checkbox for Kanban)
- Rank (read-only, relative importance)

**Estimation & Time:**
- Estimate (decimal, 3 digits + 2 decimals)
  *Source: [Task Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/defining-tasks/task-fields.html)*
- To Do (remaining work, defaults to Estimate)
  *Source: [Task Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/defining-tasks/task-fields.html)*
- Time Spent (read-only hours)
- Actuals (hidden by default, actual units spent)

**Key Design Pattern:** Tasks decompose scheduled work items; FormattedID prefix differs by type (US=User Story, DE=Defect).

*Source: [Task Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/defining-tasks/task-fields.html) - "a task is a unit of work that contributes to the fulfillment and completion of a scheduled work item"*

### Test Case Fields

**Core Identity:**
- ID (system-generated, customizable prefix TC)
  *Source: [Test Case Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-tests/manage-test-cases/test-case-fields.html) - "A system-generated ID...The ID consists of a prefix and a numerical value"*
- Name (required)
  *Source: [Test Case Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-tests/manage-test-cases/test-case-fields.html)*
- Description (overview)

**Test Definition:**
- Objective (detailed test purpose)
  *Source: [Test Case Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-tests/manage-test-cases/test-case-fields.html) - "Detail the objective of the test case"*
- Pre Conditions (prerequisites)
- Validation Input (what is tested)
- Validation Expected Result (acceptance criteria)
- Post Conditions (system changes after test)
- Attachments (≤50 MB files)

**Configuration:**
- Type (required, test category)
  *Source: [Test Case Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-tests/manage-test-cases/test-case-fields.html)*
- Method (required: Manual or Automated)
  *Source: [Test Case Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-tests/manage-test-cases/test-case-fields.html)*
- Priority (customizable)
- Test Folder (organization)

**Relationships:**
- Work Product (User Story or Defect link)
  *Source: [Test Case Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-tests/manage-test-cases/test-case-fields.html) - "Links to associated user stories or defects through the Work Product field"*
- Associated Work Item (from which created)

**Execution Tracking:**
- Last Verdict (auto-updated from results)
  *Source: [Test Case Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-tests/manage-test-cases/test-case-fields.html) - "Auto-updated from most recent execution"*
- Last Run (read-only execution date)
- Last Build (read-only)

**Metadata:**
- Owner (assignment)
- Project (required)
- Color (optional visual indicator)
- Expedite (Yes/No prioritization)
- Tags (categorization)

*Source: [Test Case Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-tests/manage-test-cases/test-case-fields.html)*

---

## Workflow: States & Transitions

### Schedule State (Workspace-Level Standard)

**Definition:** Universal workflow state across all teams and projects  
**Purpose:** Standardize status for reporting and rollup calculations  
*Source: [Flow-Based Planning](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/planning-with-flow-based-kanban-boards/flow-based-planning.html) & [Portfolio Kanban Board](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/portfolio-kanban-board.html)*

**Standard Values:**
1. Defined
2. In Progress
3. Completed
4. Accepted

*Source: [User Story Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/user-stories/user-story-fields.html)*

**Key Design Pattern:** Schedule State is the authoritative state for workspace-level aggregations, burndowns, and release planning.

*Source: [Flow-Based Planning](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/planning-with-flow-based-kanban-boards/flow-based-planning.html) - "Using the Schedule State field enables a shared view of work in Rally regardless of the methodology that each team practices"*

### Flow State (Team-Level Customization)

**Definition:** Team-specific Kanban column names and workflow customization  
**Purpose:** Allow teams to define their own process steps without changing Schedule State  
*Source: [Flow-Based Planning](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/planning-with-flow-based-kanban-boards/flow-based-planning.html)*

**Configuration:** Up to 20 custom flow states per team  
*Source: [Flow-Based Planning](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/planning-with-flow-based-kanban-boards/flow-based-planning.html) - "You can use up to 20 flow states to represent workflow processes in your team"*

**Mapping:** Each Flow State column maps to a Schedule State value  
*Source: [Flow-Based Planning](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/planning-with-flow-based-kanban-boards/flow-based-planning.html) - "Each flow state column that you create maps to a value in the Schedule State field"*

**Key Design Pattern:** Flow State and Schedule State are **dual-level system**:
- Schedule State = standardized workspace reporting level
- Flow State = team's customizable process level

*Source: [Portfolio Kanban Board](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/portfolio-kanban-board.html)*

### Flow Through Backlog → Scheduled → Kanban

1. **Backlog**: Unscheduled user stories/defects (Portfolio Items not shown)
2. **Scheduling**: Drag-drop into Release/Iteration (removes from Backlog)
3. **Kanban Board**: Move through Flow State columns (parent state custom per team)
4. **Schedule State Transitions**:
   - Defined → In Progress (first Flow State transition)
   - In Progress → Completed (task/child work completion)
   - Completed → Accepted (acceptance criteria met)

---

## Backlog Management Model

**Backlog Definition:** Collection of all unscheduled user stories, open defects, and defect suites

*Source: [Building Your Backlog](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog.html) - "the collection of all unscheduled customer input represented by user stories, any open defects, or defect suites"*

**Items in Backlog:**
- User Stories (only leaf/child items if hierarchy exists)
- Open Defects
- Defect Suites

*Source: [Building Your Backlog](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog.html)*

**Items NOT in Backlog:**
- Parent Stories (with children)
  *Source: [Building Your Backlog](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog.html) - "Parent stories with child stories cannot be scheduled and don't appear on the Backlog page"*
- Portfolio Items (scheduled to kanban at organizational level)
- Scheduled items (moved out on Release/Iteration assignment)
  *Source: [Building Your Backlog](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog.html) - "Once items are scheduled into releases or iterations, they're removed from the Backlog page"*

**Backlog Operations:**
- Collect customer input (user stories, defects)
- Manage and prioritize by rank
- Schedule into Releases/Iterations (via Team Planning page)
- Rank-based ordering (higher = more important)

*Source: [Building Your Backlog](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog.html)*

**Key Design Pattern:** Backlog is a **transient view**, not persistent storage. Items exit backlog on scheduling.

*Source: [Building Your Backlog](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog.html)*

---

## Timeboxing Model: Releases & Iterations

### Iteration
- **Purpose:** Time-boxed sprint (typically 2-4 weeks)
- **Scope:** Team-level execution planning
  *Source: [Working with Iterations](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/planning-with-timeboxes/timebox-based-planning/working-with-iterations.html)*
- **Field on Story:** Iteration (dropdown, current + 5 future/past)
  *Source: [User Story Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/user-stories/user-story-fields.html) - "Iteration (dropdown, current + 5 future/past)"*
- **Planning:** Iteration Planning meeting determines capacity and commits work
  *Source: [Planning Process](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/planning-with-timeboxes/timebox-based-planning/working-with-iterations/iteration-planning/planning-process.html)*

### Release
- **Purpose:** Product release milestone
- **Scope:** Portfolio and feature-level planning
  *Source: [Timeboxes & Release Planning](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/planning-with-timeboxes/timebox-based-planning.html)*
- **Field on Story:** Release (dropdown, current + past releases)
  *Source: [User Story Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/user-stories/user-story-fields.html)*
- **Scheduling:** Release Backlog collected, scheduled across iterations
  *Source: [Team Planning Page](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/team-planning-page.html)*
- **Only on Lowest Items:** Release field appears on lowest portfolio items and stories not parented to portfolio
  *Source: [Portfolio Item Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/managing-portfolio-items/portfolio-item-planning/creating-portfolio-items/portfolio-item-fields.html) - "Release (lowest level only)"*

---

## Temporal Data (Lookback API Patterns)

Rally's Lookback API provides **immutable snapshot history** for analytics:

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "Each work item has one or more snapshots that represent the state of the item at different periods in the past"*

**Snapshot Structure:**
- `_id`: Unique snapshot identifier
- `ObjectID`: Work item's Rally ID
- `_ObjectUUID`: Web Service API reference UUID
- `_ValidFrom` / `_ValidTo`: Time boundaries (inclusive start, exclusive end)
  *Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "_ValidFrom and exclusive of the end (_ValidTo_)"*
- `_SnapshotNumber`: Sequential counter per item
- Field values: Current state snapshot
- `_PreviousValues`: Changed fields from prior snapshot

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/)*

**Hierarchy Snapshots:**
- `_TypeHierarchy`: Type inheritance chain
- `_ProjectHierarchy`: Project ancestry array
- `_ItemHierarchy`: Work item parent-child path

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/)*

**Key Pattern:** Snapshots form non-overlapping time periods; at any moment, one snapshot is active.

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "For any ObjectID, only one snapshot is active at any given moment"*

---

## WIP & Kanban Limits

**Configuration Level:** Workspace administrators set per portfolio item state and type

*Source: [Portfolio Kanban Board](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/portfolio-kanban-board.html)*

**Display Model:**
- Format: `(current/limit)` displayed at column header
- Visual Indicator: Red when exceeded
  *Source: [Portfolio Kanban Board](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/portfolio-kanban-board.html) - "When exceeded, the numbers turn red"*
- Organizational Standard: "Define done at the organizational level"
  *Source: [Portfolio Kanban Board](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/portfolio-kanban-board.html)*

**Portfolio Kanban Features:**
- Exit Policies: Team-documented agreements for column transitions
- WIP Limit Enforcement: System indicates when exceeded
- Swimlanes: Customizable by team or epic

*Source: [Portfolio Kanban Board](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/portfolio-kanban-board.html)*

---

## Custom Fields Pattern

**Custom Field Naming Convention:**
- Prefix: `c_` (e.g., `c_KanbanState`)
  *Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "Custom fields are prefixed with 'c_'" and [Rally WSAPI Documentation](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/reference/writing-rally-queries/using-the-wsapi-documentation-to-write-valid-queries.html) - "as of Rally WSAPI v2.0, the ElementName for a custom field is prefixed with 'c_'"*
- Supported on: Most Artifact types (User Stories, Defects, Tasks, Portfolio Items)
  *Source: [Portfolio Item Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/managing-portfolio-items/portfolio-item-planning/creating-portfolio-items/portfolio-item-fields.html)*
- Querying: Via WSAPI with string-to-ObjectID silent conversion for dropdowns
  *Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "silently convert the specified string to the correct ObjectID"*
- Visibility: Custom fields list in WSAPI documentation
  *Source: [Rally Web Services API Documentation](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/reference/rally-web-services-api.html)*

---

## Key Architectural Insights for Our System

### 1. Hierarchy vs. Flat
Rally uses **multi-level hierarchy** (Portfolio Items 3 levels + User Stories nested + Tasks). Consider:
- Nesting depth trade-offs
- Rollup calculation complexity
- Query performance at deep hierarchies

### 2. Dual State System
The Schedule State + Flow State dual system provides:
- **Standardized reporting** (Schedule State for rollups)
- **Team autonomy** (Flow State for process customization)
- Consider whether our system needs both levels or a unified state model

### 3. Parent Mutually-Exclusive Pattern
Defects can parent to User Story OR Portfolio Item (not both). Risks:
- Complex validation logic
- Data integrity constraints
- Consider whether forcing single-parent is necessary

### 4. Transient Backlog View
Backlog is **not a persistent table**, but a filtered view of unscheduled items. Implications:
- No "backlog table" with foreign key
- State-based filtering logic for what appears in backlog
- Easier to evolve vs. persistent backlog entities

### 5. Comprehensive Rollup Strategy
Rally calculates **18 rollup fields** on Portfolio Items (accepted counts, estimates, defect aggregations). Trade-offs:

*Source: [Portfolio Item Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/managing-portfolio-items/portfolio-item-planning/creating-portfolio-items/portfolio-item-fields.html) - Lists all rollup fields including Accepted Defect Count Rollup, Leaf Story Count, Total Estimate Rollup, etc.*

- Powerful for reporting
- Complex incremental updates on child changes
- Consider materialized views or event-driven recalculation

### 6. Time-in-State Tracking
Lookback snapshots enable:
- Cycle time analysis
- Flow metrics (CFD, throughput)
- Historical what-if analysis
- Consider building immutable event log early

### 7. Blocking & Dependencies
Rally's blocking model:
- Simple: boolean `Blocked` + text `Blocked Reason`
- Rollup: blocked child items roll up to parent
- No explicit dependency graph (only "predecessors/successors count")

### 8. Estimated vs. Actual Divergence
Multiple estimation fields on Portfolio Items:
- Preliminary (T-shirt sizing)
- Refined (story points)
- Plan Estimate (children)
- Leaf Story Count estimates
- Consider whether multiple estimation types add value vs. complexity

---

## History & Activity Tracking

### Revision History (UI-Level Audit Trail)

Rally automatically captures **field-level changes** whenever work items are edited, updated, or modified through bulk actions.

*Source: [Revision History](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/additional-tracking-pages/view-revision-history.html) - "Rally systematically captures field-level changes whenever work items are edited or updated"*

**Tracked Information:**
- Revision number (auto-generated)
  *Source: [Revision History](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/additional-tracking-pages/view-revision-history.html)*
- Timestamp (date and time of revision)
- Author (team member who made the change)
  *Source: [Revision History](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/additional-tracking-pages/view-revision-history.html) - "The name of the team member who authored the change"*
- Change description (system-generated and user comments)

**What Triggers Revisions:**
- Direct field edits on work items
- Attachment additions or changes
- Multi-item edits via Actions
- Adding/removing work items from Releases or Iterations
- Adding Test Case Results to test cases

*Source: [Revision History](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/additional-tracking-pages/view-revision-history.html)*

**Accessing Revision History:**
- View by selecting work item ID and clicking Revision History icon on detail page ribbon
- Accessible at workspace, project, custom view, and subscription levels

*Source: [Revision History](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/additional-tracking-pages/view-revision-history.html)*

### Lookback API: Immutable Snapshot History (Analytics-Level History)

Rally's Lookback API provides a **complete historical record** of all work item state changes via immutable snapshots, enabling time-series analysis and state transition queries.

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/)*

**Snapshot Structure for History Tracking:**
- `_User`: Identity of who made the change
  *Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/)*
- `_RevisionNumber`: Sequential revision counter per item
- `_Revision`: Reference to the revision record OID
- `_ValidFrom`: Exact timestamp when change occurred (GMT)
  *Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/)*
- `_ValidTo`: End timestamp of validity period (far-future "9999-01-01T00:00:00Z" for current state)
  *Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/)*
- `_SnapshotNumber`: Sequential counter for ordering history
- `_PreviousValues`: Object containing **all field values that changed** in this snapshot
  *Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "_PreviousValues: Changed field values from prior snapshot"*

**State Transition Tracking Example:**

When Schedule State changes from "Defined" to "In Progress":
```
Snapshot N:
  _ValidFrom: 2026-04-20T14:32:15Z (when transition happened)
  _ValidTo: (until next change)
  ScheduleState: "In Progress"
  _PreviousValues: {
    ScheduleState: "Defined"  ← previous value captured
  }
  _User: (ID of person who moved it)
```

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - Shows example of State field changing from "Submitted" to "Open"*

**Querying State Transitions:**

Find all defects that transitioned to "Completed" between two dates:
```
{
  "_PreviousValues.State": {"$lt": "Completed"},
  "State": {"$gte": "Completed"},
  "_ValidFrom": {"$gte": "2011-07-01T00:00:00Z", "$lt": "2011-08-01T00:00:00Z"}
}
```

Results include `_ValidFrom` timestamp showing **exactly when** the transition occurred, enabling:
- Cycle time analysis (time in each state)
- Flow metrics (throughput, CFD charts)
- Duration calculations between state transitions

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "Complicated temporal queries to find transactions that occur within a specific time frame or the amount of time that work spends in a particular logical state"*

**Kanban State Transitions:**

Custom kanban states tracked via `c_KanbanState` field:
```
{
  "_PreviousValues.c_KanbanState": {"$ne": null},
  "c_KanbanState": {"$ne": null}
}
```

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - Supports querying `_PreviousValues.c_KanbanState` for custom kanban state transition tracking*

**Item Deletion & Restoration Tracking:**

- **Deletion:** `_ValidTo` on current snapshot updated to deletion timestamp
  *Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "When a work item is deleted from Rally, the _ValidTo date on its current snapshot is updated to reflect the time of deletion"*
- **Restoration:** New snapshot created with `_ValidFrom` = restoration timestamp
  *Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "If the work item is later restored from recycling bin, a new snapshot is created"*

### Discussions & Comments (Collaborative Activity Trail)

**What Discussions Capture:**

Discussions are rich-text, time-ordered comment threads on work items capturing team collaboration.

*Source: [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html)*

**Tracked Information per Comment:**
- **Author:** Username of comment submitter
  *Source: [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html)*
- **Timestamp:** When comment was posted
  *Source: [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html)*
- **Content:** Rich text (up to 4KB including formatting)
  *Source: [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html) - "4K in size (including formatting)"*
- **Format Support:** Embedded images, tables, rich formatting
- **Searchability:** Indexed for keyword searches
  *Source: [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html) - "indexed for keyword searches"*

**Display & Notification:**
- **Order:** Flat listing (not threaded), reverse chronological (newest first)
  *Source: [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html) - "flat listing of time-ordered comments"*
- **Icons:** Color-coded indicators on board cards
  - Dark blue = posted < 4 hours ago
  - Lighter shades = older posts
  *Source: [Using Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-pages-and-elements/detail-editor/using-the-detail-editor/use-discussions.html)*
- **Notifications:** Eligible for email alerts
  *Source: [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html) - "eligible for email notifications"*

**Important Limitations:**
- Comments are **not recoverable** from Recycle Bin once deleted
  *Source: [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html) - "not recoverable from the Recycle Bin once deleted"*
- **Copying work items does not copy discussions**
  *Source: [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html) - "Copying a work item does not copy related discussion comments"*

### Recent Activity App

Real-time dashboard showing all recent comments across the workspace.

*Source: [Recent Activity](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/reference/extending-rally-with-apps/app-catalog/recent-activity.html)*

**Displays:**
- ID, Name, Timestamp, Comment Author
- Details for each comment
- Sorted by time (most recent first)

*Source: [Recent Activity](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/reference/extending-rally-with-apps/app-catalog/recent-activity.html)*

---

## History Tracking Architecture Insights

### Dual-Level History System

Rally provides **two complementary** history mechanisms:

1. **Revision History (UI-focused):**
   - Human-readable revision numbers
   - Field-level change descriptions
   - Accessible via detail page ribbon
   - Supports copy/paste export workflows
   - Per-object access (one item at a time)

2. **Lookback API (Analytics-focused):**
   - Immutable snapshots with precise timestamps
   - Complete field state at each change
   - Previous values for transition detection
   - Queryable across many items simultaneously
   - Enables bulk historical analysis
   - Time-series calculations (cycle time, throughput)

*Source: [Revision History](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/additional-tracking-pages/view-revision-history.html) and [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/)*

### Who Changed What and When

**Complete Attribution:**
- Every change records the **author** (who)
- Timestamp is **GMT-based** (when, with precision to seconds)
- Changed fields recorded in `_PreviousValues` (what changed)
- Revision number provides sequence ordering (change order)

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) - "_User identifies who made edits, _RevisionNumber tracks the revision, _ValidFrom timestamp indicates precisely when changes occurred"*

### Design Pattern: Snapshot-Based History

Rather than storing "change records" or "diffs," Rally stores **complete snapshots** of each item at each change moment. This approach:
- Eliminates gaps in historical data
- Simplifies "what was the state on date X?" queries
- Enables time-travel to any point in history
- Supports deletion/restoration tracking

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/)*

### Audit Trail Immutability

- Revision History records cannot be edited or deleted
- Lookback snapshots are immutable (append-only)
- Comments can be deleted (not recoverable)
- Deletion itself is recorded as a snapshot state change

*Source: [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/) and [Discussions](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/using-rally/common-tasks/collaborate-with-team-members/discussions.html)*

---

## Implementation Plan: History Tracking for Our System

### Mapping Rally's Three-Layer History to Our Codebase

Rally's comprehensive history model maps directly onto infrastructure already built or designed in our system:

| Rally Layer | Our System Equivalent | Current Status |
|---|---|---|
| **Lookback API** (immutable state snapshots) | `item_state_history` table + future `events` table | ✓ Built & indexed; awaiting work-item tables |
| **Revision History** (field-level audit trail) | `events` table (JSONB diff in payload) | ◐ Designed in `feature_event_audit_log.md` Phase 0; not yet built |
| **Discussions & Comments** (collaborative activity) | Future `item_comments` table | ◐ Not yet designed; planned for Phase 3 |

*Source: Comparison with existing schema (`docs/c_schema.md`), `feature_event_audit_log.md` Phase 0–4, `backend/internal/audit/audit.go`, `docs/c_polymorphic_writes.md`*

### Phase 0: State History Activation (Dependency: Work-Item Tables)

**When:** After migration 017+ (work-item table definitions land)

**What:** Wire up the existing `item_state_history` table — currently built and indexed but dormant.

**Implementation:**

1. Add polymorphic dispatch trigger for `item_state_history` to migration 013, following the pattern established for `entity_stakeholders` and `item_type_states`
   - *Reference: `docs/c_polymorphic_writes.md` (dispatch trigger rules)*
   
2. Implement `InsertItemStateHistory(tx pgx.Tx, req InsertItemStateHistoryRequest) error` on `entityrefs.Service`
   - Takes open transaction (ACID with the state mutation)
   - Pre-flight `SELECT … FOR UPDATE` on parent item + subscription match validation
   - Validates transition legality via `item_type_transition_edges`
   - *Reference: `backend/internal/entityrefs/service.go`, pattern established by `InsertEntityStakeholder()`*

3. Register `item_state_history` in `CleanupChildren()` (deferred: soft-tombstone vs. hard-delete decision for history rows — currently trigger blocks all deletes)
   - *Reference: `docs/c_polymorphic_writes.md` (Rule 5: archive handlers must call CleanupChildren)*

**Result:** Rally's Lookback API equivalent — per-item immutable state timeline with complete attribution:
- `transitioned_by` (who moved it — UUID of user)
- `transitioned_at` (when — `clock_timestamp()`, server-side only)
- `from_state_id` / `to_state_id` (what changed — validated against legal transitions)
- Full queryability: "Show all items that moved to 'In Progress' between dates X and Y"

**Cycle time analysis enabled:**
```sql
SELECT 
  item_id,
  (SELECT transitioned_at FROM item_state_history 
   WHERE to_state_id = canonical_code_for('in_progress') 
   ORDER BY transitioned_at DESC LIMIT 1) as cycle_start,
  (SELECT transitioned_at FROM item_state_history 
   WHERE to_state_id = canonical_code_for('completed') 
   ORDER BY transitioned_at DESC LIMIT 1) as cycle_end
FROM work_items
```

---

### Phase 1: Full Field-Level History (The `events` Table)

**When:** Parallel to Phase 0 or immediately after

**What:** Implement the `events` table per `feature_event_audit_log.md` Phase 0 spec, adding Rally's Revision History equivalent (field-level `_PreviousValues` pattern).

**Schema:**
- **Partitioned by month** (`events_2026_04`, `events_2026_05`, etc.)
- **Core columns:** `id`, `subscription_id`, `entity_kind` (e.g. `item`, `user`, `workspace`), `entity_id` (polymorphic), `actor_id` (who — UUID), `event_type` (enum: `item.state_changed`, `item.field_updated`, `item.assigned`, `item.commented`), `payload` (JSONB), `occurred_at = clock_timestamp()`
- **Tamper evidence:** `prev_hash`, `row_hash`, `sequence_no` (per-tenant monotonic) — server-side trigger computes hash chain on insert
  - `row_hash = sha256(subscription_id || prev_hash || occurred_at || actor_id || event_type || entity_kind || entity_id || payload || sequence_no)`
- **Idempotency:** UNIQUE on `(subscription_id, idempotency_key)`
- **Traceability:** Optional `caused_by_event_id` for causation chains

*Reference: `feature_event_audit_log.md` Phase 0 "Tamper evidence and integrity" + "Details worth getting right early"*

**Go Writer Pattern:**
```go
// RecordEvent runs inside the state-change transaction (ACID with the mutation)
func (svc *ItemService) UpdateState(tx pgx.Tx, req UpdateStateRequest) error {
  // 1. Validate transition legal via item_type_transition_edges
  // 2. Update work_items.state_id and item_state_history
  // 3. Record the change in events table:
  err := svc.eventSvc.RecordEvent(tx, RecordEventRequest{
    SubscriptionID: req.SubscriptionID,
    EventType: "item.state_changed",
    EntityKind: "item",
    EntityID: req.ItemID,
    ActorID: req.UserID,
    Payload: map[string]any{
      "from_state": oldState.Name,
      "to_state": newState.Name,
      "canonical_from": oldState.CanonicalCode,
      "canonical_to": newState.CanonicalCode,
    },
    IdempotencyKey: generateIdempotencyKey(req), // prevents duplicate events
  })
  return err
}
```

**Key difference from Rally:** Instead of `_PreviousValues` object with every field that ever existed, our payload is a **diff** — only the changed fields. Example:
```json
{
  "changed_fields": {
    "assigned_to": {
      "from": "user-uuid-1",
      "to": "user-uuid-2"
    },
    "priority": {
      "from": "medium",
      "to": "high"
    }
  }
}
```

**PII Policy:** Never embed user names or emails in `payload`. Use UUIDs only; lookups against `users.id` happen at read time.
*Reference: `feature_event_audit_log.md` "Details worth getting right early" (PII policy section)*

**First Event Types:**
- `item.state_changed` — state transition (from/to state with canonical codes)
- `item.field_updated` — any other field change (diff in payload)
- `item.assigned` — assignment change (from/to user UUID)

Future: `item.commented`, `item.archived`, `item.unarchived`, etc.

**Result:** Rally's Revision History equivalent — queryable timeline of **every change** with complete attribution, enabling:
- Activity feed: `SELECT * WHERE entity_kind='item' AND entity_id=$1 ORDER BY occurred_at DESC LIMIT 50`
- Audit compliance: All changes tamper-evident via hash chain
- Time-series metrics: cycle time, lead time, WIP, throughput from events table joins

---

### Phase 2: Read-Side UI (Activity Panels & State Timeline)

**When:** After Phase 1 events table is populated

**What:** User-facing views of the history built in Phase 0 and Phase 1.

**Activity Panel on Item Detail Page:**
```sql
SELECT 
  e.event_type, e.actor_id, e.occurred_at, e.payload,
  u.display_name
FROM events e
LEFT JOIN users u ON e.actor_id = u.id
WHERE e.subscription_id = $1 
  AND e.entity_kind = 'item' 
  AND e.entity_id = $2
ORDER BY e.occurred_at DESC
LIMIT 50
```

Renders as: "[Jane Doe] moved [item] from [Defined] to [In Progress] on [2026-04-25 14:32]"

**State Timeline Chart:**
Join `item_state_history` → `item_type_states` → `canonical_states` to display:
- Vertical axis: time (hours/days)
- Horizontal axis: state
- Area under each state = time spent in that state
- Labels: cycle time (in_progress → completed), lead time (ready → accepted)

Matches Rally's "Cycle Time Chart on the Portfolio Kanban" UX pattern.

*Reference: [Rally Cycle Time Chart](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/portfolio-kanban-board/view-charts-on-the-portfolio-kanban/cycle-time-on-the-portfolio-kanban/using-the-cycle-time-chart-on-the-portfolio-kanban.html)*

---

### Phase 3: Comments & Discussions (Collaborative Activity Trail)

**When:** After Phase 2 (optional, if discussion feature ships)

**What:** Collaborative activity trail on work items (matches Rally's Discussions model).

**Schema: `item_comments` Table**
- `id` UUID PK
- `subscription_id` UUID (RESTRICT)
- `item_id` UUID (app-enforced FK to work_items)
- `item_type_kind` TEXT (CHECK: `portfolio`/`execution`)
- `author_id` UUID (RESTRICT to users.id)
- `body_text` TEXT (max 4KB, Markdown or rich text)
- `created_at` TIMESTAMPTZ (immutable, `clock_timestamp()`)
- `deleted_at` TIMESTAMPTZ (soft-delete — never hard-delete per regulatory framing)
- Indexes: `(subscription_id, item_id, created_at)`, `(subscription_id, created_at)` for activity feeds

**Write Path:**
Each comment also fires an event:
```go
func (svc *ItemService) AddComment(tx pgx.Tx, req AddCommentRequest) error {
  // 1. Insert into item_comments
  // 2. Record event:
  svc.eventSvc.RecordEvent(tx, RecordEventRequest{
    EventType: "item.commented",
    EntityKind: "item",
    EntityID: req.ItemID,
    ActorID: req.UserID,
    Payload: map[string]any{
      "comment_id": commentID,
      "body_length": len(req.Body),
      "mentions": extractedMentions, // can fire @user notifications
    },
  })
}
```

**Read Side:**
- Display comments sorted by `created_at DESC` (newest first)
- Color-coded staleness badge on board cards (dark blue if < 4h old, lighter if older)
  *Matches Rally's discussion icon UX: "Discussion icons found on cards within board-style apps change color depending on the time the last comment was posted"*

---

### What We Intentionally Exclude from Rally's Model

**Multiple Estimation Types** (Preliminary/Refined/Plan):
- Rally tracks 3 estimation methods on Portfolio Items to handle different audiences (leadership vs. execution).
- **Our system:** Single `estimate` field per item avoids complexity. If needed, future: `estimate_confidence` enum (`low`/`medium`/`high`) instead.

**18 Rollup Fields on Portfolio Items:**
- Rally automatically calculates: Accepted counts, story point totals, defect aggregations, leaf story counts, estimated vs. actual divergence.
- **Our system:** Portfolio-level aggregations are deferred; calculated on-read via `SUM(item.estimate) WHERE item.state IN (...)` queries. If performance becomes an issue, add materialized view (`portfolio_metrics_daily`) later.

**Separate Revision Number UI Field:**
- Rally displays a human-readable Revision # on the detail page.
- **Our system:** Use `events.sequence_no` (per-subscription monotonic int) as the identifier in URLs / queries. If UI wants to display it, no extra DB column needed.

**Subscription/Workspace-Level Revision History Pages:**
- Rally has separate audit history views for Project, Workspace, and Subscription.
- **Our system:** Single `/admin/activity` feed (filterable by entity_kind, date range, actor) serves all audit needs.

---

### Critical Constraints

**1. Transaction Safety (Non-Negotiable)**
- All history writes must use `pgx.Tx` and run **inside the same transaction** as the state mutation.
- ❌ **Do NOT use** `audit.Logger.Log(ctx, ...)` pattern (uses `pool.Exec`, fire-and-forget, errors discarded).
- ✓ **Do USE:** `eventSvc.RecordEvent(tx, ...)` injected into service constructors.
- *Reference: `backend/internal/audit/audit.go` (shows anti-pattern) vs. `feature_event_audit_log.md` Phase 0*

**2. PII Never in Payloads**
- Event payloads must never contain user names, emails, or other PII.
- ✓ Use UUIDs only: `{"assigned_to": "uuid-1234-..."}` + lookup at read time.
- ❌ Never: `{"assigned_to_name": "Jane Doe", "assigned_to_email": "jane@example.com"}`.
- *Reference: `feature_event_audit_log.md` "Details worth getting right early" (PII tokenisation table)*

**3. Append-Only is Enforced, Not Honored**
- `item_state_history` and `events` use **DB triggers** that raise `check_violation` on UPDATE/DELETE.
- DBA `ALTER TABLE … DISABLE TRIGGER` is the only override (audit trail itself records this).
- Never rely on application-layer conventions for compliance.
- *Reference: `docs/c_c_schema_history.md` (append-only trigger pattern)*

**4. State Transition Validation is the Gate**
- Before inserting an `item_state_history` row, validate the transition is legal via `item_type_transition_edges`.
- ✓ Query: `SELECT 1 FROM item_type_transition_edges WHERE (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id) = ($1, $2, $3, $4, $5)`.
- Reject if no row found.
- *Reference: `docs/c_c_schema_states.md` (item_type_transition_edges table)*

**5. Subscription Isolation (Every Row)**
- Every row in `events` and `item_state_history` must include `subscription_id`.
- Queries **always** filter by `subscription_id` first (prevents cross-tenant leaks).
- Indexes lead with `subscription_id`.
- *Reference: `docs/c_polymorphic_writes.md` (Rule 3)*

---

### Mapping to Our Go Architecture

**Service Pattern (current):**
```go
// TODAY: auth/service.go
audit.Log(ctx, Entry{UserID: userID, Action: "auth.login", ...})
// Problem: pool.Exec (standalone), no transaction, errors ignored
```

**Service Pattern (post-Phase 1):**
```go
// FUTURE: items/service.go
func (svc *ItemService) UpdateState(tx pgx.Tx, req UpdateStateRequest) error {
  // 1. Mutate state
  err := svc.repo.UpdateItemState(tx, req.ItemID, req.NewStateID)
  if err != nil { return err }
  
  // 2. Record in same transaction
  err = svc.events.RecordEvent(tx, RecordEventRequest{
    SubscriptionID: req.SubscriptionID,
    EventType: "item.state_changed",
    EntityKind: "item",
    EntityID: req.ItemID,
    ActorID: req.UserID,
    Payload: diffPayload,
  })
  return err
}
```

Constructor injection:
```go
svc := &ItemService{
  repo: itemRepo,
  events: eventsService,  // NEW
  stateValidator: stateValidator,
}
```

*Reference: `backend/internal/entityrefs/service.go` (pattern established)*

---

### Why This Maps to Rally

**State Transition Tracking:**
- Rally's `_SnapshotNumber` → our `sequence_no` (per-tenant monotonic int)
- Rally's `_ValidFrom` / `_ValidTo` → our `events.occurred_at` (server-side, GMT)
- Rally's `_User` → our `actor_id` (UUID)
- Rally's `_PreviousValues` → our `events.payload` (JSONB diff, smaller than before+after)

**Lookback API Equivalent:**
- Rally's query: `{"_PreviousValues.ScheduleState": {"$lt": "Completed"}, "ScheduleState": {"$gte": "Completed"}}`
- Our query: `SELECT * FROM events WHERE payload->'changed_fields'->>'to_state' = 'in_progress'` (plus optional timestamp range)

**Revision History Equivalent:**
- Rally displays: "Revision 42 on [date] by [user]: State changed from Defined to In Progress"
- Our display: `SELECT sequence_no, occurred_at, actor_id, payload FROM events WHERE entity_id = $1 ORDER BY occurred_at DESC` → render similarly

**Immutability Guarantee:**
- Rally: append-only snapshots, UPDATE/DELETE blocked
- Our system: append-only triggers, UPDATE/DELETE blocked
- Both: regulatory-compliant audit trail

---

## Sources & References

- [Rally Web Services API Documentation](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/reference/rally-web-services-api.html)
- [Rally Lookback API](https://rally1.rallydev.com/analytics/doc/)
- [Portfolio Item Types](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/administration/managing-your-workspace/customizing-portfolio-item-types/portfolio-item-types.html)
- [Portfolio Item Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/managing-portfolio-items/portfolio-item-planning/creating-portfolio-items/portfolio-item-fields.html)
- [User Story Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/user-stories/user-story-fields.html)
- [Defect Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-defects-and-defect-suites/defects/defect-fields.html)
- [Task Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/defining-tasks/task-fields.html)
- [Test Case Fields](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/testing/managing-tests/manage-test-cases/test-case-fields.html)
- [Building Your Backlog](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog.html)
- [Portfolio Kanban Board](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/portfolio-kanban-board.html)
- [Flow-Based Planning](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/planning-with-flow-based-kanban-boards/flow-based-planning.html)
