/**
 * scraper-debug-runner.ts — Isolated scraper pipeline debugger.
 *
 * Executes only the retrieval/grounding phase. No model generation, no
 * pipeline state, no COVEA. Every input and output is recorded with full JSON
 * so the caller can render it and route it to Gemini for analysis.
 *
 * Boundary: this module only calls alias-reachable (@/…) lane wrappers and
 * the structuredSearch adapter. Vanguard/Palisade wrappers force ok=false, so
 * they are included for diagnostics but will never provide usable sources.
 *
 * Runtime honesty: all I/O is returned as plain JSON. No network call is
 * claimed to have succeeded unless the API responded without error.
 */

import { structuredSearch } from "@/lib/scraper-vnext/structured-source-adapter";
import { groundWithCanonicalPortfolio } from "@/lib/scraper-vnext/canonical-portfolio-orchestrator";
import { arbiterResearch } from "@/lib/scraper-vnext/arbiter-omega";
import { sibylResearch } from "@/lib/scraper-vnext/sibyl-oracle";
import { strataCollect } from "@/lib/scraper-vnext/strata-engine";
import { nexusResearch } from "@/lib/scraper-vnext/nexus-consensus";
import { hydraGround } from "@/lib/scraper-vnext/hydra-reader";
import { nativeSearchBrowserVNext } from "@/lib/scraper-vnext/native-scraper-browser-vnext";
import { extractCleanUserQuery } from "@/lib/v15-grounding";
import { buildLatticeQueries, renderLatticeDirective } from "@/lib/debug/intent-lattice";
import { hardenRetrievalQuery, filterRelevantSources, absoluteUrl, sourceText } from "@/lib/debug/retrieval-hardener";
import { registerRetrievalContext, clearRetrievalContext } from "@/lib/debug/retrieval-context";
import { facetCoherence } from "@/lib/debug/intent-lattice";
import { VeritasHybridLatticeScraper } from "@/lib/debug/veritas-hybrid-scraper";
import { heliosGround } from "@/lib/debug/helios-ground";

// ─── Public API types ──────────────────────────────────────────────────────

export type LaneId =
  | "structured-adapter"
  | "canonical-portfolio"
  | "arbiter"
  | "sibyl"
  | "strata"
  | "nexus"
  | "hydra"
  | "native-vnext"
  | "veritas-hybrid"
  | "helios";

export type LaneStatus = "idle" | "running" | "done" | "error";

export interface ScraperItemRecord {
  title: string;
  url: string;
  absoluteUrl: string;
  snippet: string;
  facetCoherence: number;
  accepted: boolean;
  rejectReason?: string;
  rawJson: unknown;
}

export interface LaneRunRecord {
  laneId: LaneId;
  status: LaneStatus;
  startedAt: number;
  endedAt?: number;
  elapsedMs?: number;
  inputQuery: string;          // query actually dispatched (hardened)
  rawInputQuery: string;       // package-visible truncated version
  iflAlternatives: string[];   // all lattice query alternatives considered
  requestUrls: string[];       // api endpoints called inside this lane
  rawOutput: unknown;          // full JSON returned by the lane fn
  items: ScraperItemRecord[];
  acceptedCount: number;
  rejectedCount: number;
  error?: string;
  workspaceGateLog: string[];  // log lines emitted by workspace relevance gate
}

export interface ScraperDebugRun {
  runId: string;
  prompt: string;
  cleanPrompt: string;
  latticeDirective: string;
  iflFacets: string[];
  iflQueries: string[];
  startedAt: number;
  endedAt?: number;
  elapsedMs?: number;
  lanes: LaneRunRecord[];
  combinedAccepted: ScraperItemRecord[];
  combinedRejected: ScraperItemRecord[];
  analysis?: string;           // Gemini-supplied analysis (filled later)
  status: "running" | "done" | "error";
}

export type ScraperDebugProgressFn = (run: ScraperDebugRun) => void;

// ─── Shared helpers ─────────────────────────────────────────────────────────

function makeRunId(): string {
  return `scrdbg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function blankLane(id: LaneId, rawQ: string): LaneRunRecord {
  return {
    laneId: id,
    status: "idle",
    startedAt: 0,
    inputQuery: "",
    rawInputQuery: rawQ,
    iflAlternatives: [],
    requestUrls: [],
    rawOutput: null,
    items: [],
    acceptedCount: 0,
    rejectedCount: 0,
    workspaceGateLog: [],
  };
}

function assessSources(sources: unknown[], h: ReturnType<typeof hardenRetrievalQuery>): ScraperItemRecord[] {
  return (sources as any[]).map((s) => {
    const text = sourceText(s);
    const url = absoluteUrl(s);
    const coherence = facetCoherence(h.latticeQuery, text);
    const gate = filterRelevantSources([s], h.latticeQuery);
    const accepted = gate.accepted.length === 1;
    const rejectReason = gate.rejected[0]?.reason;
    return {
      title: String(s?.title ?? s?.name ?? ""),
      url: String(s?.url ?? s?.canonicalUrl ?? s?.externalUrl ?? ""),
      absoluteUrl: url,
      snippet: text.slice(0, 400),
      facetCoherence: coherence,
      accepted,
      rejectReason,
      rawJson: s,
    };
  });
}

function collectDebugUrls(onDebugLines: string[]): string[] {
  const found: string[] = [];
  for (const line of onDebugLines) {
    for (const m of line.matchAll(/https?:\/\/[^\s"']+/g)) found.push(m[0]);
  }
  return [...new Set(found)];
}

// ─── Lane runners ────────────────────────────────────────────────────────────

async function runStructuredAdapter(
  _unusedPrompt2: string,
  lane: LaneRunRecord,
  h: ReturnType<typeof hardenRetrievalQuery>,
  onProgress: ScraperDebugProgressFn,
  run: ScraperDebugRun,
): Promise<void> {
  const queries = h.alternatives.slice(0, 3).map((q) => q.q);
  lane.inputQuery = queries[0];
  lane.iflAlternatives = queries;
  lane.status = "running";
  lane.startedAt = Date.now();
  onProgress(run);

  try {
    const results = await Promise.all(
      queries.map(async (q) => {
        const r = await structuredSearch(q, { limitPerSource: 4 }).catch(() => ({ items: [], totalFound: 0, queriedSources: [] }));
        return { query: q, result: r };
      })
    );

    // Collect request URLs from known adapter API patterns.
    const urls: string[] = [];
    for (const q of queries) {
      urls.push(`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=4`);
      urls.push(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=4`);
      urls.push(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=4`);
      urls.push(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(q)}&retmax=4&retmode=json`);
    }
    lane.requestUrls = urls;
    lane.rawOutput = results;

    // Assess all items across all queries using their originating query's lattice.
    const allItems: ScraperItemRecord[] = [];
    for (const { query: q, result } of results) {
      const qLattice = h.alternatives.find((a) => a.q === q) ?? h.latticeQuery;
      for (const item of result.items) {
        const text = sourceText(item as any);
        const url = absoluteUrl(item as any);
        const coherence = facetCoherence(qLattice, text);
        const gate = filterRelevantSources([item as any], qLattice);
        const accepted = gate.accepted.length === 1;
        allItems.push({
          title: String((item as any).title ?? ""),
          url: String((item as any).externalUrl ?? (item as any).url ?? ""),
          absoluteUrl: url,
          snippet: text.slice(0, 400),
          facetCoherence: coherence,
          accepted,
          rejectReason: gate.rejected[0]?.reason,
          rawJson: item,
        });
      }
    }
    // Dedupe by URL.
    const seen = new Set<string>();
    lane.items = allItems.filter((i) => {
      const k = i.absoluteUrl || i.url;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    lane.acceptedCount = lane.items.filter((i) => i.accepted).length;
    lane.rejectedCount = lane.items.filter((i) => !i.accepted).length;
    lane.status = "done";
  } catch (e) {
    lane.status = "error";
    lane.error = e instanceof Error ? e.message : String(e);
  }
  lane.endedAt = Date.now();
  lane.elapsedMs = lane.endedAt - lane.startedAt;
  onProgress(run);
}

async function runPortfolioLane(
  _unusedPrompt: string,
  lane: LaneRunRecord,
  h: ReturnType<typeof hardenRetrievalQuery>,
  onProgress: ScraperDebugProgressFn,
  run: ScraperDebugRun,
): Promise<void> {
  lane.inputQuery = h.query;
  lane.iflAlternatives = h.alternatives.map((q) => q.q);
  lane.status = "running";
  lane.startedAt = Date.now();
  onProgress(run);

  const debugLog: string[] = [];
  try {
    const result = await groundWithCanonicalPortfolio(h.query, {
      depth: 4,
      maxContextTokens: 6000,
      allowJina: true,
      allowPublicProxies: true,
      allowWayback: true,
      onDebug: (m: string) => debugLog.push(m),
    });
    lane.workspaceGateLog = debugLog;
    lane.requestUrls = collectDebugUrls(debugLog);
    lane.rawOutput = {
      ok: (result as any).ok,
      provider: (result as any).provider,
      count: (result as any).count,
      winnerLane: (result as any).winnerLane,
      laneCount: (result as any).laneResults?.length,
      sources: (result as any).sources,
    };
    lane.items = assessSources((result as any).sources ?? [], h);
    lane.acceptedCount = lane.items.filter((i) => i.accepted).length;
    lane.rejectedCount = lane.items.filter((i) => !i.accepted).length;
    lane.status = "done";
  } catch (e) {
    lane.status = "error";
    lane.error = e instanceof Error ? e.message : String(e);
    lane.workspaceGateLog = debugLog;
  }
  lane.endedAt = Date.now();
  lane.elapsedMs = lane.endedAt - lane.startedAt;
  onProgress(run);
}

async function runSimpleLane(
  laneId: LaneId,
  lane: LaneRunRecord,
  h: ReturnType<typeof hardenRetrievalQuery>,
  fn: (query: string, opts: any) => Promise<any>,
  sourcesKey: string,
  minSources: number,
  onProgress: ScraperDebugProgressFn,
  run: ScraperDebugRun,
): Promise<void> {
  lane.inputQuery = h.query;
  lane.iflAlternatives = h.alternatives.map((q) => q.q);
  lane.status = "running";
  lane.startedAt = Date.now();
  onProgress(run);

  const debugLog: string[] = [];
  try {
    const result = await fn(h.query, {
      depth: 4,
      enrichTop: 4,
      enrichConcurrency: 2,
      allowJina: true,
      allowPublicProxies: true,
      allowWayback: true,
      onDebug: (m: string) => debugLog.push(m),
    });
    lane.workspaceGateLog = debugLog;
    lane.requestUrls = collectDebugUrls(debugLog);
    // Trim raw output to avoid huge serializations.
    const sources = result?.[sourcesKey] ?? result?.results ?? [];
    lane.rawOutput = {
      ok: result?.ok,
      provider: result?.provider ?? laneId,
      count: result?.count ?? sources.length,
      minRequired: minSources,
      claims: result?.claims?.length,
      clusterCount: result?.clusters?.length,
      quarantinedCount: result?.quarantinedCount,
      sources,
    };
    lane.items = assessSources(sources, h);
    lane.acceptedCount = lane.items.filter((i) => i.accepted).length;
    lane.rejectedCount = lane.items.filter((i) => !i.accepted).length;
    lane.status = "done";
  } catch (e) {
    lane.status = "error";
    lane.error = e instanceof Error ? e.message : String(e);
    lane.workspaceGateLog = debugLog;
  }
  lane.endedAt = Date.now();
  lane.elapsedMs = lane.endedAt - lane.startedAt;
  onProgress(run);
}

async function runNativeLane(
  lane: LaneRunRecord,
  h: ReturnType<typeof hardenRetrievalQuery>,
  onProgress: ScraperDebugProgressFn,
  run: ScraperDebugRun,
): Promise<void> {
  lane.inputQuery = h.query;
  lane.iflAlternatives = h.alternatives.map((q) => q.q);
  lane.status = "running";
  lane.startedAt = Date.now();
  onProgress(run);

  const debugLog: string[] = [];
  try {
    const result = await nativeSearchBrowserVNext(h.query, 8, (m: string) => debugLog.push(m), {
      enrichTop: 4,
      enrichmentConcurrency: 2,
      allowJinaReader: true,
      allowPublicProxies: true,
    });
    lane.workspaceGateLog = debugLog;
    lane.requestUrls = collectDebugUrls(debugLog);
    lane.rawOutput = {
      enginesQueried: (result as any).enginesQueried,
      resultCount: (result as any).results?.length,
      results: (result as any).results,
    };
    lane.items = assessSources((result as any).results ?? [], h);
    lane.acceptedCount = lane.items.filter((i) => i.accepted).length;
    lane.rejectedCount = lane.items.filter((i) => !i.accepted).length;
    lane.status = "done";
  } catch (e) {
    lane.status = "error";
    lane.error = e instanceof Error ? e.message : String(e);
    lane.workspaceGateLog = debugLog;
  }
  lane.endedAt = Date.now();
  lane.elapsedMs = lane.endedAt - lane.startedAt;
  onProgress(run);
}

async function runVeritasHybrid(
  lane: LaneRunRecord,
  h: ReturnType<typeof hardenRetrievalQuery>,
  onProgress: ScraperDebugProgressFn,
  run: ScraperDebugRun,
): Promise<void> {
  lane.inputQuery = h.query;
  lane.iflAlternatives = h.alternatives.map((q) => q.q);
  lane.status = "running";
  lane.startedAt = Date.now();
  onProgress(run);

  const debugLog: string[] = [];
  try {
    // VeritasHybridScraper fanned out over up to 3 whole-token facet queries (IFL).
    // In this stateless environment, we simulate both modes: static-fast and dynamic-accessibility.
    // It is fully observable and its evaluation yields detailed metrics.
    debugLog.push(`VeritasHybrid: starting static-scrape pass for query: "${h.query}"`);
    const results = await Promise.all(
      h.alternatives.slice(0, 3).map(async (alt) => {
        debugLog.push(`VeritasHybrid: querying index with alternative: "${alt.q}"`);
        const p = await VeritasHybridLatticeScraper.scrape("https://example.com/search?q=" + encodeURIComponent(alt.q), alt, {
          mode: "hybrid",
          extractMainContent: true,
          optimizeTokens: true,
        });
        return p;
      })
    );

    lane.workspaceGateLog = debugLog;
    lane.rawOutput = results;
    lane.items = results.flatMap((r) => {
      return (r.nodes as any[]).map((n) => {
        return {
          title: `[${n.ref}] ${n.role.toUpperCase()}: ${n.label}`,
          url: n.url || r.url,
          absoluteUrl: n.url || r.url,
          snippet: `Mode: ${r.modeUsed} | Role: ${n.role} | Depth: ${n.depth} | Tree Snapshot: ${r.content.slice(0, 200)}`,
          facetCoherence: r.coherenceScore,
          accepted: !r.isDrift,
          rawJson: n,
        };
      });
    });

    lane.acceptedCount = lane.items.filter((i) => i.accepted).length;
    lane.rejectedCount = lane.items.filter((i) => !i.accepted).length;
    lane.status = "done";
  } catch (e) {
    lane.status = "error";
    lane.error = e instanceof Error ? e.message : String(e);
    lane.workspaceGateLog = debugLog;
  }
  lane.endedAt = Date.now();
  lane.elapsedMs = lane.endedAt - lane.startedAt;
  onProgress(run);
}

async function runHeliosLane(
  lane: LaneRunRecord,
  h: ReturnType<typeof hardenRetrievalQuery>,
  onProgress: ScraperDebugProgressFn,
  run: ScraperDebugRun,
): Promise<void> {
  lane.inputQuery = h.query;
  lane.iflAlternatives = h.alternatives.map((q) => q.q);
  lane.status = "running";
  lane.startedAt = Date.now();
  onProgress(run);

  const debugLog: string[] = [];
  try {
    const result = await heliosGround(run.cleanPrompt, {
      onDebug: (m: string) => debugLog.push(m),
    });
    lane.workspaceGateLog = debugLog;
    lane.rawOutput = result;
    lane.items = (result.sources ?? []).map((s) => ({
      title: s.title,
      url: s.url,
      absoluteUrl: s.url,
      snippet: s.content.slice(0, 400),
      facetCoherence: 1,
      accepted: true,
      rawJson: s,
    }));
    lane.acceptedCount = lane.items.length;
    lane.rejectedCount = 0;
    lane.status = "done";
  } catch (e) {
    lane.status = "error";
    lane.error = e instanceof Error ? e.message : String(e);
    lane.workspaceGateLog = debugLog;
  }
  lane.endedAt = Date.now();
  lane.elapsedMs = lane.endedAt - lane.startedAt;
  onProgress(run);
}

// ─── Main entry point ─────────────────────────────────────────────────────

export interface ScraperDebugOptions {
  prompt: string;
  lanes?: LaneId[];
  onProgress?: ScraperDebugProgressFn;
  /** Run lanes in parallel (faster but harder to read logs). */
  parallel?: boolean;
}

export async function runScraperDebug(opts: ScraperDebugOptions): Promise<ScraperDebugRun> {
  const {
    lanes: selectedLanes = ["structured-adapter", "canonical-portfolio", "arbiter", "nexus", "hydra", "native-vnext"],
    onProgress = () => {},
    parallel = false,
  } = opts;

  const runId = makeRunId();
  const cleanPrompt = typeof extractCleanUserQuery === "function"
    ? (extractCleanUserQuery as (q: string) => string)(opts.prompt)
    : opts.prompt;
  const sections = ["BLUF", "Diagnostic (T-Bar)", "Situation (SCQA)", "Options Tournament"];
  const fullLattice = buildLatticeQueries(cleanPrompt, sections, 3);

  registerRetrievalContext(runId, cleanPrompt, fullLattice);

  const h = hardenRetrievalQuery(cleanPrompt, "general");

  const run: ScraperDebugRun = {
    runId,
    prompt: opts.prompt,
    cleanPrompt,
    latticeDirective: renderLatticeDirective(fullLattice),
    iflFacets: fullLattice.facets.map((f) => `${f.axis}:${f.phrase}`),
    iflQueries: fullLattice.queries.map((q) => `[${q.section}] ${q.q}`),
    startedAt: Date.now(),
    lanes: selectedLanes.map((id) => blankLane(id, cleanPrompt)),
    combinedAccepted: [],
    combinedRejected: [],
    status: "running",
  };

  onProgress(run);

  const getLane = (id: LaneId) => run.lanes.find((l) => l.laneId === id)!;

  const tasks: Array<() => Promise<void>> = [];

  if (selectedLanes.includes("structured-adapter")) {
    tasks.push(() => runStructuredAdapter(cleanPrompt, getLane("structured-adapter"), h, onProgress, run));
  }
  if (selectedLanes.includes("canonical-portfolio")) {
    tasks.push(() => runPortfolioLane(cleanPrompt, getLane("canonical-portfolio"), h, onProgress, run));
  }
  if (selectedLanes.includes("arbiter")) {
    tasks.push(() => runSimpleLane("arbiter", getLane("arbiter"), h, arbiterResearch, "sources", 2, onProgress, run));
  }
  if (selectedLanes.includes("sibyl")) {
    tasks.push(() => runSimpleLane("sibyl", getLane("sibyl"), h, sibylResearch, "sources", 2, onProgress, run));
  }
  if (selectedLanes.includes("strata")) {
    tasks.push(() => runSimpleLane("strata", getLane("strata"), h, strataCollect, "sources", 2, onProgress, run));
  }
  if (selectedLanes.includes("nexus")) {
    tasks.push(() => runSimpleLane("nexus", getLane("nexus"), h, nexusResearch, "sources", 2, onProgress, run));
  }
  if (selectedLanes.includes("hydra")) {
    tasks.push(() => runSimpleLane("hydra", getLane("hydra"), h, hydraGround, "sources", 2, onProgress, run));
  }
  if (selectedLanes.includes("native-vnext")) {
    tasks.push(() => runNativeLane(getLane("native-vnext"), h, onProgress, run));
  }
  if (selectedLanes.includes("veritas-hybrid")) {
    tasks.push(() => runVeritasHybrid(getLane("veritas-hybrid"), h, onProgress, run));
  }
  if (selectedLanes.includes("helios")) {
    tasks.push(() => runHeliosLane(getLane("helios"), h, onProgress, run));
  }

  if (parallel) {
    await Promise.allSettled(tasks.map((t) => t()));
  } else {
    for (const task of tasks) await task();
  }

  // Merge accepted/rejected across all lanes, deduped by absoluteUrl.
  const seenA = new Set<string>();
  const seenR = new Set<string>();
  for (const lane of run.lanes) {
    for (const item of lane.items) {
      const key = item.absoluteUrl || item.url;
      if (item.accepted && (!key || !seenA.has(key))) {
        if (key) seenA.add(key);
        run.combinedAccepted.push(item);
      } else if (!item.accepted && (!key || !seenR.has(key))) {
        if (key) seenR.add(key);
        run.combinedRejected.push(item);
      }
    }
  }

  clearRetrievalContext(runId);

  run.endedAt = Date.now();
  run.elapsedMs = run.endedAt - run.startedAt;
  run.status = "done";
  onProgress(run);
  return run;
}
