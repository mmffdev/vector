# API Changelog 1.0.0 vs. 1.0.0


## API Changes

### GET /admin/dev/api-audit
-  endpoint added


### GET /admin/dev/artefacts-count
-  endpoint added


### POST /admin/dev/artefacts-wipe
-  endpoint added


### GET /admin/dev/codegraph
-  endpoint added


### POST /admin/dev/master-reset
-  api tag `admin` added
-  api tag `uncategorised` removed
-  added the optional property `message` to the response with the `200` status
-  added the optional property `success` to the response with the `200` status


### GET /admin/dev/reporting
-  endpoint added


### POST /admin/dev/reporting
-  endpoint added


### DELETE /admin/dev/reporting/{id}
-  endpoint added


### GET /admin/dev/reporting/{id}
-  endpoint added


### POST /admin/dev/seed-risks
- :warning: added required request body
-  api tag `admin` added
-  api tag `uncategorised` removed
-  added the optional property `assignee_id` to the response with the `200` status
-  added the optional property `inserted` to the response with the `200` status
-  added the optional property `message` to the response with the `200` status
-  added the optional property `risk_type_id` to the response with the `200` status
-  added the optional property `success` to the response with the `200` status
-  added the optional property `workspace_id` to the response with the `200` status


### POST /admin/dev/seed-workspace
- :warning: added required request body
-  api tag `admin` added
-  api tag `uncategorised` removed
-  added the optional property `name` to the response with the `200` status
-  added the optional property `success` to the response with the `200` status
-  added the optional property `workspace_id` to the response with the `200` status


### GET /admin/dev/source
-  endpoint added


### GET /admin/page-grants
-  api tag `admin` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`
-  added the required property `count` to the response with the `200` status
-  added the required property `releases` to the response with the `200` status


### PUT /admin/page-grants/bucket/{tag_enum}/{role_id}
- :warning: added the new path request parameter `role_id`
- :warning: added the new path request parameter `tag_enum`
- :warning: added required request body
-  api tag `admin` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `409`
-  added the non-success response with the status `500`


### DELETE /admin/page-grants/{page_id}/{role_id}
- :warning: added the new path request parameter `page_id`
- :warning: added the new path request parameter `role_id`
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `admin` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `500`
-  added the success response with the status `204`


### PUT /admin/page-grants/{page_id}/{role_id}
- :warning: added the new path request parameter `page_id`
- :warning: added the new path request parameter `role_id`
-  api tag `admin` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`


### GET /admin/users
-  endpoint added


### POST /admin/users
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `admin` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `403`
-  added the non-success response with the status `500`
-  added the success response with the status `201`


### DELETE /admin/users/{id}
-  endpoint added


### PATCH /admin/users/{id}
-  endpoint added


### POST /admin/users/{id}/password-reset
-  endpoint added


### GET /artefact-priorities
-  endpoint added


### POST /artefact-priorities
-  endpoint added


### DELETE /artefact-priorities/{id}
-  endpoint added


### PATCH /artefact-priorities/{id}
-  endpoint added


### GET /artefact-types
-  endpoint added


### POST /artefact-types/resync
-  endpoint added


### PATCH /artefact-types/{id}
-  endpoint added


### POST /auth/login
- :warning: added required request body
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `500`
-  added the required property `access_token` to the response with the `200` status
-  added the required property `user` to the response with the `200` status


### GET /auth/login-continuation
-  api tag `auth` added
-  api tag `uncategorised` removed


### GET /auth/login-required
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the new optional `query` request parameter `p`


### DELETE /auth/mfa
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `500`
-  added the success response with the status `204`


### POST /auth/mfa/confirm
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `500`
-  added the success response with the status `201`


### POST /auth/mfa/enroll
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`
-  added the optional property `otpauth_uri` to the response with the `200` status
-  added the optional property `recovery_codes` to the response with the `200` status


### POST /auth/mfa/verify
- :warning: added required request body
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the required property `access_token` to the response with the `200` status
-  added the required property `user` to the response with the `200` status


### POST /auth/password-reset
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the success response with the status `201`


### POST /auth/password-reset/confirm
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the success response with the status `201`


### GET /auth/password-reset/redeem
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the new optional `query` request parameter `t`
-  added the non-success response with the status `500`


### GET /auth/password-reset/state
-  api tag `auth` added
-  api tag `uncategorised` removed


### POST /auth/reauth
- :warning: added required request body
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `500`
-  added the required property `action_proof` to the response with the `200` status
-  added the required property `expires_at` to the response with the `200` status


### GET /auth/sessions
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`
-  added the optional property `sessions` to the response with the `200` status


### POST /auth/sessions/revoke-others
- :warning: removed the success response with the status `200`
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `403`
-  added the non-success response with the status `500`
-  added the success response with the status `201`


### DELETE /auth/sessions/{id}
- :warning: added the new path request parameter `id`
- :warning: removed the success response with the status `200`
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`
-  added the success response with the status `204`


### POST /auth/switch-workspace
- :warning: added required request body
-  api tag `auth` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `403`
-  added the non-success response with the status `500`
-  added the required property `access_token` to the response with the `200` status
-  added the required property `user` to the response with the `200` status


### GET /cost-centres
- :warning: the response's body type/format changed from `object`/`` to `array`/`` for status `200`
-  api tag `cost-centres` added
-  api tag `uncategorised` removed


### POST /cost-centres
-  endpoint added


### DELETE /cost-centres/{id}
-  endpoint added


### PATCH /cost-centres/{id}
-  endpoint added


### POST /csp-report
- :warning: removed the success response with the status `200`
-  api tag `csp-report` added
-  api tag `uncategorised` removed
-  added the success response with the status `201`


### DELETE /flow-state-exit-rules/{id}
- :warning: added the new path request parameter `id`
- :warning: removed the success response with the status `200`
-  api tag `flow-state-exit-rules` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`
-  added the success response with the status `204`


### PATCH /flow-state-exit-rules/{id}
- :warning: added the new path request parameter `id`
- :warning: added required request body
-  api tag `flow-state-exit-rules` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the optional property `colour` to the response with the `200` status
-  added the required property `id` to the response with the `200` status
-  added the required property `name` to the response with the `200` status
-  added the required property `sort_order` to the response with the `200` status


### DELETE /flow-states/{id}
- :warning: added the new path request parameter `id`
- :warning: removed the success response with the status `200`
-  api tag `flow-states` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`
-  added the success response with the status `204`


### PATCH /flow-states/{id}
- :warning: added the new path request parameter `id`
- :warning: added required request body
-  api tag `flow-states` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the optional property `colour` to the response with the `200` status
-  added the optional property `description` to the response with the `200` status
-  added the optional property `exit_rules` to the response with the `200` status
-  added the required property `exit_rule_count` to the response with the `200` status
-  added the required property `id` to the response with the `200` status
-  added the required property `is_initial` to the response with the `200` status
-  added the required property `is_pullable` to the response with the `200` status
-  added the required property `kind` to the response with the `200` status
-  added the required property `name` to the response with the `200` status
-  added the required property `sort_order` to the response with the `200` status


### GET /flow-states/{id}/exit-rules
- :warning: added the new path request parameter `id`
- :warning: the response's body type/format changed from `object`/`` to `array`/`` for status `200`
-  api tag `flow-states` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`


### POST /flow-states/{id}/exit-rules
- :warning: added the new path request parameter `id`
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `flow-states` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the success response with the status `201`


### POST /flows/reset/apply
- :warning: added required request body
-  api tag `flows` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`
-  added the required property `artefact_type_id` to the response with the `200` status
-  added the required property `artefacts_rebound` to the response with the `200` status
-  added the required property `flow_id` to the response with the `200` status
-  added the required property `pills_added` to the response with the `200` status
-  added the required property `pills_removed` to the response with the `200` status
-  added the required property `pills_updated` to the response with the `200` status
-  added the required property `transitions_added` to the response with the `200` status
-  added the required property `transitions_removed` to the response with the `200` status


### POST /flows/reset/preview
- :warning: added required request body
-  api tag `flows` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`
-  added the required property `already_at_default` to the response with the `200` status
-  added the required property `artefact_impacts` to the response with the `200` status
-  added the required property `artefact_type_id` to the response with the `200` status
-  added the required property `artefact_type_name` to the response with the `200` status
-  added the required property `flow_id` to the response with the `200` status
-  added the required property `flow_name` to the response with the `200` status
-  added the required property `pills` to the response with the `200` status
-  added the required property `transitions` to the response with the `200` status


### POST /flows/{flowId}/states
- :warning: added the new path request parameter `flowId`
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `flows` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the success response with the status `201`


### DELETE /flows/{flowId}/transitions
- :warning: added the new path request parameter `flowId`
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `flows` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`
-  added the success response with the status `204`


### POST /flows/{flowId}/transitions
- :warning: added the new path request parameter `flowId`
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `flows` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the success response with the status `201`


### GET /lookups/users-in-scope
-  endpoint added


### GET /me/active-scope
-  api tag `me` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`
-  added the optional property `node_id` to the response with the `200` status


### PUT /me/active-scope
- :warning: added required request body
-  api tag `me` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `403`
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`


### GET /me/page-access
-  api tag `me` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`


### DELETE /me/preferences/{key}
- :warning: added the new path request parameter `key`
- :warning: removed the success response with the status `200`
-  api tag `me` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`
-  added the success response with the status `204`


### GET /me/preferences/{key}
- :warning: added the new path request parameter `key`
-  api tag `me` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `500`
-  added the required property `value` to the response with the `200` status


### PUT /me/preferences/{key}
- :warning: added the new path request parameter `key`
- :warning: added required request body
-  api tag `me` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`


### POST /mentions
-  endpoint added


### GET /mentions/inbox
-  endpoint added


### GET /mentions/search
-  endpoint added


### POST /mentions/{id}/read
-  endpoint added


### DELETE /nav/page-bookmark
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `nav` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `500`
-  added the success response with the status `204`


### POST /nav/page-bookmark
- :warning: added required request body
- :warning: removed the success response with the status `200`
-  api tag `nav` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the non-success response with the status `404`
-  added the non-success response with the status `409`
-  added the non-success response with the status `500`
-  added the success response with the status `201`


### POST /nav/reset
- :warning: removed the success response with the status `200`
-  api tag `nav` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`
-  added the success response with the status `201`


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


### GET /notifications/stream
-  endpoint added


### GET /notifications/unread-count
-  endpoint added


### POST /notifications/{id}/read
-  endpoint added


### GET /portfolio-items
-  api tag `portfolio-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`
-  added the required property `count` to the response with the `200` status
-  added the required property `releases` to the response with the `200` status


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


### GET /portfolio-items/types/{typeId}/fields
-  endpoint added


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


### GET /portfolio-models
-  endpoint added


### GET /portfolio-models/adoption-state
-  api tag `portfolio-models` added
-  api tag `uncategorised` removed
-  added the optional property `adopted_at` to the response with the `200` status
-  added the optional property `adopted_by_user_id` to the response with the `200` status
-  added the optional property `model_id` to the response with the `200` status
-  added the required property `adopted` to the response with the `200` status
-  added the required property `status` to the response with the `200` status


### POST /portfolio-models/{id}/adopt
- :warning: added the new path request parameter `id`
-  api tag `portfolio-models` added
-  api tag `uncategorised` removed
-  added the required property `adopted_at` to the response with the `200` status
-  added the required property `model_id` to the response with the `200` status
-  added the required property `state_id` to the response with the `200` status
-  added the required property `status` to the response with the `200` status


### GET /portfolio-models/{id}/adopt/stream
- :warning: added the new path request parameter `id`
-  api tag `portfolio-models` added
-  api tag `uncategorised` removed


### GET /portfolio/master_record
-  endpoint added


### POST /rank/move
- :warning: added required request body
-  api tag `rank` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the required property `new_position` to the response with the `200` status
-  added the required property `row_id` to the response with the `200` status
-  added the required property `scope` to the response with the `200` status


### GET /risks/summary
-  api tag `risks` added
-  api tag `uncategorised` removed


### GET /roles
-  endpoint added


### POST /roles
-  endpoint added


### GET /roles/creatable
-  endpoint added


### GET /roles/permissions/catalogue
-  endpoint added


### DELETE /roles/{id}
-  endpoint added


### GET /roles/{id}
-  endpoint added


### PATCH /roles/{id}
-  endpoint added


### DELETE /roles/{id}/permissions
-  endpoint added


### GET /roles/{id}/permissions
-  endpoint added


### POST /roles/{id}/permissions
-  endpoint added


### GET /tenant-settings
-  endpoint added


### PATCH /tenant-settings
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


### GET /timeboxes/releases
-  api tag `timeboxes` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`


### POST /timeboxes/releases
-  endpoint added


### POST /timeboxes/releases/bulk-create
-  endpoint added


### GET /timeboxes/releases/columns
-  endpoint added


### DELETE /timeboxes/releases/{id}
-  endpoint added


### GET /timeboxes/releases/{id}
- :warning: added the new path request parameter `id`
-  api tag `timeboxes` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`


### PUT /timeboxes/releases/{id}
-  endpoint added


### GET /timeboxes/sprints
-  api tag `timeboxes` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`


### POST /timeboxes/sprints
-  endpoint added


### POST /timeboxes/sprints/bulk-create
-  endpoint added


### GET /timeboxes/sprints/columns
-  endpoint added


### DELETE /timeboxes/sprints/{id}
-  endpoint added


### GET /timeboxes/sprints/{id}
- :warning: added the new path request parameter `id`
-  api tag `timeboxes` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `404`
-  added the non-success response with the status `500`


### PUT /timeboxes/sprints/{id}
-  endpoint added


### POST /timeboxes/sprints/{id}/close
-  endpoint added


### POST /timeboxes/sprints/{id}/start
-  endpoint added


### GET /topology/grants/me
- :warning: the response's body type/format changed from `object`/`` to `array`/`` for status `200`
-  api tag `topology` added
-  api tag `uncategorised` removed


### GET /topology/users/{userId}/grants
-  endpoint added


### PUT /topology/view-state
- :warning: added required request body
-  api tag `topology` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`


### GET /work-items
-  api tag `work-items` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `500`
-  added the required property `count` to the response with the `200` status
-  added the required property `releases` to the response with the `200` status


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


### GET /work-items/types/{typeId}/fields
-  endpoint added


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


### GET /workspace-settings
-  endpoint added


### PATCH /workspace-settings
-  endpoint added


### GET /workspaces
-  endpoint added


### POST /workspaces
-  endpoint added


### DELETE /workspaces/{id}
- :warning: added the new path request parameter `id`
- :warning: removed the success response with the status `200`
-  api tag `workspaces` added
-  api tag `uncategorised` removed
-  added the non-success response with the status `400`
-  added the success response with the status `204`


### PATCH /workspaces/{id}
-  endpoint added


### POST /workspaces/{id}/archive
-  endpoint added


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


### PATCH /workspaces/{id}/portfolio/layers/batch
- :warning: added the new path request parameter `id`
- :warning: added required request body
- :warning: the response's body type/format changed from `object`/`` to `array`/`` for status `200`
-  api tag `workspaces` added
-  api tag `uncategorised` removed


### POST /workspaces/{id}/restore
-  endpoint added


### GET /workspaces/{workspaceId}/webhooks
-  endpoint added


### POST /workspaces/{workspaceId}/webhooks
-  endpoint added


### DELETE /workspaces/{workspaceId}/webhooks/{webhookId}
-  endpoint added


### GET /workspaces/{workspaceId}/webhooks/{webhookId}
-  endpoint added


### PATCH /workspaces/{workspaceId}/webhooks/{webhookId}
-  endpoint added






