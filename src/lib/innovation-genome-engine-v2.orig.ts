/**
 * innovation-genome-engine-v2.ts
 * ============================================================================
 * ADDITIVE v2 over innovation-genome-engine.ts. v1 source and exports remain
 * untouched. Browser/Node compatible, zero external dependencies.
 *
 * Adds:
 * - 14 personas (25 total with v1), 8 cyclic paths (24 total with v1)
 * - five deterministic systematic mutations
 * - three deterministic crossover operators
 * - four-objective FitnessVector + Pareto/MAP-Elites archive
 * - deterministic island migration and evaluator-driven evolution
 * - persistent anomaly and failure-certificate archives
 * - 16 domain packs, safety and capability-reality gates
 * - JSON Schema export and pure diagnostics
 *
 * No candidate receives fitness without a caller-supplied evaluator. This
 * engine compiles and evolves search directives; it does not claim that an
 * unevaluated directive solves the user's problem.
 * ============================================================================ */

import {
  DIMENSIONS,
  classifyPersona,
  compileInnovationPrompt,
  seedToGenome,
  selectPath,
  type DiscoveryPath,
  type Genome,
  type InnovationPersona,
} from "./innovation-genome-engine";

export { DIMENSIONS } from "./innovation-genome-engine";

// ── Deterministic random source ─────────────────────────────────────────────

function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  choice<T>(values: readonly T[]): T {
    if (!values.length) throw new Error("choice requires a non-empty array");
    return values[this.int(0, values.length - 1)];
  }

  shuffle<T>(values: readonly T[]): T[] {
    const output = [...values];
    for (let i = output.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [output[i], output[j]] = [output[j], output[i]];
    }
    return output;
  }

  sample<T>(values: readonly T[], count: number): T[] {
    return this.shuffle(values).slice(0, Math.max(0, Math.min(count, values.length)));
  }
}

function seededRng(parentSeed: number, operationIndex = 0, namespace = "mut"): SeededRng {
  return new SeededRng(hash32(`${namespace}:${parentSeed}:${operationIndex}`));
}

function clampUnit(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function cloneGenome(genome: Genome): Genome {
  return Object.fromEntries(Object.entries(genome).map(([key, value]) => [key, value]));
}

// ── Extended personas and paths ─────────────────────────────────────────────

interface PersonaRule extends InnovationPersona {
  match: (genome: Genome) => boolean;
}

export const EXTENDED_PERSONAS: readonly PersonaRule[] = [
  { name: "The Diagonalizer", tagline: "The system contains its own contradiction. Find it.", match: (g) => g.problem_framing > 0.75 && g.adversarial_intensity > 0.75 },
  { name: "The Dormancy Prospector", tagline: "The tool you need was invented 50 years ago for something else.", match: (g) => g.analogy_distance > 0.85 && g.anomaly_memory > 0.6 },
  { name: "The Reality Grinder", tagline: "The world pushes back. Listen to the wreckage.", match: (g) => g.world_contact > 0.85 && g.failure_treatment > 0.7 },
  { name: "The Category Creator", tagline: "Name the new kind of thing. Solving it comes second.", match: (g) => g.problem_framing > 0.85 && g.novelty_vs_utility > 0.7 },
  { name: "The Meta-Problemist", tagline: "Why does this class of problems even exist?", match: (g) => g.problem_source > 0.8 && g.goal_fixity > 0.75 },
  { name: "The Serendipity Fisher", tagline: "Cast wide nets. Recognize the strange catch.", match: (g) => g.anomaly_sensitivity > 0.7 && g.portfolio_breadth > 0.7 },
  { name: "The Symmetry Elevator", tagline: "The pattern isn't coincidence. Make it the first principle.", match: (g) => g.representation_diversity > 0.75 && g.taste_weight > 0.7 },
  { name: "The Constraint Injector", tagline: "Add a rule to expose what the old rules were hiding.", match: (g) => g.adversarial_intensity > 0.75 && g.problem_framing > 0.6 },
  { name: "The Failure Archivist", tagline: "The dead ends map the live ones.", match: (g) => g.failure_treatment > 0.85 && g.anomaly_memory > 0.7 },
  { name: "The Reformulator", tagline: "Change the language. The answer appears.", match: (g) => g.representation_diversity > 0.85 && g.analogy_distance > 0.6 },
  { name: "The Slow Hunch", tagline: "Years of accumulation. One moment of connection.", match: (g) => g.anomaly_memory > 0.85 && g.termination_resistance > 0.7 },
  { name: "The Aesthetic Adversary", tagline: "Ugly proofs are wrong proofs waiting to fail.", match: (g) => g.taste_weight > 0.85 && g.adversarial_intensity > 0.6 },
  { name: "The Reduction Artist", tagline: "Show that this problem IS that solved problem.", match: (g) => g.analogy_distance > 0.7 && g.artifact_concreteness > 0.7 },
  { name: "The Boundary Interrogator", tagline: "Extreme cases reveal what typical cases hide.", match: (g) => g.anomaly_sensitivity > 0.65 && g.cheap_falsification > 0.75 },
];

export function classifyPersonaExtended(genome: Genome): InnovationPersona {
  for (const persona of EXTENDED_PERSONAS) {
    if (persona.match(genome)) return { name: persona.name, tagline: persona.tagline };
  }
  const v1 = classifyPersona(genome);
  // Keep v1 untouched, but avoid name collision with the Williams writer
  // roster in the live v2 system.
  return v1.name === "The Plain Dealer"
    ? { name: "The Unvarnished Operator", tagline: v1.tagline }
    : v1;
}

interface PathRule extends DiscoveryPath {
  trigger: (genome: Genome) => boolean;
}

export const EXTENDED_PATH_TABLE: readonly PathRule[] = [
  { id: "ρ", name: "Evaluator-Anomaly Spiral", seq: "P→(A↔V)*→N→T→S", trigger: (g) => g.evaluator_mutability > 0.7 && g.anomaly_sensitivity > 0.7 },
  { id: "σ", name: "Build-Test-Import Cycle", seq: "E→A→N→V→(E↔A)*→T→S", trigger: (g) => g.world_contact > 0.7 && g.representation_diversity > 0.65 },
  { id: "τ", name: "Taste-Gated Traversal", seq: "T→P→T→A→T→N→T→V→T→E→T→S", trigger: (g) => g.taste_weight > 0.9 },
  { id: "υ", name: "Community-Feedback Loop", seq: "P→A→E→N→V→T→S→P'→...", trigger: (g) => g.independence_vs_consensus < 0.15 && g.portfolio_breadth > 0.5 },
  { id: "φ", name: "Portfolio-Then-Prune", seq: "P→[N₁,N₂,...,Nₖ]→A→V→T→E→S", trigger: (g) => g.portfolio_breadth > 0.85 && g.mechanism_independence > 0.75 },
  { id: "χ", name: "Adversary-First", seq: "V→P→A→E→N→T→S", trigger: (g) => g.adversarial_intensity > 0.85 && g.evaluator_source > 0.5 },
  { id: "ψ", name: "Reformulation Cascade", seq: "P→N₁→N₂→N₃→A→V→E→T→S", trigger: (g) => g.representation_diversity > 0.85 && g.problem_framing > 0.7 },
  { id: "ω", name: "Terminal-Node Amplifier", seq: "P→A→E→N→V→T→S→S'→S''", trigger: (g) => g.termination_resistance > 0.85 && g.independence_vs_consensus > 0.6 },
];

export function selectPathExtended(genome: Genome): DiscoveryPath {
  for (const path of EXTENDED_PATH_TABLE) {
    if (path.trigger(genome)) return { id: path.id, name: path.name, seq: path.seq };
  }
  return selectPath(genome);
}

// ── Systematic mutation operators ──────────────────────────────────────────

export const DIMENSION_BLOCKS: Readonly<Record<string, readonly string[]>> = (() => {
  const blocks: Record<string, string[]> = {};
  for (const dimension of DIMENSIONS) {
    (blocks[dimension.block] ??= []).push(dimension.id);
  }
  return blocks;
})();

export type MutationKind = "nudge" | "flip" | "block_rotate" | "pole_swap" | "dimension_mask";

export interface MutationOptions {
  magnitude?: number;
  fraction?: number;
  keepIds?: readonly string[];
}

export function mutateNudge(base: Genome, parentSeed: number, operationIndex = 0, options: MutationOptions = {}): Genome {
  const rng = seededRng(parentSeed, operationIndex, "nudge");
  const output = cloneGenome(base);
  const keys = rng.shuffle(Object.keys(output));
  const count = Math.max(1, Math.floor(keys.length * Math.max(0, Math.min(1, options.fraction ?? 0.3))));
  const magnitude = Math.max(0, Math.min(1, options.magnitude ?? 0.15));
  for (const key of keys.slice(0, count)) {
    output[key] = clampUnit(output[key] + (rng.next() * 2 - 1) * magnitude);
  }
  return output;
}

export function mutateFlip(base: Genome, parentSeed: number, operationIndex = 0, options: MutationOptions = {}): Genome {
  const rng = seededRng(parentSeed, operationIndex, "flip");
  const output = cloneGenome(base);
  const keys = rng.shuffle(Object.keys(output));
  const count = Math.max(1, Math.floor(keys.length * Math.max(0, Math.min(1, options.fraction ?? 0.2))));
  for (const key of keys.slice(0, count)) output[key] = clampUnit(1 - output[key]);
  return output;
}

export function mutateBlockRotate(base: Genome, parentSeed: number, operationIndex = 0): Genome {
  const rng = seededRng(parentSeed, operationIndex, "block-rotate");
  const output = cloneGenome(base);
  const blocks = Object.keys(DIMENSION_BLOCKS).filter((block) => DIMENSION_BLOCKS[block].length > 1);
  const ids = [...DIMENSION_BLOCKS[rng.choice(blocks)]];
  const values = ids.map((id) => output[id]);
  const shift = rng.int(1, values.length - 1);
  ids.forEach((id, index) => { output[id] = values[(index - shift + values.length) % values.length]; });
  return output;
}

export function mutatePoleSwap(base: Genome, parentSeed: number, operationIndex = 0): Genome {
  const rng = seededRng(parentSeed, operationIndex, "pole-swap");
  const output = cloneGenome(base);
  const blocks = Object.keys(DIMENSION_BLOCKS).filter((block) => DIMENSION_BLOCKS[block].length >= 2);
  const [left, right] = rng.sample(DIMENSION_BLOCKS[rng.choice(blocks)], 2);
  [output[left], output[right]] = [output[right], output[left]];
  return output;
}

export function mutateDimensionMask(base: Genome, parentSeed: number, operationIndex = 0, options: MutationOptions = {}): Genome {
  const rng = seededRng(parentSeed, operationIndex, "dimension-mask");
  const output = cloneGenome(base);
  const keep = new Set(options.keepIds ?? ["taste_weight", "adversarial_intensity", "world_contact"]);
  for (const key of Object.keys(output)) {
    if (!keep.has(key)) output[key] = clampUnit(rng.next());
  }
  return output;
}

export function applyMutation(base: Genome, parentSeed: number, kind: MutationKind = "nudge", operationIndex = 0, options: MutationOptions = {}): Genome {
  switch (kind) {
    case "nudge": return mutateNudge(base, parentSeed, operationIndex, options);
    case "flip": return mutateFlip(base, parentSeed, operationIndex, options);
    case "block_rotate": return mutateBlockRotate(base, parentSeed, operationIndex);
    case "pole_swap": return mutatePoleSwap(base, parentSeed, operationIndex);
    case "dimension_mask": return mutateDimensionMask(base, parentSeed, operationIndex, options);
    default: throw new Error(`Unknown mutation kind: ${String(kind)}`);
  }
}

// ── Semantic crossover operators ────────────────────────────────────────────

export type CrossoverKind = "uniform" | "block" | "pareto_weighted";

export function crossoverUniform(parentA: Genome, parentB: Genome, seed: number, operationIndex = 0): Genome {
  const rng = seededRng(seed, operationIndex, "cross-uniform");
  const output: Genome = {};
  for (const key of Object.keys(parentA)) output[key] = rng.next() < 0.5 ? parentA[key] : parentB[key];
  return output;
}

export function crossoverBlock(parentA: Genome, parentB: Genome, seed: number, operationIndex = 0): Genome {
  const rng = seededRng(seed, operationIndex, "cross-block");
  const output: Genome = {};
  for (const ids of Object.values(DIMENSION_BLOCKS)) {
    const source = rng.next() < 0.5 ? parentA : parentB;
    for (const id of ids) output[id] = source[id];
  }
  return output;
}

export function crossoverParetoWeighted(
  parentA: Genome,
  parentB: Genome,
  fitnessA: number,
  fitnessB: number,
  seed: number,
  operationIndex = 0,
): Genome {
  const rng = seededRng(seed, operationIndex, "cross-pareto");
  const total = Math.max(1e-9, Math.max(0, fitnessA) + Math.max(0, fitnessB));
  const weightA = Math.max(0, fitnessA) / total;
  const output: Genome = {};
  for (const key of Object.keys(parentA)) {
    output[key] = rng.next() < 0.7
      ? clampUnit(weightA * parentA[key] + (1 - weightA) * parentB[key])
      : (rng.next() < weightA ? parentA[key] : parentB[key]);
  }
  return output;
}

export function applyCrossover(
  parentA: Genome,
  parentB: Genome,
  kind: CrossoverKind,
  seed: number,
  operationIndex = 0,
  fitnessA = 0.5,
  fitnessB = 0.5,
): Genome {
  switch (kind) {
    case "uniform": return crossoverUniform(parentA, parentB, seed, operationIndex);
    case "block": return crossoverBlock(parentA, parentB, seed, operationIndex);
    case "pareto_weighted": return crossoverParetoWeighted(parentA, parentB, fitnessA, fitnessB, seed, operationIndex);
    default: throw new Error(`Unknown crossover kind: ${String(kind)}`);
  }
}

// ── Multi-objective fitness and MAP-Elites/Pareto archive ───────────────────

export class FitnessVector {
  constructor(
    public readonly novelty = 0,
    public readonly utility = 0,
    public readonly tractability = 0,
    public readonly robustness = 0,
  ) {
    for (const value of this.asTuple()) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Fitness values must be finite and in [0,1]");
    }
  }

  asTuple(): readonly [number, number, number, number] {
    return [this.novelty, this.utility, this.tractability, this.robustness];
  }

  score(weights: readonly [number, number, number, number] = [0.25, 0.25, 0.25, 0.25]): number {
    return this.asTuple().reduce((sum, value, index) => sum + value * weights[index], 0);
  }

  dominates(other: FitnessVector): boolean {
    const mine = this.asTuple();
    const theirs = other.asTuple();
    return mine.every((value, index) => value >= theirs[index]) && mine.some((value, index) => value > theirs[index]);
  }
}

export interface GenomeEntryInit {
  seed: number;
  genome: Genome;
  fitness?: FitnessVector;
  lineage?: number[];
  notes?: string;
}

export class GenomeEntry {
  readonly seed: number;
  readonly genome: Genome;
  readonly fitness: FitnessVector;
  readonly lineage: number[];
  readonly notes: string;

  constructor(init: GenomeEntryInit) {
    this.seed = init.seed;
    this.genome = cloneGenome(init.genome);
    this.fitness = init.fitness ?? new FitnessVector();
    this.lineage = [...(init.lineage ?? [init.seed])];
    this.notes = init.notes ?? "";
  }

  behavioralSignature(): readonly [number, number, number] {
    const bin = (id: string) => Math.min(9, Math.floor(this.genome[id] * 10));
    return [bin("analogy_distance"), bin("world_contact"), bin("taste_weight")];
  }

  clone(): GenomeEntry {
    return new GenomeEntry({ seed: this.seed, genome: this.genome, fitness: this.fitness, lineage: this.lineage, notes: this.notes });
  }
}

export class ParetoArchive {
  private readonly cells = new Map<string, GenomeEntry>();
  private pareto: GenomeEntry[] = [];

  add(entry: GenomeEntry): boolean {
    const cellKey = entry.behavioralSignature().join(":");
    const incumbent = this.cells.get(cellKey);
    let changed = false;
    if (!incumbent || entry.fitness.score() > incumbent.fitness.score()) {
      this.cells.set(cellKey, entry.clone());
      changed = true;
    }

    if (!this.pareto.some((existing) => existing.fitness.dominates(entry.fitness))) {
      this.pareto = this.pareto.filter((existing) => !entry.fitness.dominates(existing.fitness) && existing.seed !== entry.seed);
      this.pareto.push(entry.clone());
      this.pareto.sort((a, b) => b.fitness.score() - a.fitness.score() || a.seed - b.seed);
      changed = true;
    }
    return changed;
  }

  size(): number { return this.cells.size; }
  front(): GenomeEntry[] { return this.pareto.map((entry) => entry.clone()); }
  entries(): GenomeEntry[] { return Array.from(this.cells.values()).map((entry) => entry.clone()); }

  sampleParent(seed: number): GenomeEntry | null {
    const values = this.entries();
    if (!values.length) return null;
    return seededRng(seed, 0, "archive-parent").choice(values);
  }

  toJSON(): unknown {
    return {
      nCells: this.cells.size,
      nParetoFront: this.pareto.length,
      cells: this.entries().map((entry) => ({ signature: entry.behavioralSignature(), seed: entry.seed, fitness: entry.fitness.asTuple(), lineage: entry.lineage, notes: entry.notes })),
      paretoFront: this.front().map((entry) => ({ seed: entry.seed, fitness: entry.fitness.asTuple() })),
    };
  }
}

// ── Island model and evaluator-driven evolution ─────────────────────────────

export class Island {
  readonly population: GenomeEntry[] = [];
  readonly archive = new ParetoArchive();
  generation = 0;

  constructor(public readonly name: string) {}

  add(entry: GenomeEntry): void {
    this.population.push(entry.clone());
    this.archive.add(entry);
  }
}

export class IslandManager {
  readonly islands: Island[];

  constructor(count = 3) {
    if (!Number.isInteger(count) || count < 1) throw new Error("Island count must be a positive integer");
    this.islands = Array.from({ length: count }, (_, index) => new Island(`island-${index}`));
  }

  migrate(seed: number, migrantsPerIsland = 1): number {
    if (this.islands.length < 2) return 0;
    const rng = seededRng(seed, 0, "island-migrate");
    const transfers: Array<{ target: Island; entries: GenomeEntry[] }> = [];
    this.islands.forEach((island, index) => {
      const front = island.archive.front();
      if (!front.length) return;
      transfers.push({
        target: this.islands[(index + 1) % this.islands.length],
        entries: rng.sample(front, Math.min(Math.max(0, migrantsPerIsland), front.length)),
      });
    });
    let migrations = 0;
    for (const transfer of transfers) {
      for (const entry of transfer.entries) {
        transfer.target.add(entry);
        migrations += 1;
      }
    }
    return migrations;
  }

  toJSON(): unknown {
    return { nIslands: this.islands.length, islands: this.islands.map((island) => ({ name: island.name, generation: island.generation, nCells: island.archive.size(), population: island.population.length })) };
  }
}

export type GenomeEvaluator = (candidate: Genome, context: { seed: number; lineage: number[] }) => Promise<FitnessVector> | FitnessVector;

/**
 * Generate and genuinely evaluate one deterministic mutation generation.
 * Fitness comes only from the supplied evaluator; the engine never invents it.
 */
export async function evolveGeneration(
  parent: GenomeEntry,
  evaluator: GenomeEvaluator,
  options: { count?: number; operationSeed?: number; kinds?: readonly MutationKind[] } = {},
): Promise<GenomeEntry[]> {
  const count = Math.max(1, Math.min(64, Math.floor(options.count ?? 5)));
  const kinds = options.kinds?.length ? options.kinds : (["nudge", "flip", "block_rotate", "pole_swap", "dimension_mask"] as const);
  const operationSeed = options.operationSeed ?? parent.seed;
  const children: GenomeEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const kind = kinds[index % kinds.length];
    const childSeed = hash32(`child:${operationSeed}:${parent.seed}:${index}`);
    const genome = applyMutation(parent.genome, parent.seed, kind, index);
    const lineage = [...parent.lineage, childSeed];
    const fitness = await evaluator(genome, { seed: childSeed, lineage });
    children.push(new GenomeEntry({ seed: childSeed, genome, fitness, lineage, notes: `mutation=${kind}; parent=${parent.seed}` }));
  }
  return children;
}

// ── Persistent anomaly and failure certificate memory ──────────────────────

export interface AnomalyRecord {
  id: string;
  description: string;
  roundSeen: number;
  resolved?: boolean;
  hypothesizedMechanism?: string;
}

export class AnomalyBuffer {
  private records: AnomalyRecord[];

  constructor(initial: readonly AnomalyRecord[] = []) {
    this.records = initial.map((record) => ({ ...record }));
  }

  log(record: AnomalyRecord): void {
    const index = this.records.findIndex((item) => item.id === record.id);
    if (index >= 0) this.records[index] = { ...record };
    else this.records.push({ ...record });
  }

  unresolved(): AnomalyRecord[] { return this.records.filter((record) => !record.resolved).map((record) => ({ ...record })); }

  resolve(id: string, mechanism: string): boolean {
    const record = this.records.find((item) => item.id === id);
    if (!record) return false;
    record.resolved = true;
    record.hypothesizedMechanism = mechanism;
    return true;
  }

  toPromptBlock(): string {
    if (!this.records.length) return "No anomalies logged yet.";
    return ["ANOMALY BUFFER (persistent across rounds):", ...this.records.map((record) => `  [${record.resolved ? "RESOLVED" : "OPEN"}] ${record.id} (round ${record.roundSeen}): ${record.description}${record.hypothesizedMechanism ? `\n    → mechanism: ${record.hypothesizedMechanism}` : ""}`)].join("\n");
  }

  toJSON(): AnomalyRecord[] { return this.records.map((record) => ({ ...record })); }
}

export interface FailureCertificate {
  route: string;
  centralMechanism: string;
  strongestEstablished: string;
  minimalCounterexample: string;
  unresolvedObligation: string;
  gapClass: "local" | "theorem-strength" | "model-mismatch" | "resource-barrier";
  reopenCondition: string;
}

export class FailureArchive {
  private certificates: FailureCertificate[];

  constructor(initial: readonly FailureCertificate[] = []) {
    this.certificates = initial.map((certificate) => ({ ...certificate }));
  }

  add(certificate: FailureCertificate): void { this.certificates.push({ ...certificate }); }
  matching(route: string): FailureCertificate[] { return this.certificates.filter((certificate) => certificate.route === route).map((certificate) => ({ ...certificate })); }

  toPromptBlock(): string {
    if (!this.certificates.length) return "No failure certificates logged.";
    return ["FAILURE CERTIFICATES (previously blocked routes):", ...this.certificates.map((certificate) => `  Route: ${certificate.route} (${certificate.gapClass})\n    Mechanism: ${certificate.centralMechanism}\n    Unresolved: ${certificate.unresolvedObligation}\n    Reopen if: ${certificate.reopenCondition}`)].join("\n");
  }

  toJSON(): FailureCertificate[] { return this.certificates.map((certificate) => ({ ...certificate })); }
}

const ANOMALY_STORAGE_KEY = "veritas.v15.innovationGenome.v2.anomalies";
const FAILURE_STORAGE_KEY = "veritas.v15.innovationGenome.v2.failures";

export function loadPersistentDiscoveryMemory(): { anomalyBuffer: AnomalyBuffer; failureArchive: FailureArchive } {
  try {
    const anomalies = JSON.parse(localStorage.getItem(ANOMALY_STORAGE_KEY) || "[]");
    const failures = JSON.parse(localStorage.getItem(FAILURE_STORAGE_KEY) || "[]");
    return { anomalyBuffer: new AnomalyBuffer(Array.isArray(anomalies) ? anomalies : []), failureArchive: new FailureArchive(Array.isArray(failures) ? failures : []) };
  } catch {
    return { anomalyBuffer: new AnomalyBuffer(), failureArchive: new FailureArchive() };
  }
}

export function savePersistentDiscoveryMemory(anomalyBuffer: AnomalyBuffer, failureArchive: FailureArchive): void {
  try {
    localStorage.setItem(ANOMALY_STORAGE_KEY, JSON.stringify(anomalyBuffer.toJSON()));
    localStorage.setItem(FAILURE_STORAGE_KEY, JSON.stringify(failureArchive.toJSON()));
  } catch {
    /* storage unavailable: fail open; prompt still compiles */
  }
}

// ── Domain packs ────────────────────────────────────────────────────────────

export interface DomainPack {
  name: string;
  candidateArtifact: string;
  candidateSpecificAttacker: string;
  verifier: string;
  representations: readonly string[];
  mandatoryGates: readonly string[];
  nearMisses: readonly string[];
  highStakes?: boolean;
}

function pack(
  name: string,
  candidateArtifact: string,
  attacker: string,
  verifier: string,
  representations: readonly string[],
  mandatoryGates: readonly string[],
  nearMisses: readonly string[],
  highStakes = false,
): DomainPack {
  return { name, candidateArtifact, candidateSpecificAttacker: attacker, verifier, representations, mandatoryGates, nearMisses, highStakes };
}

const COMMON_GATES = ["Explicit success criterion", "Quantifier order", "Resource accounting", "Adversary survival", "Reproducibility"] as const;

export const DOMAIN_PACKS: Readonly<Record<string, DomainPack>> = {
  mathematics: pack("mathematics", "proof, disproof, explicit construction, or matching bound", "Construct minimal counterexamples, negate every load-bearing lemma, check quantifier order, and search for a countermodel.", "Lean/Coq/Isabelle, symbolic algebra, or independent expert audit", ["primal/dual", "extremal/minimal-counterexample", "geometric/algebraic/analytic", "flow/polyhedral/optimization", "proof-assistant encoding", "executable finite falsification"], ["Explicit quantifier order", "Imported-theorem hypothesis alignment", "No hidden regularity", "Global consistency", "Exact constants and asymptotics"], ["Proof for a strict subclass", "Numerical verification in fixed dimension", "Unproved bridge equivalent to target", "Randomized substituted for deterministic", "Different oracle/norm/topology/regime"]),
  algorithms: pack("algorithms", "algorithm, optimization formulation, or matching complexity bound", "Generate worst-case inputs, adversarial oracles, integrality-gap instances, pathological scaling, and output-handling failures.", "Formal complexity proof, solver certificates, exact enumeration, and benchmarks", ["primal/dual optimization", "online/offline", "communication complexity", "potential function", "flow/matching/polyhedral", "DP/state compression"], ["Complete cost accounting", "Worst-case not average-case", "No hidden oracle", "Feasible output and exact objective", "Precision propagation"], ["Faster arithmetic without oracle-complexity change", "Empirical solver success without theorem", "Unproved rounding/relaxation", "Ignoring preprocessing/retries"]),
  software: pack("software", "production implementation with explicit behavioral contract", "Attack malformed input, Unicode/path edges, races, partial failure, dependency failure, overload, and abuse cases.", "Unit + integration + property + fuzz + concurrency + security tests", ["state machine", "data-flow graph", "event-sourced", "actor model", "transactional", "differential test"], ["Acceptance tests before implementation", "Compatibility/migration", "Dependency/license review", "Failure and rollback", "Observability"], ["Happy-path-only", "Mocks replacing production", "Uncounted retries", "Claimed but unexecuted tests"]),
  medicine: pack("medicine", "mechanistic hypothesis, diagnostic, or therapeutic proposal", "Attack off-target effects, compensation, subgroup harm, adverse events, non-replication, and confounding.", "Independent assays, animal/clinical trials, prospective validation, and clinician review", ["causal pathway", "dynamical system", "dose-response", "trial estimand", "clinical decision analysis"], ["Evidence hierarchy", "Population/endpoint alignment", "Safety analysis", "Prospective validation", "Human/regulatory review"], ["In-vitro to patient leap", "Surrogate to clinical benefit substitution", "Retrospective to prospective claim", "Prompt-forced certainty"], true),
  legal: pack("legal", "legal interpretation, compliance position, or contract clause", "Search contrary primary authority, jurisdictional conflicts, adverse facts, procedural barriers, and unintended incentives.", "Current primary law, official regulatory material, and jurisdiction-qualified counsel", ["IRAC", "authority hierarchy", "rights-obligations graph", "policy causal model", "contract state machine"], ["Jurisdiction/effective date", "Primary authority", "Adverse authority", "Facts-to-rule alignment", "Human legal approval"], ["Outdated law", "Secondary summary as binding", "Dicta as holding", "Jurisdiction over-generalization"], true),
  physics: pack("physics", "model, mechanism, device, or quantitative bound", "Attack conservation laws, limiting cases, noise, decoherence, and boundary conditions.", "Dimensional analysis, simulation, uncertainty propagation, and experiment", ["Hamiltonian/Lagrangian", "field equation", "circuit analog", "statistical mechanics", "information-theoretic limit", "dimensionless scaling"], ["Units and dimensions", "Conservation laws", "Boundary/initial conditions", "Approximation-domain validity", "Uncertainty budget"], ["Expansion outside validity", "Idealized boundary substitution", "Classical/quantum conflation", "Simulation as experimental proof"]),
  chemistry: pack("chemistry", "molecule, catalyst, material, or synthesis route", "Attack side reactions, unstable intermediates, kinetic traps, degradation, and scale-up failure.", "Quantum chemistry, reaction modeling, synthesis, spectroscopy, and characterization", ["reaction network", "free-energy landscape", "orbital structure", "phase diagram", "process flow"], ["Mass/charge balance", "Thermo/kinetic plausibility", "Conditions/solvent effects", "Characterization plan", "Safety and scale-up"], ["Computed minimum to synthesizable material", "Yield transfer across scales", "Side products omitted", "Novelty without structure search"]),
  ml: pack("ml", "model, dataset, estimator, or empirical claim", "Attack leakage, benchmark contamination, distribution shift, subgroup failure, adversarial examples, and alternative causal graphs.", "Locked holdout, preregistration, ablations, calibration, and replication", ["predictive model", "causal graph", "probabilistic program", "optimization objective", "policy", "error decomposition"], ["Train/val/test separation", "Data provenance", "Baseline and ablation", "Uncertainty and calibration", "Subgroup and shift analysis"], ["Train performance as generalization", "Correlation as causation", "Test-set benchmark tuning", "Average metric hiding subgroup failure"]),
  engineering: pack("engineering", "dimensioned design, model, tolerance stack, and verification plan", "Attack load cases, tolerances, fatigue, manufacturing variance, interfaces, and maintenance conditions.", "Analysis, simulation, prototype test, inspection, and qualified design review", ["requirements graph", "free-body/energy model", "reliability block diagram", "FMEA/STPA", "digital twin", "test article"], ["Units", "Boundary/load cases", "Factors of safety", "Tolerance/uncertainty budget", "Verification traceability"], ["Nominal-only design", "Simulation without validation", "Material property guess", "Ignored interface failure"]),
  finance: pack("finance", "valuation, risk model, strategy, or decision bound", "Attack model risk, liquidity, leverage, tail dependence, regime shift, incentives, and adverse selection.", "Audited data, independent model validation, backtest with holdout, stress tests, and qualified financial review", ["cash-flow model", "scenario tree", "factor model", "option/real-option", "portfolio optimization", "causal market model"], ["Source/date currency", "Units/currency", "Tail stress", "Sensitivity", "No guaranteed-return language"], ["Backtest overfit", "Point estimate without interval", "Illiquidity ignored", "Correlation assumed stable"], true),
  cybersecurity: pack("cybersecurity", "threat model, secure design, exploit proof, or verified mitigation", "Attack trust boundaries, privilege transitions, parser ambiguity, supply chain, secrets, replay, and side channels.", "Static/dynamic analysis, fuzzing, penetration test in authorized scope, and independent security review", ["attack graph", "STRIDE", "protocol state machine", "capability model", "information-flow", "abuse case"], ["Authorization/scope", "Least privilege", "Secret handling", "Input validation", "Patch/regression tests"], ["Security by obscurity", "Scanner-only proof", "Unauthenticated test claim", "Mitigation without threat mapping"], true),
  biology: pack("biology", "mechanistic model, experimental design, or falsifiable biological hypothesis", "Attack confounding, batch effects, compensatory pathways, contamination, selection bias, and non-replication.", "Independent replication, orthogonal assay, controls, preregistered analysis, and expert review", ["causal pathway", "population model", "regulatory network", "phylogenetic", "dose-response", "experimental design"], ["Positive/negative controls", "Sample-size rationale", "Batch correction", "Endpoint alignment", "Biosafety"], ["Correlation as mechanism", "Single-cell-line generalization", "Post-hoc endpoint", "No replication"]),
  product: pack("product", "validated problem, product concept, business model, and experiment", "Attack false demand, willingness-to-pay gaps, channel friction, incumbents, switching cost, and metric gaming.", "User interviews, behavioral prototype, pricing test, cohort data, and falsifiable launch gates", ["jobs-to-be-done", "value chain", "service blueprint", "unit economics", "adoption funnel", "experiment tree"], ["Problem evidence", "Target segment", "Success metric", "Kill criterion", "Unit economics"], ["Survey-only demand", "Feature without job", "TAM as adoption proof", "Vanity metric"]),
  policy: pack("policy", "policy mechanism, implementation design, and distributional impact model", "Attack displacement, gaming, enforcement failure, inequity, jurisdiction conflict, and second-order incentives.", "Primary data, causal evaluation, consultation, pilot, legal review, and public audit", ["theory of change", "causal DAG", "agent-based model", "rights/obligations", "implementation system", "distributional analysis"], ["Authority", "Affected groups", "Counterfactual", "Implementation capacity", "Appeal/accountability"], ["Intent as outcome", "Average effect hiding harms", "No implementation mechanism", "Unfunded mandate"]),
  operations: pack("operations", "operating model, process design, schedule, or capacity bound", "Attack bottlenecks, variability, queues, rework, supplier failure, human workload, and recovery paths.", "Discrete-event model, pilot, control chart, capacity test, and operational review", ["process map", "queueing network", "constraint model", "inventory flow", "schedule", "resilience model"], ["Arrival/service units", "Variability", "Bottleneck proof", "Recovery mode", "Observable KPI"], ["Average-rate capacity", "No variability", "Local optimization", "No failure recovery"]),
  general: pack("general", "the specific verifiable artifact for this problem", "Construct attacker as f(candidate): weakest premise, least stable interface, smallest counterexample shape.", "Strongest available checker for this problem's target", ["primary formal representation", "dual/inverse formulation", "constructive/algorithmic", "impossibility/lower-bound", "executable/testable"], COMMON_GATES, ["Solving an adjacent easier problem", "Progress without falsifiable object", "Unproved standard step"]),
};

// ── Safety and capability reality gates ─────────────────────────────────────

export type RiskTier = "low" | "medium" | "high" | "critical";

export class SafetyGate {
  constructor(public readonly risk: RiskTier, public readonly domainPack: DomainPack) {}

  isHighStakes(): boolean {
    return this.domainPack.highStakes === true || this.risk === "high" || this.risk === "critical";
  }

  transformGenome(genome: Genome): Genome {
    const output = cloneGenome(genome);
    if (this.isHighStakes()) {
      output.termination_resistance = Math.min(output.termination_resistance, 0.5);
      output.goal_fixity = Math.min(output.goal_fixity, 0.3);
    }
    return output;
  }

  promptAddendum(): string {
    if (!this.isHighStakes()) return "";
    return `## HIGH-STAKES SAFETY GATE (mandatory)
Do NOT assume the desired conclusion is true. Preserve disproof, uncertainty, and abstention branches. No destructive, clinical, financial, legal, physical, or external action may be taken without qualified human authorization. Uncertainty outranks persistence.`;
  }
}

export interface CapabilityGateOptions {
  runtimeSupportsParallelAgents?: boolean;
  verifierAvailable?: boolean;
  webRetrieval?: boolean;
  formalProver?: boolean;
  executionSandbox?: boolean;
  declaredTools?: readonly string[];
}

export class CapabilityGate {
  readonly runtimeSupportsParallelAgents: boolean;
  readonly verifierAvailable: boolean;
  readonly webRetrieval: boolean;
  readonly formalProver: boolean;
  readonly executionSandbox: boolean;
  readonly declaredTools: readonly string[];

  constructor(options: CapabilityGateOptions = {}) {
    this.runtimeSupportsParallelAgents = options.runtimeSupportsParallelAgents ?? false;
    this.verifierAvailable = options.verifierAvailable ?? false;
    this.webRetrieval = options.webRetrieval ?? false;
    this.formalProver = options.formalProver ?? false;
    this.executionSandbox = options.executionSandbox ?? false;
    this.declaredTools = [...(options.declaredTools ?? [])];
  }

  promptAddendum(): string {
    return [
      "## CAPABILITY REALITY GATE",
      `- Parallel-worker runtime: ${this.runtimeSupportsParallelAgents ? "available" : "NOT AVAILABLE (serialize branches; do not fabricate worker messages)"}`,
      `- External verifier: ${this.verifierAvailable ? "available" : "NOT AVAILABLE (label results unverified where a checker was not run)"}`,
      `- Web retrieval: ${this.webRetrieval ? "available" : "NOT AVAILABLE (do not fabricate citations)"}`,
      `- Formal prover: ${this.formalProver ? "available" : "NOT AVAILABLE"}`,
      `- Execution sandbox: ${this.executionSandbox ? "available" : "NOT AVAILABLE (code claims are static-reviewed unless a real tool result exists)"}`,
      `- Declared tools: ${this.declaredTools.length ? this.declaredTools.join(", ") : "none. Do not claim tool execution."}`,
    ].join("\n");
  }
}

function domainPackAddendum(domainPack: DomainPack): string {
  return [
    `## DOMAIN PACK: ${domainPack.name.toUpperCase()}`,
    `Required candidate artifact: ${domainPack.candidateArtifact}`,
    `Candidate-specific attacker: ${domainPack.candidateSpecificAttacker}`,
    `Available verifier: ${domainPack.verifier}`,
    "Representations to attempt:",
    ...domainPack.representations.map((item) => `- ${item}`),
    "Mandatory domain gates:",
    ...domainPack.mandatoryGates.map((item) => `- ${item}`),
    "Banned near-miss result-shapes:",
    ...domainPack.nearMisses.map((item) => `- ${item}`),
  ].join("\n");
}

// ── V2 compiler and JSON schema ─────────────────────────────────────────────

export interface InnovationGenomeV2 {
  version: "v2.0";
  seed: number;
  genome: Genome;
  persona: InnovationPersona;
  path: DiscoveryPath;
  prompt: string;
  domainPack: DomainPack;
  safetyGate: SafetyGate;
  capabilityGate: CapabilityGate;
  anomalyBuffer: AnomalyBuffer;
  failureArchive: FailureArchive;
  fitness: FitnessVector;
}

export interface RollV2Options {
  seed?: number;
  userProblem?: string;
  domain?: string;
  risk?: RiskTier;
  capabilityGate?: CapabilityGate;
  anomalyBuffer?: AnomalyBuffer;
  failureArchive?: FailureArchive;
  fitness?: FitnessVector;
}

/** Lightweight domain inference used by the live V15 integration. */
export function inferInnovationDomain(problem: string): keyof typeof DOMAIN_PACKS {
  const value = problem.toLowerCase();
  if (/\b(theorem|proof|lemma|conjecture|integer|graph theory|topology|algebra|geometry)\b/.test(value)) return "mathematics";
  if (/\b(algorithm|complexity|runtime|data structure|optimization algorithm)\b/.test(value)) return "algorithms";
  if (/\b(code|software|typescript|javascript|python|api|database|frontend|backend|bug)\b/.test(value)) return "software";
  if (/\b(patient|clinical|diagnos|therap|medicine|medical|drug|disease)\b/.test(value)) return "medicine";
  if (/\b(law|legal|court|statute|regulation|contract|jurisdiction)\b/.test(value)) return "legal";
  if (/\b(physics|quantum|force|energy|particle|thermodynamic)\b/.test(value)) return "physics";
  if (/\b(chemistry|chemical|molecule|catalyst|reaction|synthesis)\b/.test(value)) return "chemistry";
  if (/\b(machine learning|\bml\b|neural network|dataset|classifier|model training)\b/.test(value)) return "ml";
  if (/\b(engineer|mechanical|electrical|structural|tolerance|fatigue|manufactur)\b/.test(value)) return "engineering";
  if (/\b(invest|portfolio|finance|financial|valuation|market|return on investment)\b/.test(value)) return "finance";
  if (/\b(cyber|security|vulnerability|exploit|authentication|encryption|threat)\b/.test(value)) return "cybersecurity";
  if (/\b(biology|biological|gene|cell|organism|protein|ecology)\b/.test(value)) return "biology";
  if (/\b(product|customer|market fit|startup|business model|user need)\b/.test(value)) return "product";
  if (/\b(policy|government|public administration|legislation|social program)\b/.test(value)) return "policy";
  if (/\b(operations|supply chain|inventory|queue|capacity|workflow|schedule)\b/.test(value)) return "operations";
  return "general";
}

/** Generate a recorded random seed for live diversity; all downstream behavior
 * remains deterministic once this seed is recorded. */
export function newInnovationSeed(): number {
  try {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0];
  } catch {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }
}

function derivedSeed(problem: string, domain: string, risk: RiskTier): number {
  return hash32(`${problem}|${domain}|${risk}`);
}

export function rollV2(options: RollV2Options = {}): InnovationGenomeV2 {
  const userProblem = options.userProblem ?? "[INSERT PROBLEM HERE]";
  const domain = options.domain ?? "general";
  const risk = options.risk ?? "medium";
  const domainPack = DOMAIN_PACKS[domain];
  if (!domainPack) throw new Error(`Unknown domain: ${domain}. Available: ${Object.keys(DOMAIN_PACKS).join(", ")}`);
  const seed = options.seed ?? derivedSeed(userProblem, domain, risk);
  const safetyGate = new SafetyGate(risk, domainPack);
  const capabilityGate = options.capabilityGate ?? new CapabilityGate();
  const anomalyBuffer = options.anomalyBuffer ?? new AnomalyBuffer();
  const failureArchive = options.failureArchive ?? new FailureArchive();
  const genome = safetyGate.transformGenome(seedToGenome(seed));
  const persona = classifyPersonaExtended(genome);
  const path = selectPathExtended(genome);
  const prompt = [
    compileInnovationPrompt(genome, persona, path, userProblem, domain),
    domainPackAddendum(domainPack),
    safetyGate.promptAddendum(),
    capabilityGate.promptAddendum(),
    "## PERSISTENT MEMORY BLOCKS",
    anomalyBuffer.toPromptBlock(),
    failureArchive.toPromptBlock(),
  ].filter(Boolean).join("\n\n");
  return {
    version: "v2.0",
    seed,
    genome,
    persona,
    path,
    prompt,
    domainPack,
    safetyGate,
    capabilityGate,
    anomalyBuffer,
    failureArchive,
    fitness: options.fitness ?? new FitnessVector(),
  };
}

/** Compact v2 directive used by the live pipeline and query strategist. */
export function compileCompactDirectiveV2(result: InnovationGenomeV2): string {
  const genome = result.genome;
  const families = Math.max(2, Math.min(12, Math.floor(genome.portfolio_breadth * 12) + 1));
  const negatives = Math.max(5, Math.min(35, Math.floor(genome.negative_space_density * 35) + 1));
  return [
    `INNOVATION GENOME v2.0 (seed ${result.seed}) — ${result.persona.name}: ${result.persona.tagline}`,
    `PATH ${result.path.id} (${result.path.name}): ${result.path.seq}`,
    `DOMAIN ${result.domainPack.name}: artifact=${result.domainPack.candidateArtifact}`,
    `PORTFOLIO: maintain ${families} mechanism-distinct branches; do not collapse them before evidence eliminates them.`,
    `NEGATIVE SPACE: enumerate at least ${negatives} near-miss answer shapes; poison the most tempting shortcut with a test.`,
    `ATTACKER: ${result.domainPack.candidateSpecificAttacker}`,
    `VERIFIER: ${result.domainPack.verifier}`,
    `MANDATORY GATES: ${result.domainPack.mandatoryGates.join("; ")}.`,
    genome.evaluator_mutability > 0.6 ? "EVALUATOR: derive and revise success criteria, but preserve an audit trail and rerun repaired candidates from zero trust." : "EVALUATOR: keep the supplied success criterion fixed.",
    genome.anomaly_memory > 0.6 ? result.anomalyBuffer.toPromptBlock() : "",
    result.failureArchive.toPromptBlock(),
    result.safetyGate.promptAddendum(),
    result.capabilityGate.promptAddendum(),
  ].filter(Boolean).join("\n");
}

export interface ExplorationBranchV2 {
  branchId: string;
  mutation: "base" | MutationKind;
  genome: Genome;
  persona: InnovationPersona;
  path: DiscoveryPath;
}

/**
 * Build a deterministic, mechanism-distinct exploration population without
 * inventing fitness. These branches are search instructions, not evaluated
 * solutions; Pareto admission remains reserved for a real evaluator.
 */
export function buildExplorationPopulationV2(result: InnovationGenomeV2, count = 6): ExplorationBranchV2[] {
  const boundedCount = Math.max(1, Math.min(16, Math.floor(count)));
  const mutationKinds: MutationKind[] = ["nudge", "flip", "block_rotate", "pole_swap", "dimension_mask"];
  const branches: ExplorationBranchV2[] = [
    {
      branchId: "B0",
      mutation: "base",
      genome: cloneGenome(result.genome),
      persona: result.persona,
      path: result.path,
    },
  ];
  for (let index = 1; index < boundedCount; index += 1) {
    const mutation = mutationKinds[(index - 1) % mutationKinds.length];
    const genome = applyMutation(result.genome, result.seed, mutation, index);
    branches.push({
      branchId: `B${index}`,
      mutation,
      genome,
      persona: classifyPersonaExtended(genome),
      path: selectPathExtended(genome),
    });
  }
  return branches;
}

/** Compact branch contract injected into live ideation/retrieval/synthesis. */
export function compileExplorationPortfolioV2(result: InnovationGenomeV2, count = 6): string {
  const branches = buildExplorationPopulationV2(result, count);
  return [
    `V2 EXPLORATION POPULATION (${branches.length} deterministic branches; no branch has inferred fitness):`,
    ...branches.map((branch) =>
      `${branch.branchId} [${branch.mutation}] ${branch.persona.name} · path ${branch.path.id} ${branch.path.seq} · ` +
      `anomaly=${branch.genome.anomaly_sensitivity.toFixed(2)} analogy=${branch.genome.analogy_distance.toFixed(2)} ` +
      `world=${branch.genome.world_contact.toFixed(2)} adversary=${branch.genome.adversarial_intensity.toFixed(2)} taste=${branch.genome.taste_weight.toFixed(2)}`,
    ),
    "Keep branch mechanisms independent through ideation and retrieval. Merge only after candidate-specific attacks and evidence eliminate or support branches. Do not call this a Pareto front until a real evaluator assigns FitnessVector values.",
  ].join("\n");
}

export const INNOVATION_GENOME_V2_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "innovation-genome-v2.schema.json",
  title: "InnovationGenomeV2",
  type: "object",
  required: ["version", "seed", "genome", "persona", "path", "domain", "risk", "capabilities"],
  properties: {
    version: { const: "v2.0" },
    seed: { type: "integer", minimum: 0 },
    genome: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 1 } },
    persona: { type: "object", required: ["name", "tagline"], properties: { name: { type: "string" }, tagline: { type: "string" } } },
    path: { type: "object", required: ["id", "name", "seq"], properties: { id: { type: "string" }, name: { type: "string" }, seq: { type: "string" } } },
    domain: { enum: Object.keys(DOMAIN_PACKS) },
    risk: { enum: ["low", "medium", "high", "critical"] },
    capabilities: {
      type: "object",
      properties: {
        parallelAgents: { type: "boolean" }, verifier: { type: "boolean" }, web: { type: "boolean" }, formalProver: { type: "boolean" }, sandbox: { type: "boolean" }, tools: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export function innovationGenomeV2ToJSON(result: InnovationGenomeV2): unknown {
  return {
    version: result.version,
    seed: result.seed,
    genome: result.genome,
    persona: result.persona,
    path: result.path,
    domain: result.domainPack.name,
    risk: result.safetyGate.risk,
    highStakes: result.safetyGate.isHighStakes(),
    fitness: result.fitness.asTuple(),
    capabilities: {
      parallelAgents: result.capabilityGate.runtimeSupportsParallelAgents,
      verifier: result.capabilityGate.verifierAvailable,
      web: result.capabilityGate.webRetrieval,
      formalProver: result.capabilityGate.formalProver,
      sandbox: result.capabilityGate.executionSandbox,
      tools: [...result.capabilityGate.declaredTools],
    },
  };
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

export async function runInnovationGenomeV2Diagnostics(): Promise<{ ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> }> {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  const base = seedToGenome(42);
  const kinds: MutationKind[] = ["nudge", "flip", "block_rotate", "pole_swap", "dimension_mask"];
  for (const kind of kinds) {
    const first = applyMutation(base, 42, kind, 0, kind === "flip" ? { fraction: 1 } : {});
    const second = applyMutation(base, 42, kind, 0, kind === "flip" ? { fraction: 1 } : {});
    add(`mutation-${kind}-deterministic`, JSON.stringify(first) === JSON.stringify(second), kind);
    add(`mutation-${kind}-bounded`, Object.values(first).every((value) => value >= 0 && value <= 1), kind);
  }
  const allHigh = Object.fromEntries(Object.keys(base).map((key) => [key, 0.9]));
  const flipped = mutateFlip(allHigh, 1, 0, { fraction: 1 });
  add("flip-inverse", Object.values(flipped).every((value) => Math.abs(value - 0.1) < 1e-9), "all 0.9 → 0.1");

  const left = seedToGenome(1);
  const right = seedToGenome(2);
  const uniformA = crossoverUniform(left, right, 100);
  const uniformB = crossoverUniform(left, right, 100);
  add("uniform-crossover-deterministic", JSON.stringify(uniformA) === JSON.stringify(uniformB), "same seed");
  add("uniform-inherits-only", Object.keys(uniformA).every((key) => uniformA[key] === left[key] || uniformA[key] === right[key]), "parent alleles only");
  const blockChild = crossoverBlock(Object.fromEntries(Object.keys(left).map((key) => [key, 0.1])), Object.fromEntries(Object.keys(right).map((key) => [key, 0.9])), 100);
  add("block-crossover-structure", Object.values(blockChild).every((value) => value === 0.1 || value === 0.9), "whole-block inheritance");
  const weighted = crossoverParetoWeighted(Object.fromEntries(Object.keys(left).map((key) => [key, 0])), Object.fromEntries(Object.keys(right).map((key) => [key, 1])), 0.01, 0.99, 100);
  add("pareto-favors-fitter", Object.values(weighted).reduce((sum, value) => sum + value, 0) / Object.keys(weighted).length > 0.5, "mean > 0.5");

  const low = new FitnessVector(0.1, 0.1, 0.1, 0.1);
  const high = new FitnessVector(0.9, 0.9, 0.9, 0.9);
  add("fitness-dominance", high.dominates(low) && !low.dominates(high), "strict Pareto");
  const tradeA = new FitnessVector(0.9, 0.1, 0.5, 0.5);
  const tradeB = new FitnessVector(0.1, 0.9, 0.5, 0.5);
  add("fitness-tradeoff-nondominated", !tradeA.dominates(tradeB) && !tradeB.dominates(tradeA), "trade-off preserved");

  const archive = new ParetoArchive();
  archive.add(new GenomeEntry({ seed: 1, genome: left, fitness: low }));
  archive.add(new GenomeEntry({ seed: 2, genome: right, fitness: high }));
  add("archive-pareto-prunes-dominated", archive.front().length === 1 && archive.front()[0].seed === 2, `front=${archive.front().map((entry) => entry.seed)}`);

  const manager = new IslandManager(3);
  manager.islands.forEach((island, islandIndex) => {
    for (let index = 0; index < 3; index += 1) {
      const seed = islandIndex * 100 + index;
      island.add(new GenomeEntry({ seed, genome: seedToGenome(seed), fitness: new FitnessVector(index / 3, index / 3, index / 3, index / 3) }));
    }
  });
  add("island-migration", manager.migrate(42) > 0, "migrants moved");

  const anomalies = new AnomalyBuffer();
  anomalies.log({ id: "A1", description: "unexplained peak", roundSeen: 1 });
  add("anomaly-log", anomalies.unresolved().length === 1, "one unresolved");
  add("anomaly-resolve", anomalies.resolve("A1", "phase boundary artifact") && anomalies.unresolved().length === 0, "resolved");
  const failures = new FailureArchive();
  failures.add({ route: "direct-induction", centralMechanism: "strong induction", strongestEstablished: "base case", minimalCounterexample: "n=3", unresolvedObligation: "handle n=3", gapClass: "local", reopenCondition: "stronger hypothesis" });
  add("failure-archive", failures.matching("direct-induction").length === 1, "matchable");

  const medicalGate = new SafetyGate("critical", DOMAIN_PACKS.medicine);
  const safeGenome = medicalGate.transformGenome(Object.fromEntries(Object.keys(base).map((key) => [key, 0.95])));
  add("safety-caps-high-stakes", medicalGate.isHighStakes() && safeGenome.termination_resistance <= 0.5 && safeGenome.goal_fixity <= 0.3, "caps active");
  add("capability-honesty", new CapabilityGate().promptAddendum().includes("NOT AVAILABLE") && new CapabilityGate().promptAddendum().includes("Do not claim tool execution"), "unavailable disclosed");

  const rolled = rollV2({ seed: 42, userProblem: "Prove X.", domain: "mathematics" });
  add("roll-v2-end-to-end", rolled.seed === 42 && rolled.prompt.includes("DOMAIN PACK: MATHEMATICS") && rolled.prompt.includes("CAPABILITY REALITY GATE"), rolled.persona.name);
  const critical = rollV2({ seed: 42, userProblem: "Should we prescribe X?", domain: "medicine", risk: "critical" });
  add("roll-v2-high-stakes", critical.prompt.includes("HIGH-STAKES SAFETY GATE") && critical.genome.termination_resistance <= 0.5, "safety addendum");
  const exported = innovationGenomeV2ToJSON(rolled) as Record<string, unknown>;
  add("json-export", exported.version === "v2.0" && exported.seed === 42, JSON.stringify(exported).slice(0, 80));
  add("schema-domains", new Set(INNOVATION_GENOME_V2_SCHEMA.properties.domain.enum).size === Object.keys(DOMAIN_PACKS).length, `domains=${Object.keys(DOMAIN_PACKS).length}`);

  const evaluated = await evolveGeneration(
    new GenomeEntry({ seed: 42, genome: base, fitness: low }),
    (genome) => new FitnessVector(genome.novelty_vs_utility, genome.world_contact, genome.artifact_concreteness, genome.adversarial_intensity),
    { count: 5, operationSeed: 100 },
  );
  add("evaluator-driven-evolution", evaluated.length === 5 && evaluated.every((entry) => entry.lineage[0] === 42), `children=${evaluated.length}`);
  const population = buildExplorationPopulationV2(rolled, 6);
  add("live-exploration-population", population.length === 6 && new Set(population.map((branch) => branch.mutation)).size === 6, `branches=${population.length}`);
  add("population-no-fake-fitness", compileExplorationPortfolioV2(rolled).includes("no branch has inferred fitness"), "fitness honesty explicit");
  add("v1-invariance", Object.keys(seedToGenome(42)).length === 21, "v1 API unchanged");

  return { ok: checks.every((check) => check.passed), checks };
}