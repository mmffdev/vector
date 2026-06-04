# API Changelog 1.0.0 vs. 1.0.0


## API Changes

### POST /addressables/register-bulk
-  endpoint added


### GET /admin/dev/erd
-  endpoint added


### POST /admin/dev/erd
-  endpoint added


### GET /dependencies/candidates
-  endpoint added


### GET /dependencies/edges
-  endpoint added


### POST /dependencies/edges
-  endpoint added


### POST /dependencies/edges/{id}/archive
-  endpoint added


### GET /dependencies/maps
-  endpoint added


### POST /dependencies/maps
-  endpoint added


### GET /dependencies/maps/{id}
-  endpoint added


### PATCH /dependencies/maps/{id}
-  endpoint added


### POST /dependencies/maps/{id}/archive
-  endpoint added


### GET /dependencies/maps/{id}/edges
-  endpoint added


### GET /dependencies/{id}/transitive-impact
-  endpoint added


### GET /flowboard/prefs
-  endpoint added


### PUT /flowboard/prefs
-  endpoint added


### GET /flowboard/wip
-  endpoint added


### PUT /flowboard/wip
-  endpoint added


### PUT /me/home-location-follow-mode
-  endpoint added


### GET /me/theme-pack
- :warning: api path removed without deprecation


### PUT /me/theme-pack
- :warning: api path removed without deprecation


### DELETE /nav/bookmark
- :warning: api path removed without deprecation


### POST /nav/bookmark
- :warning: api path removed without deprecation


### GET /nav/bookmark/check
- :warning: api path removed without deprecation


### GET /nav/entities
- :warning: api path removed without deprecation


### POST /portfolio-items/query
-  endpoint added


### GET /portfolio-items/{id}/ancestors
-  endpoint added


### GET /portfolio-items/{id}/dependency-impact
-  endpoint added


### GET /saved-views
-  endpoint added


### POST /saved-views
-  endpoint added


### DELETE /saved-views/{view_id}
-  endpoint added


### GET /saved-views/{view_id}
-  endpoint added


### PATCH /saved-views/{view_id}
-  endpoint added


### PATCH /saved-views/{view_id}/scope
-  endpoint added


### GET /sentinel/boot
-  endpoint added


### PUT /sentinel/focus
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


### GET /topology/{id}/members
-  endpoint added


### POST /work-items/query
-  endpoint added


### GET /work-items/{id}/ancestors
-  endpoint added


### GET /work-items/{id}/dependency-impact
-  endpoint added


### GET /workspaces/{id}/fields/{field_id}/types
-  endpoint added


### PUT /workspaces/{id}/fields/{field_id}/types
-  endpoint added


### PATCH /workspaces/{id}/fields/{field_id}/types/{type_id}
-  endpoint added






