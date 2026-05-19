# API Changelog 1.0.0 vs. 1.0.0


## API Changes

### POST /admin/dev/master-reset
-  endpoint added


### POST /admin/dev/seed-risks
-  endpoint added


### POST /admin/dev/seed-workspace
-  endpoint added


### GET /admin/page-grants
-  endpoint added


### PUT /admin/page-grants/bucket/{tag_enum}/{role_id}
-  endpoint added


### DELETE /admin/page-grants/{page_id}/{role_id}
-  endpoint added


### PUT /admin/page-grants/{page_id}/{role_id}
-  endpoint added


### GET /admin/permissions
- :warning: api path removed without deprecation


### POST /admin/permissions
- :warning: api path removed without deprecation


### DELETE /admin/permissions/{id}
- :warning: api path removed without deprecation


### GET /admin/users
- :warning: api removed without deprecation


### POST /admin/users
- :warning: removed the request body
- :warning: removed the success response with the status `201`
-  api operation id `createUser` removed and replaced with `postAdminUsers`
-  api tag `uncategorised` added
-  api tag `admin` removed
-  removed the non-success response with the status `400`
-  removed the non-success response with the status `403`
-  added the success response with the status `200`


### DELETE /admin/users/{id}
- :warning: api path removed without deprecation


### PATCH /admin/users/{id}
- :warning: api path removed without deprecation


### POST /admin/users/{id}/password-reset
- :warning: api path removed without deprecation


### POST /artefacts/{type}
- :warning: api path removed without deprecation


### GET /artefacts/{type}/schema
- :warning: api path removed without deprecation


### POST /artefacts/{type}/schema
- :warning: api path removed without deprecation


### DELETE /artefacts/{type}/schema/{schema_id}
- :warning: api path removed without deprecation


### PATCH /artefacts/{type}/schema/{schema_id}
- :warning: api path removed without deprecation


### DELETE /artefacts/{type}/{id}
- :warning: api path removed without deprecation


### GET /artefacts/{type}/{id}
- :warning: api path removed without deprecation


### PATCH /artefacts/{type}/{id}
- :warning: api path removed without deprecation


### GET /artefacts/{type}/{id}/fields
- :warning: api path removed without deprecation


### POST /artefacts/{type}/{id}/fields/bulk
- :warning: api path removed without deprecation


### PUT /artefacts/{type}/{id}/fields/{field_name}
- :warning: api path removed without deprecation


### POST /auth/login
- :warning: removed the request body
- :warning: removed the optional property `accessToken` from the response with the `200` status
- :warning: removed the optional property `user` from the response with the `200` status
-  api operation id `login` removed and replaced with `postAuthLogin`
-  the endpoint scheme security `bearerAuth` was added to the API
-  api tag `uncategorised` added
-  api tag `auth` removed
-  added the non-success response with the status `401`
-  removed the non-success response with the status `400`
-  removed the non-success response with the status `403`


### GET /auth/login-continuation
-  endpoint added


### GET /auth/login-required
-  endpoint added


### DELETE /auth/mfa
-  endpoint added


### POST /auth/mfa/confirm
-  endpoint added


### POST /auth/mfa/enroll
-  endpoint added


### POST /auth/mfa/verify
-  endpoint added


### POST /auth/password-reset
- :warning: removed the request body
- :warning: removed the success response with the status `204`
-  api operation id `passwordReset` removed and replaced with `postAuthPasswordReset`
-  the endpoint scheme security `bearerAuth` was added to the API
-  api tag `uncategorised` added
-  api tag `auth` removed
-  added the non-success response with the status `401`
-  removed the non-success response with the status `400`
-  added the success response with the status `200`


### POST /auth/password-reset/confirm
- :warning: removed the request body
- :warning: removed the success response with the status `204`
-  api operation id `passwordResetConfirm` removed and replaced with `postAuthPasswordResetConfirm`
-  the endpoint scheme security `bearerAuth` was added to the API
-  api tag `uncategorised` added
-  api tag `auth` removed
-  added the non-success response with the status `401`
-  removed the non-success response with the status `400`
-  added the success response with the status `200`


### GET /auth/password-reset/redeem
-  endpoint added


### GET /auth/password-reset/state
-  endpoint added


### POST /auth/reauth
-  endpoint added


### GET /auth/sessions
-  endpoint added


### POST /auth/sessions/revoke-others
-  endpoint added


### DELETE /auth/sessions/{id}
-  endpoint added


### POST /auth/switch-workspace
-  endpoint added


### GET /cost-centres
-  endpoint added


### POST /csp-report
-  endpoint added


### GET /custom-field-library
- :warning: api path removed without deprecation


### POST /custom-field-library
- :warning: api path removed without deprecation


### DELETE /custom-field-library/{id}
- :warning: api path removed without deprecation


### GET /custom-field-library/{id}
- :warning: api path removed without deprecation


### PATCH /custom-field-library/{id}
- :warning: api path removed without deprecation


### POST /defects
-  api path removed with deprecation


### DELETE /defects/{id}
-  api path removed with deprecation


### GET /defects/{id}
-  api path removed with deprecation


### PATCH /defects/{id}
-  api path removed with deprecation


### DELETE /flow-state-exit-rules/{id}
-  endpoint added


### PATCH /flow-state-exit-rules/{id}
-  endpoint added


### DELETE /flow-states/{id}
-  endpoint added


### PATCH /flow-states/{id}
-  endpoint added


### GET /flow-states/{id}/exit-rules
-  endpoint added


### POST /flow-states/{id}/exit-rules
-  endpoint added


### POST /flows/reset/apply
-  endpoint added


### POST /flows/reset/preview
-  endpoint added


### POST /flows/{flowId}/states
-  endpoint added


### DELETE /flows/{flowId}/transitions
-  endpoint added


### POST /flows/{flowId}/transitions
-  endpoint added


### GET /me/active-scope
-  endpoint added


### PUT /me/active-scope
-  endpoint added


### GET /me/page-access
-  endpoint added


### DELETE /me/preferences/{key}
-  endpoint added


### GET /me/preferences/{key}
-  endpoint added


### PUT /me/preferences/{key}
-  endpoint added


### DELETE /nav/page-bookmark
-  endpoint added


### POST /nav/page-bookmark
-  endpoint added


### POST /nav/reset
-  endpoint added


### GET /portfolio-items
-  endpoint added


### POST /portfolio-items
- :warning: removed the request body
- :warning: removed the success response with the status `201`
-  api operation id `createPortfolioItem` removed and replaced with `postPortfolioItems`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  endpoint reactivated
-  removed the non-success response with the status `400`
-  added the success response with the status `200`


### POST /portfolio-items/bulk
-  endpoint added


### GET /portfolio-items/flow-states
-  endpoint added


### GET /portfolio-items/summary
-  endpoint added


### DELETE /portfolio-items/{id}
- :warning: removed the success response with the status `204`
- :warning: deleted the `path` request parameter `id`
-  api operation id `archivePortfolioItem` removed and replaced with `deletePortfolioItemsId`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  endpoint reactivated
-  removed the non-success response with the status `404`
-  added the success response with the status `200`


### GET /portfolio-items/{id}
- :warning: deleted the `path` request parameter `id`
-  api operation id `getPortfolioItem` removed and replaced with `getPortfolioItemsId`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  endpoint reactivated
-  removed the non-success response with the status `404`


### PATCH /portfolio-items/{id}
- :warning: removed the request body
- :warning: deleted the `path` request parameter `id`
-  api operation id `patchPortfolioItem` removed and replaced with `patchPortfolioItemsId`
-  api tag `uncategorised` added
-  api tag `work-items` removed
-  endpoint reactivated
-  removed the non-success response with the status `404`


### GET /portfolio-items/{id}/children
-  endpoint added


### GET /portfolio-items/{id}/field-values
-  endpoint added


### PUT /portfolio-items/{id}/field-values
-  endpoint added


### DELETE /portfolio-items/{id}/field-values/{field_library_id}
-  endpoint added


### GET /portfolio-models
- :warning: api path removed without deprecation


### GET /portfolio-models/adoption-state
-  api operation id `getAdoptionState` removed and replaced with `getPortfolioModelsAdoptionState`
-  api tag `uncategorised` added
-  api tag `portfolio` removed
-  removed the non-success response with the status `403`


### POST /portfolio-models/{id}/adopt
- :warning: deleted the `path` request parameter `id`
-  api operation id `adoptPortfolioModel` removed and replaced with `postPortfolioModelsIdAdopt`
-  api tag `uncategorised` added
-  api tag `portfolio` removed
-  removed the non-success response with the status `403`
-  removed the non-success response with the status `404`


### GET /portfolio-models/{id}/adopt/stream
- :warning: removed the media type `text/event-stream` for the response with the status `200`
- :warning: deleted the `path` request parameter `id`
-  api operation id `adoptPortfolioModelStream` removed and replaced with `getPortfolioModelsIdAdoptStream`
-  api tag `uncategorised` added
-  api tag `portfolio` removed
-  added the media type `application/json` for the response with the status `200`
-  removed the non-success response with the status `403`
-  removed the non-success response with the status `404`


### POST /rank/move
-  endpoint added


### GET /risks/summary
-  endpoint added


### GET /roles
- :warning: api path removed without deprecation


### POST /roles
- :warning: api path removed without deprecation


### GET /roles/creatable
- :warning: api path removed without deprecation


### GET /roles/permissions/catalogue
- :warning: api path removed without deprecation


### DELETE /roles/{id}
- :warning: api path removed without deprecation


### GET /roles/{id}
- :warning: api path removed without deprecation


### PATCH /roles/{id}
- :warning: api path removed without deprecation


### DELETE /roles/{id}/permissions
- :warning: api path removed without deprecation


### GET /roles/{id}/permissions
- :warning: api path removed without deprecation


### POST /roles/{id}/permissions
- :warning: api path removed without deprecation


### GET /sprints
- :warning: api path removed without deprecation


### POST /sprints
- :warning: api path removed without deprecation


### DELETE /sprints/{id}
- :warning: api path removed without deprecation


### GET /sprints/{id}
- :warning: api path removed without deprecation


### PATCH /sprints/{id}
- :warning: api path removed without deprecation


### GET /subscription/layers
- :warning: api path removed without deprecation


### PATCH /subscription/layers/batch
- :warning: api path removed without deprecation


### GET /timeboxes/releases
-  endpoint added


### GET /timeboxes/releases/{id}
-  endpoint added


### GET /timeboxes/sprints
-  endpoint added


### GET /timeboxes/sprints/{id}
-  endpoint added


### GET /topology/grants/me
-  endpoint added


### GET /topology/levels
- :warning: api path removed without deprecation


### POST /topology/levels
- :warning: api path removed without deprecation


### PATCH /topology/levels/{id}
- :warning: api path removed without deprecation


### PUT /topology/nodes/{id}/view-state
- :warning: api path removed without deprecation


### PUT /topology/view-state
-  endpoint added


### POST /user-stories
-  api path removed with deprecation


### DELETE /user-stories/{id}
-  api path removed with deprecation


### GET /user-stories/{id}
-  api path removed with deprecation


### PATCH /user-stories/{id}
-  api path removed with deprecation


### GET /work-item-templates
- :warning: api path removed without deprecation


### POST /work-item-templates
- :warning: api path removed without deprecation


### GET /work-item-templates/{id}
- :warning: api path removed without deprecation


### POST /work-item-templates/{id}/fields
- :warning: api path removed without deprecation


### DELETE /work-item-templates/{id}/fields/{field_library_id}
- :warning: api path removed without deprecation


### GET /work-items
-  endpoint added


### POST /work-items
-  endpoint added


### POST /work-items/bulk
-  endpoint added


### GET /work-items/flow-states
-  endpoint added


### GET /work-items/summary
-  endpoint added


### DELETE /work-items/{id}
-  endpoint added


### GET /work-items/{id}
-  endpoint added


### PATCH /work-items/{id}
-  endpoint added


### GET /work-items/{id}/children
-  endpoint added


### GET /work-items/{id}/field-values
-  endpoint added


### PUT /work-items/{id}/field-values
-  endpoint added


### DELETE /work-items/{id}/field-values/{field_library_id}
-  endpoint added


### GET /workspace/{id}/fields
- :warning: api path removed without deprecation


### GET /workspace/{id}/portfolio/layers
- :warning: api path removed without deprecation


### GET /workspaces
- :warning: api path removed without deprecation


### DELETE /workspaces/{id}
-  endpoint added


### GET /workspaces/{id}/fields
-  endpoint added


### GET /workspaces/{id}/portfolio/layers
-  endpoint added


### PATCH /workspaces/{id}/portfolio/layers/batch
-  endpoint added


### GET /ws
- :warning: api path removed without deprecation






