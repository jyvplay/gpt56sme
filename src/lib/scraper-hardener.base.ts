/**
 * scraper-hardener.base.ts — Resilient CORS Proxy Fleet with Circuit Breaker
 * ============================================================================
 * REPLACES package implementation to fix runtime errors like:
 *   jina_401, corsproxy.io_circuit_open, allorigins-raw_circuit_open,
 *   cors.x2u.in_circuit_open, codetabs signal aborted, etc.
 *
 * Improvements:
 * 1. Circuit breaker per proxy: tracks failures, temporarily disables failing proxies
 * 2. Prioritized fleet: most reliable first (direct fetch prioritized)
 * 3. Exponential backoff for retries
 * 4. Reduced timeouts for faster failover
 * 5. Better error classification (distinguish 401, 429, timeout, etc.)
 * 6. Adaptive wave size based on failure rate
 * 7. Local cache for recently fetched URLs (avoid duplicate fetches)
 * ============================================================================ */

export interface ProxyDef {
  name: string;
  build: (url: string) => string;
  unwrap?: (body: string) => string;
  reliability: number; // 0-1, higher = more reliable
}

// Enhanced fleet with reliability scores — ordered by reliability
export const PROXY_FLEET: ProxyDef[] = [
  // Tier 1: Most reliable (direct or well-maintained)
  { name: "direct", build: (u) => u, reliability: 1.0 }, // direct fetch, not a proxy but handled specially
  { name: "corsproxy.io", build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`, reliability: 0.85 },
  { name: "allorigins-raw", build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, reliability: 0.8 },
  // Tier 2: Generally reliable but occasional failures
  { name: "codetabs", build: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`, reliability: 0.7 },
  { name: "corsproxy.org", build: (u) => `https://corsproxy.org/?${encodeURIComponent(u)}`, reliability: 0.65 },
  { name: "thingproxy", build: (u) => `https://thingproxy.freeboard.io/fetch/${u}`, reliability: 0.6 },
  // Tier 3: Fallbacks, higher failure rate
  { name: "cors.eu.org", build: (u) => `https://cors.eu.org/${u}`, reliability: 0.5 },
  { name: "proxy.cors.sh", build: (u) => `https://proxy.cors.sh/${u}`, reliability: 0.45 },
  { name: "yacdn", build: (u) => `https://yacdn.org/proxy/${u}`, reliability: 0.4 },
  { name: "whateverorigin", build: (u) => `https://whateverorigin.org/get?url=${encodeURIComponent(u)}`, unwrap: jsonContents, reliability: 0.35 },
  { name: "allorigins-get", build: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, unwrap: jsonContents, reliability: 0.35 },
  { name: "jsonp.afeld", build: (u) => `https://jsonp.afeld.me/?url=${encodeURIComponent(u)}`, reliability: 0.3 },
  { name: "cors-anywhere-hf", build: (u) => `https://cors-anywhere.herokuapp.com/${u}`, reliability: 0.25 },
];

function jsonContents(body: string): string {
  try {
    const data = JSON.parse(body);
    return typeof data?.contents === "string" ? data.contents : body;
  } catch {
    return body;
  }
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── Circuit Breaker ────────────────────────────────────────────────────
interface CircuitState {
  failures: number;
  lastFailure: number;
  openUntil: number;
  consecutiveSuccesses: number;
}

const CIRCUIT_BREAKER = new Map<string, CircuitState>();
const FAILURE_THRESHOLD = 3; // open circuit after 3 failures
const RESET_TIMEOUT = 60_000; // try again after 60s

function getCircuit(name: string): CircuitState {
  if (!CIRCUIT_BREAKER.has(name)) {
    CIRCUIT_BREAKER.set(name, { failures: 0, lastFailure: 0, openUntil: 0, consecutiveSuccesses: 0 });
  }
  return CIRCUIT_BREAKER.get(name)!;
}

function isCircuitOpen(name: string): boolean {
  const state = getCircuit(name);
  if (state.openUntil === 0) return false;
  if (Date.now() > state.openUntil) {
    // Half-open: allow one try
    state.openUntil = 0;
    return false;
  }
  return true;
}

function recordSuccess(name: string): void {
  const state = getCircuit(name);
  state.failures = 0;
  state.consecutiveSuccesses += 1;
  state.openUntil = 0;
  // Gradually increase reliability after successes
  if (state.consecutiveSuccesses > 5) {
    state.failures = Math.max(0, state.failures - 1);
  }
}

function recordFailure(name: string, errorType: "timeout" | "4xx" | "5xx" | "network" | "parse"): void {
  const state = getCircuit(name);
  state.failures += 1;
  state.lastFailure = Date.now();
  state.consecutiveSuccesses = 0;

  // Different error types have different penalties
  const penalty = errorType === "4xx" ? 2 : errorType === "timeout" ? 1 : 1.5;
  const weightedFailures = state.failures * penalty;

  if (weightedFailures >= FAILURE_THRESHOLD) {
    // Exponential backoff: longer open time for more failures
    const backoffMs = Math.min(RESET_TIMEOUT * Math.pow(2, state.failures - FAILURE_THRESHOLD), 300_000);
    state.openUntil = Date.now() + backoffMs;
  }
}

// ── Cache for recent fetches ───────────────────────────────────────────
const FETCH_CACHE = new Map<string, { text: string; timestamp: number; source: string }>();
const CACHE_TTL = 5 * 60_000; // 5 minutes

function getCached(url: string): { text: string; source: string } | null {
  const entry = FETCH_CACHE.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    FETCH_CACHE.delete(url);
    return null;
  }
  return { text: entry.text, source: entry.source };
}

function setCached(url: string, text: string, source: string): void {
  // LRU: keep max 100 entries
  if (FETCH_CACHE.size > 100) {
    const oldest = Array.from(FETCH_CACHE.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) FETCH_CACHE.delete(oldest[0]);
  }
  FETCH_CACHE.set(url, { text, timestamp: Date.now(), source });
}

async function timedFetch(url: string, signal: AbortSignal | undefined, headers: Record<string, string>, timeoutMs = 6_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { signal: ctrl.signal, headers, redirect: "follow" });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function looksUsable(text: string): boolean {
  if (!text) return false;
  if (text.length < 80) return false;
  if (/^\s*(error|forbidden|too many requests|rate limit|unauthorized|not found)/i.test(text) && text.length < 400) return false;
  // Reject common proxy error pages
  if (/<title>\s*(error|forbidden|429|401|404)/i.test(text) && text.length < 1000) return false;
  return true;
}

export interface RobustFetchResult {
  text: string;
  source: "direct" | "proxy" | "cache";
  proxy?: string;
}

async function tryProxy(proxy: ProxyDef, url: string, signal?: AbortSignal): Promise<RobustFetchResult> {
  if (proxy.name === "direct") {
    // Direct fetch special case
    const res = await timedFetch(url, signal, BROWSER_HEADERS, 8_000);
    if (!res.ok) {
      if (res.status === 401) throw new Error(`${proxy.name}:401`);
      if (res.status === 429) throw new Error(`${proxy.name}:429`);
      throw new Error(`${proxy.name}:${res.status}`);
    }
    const text = await res.text();
    if (!looksUsable(text)) throw new Error(`${proxy.name}:thin`);
    return { text, source: "direct" };
  }

  if (isCircuitOpen(proxy.name)) {
    throw new Error(`${proxy.name}:circuit_open`);
  }

  try {
    const res = await timedFetch(proxy.build(url), signal, BROWSER_HEADERS, 6_000);
    if (!res.ok) {
      const errType = res.status >= 500 ? "5xx" : res.status >= 400 ? "4xx" : "network";
      recordFailure(proxy.name, errType as any);
      if (res.status === 401) throw new Error(`${proxy.name}:401`);
      if (res.status === 429) throw new Error(`${proxy.name}:429`);
      throw new Error(`${proxy.name}:${res.status}`);
    }
    const raw = await res.text();
    const body = proxy.unwrap ? proxy.unwrap(raw) : raw;
    if (!looksUsable(body)) {
      recordFailure(proxy.name, "parse");
      throw new Error(`${proxy.name}:thin`);
    }
    recordSuccess(proxy.name);
    return { text: body, source: "proxy", proxy: proxy.name };
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (!msg.includes("circuit_open") && !msg.includes("401") && !msg.includes("429")) {
      const errType = msg.includes("aborted") || msg.includes("timeout") ? "timeout" : "network";
      recordFailure(proxy.name, errType as any);
    }
    throw e;
  }
}

function firstSuccess<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let remaining = promises.length;
    const errors: any[] = [];
    if (remaining === 0) reject(new Error("no candidates"));
    promises.forEach(p => p.then(resolve, (e) => {
      errors.push(e);
      if (--remaining === 0) reject(new Error(errors.map(x => x?.message ?? x).join(", ")));
    }));
  });
}

export async function fetchRobust(url: string, signal?: AbortSignal, preferProxy?: string): Promise<RobustFetchResult> {
  // Check cache first
  const cached = getCached(url);
  if (cached) {
    return { text: cached.text, source: "cache" as any, proxy: cached.source };
  }

  const errors: string[] = [];

  // 0. Pinned proxy first if specified and not circuit-open
  if (preferProxy) {
    const pinned = PROXY_FLEET.find(p => p.name === preferProxy);
    if (pinned && !isCircuitOpen(pinned.name)) {
      try {
        const result = await tryProxy(pinned, url, signal);
        setCached(url, result.text, result.proxy || result.source);
        return result;
      } catch (e: any) {
        errors.push(e?.message ?? "pinned-failed");
      }
    }
  }

  // 1. Direct fetch first (most reliable for CORS-enabled origins)
  try {
    const directProxy = PROXY_FLEET[0]; // "direct" is first
    const result = await tryProxy(directProxy, url, signal);
    setCached(url, result.text, "direct");
    return result;
  } catch (e: any) {
    errors.push(e?.message ?? "direct-failed");
  }

  // 2. Race the proxy fleet in adaptive waves
  // Sort by reliability, filter out circuit-open proxies
  const availableProxies = PROXY_FLEET.slice(1)
    .filter(p => !isCircuitOpen(p.name))
    .sort((a, b) => b.reliability - a.reliability);

  if (availableProxies.length === 0) {
    throw new Error(`CORS_BLOCKED: all proxies circuit-open for ${url} [${errors.join("; ").slice(0, 300)}]`);
  }

  // Adaptive wave size: larger waves when many proxies available, smaller when few
  const WAVE = availableProxies.length > 6 ? 3 : 2;
  
  for (let i = 0; i < availableProxies.length; i += WAVE) {
    if (signal?.aborted) break;
    const wave = availableProxies.slice(i, i + WAVE);
    try {
      const result = await firstSuccess(wave.map(p => tryProxy(p, url, signal)));
      setCached(url, result.text, result.proxy || result.source);
      return result;
    } catch (e: any) {
      errors.push(e?.message ?? "wave-failed");
    }
  }

  throw new Error(`CORS_BLOCKED: all paths failed for ${url} [${errors.join("; ").slice(0, 300)}]`);
}

export function extractTextFromHtml(html: string): string {
  let text = html.replace(/<(script|style|nav|footer|header|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
  return text.replace(/\s+/g, " ").trim().slice(0, 12_000);
}

// ── Diagnostic helpers ──────────────────────────────────────────────────
export function getCircuitBreakerStatus(): Array<{ proxy: string; failures: number; open: boolean; openUntil: number }> {
  return Array.from(CIRCUIT_BREAKER.entries()).map(([name, state]) => ({
    proxy: name,
    failures: state.failures,
    open: isCircuitOpen(name),
    openUntil: state.openUntil,
  }));
}

export function resetCircuitBreaker(proxyName?: string): void {
  if (proxyName) {
    CIRCUIT_BREAKER.delete(proxyName);
  } else {
    CIRCUIT_BREAKER.clear();
  }
}
