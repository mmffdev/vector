# ATS — Add To Scope Protocol

**Loaded on demand — read this file when the user writes `<ATS>` followed by a feature description.**

## Format
```
As a [role], I want [capability], so that [benefit], as proven by [acceptance criteria].
```

## Process
1. Read the feature description or discussion context
2. Identify distinct pieces of value from the user's perspective
3. Write each as a user story with all four clauses
4. Assign sequential IDs using the convention `{AREA}-{SEQ}` (e.g. `SU-NET-01`, `DG-04`, `DB-12`)
5. Present the stories in a table for review
6. On confirmation, write them into `web/src/data/sprints.json` under the current sprint's `backlog` array

## Personas

Every story must have a persona — the "who" defines the value lens. Pick the persona based on which area the artefact belongs to:

### Dev Mode (`<dev>` artefacts)
- **maintainer of the system** — anyone building, debugging, or extending the platform itself

### User Mode (`<user>` artefacts)
- **Product Owner** — default user persona; defines product scope, priorities, and acceptance criteria

### Specialised (add as needed)
- **junior Product Owner** — new PO who needs guardrails and guidance
- **senior Product Owner** — experienced PO wanting advanced control over roadmap and prioritisation
- **backend process** — system/automated behaviour (use sparingly, only when no human benefits)

### Rules
- Default to **maintainer of the system** for all `<dev>` stories
- Default to **Product Owner** for all `<user>` stories
- Only use a specialised persona when the default doesn't capture the value correctly
- If the persona doesn't fit, rewrite the story — don't force-fit a role

## Rules
- Every scope item in `sprints.json` (backlog, planned, featuresAdded, featuresRemoved) MUST use this format
- The "as proven by" clause must be **observable and testable** — not vague ("it works") but specific ("the YAML output contains a `networks:` top-level key with the user's network definitions")
- Keep stories small — if a story has more than one "and" in the capability clause, split it
- Group related stories under a shared prefix (e.g. `SU-NET-` for Spin Up Networking)
- When retrofitting old items, preserve the original technical detail but wrap it in the user story structure
