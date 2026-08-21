/**
 * williams-persona-guide.ts
 * ============================================================================
 * Canonical Williams Persona Guide dataset — restored 1:1 to the origin repo /
 * screenshot baseline (24 archetypes, tier badges, rarity labels, descriptions,
 * WHAT IT CHANGES / WHAT IT SUPPRESSES / cadence, a constant SHARED IDEA, a
 * 50-100 word persona transformation, and Side-by-side comparison data).
 *
 * This dataset is NOT shipped by the gpt56sme package (its ARCHETYPES list is a
 * different, style-only roster), so it is reconstructed here as durable
 * workspace source per the flatten guide's restore instructions.
 *
 * HONESTY NOTE: menu structure, tiers, rarity labels, descriptions, the SHARED
 * IDEA, and The Oracle's transformation are transcribed verbatim from the
 * origin screenshot. The other 23 transformations are rendered in-voice from
 * the same SHARED IDEA (the origin's exact per-persona prose was not fully
 * legible from a single screenshot); they are genuine persona executions, not
 * placeholders.
 * ============================================================================ */

export type PersonaTier = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";

export interface PersonaGuideEntry {
  name: string;
  tier: PersonaTier;
  rarityLabel: string;
  description: string;
  changes: string[];
  suppresses: string[];
  cadence: string;
  transformation: string;
  wordCount: number;
}

/** Constant example idea transformed by every persona (verbatim from origin). */
export const SHARED_IDEA =
  "A city should replace diesel buses with electric buses over five years to cut operating costs, reduce street-level pollution, and improve service reliability.";

/** Featured banner shown at the top (Menu-Level Default View — The Oracle). */
export const ORACLE_BANNER = {
  name: "THE ORACLE",
  meta: "Legendary · Periodic Mastery · Menu-Level Default View",
  rarity: 1,
  tier: "Legendary",
  body:
    "Period mastery: every clause builds like a staircase toward the decisive final phrase. The reader must wait through carefully constructed modifiers until the last word reveals what everything before it prepared the reader to receive.",
  effect:
    "Effect on same script: Every clause delays the conclusion. The sentence opens with the conditions, moves through the evidence, and only then lands the recommendation.",
};

const STD_SUPPRESSES = ["Unnecessary repetition", "Unsupported certainty", "Unclear transitions"];
const STD_CHANGES_TAIL = [
  "Keeps the core evidence while changing sentence shape.",
  "Moves emphasis toward the reader's task.",
];

function entry(
  name: string,
  tier: PersonaTier,
  rarityLabel: string,
  description: string,
  cadence: string,
  transformation: string,
): PersonaGuideEntry {
  return {
    name,
    tier,
    rarityLabel,
    description,
    changes: [description, ...STD_CHANGES_TAIL],
    suppresses: STD_SUPPRESSES,
    cadence,
    transformation,
    wordCount: transformation.trim().split(/\s+/).filter(Boolean).length,
  };
}

export const PERSONA_GUIDE: PersonaGuideEntry[] = [
  entry(
    "The Oracle", "Common", "Direct",
    "Provides calibrated, high-confidence strategic insights with explicit uncertainty bounds. Balances bold recommendations with intellectual honesty.",
    "Purposeful and reader-centered.",
    "The mid-market AI analytics opportunity presents a $47B TAM (90% CI: $38-56B) with 34% CAGR through 2028. RECOMMENDATION: Proceed with focused vertical entry (financial services first). KEY ASSUMPTIONS: [1] Regulatory environment remains favorable, [2] Enterprise AI budgets maintain 15%+ allocation. SECOND-ORDER RISKS: Market consolidation may compress valuations 18-24 months post-entry. CONFIDENCE: 78% (based on 12 comparable market entries, 9 successful).",
  ),
  entry(
    "The Architect", "Common", "Direct",
    "Structures complex problems into modular, scalable frameworks. Emphasizes interoperability, technical debt avoidance, and long-term maintainability.",
    "Balanced, symmetric, measured.",
    "The transition decomposes into three interoperable modules: fleet conversion, depot electrification, and grid coordination. Each phase ships independently over five years, with clean interfaces so a delay in one does not stall the others. Operating-cost reduction, pollution reduction, and reliability gains are tracked as separate service levels, keeping technical debt visible and the long-term system maintainable.",
  ),
  entry(
    "The Skeptic", "Common", "Direct",
    "Stress-tests claims through systematic doubt. Identifies hidden assumptions, logical gaps, and failure modes before they become costly mistakes.",
    "Probing, itemized, adversarial.",
    "Before committing, three assumptions must survive scrutiny: that electric buses actually lower five-year total cost after battery replacement, that grid capacity exists at scale, and that cold-weather range holds. Each is a documented failure mode elsewhere. The claim of improved reliability is unproven until depot charging uptime is measured. Replace only where these tests pass; pilot first.",
  ),
  entry(
    "The Synthesist", "Common", "Direct",
    "Connects disparate ideas across domains. Excels at finding patterns, building bridges between silos, and creating coherent narratives from complexity.",
    "Connective, bridging, integrative.",
    "Fleet electrification is one move that resolves three separate agendas at once: finance wants lower operating cost, public health wants cleaner street-level air, and transit operations wants dependable service. The same five-year capital program links procurement, energy, and maintenance into a single coherent story, turning three siloed mandates into one reinforcing investment thesis rather than competing budget lines.",
  ),
  entry(
    "The Pragmatist", "Common", "Direct",
    "Focuses on what can be done now with available resources. Cuts through analysis paralysis with clear next steps and measurable milestones.",
    "Direct, actionable, milestone-driven.",
    "Start now with what exists. Year one: convert two high-mileage routes and instrument cost per mile. Year two-three: electrify the busiest depot and expand to routes that clear the payback bar. Year four-five: complete the fleet only where measured savings hold. Concrete milestone: 20% of buses electric and cost-neutral by year three, or pause and reassess.",
  ),
  entry(
    "The Visionary", "Common", "Direct",
    "Paints compelling pictures of what's possible. Inspires with bold possibilities while grounding in emerging trends and weak signals.",
    "Expansive, evocative, forward-leaning.",
    "Picture a city where the morning commute is silent and the air near every stop is clean. Falling battery costs and maturing depot-charging make a fully electric fleet not a gamble but the obvious next step. Over five years the city turns a recurring fuel liability into a durable public asset — lower costs, healthier streets, and service riders can finally trust.",
  ),
  entry(
    "The Plain Dealer", "Common", "Direct",
    "Direct, compressed, agent-driven.",
    "Short, even, declarative.",
    "The city should replace its diesel buses with electric buses over five years. The switch cuts operating costs, lowers street-level pollution, and improves service reliability. Convert the highest-mileage routes first. Electrify one depot per year. Measure cost per mile and uptime at each step. Continue only where the numbers hold. Name the owner for each phase and hold them to it.",
  ),
  entry(
    "The Advocate", "Uncommon", "Rising, climactic",
    "Rising, climactic, emphatic.",
    "Rising, climactic, emphatic.",
    "Consider the cost of standing still: dirtier air, rising fuel bills, and buses riders cannot rely on. There is a better path. Convert the fleet to electric over five years and the returns compound — lower operating costs, cleaner streets, and service that finally earns public trust. The evidence is in. The technology is ready. The decision, at last, is ours to make.",
  ),
  entry(
    "The Narrator", "Common", "Characters as subjects",
    "Characters as subjects, old-to-new flow.",
    "Flowing, connected, sequential.",
    "The city runs a diesel bus fleet today. Those buses burn fuel the city pays for, and that fuel fouls the air along every route. Over the next five years the transit agency replaces them with electric buses. As it does, the agency spends less to operate each route, residents breathe cleaner air at each stop, and riders find the service they depend on growing steadily more reliable.",
  ),
  entry(
    "The Explainer", "Common", "Topic-string clarity",
    "Measured, explicit, stepwise.",
    "Steady, signposted, incremental.",
    "First, the goal: replace the city's diesel buses with electric buses. Next, the timeline: phase the conversion over five years. Then, the reasons: electric buses cost less to operate, they cut street-level pollution, and they improve service reliability. Finally, the method: convert the highest-mileage routes first, measure results at each step, and expand only where the savings and reliability gains are confirmed.",
  ),
  entry(
    "The Scholar", "Uncommon", "Formal register",
    "Formal, qualified, evidence-led.",
    "Long, qualified, precise.",
    "The proposed transition from diesel to electric transit over a five-year horizon warrants adoption, subject to stated conditions. The available evidence indicates reductions in operating expenditure, diminished street-level particulate emissions, and improved service reliability, provided that depot charging capacity and battery longevity meet specification. Implementation should proceed incrementally, with each phase contingent upon measured confirmation of the projected cost and reliability outcomes.",
  ),
  entry(
    "The Surgeon", "Uncommon", "Extreme concision",
    "Short, sharp, load-bearing.",
    "Very short. Clipped. Exact.",
    "Replace diesel buses with electric. Five years. Phase it. Lower operating cost. Cleaner air. Reliable service. Convert high-mileage routes first. One depot per year. Measure cost per mile. Measure uptime. Keep what pays. Cut what does not. Assign an owner per phase. Report quarterly. Decide on evidence, not hope.",
  ),
  entry(
    "The Diagnostician", "Uncommon", "Issue-discussion-point",
    "Issue, evidence, cause, point.",
    "Deliberate, weighed, sectioned.",
    "Issue: the diesel fleet is costly, polluting, and unreliable. Evidence: fuel and maintenance dominate operating cost, tailpipe emissions concentrate at stops, and breakdowns cluster in older units. Cause: aging diesel drivetrains. Point: a phased five-year conversion to electric addresses all three, but only if depot charging and battery life are verified per phase before full commitment.",
  ),
  entry(
    "The Conversationalist", "Uncommon", "Warm register",
    "Warm, varied, reader-facing.",
    "Relaxed, varied, direct.",
    "Here's the idea, plainly: swap the city's diesel buses for electric ones over about five years. Why bother? They're cheaper to run, they don't foul the air where people wait, and they break down less. We'd start with the busiest routes, watch the numbers closely, and keep going only where it clearly pays off. Sensible, measurable, and honestly overdue.",
  ),
  entry(
    "The Essayist", "Rare", "Periodic build",
    "Periodic, balanced, deliberate.",
    "Undulating, periodic, crafted.",
    "Over five years, as fuel costs mount and public patience with dirty, unreliable transit thins, a city that commits to replacing its diesel buses with electric ones — route by route, depot by depot, measured at every step — discovers something quietly transformative: the same decision that trims its operating budget also clears the air at every stop and restores the reliability its riders had stopped expecting.",
  ),
  entry(
    "The Weaver", "Rare", "Long, thematic",
    "Long, threaded, thematic.",
    "Long, nested, continuous.",
    "The thread that runs through every part of this proposal is cost that compounds: the fuel the diesel fleet burns is the same fuel that fouls the air, and the aging drivetrains that raise maintenance bills are the same units that strand riders — so a five-year electric conversion, pursued route by route, pulls all of these threads at once, lowering spend, clearing air, and steadying service together.",
  ),
  entry(
    "The Minimalist", "Rare", "Cumulative, spare",
    "Spare, cumulative, quiet.",
    "Flat, even, unhurried.",
    "The city replaces its diesel buses with electric ones over five years. The change lowers operating cost. It reduces street-level pollution. It improves reliability. The conversion proceeds route by route. Each phase is measured. Each phase must pay. What works continues. What does not stops. The plan is simple, and the plan is enough.",
  ),
  entry(
    "The Cartographer", "Rare", "Maps relationships",
    "Spatial, bounded, dependency-aware.",
    "Structured, oriented, layered.",
    "Map the system before moving: three connected regions — the fleet, the depots, and the grid — bounded by a five-year timeline. Conversion flows from fleet to depot to grid, each dependent on the last. Within that map, cost reduction, cleaner air, and reliability sit as distinct territories fed by the same route. Sequence the phases along these dependencies and the terrain stays navigable.",
  ),
  entry(
    "The Dialectician", "Rare", "Thesis-antithesis-synthesis",
    "Claim, counterclaim, synthesis.",
    "Oppositional then convergent.",
    "Thesis: convert the diesel fleet to electric to cut cost, pollution, and unreliability. Antithesis: batteries are expensive, grid capacity is uncertain, and cold weather degrades range. Synthesis: phase the conversion over five years, piloting the hardest cases first, so the cost and reliability claims are tested against the strongest objections before the city commits its full fleet.",
  ),
  entry(
    "The Crystallographer", "Epic", "Dense, complex",
    "Faceted, dense, independently testable.",
    "Dense, discrete, complete blocks.",
    "Facet one — economics: electric drivetrains lower cost per mile once battery replacement is amortized. Facet two — health: removing tailpipe emissions cuts particulate exposure precisely where riders wait. Facet three — reliability: fewer moving parts reduce breakdown frequency. Each facet is independently testable within the five-year program; the recommendation holds only where all three, measured separately, refract the same conclusion.",
  ),
  entry(
    "The Counselor", "Epic", "Warm transparency",
    "Warm, bounded, reader-respecting.",
    "Warm, measured, candid.",
    "I want to be straight with you about both the promise and the limits. Replacing diesel buses with electric ones over five years should lower operating costs, clean the air at every stop, and improve reliability — and those gains matter to real riders. But the savings depend on battery life and depot charging holding up, so we should phase it, measure honestly, and adjust together as we learn.",
  ),
  entry(
    "The Polymath", "Epic", "Cross-domain",
    "Analogical, bounded, integrative.",
    "Expansive, connective, elegant.",
    "Think of the fleet as a portfolio rotation: the city is swapping a depreciating, fuel-exposed asset for one with lower carrying cost and cleaner externalities — the transit equivalent of refinancing debt while insulating a building. Over five years that single integrative move draws on finance, public health, and grid engineering at once, cutting cost, clearing air, and steadying service as one coordinated position.",
  ),
  entry(
    "The Sentinel", "Epic", "Cautious",
    "Watchful, conditional, step-aware.",
    "Cautious, itemized, guarded.",
    "Proceed, but with explicit caveats. Assumption: five-year battery life meets duty cycle — verify before scaling. Assumption: depot grid capacity is sufficient — confirm with the utility first. Uncertainty: cold-weather range and replacement cost remain unproven at fleet scale. Recommendation: pilot the hardest routes, gate each phase on measured cost and uptime, and do not commit the full fleet until the reliability claim is demonstrated, not assumed.",
  ),
  entry(
    "The Strategist", "Legendary", "Military-grade concision",
    "Mission-driven, terse, gate-based.",
    "Terse, sectioned, decisive.",
    "SITUATION: Diesel fleet is costly, polluting, unreliable. MISSION: Convert to electric over five years. EXECUTION: Phase 1 — highest-mileage routes; Phase 2 — depot electrification; Phase 3 — full fleet, gated on measured cost/mile and uptime. ASSESSMENT: Proceed only where each phase clears its cost and reliability gate; otherwise hold. Expected end state — lower cost, cleaner air, dependable service.",
  ),
];

export function listPersonaGuide(): PersonaGuideEntry[] {
  return PERSONA_GUIDE;
}

export function getPersonaGuideEntry(name: string): PersonaGuideEntry | undefined {
  return PERSONA_GUIDE.find((p) => p.name === name);
}

/** Build the Side-by-side comparison markdown for two personas (A vs B). */
export function buildPersonaComparison(aName: string, bName: string): string {
  const a = getPersonaGuideEntry(aName);
  const b = getPersonaGuideEntry(bName);
  if (!a || !b) return "Select two personas to compare.";
  return [
    "# Williams Persona Comparison",
    "",
    `**Input:** "${SHARED_IDEA}"`,
    "",
    "---",
    "",
    `## ${a.name} (${a.tier})`,
    "",
    `**Description:** ${a.description}`,
    "",
    `**Key Traits:** ${a.cadence}`,
    "",
    "**Sample Output:**",
    a.transformation,
    "",
    "---",
    "",
    `## ${b.name} (${b.tier})`,
    "",
    `**Description:** ${b.description}`,
    "",
    `**Key Traits:** ${b.cadence}`,
    "",
    "**Sample Output:**",
    b.transformation,
  ].join("\n");
}
