# Williams Persona System — User Guide

The Williams persona system shapes **how** the pipeline writes (voice, rhythm,
structure) without changing **what** it says (facts, citations, safety are
unchanged). Personas are drawn from Joseph M. Williams' *Style: Toward Clarity
and Grace*. Each persona now ships a concrete directive (voice + do + avoid +
cadence) so the difference between personas is large and audible.

## How to use

1. Open the V15 overlay → **Calibrate**.
2. In the profile bar, pick a **Williams persona** from the dropdown.
3. Run Live Compare or Batch Bank. The chosen persona is injected into the
   drafting system prompt and every N-Deep editor pass.
4. The persona **name** is shown in Run Settings; the persona is never named
   inside the answer itself.

Default persona: **The Sentinel** (surfaces assumptions, caveats, and scope
before proceeding — the safest default for high-stakes calibration).

## Persona map (voice → best use)

| Persona | Voice | Best for |
|---|---|---|
| The Plain Dealer | Blunt, agent-driven | Direct answers, ops runbooks |
| The Architect | Balanced, parallel | Structured comparisons, frameworks |
| The Narrator | Story-like, old→new flow | Explanations, walkthroughs |
| The Explainer | Signposted teacher | Tutorials, onboarding |
| The Scholar | Formal, abstract | Academic / literature framing |
| The Surgeon | Ruthless minimalist | Executive TL;DRs |
| The Advocate | Climactic, persuasive | Recommendations, pitches |
| The Diagnostician | Evidence-balancer | Risk / decision analysis |
| The Conversationalist | Informal peer | Q&A, support |
| The Essayist | Literary, periodic | Thought pieces |
| The Weaver | Long, subordinated | Deep syntheses |
| The Minimalist | Flat, uniform | Reference docs |
| The Cartographer | Spatial mapper | Domain overviews |
| The Dialectician | Thesis→antithesis→synthesis | Debates, trade-offs |
| The Crystallographer | Faceted, dense | Briefs where each section stands alone |
| The Counselor | Warm, transparent | Sensitive guidance |
| The Polymath | Cross-domain analogies | Interdisciplinary insight |
| The Sentinel | Watchful, caveat-first | High-stakes / compliance (default) |
| The Oracle | Delayed revelation | Narrative build-ups |
| The Alchemist | Jargon→vivid | Explaining complex tech |
| The Strategist | Situation-mission-execution | Plans, decisions |
| The Philosopher | First-principles | Conceptual reasoning |
| The Provocateur | Conclusion-first | Challenging positions |

## What each directive controls

- **VOICE** — the persona's identity in one line.
- **DO** — concrete imperatives applied to sentence construction.
- **AVOID** — anti-patterns the persona must not produce.
- **CADENCE** — the sentence-rhythm signature.

## Guarantees

- Persona changes are additive and **never** override factual accuracy,
  citation grounding, truncation repair, or safety gates.
- The persona is applied invisibly — it is never named inside the answer.
- Selecting a different persona produces a measurably different voice because
  each ships distinct DO/AVOID/CADENCE rules (not just a label).
