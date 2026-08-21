/**
 * unified-innovation.ts — one genome, v1 base + v2 expansion pack.
 *
 * V2 is not treated as an independent competing engine. A single stable seed
 * creates the v1 base genome; v2 applies domain/risk/capability expansion to
 * the same seed and records the delta. Every path symbol is expanded before it
 * enters an LLM prompt.
 */
import {
  roll as rollV1,
  type DiscoveryPath,
  type InnovationGenomeResult,
} from "../innovation-genome-engine.orig";
import {
  rollV2,
  buildExplorationPopulationV2,
  inferInnovationDomain,
  type InnovationGenomeV2,
} from "../innovation-genome-engine-v2.orig";
import { generatePersona, type WilliamsPersona } from '@/lib/williams-style';

export const PATH_NODE_NAMES: Record<string, string> = {
  P: "Problem Choice",
  A: "Anomaly Valuation",
  E: "Embodiment and Real-World Experiment",
  N: "Cross-Domain Analogy",
  V: "Evaluator Revision",
  T: "Taste and Explanatory Quality",
  S: "Social Validation and Stabilization",
};

export function stableSeed(text: string, salt = ""): number {
  let h = 0x811c9dc5;
  const input = `${salt}|${text}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function expandPath(path: DiscoveryPath): string {
  const nodes = path.seq.split(/\s*→\s*/).filter(Boolean);
  return nodes.map((node, i) => `${i + 1}. ${PATH_NODE_NAMES[node] ?? `Unknown node ${node}`}`).join("\n");
}

export interface UnifiedInnovationPlan {
  version: "v1+v2-unified";
  seed: number;
  domain: string;
  base: InnovationGenomeResult;
  expansion: InnovationGenomeV2;
  /** Backward-compatible debug aliases; v2 remains an expansion of v1. */
  v1: InnovationGenomeResult;
  v2: InnovationGenomeV2;
  directiveV1: string;
  directiveV2: string;
  williams: WilliamsPersona;
  expandedPath: string;
  exploration: Array<{
    id: string;
    mutation: string;
    persona: string;
    pathName: string;
    expandedPath: string;
  }>;
  directive: string;
}

export function buildUnifiedInnovationPlan(
  problem: string,
  options?: { seed?: number; personaSeed?: number; risk?: "low" | "medium" | "high" | "critical" },
): UnifiedInnovationPlan {
  const domain = String(inferInnovationDomain(problem));
  const seed = options?.seed ?? stableSeed(problem, domain);
  const base = rollV1(seed, problem, domain);
  // Expansion uses the exact same seed. It augments domain/safety/capability;
  // it does not roll an unrelated second genome.
  const expansion = rollV2({ seed, userProblem: problem, domain, risk: options?.risk ?? "medium" });
  const williams = generatePersona(options?.personaSeed ?? seed);
  const expandedPath = expandPath(expansion.path);
  const population = buildExplorationPopulationV2(expansion, 6);
  const exploration = population.map((branch) => ({
    id: branch.branchId,
    mutation: branch.mutation,
    persona: branch.persona.name,
    pathName: branch.path.name,
    expandedPath: expandPath(branch.path),
  }));

  const directive = [
    `## UNIFIED INNOVATION GENOME v1 + v2 EXPANSION (seed ${seed})`,
    `BASE IDENTITY: ${base.persona.name} — ${base.persona.tagline}`,
    "V1 BASE DIMENSIONS (the inherited genome):",
    ...base.dimensionReport.map((d) => `- ${d.name} [${d.block}]: ${d.level} (${d.value.toFixed(2)}), from ${d.lowPole} toward ${d.highPole}`),
    `V2 DOMAIN/SAFETY EXPANSION: ${expansion.persona.name} — ${expansion.persona.tagline}`,
    `DOMAIN: ${expansion.domainPack.name}`,
    `WILLIAMS RESEARCH PERSONA: ${williams.archetype.name}`,
    williams.systemPromptFragment,
    `DISCOVERY PATH ${expansion.path.id} (${expansion.path.name}) — expanded in full words:`,
    expandedPath,
    "V2 IS AN EXPANSION PACK: domain gates, safety, capability, anomalies and failure memory extend the base genome; they do not replace it.",
    `REQUIRED ARTIFACT: ${expansion.domainPack.candidateArtifact}`,
    `ATTACKER: ${expansion.domainPack.candidateSpecificAttacker}`,
    `VERIFIER: ${expansion.domainPack.verifier}`,
    `MANDATORY GATES: ${expansion.domainPack.mandatoryGates.join("; ")}`,
    "EXPLORATION BRANCHES (preserve independently until evidence eliminates them):",
    ...exploration.map((b) => `${b.id} [${b.mutation}] ${b.persona} · ${b.pathName}\n${b.expandedPath}`),
  ].join("\n");

  return {
    version: "v1+v2-unified",
    seed,
    domain,
    base,
    expansion,
    v1: base,
    v2: expansion,
    directiveV1: `BASE GENOME (shared seed ${seed}): ${base.persona.name}\n${expandPath(base.path)}`,
    directiveV2: `V2 EXPANSION PACK (same seed ${seed}): ${expansion.persona.name}\n${expandedPath}`,
    williams,
    expandedPath,
    exploration,
    directive,
  };
}
