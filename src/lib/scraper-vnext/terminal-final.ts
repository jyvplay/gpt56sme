/**
 * terminal-final.ts
 * ============================================================================
 * TRUE TERMINAL — chains the corrected governor with structured pre-fetch,
 * real-time independence, marginal gain, and a unified diagnostic hub.
 *
 * ADDITIVE ONLY. No canonical file modified. Browser/static-build compatible.
 * ============================================================================ */

import {
  ENGINE_FAMILY,
  familyOf,
  groundWithTerminalPortfolioGovernor,
  runPortfolioTerminalGovernorDiagnostics,
  type TerminalGovernorOptions,
  type TerminalGovernorResult,
} from "./portfolio-terminal-governor";
import {
  runPortfolioConsensusDiagnostics,
} from "./portfolio-consensus-adjudicator";
import {
  runCanonicalPortfolioDiagnostics,
  type CanonicalLaneId,
  type LaneExecution,
  type StandardSource,
} from "./canonical-portfolio-orchestrator";
import { runSpaRescueBridgeDiagnostics } from "./spa-rescue-bridge";
import {
  structuredSearch,
  type StructuredAdapterOptions,
  type StructuredItem,
} from "./structured-source-adapter";
import { cachedValue } from "./retrieval-accelerator";

export interface TerminalFinalOptions extends TerminalGovernorOptions {
  structuredPreFetch?: boolean;
  openAlexApiKey?: string;
}

export interface TerminalIndependence {
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

export interface TerminalFinalResult extends TerminalGovernorResult {
  structuredItems: StructuredItem[];
  portfolioIndependence: TerminalIndependence;
  marginalGain: TerminalMarginalGain;
}

function computeIndependence(lanes: LaneExecution[]): TerminalIndependence {
  const families = new Set<string>();
  for (const lane of lanes) {
    if (lane.status === "fulfilled") families.add(familyOf(lane.id));
  }
  const fulfilledFamilies = Array.from(families).sort();
  return {
    distinctFamilies: fulfilledFamilies.length,
    fulfilledFamilies,
    effectiveWitnessCount: fulfilledFamilies.length,
  };
}

function computeMarginalGain(
  lanes: LaneExecution[],
  canonicalWinner: CanonicalLaneId | undefined,
  consensusWinner: CanonicalLaneId | undefined,
): TerminalMarginalGain {
  const fulfilled = lanes.filter((lane) => lane.status === "fulfilled");
  const failedCount = lanes.length - fulfilled.length;
  if (fulfilled.length <= 1) {
    return { fulfilledCount: fulfilled.length, failedCount, extraLanesChangedWinner: false, attestedDelta: 0, assessment: "single-lane-only" };
  }
  const extraLanesChangedWinner = canonicalWinner !== undefined && consensusWinner !== undefined && canonicalWinner !== consensusWinner;
  const winnerId = consensusWinner ?? canonicalWinner;
  const winnerAttested = fulfilled.find((lane) => lane.id === winnerId)?.normalized?.attestedCount ?? 0;
  const bestOther = Math.max(0, ...fulfilled.filter((lane) => lane.id !== winnerId).map((lane) => lane.normalized?.attestedCount ?? 0));
  const attestedDelta = winnerAttested - bestOther;
  const assessment = extraLanesChangedWinner || attestedDelta >= 2
    ? "high-value"
    : attestedDelta >= 1 || fulfilled.length >= 3
      ? "moderate-value"
      : "low-value";
  return { fulfilledCount: fulfilled.length, failedCount, extraLanesChangedWinner, attestedDelta, assessment };
}

// RFC 9309 strict helper: 4xx robots responses allow crawling, while network
// errors and 5xx responses deny. It is available to crawl callers without
// changing the package policy module.
const ROBOTS_TTL_MS = 24 * 60 * 60_000;

function parseRobotsStarRules(text: string): Array<{ allow: boolean; path: string }> {
  const rules: Array<{ allow: boolean; path: string }> = [];
  let inStarGroup = false;
  let sawUserAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (!line || separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      sawUserAgent = true;
      inStarGroup = value === "*";
    } else if (sawUserAgent && inStarGroup && value && (key === "allow" || key === "disallow")) {
      rules.push({ allow: key === "allow", path: value });
    }
  }
  return rules;
}

function robotsPathMatches(path: string, rulePath: string): boolean {
  if (!rulePath) return false;
  if (rulePath.endsWith("$")) return path === rulePath.slice(0, -1);
  return path.startsWith(rulePath);
}

export function makeRfc9309RobotsDecision(): (url: string, signal?: AbortSignal) => Promise<"allow" | "deny" | "unknown"> {
  return async (url, signal) => {
    let origin = "";
    let path = "";
    try {
      const parsed = new URL(url);
      origin = parsed.origin;
      path = `${parsed.pathname}${parsed.search}`;
    } catch {
      return "unknown";
    }
    const cached = await cachedValue(`terminal-rfc9309\u0000${origin}`, ROBOTS_TTL_MS, async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4_000);
        signal?.addEventListener("abort", () => controller.abort(), { once: true });
        const response = await fetch(`${origin}/robots.txt`, {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        clearTimeout(timeout);
        if (response.status >= 500) return { kind: "unreachable" as const, rules: [] };
        if (!response.ok) return { kind: "unavailable" as const, rules: [] };
        return { kind: "ok" as const, rules: parseRobotsStarRules((await response.text()).slice(0, 512 * 1024)) };
      } catch {
        return { kind: "unreachable" as const, rules: [] };
      }
    });
    if (cached.value.kind === "unreachable") return "deny";
    if (cached.value.kind === "unavailable") return "allow";
    let best: { allow: boolean; path: string } | undefined;
    for (const rule of cached.value.rules) {
      if (robotsPathMatches(path, rule.path) && (!best || rule.path.length > best.path.length)) best = rule;
    }
    return best?.allow === false ? "deny" : "allow";
  };
}

export async function groundTerminalFinal(
  question: string,
  opts?: TerminalFinalOptions,
): Promise<TerminalFinalResult> {
  const dbg = opts?.onDebug ?? (() => {});
  const normalized = (question ?? "").replace(/\s+/g, " ").trim();
  const doStructured = opts?.structuredPreFetch !== false;

  const structuredPromise = doStructured && normalized
    ? structuredSearch(normalized, {
        signal: opts?.signal,
        limitPerSource: 6,
        openAlexApiKey: opts?.openAlexApiKey,
      } satisfies StructuredAdapterOptions).catch(() => ({
        items: [] as StructuredItem[],
        queriedSources: [] as string[],
        totalFound: 0,
      }))
    : Promise.resolve({ items: [] as StructuredItem[], queriedSources: [] as string[], totalFound: 0 });

  dbg("terminal-final: groundWithTerminalPortfolioGovernor");
  const governorResult = await groundWithTerminalPortfolioGovernor(normalized, {
    ...opts,
    onDebug: (message) => dbg(`[governor] ${message}`),
  });
  const structured = await structuredPromise;
  const portfolioIndependence = computeIndependence(governorResult.laneResults);
  const marginalGain = computeMarginalGain(
    governorResult.laneResults,
    governorResult.canonicalWinnerLane,
    governorResult.consensusWinnerLane,
  );

  const seenUrls = new Set(governorResult.sources.map((source) => source.url));
  const extraSources: StandardSource[] = [];
  for (const item of structured.items) {
    const url = item.externalUrl ?? (item.doi ? `https://doi.org/${item.doi}` : undefined) ?? `structured:${item.kind}:${item.title.slice(0, 40)}`;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    extraSources.push({
      title: item.title || "Structured Item",
      url,
      content: (item.pageContent || item.abstract || "").slice(0, 1800),
    });
  }

  let evidenceBlock = governorResult.evidenceBlock;
  if (structured.items.length > 0 && evidenceBlock.length > 0) {
    const items = structured.items.slice(0, 6).map((item, index) =>
      `[STRUCTURED:${item.kind.toUpperCase()}:${index + 1}] ${item.title}\n${(item.pageContent || "").slice(0, 360)}`,
    ).join("\n\n");
    const insertion = evidenceBlock.lastIndexOf("END RETRIEVED CONTENT");
    if (insertion >= 0) {
      evidenceBlock = `${evidenceBlock.slice(0, insertion)}BEGIN STRUCTURED API ITEMS\n${items}\nEND STRUCTURED API ITEMS\n\n${evidenceBlock.slice(insertion)}`;
    }
  }

  return {
    ...governorResult,
    provider: `terminal-final(${governorResult.provider}+structured:${structured.items.length}+families:${portfolioIndependence.distinctFamilies})`,
    count: governorResult.sources.length + extraSources.length,
    sources: [...governorResult.sources, ...extraSources],
    evidenceBlock,
    structuredItems: structured.items,
    portfolioIndependence,
    marginalGain,
  };
}

export async function runTerminalFinalDiagnostics(): Promise<{
  ok: boolean;
  suites: Array<{ name: string; ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> }>;
}> {
  const suites: Array<{ name: string; ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> }> = [];
  const run = async (name: string, fn: () => Promise<{ ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> }> | { ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> }) => {
    try {
      const result = await fn();
      suites.push({ name, ...result });
    } catch (error) {
      suites.push({ name, ok: false, checks: [{ id: "suite-error", passed: false, detail: error instanceof Error ? error.message : String(error) }] });
    }
  };

  await run("canonical-portfolio-orchestrator", () => runCanonicalPortfolioDiagnostics());
  await run("portfolio-consensus-adjudicator", () => runPortfolioConsensusDiagnostics());
  await run("portfolio-terminal-governor", () => runPortfolioTerminalGovernorDiagnostics());
  await run("spa-rescue-bridge", () => runSpaRescueBridgeDiagnostics());

  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  const mock: LaneExecution[] = [
    { id: "terminal-wire", priority: 100, status: "fulfilled", elapsedMs: 300, normalized: { ok: true, acceptable: true, eligibleForWinner: true, provider: "tw", evidenceBlock: "x", sources: [], sourceCount: 1, claimCount: 1, structuredItemCount: 0, attestedCount: 2, supportedCount: 0, conflictedCount: 0, proof: "verified", qualityVector: [1, 4, 2, 0, 1, 1, 100] } },
    { id: "omni-nexus", priority: 60, status: "fulfilled", elapsedMs: 400, normalized: { ok: true, acceptable: true, eligibleForWinner: true, provider: "on", evidenceBlock: "y", sources: [], sourceCount: 1, claimCount: 1, structuredItemCount: 0, attestedCount: 0, supportedCount: 1, conflictedCount: 0, proof: "bound", qualityVector: [1, 3, 0, 1, 1, 1, 100] } },
    { id: "sentinel-orchestrator", priority: 95, status: "rejected", elapsedMs: 50, error: "timeout" },
  ];
  const independence = computeIndependence(mock);
  add("independence-2-families", independence.distinctFamilies === 2 && independence.fulfilledFamilies.includes("conclave-core") && independence.fulfilledFamilies.includes("omni-standalone"), `families=${independence.fulfilledFamilies.join(",")}`);
  const marginal = computeMarginalGain(mock, "terminal-wire", "omni-nexus");
  add("marginal-changed-winner", marginal.extraLanesChangedWinner && marginal.assessment === "high-value", marginal.assessment);
  add("engine-family-import", ENGINE_FAMILY["terminal-wire"] === "conclave-core" && ENGINE_FAMILY["omni-nexus"] === "omni-standalone", `tw=${ENGINE_FAMILY["terminal-wire"]}`);
  add("robots-factory-exported", typeof makeRfc9309RobotsDecision() === "function", "factory ok");
  suites.push({ name: "terminal-final-synthesis", ok: checks.every((check) => check.passed), checks });
  return { ok: suites.every((suite) => suite.ok), suites };
}

export {
  groundWithTerminalPortfolioGovernor,
  familyOf,
  ENGINE_FAMILY,
  type TerminalGovernorOptions,
  type TerminalGovernorResult,
} from "./portfolio-terminal-governor";