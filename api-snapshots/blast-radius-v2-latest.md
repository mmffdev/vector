# API Changelog 2.0.0 vs. 2.0.0


## API Changes

### POST /portfolio-items
- :warning: removed the request body
- :warning: removed the success response with the status `201`
-  api operation id `v2_createPortfolioItem` removed and replaced with `postPortfolioItems`
-  api tag `uncategorised` added
-  api tag `portfolio` removed
-  removed the non-success response with the status `400`
-  added the success response with the status `200`


### POST /portfolio-items/bulk
-  endpoint added


### GET /portfolio-items/flow-states
-  endpoint added


### GET /portfolio-items/summary
-  endpoint added


### DELETE /portfolio-items/{id}
-  endpoint added


### GET /portfolio-items/{id}
-  endpoint added


### PATCH /portfolio-items/{id}
-  endpoint added


### GET /portfolio-items/{id}/children
-  endpoint added


### GET /portfolio-items/{id}/field-values
-  endpoint added


### PUT /portfolio-items/{id}/field-values
-  endpoint added


### DELETE /portfolio-items/{id}/field-values/{field_library_id}
-  endpoint added


### GET /portfolio/master_record
- :warning: api path removed without deprecation


### POST /timeboxes/releases
- :warning: api removed without deprecation


### DELETE /timeboxes/releases/{id}
- :warning: api removed without deprecation


### PUT /timeboxes/releases/{id}
- :warning: api removed without deprecation


### POST /timeboxes/sprints
- :warning: api removed without deprecation


### POST /timeboxes/sprints/bulk-create
- :warning: api path removed without deprecation


### DELETE /timeboxes/sprints/{id}
- :warning: api removed without deprecation


### PUT /timeboxes/sprints/{id}
- :warning: api removed without deprecation


### POST /work-items
- :warning: removed the request body
- :warning: removed the success response with the status `201`
-  api operation id `v2_createWorkItem` removed and replaced with `postWorkItems`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  removed the non-success response with the status `400`
-  added the success response with the status `200`


### POST /work-items/bulk
- :warning: removed the request body
-  api operation id `v2_bulkWorkItems` removed and replaced with `postWorkItemsBulk`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  removed the non-success response with the status `400`
-  removed the non-success response with the status `403`


### GET /work-items/flow-states
- :warning: the response's body type/format changed from `array`/`` to `object`/`` for status `200`
-  api operation id `v2_listWorkItemFlowStates` removed and replaced with `getWorkItemsFlowStates`
-  api tag `uncategorised` added
-  api tag `work-items` removed


### GET /work-items/relations
- :warning: api path removed without deprecation


### GET /work-items/summary
-  api operation id `v2_getWorkItemsSummary` removed and replaced with `getWorkItemsSummary`
-  api tag `uncategorised` added
-  api tag `work-items` removed


### DELETE /work-items/{id}
- :warning: removed the success response with the status `204`
- :warning: deleted the `path` request parameter `id`
-  api operation id `v2_archiveWorkItem` removed and replaced with `deleteWorkItemsId`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  removed the non-success response with the status `404`
-  added the success response with the status `200`


### GET /work-items/{id}
- :warning: deleted the `path` request parameter `id`
-  api operation id `v2_getWorkItem` removed and replaced with `getWorkItemsId`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  removed the non-success response with the status `404`


### PATCH /work-items/{id}
- :warning: removed the request body
- :warning: deleted the `path` request parameter `id`
-  api operation id `v2_updateWorkItem` removed and replaced with `patchWorkItemsId`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  removed the non-success response with the status `404`


### GET /work-items/{id}/children
- :warning: the response's body type/format changed from `array`/`` to `object`/`` for status `200`
- :warning: deleted the `path` request parameter `id`
-  api operation id `v2_listWorkItemChildren` removed and replaced with `getWorkItemsIdChildren`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  removed the non-success response with the status `404`


### GET /work-items/{id}/field-values
- :warning: deleted the `path` request parameter `id`
-  api operation id `v2_listWorkItemFieldValues` removed and replaced with `getWorkItemsIdFieldValues`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  removed the non-success response with the status `404`


### PUT /work-items/{id}/field-values
- :warning: removed the request body
- :warning: deleted the `path` request parameter `id`
-  api operation id `v2_upsertWorkItemFieldValues` removed and replaced with `putWorkItemsIdFieldValues`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  removed the non-success response with the status `404`


### DELETE /work-items/{id}/field-values/{field_library_id}
- :warning: removed the success response with the status `204`
- :warning: deleted the `path` request parameter `field_library_id`
- :warning: deleted the `path` request parameter `id`
-  api operation id `v2_deleteWorkItemFieldValue` removed and replaced with `deleteWorkItemsIdFieldValuesFieldLibraryId`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  removed the non-success response with the status `404`
-  added the success response with the status `200`


### GET /workspace/{id}/fields
- :warning: api path removed without deprecation


### GET /workspace/{id}/portfolio/layers
- :warning: api path removed without deprecation


### GET /workspaces/{id}/fields
-  endpoint added


### GET /workspaces/{id}/portfolio/layers
-  endpoint added






