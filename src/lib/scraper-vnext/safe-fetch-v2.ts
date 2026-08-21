/**
 * safe-fetch-v2.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Bounded, validated, local-first browser fetch routing.
 * Order: MicroCache → direct → Jina Reader → adaptive-ordered public proxy waves.
 */
import { PROXY_FLEET, type ProxyDef } from "@/lib/scraper-hardener";

export type BrowserFetchSource = "direct" | "jina-reader" | "proxy";

export interface BrowserFetchOptions {
  signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; allowJinaReader?: boolean; allowPublicProxies?: boolean; preferProxy?: string; bypassCache?: boolean; cacheTtlMs?: number;
}
export interface BrowserFetchResult {
  text: string; title: string; sourceUrl: string; source: BrowserFetchSource; proxy?: string; contentType: string; bytesRead: number; truncated: boolean; format: "html-or-text" | "markdown"; fromCache?: boolean;
}

interface CircuitState { failures: number; openUntil: number; }
const CIRCUITS = new Map<string, CircuitState>();
const DEFAULT_TIMEOUT_MS = 8_000, DEFAULT_MAX_BYTES = 2_000_000, CIRCUIT_FAILURE_THRESHOLD = 2, CIRCUIT_OPEN_MS = 60_000, PROXY_WAVE_SIZE = 2, DEFAULT_CACHE_TTL_MS = 300_000, CACHE_MAX_ENTRIES = 64, EWMA_ALPHA = 0.3, ROUTER_NEUTRAL_PRIOR_MS = 4_000;
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal", "metadata.amazonaws.com"]);

export class BrowserFetchError extends Error { readonly attempts: string[]; constructor(message: string, attempts: string[]) { super(message); this.name = "BrowserFetchError"; this.attempts = attempts.slice(); } }

interface CacheEntry { result: BrowserFetchResult; expiresAt: number; }
const FETCH_CACHE = new Map<string, CacheEntry>();
function cacheGet(key: string): BrowserFetchResult | null { const entry = FETCH_CACHE.get(key); if (!entry) return null; if (Date.now() >= entry.expiresAt) { FETCH_CACHE.delete(key); return null; } FETCH_CACHE.delete(key); FETCH_CACHE.set(key, entry); return entry.result; }
function cacheSet(key: string, result: BrowserFetchResult, ttlMs: number): void { if (ttlMs <= 0) return; if (FETCH_CACHE.size >= CACHE_MAX_ENTRIES) { const oldest = FETCH_CACHE.keys().next().value; if (oldest !== undefined) FETCH_CACHE.delete(oldest); } FETCH_CACHE.set(key, { result, expiresAt: Date.now() + ttlMs }); }

interface ProxyHealth { ewmaMs: number; successes: number; failures: number; }
const PROXY_HEALTH = new Map<string, ProxyHealth>();
function recordProxyOutcome(name: string, ok: boolean, elapsedMs: number): void { const prior = PROXY_HEALTH.get(name) || { ewmaMs: ROUTER_NEUTRAL_PRIOR_MS, successes: 0, failures: 0 }; const sample = ok ? elapsedMs : Math.max(elapsedMs, ROUTER_NEUTRAL_PRIOR_MS * 2); PROXY_HEALTH.set(name, { ewmaMs: prior.ewmaMs + EWMA_ALPHA * (sample - prior.ewmaMs), successes: prior.successes + (ok ? 1 : 0), failures: prior.failures + (ok ? 0 : 1) }); }
function proxyScore(name: string): number { const h = PROXY_HEALTH.get(name); if (!h) return ROUTER_NEUTRAL_PRIOR_MS; const total = h.successes + h.failures, fRate = total > 0 ? h.failures / total : 0; return h.ewmaMs * (1 + 3 * fRate); }
function adaptivelyOrderedFleet(exclude?: ProxyDef): ProxyDef[] { return PROXY_FLEET.filter((p) => p !== exclude).slice().sort((a, b) => proxyScore(a.name) - proxyScore(b.name)); }

function normalizeHostname(h: string): string { return h.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, ""); }
function parseIPv4(h: string): number[] | null { const pts = h.split("."); if (pts.length !== 4) return null; const ns = pts.map(p => (/^\d{1,3}$/.test(p) ? Number(p) : NaN)); if (ns.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null; return ns; }
function isBlockedIPv4(h: string): boolean { const ip = parseIPv4(h); if (!ip) return false; const [a, b, c] = ip; return (a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224); }
function parseIPv6Words(h: string): number[] | null {
  let host = normalizeHostname(h); if (!host.includes(":") || host.includes("%")) return null;
  if (host.includes(".")) { const lc = host.lastIndexOf(":"); if (lc < 0) return null; const v4 = parseIPv4(host.slice(lc + 1)); if (!v4) return null; host = `${host.slice(0, lc)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`; }
  const pts = host.split("::"); if (pts.length > 2) return null;
  const pSide = (s: string): number[] | null => { if (!s) return []; const vs = s.split(":").map(p => (/^[0-9a-f]{1,4}$/i.test(p) ? parseInt(p, 16) : NaN)); return vs.some(n => !Number.isFinite(n)) ? null : vs; };
  const L = pSide(pts[0]), R = pSide(pts[1] || ""); if (!L || !R) return null;
  if (pts.length === 1) return L.length === 8 ? L : null;
  const zs = 8 - L.length - R.length; if (zs < 1) return null;
  return [...L, ...Array.from({ length: zs }, () => 0), ...R];
}
function isBlockedIPv6(h: string): boolean {
  const host = normalizeHostname(h); if (!host.includes(":")) return false; if (host.includes("%")) return true;
  const w = parseIPv6Words(host); if (!w) return true;
  if (w.every(x => x === 0) || (w.slice(0, 7).every(x => x === 0) && w[7] === 1)) return true;
  const f = w[0]; if ((f & 0xfe00) === 0xfc00 || (f & 0xffc0) === 0xfe80 || (f & 0xff00) === 0xff00) return true;
  if (w.slice(0, 5).every(x => x === 0) && w[5] === 0xffff) return isBlockedIPv4([w[6] >>> 8, w[6] & 0xff, w[7] >>> 8, w[7] & 0xff].join("."));
  if (w.slice(0, 6).every(x => x === 0)) return isBlockedIPv4([w[6] >>> 8, w[6] & 0xff, w[7] >>> 8, w[7] & 0xff].join("."));
  return false;
}
function hasSensitiveQuery(u: URL): boolean { const exact = new Set(["authorization", "bearer", "code", "credential", "credentials", "jwt", "key", "password", "secret", "session", "sessionid", "signature", "sig", "token"]); for (const k of u.searchParams.keys()) { const c = k.toLowerCase().replace(/[^a-z0-9]/g, ""); if (exact.has(c) || /apikey|accesskey|accesstoken|authtoken|refreshtoken|clientsecret|sessiontoken|signedtoken/.test(c)) return true; } return false; }
export function normalizePublicTarget(raw: string): URL {
  if (!raw || !raw.trim()) throw new TypeError("URL empty"); let u: URL; try { u = new URL(raw); } catch { throw new TypeError("URL invalid"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new TypeError("scheme disallowed"); if (u.username || u.password) throw new TypeError("credentials disallowed");
  const h = normalizeHostname(u.hostname); if (!h || BLOCKED_HOSTNAMES.has(h) || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa") || h.endsWith(".invalid") || h.endsWith(".test") || isBlockedIPv4(h) || isBlockedIPv6(h)) throw new TypeError("target disallowed");
  u.hash = ""; return u;
}
function canDisclose(u: URL): boolean { return !hasSensitiveQuery(u); }

function createLinkedSignal(sigs: (AbortSignal | undefined)[], timeoutMs: number) {
  const ctrl = new AbortController(); const listeners: { s: AbortSignal; l: () => void }[] = []; const abort = () => { if (!ctrl.signal.aborted) ctrl.abort(); };
  for (const s of sigs) { if (s) { if (s.aborted) { abort(); break; } const l = () => abort(); s.addEventListener("abort", l, { once: true }); listeners.push({ s, l }); } }
  const t = setTimeout(abort, timeoutMs); return { signal: ctrl.signal, cleanup: () => { clearTimeout(t); for (const e of listeners) e.s.removeEventListener("abort", e.l); } };
}
async function readBoundedText(res: Response, max: number): Promise<{ text: string; bytesRead: number; truncated: boolean }> {
  if (!res.body) throw new Error("STREAMING_RESPONSE_BODY_UNAVAILABLE");
  const ct = res.headers.get("content-type") || "", charset = ct.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || "utf-8";
  let dec = new TextDecoder(charset, { fatal: false }); const reader = res.body.getReader(); let read = 0, trunc = false, text = "";
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      const rem = max - read; if (rem <= 0) { trunc = true; try { await reader.cancel(); } catch {} break; }
      const chunk = value.byteLength <= rem ? value : value.subarray(0, rem); read += chunk.byteLength; text += dec.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength) { trunc = true; try { await reader.cancel(); } catch {} break; }
    }
    text += dec.decode();
  } finally { reader.releaseLock(); }
  return { text, bytesRead: read, truncated: trunc };
}
function looksUsable(text: string): boolean { const t = text.trim(); return t.length >= 80 && !/^(?:error|forbidden|unauthorized|rate limit|too many requests|access denied)\b/i.test(t); }

async function fetchTextOnce(url: string, opts: { signal?: AbortSignal; timeoutMs: number; maxBytes: number; accept: string; redirect: RequestRedirect; validateFinalUrl?: boolean }): Promise<{ text: string; contentType: string; bytesRead: number; truncated: boolean }> {
  const linked = createLinkedSignal([opts.signal], opts.timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", mode: "cors", signal: linked.signal, credentials: "omit", referrerPolicy: "no-referrer", redirect: opts.redirect, headers: { Accept: opts.accept } });
    if (opts.validateFinalUrl && res.url) normalizePublicTarget(res.url);
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    const body = await readBoundedText(res, opts.maxBytes); if (!looksUsable(body.text)) throw new Error("UNUSABLE_RESPONSE");
    return { ...body, contentType: res.headers.get("content-type") || "" };
  } finally { linked.cleanup(); }
}

function circuitAvailable(name: string): boolean { const s = CIRCUITS.get(name); if (!s) return true; if (Date.now() >= s.openUntil) { CIRCUITS.delete(name); return true; } return s.failures < CIRCUIT_FAILURE_THRESHOLD; }
function circuitSuccess(name: string): void { CIRCUITS.delete(name); }
function circuitFailure(name: string): void { const p = CIRCUITS.get(name), f = (p?.failures || 0) + 1; CIRCUITS.set(name, { failures: f, openUntil: f >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_OPEN_MS : 0 }); }

async function tryProxy(proxy: ProxyDef, target: URL, opts: { signal?: AbortSignal; timeoutMs: number; maxBytes: number }): Promise<BrowserFetchResult> {
  if (!circuitAvailable(proxy.name)) throw new Error(`${proxy.name}:CIRCUIT_OPEN`); const start = Date.now();
  try {
    const res = await fetchTextOnce(proxy.build(target.toString()), { signal: opts.signal, timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5", redirect: "follow" });
    const unwrapped = proxy.unwrap ? proxy.unwrap(res.text) : res.text, bounded = unwrapped.slice(0, opts.maxBytes); if (!looksUsable(bounded)) throw new Error("UNUSABLE_RESPONSE");
    circuitSuccess(proxy.name); recordProxyOutcome(proxy.name, true, Date.now() - start);
    return { text: bounded, title: "", sourceUrl: target.toString(), source: "proxy", proxy: proxy.name, contentType: res.contentType, bytesRead: res.bytesRead, truncated: res.truncated || unwrapped.length > opts.maxBytes, format: "html-or-text" };
  } catch (error) { if (!opts.signal?.aborted) { circuitFailure(proxy.name); recordProxyOutcome(proxy.name, false, Date.now() - start); } throw error; }
}

function firstSuccessful<T>(factories: Array<(signal: AbortSignal) => Promise<T>>, parentSignal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (factories.length === 0) { reject(new Error("No candidates.")); return; }
    const ctrl = new AbortController(); const errors: string[] = []; let rem = factories.length, settled = false;
    const onAbort = () => ctrl.abort(); if (parentSignal?.aborted) ctrl.abort(); else parentSignal?.addEventListener("abort", onAbort, { once: true });
    for (const f of factories) { f(ctrl.signal).then(v => { if (settled) return; settled = true; ctrl.abort(); parentSignal?.removeEventListener("abort", onAbort); resolve(v); }, e => { errors.push(e instanceof Error ? e.message : "err"); rem--; if (!settled && rem === 0) { settled = true; parentSignal?.removeEventListener("abort", onAbort); reject(new Error(errors.join(" | "))); } }); }
  });
}

async function tryJina(target: URL, opts: { signal?: AbortSignal; timeoutMs: number; maxBytes: number }): Promise<BrowserFetchResult> {
  const res = await fetchTextOnce(`https://r.jina.ai/${target.toString()}`, { signal: opts.signal, timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes, accept: "text/plain,text/markdown;q=0.9,application/json;q=0.8", redirect: "follow" });
  let title = "", content = ""; try { const p = JSON.parse(res.text), d = p?.data ?? p; title = typeof d?.title === "string" ? d.title : ""; content = typeof d?.content === "string" ? d.content : ""; } catch { content = res.text; }
  if (!looksUsable(content)) throw new Error("JINA_UNUSABLE_RESPONSE");
  return { text: content.slice(0, opts.maxBytes), title, sourceUrl: target.toString(), source: "jina-reader", contentType: res.contentType, bytesRead: res.bytesRead, truncated: res.truncated || content.length > opts.maxBytes, format: "markdown" };
}

export async function fetchBrowserTextV2(rawUrl: string, options?: BrowserFetchOptions): Promise<BrowserFetchResult> {
  if (options?.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new TypeError("timeoutMs must be a positive finite number.");
  if (options?.maxBytes !== undefined && (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0)) throw new TypeError("maxBytes must be a positive finite number.");
  const target = normalizePublicTarget(rawUrl), timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES, ttl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, key = `${target.toString()}\u0000${maxBytes}`;
  if (!options?.bypassCache) { const hit = cacheGet(key); if (hit) return { ...hit, fromCache: true }; }
  const allowJina = options?.allowJinaReader !== false, allowProxies = options?.allowPublicProxies !== false;
  const attempts: string[] = [];
  try {
    const direct = await fetchTextOnce(target.toString(), { signal: options?.signal, timeoutMs, maxBytes, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5", redirect: "manual", validateFinalUrl: true });
    const res: BrowserFetchResult = { text: direct.text, title: "", sourceUrl: target.toString(), source: "direct", contentType: direct.contentType, bytesRead: direct.bytesRead, truncated: direct.truncated, format: "html-or-text" };
    if (!options?.bypassCache) cacheSet(key, res, ttl); return res;
  } catch (e) { attempts.push(`direct:${err(e)}`); }
  if (canDisclose(target)) {
    if (allowJina) { try { const res = await tryJina(target, { signal: options?.signal, timeoutMs, maxBytes }); if (!options?.bypassCache) cacheSet(key, res, ttl); return res; } catch (e) { attempts.push(`jina:${err(e)}`); } }
    if (allowProxies) {
      const pref = options?.preferProxy ? PROXY_FLEET.find(p => p.name === options.preferProxy) : undefined;
      if (pref) { try { const res = await tryProxy(pref, target, { signal: options?.signal, timeoutMs, maxBytes }); if (!options?.bypassCache) cacheSet(key, res, ttl); return res; } catch (e) { attempts.push(`${pref.name}:${err(e)}`); } }
      const fleet = adaptivelyOrderedFleet(pref);
      for (let i = 0; i < fleet.length; i += PROXY_WAVE_SIZE) {
        if (options?.signal?.aborted) break;
        const wave = fleet.slice(i, i + PROXY_WAVE_SIZE);
        try { const res = await firstSuccessful(wave.map(p => (s: AbortSignal) => tryProxy(p, target, { signal: s, timeoutMs, maxBytes })), options?.signal); if (!options?.bypassCache) cacheSet(key, res, ttl); return res; } catch (e) { attempts.push(`proxy-wave:${err(e)}`); }
      }
    }
  } else attempts.push("blocked_sensitive_query");
  throw new BrowserFetchError(`No retrieval path succeeded for ${target.hostname}.`, attempts);
}
function err(e: any): string { return e instanceof Error ? e.message : String(e); }
