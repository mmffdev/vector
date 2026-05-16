---
name: user-stakeholder-foundation-mode
description: "Rick is the sole stakeholder with no deadline pressure. Default to \"right foundation\" over \"smallest patch\" — recommend the architecturally coherent answer, not the minimum-viable shipping path."
metadata: 
  node_type: memory
  type: user
  originSessionId: fd420f3b-59b4-438d-97d2-bff948699036
---

**Rick is the key stakeholder, sole builder, no external deadline.** The agile "ship the smallest thing and iterate against customer feedback" loop does not apply here — there's no customer feedback cycle to optimise for, no clock, no backer. The luxury is being able to ask "is this right?" before "is this fast?".

**How to act on this:**

- **Foundation > patch.** When a feature touches multiple layers, recommend the right primitive across all of them, not the minimum-viable patch on one layer. "Do it right" is the default; "ship today" is the fallback when the right shape isn't clear yet.
- **Recommend Option B.** When two paths sit in front of us — Option A (smallest correct thing) vs Option B (right architecture, bigger PR) — Option B is usually the recommendation. Option A is for when foundations are unclear or when Rick explicitly wants to defer.
- **POC = the real architecture, narrowly wired.** A POC for Rick is the actual primitive with one or two surfaces wired so he can feel whether it's right. Not a throwaway. If it sticks, it grows; if not, the cost was less than a full build but more than a sketch.
- **Name scope creep when it's actually scope correction.** If a "fix the bug" ask turns out to have three structural issues, say so up front rather than layering clarifying questions. "Your chip has three structural bugs — let's design the whole right shape before any code" is a better opener than five rounds of A/B/C choices.
- **Tech-debt entries are a flag, not an exit.** Capping with a TD entry is appropriate when the right answer isn't yet known; it's not a substitute for designing the right answer when we can.
- **Cleanup, not deferral.** Bug fixes shouldn't introduce TD entries as a way to ship faster — if the right fix is two hours instead of one, take two hours.

**Why this is locked in:** Rick named this explicitly 2026-05-16 after a long chip-architecture discussion converged on the right answer (slot enum on artefact_types, UUID wire, localStorage state, sidecar carries slot strings). He noted the luxury of no-deadline + sole-stakeholder means he wants foundation work, and conversation IS the iteration loop — the design discussions replace customer-feedback cycles.

**Related:**
- [[feedback_no_debt]] — "never create debt; fix now, flag if detected" — sits underneath this. Don't pay to defer when the right thing is in reach.
- [[feedback_safety_first]] — "lead with ranked safest-first recommendation" — same shape, applied to safety.
- [[user_design_collaboration_mode]] — companion entry: how the conversation itself is the work.
