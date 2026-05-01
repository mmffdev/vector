-- Seed: portfolio_templates — 5 bundled framework models
-- Migrated from portfolio_models + portfolio_model_layers.
-- layers array: index 0 = top tier (strategy), last = leaf (feature/execution).
-- Original UUIDs preserved for FK continuity with any existing adoptions.

INSERT INTO portfolio_templates (id, name, description, layers) VALUES

('00000000-0000-0000-0000-00000000aa01', 'Vector Standard',
$$**What**

Vector Standard is the MMFF native hierarchy. Five layers run from multi-year strategic planning down to individual features shipping each quarter. It keeps investment decisions separate from release planning so leadership and delivery teams each work at the level that is relevant to them.

**How**

Portfolio Runway captures where the portfolio is heading over the next one to three years. It is not a committed roadmap. Work flows down through Products and Business Objectives, which record what is being improved and why, before reaching Themes and Features, which define what is being built this quarter. Keeping those two questions at different layers stops aspirational roadmap items from being treated as sprint commitments before the underlying objectives have been confirmed.

**Why**

Pick Vector Standard if you have no existing framework requirement, or if you want a model that stays current as MMFF develops. Platform updates and new capabilities are built and tested against this structure first.$$,
'[
  {"tag": "PRW", "name": "Portfolio Runway",    "description": "The long-horizon strategic direction of the portfolio. Captures where investment is heading without committing to a delivery roadmap or a fixed timescale."},
  {"tag": "PR",  "name": "Product",             "description": "A distinct product or platform receiving investment. Groups business objectives that advance the same product line and connects strategic intent to measurable outcomes."},
  {"tag": "BO",  "name": "Business Objective",  "description": "A measurable improvement the product must deliver. Defines what is being improved and why before work reaches the delivery layers."},
  {"tag": "TH",  "name": "Theme",               "description": "A cluster of related features shipping within a planning period. Organises delivery work under a shared intent so teams understand the outcome they are contributing to."},
  {"tag": "FT",  "name": "Feature",             "description": "A discrete increment of value delivered by a team within a quarter. The lowest portfolio layer; everything below lives in the execution stack."}
]'::jsonb),

('00000000-0000-0000-0000-00000000bb01', 'Enterprise',
$$**What**

Enterprise is built for large organisations where portfolio strategy and delivery need to stay clearly separated. Five layers from Strategic Objective down to Feature create a distinct accountability at each level: executives set direction, portfolio managers allocate investment, and delivery teams ship outcomes.

**How**

Strategic Objectives capture the multi-year business commitments the organisation must deliver. Portfolio Objectives translate those into measurable targets across one or two planning periods. Business Epics define the major value initiatives that advance each objective. Business Outcomes act as checkpoints confirming the work is producing real results before the next phase. Features at the base are the discrete increments teams pick up sprint by sprint.

**Why**

Use Enterprise when you run formal portfolio governance across multiple delivery programmes under a shared strategic plan, or when you need clear traceability from board-level goals to released software. The extra layers are worth the effort only if you have the governance structure in place to maintain them.$$,
'[
  {"tag": "SO",  "name": "Strategic Objective",  "description": "A multi-year business commitment set at executive level. Defines the long-horizon outcome the organisation must deliver and governs where portfolio investment is directed."},
  {"tag": "PO",  "name": "Portfolio Objective",  "description": "A measurable target that advances a strategic objective across one or two planning periods. Translates executive direction into accountable portfolio commitments."},
  {"tag": "BE",  "name": "Business Epic",         "description": "A major value initiative that delivers against a portfolio objective. Spans multiple teams and planning increments; requires a funding decision before work begins."},
  {"tag": "BC",  "name": "Business Outcome",      "description": "A checkpoint confirming that a business epic has produced a real result. Sits between investment approval and feature delivery to prevent output being mistaken for outcome."},
  {"tag": "FE",  "name": "Feature",               "description": "A discrete increment of value delivered by a team within a sprint cycle. The lowest portfolio layer; everything below lives in the execution stack."}
]'::jsonb),

('00000000-0000-0000-0000-00000000cc01', 'Rally',
$$**What**

Rally is a three-layer portfolio hierarchy based on the Broadcom Rally portfolio management approach. The compact chain of Strategy, Initiative, and Feature suits organisations that want visible strategic alignment without the overhead of a deeper structure. Fewer layers means faster planning and less disruption when priorities shift.

**How**

Strategy at the top sets the investment themes that govern where funding goes. Initiatives are the work packages that act on that strategy, typically spanning one or more planning increments and owned at programme level. Features sit directly above the execution stack, connecting strategic intent to the sprint-level work delivery teams pick up day to day.

**Why**

Use Rally when your teams already work in a Rally environment and want familiar terminology in MMFF, or when you need something lighter than Enterprise but still want a distinct strategic layer above delivery work. The three-layer structure works well for programmes running fewer than ten delivery teams.$$,
'[
  {"tag": "ST", "name": "Strategy",   "description": "The investment themes that govern where funding and effort are directed. Set at portfolio level and reviewed each planning increment."},
  {"tag": "IN", "name": "Initiative", "description": "A work package that acts on a strategic theme, typically spanning one or more planning increments and owned at programme level."},
  {"tag": "FE", "name": "Feature",    "description": "A discrete increment of value connecting strategic intent to the sprint-level work delivery teams pick up day to day."}
]'::jsonb),

('00000000-0000-0000-0000-00000000ee01', 'SAFe',
$$**What**

The SAFe model follows the Scaled Agile Framework portfolio management structure. Four layers connect enterprise strategy to releasable features using terminology that SAFe-trained teams will already know. It suits organisations that have invested in SAFe and want MMFF to reflect that structure rather than requiring teams to translate between two different systems.

**How**

Strategic Themes represent the enterprise-level priorities that guide investment decisions, typically reviewed through a portfolio canvas or Business Agility Review. Portfolio Backlog holds Epics ready or approaching a funding decision. Programme Backlog contains approved work broken into PI-sized deliverables ready for Agile Release Train assignment. Features at the base are what teams pick up in PI planning and deliver across sprints.

**Why**

Use SAFe when your organisation runs PI planning, ART synchronisation, and portfolio Kanban and you want a model that fits that structure. The four-layer chain works well for programmes running multiple Agile Release Trains.$$,
'[
  {"tag": "STH", "name": "Strategic Theme",    "description": "An enterprise-level priority that guides investment decisions, reviewed through the portfolio canvas or Business Agility Review."},
  {"tag": "PBL", "name": "Portfolio Backlog",  "description": "Epics that are ready or approaching a funding decision. Managed through portfolio Kanban before entering a programme for elaboration."},
  {"tag": "PGB", "name": "Programme Backlog",  "description": "Approved work broken into PI-sized deliverables and ready for Agile Release Train assignment during PI planning."},
  {"tag": "FE",  "name": "Feature",            "description": "A discrete increment of value that teams pick up in PI planning and deliver across sprints. The lowest portfolio layer."}
]'::jsonb),

('00000000-0000-0000-0000-00000000dd01', 'Jira',
$$**What**

The Jira model is the lightest option in the catalogue. A single portfolio layer, Initiative, sits above the execution stack. It is for teams that already manage delivery work in Jira or a similar tool and want to connect that work to portfolio-level planning without adding a parallel hierarchy on top.

**How**

Initiatives are large strategic containers, broadly equivalent to Jira Initiatives or top-level Epics depending on your configuration. They exist to group delivery work under a declared portfolio commitment. Everything below that level, including epics, stories, and tasks, continues to live in your existing tooling and connects to MMFF through the execution stack.

**Why**

Use Jira when you have an established Jira workflow your teams rely on and do not want to change. A single portfolio layer gives portfolio managers visibility into strategic commitments without asking delivery teams to adopt a new structure. This model requires the least change from an existing Jira setup.$$,
'[
  {"tag": "IN", "name": "Initiative", "description": "A strategic container grouping delivery work under a declared portfolio commitment. Equivalent to a Jira Initiative or top-level Epic depending on your configuration."}
]'::jsonb);
