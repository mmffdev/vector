---
name: Seed boolean columns — use FALSE not string literals
description: When a seed field is boolean and user writes a string like "test", treat it as context note not a value — default to FALSE
type: feedback
originSessionId: 8557abbb-001d-4b82-a39e-1bc746941c47
---
When seeding boolean columns (e.g. `tenant_build_changeset_tracking`), if the user specifies a string value that can't map to boolean (e.g. "test"), treat it as a contextual note about the testbed environment — do not error or ask, default the column to `FALSE`.

**Why:** Confirmed 2026-05-09 during master reset seed (010_master_reset.sql). User wrote `tenant_build_changeset_tracking = test`; "test" was a note about the testbed context, not a literal value.

**How to apply:** Whenever a seed spec has a boolean column with a non-boolean string, default to FALSE and note the assumption in the script comment.
