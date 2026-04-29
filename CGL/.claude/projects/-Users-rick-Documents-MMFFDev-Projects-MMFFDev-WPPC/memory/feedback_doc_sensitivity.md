---
name: Document sensitivity boundary
description: User docs (ARC, GSD, RMF, COP) must never contain sensitive data; dev docs (PAP, PARC, DED, SPR, DEF) can and should
type: feedback
originSessionId: 054f895e-0ce1-441e-a571-c177a1542f87
---
User docs and dev docs have different sensitivity rules.

**User docs** (ARC, GSD, RMF, COP) — public-facing, functionality only. MUST NEVER show sensitive data: internal file paths, API keys, database schemas, sprint internals, dev tooling details, internal architecture decisions.

**Dev docs** (PAP, PARC, DED, SPR, DEF, ASSETS) — internal, CAN and SHOULD contain sensitive implementation detail: file paths, schemas, sprint scope, defect lists, internal architecture, naming conventions, directory structures.

**Why:** User requested this distinction explicitly. Dev docs serve developers who need the full picture. User docs serve end users who only need to understand features and how to use them.

**How to apply:** When writing or updating any document page, check which category it falls into before including implementation details. When running UALLDOC, apply the correct sensitivity level to each page.
