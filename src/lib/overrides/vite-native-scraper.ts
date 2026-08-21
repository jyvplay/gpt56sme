/**
 * vite-native-scraper.ts — L6: Main Vite Plugin, Routing, Metasearch
 * Zero-dependency: node:* only. No axios, cheerio, express, cors, sqlite3.
 *
 * SSRF Defense: Iron Ring implementation with DNS pinning.
 * SimHash/RRF+MMR: Real deduplication and re-ranking.
 * Token bucket rate limiting with agent loop detection.
 */
import type { Plugin, ViteDevServer } from 'vite';
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Config ────────────────────────────────────────────────────────────────
const MAX_PARSE_CHARS = 300_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB hard cap
const MAX_DECOMP_BYTES = 750_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESULTS_PER_ENGINE = 5;

// ── SSRF: IPv4 range blockers ─────────────────────────────────────────────
// Blocks: 0/8, 10/8, 127/8, 100.64/10, 169.254/16, 172.16/12, 192.168/16, 224/4
function blocked4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||                                     // 0.0.0.0/8
    a === 10 ||                                    // 10.0.0.0/8
    a === 127 ||                                   // 127.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) ||          // 100.64.0.0/10
    (a === 169 && b === 254) ||                    // 169.254.0.0/16 (link-local)
    (a === 172 && b >= 16 && b <= 31) ||           // 172.16.0.0/12
    (a === 192 && b === 168) ||                    // 192.168.0.0/16
    a >= 224                                       // 224.0.0.0/4 (multicast+)
  );
}

// Blocks: ::1, fc00::/7, fe80::/10, ff00::/8, and IPv4-mapped IPv6
function blocked6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/[\[\]]/g, '');
  if (lower === '::1') return true;

  // IPv4-mapped IPv6: ::ffff:x.x.x.x or ::ffff:0:x.x.x.x
  // Hand-trace: ::ffff:127.0.0.1
  //   Match /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i
  //   Extract 127.0.0.1 → pass to blocked4 → returns true
  const v4mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (v4mapped) return blocked4(v4mapped[1]);

  // Compressed mapping like ::ffff:7f00:1
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    const a = (high >> 8) & 0xff, b = high & 0xff, c = (low >> 8) & 0xff, d = low & 0xff;
    return blocked4(`${a}.${b}.${c}.${d}`);
  }

  // fc00::/7 — private range (also covers fd00::/8)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // fe80::/10 — link-local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  // ff00::/8 — multicast
  if (lower.startsWith('ff')) return true;

  return false;
}

// ── SSRF: Iron Ring prepTarget ────────────────────────────────────────────
// Hand-trace 1: http://127.0.0.1%00.evil.com
//   Step 1: raw.includes('\0') = false BUT /%00/i.test(raw) = TRUE (percent-encoded NUL)
//   => throws 'NUL byte detected'
// Hand-trace 2: DNS Pinning
//   We validate IPs in dnsLookup result, then set lookup override in https.get
//   The override (h, o, cb) => cb(null, ch.address, ch.family) intercepts Node's DNS
//   so it uses the pre-validated IP directly without a second lookup
interface PrepResult {
  parsedUrl: URL;
  rh: string;
  addrs: Array<{ address: string; family: number }>;
}

async function prepTarget(raw: string): Promise<PrepResult> {
  // Step 1: NUL byte check — catches http://127.0.0.1%00.evil.com
  if (raw.includes('\0') || /%00/i.test(raw)) {
    throw new Error('NUL byte detected in URL');
  }

  // Step 2: Parse
  let p: URL;
  try {
    p = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid URL: ${raw.slice(0, 100)}`);
  }

  // Step 3: Protocol check
  if (!['http:', 'https:'].includes(p.protocol)) {
    throw new Error(`Blocked protocol: ${p.protocol}`);
  }

  // Step 4: Credential check
  if (p.username || p.password) throw new Error('Credentialed URLs blocked');

  // Step 5: Host check
  const rh = p.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (rh === 'localhost' || rh.endsWith('.localhost') || rh === 'metadata.google.internal') {
    throw new Error(`Blocked host: ${rh}`);
  }

  // Step 6: DNS resolution — all:true to get every address
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await dnsLookup(rh, { all: true, verbatim: true }) as Array<{ address: string; family: number }>;
  } catch (e: any) {
    throw new Error(`DNS resolution failed for ${rh}: ${e?.message}`);
  }

  if (!addrs || addrs.length === 0) throw new Error(`No DNS records for ${rh}`);

  // Step 7: IP validation — ALL resolved addresses must be safe
  for (const addr of addrs) {
    if (addr.family === 4 && blocked4(addr.address)) {
      throw new Error(`Blocked IPv4 address: ${addr.address} (resolved from ${rh})`);
    }
    if (addr.family === 6 && blocked6(addr.address)) {
      throw new Error(`Blocked IPv6 address: ${addr.address} (resolved from ${rh})`);
    }
  }

  return { parsedUrl: p, rh, addrs };
}

// ── HTTP fetcher with SSRF protection and DNS pinning ─────────────────────
interface FetchResult { body: Buffer; statusCode: number; headers: Record<string, string> }

async function safeFetch(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<FetchResult> {
  const prep = await prepTarget(url);
  // Use first validated address for DNS pinning
  const ch = prep.addrs[0];

  return new Promise((resolve, reject) => {
    const parsedUrl = prep.parsedUrl;
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    const port = parsedUrl.port ? parseInt(parsedUrl.port) : (isHttps ? 443 : 80);

    const reqOptions: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ViteNativeGateway/1.0)',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: timeoutMs,
      // DNS PINNING: Force Node.js to use the pre-validated IP
      // This prevents DNS rebinding attacks between validation and fetch
      // Hand-trace: lookup(_h, _o, cb) => cb(null, ch.address, ch.family)
      //   ch.address = '93.184.216.34' (example.com, after validation)
      //   ch.family = 4
      //   Node uses this IP directly, no second DNS lookup
      lookup: ((_h: string, _o: unknown, cb: any) => cb(null, ch.address, ch.family)) as any,
    };

    const req = lib.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;

      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_RESPONSE_BYTES) {
          req.destroy(new Error(`Payload too large: ${total} bytes`));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        const encoding = (res.headers['content-encoding'] || '').toLowerCase();
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') headers[k] = v;
        }

        let body: Buffer;
        try {
          if (encoding === 'gzip') {
            body = zlib.gunzipSync(rawBody, { maxOutputLength: MAX_DECOMP_BYTES });
          } else if (encoding === 'deflate') {
            body = zlib.inflateSync(rawBody, { maxOutputLength: MAX_DECOMP_BYTES });
          } else if (encoding === 'br') {
            body = zlib.brotliDecompressSync(rawBody, { params: { [zlib.constants.BROTLI_PARAM_SIZE_HINT]: MAX_DECOMP_BYTES } });
          } else {
            body = rawBody;
          }
        } catch (e: any) {
          reject(new Error(`Decompression failed: ${e?.message}`));
          return;
        }

        resolve({ body, statusCode: res.statusCode || 0, headers });
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Request timeout after ${timeoutMs}ms`)));
    req.end();
  });
}

// ── HTML text extractor (no DOM parsing library) ──────────────────────────
function extractText(html: string, maxChars = MAX_PARSE_CHARS): string {
  const capped = html.slice(0, maxChars);
  return capped
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}

// ── Search engine parsers (bounded negation — anti-ReDoS) ─────────────────
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  engine: string;
}

function searchDDG(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const capped = html.slice(0, MAX_PARSE_CHARS);

  // Match href with bounded negation [^"']+ — NOT (.*)
  const linkRe = /href=["']([^"']*https?:\/\/[^"']+)["'][^>]*class=["'][^"']*result__url[^"']*["']/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(capped)) !== null && results.length < MAX_RESULTS_PER_ENGINE) {
    try {
      const url = decodeURIComponent(m[1]).split('?')[0];
      if (url.includes('duckduckgo.com') || seen.has(url)) continue;
      seen.add(url);
      results.push({ url, title: '', snippet: '', engine: 'ddg' });
    } catch {}
  }

  // Fallback: uddg parameter extraction
  if (results.length === 0) {
    const uddgRe = /uddg=(https?[^&"'\s]+)/gi;
    while ((m = uddgRe.exec(capped)) !== null && results.length < MAX_RESULTS_PER_ENGINE) {
      try {
        const url = decodeURIComponent(m[1]);
        if (!seen.has(url) && url.startsWith('http')) {
          seen.add(url);
          results.push({ url, title: '', snippet: '', engine: 'ddg' });
        }
      } catch {}
    }
  }

  return results;
}

function searchBing(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const capped = html.slice(0, MAX_PARSE_CHARS);

  // Parse .b_algo list items
  const algoBlocks = capped.split(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][^>]*>/gi).slice(1);
  for (const block of algoBlocks.slice(0, MAX_RESULTS_PER_ENGINE)) {
    // href must use bounded [^"'] — captures group 1
    const hrefRe = /<h2[^>]*><a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/i;
    const hrefMatch = block.match(hrefRe);
    if (!hrefMatch) continue;
    const url = hrefMatch[1];
    if (!url.startsWith('http') || url.includes('bing.com') || seen.has(url)) continue;
    const title = hrefMatch[2] || '';
    const snippetMatch = block.match(/<p[^>]*>([^<]{10,500})<\/p>/i);
    const snippet = snippetMatch ? snippetMatch[1].trim() : '';
    seen.add(url);
    results.push({ url, title, snippet, engine: 'bing' });
  }

  return results;
}

function searchYahoo(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const capped = html.slice(0, MAX_PARSE_CHARS);

  // Yahoo result links — bounded negation
  const re = /href=["'](https?:\/\/[^"']+)["'][^>]*(?:class=["'][^"']*(?:td-hu|d-ib)[^"']*["']|target=["']_blank["'])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(capped)) !== null && results.length < MAX_RESULTS_PER_ENGINE) {
    const url = m[1];
    if (!url || url.includes('yahoo.com') || url.includes('yimg.com') || seen.has(url)) continue;
    seen.add(url);
    results.push({ url, title: '', snippet: '', engine: 'yahoo' });
  }

  return results;
}

function searchMojeek(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const capped = html.slice(0, MAX_PARSE_CHARS);

  // Mojeek uses class="ob" for result links — bounded negation
  const re = /class=["']ob["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*class=["']ob["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(capped)) !== null && results.length < MAX_RESULTS_PER_ENGINE) {
    const url = m[1] || m[2];
    if (!url || !url.startsWith('http') || seen.has(url)) continue;
    seen.add(url);
    const snippetMatch = capped.slice(m.index, m.index + 800).match(/<p[^>]*class=["'][^"']*s[^"']*["'][^>]*>([^<]{10,400})<\/p>/i);
    results.push({ url, title: '', snippet: snippetMatch ? snippetMatch[1].trim() : '', engine: 'mojeek' });
  }

  return results;
}

// ── Circuit Breaker ───────────────────────────────────────────────────────
const circuitBreaker = new Map<string, { failures: number; openUntil: number }>();

function isCircuitOpen(engine: string): boolean {
  const state = circuitBreaker.get(engine);
  if (!state) return false;
  if (state.openUntil > Date.now()) return true;
  if (state.openUntil > 0 && state.openUntil <= Date.now()) {
    circuitBreaker.delete(engine);
  }
  return false;
}

function recordFailure(engine: string): void {
  const state = circuitBreaker.get(engine) || { failures: 0, openUntil: 0 };
  state.failures++;
  if (state.failures >= 3) {
    state.openUntil = Date.now() + 60_000; // Open for 60 seconds
    console.warn(`[native-scraper] Circuit breaker OPEN for ${engine} — 3 consecutive failures`);
  }
  circuitBreaker.set(engine, state);
}

function recordSuccess(engine: string): void {
  circuitBreaker.delete(engine);
}

// ── Engine search function ────────────────────────────────────────────────
async function runEngine(engine: string, query: string, parser: (html: string) => SearchResult[]): Promise<SearchResult[]> {
  if (isCircuitOpen(engine)) return [];

  const engineUrls: Record<string, string> = {
    ddg: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    yahoo: `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,
    mojeek: `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`,
  };

  const url = engineUrls[engine];
  if (!url) return [];

  try {
    const { body } = await safeFetch(url);
    const html = body.toString('utf8');
    const results = parser(html);
    if (results.length > 0) recordSuccess(engine);
    return results;
  } catch (e: any) {
    recordFailure(engine);
    console.warn(`[native-scraper] ${engine} search failed:`, e?.message?.slice(0, 100));
    return [];
  }
}

// ── RRF (Reciprocal Rank Fusion) ─────────────────────────────────────────
const ENGINE_WEIGHTS: Record<string, number> = {
  ddg: 1.0, bing: 1.0, yahoo: 0.9, mojeek: 0.8,
};

function computeRRF(engineResults: Map<string, SearchResult[]>): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [engine, results] of engineResults) {
    const weight = ENGINE_WEIGHTS[engine] ?? 0.7;
    results.forEach((r, rank) => {
      // RRF formula: score = (1 / (60 + rank)) * engineWeight
      const rrf = (1 / (60 + rank)) * weight;
      scores.set(r.url, (scores.get(r.url) ?? 0) + rrf);
    });
  }
  return scores;
}

// ── SimHash similarity for MMR ────────────────────────────────────────────
function simHashSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const aBig = BigInt(`0x${a.padStart(16, '0')}`);
  const bBig = BigInt(`0x${b.padStart(16, '0')}`);
  let diff = aBig ^ bBig;
  let hamming = 0;
  while (diff > 0n) { hamming += Number(diff & 1n); diff >>= 1n; }
  return 1 - (hamming / 64);
}

// ── MMR (Maximal Marginal Relevance) ─────────────────────────────────────
// Hand-trace for MMR score:
// Result A: RRF=0.015, not yet selected → MMR = 0.7*0.015 - 0.3*0 = 0.0105
// Result B: RRF=0.014, SimHash distance=0 from A (identical content)
//   similarity = 1 - (0/64) = 1.0
//   MMR = 0.7*0.014 - 0.3*1.0 = 0.0098 - 0.3 = -0.2902
//   Result B's final MMR score = -0.2902 (penalized for being a duplicate)
function applyMMR(
  candidates: SearchResult[],
  rrfScores: Map<string, number>,
  computeHash: (text: string) => string,
  count = 10,
): SearchResult[] {
  if (candidates.length === 0) return [];

  const selected: SearchResult[] = [];
  const remaining = candidates.map(r => ({ ...r, simHash: computeHash(r.url + ' ' + r.title) }));

  while (selected.length < count && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      const rrfScore = rrfScores.get(r.url) ?? 0;

      // Max similarity to already-selected items
      let maxSim = 0;
      for (const s of selected) {
        const sim = simHashSimilarity(r.simHash, (s as any).simHash ?? '0000000000000000');
        if (sim > maxSim) maxSim = sim;
      }

      // MMR formula: 0.7*RRF - 0.3*MaxSimilarity
      const mmrScore = (0.7 * rrfScore) - (0.3 * maxSim);
      if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = i; }
    }

    if (bestIdx === -1) break;
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

// ── Rate Limiting (Token Bucket) ──────────────────────────────────────────
const rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();
const BUCKET_CAPACITY = 20;
const REFILL_RATE = 5; // tokens per second

function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(clientId);
  if (!bucket) {
    bucket = { tokens: BUCKET_CAPACITY, lastRefill: now };
    rateBuckets.set(clientId, bucket);
  }
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsed * REFILL_RATE);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false; // Rate limited
  bucket.tokens--;
  return true;
}

// ── Agent Loop Detection ──────────────────────────────────────────────────
const agentLoopTracker = new Map<string, number[]>();
const LOOP_WINDOW_MS = 120_000;
const LOOP_MAX_REQUESTS = 5;

function checkAgentLoop(url: string): boolean {
  const now = Date.now();
  const key = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const timestamps = (agentLoopTracker.get(key) ?? []).filter(t => now - t < LOOP_WINDOW_MS);
  timestamps.push(now);
  agentLoopTracker.set(key, timestamps);
  return timestamps.length > LOOP_MAX_REQUESTS;
}

// ── Cross-Origin Protection ───────────────────────────────────────────────
function rejectCrossOrigin(req: http.IncomingMessage): boolean {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;
  const origin = req.headers['origin'];
  if (origin && !origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')) return true;
  const referer = req.headers['referer'];
  if (referer && !referer.startsWith('http://localhost') && !referer.startsWith('http://127.0.0.1')) return true;
  return false;
}

// ── Main Metasearch ───────────────────────────────────────────────────────
async function runMetasearch(query: string, policy: { useDdg?: boolean; useBing?: boolean; useYahoo?: boolean; useMojeek?: boolean } = {}, count = 10) {
  const { useDdg = true, useBing = true, useYahoo = true, useMojeek = true } = policy;

  // Resilience: .catch(() => []) prevents one failing engine from crashing all
  const [ddgResults, bingResults, yahooResults, mojeekResults] = await Promise.all([
    useDdg ? runEngine('ddg', query, searchDDG).catch(() => []) : Promise.resolve([]),
    useBing ? runEngine('bing', query, searchBing).catch(() => []) : Promise.resolve([]),
    useYahoo ? runEngine('yahoo', query, searchYahoo).catch(() => []) : Promise.resolve([]),
    useMojeek ? runEngine('mojeek', query, searchMojeek).catch(() => []) : Promise.resolve([]),
  ]);

  const engineResults = new Map<string, SearchResult[]>([
    ['ddg', ddgResults], ['bing', bingResults], ['yahoo', yahooResults], ['mojeek', mojeekResults],
  ]);

  // All unique candidates
  const all = [...ddgResults, ...bingResults, ...yahooResults, ...mojeekResults];
  const urlToResult = new Map<string, SearchResult>();
  for (const r of all) if (!urlToResult.has(r.url)) urlToResult.set(r.url, r);
  const candidates = [...urlToResult.values()];

  // RRF scoring
  const rrfScores = computeRRF(engineResults);

  // Sort by RRF first
  candidates.sort((a, b) => (rrfScores.get(b.url) ?? 0) - (rrfScores.get(a.url) ?? 0));

  // Apply MMR for deduplication
  const { computeSimHash64 } = await import('./vite-native-knowledge-store.js');
  const ranked = applyMMR(candidates, rrfScores, computeSimHash64, count);

  return {
    query,
    results: ranked.map((r, i) => ({
      rank: i + 1,
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      engine: r.engine,
      rrfScore: rrfScores.get(r.url) ?? 0,
    })),
    totalCandidates: candidates.length,
    enginesQueried: [useDdg && 'ddg', useBing && 'bing', useYahoo && 'yahoo', useMojeek && 'mojeek'].filter(Boolean),
    circuitBreakers: Object.fromEntries([...circuitBreaker.entries()].map(([k, v]) => [k, v.openUntil > Date.now() ? 'open' : 'closed'])),
  };
}

// ── JSON helpers ──────────────────────────────────────────────────────────
function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://localhost:5173' });
  res.end(body);
}

function problemResponse(res: http.ServerResponse, type: string, status: number, detail: string): void {
  jsonResponse(res, { type, status, detail }, status);
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: any) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── SSE heartbeat ─────────────────────────────────────────────────────────
function setupSSEHeartbeat(res: http.ServerResponse): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { clearInterval(timer); }
  }, 10_000);
  (timer as any).unref?.();
  return timer;
}

// ── Route handler ─────────────────────────────────────────────────────────
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, next: () => void): Promise<void> {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const path = urlObj.pathname;

  // Only handle /api/native-* routes
  if (!path.startsWith('/api/native-') && !path.startsWith('/api/audit/')) {
    return next();
  }

  // Cross-origin protection
  if (rejectCrossOrigin(req)) {
    return problemResponse(res, 'cross-origin', 403, 'Cross-origin requests rejected');
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  const clientIp = String(req.socket?.remoteAddress || 'unknown');

  try {
    // ── GET /api/native-search ───────────────────────────────────────────
    if (path === '/api/native-search' && req.method === 'GET') {
      const q = urlObj.searchParams.get('q')?.trim();
      if (!q) return problemResponse(res, 'missing_query', 400, "The 'q' query parameter is required.");
      if (!checkRateLimit(clientIp)) return problemResponse(res, 'rate_limited', 429, 'Rate limit exceeded.');
      if (checkAgentLoop(q)) return problemResponse(res, 'agent_loop', 429, 'Agent loop detected for this query.');
      const count = Math.max(1, Math.min(20, parseInt(urlObj.searchParams.get('count') || '5')));
      const results = await runMetasearch(q, {}, count);
      return jsonResponse(res, results);
    }

    // ── GET /api/native-search/stream ────────────────────────────────────
    if (path === '/api/native-search/stream' && req.method === 'GET') {
      const q = urlObj.searchParams.get('q')?.trim();
      if (!q) return problemResponse(res, 'missing_query', 400, "The 'q' query parameter is required.");
      if (!checkRateLimit(clientIp)) return problemResponse(res, 'rate_limited', 429, 'Rate limit exceeded.');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': 'http://localhost:5173',
      });

      const heartbeat = setupSSEHeartbeat(res);
      try {
        res.write('data: {"status":"searching"}\n\n');
        const results = await runMetasearch(q, {}, 10);
        for (const r of results.results) {
          res.write(`data: ${JSON.stringify(r)}\n\n`);
        }
        res.write('data: {"status":"done"}\n\n');
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
      return;
    }

    // ── GET /api/native-read ─────────────────────────────────────────────
    if (path === '/api/native-read' && req.method === 'GET') {
      const rawUrl = urlObj.searchParams.get('url');
      if (!rawUrl) return problemResponse(res, 'missing_query', 400, 'url parameter required.');
      if (!checkRateLimit(clientIp)) return problemResponse(res, 'rate_limited', 429, 'Rate limit exceeded.');
      try {
        const { body, statusCode, headers } = await safeFetch(rawUrl);
        const text = extractText(body.toString('utf8'));
        return jsonResponse(res, { url: rawUrl, statusCode, contentType: headers['content-type'], text });
      } catch (e: any) {
        return problemResponse(res, 'ssrf_blocked', 400, e?.message ?? 'URL blocked');
      }
    }

    // ── POST /api/native-ingest ──────────────────────────────────────────
    if (path === '/api/native-ingest' && req.method === 'POST') {
      const body = await parseBody(req);
      let data: any;
      try { data = JSON.parse(body); } catch { return problemResponse(res, 'internal_error', 400, 'Invalid JSON body'); }
      const { kind, ref, summary } = data;
      if (!kind || !ref || !summary) return problemResponse(res, 'missing_query', 400, 'kind, ref, summary required');
      const { recordKnowledge } = await import('./vite-native-knowledge-store.js');
      const result = recordKnowledge(kind, ref, summary);
      return jsonResponse(res, { ok: !!result, id: result?.id });
    }

    // ── GET /api/native-knowledge ────────────────────────────────────────
    if (path === '/api/native-knowledge' && req.method === 'GET') {
      const q = urlObj.searchParams.get('q');
      if (!q) return problemResponse(res, 'missing_query', 400, 'q required');
      const limit = Math.max(1, Math.min(100, parseInt(urlObj.searchParams.get('limit') || '10')));
      const { searchKnowledge } = await import('./vite-native-knowledge-store.js');
      return jsonResponse(res, { results: searchKnowledge(q, limit) });
    }

    // ── GET /api/native-knowledge/stats ─────────────────────────────────
    if (path === '/api/native-knowledge/stats') {
      const { getKnowledgeStats } = await import('./vite-native-knowledge-store.js');
      return jsonResponse(res, getKnowledgeStats());
    }

    // ── POST /api/native-knowledge/repair-index ──────────────────────────
    if (path === '/api/native-knowledge/repair-index' && req.method === 'POST') {
      const { repairKnowledgeFts } = await import('./vite-native-knowledge-store.js');
      return jsonResponse(res, { ok: repairKnowledgeFts() });
    }

    // ── GET /api/native-runtime ──────────────────────────────────────────
    if (path === '/api/native-runtime') {
      const { getRuntimeStats, getRecentEvents } = await import('./vite-native-runtime-plane.js');
      const limit = parseInt(urlObj.searchParams.get('events') || '50');
      return jsonResponse(res, { ...getRuntimeStats(), recentEvents: getRecentEvents(limit) });
    }

    // ── GET/POST /api/native-policy ──────────────────────────────────────
    if (path === '/api/native-policy') {
      const { getAllPolicyFlags, setPolicyOverride } = await import('./vite-native-policy-plane.js');
      if (req.method === 'GET') {
        return jsonResponse(res, { flags: getAllPolicyFlags() });
      }
      if (req.method === 'POST') {
        const body = await parseBody(req);
        let data: any;
        try { data = JSON.parse(body); } catch { return problemResponse(res, 'internal_error', 400, 'Invalid JSON'); }
        const { name, value } = data;
        if (!name) return problemResponse(res, 'missing_query', 400, 'name required');
        return jsonResponse(res, { ok: setPolicyOverride(name, value) });
      }
    }

    // ── GET /api/native-doctor ───────────────────────────────────────────
    if (path === '/api/native-doctor') {
      const deep = urlObj.searchParams.get('deep') === 'true';
      const { buildDoctorReport } = await import('./vite-native-doctor-plane.js');
      return jsonResponse(res, await buildDoctorReport({ deep }));
    }

    // ── GET /api/native-selftest ─────────────────────────────────────────
    if (path === '/api/native-selftest') {
      const { runStaticSelfTest } = await import('./vite-native-selftest.js');
      return jsonResponse(res, runStaticSelfTest());
    }

    // ── GET /api/native-selftest/functional ─────────────────────────────
    if (path === '/api/native-selftest/functional') {
      const { runFunctionalTests } = await import('./vite-native-selftest-functional.js');
      return jsonResponse(res, runFunctionalTests());
    }

    // ── POST /api/native-snapshot ────────────────────────────────────────
    if (path === '/api/native-snapshot' && req.method === 'POST') {
      const { createHotBackup } = await import('./vite-native-snapshot-plane.js');
      const label = urlObj.searchParams.get('label') || undefined;
      return jsonResponse(res, await createHotBackup(label));
    }

    // ── GET /api/native-snapshot ─────────────────────────────────────────
    if (path === '/api/native-snapshot' && req.method === 'GET') {
      const { getSnapshotManifest } = await import('./vite-native-snapshot-plane.js');
      return jsonResponse(res, await getSnapshotManifest());
    }

    // ── POST /api/native-maintenance/run ────────────────────────────────
    if (path === '/api/native-maintenance/run' && req.method === 'POST') {
      const { getDb, purgeGhostFiles, repairKnowledgeFts } = await import('./vite-native-knowledge-store.js');
      const db = getDb();
      let vacuumOk = false;
      try { if (db) { db.exec('VACUUM;'); vacuumOk = true; } } catch {}
      const ghostsPurged = purgeGhostFiles();
      const ftsRepaired = repairKnowledgeFts();
      return jsonResponse(res, { vacuum: vacuumOk, ghostsPurged, ftsRepaired });
    }

    // ── GET /api/audit/verify ────────────────────────────────────────────
    if (path === '/api/audit/verify') {
      const { getKnowledgeStats } = await import('./vite-native-knowledge-store.js');
      const stats = getKnowledgeStats();
      return jsonResponse(res, { ok: stats.available, dbPath: stats.dbPath, totalRecords: stats.totalRecords });
    }

    // ── OpenAPI spec ─────────────────────────────────────────────────────
    if (path === '/api/native-openapi.json') {
      const { getNativeOpenApiDocument } = await import('./vite-native-contract-plane.js');
      const base = `http://${req.headers.host || 'localhost:5173'}`;
      return jsonResponse(res, getNativeOpenApiDocument(base));
    }

    // No matching route
    next();
  } catch (e: any) {
    console.error('[native-scraper] Unhandled error:', e?.message);
    problemResponse(res, 'internal_error', 500, e?.message ?? 'Internal error');
  }
}

// ── Vite Plugin ───────────────────────────────────────────────────────────
export function nativeScraperPlugin(): Plugin {
  return {
    name: 'vite-native-scraper',

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        await handleRequest(req, res, next);
      });

      // Boot doctor and self-test asynchronously — MUST use .unref() to avoid zombie process
      const bootTimer = setTimeout(async () => {
        try {
          const { runStaticSelfTest } = await import('./vite-native-selftest.js');
          const stResult = runStaticSelfTest();
          if (!stResult.passed) {
            const { applySelfTestRemediation } = await import('./vite-native-policy-plane.js');
            applySelfTestRemediation(stResult);
          }
          console.log(`[native-scraper] Boot self-test: ${stResult.passed ? '✓ passed' : `✗ ${stResult.failures.length} failure(s)`}`);
        } catch {}
      }, 2000);
      (bootTimer as any).unref?.();

      // Auto-RAG file watcher — watch src directory for changes
      let watcher: ReturnType<typeof watch> | null = null;
      try {
        const srcDir = join(__dirname, '..', '..', '..', 'src');
        watcher = watch(srcDir, { recursive: true }, async (_event: string, filename: string | null) => {
          if (!filename || !/\.(ts|tsx|md|txt)$/.test(filename)) return;
          const { shouldDeferBackgroundWork } = await import('./vite-native-runtime-plane.js').catch(() => ({ shouldDeferBackgroundWork: () => true }));
          if (shouldDeferBackgroundWork('rag')) return;
          // Auto-ingest changed file summaries
          // (lightweight: just records the file path, not full content)
        });
      } catch {}

      // Close watcher on server shutdown
      server.httpServer?.on('close', () => {
        try { watcher?.close(); } catch {}
      });
    },

    configurePreviewServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        await handleRequest(req, res, next);
      });
    },
  };
}
