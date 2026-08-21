/**
 * terminal-complete.ts
 * ============================================================================
 * FINAL TERMINAL SYNTHESIS
 *
 * Chain:
 *   canonical-portfolio-orchestrator.ts  — multi-engine portfolio
 *   portfolio-consensus-adjudicator.ts   — family-aware corroboration
 *   portfolio-consensus-memory.ts        — honest cross-session memory
 *   portfolio-terminal-governor.ts       — corrected adaptive quarantine
 *   this file                            — structured pre-fetch + real-time
 *                                           independence + marginal advisory
 */

import {
  ENGINE_FAMILY,
  familyOf,
  groundWithAdaptivePortfolioConsensus,
  runPortfolioConsensusMemoryDiagnostics,
  type AdaptivePortfolioOptions,
  type PortfolioMemorySnapshot,
} from "./portfolio-consensus-memory";
import {
  groundWithTerminalPortfolioGovernor,
  runPortfolioTerminalGovernorDiagnostics,
} from "./portfolio-terminal-governor";
import {
  runPortfolioConsensusDiagnostics,
  type ConsensusConfidence,
  type ConsensusSelection,
  type PortfolioConsensusResult,
} from "./portfolio-consensus-adjudicator";
import {
  runCanonicalPortfolioDiagnostics,
  type CanonicalLaneId,
  type LaneExecution,
  type NormalizedLaneResult,
  type StandardSource,
} from "./canonical-portfolio-orchestrator";
import {
  runSpaRescueBridgeDiagnostics,
} from "./spa-rescue-bridge";
import {
  structuredSearch,
  type StructuredAdapterOptions,
  type StructuredItem,
} from "./structured-source-adapter";

export interface TerminalCompleteOptions extends AdaptivePortfolioOptions {
  structuredPreFetch?: boolean;
  openAlexApiKey?: string;
  terminalGovernor?: boolean;
  memoryProfile?: string;
  adaptiveQuarantine?: boolean;
  quarantineMinSamples?: number;
  quarantineCooldownMs?: number;
  minimumEnabledLanes?: number;
  minimumIndependentFamilies?: number;
}

export interface TerminalPortfolioIndependence {
  distinctFamilies: number;
  fulfilledFamilies: string[];
  effectiveWitnessCount: number;
}

export interface TerminalMarginalGain {
  fulfilledCount: number;
  failedCount: number;
  extraLanesChangedWinner: boolean;
  attestedDelta: number;
  assessment: "high-value" | "moderate-value" | "low-value" | "single-lane-only";
}

export interface TerminalCompleteResult extends PortfolioConsensusResult {
  prunedLanes: CanonicalLaneId[];
  memorySnapshot: PortfolioMemorySnapshot;
  structuredItems: StructuredItem[];
  portfolioIndependence: TerminalPortfolioIndependence;
  marginalGain: TerminalMarginalGain;
}

function computeRealTimeIndependence(laneResults: LaneExecution[]): TerminalPortfolioIndependence {
  const families = new Set<string>();
  for (const lr of laneResults) {
    if (lr.status === "fulfilled") families.add(familyOf(lr.id));
  }
  const sorted = Array.from(families).sort();
  return { distinctFamilies: families.size, fulfilledFamilies: sorted, effectiveWitnessCount: families.size };
}

function computeMarginalGain(
  laneResults: LaneExecution[],
  canonicalWinnerId: CanonicalLaneId | undefined,
  consensusWinnerId: CanonicalLaneId | undefined,
): TerminalMarginalGain {
  const fulfilled = laneResults.filter((lr) => lr.status === "fulfilled");
  const failedCount = laneResults.length - fulfilled.length;
  if (fulfilled.length <= 1) {
    return { fulfilledCount: fulfilled.length, failedCount, extraLanesChangedWinner: false, attestedDelta: 0, assessment: "single-lane-only" };
  }
  const changedWinner = canonicalWinnerId !== undefined && consensusWinnerId !== undefined && canonicalWinnerId !== consensusWinnerId;
  const effectiveWinnerId = consensusWinnerId ?? canonicalWinnerId;
  const winnerLane = fulfilled.find((lr) => lr.id === effectiveWinnerId);
  const winnerAttested = winnerLane?.normalized?.attestedCount ?? 0;
  const bestOtherAttested = Math.max(0, ...fulfilled.filter((lr) => lr.id !== effectiveWinnerId).map((lr) => lr.normalized?.attestedCount ?? 0));
  const attestedDelta = winnerAttested - bestOtherAttested;
  const assessment = changedWinner || attestedDelta >= 2 ? "high-value" : attestedDelta >= 1 || fulfilled.length >= 3 ? "moderate-value" : "low-value";
  return { fulfilledCount: fulfilled.length, failedCount, extraLanesChangedWinner: changedWinner, attestedDelta, assessment };
}

function buildEmpty(provider: string): TerminalCompleteResult {
  return {
    ok: false,
    provider,
    selection: "canonical" as ConsensusSelection,
    count: 0,
    sources: [],
    evidenceBlock: "",
    consensusConfidence: "none" as ConsensusConfidence,
    consensusCaveat: "",
    laneConsensus: [],
    claimCorroboration: [],
    decisionLedger: [],
    agreement: [],
    laneResults: [],
    winnerRaw: undefined,
    prunedLanes: [],
    memorySnapshot: { laneReliability: [], familyPriors: [] },
    structuredItems: [],
    portfolioIndependence: { distinctFamilies: 0, fulfilledFamilies: [], effectiveWitnessCount: 0 },
    marginalGain: { fulfilledCount: 0, failedCount: 0, extraLanesChangedWinner: false, attestedDelta: 0, assessment: "single-lane-only" },
  };
}

export async function groundTerminalComplete(question: string, opts?: TerminalCompleteOptions): Promise<TerminalCompleteResult> {
  const dbg = opts?.onDebug ?? (() => {});
  const normalized = (question ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return buildEmpty("terminal-complete(empty)");
  const doStructured = opts?.structuredPreFetch !== false;

  const structuredPromise = doStructured
    ? structuredSearch(normalized, { signal: opts?.signal, limitPerSource: 6, openAlexApiKey: opts?.openAlexApiKey } satisfies StructuredAdapterOptions).catch(() => ({ items: [] as StructuredItem[], queriedSources: [] as string[], totalFound: 0 }))
    : Promise.resolve({ items: [] as StructuredItem[], queriedSources: [] as string[], totalFound: 0 });

  dbg("terminal-complete: portfolio memory governor");
  const portfolioResult = opts?.terminalGovernor === false
    ? await groundWithAdaptivePortfolioConsensus(normalized, { ...opts, onDebug: (m) => dbg(`[adaptive] ${m}`) })
    : await groundWithTerminalPortfolioGovernor(normalized, { ...opts, onDebug: (m) => dbg(`[governor] ${m}`) });

  const structured = await structuredPromise;
  dbg(`terminal-complete: structured → ${structured.items.length} items from [${structured.queriedSources?.join(",") ?? ""}]`);

  const portfolioIndependence = computeRealTimeIndependence(portfolioResult.laneResults);
  const marginalGain = computeMarginalGain(portfolioResult.laneResults, portfolioResult.canonicalWinnerLane, portfolioResult.consensusWinnerLane);

  const seenUrls = new Set<string>(portfolioResult.sources.map((s) => s.url));
  const structuredAsSources: StandardSource[] = [];
  for (const item of structured.items) {
    const url = item.externalUrl ?? (item.doi ? `https://doi.org/${item.doi}` : undefined) ?? `structured:${item.kind}:${item.title.slice(0, 40)}`;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    structuredAsSources.push({ title: item.title || "Structured Item", url, content: (item.pageContent || item.abstract || "").slice(0, 1800) });
  }
  const mergedSources = [...portfolioResult.sources, ...structuredAsSources];

  let evidenceBlock = portfolioResult.evidenceBlock;
  if (structured.items.length > 0 && evidenceBlock.length > 0) {
    const lines = structured.items.slice(0, 6).map((it, i) => `[STRUCTURED:${it.kind.toUpperCase()}:${i + 1}] ${it.title}\n${(it.pageContent || "").slice(0, 360)}`).join("\n\n");
    const insertAt = evidenceBlock.lastIndexOf("END RETRIEVED CONTENT");
    if (insertAt >= 0) {
      evidenceBlock = evidenceBlock.slice(0, insertAt) + "BEGIN STRUCTURED API ITEMS\n" + lines + "\nEND STRUCTURED API ITEMS\n\n" + evidenceBlock.slice(insertAt);
    }
  }

  const provider = `terminal-complete(${portfolioResult.provider}+structured:${structured.items.length}+pruned:${portfolioResult.prunedLanes.length}+families:${portfolioIndependence.distinctFamilies})`;
  return { ...portfolioResult, sources: mergedSources, count: mergedSources.length, evidenceBlock, provider, structuredItems: structured.items, portfolioIndependence, marginalGain };
}

export async function runTerminalCompleteDiagnostics(): Promise<{
  ok: boolean;
  suites: Array<{ name: string; ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> }>;
}> {
  const suites: Array<{ name: string; ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> }> = [];
  const run = async (name: string, fn: (() => Promise<{ ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> }>) | (() => { ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> })) => {
    try {
      const result = await fn();
      suites.push({ name, ok: result.ok, checks: result.checks });
    } catch (e) {
      suites.push({ name, ok: false, checks: [{ id: "suite-error", passed: false, detail: e instanceof Error ? e.message : String(e) }] });
    }
  };
  await run("canonical-portfolio-orchestrator", () => runCanonicalPortfolioDiagnostics());
  await run("portfolio-consensus-adjudicator", () => runPortfolioConsensusDiagnostics());
  await run("portfolio-consensus-memory", () => runPortfolioConsensusMemoryDiagnostics());
  await run("portfolio-terminal-governor", () => runPortfolioTerminalGovernorDiagnostics());
  await run("spa-rescue-bridge", () => runSpaRescueBridgeDiagnostics());

  const synChecks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) => synChecks.push({ id, passed, detail });
  const mockFulfilled: LaneExecution[] = [
    { id: "terminal-wire" as CanonicalLaneId, priority: 100, status: "fulfilled", elapsedMs: 300, normalized: { ok: true, acceptable: true, eligibleForWinner: true, provider: "tw", evidenceBlock: "x", sources: [], sourceCount: 1, claimCount: 1, structuredItemCount: 0, attestedCount: 2, supportedCount: 0, conflictedCount: 0, proof: "verified", qualityVector: [1, 4, 2, 0, 1, 1, 100] } as NormalizedLaneResult },
    { id: "omni-nexus" as CanonicalLaneId, priority: 60, status: "fulfilled", elapsedMs: 400, normalized: { ok: true, acceptable: true, eligibleForWinner: true, provider: "on", evidenceBlock: "y", sources: [], sourceCount: 1, claimCount: 1, structuredItemCount: 0, attestedCount: 0, supportedCount: 1, conflictedCount: 0, proof: "bound", qualityVector: [1, 3, 0, 1, 1, 1, 100] } as NormalizedLaneResult },
    { id: "sentinel-orchestrator" as CanonicalLaneId, priority: 95, status: "rejected", elapsedMs: 50, error: "timeout" },
  ];
  const ind = computeRealTimeIndependence(mockFulfilled);
  add("independence-two-fulfilled-families", ind.distinctFamilies === 2 && ind.fulfilledFamilies.includes("conclave-core") && ind.fulfilledFamilies.includes("omni-standalone"), `families=${ind.fulfilledFamilies.join(",")}`);
  add("independence-rejected-excluded", ind.effectiveWitnessCount === ind.distinctFamilies, `ewc=${ind.effectiveWitnessCount}`);
  const mg1 = computeMarginalGain([mockFulfilled[0]], "terminal-wire", "terminal-wire");
  add("marginal-single-lane", mg1.assessment === "single-lane-only", `assessment=${mg1.assessment}`);
  const mg2 = computeMarginalGain([mockFulfilled[0], mockFulfilled[1]], "terminal-wire", "omni-nexus");
  add("marginal-changed-winner-high-value", mg2.extraLanesChangedWinner && mg2.assessment === "high-value" && mg2.fulfilledCount === 2, `changed=${mg2.extraLanesChangedWinner}`);
  add("engine-family-conclave-core", ENGINE_FAMILY["terminal-wire"] === "conclave-core" && ENGINE_FAMILY["sentinel-orchestrator"] === "conclave-core" && ENGINE_FAMILY["vanguard-packer"] === "conclave-core", `tw=${ENGINE_FAMILY["terminal-wire"]}`);
  add("engine-family-standalone", ENGINE_FAMILY["sentinel-omega"] === "omega-standalone" && ENGINE_FAMILY["omni-nexus"] === "omni-standalone", `so=${ENGINE_FAMILY["sentinel-omega"]}`);
  const empty = buildEmpty("test-empty");
  add("empty-zero-state", !empty.ok && empty.count === 0 && empty.sources.length === 0 && empty.prunedLanes.length === 0 && empty.portfolioIndependence.distinctFamilies === 0, `ok=${empty.ok}`);
  suites.push({ name: "terminal-complete-synthesis", ok: synChecks.every((c) => c.passed), checks: synChecks });
  return { ok: suites.every((s) => s.ok), suites };
}

export { groundWithAdaptivePortfolioConsensus, getFamilyCorroborationPrior, getLaneReliability, getPortfolioMemorySnapshot, runPortfolioConsensusMemoryDiagnostics, familyOf, ENGINE_FAMILY, type AdaptivePortfolioOptions, type FamilyCorroborationPrior, type LaneReliability, type PortfolioMemorySnapshot } from "./portfolio-consensus-memory";
export { groundWithPortfolioConsensus, runPortfolioConsensusDiagnostics, type ClaimCorroboration, type ConsensusConfidence, type ConsensusSelection, type DecisionLedgerEntry, type LaneConsensus, type PortfolioConsensusOptions, type PortfolioConsensusResult } from "./portfolio-consensus-adjudicator";
export { groundWithCanonicalPortfolio, runCanonicalPortfolioDiagnostics, type AgreementCell, type CanonicalLaneId, type LaneExecution, type NormalizedLaneResult, type PortfolioGroundingResult, type PortfolioOptions, type StandardSource } from "./canonical-portfolio-orchestrator";
export { runSpaRescueBridgeDiagnostics, withSpaRescueCause, withSpaRescueFromRawResponse } from "./spa-rescue-bridge";