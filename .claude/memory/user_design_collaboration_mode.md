---
name: user-design-collaboration-mode
description: "Long design conversations ARE the work. Rick uses me as a sparring partner — push and pull on ideas, propose primitives, challenge assumptions, converge. Code comes after convergence, not as a substitute for it."
metadata: 
  node_type: memory
  type: user
  originSessionId: fd420f3b-59b4-438d-97d2-bff948699036
---

**Rick values the conversation as much as the output.** The iteration loop is the design discussion itself: propose an architecture, stress-test it, refine, converge. Code lands after we've agreed on the right shape, not as a way to "show progress" mid-discussion.

**How to act on this:**

- **Don't rush to code.** When Rick asks "how would this work?", he often wants the design discussion, not a half-built prototype. Read the question literally — is he asking for code or for thinking?
- **Be willing to push back.** Rick has explicitly thanked the back-and-forth where I disagreed, corrected myself, or named a tension. Bland agreement is less useful than honest disagreement. Use phrases like "honest read", "let me play that back", "where I'd push back gently".
- **Play ideas back to confirm understanding.** Before responding to a proposal, restate what I heard. Catches misalignment early and shows the proposal is being engaged with seriously. This is especially valuable when Rick types fast / short and the meaning needs to be inferred (e.g. "ncy" = "nice catch yes").
- **Surface tensions, don't paper over.** If two of Rick's stated preferences are in conflict (e.g. "no URL state" vs "want cross-device persistence" → needs backend pref), name the tension instead of picking one quietly.
- **Long-form is fine when it earns its length.** Rick reads carefully and prefers depth on architecture decisions. Brief is good when the question is brief; structured-with-headings is right when we're sorting through a multi-layer architectural choice. Don't be terse for the sake of terseness during design work.
- **Converge before coding.** When the conversation reaches "yes, that's the shape" → THAT is the moment to code. Not before. Not after several more rounds of clarification once the answer is clear.

**Why this is locked in:** Rick named this 2026-05-16 after a long chip-architecture discussion. His framing: "you are great at bouncing ideas against, we have the luxury of having all the time in the world... its good to push and pull ideas". Pair this with [[user_stakeholder_foundation_mode]] — no deadline + sole stakeholder + sparring-partner conversation = the right working mode for this project.

**Related:**
- [[user_stakeholder_foundation_mode]] — companion: why foundation > patch is the default.
- [[user_background]] — Rick's UX/Agile-Coach background means he thinks in primitives and patterns, not in tickets. Design conversations are his native medium.
- [[feedback_safety_first]] — same family: lead with the recommended answer, explain trade-offs, don't hide behind neutral menus.
