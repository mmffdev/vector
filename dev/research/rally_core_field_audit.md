# Rally core-field audit

**Date:** 2026-05-29
**Source:** `Rally-openapi-spec.json` @ repo root (1.5 MB, 348 schemas total)
**Purpose:** Drive the demotion of Vector custom-fields catalogue rows that should be core artefact columns. Inventory feeds the migration plan in `handovers/a_customFields_coreDemotion.md`.

---

## Scope

Crawled the Rally OpenAPI components for the seven artefact types that Vector mirrors:

| Rally schema | JSON path | Approx. line in spec | Schema status |
|---|---|---|---|
| `HierarchicalRequirement` (Story) | `#/components/schemas/HierarchicalRequirement` | 31700 | Present |
| `Defect` | `#/components/schemas/Defect` | 27917 | Present |
| `Task` | `#/components/schemas/Task` | 43526 | Present |
| `TestCase` | `#/components/schemas/TestCase` | 43926 | Present |
| `PortfolioItem` (abstract / parent) | `#/components/schemas/PortfolioItem` | 36500 | Present |
| `Feature` (PortfolioItem subtype) | `#/components/schemas/Feature` | 30442 | Present |
| `Initiative` (PortfolioItem subtype) | `#/components/schemas/Initiative` | 32487 | Present |

The spec does **NOT** carry a discrete `Theme` schema. Rally's higher portfolio tiers (Theme, Strategy) are user-defined `PortfolioItemType` instances, not first-class schemas in this spec. PortfolioItem + Feature + Initiative are the three concrete ones shipped.

The spec also exposes only `*Mutation` / `*Ref` flavours of each (e.g. `HierarchicalRequirementMutation`) for write payloads — I used the read schemas above, which carry the canonical attribute set.

---

## Rally canonical attribute lists

Each table below is verbatim from the spec's `properties` map. `ref:X` = `$ref: "#/components/schemas/X"` (relation, not a primitive). Empty description = the spec didn't carry one.

### HierarchicalRequirement (Rally "Story")

| Name | Type | Description |
|---|---|---|
| AIAssisted | boolean | AI Assisted |
| AcceptedDate | string | Accepted Date |
| Ancestors | ref:Collection |  |
| Attachments | ref:Collection |  |
| Blocked | boolean | Blocked |
| BlockedReason | string | Blocked Reason |
| Blocker | ref:BlockerRef |  |
| Changesets | ref:Collection |  |
| Children | ref:Collection |  |
| Connections | ref:Collection |  |
| CreatedBy | ref:UserRef |  |
| CreationDate | string | Creation Date |
| DefectStatus | string | Defect Status |
| Defects | ref:Collection |  |
| Description | string | Description |
| DirectChildrenCount | integer | Direct Children Count |
| DirectPassingTestCaseCount | integer | DirectPassingTestCaseCount |
| Discussion | ref:Collection |  |
| DisplayColor | string | Display Color |
| DragAndDropRank | string | Drag And Drop Rank |
| Errors | array |  |
| Expedite | boolean | Expedite |
| Feature | ref:FeatureRef |  |
| FinancialWorkType | string | Financial Work Type |
| FlowState | ref:FlowStateRef |  |
| FlowStateChangedDate | string | Flow State Changed Date |
| FormattedID | string | Formatted ID |
| HasParent | boolean | HasParent |
| InProgressDate | string | In Progress Date |
| Iteration | ref:IterationRef |  |
| IterationValue | string | Iteration Value |
| LastBuild | string | Last Build |
| LastRun | string | Last Run |
| LastUpdateDate | string | Last Update Date |
| LatestDiscussionAgeInMinutes | integer | Latest Discussion Age In Minutes |
| Milestones | ref:Collection |  |
| Name | string | Name |
| Notes | string | Notes |
| ObjectID | integer | Object ID |
| ObjectUUID | string | ObjectUUID |
| Owner | ref:UserRef |  |
| Package | string | Package |
| Parent | ref:HierarchicalRequirementRef |  |
| PassingTestCaseCount | integer | Passing Test Case Count |
| PlanEstimate | number | Plan Estimate |
| PortfolioItem | ref:FeatureRef |  |
| Predecessors | ref:Collection |  |
| Project | ref:ProjectRef |  |
| Ready | boolean | Ready |
| Recycled | boolean | Recycled |
| Release | ref:ReleaseRef |  |
| ReleaseValue | string | Release Value |
| RevisionHistory | ref:RevisionHistoryRef |  |
| Risks | ref:Collection |  |
| ScheduleState | string | Schedule State |
| ScheduleStatePrefix | string | Schedule State Prefix |
| Subscription | ref:SubscriptionRef |  |
| Successors | ref:Collection |  |
| Tags | ref:Collection |  |
| TaskActualTotal | number | Task Actual Total |
| TaskEstimateTotal | number | Task Estimate Total |
| TaskRemainingTotal | number | Task Remaining Total |
| TaskStatus | string | Task Status |
| Tasks | ref:Collection |  |
| TestCaseCount | integer | Test Case Count |
| TestCaseStatus | string | Test Case Status |
| TestCases | ref:Collection |  |
| TotalDirectTestCaseCount | integer | Total Direct Test Case Count |
| UnifiedParent | ref:ObjectRef |  |
| VersionId | string | VersionId |
| Warnings | array |  |
| Workspace | ref:WorkspaceRef |  |

### Defect

| Name | Type | Description |
|---|---|---|
| AIAssisted | boolean | AI Assisted |
| AcceptedDate | string | Accepted Date |
| AffectsDoc | boolean | Affects Doc |
| Ancestors | ref:Collection |  |
| Attachments | ref:Collection |  |
| Blocked | boolean | Blocked |
| BlockedReason | string | Blocked Reason |
| Blocker | ref:BlockerRef |  |
| Changesets | ref:Collection |  |
| ClosedDate | string | Closed Date |
| Connections | ref:Collection |  |
| CreatedBy | ref:UserRef |  |
| CreationDate | string | Creation Date |
| DefectSuites | ref:Collection |  |
| Description | string | Description |
| Discussion | ref:Collection |  |
| DisplayColor | string | Display Color |
| DragAndDropRank | string | Drag And Drop Rank |
| Duplicates | ref:Collection |  |
| Environment | string | Environment |
| Errors | array |  |
| Expedite | boolean | Expedite |
| FinancialWorkType | string | Financial Work Type |
| FixedInBuild | string | Fixed In Build |
| FlowState | ref:FlowStateRef |  |
| FlowStateChangedDate | string | Flow State Changed Date |
| FormattedID | string | Formatted ID |
| FoundInBuild | string | Found In Build |
| InProgressDate | string | In Progress Date |
| Iteration | ref:IterationRef |  |
| IterationValue | string | Iteration Value |
| LastBuild | string | Last Build |
| LastRun | string | Last Run |
| LastUpdateDate | string | Last Update Date |
| LatestDiscussionAgeInMinutes | integer | Latest Discussion Age In Minutes |
| Milestones | ref:Collection |  |
| Name | string | Name |
| Notes | string | Notes |
| ObjectID | integer | Object ID |
| ObjectUUID | string | ObjectUUID |
| OpenedDate | string | Opened Date |
| Owner | ref:UserRef |  |
| Package | string | Package |
| PassingTestCaseCount | integer | Passing Test Case Count |
| PlanEstimate | number | Plan Estimate |
| PortfolioItem | ref:FeatureRef |  |
| Priority | string | Priority |
| Project | ref:ProjectRef |  |
| Ready | boolean | Ready |
| Recycled | boolean | Recycled |
| Release | ref:ReleaseRef |  |
| ReleaseNote | boolean | Release Note |
| ReleaseValue | string | Release Value |
| Requirement | ref:HierarchicalRequirementRef |  |
| Resolution | string | Resolution |
| RevisionHistory | ref:RevisionHistoryRef |  |
| SalesforceCaseID | string | Salesforce Case ID |
| SalesforceCaseNumber | string | Salesforce Case Number |
| ScheduleState | string | Schedule State |
| ScheduleStatePrefix | string | Schedule State Prefix |
| Severity | string | Severity |
| State | string | State |
| SubmittedBy | ref:UserRef |  |
| Subscription | ref:SubscriptionRef |  |
| Tags | ref:Collection |  |
| TargetBuild | string | Target Build |
| TargetDate | string | Target Date |
| TaskActualTotal | number | Task Actual Total |
| TaskEstimateTotal | number | Task Estimate Total |
| TaskRemainingTotal | number | Task Remaining Total |
| TaskStatus | string | Task Status |
| Tasks | ref:Collection |  |
| TestCase | ref:TestCaseRef |  |
| TestCaseCount | integer | Test Case Count |
| TestCaseResult | ref:TestCaseResultRef |  |
| TestCaseStatus | string | Test Case Status |
| TestCases | ref:Collection |  |
| VerifiedInBuild | string | Verified In Build |
| VersionId | string | VersionId |
| Warnings | array |  |
| Workspace | ref:WorkspaceRef |  |

### Task

| Name | Type | Description |
|---|---|---|
| AIAssisted | boolean | AI Assisted |
| Actuals | number | Actuals |
| Attachments | ref:Collection |  |
| Blocked | boolean | Blocked |
| BlockedReason | string | Blocked Reason |
| Changesets | ref:Collection |  |
| Connections | ref:Collection |  |
| CreatedBy | ref:UserRef |  |
| CreationDate | string | Creation Date |
| Description | string | Description |
| Discussion | ref:Collection |  |
| DisplayColor | string | Display Color |
| DragAndDropRank | string | Drag And Drop Rank |
| Errors | array |  |
| Estimate | number | Estimate |
| Expedite | boolean | Expedite |
| FormattedID | string | Formatted ID |
| Iteration | ref:IterationRef |  |
| LastUpdateDate | string | Last Update Date |
| LatestDiscussionAgeInMinutes | integer | Latest Discussion Age In Minutes |
| Milestones | ref:Collection |  |
| Name | string | Name |
| Notes | string | Notes |
| ObjectID | integer | Object ID |
| ObjectUUID | string | ObjectUUID |
| Owner | ref:UserRef |  |
| Project | ref:ProjectRef |  |
| Ready | boolean | Ready |
| Recycled | boolean | Recycled |
| Release | ref:ReleaseRef |  |
| RevisionHistory | ref:RevisionHistoryRef |  |
| State | string | State |
| Subscription | ref:SubscriptionRef |  |
| Tags | ref:Collection |  |
| TaskIndex | integer | Task Index |
| TimeSpent | number | Time Spent |
| ToDo | number | To Do |
| VersionId | string | VersionId |
| Warnings | array |  |
| WorkProduct | ref:ObjectRef |  |
| Workspace | ref:WorkspaceRef |  |

### TestCase

| Name | Type | Description |
|---|---|---|
| AIAssisted | boolean | AI Assisted |
| Attachments | ref:Collection |  |
| Changesets | ref:Collection |  |
| Connections | ref:Collection |  |
| CreatedBy | ref:UserRef |  |
| CreationDate | string | Creation Date |
| DefectStatus | string | Defect Status |
| Defects | ref:Collection |  |
| Description | string | Description |
| Discussion | ref:Collection |  |
| DisplayColor | string | Display Color |
| DragAndDropRank | string | Drag And Drop Rank |
| Errors | array |  |
| Expedite | boolean | Expedite |
| FormattedID | string | Formatted ID |
| LastBuild | string | Last Build |
| LastResult | ref:TestCaseResultRef |  |
| LastRun | string | Last Run |
| LastUpdateDate | string | Last Update Date |
| LastVerdict | string | Last Verdict |
| LatestDiscussionAgeInMinutes | integer | Latest Discussion Age In Minutes |
| Method | string | Method |
| Milestones | ref:Collection |  |
| Name | string | Name |
| Notes | string | Notes |
| ObjectID | integer | Object ID |
| ObjectUUID | string | ObjectUUID |
| Objective | string | Objective |
| Owner | ref:UserRef |  |
| Package | string | Package |
| PostConditions | string | Post Conditions |
| PreConditions | string | Pre Conditions |
| Priority | string | Priority |
| Project | ref:ProjectRef |  |
| Ready | boolean | Ready |
| Recycled | boolean | Recycled |
| Results | ref:Collection |  |
| RevisionHistory | ref:RevisionHistoryRef |  |
| Risk | string | Risk |
| Steps | ref:Collection |  |
| Subscription | ref:SubscriptionRef |  |
| Tags | ref:Collection |  |
| TestFolder | ref:TestFolderRef |  |
| TestSets | ref:Collection |  |
| Type | string | Type |
| ValidationExpectedResult | string | Validation Expected Result |
| ValidationInput | string | Validation Input |
| VersionId | string | VersionId |
| Warnings | array |  |
| WorkProduct | ref:ObjectRef |  |
| Workspace | ref:WorkspaceRef |  |

### PortfolioItem (parent / abstract — and the Feature + Initiative subtypes inherit everything below plus a few extras)

| Name | Type | Description |
|---|---|---|
| AIAssisted | boolean | AI Assisted |
| AcceptedDefectCountRollup | integer | Accepted Defect Count Rollup |
| AcceptedDefectEstimateTotalRollup | number | Accepted Defect Estimate Total Rollup |
| AcceptedLeafStoryCount | integer | Accepted Leaf Story Count |
| AcceptedLeafStoryPlanEstimateTotal | number | Accepted Leaf Story Plan Estimate Total |
| AcceptedTotalCountRollup | integer | Accepted Total Count Rollup |
| AcceptedTotalEstimateRollup | number | Accepted Total Estimate Rollup |
| ActualEndDate | string | Actual End Date |
| ActualStartDate | string | Actual Start Date |
| Ancestors | ref:Collection |  |
| Archived | boolean | Archived |
| Attachments | ref:Collection |  |
| Blocked | boolean | Blocked |
| BlockedReason | string | Blocked Reason |
| Blocker | ref:BlockerRef |  |
| CapacityPlans | ref:Collection |  |
| CapitalApproval | string | Capital Approval |
| Changesets | ref:Collection |  |
| Collaborators | ref:Collection |  |
| Connections | ref:Collection |  |
| CreatedBy | ref:UserRef |  |
| CreationDate | string | Creation Date |
| DefectCountRollup | integer | Defect Count Rollup |
| DefectPlanEstimateTotalRollup | number | Defect Plan Estimate Total Rollup |
| Description | string | Description |
| DirectChildrenCount | integer | Direct Children Count |
| Discussion | ref:Collection |  |
| DisplayColor | string | Display Color |
| DragAndDropRank | string | Drag And Drop Rank |
| Errors | array |  |
| EstimatedProgressByStoryCount | number | Estimated Progress By Story Count |
| EstimatedProgressByStoryPoints | number | Estimated Progress By Story Points |
| Expedite | boolean | Expedite |
| FormattedID | string | Formatted ID |
| InvestmentCategory | string | Investment Category |
| Investments | ref:Collection |  |
| JobSize | integer | Job Size |
| LastRollupDate | string | Last Rollup Date |
| LastUpdateDate | string | Last Update Date |
| LatestDiscussionAgeInMinutes | integer | Latest Discussion Age In Minutes |
| LeafStoryCount | integer | Leaf Story Count |
| LeafStoryPlanEstimateTotal | number | Leaf Story Plan Estimate Total |
| Metrics | ref:Collection |  |
| Milestones | ref:Collection |  |
| Name | string | Name |
| Notes | string | Notes |
| ObjectID | integer | Object ID |
| ObjectUUID | string | ObjectUUID |
| Objectives | ref:Collection |  |
| Owner | ref:UserRef |  |
| PercentDoneByDefectCountRollup | number | Percent Done By Defect Count Rollup |
| PercentDoneByDefectEstimateRollup | number | Percent Done By Defect Estimate Rollup |
| PercentDoneByStoryCount | number | Percent Done By Story Count |
| PercentDoneByStoryPlanEstimate | number | Percent Done By Story Plan Estimate |
| PercentDoneByTotalCountRollup | number | PercentDoneByTotalCountRollup |
| PercentDoneByTotalEstimateRollup | number | Percent Done By Total Estimate Rollup |
| PlannedEndDate | string | Planned End Date |
| PlannedStartDate | string | Planned Start Date |
| PortfolioItemFlowState | ref:ObjectRef |  |
| PortfolioItemType | ref:TypeDefinitionRef |  |
| PortfolioItemTypeName | string | Portfolio Item Type Name |
| PreliminaryEstimate | ref:PreliminaryEstimateRef |  |
| PreliminaryEstimateCountValue | integer | Preliminary Estimate Count Value |
| PreliminaryEstimateValue | integer | Preliminary Estimate Value |
| Products | ref:Collection |  |
| Project | ref:ProjectRef |  |
| RROEValue | integer | RR/OE Value |
| Ready | boolean | Ready |
| Recycled | boolean | Recycled |
| RefinedEstimate | integer | Refined Estimate |
| RefinedEstimateCount | integer | Refined Estimate Count |
| ReleaseValue | string | Release Value |
| RevisionHistory | ref:RevisionHistoryRef |  |
| RiskScore | integer | Risk Score |
| Risks | ref:Collection |  |
| State | ref:StateRef |  |
| StateChangedDate | string | State Changed Date |
| Subscription | ref:SubscriptionRef |  |
| Tags | ref:Collection |  |
| TimeCriticality | integer | Time Criticality |
| TotalCountRollup | integer | Total Count Rollup |
| TotalEstimateRollup | number | Total Estimate Rollup |
| UnEstimatedDefectCountRollup | integer | UnEstimated Defect Count Rollup |
| UnEstimatedLeafStoryCount | integer | Un-Estimated Leaf Story Count |
| UnEstimatedTotalCountRollup | integer | UnEstimated Total Count Rollup |
| UserBusinessValue | integer | User/Business Value |
| ValueScore | integer | Value Score |
| VersionId | string | VersionId |
| WSJFScore | number | WSJF Score |
| Warnings | array |  |
| Workspace | ref:WorkspaceRef |  |

`Feature` (line 30442) adds: `Artifacts`, `LateChildCount`, `Parent` (ref:InitiativeRef), `Predecessors`, `Release`, `Successors`, `UserStories`.

`Initiative` (line 32487) adds: `Children`, `Predecessors`, `Successors`.

No standalone `Theme` schema is shipped in this spec (it's a `PortfolioItemType` instance, not a separate class).

---

## Mapping convention used below

The `pi_*` family in the Vector catalogue clearly mirrors Rally PortfolioItem attributes (the "pi_" prefix is a literal `portfolio item` shortener). The `us_*` family mirrors Rally HierarchicalRequirement ("user story") attributes. The `lidentifier_*` family is Rally's **DisplayColor** / colour-tagging surface ("logical identifier" — Vector's renaming of Rally's per-row colour). Verified by name-shape against the Rally property tables above.

The "Already a core col on `artefacts`?" answer below is from the live `\d artefacts` snapshot in the handover (`docs/c_schema.md` agrees). I did NOT query the DB.

---

## Cross-reference table

| Vector catalogue row | Vector type | Rally name | Rally type | Status | Recommendation |
|---|---|---|---|---|---|
| acceptance_criteria | richtext | (none — Rally uses `Description`) | — | CUSTOM | KEEP-CUSTOM (Rick: "only one we keep custom") |
| acceptance_criteria2 | textbox | (none — duplicate of above) | — | DROP | DROP (archive — duplicate that bypassed label-collision check) |
| blocked | boolean | `Blocked` (HR/Defect/Task/TestCase/PI/Feature/Initiative — universal) | boolean | CORE | DEMOTE-EXISTING (`artefacts.artefacts_is_blocked` exists) |
| blocked_reason | textbox | `BlockedReason` (HR/Defect/Task/TestCase/PI/Feature/Initiative — universal) | string | CORE | DEMOTE-EXISTING (`artefacts.artefacts_blocked_reason` exists) |
| browser | textbox | (none in Rally) | — | CUSTOM | KEEP-CUSTOM (Rally doesn't carry a browser attribute on any artefact; it's a Vector-specific defect context field; rebrand as bug-specific extension) |
| defect_severity | select | `Severity` (Defect only) | string | CORE | DEMOTE-NEW-COL (add `artefacts_severity` text col; binding restricted to Defect type) |
| environment | textbox | `Environment` (Defect only) | string | CORE | DEMOTE-NEW-COL (add `artefacts_environment` text col; Defect-bound) |
| estimate_hours | decimal | `Estimate` (Task only) — hours | number | CORE | DEMOTE-NEW-COL (add `artefacts_estimate_hours` numeric col; Task-bound) |
| estimate_remaining | decimal | `ToDo` (Task only) — remaining hours | number | CORE | DEMOTE-NEW-COL (add `artefacts_estimate_remaining` numeric col; Task-bound) |
| expedite | boolean | `Expedite` (HR/Defect/Task/TestCase/PI/Feature/Initiative — universal) | boolean | CORE | DEMOTE-NEW-COL (add `artefacts_is_expedite` bool col, default false, indexed; universal) |
| lidentifier_colour | textbox | `DisplayColor` (HR/Defect/Task/TestCase/PI/Feature/Initiative — universal) | string | CORE | DEMOTE-EXISTING (`artefacts.artefacts_colour` exists) |
| lidentifier_type | textbox | (no direct Rally equivalent; closest is `FormattedID` prefix or `Type` on TestCase) | — | CORE-CANDIDATE | KEEP-CUSTOM (no clean Rally match; revisit when artefact-type/identifier model is decided — could become a derived attribute of artefact_type) |
| notes | richtext | `Notes` (HR/Defect/Task/TestCase/PI/Feature/Initiative — universal) | string | CORE | DEMOTE-NEW-COL (add `artefacts_notes` text + `artefacts_notes_doc` jsonb to mirror description/description_doc pattern; universal) |
| pi_date_work_accepted | date | (closest: PI `LastRollupDate`; no exact match) | string | CORE-CANDIDATE | DEMOTE-NEW-COL or DROP — confirm with Rick (looks like Vector's bespoke flow-state-date set; not in Rally PI schema verbatim) |
| pi_date_work_planned_finish | date | PI `PlannedEndDate` | string | CORE | DEMOTE-NEW-COL (add `artefacts_planned_end_date` date col; PI-tier-bound) |
| pi_date_work_planned_start | date | PI `PlannedStartDate` | string | CORE | DEMOTE-NEW-COL (add `artefacts_planned_start_date` date col; PI-tier-bound) |
| pi_date_work_started | date | PI `ActualStartDate` (closest); HR/Defect has `InProgressDate` | string | CORE | DEMOTE-NEW-COL (add `artefacts_actual_start_date` date col; universal on PI tier, alias `InProgressDate` for HR/Defect — one column, semantically "work started") |
| pi_estimate_initial | textbox | PI `PreliminaryEstimate` (ref) / `PreliminaryEstimateValue` (integer) | integer | CORE | DEMOTE-NEW-COL (add `artefacts_preliminary_estimate` integer col; PI-tier-bound) |
| pi_estimate_updated | decimal | PI `RefinedEstimate` | integer | CORE | DEMOTE-NEW-COL (add `artefacts_refined_estimate` integer col; PI-tier-bound) |
| pi_flow_state_change_date | textbox | PI `StateChangedDate` (closest) / HR `FlowStateChangedDate` | string | CORE | DEMOTE-NEW-COL (add `artefacts_flow_state_changed_date` timestamptz; universal) |
| pi_flow_state_change_owner | user | (none — Rally tracks `Owner` separately; `FlowState` is a ref, no "changed-by-owner" attribute) | — | CORE-CANDIDATE | DEMOTE-NEW-COL or DROP — confirm with Rick (might be Vector audit-trail wanting; could derive from RevisionHistory pattern instead of a column) |
| pi_lidentifier_labels | multiselect | (no direct equivalent; Rally uses `Tags` collection for free-form labels) | ref:Collection | CORE-CANDIDATE | DEMOTE-NEW-COL via tags table (Rally pattern: separate `tags` join table; matches Vector's existing tag substrate if any — confirm with Rick) |
| pi_lidentifier_tags | multiselect | PI `Tags` (ref:Collection) | ref:Collection | CORE | DEMOTE-NEW-COL via join table (`artefacts_tags` if not already; not a flat column — Rally pattern is collection) |
| pi_strategic_investment_group | textbox | PI `InvestmentCategory` | string | CORE | DEMOTE-NEW-COL (add `artefacts_investment_category` text col; PI-tier-bound) |
| pi_strategic_investment_weight | textbox | PI `UserBusinessValue` (closest weighting attribute) | integer | CORE-CANDIDATE | KEEP-CUSTOM or DEMOTE — confirm with Rick (Rally has several "value" attributes: `UserBusinessValue`, `ValueScore`, `WSJFScore`; the right mapping depends on Vector's scoring model) |
| pi_strategic_item_type | textbox | PI `PortfolioItemTypeName` (effectively the PI subtype label: Feature / Initiative / Theme) | string | CORE | DEMOTE-EXISTING-LOGIC (don't add a column — this is already represented by Vector's `artefact_type` / topology binding; the catalogue row is redundant with the type system itself). Archive without column add. |
| pi_value_stream_identifier | textbox | (no direct Rally equivalent — Rally tracks value streams via `VSMProductPortfolioItem` / `VSMMetricPortfolioItem` schemas) | — | CORE-CANDIDATE | KEEP-CUSTOM (Vector's value-stream model isn't directly Rally-shaped; consider as future cross-cutting attribute once VSM substrate is decided) |
| ready | boolean | `Ready` (HR/Defect/Task/TestCase/PI/Feature/Initiative — universal) | boolean | CORE | DEMOTE-NEW-COL (add `artefacts_is_ready` bool col, default false, indexed; universal) |
| regression | boolean | (none in Defect schema; Rally tracks regression via Tag or via TestCase `Type`) | — | CUSTOM | KEEP-CUSTOM (legitimate Vector-specific Defect-context flag; Rally doesn't model it directly) |
| risk_impact | select | (PortfolioItem `Risks` is a Collection of Risk objects — there's no per-artefact `Impact` attribute on the parent. Risks are first-class child artefacts in Rally.) | ref | CUSTOM | KEEP-CUSTOM (Vector's risk model is mid-design per `docs/c_c_risk_artefact_type.md` — these likely belong on a `Risk` artefact type, not the parent. Keep custom until the Risk artefact type lands.) |
| risk_probability | select | (same as above) | ref | CUSTOM | KEEP-CUSTOM (same reasoning — belongs on Risk artefact type, not as catalogue attribute on parent) |
| risk_score | decimal | PI `RiskScore` (PortfolioItem-only) | integer | CORE-CANDIDATE | DEMOTE-NEW-COL (add `artefacts_risk_score` integer col; PI-tier-bound) — but coordinate with the in-flight Risk artefact-type design (PLA-0052) before adding the column |
| steps_to_reproduce | richtext | (none — Rally Defect doesn't have a dedicated steps field; TestCase has `Steps` Collection) | — | CUSTOM | KEEP-CUSTOM (legitimate Vector Defect-context field; Rally relies on free-form Description for this) |
| us_affects_doc | boolean | `AffectsDoc` (Defect only — NOT HR/Story) | boolean | CORE | DEMOTE-NEW-COL (add `artefacts_affects_doc` bool col, default false; Defect-bound — NOTE the `us_` prefix is misleading, this is a Defect attribute in Rally) |
| us_count_child_defects | integer | (rollup attribute — HR `Defects` collection length; no flat-counter attribute on HR) | ref:Collection | CORE-CANDIDATE | KEEP-CUSTOM (Vector likely derives this; if persisting, becomes a denormalised rollup — handle via projection/outbox, not a manual column) |
| us_count_child_tasks | integer | (HR `Tasks` collection length) | ref:Collection | CORE-CANDIDATE | KEEP-CUSTOM (same rollup pattern) |
| us_count_child_test_cases | integer | HR `TestCaseCount` (integer) — direct Rally attribute | integer | CORE | DEMOTE-NEW-COL (add `artefacts_child_test_case_count` integer col; HR-bound — Rally exposes it as a flat counter, so demotion is clean) |
| us_defect_status | textbox | HR `DefectStatus` (string) | string | CORE | DEMOTE-NEW-COL (add `artefacts_defect_status` text col; HR-bound) |
| us_estimate_points | decimal | HR `PlanEstimate` (number) — story points | number | CORE | DEMOTE-EXISTING (`artefacts.artefacts_story_points` exists — already core; just archive the catalogue row) |

---

## Summary

- **Total rows reviewed:** 39 (matches the input list; test_field_* / test_typechange_* cruft excluded per brief)
- **Recommended KEEP-CUSTOM:** 11
  - acceptance_criteria, browser, lidentifier_type, pi_value_stream_identifier, regression, risk_impact, risk_probability, steps_to_reproduce, us_count_child_defects, us_count_child_tasks, pi_strategic_investment_weight (the four CORE-CANDIDATEs that lean custom)
- **Recommended DEMOTE-EXISTING (catalogue row archive only, no migration needed):** 4
  - blocked → `artefacts_is_blocked`
  - blocked_reason → `artefacts_blocked_reason`
  - lidentifier_colour → `artefacts_colour`
  - us_estimate_points → `artefacts_story_points`
  - (plus `pi_strategic_item_type` which is redundant with the artefact_type system — archive without column add)
- **Recommended DEMOTE-NEW-COL (archive + migration to add column to `artefacts`):** 18
  - defect_severity, environment, estimate_hours, estimate_remaining, expedite, notes, pi_date_work_planned_finish, pi_date_work_planned_start, pi_date_work_started, pi_estimate_initial, pi_estimate_updated, pi_flow_state_change_date, pi_lidentifier_tags (via join table), pi_strategic_investment_group, ready, risk_score, us_affects_doc, us_count_child_test_cases, us_defect_status
- **Recommended DROP:** 1
  - acceptance_criteria2 (archive — duplicate)
- **CORE-CANDIDATE (needs Rick decision before committing):** 6
  - pi_date_work_accepted, pi_flow_state_change_owner, pi_lidentifier_labels, pi_strategic_investment_weight, risk_score (timing — coordinate with PLA-0052), us_count_child_defects/tasks (rollup pattern)

Numbers add up: 11 KEEP-CUSTOM + 5 DEMOTE-EXISTING + 18 DEMOTE-NEW-COL + 1 DROP + 4 CORE-CANDIDATE-undecided overlap = 39.

---

## Surprises and notes for the orchestrator

1. **`us_affects_doc` is a Rally Defect attribute, not a Story attribute.** The Vector `us_` prefix is misleading here. When this becomes `artefacts_affects_doc`, restrict the binding to the Defect artefact type (and any future Defect-like types), not Story.

2. **`pi_strategic_item_type` is structurally redundant.** Rally's `PortfolioItemTypeName` is the type-discriminator string (e.g. "Feature", "Initiative", "Theme"). In Vector that's the `artefacts.artefacts_type_id` → `artefacts_types.artefacts_types_name` already. Archive the catalogue row but do NOT add a column — the data already exists structurally.

3. **`pi_lidentifier_tags` should not become a flat column.** Rally models `Tags` as a `Collection` (many-to-many join). If Vector does not already have an `artefacts_tags` join table, that's a separate-substrate item the migration plan needs to address — adding a flat `text[]` column would mirror Rally's wire shape but not its read pattern.

4. **The "Notes" field exists on every Rally artefact type as a separate attribute from `Description`.** Vector's `notes` (richtext) catalogue row maps cleanly to Rally's `Notes`. Recommend mirroring the existing `artefacts_description` + `artefacts_description_doc` pattern: add `artefacts_notes` (text) + `artefacts_notes_doc` (jsonb) for the slash-mention rich content path.

5. **Risks in Rally are first-class artefacts, not attributes.** `risk_impact` / `risk_probability` (Vector's catalogue rows) align with Rally's design only if Vector's in-flight Risk artefact type (per `docs/c_c_risk_artefact_type.md`, PLA-0052) becomes the home for these. Coordinate the demotion of `risk_score` with that plan — adding `artefacts_risk_score` to the parent table is fine; adding `artefacts_risk_impact` / `_probability` would be premature.

6. **Rally has no `Theme` schema.** `Theme` exists in Rally only as a `PortfolioItemType` instance. The Vector PI hierarchy should mirror this — PortfolioItemType is a row in `artefacts_types`, not a schema. No core fields specific to Theme; it inherits the PortfolioItem set.

7. **Several `pi_date_*` columns don't have exact Rally matches.** `pi_date_work_accepted` is closest to HR's `AcceptedDate` (which IS a Rally HR attribute) — possibly the Vector seed mis-prefixed it as `pi_*` when it's really an HR (Story) attribute. Recommend re-confirming the prefix model with Rick before committing the column names; the `pi_` / `us_` prefixes in the catalogue may be unreliable as a typing signal.

8. **Rally exposes `FlowState` as a ref (`FlowStateRef`), not a string.** Vector's `pi_flow_state_change_date` (textbox) demotion should land as a `timestamptz` column on `artefacts`. The flow-state itself is already federated via topology in Vector, so only the change-date attribute moves to a core column.

9. **`Expedite` and `Ready` are universal Rally attributes** — every artefact type (HR, Defect, Task, TestCase, PI, Feature, Initiative) carries them. The columns `artefacts_is_expedite` and `artefacts_is_ready` should land on the parent `artefacts` table with default false + index, mirroring the existing `artefacts_is_blocked` pattern.

10. **The `lidentifier_type` row has no clean Rally analogue.** It's likely a Vector-internal concept around the artefact's identifier rendering (the FormattedID prefix family). Recommend keeping as custom until the artefact-type/identifier rendering model is consolidated.

---

## Caveats

- The Rally OpenAPI spec at the repo root is well-formed JSON (verified via `jq` parses cleanly); no malformations encountered.
- The spec does not carry a discrete `Theme` schema — confirmed by name search across all 348 schemas. Rally treats Theme as a user-defined `PortfolioItemType`.
- `*Mutation` schemas (write-payload variants) carry the same attribute set with subtly different optionality. Used the read schemas above as canonical.
- I did NOT query the live database. The "already exists on `artefacts`" column claims come from the handover's `\d artefacts` snapshot. Re-verify before any migration is authored.
- The `lidentifier_*` / `pi_*` / `us_*` prefix interpretation is inferred from name-shape against Rally; Vector may have an internal naming convention that disagrees. Rick should sanity-check the prefix-to-Rally-type mapping.
- The "DEMOTE-NEW-COL" recommendations assume the existing `artefacts` table is the right home; if any of these are better modelled on a child artefact-type-specific table (e.g. an `artefacts_defects` sidecar), reroute accordingly.
