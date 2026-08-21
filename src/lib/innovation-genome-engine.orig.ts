/**
 * innovation-genome-engine.ts
 * ============================================================================
 * INNOVATION GENOME ENGINE v1.0 — TypeScript port (browser-native, zero deps).
 *
 * Conway-inspired SEED-DRIVEN prompt compiler: a single integer seed
 * deterministically sets values across 21 innovation dimensions, producing a
 * complete Kerger-class discovery prompt that directs the LLM's approach to
 * novel problem-solving — exactly analogous to the Williams persona engine,
 * but targeting DISCOVERY mechanisms instead of prose style.
 *
 * "Conway" analogy: simple seed → complex emergent behavior. The seed sets the
 * initial configuration; dimension interactions (persona classification + path
 * selection) determine the emergent discovery strategy.
 *
 * 7 discovery nodes: P(roblem Choice) · A(nomaly Valuation) · E(mbodiment) ·
 * N(=Analogy) · V(=Evaluator Revision) · T(aste) · S(ocial Stabilization).
 *
 * Determinism: same seed ⇒ same genome, always (FNV-1a + xorshift mix over
 * `${seed}:${index}`). Reproducible across sessions and machines.
 *
 * HONESTY: this is a real prompt compiler producing real directive text. It
 * makes no claim of solving any open problem; it only shapes search strategy.
 * ============================================================================ */

export interface GenomeDimension {
  id: string;
  name: string;
  block: string;
  lowPole: string;
  highPole: string;
  description: string;
}

/** The 21 innovation dimensions — each a continuous 0.0–1.0 axis between two
 *  legitimate strategic poles (all positions are valid choices). */
export const DIMENSIONS: GenomeDimension[] = [
  { id: "problem_source", name: "Problem Source", block: "Problem Choice", lowPole: "externally assigned problem", highPole: "self-discovered / endogenous problem", description: "Where does the problem come from?" },
  { id: "problem_framing", name: "Problem Framing", block: "Problem Choice", lowPole: "accept given framing", highPole: "radically reframe before solving", description: "How much reframing before search begins?" },
  { id: "goal_fixity", name: "Goal Fixity", block: "Problem Choice", lowPole: "fixed objective throughout", highPole: "goal-space mutation allowed", description: "Can the objective itself change during search?" },
  { id: "anomaly_sensitivity", name: "Anomaly Sensitivity", block: "Anomaly Valuation", lowPole: "ignore outliers, seek central tendency", highPole: "maximize anomaly detection and pursuit", description: "How aggressively are surprises pursued?" },
  { id: "failure_treatment", name: "Failure Treatment", block: "Anomaly Valuation", lowPole: "discard failures quickly", highPole: "mine failures as primary data source", description: "Are failures signal or noise?" },
  { id: "anomaly_memory", name: "Anomaly Memory Persistence", block: "Anomaly Valuation", lowPole: "memoryless: each round fresh", highPole: "persistent cross-round anomaly buffer", description: "How long are anomalies remembered?" },
  { id: "world_contact", name: "World Contact", block: "Embodiment", lowPole: "pure symbolic reasoning", highPole: "world-in-the-loop: execute, measure, iterate", description: "How much real-world feedback enters the loop?" },
  { id: "artifact_concreteness", name: "Artifact Concreteness", block: "Embodiment", lowPole: "abstract proposals and sketches", highPole: "runnable code / falsifiable constructions only", description: "How concrete must every output be?" },
  { id: "cheap_falsification", name: "Cheap Falsification Priority", block: "Embodiment", lowPole: "build fully before testing", highPole: "falsify cheaply first, build only survivors", description: "When does testing happen relative to building?" },
  { id: "analogy_distance", name: "Analogy Distance", block: "Analogy", lowPole: "near-domain analogies only", highPole: "maximally distant cross-domain transfer", description: "How far afield should analogies reach?" },
  { id: "representation_diversity", name: "Representation Diversity", block: "Analogy", lowPole: "single representation throughout", highPole: "mandatory multi-representation portfolio", description: "How many different formalisms are tried?" },
  { id: "mechanism_independence", name: "Mechanism Independence", block: "Analogy", lowPole: "converge early on best approach", highPole: "enforce independence across families until late", description: "How long do parallel approaches stay isolated?" },
  { id: "evaluator_source", name: "Evaluator Source", block: "Evaluator Revision", lowPole: "use only externally supplied evaluator", highPole: "construct evaluator endogenously from the problem", description: "Where does the success criterion come from?" },
  { id: "evaluator_mutability", name: "Evaluator Mutability", block: "Evaluator Revision", lowPole: "evaluator is frozen throughout", highPole: "evaluator co-evolves with candidates", description: "Can the evaluator itself change during search?" },
  { id: "adversarial_intensity", name: "Adversarial Intensity", block: "Evaluator Revision", lowPole: "gentle self-check", highPole: "candidate-specific adversary: attacker = f(candidate)", description: "How hostile is the internal critic?" },
  { id: "taste_weight", name: "Taste Weight", block: "Taste", lowPole: "accept any correct solution", highPole: "strong aesthetic/elegance filter on correct solutions", description: "How much does beauty/depth matter beyond correctness?" },
  { id: "novelty_vs_utility", name: "Novelty-Utility Balance", block: "Taste", lowPole: "maximize utility even if conventional", highPole: "maximize novelty even if impractical", description: "Where on the novelty-utility tradeoff?" },
  { id: "termination_resistance", name: "Termination Resistance", block: "Taste", lowPole: "terminate on first valid answer", highPole: "matched-pair only: construction AND impossibility bound", description: "How hard is it to declare 'done'?" },
  { id: "independence_vs_consensus", name: "Independence vs Consensus", block: "Social Stabilization", lowPole: "defer to community consensus", highPole: "protect heretical ideas from premature consensus", description: "How much does community opinion gate acceptance?" },
  { id: "portfolio_breadth", name: "Portfolio Breadth", block: "Social Stabilization", lowPole: "single focused approach", highPole: "8+ independent mechanism families", description: "How many parallel approaches are maintained?" },
  { id: "negative_space_density", name: "Negative Space Density", block: "Social Stabilization", lowPole: "minimal exclusions", highPole: "30+ banned result-shapes with poisoned shortcuts", description: "How many near-miss solutions are explicitly banned?" },
];

export type Genome = Record<string, number>;

/** Deterministic 32-bit mix of `${seed}:${index}` (FNV-1a + xorshift finalizer). */
function mix32(seed: number, index: number): number {
  const s = `${seed}:${index}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Convert an integer seed to a deterministic genome (21 values in [0,1]). */
export function seedToGenome(seed: number): Genome {
  const genome: Genome = {};
  DIMENSIONS.forEach((dim, i) => {
    genome[dim.id] = Math.round((mix32(seed, i) / 0xffffffff) * 100) / 100;
  });
  return genome;
}

export interface InnovationPersona { name: string; tagline: string; }

/** Emergent personas from dimension clusters (first match wins; last = default). */
export const PERSONAS: Array<InnovationPersona & { match: (g: Genome) => boolean }> = [
  { name: "The Anomaly Hunter", tagline: "Chase the outlier. The exception IS the rule.", match: (g) => g.anomaly_sensitivity > 0.75 && g.failure_treatment > 0.7 },
  { name: "The Axiom Breaker", tagline: "What if the obvious assumption is simply false?", match: (g) => g.problem_framing > 0.8 && g.goal_fixity > 0.7 },
  { name: "The Bridge Builder", tagline: "The answer is in a field you haven't looked at yet.", match: (g) => g.analogy_distance > 0.8 && g.representation_diversity > 0.7 },
  { name: "The Tinkerer", tagline: "Build it. Break it. The wreckage is the data.", match: (g) => g.world_contact > 0.75 && g.cheap_falsification > 0.7 },
  { name: "The Connoisseur", tagline: "Correct isn't enough. It must be beautiful.", match: (g) => g.taste_weight > 0.8 && g.termination_resistance > 0.7 },
  { name: "The Adversary", tagline: "Your proof is guilty until proven innocent.", match: (g) => g.adversarial_intensity > 0.8 && g.negative_space_density > 0.7 },
  { name: "The Evaluator Inventor", tagline: "The real discovery is what 'success' means.", match: (g) => g.evaluator_source > 0.75 && g.evaluator_mutability > 0.7 },
  { name: "The Portfolio Manager", tagline: "Eight independent bets. One will be right.", match: (g) => g.portfolio_breadth > 0.8 && g.mechanism_independence > 0.7 },
  { name: "The Heretic", tagline: "Protect the weird idea. Consensus kills discovery.", match: (g) => g.independence_vs_consensus > 0.85 && g.novelty_vs_utility > 0.7 },
  { name: "The Methodical Explorer", tagline: "Every surface, mapped. Every corner, checked.", match: (g) => g.artifact_concreteness > 0.7 && g.anomaly_memory > 0.65 },
  { name: "The Plain Dealer", tagline: "Direct, compressed, no wasted moves.", match: () => true },
];

export function classifyPersona(genome: Genome): InnovationPersona {
  for (const p of PERSONAS) if (p.match(genome)) return { name: p.name, tagline: p.tagline };
  const last = PERSONAS[PERSONAS.length - 1];
  return { name: last.name, tagline: last.tagline };
}

export interface DiscoveryPath { id: string; name: string; seq: string; }

/** 16 canonical dependency-respecting discovery paths through the 7 nodes. */
const PATH_TABLE: Array<DiscoveryPath & { trigger: (g: Genome) => boolean }> = [
  { id: "γ", name: "Anomaly-Driven", seq: "A→P→E→V→N→T→S", trigger: (g) => g.anomaly_sensitivity > 0.8 },
  { id: "ζ", name: "Taste-Led", seq: "T→P→A→N→V→E→S", trigger: (g) => g.taste_weight > 0.85 },
  { id: "π", name: "Metric-Driven", seq: "V→P→A→E→N→T→S", trigger: (g) => g.evaluator_source > 0.85 && g.evaluator_mutability > 0.6 },
  { id: "ξ", name: "Imported Crisis", seq: "N→A→V→P→E→T→S", trigger: (g) => g.analogy_distance > 0.8 && g.adversarial_intensity > 0.6 },
  { id: "δ", name: "Tinkerer", seq: "E→A→P→N→V→T→S", trigger: (g) => g.world_contact > 0.8 },
  { id: "ο", name: "Prototype-First", seq: "P→E→A→N→V→T→S", trigger: (g) => g.cheap_falsification > 0.8 },
  { id: "ι", name: "Builder", seq: "E→P→A→V→N→T→S", trigger: (g) => g.artifact_concreteness > 0.8 },
  { id: "η", name: "Evaluator-First", seq: "P→V→A→E→N→T→S", trigger: (g) => g.evaluator_source > 0.8 },
  { id: "β", name: "Analogy-First", seq: "P→N→A→V→E→T→S", trigger: (g) => g.analogy_distance > 0.75 },
  { id: "ν", name: "Connoisseur", seq: "T→A→P→N→V→E→S", trigger: (g) => g.taste_weight > 0.8 && g.anomaly_sensitivity > 0.6 },
  { id: "μ", name: "Lab Accident", seq: "A→E→P→V→N→T→S", trigger: (g) => g.anomaly_sensitivity > 0.7 && g.world_contact > 0.7 },
  { id: "ε", name: "Theorist", seq: "N→P→V→A→E→T→S", trigger: (g) => g.analogy_distance > 0.7 && g.world_contact < 0.3 },
  { id: "θ", name: "Serendipitous Import", seq: "A→N→P→V→E→T→S", trigger: (g) => g.anomaly_sensitivity > 0.6 && g.analogy_distance > 0.6 },
  { id: "κ", name: "Dry Theorist", seq: "P→A→N→V→T→E→S", trigger: (g) => g.world_contact < 0.2 && g.taste_weight > 0.6 },
  { id: "λ", name: "Community-Initiated", seq: "S→P→A→E→N→V→T", trigger: (g) => g.independence_vs_consensus < 0.2 },
  { id: "α", name: "Full Classical", seq: "P→A→E→N→V→T→S", trigger: (g) => g.problem_source < 0.4 && g.anomaly_sensitivity > 0.5 },
];

const FALLBACK_PATH: DiscoveryPath = { id: "α", name: "Full Classical", seq: "P→A→E→N→V→T→S" };

export function selectPath(genome: Genome): DiscoveryPath {
  for (const p of PATH_TABLE) if (p.trigger(genome)) return { id: p.id, name: p.name, seq: p.seq };
  return FALLBACK_PATH;
}

function level(v: number): string {
  if (v < 0.2) return "minimal";
  if (v < 0.4) return "low";
  if (v < 0.6) return "moderate";
  if (v < 0.8) return "high";
  return "maximum";
}

function dimInstruction(dim: GenomeDimension, value: number): string {
  const pole = value < 0.5 ? dim.lowPole : dim.highPole;
  return `${dim.name.toUpperCase()} (${dim.block}): Lean toward: ${pole}. Intensity: ${level(value)} (${value.toFixed(2)}).`;
}

/** Compile a full Kerger-class innovation prompt from a genome. */
export function compileInnovationPrompt(
  genome: Genome,
  persona: InnovationPersona,
  path: DiscoveryPath,
  userProblem = "[INSERT PROBLEM HERE]",
  domain = "general",
): string {
  const dimBlock = DIMENSIONS.map((d) => dimInstruction(d, genome[d.id])).join("\n");
  const nFamilies = Math.max(2, Math.min(12, Math.floor(genome.portfolio_breadth * 12) + 1));
  const nBanned = Math.max(5, Math.min(35, Math.floor(genome.negative_space_density * 35) + 1));
  const adversary = genome.adversarial_intensity > 0.6
    ? "candidate-specific adversary: construct attacker as f(candidate)"
    : "structured self-check with itemized audit";
  const termination = genome.termination_resistance > 0.6
    ? "matched-pair termination: accept only construction AND matching bound"
    : "single-sided: accept first verified result";
  const evaluatorClause = genome.evaluator_mutability > 0.6
    ? "You MAY construct new evaluation criteria endogenously from the problem structure. The evaluator itself may evolve as understanding deepens."
    : "Use only the evaluation criteria specified in the problem statement. Do not modify the success criterion.";
  const anomalyClause = genome.anomaly_memory > 0.6
    ? "Maintain a persistent ANOMALY BUFFER across all rounds. Every surprise, outlier, or failed expectation must be logged and revisited. Anomalies are primary data, not noise."
    : "Focus on central results. Note anomalies but do not let them divert the main search.";
  const tasteClause = genome.taste_weight > 0.6
    ? "Apply an aesthetic filter: among correct solutions, prefer those that are deep, surprising, elegant, or maximally explanatory. Reject correct-but-pedestrian when a deeper alternative exists."
    : "Accept any correct solution. Elegance is secondary to correctness.";
  const goalClause = genome.goal_fixity > 0.6
    ? "GOAL-SPACE MUTATION IS PERMITTED. If evidence suggests the objective is ill-posed or has a deeper reformulation, propose a revised objective with explicit justification."
    : "The objective is FIXED. Do not modify the success criterion.";
  const worldClause = genome.world_contact > 0.6
    ? "WORLD-IN-THE-LOOP: Every candidate must be tested against reality (executed code, computed examples, measurements, or formal verification). No candidate survives on plausibility alone."
    : "Symbolic reasoning is the primary mode. Computational testing is encouraged but not mandatory for every candidate.";

  return `# INNOVATION GENOME: FRACTAL DISCOVERY CONTRACT

## 0. INNOVATION PERSONA: "${persona.name}" — ${persona.tagline}
DISCOVERY PATH: ${path.id} (${path.name}): ${path.seq}

Adopt the following discovery profile. All positions are valid conscious choices for THIS configuration.

${dimBlock}

## 1. PROBLEM SPECIFICATION
${userProblem}
Domain: ${domain}

## 2. STRATEGIC DIRECTIVES (derived from genome)
PORTFOLIO: Seed ${nFamilies} genuinely different mechanism families. Group by MECHANISM, not vocabulary. Enforce early independence.
NEGATIVE SPACE: Before searching, enumerate at least ${nBanned} result-shapes that LOOK like solutions but are not. For the most tempting shortcut, explain precisely WHY it fails.
ADVERSARY: ${adversary}
TERMINATION: ${termination}
${evaluatorClause}
${anomalyClause}
${tasteClause}
${goalClause}
${worldClause}

## 3. PROCESS CONSTRAINTS (invariants)
TERMINATION SUPPRESSION: The fact that a problem is labeled "open" or "hard" is not permission to stop. Continue constructive search through the declared budget. Never claim resolution unless all verification gates pass.
CONCRETE ARTIFACTS ONLY: Every reasoning round returns a falsifiable object: lemma with proof, explicit construction with verified certificate, counterexample, or quantitative bound. Reject status reports, optimism, and "standard/routine."
REGISTRY: Maintain one record per approach family: BRANCH_ID | REPRESENTATION | CENTRAL LEMMA | ESTABLISHED | UNRESOLVED | GAP_CLASS (local|theorem-strength) | COUNTEREXAMPLES | STATUS | REOPEN_CONDITION
REPAIR WITHOUT INHERITANCE: A repaired candidate re-enters audit with zero credit from its previous version, plus a new attacker targeting the repair itself.
QUANTIFIER ORDER: For any claimed bound or impossibility, state the exact logical form with all quantifiers explicit.
IMPORTED RESULTS: For every imported theorem: (1) restate ALL hypotheses; (2) map each object to THIS problem; (3) verify parameter/norm/domain/precision alignment; (4) reject the import if any obligation remains unproved.

## 4. RESOLUTION LATTICE (keep ALL live until evidence eliminates)
1. direct proof or construction · 2. explicit counterexample · 3. reduction to known result · 4. stronger statement with simpler invariant · 5. weaker bridge theorem · 6. algorithmic construction · 7. lower bound or impossibility · 8. conditional result with explicit assumptions · 9. machine-checkable certificate · 10. specification inconsistency

## 5. FRACTAL BOTTLENECK RECURSION
For each unresolved bottleneck: restate as a child problem with exact objects and quantifiers; state which parent claim it unlocks; enumerate its near-miss solutions; generate ≥3 representation-distinct attacks; build a candidate-specific attacker; define the strongest available checker; solve, falsify, or block; return only certified results to the parent. Recurse ONLY on the active bottleneck.

## 6. FINAL OUTPUT CONTRACT
1. RESULT STATUS: verified | supported partial | counterexample | blocked | unknown
2. PRECISE CLAIM · 3. ARTIFACT · 4. CORRECTNESS EVIDENCE · 5. RESOURCE ACCOUNTING
6. ADVERSARIAL AUDIT · 7. EVIDENCE AND PROVENANCE · 8. RESIDUAL GAPS · 9. ANOMALY BUFFER`;
}

export interface DimensionReport {
  id: string; name: string; block: string; value: number; level: string; lowPole: string; highPole: string;
}

export interface InnovationGenomeResult {
  seed: number;
  genome: Genome;
  persona: InnovationPersona;
  path: DiscoveryPath;
  prompt: string;
  dimensionReport: DimensionReport[];
}

/** Roll a new innovation genome from a seed (random if omitted). */
export function roll(seed?: number, userProblem = "[INSERT PROBLEM HERE]", domain = "general"): InnovationGenomeResult {
  const s = seed === undefined || seed === null ? Math.floor(Math.random() * 0xffffffff) : seed;
  const genome = seedToGenome(s);
  const persona = classifyPersona(genome);
  const path = selectPath(genome);
  const dimensionReport: DimensionReport[] = DIMENSIONS.map((d) => ({
    id: d.id, name: d.name, block: d.block, value: genome[d.id], level: level(genome[d.id]), lowPole: d.lowPole, highPole: d.highPole,
  }));
  return { seed: s, genome, persona, path, prompt: compileInnovationPrompt(genome, persona, path, userProblem, domain), dimensionReport };
}

export const reroll = (userProblem?: string, domain?: string) => roll(undefined, userProblem, domain);
export const pin = (seed: number, userProblem?: string, domain?: string) => roll(seed, userProblem, domain);

/** Compact directive (~400 tokens) for injection into the live V15 pipeline. */
export function compileCompactDirective(result: InnovationGenomeResult): string {
  const g = result.genome;
  const nFamilies = Math.max(2, Math.min(12, Math.floor(g.portfolio_breadth * 12) + 1));
  const nBanned = Math.max(5, Math.min(35, Math.floor(g.negative_space_density * 35) + 1));
  return [
    `INNOVATION GENOME (seed ${result.seed}) — persona "${result.persona.name}": ${result.persona.tagline}`,
    `DISCOVERY PATH ${result.path.id} (${result.path.name}): ${result.path.seq}`,
    `PORTFOLIO: seed ${nFamilies} mechanism-distinct approaches; group by MECHANISM not vocabulary.`,
    `NEGATIVE SPACE: name at least ${nBanned} result-shapes that look like answers but are not, and say why the most tempting one fails.`,
    g.adversarial_intensity > 0.6 ? "ADVERSARY: build a candidate-specific attacker A(C) for each claim." : "ADVERSARY: itemized structured self-check.",
    g.termination_resistance > 0.6 ? "TERMINATION: matched-pair only (construction AND bound)." : "TERMINATION: first verified result acceptable.",
    g.anomaly_memory > 0.6 ? "ANOMALY BUFFER: log every surprise/outlier and revisit it; anomalies are primary data." : "",
    g.analogy_distance > 0.6 ? "ANALOGY: reach into a distant domain for structural transfer, then verify the mapping." : "",
    g.taste_weight > 0.6 ? "TASTE: among correct answers prefer the deeper, more explanatory one." : "",
    "CONCRETE ARTIFACTS ONLY: every section yields a falsifiable object (number, derivation, bound, counterexample). No status reports.",
  ].filter(Boolean).join("\n");
}

const GENOME_KEY = "veritas.v15.innovationGenome";

export function isInnovationGenomeEnabled(): boolean {
  try { return localStorage.getItem(GENOME_KEY) !== "false"; } catch { return true; }
}
export function setInnovationGenomeEnabled(on: boolean): void {
  try { localStorage.setItem(GENOME_KEY, on ? "true" : "false"); } catch { /* ignore */ }
}

/** Terminal-friendly display. */
export function display(ig: InnovationGenomeResult): string {
  const lines: string[] = [
    `Innovation Persona: ${ig.persona.name}`,
    `${ig.persona.tagline}`,
    `seed ${ig.seed}`,
    `Discovery Path: ${ig.path.id} (${ig.path.name}): ${ig.path.seq}`,
    `${DIMENSIONS.length} innovation dimensions`,
    "",
  ];
  for (const dr of ig.dimensionReport) {
    const pos = Math.max(0, Math.min(20, Math.round(dr.value * 20)));
    const bar = "─".repeat(pos) + "●" + "─".repeat(20 - pos);
    lines.push(`  ${dr.name.padEnd(30)} [${bar}] ${dr.value.toFixed(2)}  (${dr.lowPole.slice(0, 25)}...→...${dr.highPole.slice(0, 25)})`);
  }
  return lines.join("\n");
}

export function runInnovationGenomeDiagnostics(): { ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> } {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });

  const g1 = seedToGenome(42);
  const g2 = seedToGenome(42);
  add("same-seed-same-genome", JSON.stringify(g1) === JSON.stringify(g2), "deterministic");
  add("different-seed-differs", JSON.stringify(seedToGenome(42)) !== JSON.stringify(seedToGenome(43)), "entropy spread");
  add("all-21-dimensions", Object.keys(g1).length === 21 && DIMENSIONS.every((d) => typeof g1[d.id] === "number"), `n=${Object.keys(g1).length}`);
  add("values-in-range", Object.values(g1).every((v) => v >= 0 && v <= 1), "0..1 bounded");

  const flat: Genome = {}; DIMENSIONS.forEach((d) => { flat[d.id] = 0.5; });
  const anomalyG = { ...flat, anomaly_sensitivity: 0.9, failure_treatment: 0.9 };
  add("persona-anomaly-hunter", classifyPersona(anomalyG).name === "The Anomaly Hunter", classifyPersona(anomalyG).name);
  add("persona-always-returns", !!classifyPersona(flat).name, classifyPersona(flat).name);

  const analogyG = { ...flat, analogy_distance: 0.9, anomaly_sensitivity: 0.3 };
  add("path-analogy-first", selectPath(analogyG).id === "β", selectPath(analogyG).id);
  add("path-always-returns", !!selectPath(flat).seq, selectPath(flat).seq);

  const r = pin(495915686, "Prove X.", "mathematics");
  const p = r.prompt;
  add("prompt-sections", ["INNOVATION GENOME", "NEGATIVE SPACE", "ADVERSARY", "TERMINATION", "REGISTRY", "QUANTIFIER ORDER", "ANOMALY BUFFER"].every((k) => p.includes(k)), "all sections present");
  add("prompt-contains-problem", p.includes("Prove X."), "problem embedded");
  add("prompt-length-reasonable", p.length > 2000 && p.length < 20000, `len=${p.length}`);
  add("compact-directive", compileCompactDirective(r).length > 200, `len=${compileCompactDirective(r).length}`);

  return { ok: checks.every((c) => c.passed), checks };
}
