-- Seed 005: portfolio_template_layer_definitions
--
-- Canonical name + description for every tag used across the five
-- bundled portfolio templates. Tags shared across models (FE, IN)
-- have a single entry so copy stays consistent everywhere.
-- FT and FE both represent Feature at the execution boundary;
-- same description, different tag conventions.

INSERT INTO portfolio_template_layer_definitions (tag, name, description) VALUES

-- Vector Standard
('PRW', 'Portfolio Runway',
 'The long-horizon strategic direction of the portfolio. Captures where investment is heading without committing to a delivery roadmap or a fixed timescale.'),

('PR',  'Product',
 'A distinct product or platform receiving investment. Groups business objectives that advance the same product line and connects strategic intent to measurable outcomes.'),

('BO',  'Business Objective',
 'A measurable improvement the product must deliver. Defines what is being improved and why before work reaches the delivery layers.'),

('TH',  'Theme',
 'A cluster of related features shipping within a planning period. Organises delivery work under a shared intent so teams understand the outcome they are contributing to.'),

('FT',  'Feature',
 'A discrete increment of value delivered by a team within a quarter. The lowest portfolio layer; everything below lives in the execution stack.'),

-- Enterprise
('SO',  'Strategic Objective',
 'A multi-year business commitment set at executive level. Defines the long-horizon outcome the organisation must deliver and governs where portfolio investment is directed.'),

('PO',  'Portfolio Objective',
 'A measurable target that advances a strategic objective across one or two planning periods. Translates executive direction into accountable portfolio commitments.'),

('BE',  'Business Epic',
 'A major value initiative that delivers against a portfolio objective. Spans multiple teams and planning increments; requires a funding decision before work begins.'),

('BC',  'Business Outcome',
 'A checkpoint confirming that a business epic has produced a real result. Sits between investment approval and feature delivery to prevent output being mistaken for outcome.'),

-- Rally
('ST',  'Strategy',
 'The investment themes that govern where funding and effort are directed. Set at portfolio level and reviewed each planning increment.'),

-- Shared: Rally + Jira
('IN',  'Initiative',
 'A strategic container grouping delivery work under a declared portfolio commitment. Spans one or more planning increments and is owned at programme level.'),

-- SAFe
('STH', 'Strategic Theme',
 'An enterprise-level priority that guides investment decisions, reviewed through the portfolio canvas or Business Agility Review.'),

('PBL', 'Portfolio Backlog',
 'Epics that are ready or approaching a funding decision. Managed through portfolio Kanban before entering a programme for elaboration.'),

('PGB', 'Programme Backlog',
 'Approved work broken into PI-sized deliverables and ready for Agile Release Train assignment during PI planning.'),

-- Shared: Enterprise + Rally + SAFe
('FE',  'Feature',
 'A discrete increment of value delivered by a team. The lowest portfolio layer; everything below lives in the execution stack.')

ON CONFLICT (tag) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      updated_at  = now();
