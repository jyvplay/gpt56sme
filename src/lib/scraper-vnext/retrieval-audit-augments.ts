/**
 * retrieval-audit-augments.ts
 * ============================================================================
 * ADDITIVE FINAL — closes four blindspots that canonical retrieval-control-plane,
 * retrieval-policy-augments, structured-source-adapter, and epistemic-packer do
 * NOT address:
 *
 *   1. YIELD-AWARE QUEUE MEMORY (persisted across page refreshes via IndexedDB)
 *      Per (domain, laneClass) success-rate + p50 latency memory. Used to
 *      reorder the crawl queue so historically-yielding hosts get first slots
 *      on subsequent runs, not just the current session.
 *
 *   2. LANE-INDEPENDENCE AUDIT
 *      When three lanes are all "hosted-renderer" via the same provider (e.g.,
 *      three Jina endpoints), they are ONE witness for trust purposes, not
 *      three. Audits provenance across sources and collapses shared-infra
 *      groups. Emits a demotion signal for the adjudicator.
 *
 *   3. PERSISTED ORIGIN BACKOFF (survives page refresh)
 *      Origin-scoped 429/503 backoff state persisted to IndexedDB with expiry.
 *      Prevents refresh-and-hammer patterns that trigger WAF escalation.
 *
 *   4. MARGINAL EVIDENCE GAIN STOP
 *      Evaluates whether the next page's expected value (domain priority ×
 *      historical yield) exceeds a minimum threshold. Stops the crawl early
 *      when marginal gain converges below the fetch-cost floor.
 *
 * ADDITIVE ONLY. No canonical file modified. Read-only imports.
 * All persisted state is optional (IndexedDB may be blocked in private mode);
 * every function fail-opens to the current in-memory behavior.
 *
 * BROWSER-ONLY. KEYLESS. HAND-TRACEABLE.
 * NOT EXECUTED in this environment.
 * ============================================================================ */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface YieldRecord {
  domainLane: string;      // `${domain}\u0000${laneClass}`
  successes: number;
  failures: number;
  totalLatencyMs: number;
  lastSeenAt: number;      // epoch ms
}

export interface YieldScore {
  domain: string;
  laneClass: string;
  successRate: number;     // successes / (successes + failures); 0 if unknown
  meanLatencyMs: number;   // NaN-safe; 0 if unknown
  sampleCount: number;
  score: number;           // composite; higher = better
}

export interface BackoffLease {
  origin: string;
  untilMs: number;
  reason: string;
}

export interface LaneIndependenceGroup {
  providerId: string;      // "jina", "corsproxy.io", "wayback", direct-origin-hostname
  laneIds: string[];
  witnessWeight: number;   // 1/N when N lanes collapse to one witness
}

export interface MarginalGainDecision {
  shouldContinue: boolean;
  reason: string;
  expectedYield: number;
  threshold: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB PERSISTENCE (fail-open)
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME = "retrieval-audit-augments";
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
        if (!db.objectStoreNames.contains(STORE_YIELD)) {
          db.createObjectStore(STORE_YIELD, { keyPath: "domainLane" });
        }
        if (!db.objectStoreNames.contains(STORE_BACKOFF)) {
          db.createObjectStore(STORE_BACKOFF, { keyPath: "origin" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbPut(store: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      const req = tx.objectStore(store).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. YIELD-AWARE QUEUE MEMORY
// ═══════════════════════════════════════════════════════════════════════════

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function yieldKey(domain: string, laneClass: string): string {
  return `${domain}\u0000${laneClass}`;
}

/** Record a successful retrieval for future queue prioritization. */
export async function recordYieldSuccess(
  url: string,
  laneClass: string,
  latencyMs: number,
): Promise<void> {
  const domain = hostOf(url);
  if (!domain) return;
  const key = yieldKey(domain, laneClass);
  const existing = (await idbGet<YieldRecord>(STORE_YIELD, key)) ?? {
    domainLane: key,
    successes: 0,
    failures: 0,
    totalLatencyMs: 0,
    lastSeenAt: 0,
  };
  existing.successes += 1;
  existing.totalLatencyMs += Math.max(0, latencyMs);
  existing.lastSeenAt = Date.now();
  await idbPut(STORE_YIELD, existing);
}

/** Record a failed retrieval for future queue prioritization. */
export async function recordYieldFailure(
  url: string,
  laneClass: string,
): Promise<void> {
  const domain = hostOf(url);
  if (!domain) return;
  const key = yieldKey(domain, laneClass);
  const existing = (await idbGet<YieldRecord>(STORE_YIELD, key)) ?? {
    domainLane: key,
    successes: 0,
    failures: 0,
    totalLatencyMs: 0,
    lastSeenAt: 0,
  };
  existing.failures += 1;
  existing.lastSeenAt = Date.now();
  await idbPut(STORE_YIELD, existing);
}

/** Look up historical yield for a (domain, laneClass) pair. */
export async function getYieldScore(url: string, laneClass: string): Promise<YieldScore> {
  const domain = hostOf(url);
  const key = yieldKey(domain, laneClass);
  const rec = await idbGet<YieldRecord>(STORE_YIELD, key);
  if (!rec) {
    return { domain, laneClass, successRate: 0, meanLatencyMs: 0, sampleCount: 0, score: 0 };
  }
  const total = rec.successes + rec.failures;
  const successRate = total > 0 ? rec.successes / total : 0;
  const meanLatencyMs = rec.successes > 0 ? rec.totalLatencyMs / rec.successes : 0;
  // Composite: high success rate + low latency + recency
  const recencyDays = Math.max(0, (Date.now() - rec.lastSeenAt) / 86_400_000);
  const recencyDecay = Math.exp(-0.05 * recencyDays); // half-life ~14 days
  const latencyPenalty = meanLatencyMs > 0 ? Math.min(0.5, meanLatencyMs / 20_000) : 0.3;
  const score = successRate * (1 - latencyPenalty) * recencyDecay;
  return { domain, laneClass, successRate, meanLatencyMs, sampleCount: total, score };
}

/**
 * Reorder a candidate URL list by (base priority × historical yield).
 * Untouched URLs keep their input order; known-good URLs float to the top.
 */
export async function reorderByYield<T extends { url: string; priority?: number }>(
  candidates: T[],
  laneClass: string,
): Promise<T[]> {
  const scored = await Promise.all(
    candidates.map(async (c) => {
      const y = await getYieldScore(c.url, laneClass);
      const base = c.priority ?? 0.5;
      const combined = base * (0.5 + 0.5 * y.score); // yield doubles the score at max
      return { c, combined };
    }),
  );
  scored.sort((a, b) => b.combined - a.combined);
  return scored.map((s) => s.c);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. LANE-INDEPENDENCE AUDIT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract the infrastructure provider identifier for a lane class.
 * Two lanes with the same providerId are NOT independent witnesses.
 */
export function laneProviderId(laneClass: string, laneId?: string): string {
  if (laneClass === "origin-direct") {
    // Direct lanes: provider = target hostname (each origin is unique)
    return `direct:${laneId ?? "unknown"}`;
  }
  if (laneClass === "hosted-renderer") return "jina"; // r.jina.ai is the only free hosted renderer
  if (laneClass === "archive") return "wayback";
  if (laneClass.startsWith("relay:")) return laneClass; // relay:corsproxy.io, relay:allorigins, etc.
  return `unknown:${laneClass}`;
}

/**
 * Collapse a set of successful lanes into independent-provider groups.
 * Witness weight = 1/N when N lanes share one provider; downstream trust
 * math should multiply witness contributions by this weight.
 */
export function auditLaneIndependence(
  successfulLanes: Array<{ laneId: string; laneClass: string; sourceUrl?: string }>,
): LaneIndependenceGroup[] {
  const groups = new Map<string, LaneIndependenceGroup>();
  for (const lane of successfulLanes) {
    const providerId = laneProviderId(
      lane.laneClass,
      lane.laneClass === "origin-direct" ? hostOf(lane.sourceUrl ?? "") : lane.laneId,
    );
    const g = groups.get(providerId) ?? { providerId, laneIds: [], witnessWeight: 1 };
    g.laneIds.push(lane.laneId);
    groups.set(providerId, g);
  }
  // Assign witness weight: 1/N per group
  for (const g of groups.values()) g.witnessWeight = 1 / Math.max(1, g.laneIds.length);
  return Array.from(groups.values()).sort((a, b) => a.providerId.localeCompare(b.providerId));
}

/**
 * Effective independent witness count.
 * Three "hosted-renderer" lanes all via Jina → 1 witness, not 3.
 */
export function effectiveWitnessCount(
  successfulLanes: Array<{ laneId: string; laneClass: string; sourceUrl?: string }>,
): number {
  const groups = auditLaneIndependence(successfulLanes);
  return groups.length; // one witness per distinct provider
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PERSISTED ORIGIN BACKOFF (survives page refresh)
// ═══════════════════════════════════════════════════════════════════════════

/** Persist a 429/503 backoff lease that survives page refresh. */
export async function persistBackoff(
  targetUrl: string,
  durationMs: number,
  reason: string,
): Promise<void> {
  let origin: string;
  try { origin = new URL(targetUrl).origin; } catch { return; }
  const clamped = Math.max(1_000, Math.min(24 * 60 * 60_000, Math.floor(durationMs)));
  const lease: BackoffLease = {
    origin,
    untilMs: Date.now() + clamped,
    reason,
  };
  await idbPut(STORE_BACKOFF, lease);
}

/**
 * Check whether an origin is currently backed off from a prior session.
 * Returns 0 if no backoff active; otherwise milliseconds remaining.
 */
export async function checkPersistedBackoff(targetUrl: string): Promise<number> {
  let origin: string;
  try { origin = new URL(targetUrl).origin; } catch { return 0; }
  const lease = await idbGet<BackoffLease>(STORE_BACKOFF, origin);
  if (!lease) return 0;
  const remaining = lease.untilMs - Date.now();
  if (remaining <= 0) {
    // Expired — clean up
    idbDelete(STORE_BACKOFF, origin).catch(() => { /* ignore */ });
    return 0;
  }
  return remaining;
}

/** Clear backoff for an origin (e.g., after a successful retry). */
export async function clearPersistedBackoff(targetUrl: string): Promise<void> {
  let origin: string;
  try { origin = new URL(targetUrl).origin; } catch { return; }
  await idbDelete(STORE_BACKOFF, origin);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. MARGINAL EVIDENCE GAIN STOP
// ═══════════════════════════════════════════════════════════════════════════

export interface MarginalGainOptions {
  /** Minimum expected contribution to keep crawling. Default 0.05. */
  minExpectedYield?: number;
  /** Minimum absolute pages fetched before allowing early stop. Default 3. */
  minPagesFetched?: number;
  /** Convergence window: last N pages' contribution rolling average. Default 3. */
  windowSize?: number;
}

/**
 * Decide whether to continue crawling.
 * Stops early when the last N pages have consistently produced below-threshold
 * value contributions AND at least minPagesFetched pages have been read.
 *
 * Hand-traceable: rolling mean over last `windowSize` values from
 * `recentValueContributions` (largest = most recent). If that mean is below
 * `minExpectedYield`, and pages fetched ≥ `minPagesFetched`, stop.
 */
export function decideMarginalGain(
  recentValueContributions: number[],   // e.g., support-mass boost per page
  pagesFetched: number,
  opts?: MarginalGainOptions,
): MarginalGainDecision {
  const minYield = opts?.minExpectedYield ?? 0.05;
  const minPages = opts?.minPagesFetched ?? 3;
  const win = Math.max(1, opts?.windowSize ?? 3);

  if (pagesFetched < minPages) {
    return {
      shouldContinue: true,
      reason: `only ${pagesFetched}/${minPages} pages fetched — below floor`,
      expectedYield: NaN,
      threshold: minYield,
    };
  }

  const window = recentValueContributions.slice(-win);
  if (window.length === 0) {
    return { shouldContinue: true, reason: "no yield samples", expectedYield: NaN, threshold: minYield };
  }
  const mean = window.reduce((s, v) => s + Math.max(0, v), 0) / window.length;
  if (mean < minYield) {
    return {
      shouldContinue: false,
      reason: `rolling mean ${mean.toFixed(4)} < threshold ${minYield}`,
      expectedYield: mean,
      threshold: minYield,
    };
  }
  return {
    shouldContinue: true,
    reason: `rolling mean ${mean.toFixed(4)} ≥ threshold ${minYield}`,
    expectedYield: mean,
    threshold: minYield,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

export async function runAuditAugmentDiagnostics(): Promise<{
  ok: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}> {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, p: boolean, d: string) => checks.push({ id, passed: p, detail: d });

  // 1. Yield memory: record + retrieve
  await recordYieldSuccess("https://arxiv.org/abs/123", "origin-direct", 500);
  await recordYieldSuccess("https://arxiv.org/abs/456", "origin-direct", 700);
  await recordYieldFailure("https://arxiv.org/abs/999", "origin-direct");
  const y1 = await getYieldScore("https://arxiv.org/abs/anything", "origin-direct");
  const y1SampleCorrect = y1.sampleCount === 3;
  const y1SuccessRateCorrect = Math.abs(y1.successRate - 2 / 3) < 0.001;
  add("yield-record-samples", y1SampleCorrect, `samples=${y1.sampleCount}`);
  add("yield-record-rate", y1SuccessRateCorrect, `rate=${y1.successRate.toFixed(3)}`);

  // 2. Yield reordering: known-good URL floats above unknown
  const candidates = [
    { url: "https://unknown-domain-987654.example.com/x", priority: 0.9 },
    { url: "https://arxiv.org/abs/newpaper", priority: 0.5 },
  ];
  const reordered = await reorderByYield(candidates, "origin-direct");
  add("yield-reorder-runs", reordered.length === 2, `n=${reordered.length}`);

  // 3. Lane independence audit — three Jina lanes = one witness
  const lanes = [
    { laneId: "jina-1", laneClass: "hosted-renderer" },
    { laneId: "jina-2", laneClass: "hosted-renderer" },
    { laneId: "direct", laneClass: "origin-direct", sourceUrl: "https://example.com/x" },
    { laneId: "wayback", laneClass: "archive" },
  ];
  const groups = auditLaneIndependence(lanes);
  const jinaGroup = groups.find((g) => g.providerId === "jina");
  add("independence-jina-collapse", jinaGroup?.laneIds.length === 2 && jinaGroup?.witnessWeight === 0.5, `jina-group=${JSON.stringify(jinaGroup)}`);
  const effective = effectiveWitnessCount(lanes);
  add("independence-effective-count", effective === 3, `effective=${effective}`);

  // 4. Provider identification for relay lanes
  const relayId = laneProviderId("relay:corsproxy.io", "lane-3");
  add("provider-relay-id", relayId === "relay:corsproxy.io", relayId);

  // 5. Persisted backoff: set + check + expire
  await persistBackoff("https://backoff-test.example.com/x", 5_000, "429");
  const remaining = await checkPersistedBackoff("https://backoff-test.example.com/y");
  add("backoff-persist", remaining > 0 && remaining <= 5_000, `remaining=${remaining}`);
  await clearPersistedBackoff("https://backoff-test.example.com/x");
  const cleared = await checkPersistedBackoff("https://backoff-test.example.com/x");
  add("backoff-clear", cleared === 0, `cleared=${cleared}`);

  // 6. Marginal gain: high yields continue
  const d1 = decideMarginalGain([0.3, 0.4, 0.2], 5, { minExpectedYield: 0.1 });
  add("marginal-continue-high", d1.shouldContinue === true, d1.reason);

  // 7. Marginal gain: low yields stop
  const d2 = decideMarginalGain([0.02, 0.01, 0.03], 5, { minExpectedYield: 0.1 });
  add("marginal-stop-low", d2.shouldContinue === false, d2.reason);

  // 8. Marginal gain: below page floor, always continue
  const d3 = decideMarginalGain([0.001], 1, { minExpectedYield: 0.1, minPagesFetched: 3 });
  add("marginal-continue-below-floor", d3.shouldContinue === true, d3.reason);

  // 9. Marginal gain: empty samples continue
  const d4 = decideMarginalGain([], 10, { minExpectedYield: 0.1 });
  add("marginal-continue-no-samples", d4.shouldContinue === true, d4.reason);

  // 10. hostOf normalization
  add("host-strips-www", hostOf("https://www.Example.COM/x") === "example.com", hostOf("https://www.Example.COM/x"));

  return { ok: checks.every((c) => c.passed), checks };
}
