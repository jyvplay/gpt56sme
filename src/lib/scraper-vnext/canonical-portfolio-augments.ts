/**
 * canonical-portfolio-augments.ts
 * ============================================================================
 * ADDITIVE audit companion to the GPT-5.6 canonical portfolio orchestrator.
 *
 * DOES NOT MODIFY:
 *   - canonical-portfolio-orchestrator.ts
 *   - Any downstream canonical engine (terminal-wire, sentinel-orchestrator,
 *     vanguard-titanium, sentinel-omega, omni-nexus, structured-source-adapter)
 *   - Any canonical primitive (retrieval-accelerator, retrieval-control-plane,
 *     retrieval-policy-augments, epistemic-packer, spa-rescue-bridge,
 *     arbiter-omega, palisade-adjudicator, conclave-omega)
 *
 * ADDS:
 *   1. Persisted yield memory   (IndexedDB, per (domain, laneClass))
 *   2. Lane-independence audit  (N Jina lanes = 1 witness)
 *   3. Persisted origin backoff (survives page refresh; RFC 9309 correct)
 *   4. Marginal evidence gain   (rolling-window stop condition)
 *   5. Audit-observing wrapper   (groundWithAuditedPortfolio) that records
 *      yield/backoff from portfolio LaneExecution results after the fact —
 *      the portfolio itself is untouched.
 *
 * HONEST LIMITS (documented, not worked around):
 *   - OpenAlex requires an API key as of 2026-02-13; caller must pass one.
 *   - RFC 9309: 4xx robots.txt permits crawling; 5xx/unreachable → disallow.
 *     The canonical policy-augments makeRobotsDecision() must be checked
 *     against this; if it fails-open on 5xx it is BUGGED and must be fixed
 *     in that file separately (out of scope here).
 *   - IndexedDB may be evicted by Safari after 7 days of no interaction;
 *     acceptable because only performance memory (not evidence) is stored.
 *   - Web Locks require HTTPS secure context.
 *   - No Titanium egress lanes enabled by default (ToS risk).
 *
 * BROWSER-ONLY. KEYLESS BASELINE. STATIC-BUILD COMPATIBLE.
 * NOT EXECUTED in this environment.
 * ============================================================================ */

import {
  groundWithCanonicalPortfolio,
  runCanonicalPortfolioDiagnostics,
  type PortfolioOptions,
  type PortfolioGroundingResult,
} from "./canonical-portfolio-orchestrator";

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — INDEXEDDB PERSISTENCE (fail-open)
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME = "canonical-portfolio-audits-v1";
const DB_VERSION = 1;
const STORE_YIELD = "yield";
const STORE_BACKOFF = "backoff";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_YIELD)) db.createObjectStore(STORE_YIELD, { keyPath: "key" });
        if (!db.objectStoreNames.contains(STORE_BACKOFF)) db.createObjectStore(STORE_BACKOFF, { keyPath: "origin" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb(); if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbPut(store: string, value: unknown): Promise<void> {
  const db = await openDb(); if (!db) return;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readwrite").objectStore(store).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb(); if (!db) return;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readwrite").objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function originOf(url: string): string {
  try { return new URL(url).origin; }
  catch { return ""; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — YIELD-AWARE QUEUE MEMORY (persisted per domain+laneClass)
// ═══════════════════════════════════════════════════════════════════════════

export interface YieldRecord {
  key: string;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  lastSeenAt: number;
}

function yieldKey(url: string, laneClass: string): string {
  return `${hostOf(url)}\u0000${laneClass}`;
}

export async function recordYieldSuccess(
  url: string,
  laneClass: string,
  latencyMs: number,
): Promise<void> {
  const key = yieldKey(url, laneClass);
  const existing = (await idbGet<YieldRecord>(STORE_YIELD, key)) ?? {
    key, successes: 0, failures: 0, totalLatencyMs: 0, lastSeenAt: 0,
  };
  existing.successes += 1;
  existing.totalLatencyMs += Math.max(0, latencyMs);
  existing.lastSeenAt = Date.now();
  await idbPut(STORE_YIELD, existing);
}

export async function recordYieldFailure(
  url: string,
  laneClass: string,
): Promise<void> {
  const key = yieldKey(url, laneClass);
  const existing = (await idbGet<YieldRecord>(STORE_YIELD, key)) ?? {
    key, successes: 0, failures: 0, totalLatencyMs: 0, lastSeenAt: 0,
  };
  existing.failures += 1;
  existing.lastSeenAt = Date.now();
  await idbPut(STORE_YIELD, existing);
}

/**
 * Composite yield score.
 *   successRate × (1 - latencyPenalty) × recencyDecay
 *   latencyPenalty = clamp(meanLatency / 20s, 0, 0.5)
 *   recencyDecay   = exp(-0.05 × ageDays)  — 14-day half-life
 */
export async function getYieldScore(
  url: string,
  laneClass: string,
): Promise<{ score: number; samples: number }> {
  const key = yieldKey(url, laneClass);
  const rec = await idbGet<YieldRecord>(STORE_YIELD, key);
  if (!rec) return { score: 0, samples: 0 };
  const total = rec.successes + rec.failures;
  const successRate = total > 0 ? rec.successes / total : 0;
  const meanLatencyMs = rec.successes > 0 ? rec.totalLatencyMs / rec.successes : 0;
  const ageDays = Math.max(0, (Date.now() - rec.lastSeenAt) / 86_400_000);
  const latencyPenalty = Math.min(0.5, meanLatencyMs / 20_000);
  const recencyDecay = Math.exp(-0.05 * ageDays);
  const score = successRate * (1 - latencyPenalty) * recencyDecay;
  return { score, samples: total };
}

export async function reorderByYield(
  urls: string[],
  laneClass: string,
): Promise<string[]> {
  const scored = await Promise.all(
    urls.map(async (url) => {
      const y = await getYieldScore(url, laneClass);
      return { url, combined: 0.5 * (0.5 + 0.5 * y.score) };
    }),
  );
  scored.sort((a, b) => b.combined - a.combined || a.url.localeCompare(b.url));
  return scored.map((s) => s.url);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — PERSISTED ORIGIN BACKOFF (survives page refresh)
// ═══════════════════════════════════════════════════════════════════════════

export interface BackoffLease {
  origin: string;
  untilMs: number;
  reason: string;
}

export async function persistBackoff(
  url: string,
  durationMs: number,
  reason = "rate-limit",
): Promise<void> {
  const origin = originOf(url);
  if (!origin) return;
  const bounded = Math.max(1_000, Math.min(24 * 3_600_000, Math.floor(durationMs)));
  await idbPut(STORE_BACKOFF, { origin, untilMs: Date.now() + bounded, reason });
}

export async function checkPersistedBackoff(url: string): Promise<number> {
  const origin = originOf(url);
  if (!origin) return 0;
  const lease = await idbGet<BackoffLease>(STORE_BACKOFF, origin);
  if (!lease) return 0;
  const remaining = lease.untilMs - Date.now();
  if (remaining <= 0) {
    idbDelete(STORE_BACKOFF, origin).catch(() => {});
    return 0;
  }
  return remaining;
}

export async function clearPersistedBackoff(url: string): Promise<void> {
  const origin = originOf(url);
  if (!origin) return;
  await idbDelete(STORE_BACKOFF, origin);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — LANE-INDEPENDENCE AUDIT
// ═══════════════════════════════════════════════════════════════════════════

export interface LaneIndependenceReport {
  distinctProviders: number;
  effectiveWitnessCount: number;
  providerGroups: Array<{
    providerId: string;
    laneIds: string[];
    witnessWeight: number;
  }>;
}

export function laneProviderId(
  laneClass: string,
  laneId: string,
  sourceUrl?: string,
): string {
  if (laneClass === "origin-direct") {
    return `direct:${hostOf(sourceUrl ?? laneId)}`;
  }
  if (laneClass === "hosted-renderer") return "jina";
  if (laneClass === "archive") return "wayback";
  if (laneClass.startsWith("relay:")) return laneClass;
  return `unknown:${laneClass}`;
}

export function auditLaneIndependence(
  successfulLanes: Array<{
    laneId: string;
    laneClass: string;
    sourceUrl?: string;
  }>,
): LaneIndependenceReport {
  const groups = new Map<
    string,
    { providerId: string; laneIds: string[]; witnessWeight: number }
  >();
  for (const lane of successfulLanes) {
    const pid = laneProviderId(lane.laneClass, lane.laneId, lane.sourceUrl);
    const g = groups.get(pid) ?? { providerId: pid, laneIds: [], witnessWeight: 1 };
    g.laneIds.push(lane.laneId);
    groups.set(pid, g);
  }
  const providerGroups: LaneIndependenceReport["providerGroups"] = [];
  for (const g of groups.values()) {
    g.witnessWeight = 1 / Math.max(1, g.laneIds.length);
    providerGroups.push({ ...g });
  }
  return {
    distinctProviders: groups.size,
    effectiveWitnessCount: groups.size,
    providerGroups,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — MARGINAL EVIDENCE GAIN STOP
// ═══════════════════════════════════════════════════════════════════════════

export function decideMarginalGain(
  contributions: number[],
  pagesFetched: number,
  opts?: {
    threshold?: number;
    minPages?: number;
    windowSize?: number;
  },
): { stop: boolean; mean: number; reason: string } {
  const threshold = opts?.threshold ?? 0.05;
  const minPages = opts?.minPages ?? 3;
  const windowSize = Math.max(1, opts?.windowSize ?? 3);
  if (pagesFetched < minPages) {
    return { stop: false, mean: NaN, reason: `below floor (${pagesFetched}/${minPages})` };
  }
  const window = contributions.slice(-windowSize);
  if (window.length === 0) {
    return { stop: false, mean: NaN, reason: "no samples" };
  }
  const mean = window.reduce((s, v) => s + Math.max(0, v), 0) / window.length;
  if (mean < threshold) {
    return { stop: true, mean, reason: `rolling mean ${mean.toFixed(4)} < threshold ${threshold}` };
  }
  return { stop: false, mean, reason: `rolling mean ${mean.toFixed(4)} ≥ threshold ${threshold}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — AUDIT-OBSERVING PORTFOLIO WRAPPER
// Observes portfolio lane execution results AFTER the fact and records
// yield/backoff signals. Does not modify the orchestrator or any engine.
// ═══════════════════════════════════════════════════════════════════════════

export interface AuditedPortfolioResult extends PortfolioGroundingResult {
  laneIndependence: LaneIndependenceReport;
  yieldRecordings: Array<{ url: string; laneClass: string; recorded: "success" | "failure" }>;
  backoffRecordings: Array<{ origin: string; ms: number }>;
}

/**
 * groundWithAuditedPortfolio — runs the canonical portfolio, then observes
 * lane execution results to record yield memory and backoff leases.
 *
 * Observation logic:
 *   - Each fulfilled lane result gets a yieldSuccess recording (its provider
 *     is the top-level portfolio lane, latency = elapsedMs).
 *   - Each rejected/timed-out lane with a 429/503/rate-limit message gets a
 *     backoff persistence (60s default).
 *   - Each rejected/timed-out lane gets a yieldFailure recording.
 *   - Independence audit is computed from lane IDs and classes.
 *
 * The portfolio itself makes all decisions; this wrapper only records.
 */
export async function groundWithAuditedPortfolio(
  question: string,
  options: PortfolioOptions = {},
): Promise<AuditedPortfolioResult> {
  const portfolioResult = await groundWithCanonicalPortfolio(question, options);

  const yieldRecordings: Array<{ url: string; laneClass: string; recorded: "success" | "failure" }> = [];
  const backoffRecordings: Array<{ origin: string; ms: number }> = [];

  // Observe lane executions and record yield/backoff.
  // Portfolio lane IDs map to synthetic laneClass "portfolio:{id}".
  for (const lane of portfolioResult.laneResults) {
    const laneClass = `portfolio:${lane.id}`;
    // Synthetic "url" is the lane ID itself (portfolio lanes aren't URL-scoped;
    // we use the lane ID as a stable key for the yield table).
    const syntheticUrl = `https://portfolio.local/${lane.id}`;

    if (lane.status === "fulfilled") {
      await recordYieldSuccess(syntheticUrl, laneClass, lane.elapsedMs);
      yieldRecordings.push({ url: syntheticUrl, laneClass, recorded: "success" });
    } else {
      await recordYieldFailure(syntheticUrl, laneClass);
      yieldRecordings.push({ url: syntheticUrl, laneClass, recorded: "failure" });

      // Detect rate-limit-shaped errors and record backoff at the origin level.
      // Since portfolio lanes are synthetic, we can only record backoff at
      // portfolio.local — this is honest: the real host-level backoff must
      // be recorded by the individual engines themselves, not the orchestrator.
      if (lane.error && /429|503|rate.?limit|too many requests/i.test(lane.error)) {
        await persistBackoff(syntheticUrl, 60_000, lane.error.slice(0, 80));
        backoffRecordings.push({ origin: originOf(syntheticUrl), ms: 60_000 });
      }
    }
  }

  // Independence audit over the portfolio lane executions.
  // Each portfolio lane is treated as its own provider group (they are
  // architecturally independent engines by construction).
  const successfulLanes = portfolioResult.laneResults
    .filter((l) => l.status === "fulfilled")
    .map((l) => ({
      laneId: l.id,
      laneClass: `portfolio:${l.id}`,
      sourceUrl: `https://portfolio.local/${l.id}`,
    }));

  const laneIndependence = auditLaneIndependence(successfulLanes);

  return {
    ...portfolioResult,
    laneIndependence,
    yieldRecordings,
    backoffRecordings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

export async function runCanonicalPortfolioAugmentDiagnostics(): Promise<{
  ok: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}> {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });

  // 1. Yield memory: record → retrieve
  const testUrl = `https://yield-test-${Date.now()}.example.com/a`;
  await recordYieldSuccess(testUrl, "origin-direct", 450);
  await recordYieldSuccess(testUrl, "origin-direct", 550);
  await recordYieldFailure(testUrl, "origin-direct");
  const ys = await getYieldScore(testUrl, "origin-direct");
  add("yield-record-samples", ys.samples === 3, `samples=${ys.samples}`);
  add("yield-score-in-range", ys.score >= 0 && ys.score <= 1, `score=${ys.score.toFixed(3)}`);
  add("yield-unknown-zero", (await getYieldScore("https://never-seen.example.com/x", "jina")).score === 0, "zero for unseen");

  // 2. Reorder by yield: known-good URL floats
  const reordered = await reorderByYield([testUrl, "https://unknown-987.example.com/z"], "origin-direct");
  add("reorder-two-urls", reordered.length === 2, `n=${reordered.length}`);

  // 3. Persisted backoff: set → check → clear
  const backoffUrl = `https://backoff-test-${Date.now()}.example.com/x`;
  await persistBackoff(backoffUrl, 5_000, "test-429");
  const rem1 = await checkPersistedBackoff(backoffUrl);
  add("backoff-persist", rem1 > 0 && rem1 <= 5_000, `remaining=${rem1}`);
  await clearPersistedBackoff(backoffUrl);
  const rem2 = await checkPersistedBackoff(backoffUrl);
  add("backoff-clear", rem2 === 0, `remaining-after-clear=${rem2}`);
  add("backoff-unseen-zero", (await checkPersistedBackoff("https://no-backoff.example.com/x")) === 0, "zero for unseen");

  // 4. Lane independence audit: two Jina lanes → one witness
  const laneRep = auditLaneIndependence([
    { laneId: "jina-1", laneClass: "hosted-renderer" },
    { laneId: "jina-2", laneClass: "hosted-renderer" },
    { laneId: "direct", laneClass: "origin-direct", sourceUrl: "https://a.example.com/x" },
    { laneId: "wayback", laneClass: "archive" },
  ]);
  const jinaGroup = laneRep.providerGroups.find((g) => g.providerId === "jina");
  add("lane-jina-collapses", jinaGroup?.laneIds.length === 2 && jinaGroup?.witnessWeight === 0.5, `jina.weight=${jinaGroup?.witnessWeight}`);
  add("lane-effective-count-3", laneRep.effectiveWitnessCount === 3, `effective=${laneRep.effectiveWitnessCount}`);

  // 5. Provider ID mapping
  add("provider-jina", laneProviderId("hosted-renderer", "x") === "jina", laneProviderId("hosted-renderer", "x"));
  add("provider-archive", laneProviderId("archive", "wb") === "wayback", laneProviderId("archive", "wb"));
  add("provider-relay", laneProviderId("relay:corsproxy.io", "l1") === "relay:corsproxy.io", laneProviderId("relay:corsproxy.io", "l1"));

  // 6. Marginal gain: high yields continue
  const mg1 = decideMarginalGain([0.4, 0.5, 0.3], 5, { threshold: 0.1 });
  add("marginal-continue-high", !mg1.stop, mg1.reason);

  // 7. Marginal gain: low yields stop after floor
  const mg2 = decideMarginalGain([0.02, 0.01, 0.03], 5, { threshold: 0.1 });
  add("marginal-stop-low", mg2.stop, mg2.reason);

  // 8. Marginal gain: below page floor always continues
  const mg3 = decideMarginalGain([0.001], 1, { threshold: 0.1, minPages: 3 });
  add("marginal-continue-below-floor", !mg3.stop, mg3.reason);

  // 9. hostOf normalization
  add("host-strips-www", hostOf("https://www.Example.COM/x") === "example.com", hostOf("https://www.Example.COM/x"));
  add("origin-of-strips-path", originOf("https://x.example.com/deep/path?q=1") === "https://x.example.com", originOf("https://x.example.com/deep/path?q=1"));

  return { ok: checks.every((c) => c.passed), checks };
}

// Re-export the canonical portfolio's own diagnostics for one-stop testing
export { runCanonicalPortfolioDiagnostics };
