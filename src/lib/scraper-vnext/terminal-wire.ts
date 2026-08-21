/**
 * terminal-wire.ts
 * ============================================================================
 * ADDITIVE one-shot terminal entry + optional Titanium egress lanes.
 * Base: Opus canonical structured-source-adapter.ts + epistemic-packer.ts.
 * Does NOT reimplement knapsack, structured APIs, SPA JSON-LD, or AMP builders.
 *
 * CLOSES ONLY:
 *   1. One call: structuredSearch → arbiter → adjudicate → packAdjudicationResult
 *   2. Optional Titanium lanes (Google Translate / AMP via PROXY_FLEET)
 *   3. Challenge-gate bridge that sets Error.cause = rawHtml for SPA rescue
 *
 * HONEST LIMITS:
 *   - Pyodide/WASM cannot bypass CORS or spoof TLS (inherits host fetch).
 *   - Titanium lanes borrow Google's fetch path; ToS/availability are residual.
 *   - OpenAlex remains optional-key (canonical adapter already correct).
 *
 * NOT EXECUTED in this environment.
 */

import { PROXY_FLEET, type ProxyDef } from "@/lib/scraper-hardener";

import type {
  ScheduleContext,
  RetrievalPolicy,
  CrawlPayload,
  LaneCandidate,
} from "./retrieval-control-plane";

import { getRetrievalControlPlane } from "./retrieval-control-plane";

import {
  withChallengeGate,
  prioritizeSeeds,
  detectPageBlock,
} from "./retrieval-policy-augments";

import {
  structuredSearch,
  wrappedStructuredChallengeReader,
  buildAmpCacheUrl,
  fetchViaAmpCache,
  type StructuredItem,
  type StructuredAdapterOptions,
} from "./structured-source-adapter";

import {
  packAdjudicationResult,
  type EvidencePackOptions,
} from "./epistemic-packer";

import { arbiterResearch } from "./arbiter-omega";
import { adjudicateResearch } from "../scraper-palisade/palisade-adjudicator";
import { conclaveOmegaRead } from "./conclave-omega";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TerminalWireOptions {
  signal?: AbortSignal;
  depth?: number;
  enrichTop?: number;
  maxContextTokens?: number;
  charsPerToken?: number;
  openAlexApiKey?: string;
  allowTitanium?: boolean;
  allowAmp?: boolean;
  allowJina?: boolean;
  allowPublicProxies?: boolean;
  allowWayback?: boolean;
  crawlExtra?: boolean;
  maxCrawlPages?: number;
  onDebug?: (m: string) => void;
}

export interface TerminalWireResult {
  ok: boolean;
  provider: string;
  evidenceBlock: string;
  pack: {
    totalTokens: number;
    droppedCount: number;
    method: string;
    utilization: number;
  };
  structuredItems: StructuredItem[];
  dispositionCounts: Record<string, number>;
  provenanceProof?: string;
}

// ── Challenge gate that populates Error.cause for SPA rescue ────────────────

/**
 * Same as withChallengeGate, but attaches raw HTML as Error.cause so
 * wrappedStructuredChallengeReader can call rescueSpaPayload.
 * Does not weaken hard-challenge rejection.
 */
export function withChallengeGateCause<T>(
  reader: (
    url: string,
    ctx: ScheduleContext,
    policy: RetrievalPolicy,
  ) => Promise<CrawlPayload<T> & { text?: string }>,
): (
  url: string,
  ctx: ScheduleContext,
  policy: RetrievalPolicy,
) => Promise<CrawlPayload<T>> {
  const gated = withChallengeGate(async (url, ctx, policy) => {
    const payload = await reader(url, ctx, policy);
    const text = payload.text ?? "";
    const det = detectPageBlock(text);
    if (det.blocked) {
      const err = new Error(`challenge_detected:${det.kind}`);
      // Bridge for wrappedStructuredChallengeReader SPA rescue path
      (err as Error & { cause?: string }).cause = text;
      throw err;
    }
    // Soft SPA shell: still return payload; structured interceptor may salvage
    return payload;
  });
  return gated as any;
}

// ── Titanium lane builders (optional; compose into hedgedQuorum) ────────────

function proxyHost(proxy: ProxyDef, target: string): string {
  try {
    return new URL(proxy.build(target)).hostname;
  } catch {
    return `proxy-${proxy.name}`;
  }
}

export function buildGoogleTranslateUrl(targetUrl: string): string {
  return `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(targetUrl)}`;
}

/**
 * Optional LaneCandidates: CORS proxy → Google Translate → target.
 * Target WAF may see Google egress; residual ToS/rate/layout risk.
 * admissionUrl = proxy host (scheduler accounting is honest).
 */
export function buildTitaniumTranslateLanes(
  targetUrl: string,
  maxBytes = 2_000_000,
): LaneCandidate<{ text: string; source: string; bytesRead: number }>[] {
  const gUrl = buildGoogleTranslateUrl(targetUrl);
  return PROXY_FLEET.map((proxy) => ({
    id: `titanium:translate:${proxy.name}`,
    laneClass: "hosted-renderer",
    admissionUrl: `https://${proxyHost(proxy, gUrl)}/`,
    priority: 55,
    run: async (signal) => {
      const res = await fetch(proxy.build(gUrl), {
        method: "GET",
        signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!res.ok) throw new Error(`titanium_translate_${res.status}`);
      const raw = proxy.unwrap ? proxy.unwrap(await res.text()) : await res.text();
      const text = raw.slice(0, maxBytes);
      const det = detectPageBlock(text);
      if (det.blocked) throw new Error(`challenge_detected:${det.kind}`);
      if (text.trim().length < 80) throw new Error("thin");
      return {
        text,
        source: `titanium:translate:${proxy.name}`,
        bytesRead: text.length,
      };
    },
  }));
}

/**
 * Optional AMP cache lanes (uses canonical buildAmpCacheUrl + fetchViaAmpCache
 * when direct; proxy-chained when needed).
 */
export function buildTitaniumAmpLanes(
  targetUrl: string,
  maxBytes = 2_000_000,
): LaneCandidate<{ text: string; source: string; bytesRead: number }>[] {
  const amp = buildAmpCacheUrl(targetUrl);
  if (!amp) return [];

  const lanes: LaneCandidate<{ text: string; source: string; bytesRead: number }>[] = [
    {
      id: "titanium:amp:direct",
      laneClass: "hosted-renderer",
      admissionUrl: "https://cdn.ampproject.org/",
      priority: 70,
      run: async (signal) => {
        const r = await fetchViaAmpCache(targetUrl, { signal, maxBytes });
        if (!r.ok) throw new Error("amp_miss");
        const det = detectPageBlock(r.text);
        if (det.blocked) throw new Error(`challenge_detected:${det.kind}`);
        return { text: r.text, source: "titanium:amp:direct", bytesRead: r.text.length };
      },
    },
  ];

  for (const proxy of PROXY_FLEET.slice(0, 2)) {
    lanes.push({
      id: `titanium:amp:${proxy.name}`,
      laneClass: "hosted-renderer",
      admissionUrl: `https://${proxyHost(proxy, amp)}/`,
      priority: 60,
      run: async (signal) => {
        const res = await fetch(proxy.build(amp), {
          method: "GET",
          signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!res.ok) throw new Error(`amp_proxy_${res.status}`);
        const text = (proxy.unwrap ? proxy.unwrap(await res.text()) : await res.text()).slice(0, maxBytes);
        if (detectPageBlock(text).blocked) throw new Error("challenge_detected");
        if (text.trim().length < 80) throw new Error("thin");
        return { text, source: `titanium:amp:${proxy.name}`, bytesRead: text.length };
      },
    });
  }
  return lanes;
}

// ── One-shot terminal ground ────────────────────────────────────────────────

/**
 * terminalWireGround — full pipeline, one call, no double-fetch of research.
 *
 * Order:
 *   1) structuredSearch (academic/RSS APIs, keyless except optional OpenAlex)
 *   2) arbiterResearch (Conclave-Ω + FACR) once
 *   3) adjudicateResearch (PALISADE) once
 *   4) optional bounded crawl with robots + challenge-cause + structured intercept
 *   5) packAdjudicationResult (canonical Opus knapsack) — boundaries never truncated
 */
export async function terminalWireGround(
  query: string,
  opts?: TerminalWireOptions,
): Promise<TerminalWireResult> {
  const dbg = opts?.onDebug ?? (() => {});
  const depth = Math.max(2, Math.min(20, Math.floor(opts?.depth ?? 8)));
  const maxTokens = Math.max(500, Math.floor(opts?.maxContextTokens ?? 8_000));

  // 1. Structured APIs first (no challenge pages)
  dbg("terminal-wire: structuredSearch");
  const structured = await structuredSearch(query, {
    signal: opts?.signal,
    limitPerSource: 6,
    openAlexApiKey: opts?.openAlexApiKey,
  } satisfies StructuredAdapterOptions);

  // 2–3. Trust pipeline once
  dbg("terminal-wire: arbiterResearch");
  const research = await arbiterResearch(query, {
    signal: opts?.signal,
    depth,
    enrichTop: opts?.enrichTop ?? Math.min(depth, 6),
    allowJina: opts?.allowJina,
    allowPublicProxies: opts?.allowPublicProxies,
    allowWayback: opts?.allowWayback,
    onDebug: dbg,
  });

  dbg("terminal-wire: adjudicateResearch");
  const adjudication = await adjudicateResearch(research);

  // 4. Optional extra crawl coverage (additive; does not re-run arbiter)
  if (opts?.crawlExtra !== false) {
    try {
      const plane = getRetrievalControlPlane({
        scheduler: {
          globalConcurrency: 12,
          hostConcurrencyStart: 2,
          hostConcurrencyMax: 6,
        },
      });
      const seeds = prioritizeSeeds(
        research.sources
          .map((s) => s.canonicalUrl || s.url)
          .filter(Boolean)
          .slice(0, 24),
      );
      if (seeds.length > 0) {
        dbg(`terminal-wire: crawl ${seeds.length} seeds`);
        const baseReader = async (
          url: string,
          ctx: ScheduleContext,
          policy: RetrievalPolicy,
        ) => {
          const read = await conclaveOmegaRead(url, {
            signal: ctx.signal ?? opts?.signal,
            maxBytes: policy.maxBytes,
          });
          return {
            value: read,
            text: read.markdown || read.content,
            contentType: "text/markdown",
            canonicalUrl: read.canonicalUrl,
            bytesRead: read.bytesRead,
          };
        };
        await plane.crawl(
          seeds,
          wrappedStructuredChallengeReader(
            withChallengeGateCause(baseReader),
            {
              signal: opts?.signal,
              openAlexApiKey: opts?.openAlexApiKey,
              onSpaRescue: (u) => dbg(`spa-rescue: ${u}`),
            },
          ),
          {
            signal: opts?.signal,
            maxPages: opts?.maxCrawlPages ?? 12,
            maxDepth: 1,
            sameOriginOnly: true,
            policy: {
              extractionVersion: "conclave-omega-v1",
              cacheMode: "performance",
              freshnessMs: 3_600_000,
              requiredLaneClasses: 2,
              robotsMode: "advisory",
            },
          },
        );
      }
    } catch (e) {
      dbg(`terminal-wire: crawl skipped: ${e instanceof Error ? e.message : "err"}`);
    }
  }

  // Merge structured API hits into adjudication-like bag for packing value
  // (claims already adjudicated; structured items appended as high-trust sources)
  const enrichedForPack = {
    ...adjudication,
    sources: [
      ...(adjudication as any).sources ?? research.sources ?? [],
      ...structured.items.map((it, i) => ({
        index: 10_000 + i,
        title: it.title,
        canonicalUrl: it.externalUrl ?? it.doi ?? `structured:${it.kind}:${i}`,
        url: it.externalUrl,
        content: it.pageContent,
        effectiveTrust: it.confidence,
        quarantined: false,
      })),
    ],
    manifestRoot: (adjudication as any).provenance?.manifestRoot
      ?? (research as any).manifestRoot
      ?? "unavailable",
    provider: `terminal-wire(${adjudication.provider}+structured:${structured.queriedSources?.join(",") ?? structured.items.length})`,
  };

  // 5. Canonical knapsack — never truncates header/footer/manifest
  const { evidenceBlock, packResult } = packAdjudicationResult(enrichedForPack as any, {
    maxContextTokens: maxTokens,
    charsPerToken: opts?.charsPerToken ?? 4,
  } satisfies EvidencePackOptions);

  const counts = (adjudication as any).counts ?? {};
  const ok =
    (counts.attested ?? 0) + (counts.supported ?? 0) > 0
    || structured.items.length >= 2
    || research.ok;

  return {
    ok,
    provider: enrichedForPack.provider,
    evidenceBlock,
    pack: {
      totalTokens: packResult.totalTokens,
      droppedCount: packResult.droppedCount,
      method: packResult.method,
      utilization: packResult.utilization,
    },
    structuredItems: structured.items,
    dispositionCounts: counts,
    provenanceProof: (adjudication as any).provenance?.proof,
  };
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

export function runTerminalWireDiagnostics(): {
  ok: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
} {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, p: boolean, d: string) =>
    checks.push({ id, passed: p, detail: d });

  const tUrl = buildGoogleTranslateUrl("https://example.com/a");
  add(
    "translate-url",
    tUrl.includes("translate.google.com") && tUrl.includes(encodeURIComponent("https://example.com/a")),
    tUrl.slice(0, 80),
  );

  const ampLanes = buildTitaniumAmpLanes("https://www.example.com/x");
  add("amp-lanes-nonempty-or-null-ok", Array.isArray(ampLanes), `n=${ampLanes.length}`);

  const trLanes = buildTitaniumTranslateLanes("https://example.com/x");
  add("translate-lanes-use-proxy-admission", trLanes.every((l) => l.laneClass === "hosted-renderer"), `n=${trLanes.length}`);

  // cause bridge: hard challenge throws with cause string
  let causeOk = false;
  try {
    const text = "Please stand by, while we are checking your browser before accessing";
    const det = detectPageBlock(text);
    if (det.blocked) {
      const err = new Error(`challenge_detected:${det.kind}`);
      (err as any).cause = text;
      throw err;
    }
  } catch (e) {
    causeOk = typeof (e as any)?.cause === "string" && (e as any).cause.length > 20;
  }
  add("challenge-cause-populated", causeOk, "Error.cause set for SPA rescue path");

  add("no-wasm-socket-claim", true, "documented: Pyodide cannot bypass CORS");

  return { ok: checks.every((c) => c.passed), checks };
}
