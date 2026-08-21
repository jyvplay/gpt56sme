/**
 * vite-native-selftest.ts — L5: Static AST/Regex Invariant Sentinels
 * Reads vite-native-scraper.ts as raw string and verifies invariants.
 * Zero-dependency: node:fs only.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRAPER_PATH = join(__dirname, 'vite-native-scraper.ts');

export interface SelfTestResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
  ts: number;
}

// ── Function body extractor via curly-brace counting ─────────────────────
// Hand-trace: fn containing { a: { b: 1 } }
// Encounter '{': depth 1 -> 2 -> 3 (inner '{'s)
// Encounter '}': depth 3 -> 2 -> 1 (inner '}'s)
// Final '}': depth 1 -> 0 => end of function body
export function extractFnBody(src: string, fnName: string): string | null {
  const idx = src.indexOf(`function ${fnName}`);
  if (idx === -1) {
    // Try arrow function or method
    const altIdx = src.indexOf(`${fnName}(`);
    if (altIdx === -1) return null;
    const braceStart = src.indexOf('{', altIdx);
    if (braceStart === -1) return null;
    let depth = 0;
    let start = -1;
    for (let i = braceStart; i < src.length; i++) {
      if (src[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (src[i] === '}') {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    return null;
  }
  const braceStart = src.indexOf('{', idx);
  if (braceStart === -1) return null;
  let depth = 0;
  let start = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

export function runStaticSelfTest(): SelfTestResult {
  const ts = Date.now();
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(SCRAPER_PATH)) {
    return {
      passed: false,
      failures: [`Scraper file not found at ${SCRAPER_PATH}`],
      warnings: [],
      ts,
    };
  }

  let src: string;
  try {
    src = readFileSync(SCRAPER_PATH, 'utf8');
  } catch (e: any) {
    return { passed: false, failures: [`Cannot read scraper: ${e?.message}`], warnings: [], ts };
  }

  // ── 1. No citation artifacts ─────────────────────────────────────────
  if (src.includes('<!--citation')) {
    failures.push('citation-artifact: LLM citation artifact found in scraper source');
  }

  // ── 2. SSRF: NUL byte check ───────────────────────────────────────────
  if (!src.includes("includes('\\0')") && !src.includes('includes("\\0")')) {
    failures.push('ssrf.nul.includes: NUL byte check missing (must include raw NUL check)');
  }
  if (!src.match(/%00/i) && !src.includes('/%00/i')) {
    failures.push('ssrf.nul.regex: NUL percent-encoded check missing (/%00/i)');
  }

  // ── 3. SSRF: blocked4 and blocked6 must exist ────────────────────────
  if (!src.includes('blocked4') || !src.includes('blocked6')) {
    failures.push('ssrf.ip.blockers: blocked4 and blocked6 IP range checkers must be defined');
  }

  // ── 4. DNS resolution all:true ────────────────────────────────────────
  if (!src.includes('all: true') && !src.includes('all:true')) {
    failures.push('ssrf.dns.all: DNS lookup must use { all: true } to get all addresses');
  }

  // ── 5. DNS pinning via lookup override ───────────────────────────────
  if (!src.includes('lookup:') && !src.includes('lookup :')) {
    failures.push('ssrf.dns.pin: DNS pinning (lookup override) missing in http.get/https.get options');
  }

  // ── 6. Parser regexes — must use bounded negation not greedy wildcards ─
  // searchBing parser
  const bingBody = extractFnBody(src, 'searchBing');
  if (bingBody) {
    // Must capture href in group 1 with bounded negation
    // Simpler check: contains the correct bounded pattern
    if (!bingBody.includes("[^\"']") && !bingBody.includes("[^'\"")  && !bingBody.match(/\[S#\d\]/)) {
      // Check for href capture group
      if (!bingBody.match(/href[=]["']?\([^"']+\)['"]/)) {
        if (!bingBody.includes("href=")) {
          failures.push('parser.bing.href.capture: searchBing must extract href with bounded regex');
        }
      }
    }
  } else {
    warnings.push('parser.bing: searchBing function not found — may be different name');
  }

  // ── 7. Mojeek parser ─────────────────────────────────────────────────
  const mojeekBody = extractFnBody(src, 'searchMojeek');
  if (mojeekBody) {
    if (!mojeekBody.includes("href") || !mojeekBody.match(/\[[\^"'\]]+\]/)) {
      if (!mojeekBody.match(/href=["']?\(.*?\)["']?/)) {
        warnings.push('parser.mojeek.href.capture: verify searchMojeek uses bounded href regex');
      }
    }
  }

  // ── 8. No ReDoS patterns (unbounded greedy in capture group) ─────────
  const reDoSPattern = /\(\.\*\)/g;
  const matches = src.match(reDoSPattern);
  if (matches && matches.length > 0) {
    failures.push(`ssrf.redos: Found ${matches.length} potentially unsafe (.*) capture group(s) — use bounded [^...]+`);
  }

  // ── 9. Zip bomb protection ────────────────────────────────────────────
  if (!src.includes('maxOutputLength')) {
    failures.push('decompression.maxOutputLength: zlib maxOutputLength not set — zip bomb vulnerability');
  }
  if (!src.includes('5 * 1024 * 1024') && !src.includes('5242880') && !src.includes('5 *1024 * 1024')) {
    warnings.push('decompression.size: Verify payload size limit is set to ~5MB');
  }

  // ── 10. Rate limiting ─────────────────────────────────────────────────
  if (!src.includes('checkRateLimit') && !src.includes('rateLimit')) {
    failures.push('ratelimit.missing: Token bucket rate limiter not found');
  }

  // ── 11. Cross-origin protection ───────────────────────────────────────
  if (!src.includes('sec-fetch-site') && !src.includes('rejectCrossOrigin')) {
    warnings.push('cors.check: sec-fetch-site cross-origin check may be missing');
  }

  // ── 12. WAL pragma present ────────────────────────────────────────────
  if (!src.includes('WAL') && !src.includes('journal_mode')) {
    warnings.push('sqlite.pragma: WAL mode pragma not found in scraper');
  }

  // ── 13. BigInt enforcement in SimHash ────────────────────────────────
  if (src.includes('computeSimHash') || src.includes('simHash')) {
    if (!src.includes('BigInt') && !src.includes('1n')) {
      failures.push('simhash.bigint: SimHash must use BigInt to avoid 32-bit truncation');
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    ts,
  };
}
