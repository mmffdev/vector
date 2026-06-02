# Portfolio Hierarchy Model

Vector has two portfolio hierarchy families:

- **Strategic / portfolio hierarchy**: `artefacts_types_scope='strategy'`, API `/samantha/v2/portfolio-items`, frontend resource `/portfolio-items`, form scope `strategy`. These layers come from the tenant workspace's adopted `mmff_library.portfolio_templates.layers` model. Adoption writes tenant-owned strategy `artefacts_types` rows with `artefacts_types_layer_depth`, `artefacts_types_id_parent_type`, `artefacts_types_library_layer_tag`, and `artefacts_types_source='tenant'`. `master_record_portfolios` records which template/model the workspace adopted.
- **Execution / work hierarchy**: `artefacts_types_scope='work'`, API `/samantha/v2/work-items`, frontend resource `/work-items`, form scope `work`. Work types are mirrored into the workspace from the system work catalogue and layered beneath the adopted strategy ladder by depth offset (`max(strategy depth)+1`, capped at 9). Actual parentage is still row-level via `artefacts.artefacts_id_parent`.

The `/scope` prototype is currently an execution assembler: `DataContainer` is a dumb frame, `GridExecution` wires `useTree` + `Grid__Tree`, and `scopeTreeData.ts` fetches `/work-items` roots/children through POST query payloads. A strategic view should be a sibling assembler, or a generic hierarchy assembler parameterised by resource URL/scope/columns, over the same dumb shell and tree primitive.

Do not hardcode portfolio layer names, counts, or depth. Library templates include Vector Standard, Enterprise, Rally, SAFe, Jira, and tenant rows can drift after adoption. `artefacts_types_layer_depth` and `artefacts_types_id_parent_type` describe the type ladder for strategy, but `artefacts.artefacts_id_parent` is the instance-tree truth for both strategy and work. Null or tenant-edited type depths can exist, so the server query result and child count are the runtime authority.

`librarydb.FetchTemplateByID` synthesizes layer UUIDs when reading JSONB templates, so durable lineage should rely on stable tags/prefixes such as `artefacts_types_library_layer_tag`, the adopted model in `master_record_portfolios`, and live tenant `artefacts_types`, not raw synthesized layer IDs.

All hierarchy reads must preserve the server clamp path. Use the existing POST `/query` roots/children contract and let backend Sentinel/workspace/topology clamps govern visibility; the frontend tree is a presentation of allowed rows, never the authority.
