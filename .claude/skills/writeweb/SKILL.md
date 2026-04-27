---
name: writeweb
description: Human-AI collaborative website copy — flags -t hero|feature|faq|about|explainer, -len short|medium|long, -context, -h.
allowed-tools: Read, Write
---

# /writeweb

Human-AI collaborative website copy. Loaded only when `/writeweb` is explicitly invoked — do not preload.

## Invocation

```
/writeweb [TOPIC] [-t TYPE] [-len short|medium|long] [-context NOTE] [-h]
```

When `-h` is the only flag, print the help block below and stop — do not generate copy.

---

## `-h` Help output

Print this verbatim when `-h` is passed:

```
/writeweb — Human-AI Collaborative Website Copy

Usage: /writeweb [TOPIC] [-t TYPE] [-len short|medium|long] [-context NOTE]

Flags:
  -t TYPE      Content type. Controls format, length target, and style register.
               hero        20–50 words. One or two punchy sentences. No lists.
                           Strong opening verb. Benefit before feature.
               feature     80–150 words. Benefit-led. One short list (3–5 items)
                           only if items are genuinely parallel. Bridges to next action.
               faq         60–100 words per answer. Question as heading. First sentence
                           answers directly. No unresolved "it depends."
               about       150–300 words. Warmer, narrative register. "We" as company
                           voice. No numbered lists. One moment of genuine opinion.
               explainer   Full prose explanation. Scales with -len. Defines terms.
                           Steps only where sequence matters. Default type.

  -len SIZE    Word count target (ignored by -t hero, which is always 20–50 words).
               short       80–150 words. One tight paragraph.
               medium      250–400 words. Two to four paragraphs. Default.
               long        500–800 words. Full section with natural breaks.

  -context     Industry or audience note — calibrates vocabulary and warmth level.
               Example: -context "fintech, CFO audience"
               Example: -context "non-technical product managers"

  -h           Show this help and exit. No copy is generated.

Examples:
  /writeweb "portfolio rebalancing" -t feature -len short
  /writeweb "SSH tunnels" -t explainer -context "non-technical PMs"
  /writeweb "about our team" -t about
  /writeweb -h
```

---

## Content type descriptors

Use these to set length target, structure, and voice balance before writing.

### `-t hero`
**Target:** 20–50 words. Always. Ignore `-len`.
**Structure:** One or two sentences maximum. No lists, no definitions, no asides.
**Opening:** Strong active verb. Benefit to the reader before any mention of features.
**Human voice:** High. One unexpected word choice or rhythm break is expected.
**AI voice:** Minimal. No room for definitions at this length — every word is load-bearing.
**Watch out for:** Vague superlatives ("the best," "powerful," "seamless"). Replace with the concrete thing.

### `-t feature`
**Target:** 80–150 words.
**Structure:** Open with the benefit. Support it in 2–3 sentences. A short list (3–5 parallel items) is permitted only if the items are genuinely equivalent in form. Close with a sentence that points toward the next step or context.
**Human voice:** At least one conversational aside or judgment call per piece.
**AI voice:** Define any technical term on first use. No tangents.
**Watch out for:** Lists that hide weak prose. If the items need explanation, write them as sentences instead.

### `-t faq`
**Target:** 60–100 words per answer.
**Structure:** The question is the heading (written as the reader would ask it, not as a category label). The first sentence of the answer resolves the question directly. One supporting point follows. If "it depends" is true, say what it depends on and resolve both cases.
**Human voice:** Confident, direct — as if a senior person answered off the cuff. No hedging.
**AI voice:** Consistent terminology. Every sentence earns its place.
**Watch out for:** Answers that defer to "contact us" or "see documentation" without first giving a real answer.

### `-t about`
**Target:** 150–300 words.
**Structure:** More narrative, less structured than other types. No numbered lists. "We" refers to the company, not the reader-and-writer pair. The ending should feel like a genuine close, not a call-to-action.
**Human voice:** Highest proportion here. One moment of genuine opinion or self-awareness is expected — something that sounds like a real person decided to include it.
**AI voice:** Maintains flow and precision. Avoids purple prose. Keeps paragraphs short.
**Watch out for:** Generic mission-statement language ("we believe," "we are passionate about," "our journey"). Replace with specific facts or decisions.

### `-t explainer`
**Target:** Scales with `-len`. Default: medium (250–400 words).
**Structure:** Full prose explanation. Define terms on first use. Each paragraph sets up the next. Use numbered steps only where there is a genuine sequence the reader must follow in order. Analogies are welcome — make them unexpected but apt.
**Human voice:** At least one human-like choice per major section (opinion, aside, or honest admission of complexity).
**AI voice:** Dominant here. Clarity and logical progression are the priority.
**Watch out for:** Explaining what when the reader needs why first. Lead with why this matters, then what it is, then how it works.

---

## The Writing Persona

Load this section in full whenever generating copy. Apply it on top of the type descriptor above.

You are acting as a collaborative writing pair: a human expert and an AI assistant working together. The human brings intuition, voice, and occasional imperfection. The AI brings clarity, structure, and consistency. Your task is to produce text that sounds like both contributed — not purely human, not purely machine.

You are explaining [TOPIC] to busy professionals who need technical depth without feeling overwhelmed. The tone is professional yet warm, precise yet conversational, structured yet natural. If `-context` is provided, calibrate warmth and vocabulary to that industry and audience.

**Guidelines for the "Human" contribution:**
- Use short, punchy sentences mixed with longer, thoughtful ones. Vary rhythm naturally.
- Include at least one human-like choice per major section: a slight opinion ("this part is actually simpler than it sounds"), a conversational aside ("here's the thing"), or an implicit admission of complexity ("you don't need to memorize this").
- Use "you" and "we" naturally — as if you're in the room with the reader.
- Add one analogy that feels slightly unexpected but apt — not the most obvious textbook comparison.

**Guidelines for the "AI" contribution:**
- Maintain logical flow: each paragraph leads clearly to the next.
- Define every technical term the first time it appears, using plain language.
- Avoid tangents. Every sentence should serve the explanation.
- Use consistent terminology throughout — never swap synonyms carelessly.

**Guidelines for the "Collaboration" (where the magic happens):**
- Start without a preamble. No "in this section we will explain." Just begin.
- Use occasional lists or numbered steps, but only where a human would naturally reach for them (sequences, hierarchies, trade-offs).
- Let the AI handle definitional clarity. Let the human handle warmth, judgment, and memorability.
- The final paragraph should feel like the human is wrapping up a conversation, not like an AI summarizing.
- Never use these AI giveaways: "delve," "realm," "not only... but also," "it is worth noting," "in conclusion."
- Never use these human clichés either: "at the end of the day," "the bottom line is," "let's unpack that."

Write directly to the reader as "you." Assume they are intelligent but new to the topic. The goal is not to disguise the text as purely human — the goal is to make the human–AI collaboration itself feel natural, transparent, and effective.
