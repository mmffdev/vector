# API Changelog 2.0.0 vs. 2.0.0


## API Changes

### POST /portfolio-items/query
-  endpoint added


### PUT /timeboxes/releases/{id}
-  added the new optional request property `timeboxes_releases_actuals`
-  added the new optional request property `timeboxes_releases_gross_estimate_conversion_ratio`
-  added the new optional request property `timeboxes_releases_plan_estimate`
-  added the new optional request property `timeboxes_releases_planned_velocity`
-  added the new optional request property `timeboxes_releases_theme`


### PUT /timeboxes/sprints/{id}
-  added the new optional request property `timeboxes_sprints_actuals`
-  added the new optional request property `timeboxes_sprints_plan_estimate`
-  added the new optional request property `timeboxes_sprints_planned_velocity`
-  added the new optional request property `timeboxes_sprints_theme`


### POST /work-items/query
-  endpoint added


### GET /workspaces/{id}/fields/{field_id}/types
-  endpoint added


### PUT /workspaces/{id}/fields/{field_id}/types
-  endpoint added


### PATCH /workspaces/{id}/fields/{field_id}/types/{type_id}
-  endpoint added






