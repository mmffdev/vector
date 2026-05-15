---
name: no-hardcoded-order-from-db-data
description: Never hardcode an order, list, or mapping in TSX/code when the data comes from the database. If the DB doesn't carry the signal needed, STOP and ask — do not invent the missing signal in the frontend.
metadata:
  type: feedback
---

When the user reports that a database-driven page renders in the wrong order (or with wrong grouping, labels, filtering), the answer is **never** a hardcoded array/map/constant in TSX or Go.

If the DB doesn't currently carry the signal needed to drive the UI correctly, the correct response is to **stop** and surface the gap to the user, not to paper over it with a hardcoded fallback "for now". A hardcoded list of strategy types, role names, layer names, status orders, etc. is tech debt that diverges from the DB the moment a tenant edits anything.

**Why:** User explicitly said "on a fully dynamic driven site, you hardcoded an order? what? why would you hardcode anything that comes from a database, surely you know better than that, you are creating tech debt." Rick is building a multi-tenant product where customers will edit their own portfolio model, terminology, layers. Anything I hardcode in the frontend becomes wrong the moment a tenant deviates from my assumption. Also: library data is OFF-LIMITS at runtime — tenants are orphaned from library once seeded. Pulling order from `mmff_library.portfolio_templates` to inform a tenant page is a category error.

**How to apply:** Before adding any ordered constant, enum, or mapping to a TSX/Go file that touches DB-backed data, ask:
1. Is the signal already in the tenant's DB (`vector_artefacts` for artefacts, `mmff_vector` for everything else)?
2. If yes → read it. Wire `ORDER BY <column>` through the backend; return ordered shapes from the API; render wire order in the UI without re-sorting.
3. If no → STOP. Report the gap. Ask the user what the correct value is. The fix is either (a) populate the missing column via a tenant-scoped migration so the column becomes the new source of truth, or (b) extend the schema with the column needed. Never bridge the gap with a hardcoded list.

This rule overrides "ship something now"-thinking. A revert is cheaper than carrying a divergent hardcoded list across releases.
