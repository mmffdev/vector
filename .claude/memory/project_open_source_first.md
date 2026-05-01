---
name: Open-source-first stack, no subscription costs
description: Vector commits to open-source-first stack; preference order is MIT/BSD open source → self-hosted open core → build our own → paid SaaS last resort
type: project
originSessionId: a5f9602b-0644-4cea-999f-b70468753594
---
Vector is hobby-funded with unlimited time horizon. The project is explicitly Rick's vehicle for getting back into coding and learning to work with AI; there is no commercial deadline.

This permanently reframes architecture decisions. Order of preference for any external dependency:

1. MIT/BSD/Apache-licensed open source (free forever, no commercial tier)
2. Self-hosted open core
3. Build our own (one-time effort beats compounding subscription costs)
4. Paid SaaS — last resort only

**Why:** Subscription costs compound forever; one-time build effort amortises. With unlimited time, the math always favours owning the stack. Customers should never inherit our vendor bills.

**How to apply:**
- When recommending a library, prefer the one with no commercial tier sitting on top of it (Lexical over Tiptap, Craft.js over BuilderIO, self-hosted Postgres FTS over Algolia, self-hosted Yjs over Tiptap Cloud).
- When a paid service is genuinely the only option, flag it explicitly and ask before committing.
- Don't optimise for "ship fast" at the cost of long-term subscription burden — the timeline is unlimited.
- Learning is a first-class goal; sometimes the educational path (build our own) is the right path even if slower.
- No deadline = no scope-creep pressure; we just do the next right thing properly.
