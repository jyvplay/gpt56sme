/**
 * retrieval-accelerator.ts
 * ============================================================================
 * SUBSTRATE ACCELERATOR — the retrieval-capacity layer the trust stack lacks.
 *
 * ADDITIVE. Zero imports from the stack. Zero file modifications. Browser-only,
 * keyless, static-build compatible. Composes UNDER any existing fetcher: wrap
 * a `() => Promise<T>` task in `schedule(url, task)` and it is governed by
 * global + per-host concurrency, token-bucket pacing, AIMD adaptive parallelism,
 * exponential backoff, and per-host circuit breaking.
 * ============================================================================ */

export type Outcome = "ok" | "congestion" | "error" | "abort";

export interface SchedulerOptions {
  globalConcurrency?: number;
  hostConcurrencyStart?: number;
  hostConcurrencyMin?: number;
  hostConcurrencyMax?: number;
  hostRefillPerSec?: number;
  hostBurst?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  circuitThreshold?: number;
  circuitCooldownMs?: number;
  increaseEvery?: number;
  jitterFraction?: number;
}

export interface ScheduleContext {
  attempt: number;
  host: string;
  hostLimit: number;
  signal?: AbortSignal;
}

export interface BatchResult<T> {
  url: string;
  ok: boolean;
  value?: T;
  error?: string;
  outcome: Outcome;
  elapsedMs: number;
}

export interface SchedulerStats {
  hosts: Array<{
    host: string;
    limit: number;
    inUse: number;
    backoffMs: number;
    circuitOpen: boolean;
    ok: number;
    congestion: number;
    error: number;
  }>;
  globalLimit: number;
  globalInUse: number;
}

export class CongestionSignal extends Error {
  retryAfterMs?: number;
  constructor(message = "congestion", retryAfterMs?: number) {
    super(message);
    this.name = "CongestionSignal";
    this.retryAfterMs = retryAfterMs;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function abortError(): Error {
  const e = new Error("ABORTED");
  e.name = "AbortError";
  return e;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.message === "ABORTED");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "invalid-host";
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function classifyError(e: unknown): { outcome: Outcome; retryAfterMs?: number } {
  if (isAbort(e)) return { outcome: "abort" };
  if (e instanceof CongestionSignal) return { outcome: "congestion", retryAfterMs: e.retryAfterMs };
  const msg = e instanceof Error ? e.message : String(e);
  if (/\b(429|503|502|504)\b/.test(msg)) return { outcome: "congestion" };
  if (/rate.?limit|too many requests|timeout|timed out|ceiling/i.test(msg)) {
    return { outcome: "congestion" };
  }
  return { outcome: "error" };
}

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC LIMITER
// ═══════════════════════════════════════════════════════════════════════════

class DynamicLimiter {
  private inUse = 0;
  private limit: number;
  private waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get currentLimit(): number {
    return this.limit;
  }
  get active(): number {
    return this.inUse;
  }

  setLimit(n: number): void {
    this.limit = Math.max(1, Math.floor(n));
    this.pump();
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.inUse < this.limit) {
      this.inUse += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const w = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const idx = this.waiters.indexOf(w);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(abortError());
      };
      if (signal?.aborted) return reject(abortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(w);
    });
  }

  release(): void {
    this.inUse = Math.max(0, this.inUse - 1);
    this.pump();
  }

  private pump(): void {
    while (this.inUse < this.limit && this.waiters.length > 0) {
      this.inUse += 1;
      const w = this.waiters.shift()!;
      w();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN BUCKET
// ═══════════════════════════════════════════════════════════════════════════

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
      this.lastRefill = now;
    }
  }

  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  msUntilNext(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.refillPerSec) * 1000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HOST GOVERNOR
// ═══════════════════════════════════════════════════════════════════════════

interface GovernorConfig {
  min: number;
  max: number;
  start: number;
  refillPerSec: number;
  burst: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  circuitThreshold: number;
  circuitCooldownMs: number;
  increaseEvery: number;
  jitterFraction: number;
}

class HostGovernor {
  private limiter: DynamicLimiter;
  private bucket: TokenBucket;
  private backoffMs = 0;
  private nextAllowedAt = 0;
  private circuitOpenUntil = 0;
  private successStreak = 0;
  private hardFailStreak = 0;

  okCount = 0;
  congestionCount = 0;
  errorCount = 0;

  constructor(
    readonly host: string,
    private cfg: GovernorConfig,
  ) {
    this.limiter = new DynamicLimiter(cfg.start);
    this.bucket = new TokenBucket(cfg.burst, cfg.refillPerSec);
  }

  private jitter(ms: number): number {
    if (ms <= 0) return 0;
    const f = this.cfg.jitterFraction;
    const delta = (Math.random() * 2 - 1) * f;
    return Math.max(0, Math.round(ms * (1 + delta)));
  }

  async pace(signal?: AbortSignal): Promise<void> {
    for (let guard = 0; guard < 64; guard++) {
      if (signal?.aborted) throw abortError();
      const now = Date.now();

      if (this.circuitOpenUntil > now) {
        await delay(this.circuitOpenUntil - now, signal);
        continue;
      }
      if (this.nextAllowedAt > now) {
        await delay(this.jitter(this.nextAllowedAt - now), signal);
        continue;
      }
      if (!this.bucket.tryTake()) {
        await delay(this.jitter(this.bucket.msUntilNext()), signal);
        continue;
      }
      return;
    }
  }

  async enter(signal?: AbortSignal): Promise<() => void> {
    await this.limiter.acquire(signal);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.limiter.release();
    };
  }

  get limit(): number {
    return this.limiter.currentLimit;
  }
  get inUse(): number {
    return this.limiter.active;
  }
  get currentBackoffMs(): number {
    return this.backoffMs;
  }
  get circuitOpen(): boolean {
    return this.circuitOpenUntil > Date.now();
  }

  record(outcome: Outcome, retryAfterMs?: number): void {
    const now = Date.now();
    if (outcome === "ok") {
      this.okCount += 1;
      this.hardFailStreak = 0;
      this.successStreak += 1;
      this.backoffMs = Math.floor(this.backoffMs / 2);
      if (this.backoffMs < this.cfg.backoffBaseMs) this.backoffMs = 0;
      this.circuitOpenUntil = 0;
      if (this.successStreak >= this.cfg.increaseEvery) {
        this.successStreak = 0;
        this.limiter.setLimit(clamp(this.limit + 1, this.cfg.min, this.cfg.max));
      }
    } else if (outcome === "congestion") {
      this.congestionCount += 1;
      this.successStreak = 0;
      this.hardFailStreak = 0;
      this.limiter.setLimit(clamp(Math.floor(this.limit / 2), this.cfg.min, this.cfg.max));
      const base = this.backoffMs > 0 ? this.backoffMs * 2 : this.cfg.backoffBaseMs;
      this.backoffMs = clamp(Math.max(base, retryAfterMs ?? 0), this.cfg.backoffBaseMs, this.cfg.backoffCapMs);
      this.nextAllowedAt = now + this.backoffMs;
    } else if (outcome === "error") {
      this.errorCount += 1;
      this.successStreak = 0;
      this.hardFailStreak += 1;
      if (this.hardFailStreak >= this.cfg.circuitThreshold) {
        this.circuitOpenUntil = now + this.cfg.circuitCooldownMs;
        this.hardFailStreak = 0;
        this.limiter.setLimit(this.cfg.min);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IN-FLIGHT COALESCER
// ═══════════════════════════════════════════════════════════════════════════

class InFlightCoalescer {
  private inflight = new Map<string, Promise<unknown>>();

  run<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = factory().finally(() => {
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TTL FRESH-SERVE CACHE
// ═══════════════════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  key: string;
  value: T;
  storedAt: number;
  expiresAt: number;
  etag?: string;
}

const TTL_DB = "retrieval-accel-cache";
const TTL_STORE = "entries";
const TTL_VERSION = 1;
let ttlDbPromise: Promise<IDBDatabase | null> | null = null;

function ttlOpen(): Promise<IDBDatabase | null> {
  if (ttlDbPromise) return ttlDbPromise;
  ttlDbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(TTL_DB, TTL_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TTL_STORE)) {
          db.createObjectStore(TTL_STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return ttlDbPromise;
}

async function ttlGet<T>(key: string): Promise<CacheEntry<T> | null> {
  const db = await ttlOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(TTL_STORE, "readonly").objectStore(TTL_STORE).get(key);
      req.onsuccess = () => {
        const e = req.result as CacheEntry<T> | undefined;
        if (!e || e.expiresAt < Date.now()) return resolve(null);
        resolve(e);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function ttlPut<T>(entry: CacheEntry<T>): Promise<void> {
  const db = await ttlOpen();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const req = db.transaction(TTL_STORE, "readwrite").objectStore(TTL_STORE).put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function cachedValue<T>(
  key: string,
  ttlMs: number,
  factory: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  if (ttlMs > 0) {
    const hit = await ttlGet<T>(key);
    if (hit) return { value: hit.value, cached: true };
  }
  const value = await factory();
  if (ttlMs > 0) {
    await ttlPut<T>({ key, value, storedAt: Date.now(), expiresAt: Date.now() + ttlMs }).catch(() => {});
  }
  return { value, cached: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRECONNECT WARMUP
// ═══════════════════════════════════════════════════════════════════════════

const warmedHosts = new Set<string>();

export function warmupHosts(urls: string[], cap = 8): void {
  if (typeof document === "undefined" || !document.head) return;
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    let origin = "";
    try {
      origin = new URL(u).origin;
    } catch {
      continue;
    }
    if (!origin || seen.has(origin) || warmedHosts.has(origin)) continue;
    seen.add(origin);
    hosts.push(origin);
    if (hosts.length >= cap) break;
  }
  for (const origin of hosts) {
    try {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
      warmedHosts.add(origin);
    } catch {
      /* ignore */
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RETRIEVAL SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════

export class RetrievalScheduler {
  private global: DynamicLimiter;
  private governors = new Map<string, HostGovernor>();
  private coalescer = new InFlightCoalescer();
  private govCfg: GovernorConfig;

  constructor(opts?: SchedulerOptions) {
    this.global = new DynamicLimiter(clamp(opts?.globalConcurrency ?? 12, 1, 128));
    this.govCfg = {
      min: clamp(opts?.hostConcurrencyMin ?? 1, 1, 32),
      max: clamp(opts?.hostConcurrencyMax ?? 6, 1, 32),
      start: clamp(opts?.hostConcurrencyStart ?? 2, 1, 32),
      refillPerSec: clamp(opts?.hostRefillPerSec ?? 4, 0.2, 100),
      burst: clamp(opts?.hostBurst ?? 6, 1, 100),
      backoffBaseMs: clamp(opts?.backoffBaseMs ?? 500, 50, 60_000),
      backoffCapMs: clamp(opts?.backoffCapMs ?? 30_000, 500, 300_000),
      circuitThreshold: clamp(opts?.circuitThreshold ?? 4, 1, 50),
      circuitCooldownMs: clamp(opts?.circuitCooldownMs ?? 20_000, 1_000, 600_000),
      increaseEvery: clamp(opts?.increaseEvery ?? 3, 1, 50),
      jitterFraction: clamp(opts?.jitterFraction ?? 0.25, 0, 1),
    };
    this.govCfg.start = clamp(this.govCfg.start, this.govCfg.min, this.govCfg.max);
  }

  private governor(host: string): HostGovernor {
    let g = this.governors.get(host);
    if (!g) {
      g = new HostGovernor(host, this.govCfg);
      this.governors.set(host, g);
    }
    return g;
  }

  async schedule<T>(
    url: string,
    task: (ctx: ScheduleContext) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const host = hostOf(url);
    const gov = this.governor(host);

    await gov.pace(signal);
    await this.global.acquire(signal);
    const releaseHost = await gov.enter(signal).catch((e) => {
      this.global.release();
      throw e;
    });

    try {
      return await task({ attempt: 1, host, hostLimit: gov.limit, signal });
    } catch (e) {
      const { outcome, retryAfterMs } = classifyError(e);
      gov.record(outcome, retryAfterMs);
      throw e;
    } finally {
      releaseHost();
      this.global.release();
    }
  }

  scheduleCoalesced<T>(
    url: string,
    task: (ctx: ScheduleContext) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const key = `${hostOf(url)}\u0000${url}`;
    return this.coalescer.run(key, () => this.schedule(url, task, signal));
  }

  async scrapeMany<T>(
    urls: string[],
    worker: (url: string, ctx: ScheduleContext) => Promise<T>,
    opts?: {
      signal?: AbortSignal;
      cacheTtlMs?: number;
      coalesce?: boolean;
      warmup?: boolean;
      onProgress?: (done: number, total: number, last: BatchResult<T>) => void;
    },
  ): Promise<BatchResult<T>[]> {
    const clean = urls.filter((u) => typeof u === "string" && u.trim().length > 0);
    if (clean.length === 0) return [];

    if (opts?.warmup !== false) warmupHosts(clean);

    const total = clean.length;
    let done = 0;
    const cacheTtl = Math.max(0, opts?.cacheTtlMs ?? 0);

    const runOne = async (url: string): Promise<BatchResult<T>> => {
      const start = nowMs();
      const exec = (): Promise<T> => {
        const call = (ctx: ScheduleContext) => worker(url, ctx);
        const scheduled = () =>
          opts?.coalesce
            ? this.scheduleCoalesced(url, call, opts?.signal)
            : this.schedule(url, call, opts?.signal);
        if (cacheTtl > 0) {
          return cachedValue(`read\u0000${url}`, cacheTtl, scheduled).then((r) => r.value);
        }
        return scheduled();
      };

      try {
        const value = await exec();
        const res: BatchResult<T> = {
          url,
          ok: true,
          value,
          outcome: "ok",
          elapsedMs: Math.round(nowMs() - start),
        };
        done += 1;
        opts?.onProgress?.(done, total, res);
        return res;
      } catch (e) {
        const { outcome } = classifyError(e);
        const res: BatchResult<T> = {
          url,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          outcome,
          elapsedMs: Math.round(nowMs() - start),
        };
        done += 1;
        opts?.onProgress?.(done, total, res);
        return res;
      }
    };

    const settled = await Promise.allSettled(clean.map(runOne));
    return settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : {
            url: clean[i],
            ok: false,
            error: s.reason instanceof Error ? s.reason.message : "rejected",
            outcome: "error" as Outcome,
            elapsedMs: 0,
          },
    );
  }

  stats(): SchedulerStats {
    return {
      globalLimit: this.global.currentLimit,
      globalInUse: this.global.active,
      hosts: Array.from(this.governors.values())
        .map((g) => ({
          host: g.host,
          limit: g.limit,
          inUse: g.inUse,
          backoffMs: g.currentBackoffMs,
          circuitOpen: g.circuitOpen,
          ok: g.okCount,
          congestion: g.congestionCount,
          error: g.errorCount,
        }))
        .sort((a, b) => a.host.localeCompare(b.host)),
    };
  }
}

let _default: RetrievalScheduler | null = null;

export function getDefaultScheduler(opts?: SchedulerOptions): RetrievalScheduler {
  if (!_default) _default = new RetrievalScheduler(opts);
  return _default;
}

export function acceleratedScrapeMany<T>(
  urls: string[],
  worker: (url: string, ctx: ScheduleContext) => Promise<T>,
  opts?: Parameters<RetrievalScheduler["scrapeMany"]>[2] & SchedulerOptions,
): Promise<BatchResult<T>[]> {
  return getDefaultScheduler(opts).scrapeMany(urls, worker, opts);
}

export async function runAcceleratorDiagnostics(): Promise<{
  ok: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}> {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) =>
    checks.push({ id, passed, detail });

  try {
    const lim = new DynamicLimiter(2);
    let active = 0;
    let peak = 0;
    const task = async () => {
      await lim.acquire();
      active += 1;
      peak = Math.max(peak, active);
      await delay(5);
      active -= 1;
      lim.release();
    };
    await Promise.all(Array.from({ length: 8 }, task));
    add("limiter-bounds-concurrency", peak <= 2, `peak=${peak}`);
  } catch (e) {
    add("limiter-bounds-concurrency", false, e instanceof Error ? e.message : String(e));
  }

  return { ok: checks.every((c) => c.passed), checks };
}
