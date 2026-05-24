# API Changelog 2.0.0 vs. 2.0.0


## API Changes

### POST /mentions
-  endpoint added


### GET /mentions/inbox
-  endpoint added


### GET /mentions/search
-  endpoint added


### POST /mentions/{id}/read
-  endpoint added


### GET /notifications
-  endpoint added


### GET /notifications/prefs
-  endpoint added


### PUT /notifications/prefs
-  endpoint added


### POST /notifications/read-all
-  endpoint added


### GET /notifications/rule-schema
-  endpoint added


### GET /notifications/rules
-  endpoint added


### POST /notifications/rules
-  endpoint added


### DELETE /notifications/rules/{id}
-  endpoint added


### GET /notifications/rules/{id}
-  endpoint added


### PATCH /notifications/rules/{id}
-  endpoint added


### GET /notifications/unread-count
-  endpoint added


### POST /notifications/{id}/read
-  endpoint added


### POST /portfolio-items
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the success response with the status `201`


### POST /portfolio-items/bulk
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed
-  added the success response with the status `201`


### GET /portfolio-items/by-ids
-  endpoint added


### GET /portfolio-items/columns
-  endpoint added


### GET /portfolio-items/facets
-  endpoint added


### GET /portfolio-items/flow-states
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed
-  added the new optional `query` request parameter `artefact_type_id`


### GET /portfolio-items/summary
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed


### DELETE /portfolio-items/{id}
- :warning: added the new path request parameter `id`
- :warning: removed the success response with the status `200`
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the success response with the status `204`


### GET /portfolio-items/{id}
- :warning: added the new path request parameter `id`
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`


### PATCH /portfolio-items/{id}
- :warning: added the new path request parameter `id`
- :warning: added required request body
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`


### GET /portfolio-items/{id}/children
- :warning: added the new path request parameter `id`
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed


### GET /portfolio-items/{id}/field-values
- :warning: added the new path request parameter `id`
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed


### PUT /portfolio-items/{id}/field-values
- :warning: added the new path request parameter `id`
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed


### DELETE /portfolio-items/{id}/field-values/{field_library_id}
- :warning: added the new path request parameter `field_library_id`
- :warning: added the new path request parameter `id`
- :warning: removed the success response with the status `200`
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed
-  added the success response with the status `204`


### GET /portfolio/master_record
-  endpoint added


### GET /timeboxes/milestones
-  endpoint added


### POST /timeboxes/milestones
-  endpoint added


### DELETE /timeboxes/milestones/{id}
-  endpoint added


### GET /timeboxes/milestones/{id}
-  endpoint added


### PATCH /timeboxes/milestones/{id}
-  endpoint added


### POST /timeboxes/releases
-  endpoint added


### POST /timeboxes/releases/bulk-create
-  endpoint added


### DELETE /timeboxes/releases/{id}
-  endpoint added


### PUT /timeboxes/releases/{id}
-  endpoint added


### POST /timeboxes/sprints
-  endpoint added


### POST /timeboxes/sprints/bulk-create
-  endpoint added


### DELETE /timeboxes/sprints/{id}
-  endpoint added


### PUT /timeboxes/sprints/{id}
-  endpoint added


### POST /timeboxes/sprints/{id}/close
-  endpoint added


### POST /timeboxes/sprints/{id}/start
-  endpoint added


### GET /topology/users/{userId}/grants
-  endpoint added


### POST /work-items
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `work-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the success response with the status `201`


### POST /work-items/bulk
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `work-items` added
-  api tag `uncategorised` removed
-  added the success response with the status `201`


### GET /work-items/by-ids
-  endpoint added


### GET /work-items/columns
-  endpoint added


### GET /work-items/facets
-  endpoint added


### GET /work-items/flow-states
-  api tag `work-items` added
-  api tag `uncategorised` removed
-  added the new optional `query` request parameter `artefact_type_id`


### GET /work-items/summary
-  api tag `work-items` added
-  api tag `uncategorised` removed


### DELETE /work-items/{id}
- :warning: added the new path request parameter `id`
- :warning: removed the success response with the status `200`
-  api tag `work-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the success response with the status `204`


### GET /work-items/{id}
- :warning: added the new path request parameter `id`
-  api tag `work-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`


### PATCH /work-items/{id}
- :warning: added the new path request parameter `id`
- :warning: added required request body
-  api tag `work-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`


### GET /work-items/{id}/children
- :warning: added the new path request parameter `id`
-  api tag `work-items` added
-  api tag `uncategorised` removed


### GET /work-items/{id}/field-values
- :warning: added the new path request parameter `id`
-  api tag `work-items` added
-  api tag `uncategorised` removed


### PUT /work-items/{id}/field-values
- :warning: added the new path request parameter `id`
-  api tag `work-items` added
-  api tag `uncategorised` removed


### DELETE /work-items/{id}/field-values/{field_library_id}
- :warning: added the new path request parameter `field_library_id`
- :warning: added the new path request parameter `id`
- :warning: removed the success response with the status `200`
-  api tag `work-items` added
-  api tag `uncategorised` removed
-  added the success response with the status `204`


### GET /workspaces/{id}/fields
- :warning: added the new path request parameter `id`
-  api tag `workspaces` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `403`
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`
-  added the required property `fields` to the response with the `200` status
-  added the required property `workspace_id` to the response with the `200` status


### POST /workspaces/{id}/fields
-  endpoint added


### DELETE /workspaces/{id}/fields/{field_id}
-  endpoint added


### PATCH /workspaces/{id}/fields/{field_id}
-  endpoint added


### GET /workspaces/{id}/portfolio/layers
- :warning: added the new path request parameter `id`
- :warning: the response's body type/format changed from `object`/`` to `array`/`` for status `200`
-  api tag `workspaces` added
-  api tag `uncategorised` removed






