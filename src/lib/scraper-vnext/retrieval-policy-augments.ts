/**
 * retrieval-policy-augments.ts
 * ============================================================================
 * ADDITIVE companion to canonical retrieval-control-plane.ts. Fills the exact
 * three sockets that canonical declares-but-does-not-implement, reimplementing
 * NONE of its racing / crawling / discovery / hedging / caching machinery.
 *
 *   SOCKET 1 — robotsDecision plug.
 *     crawl() accepts `robotsDecision?: (url, signal) => Promise<
 *       "allow" | "deny" | "unknown">` and honors robotsMode, but ships no
 *     default implementation. makeRobotsDecision() returns EXACTLY that
 *     function, RFC-9309 based, caching via canonical cachedValue() (24h).
 *
 *   SOCKET 2 — challenge/SPA gate.
 *     canonical would accept a Cloudflare/Turnstile interstitial (HTTP 200)
 *     as real content. withChallengeGate() wraps ANY CrawlPayload reader so a
 *     detected hard challenge THROWS — turning silent garbage acceptance into
 *     a clean failure that canonical's HostGovernor circuit-breaker + hedging
 *     naturally route around instead of silently swallowing garbage.
 *
 *   SOCKET 3 — value-aware priority.
 *     crawl() assigns seeds a flat priority=100. domainPriority() scores by
 *     domain reputation so a caller can order seeds highest-evidence-first;
 *     if a run is cancelled or time-budgeted, the collected subset is the
 *     BEST subset, not merely the first-arrived one. Pure scorer + seed
 *     reorderer — composes at the call site, touches no crawl internals.
 *
 * REUSES canonical cachedValue() for robots TTL — zero new persistence.
 * NO trust score is altered. NO racing/crawl/discovery is reimplemented.
 *
 * HONEST CEILING (reaffirmed, not worked around): fetch() cannot set
 * User-Agent (Chrome drops custom values), Accept-Encoding (forbidden
 * request header — silent no-op), or Origin/Referer/Host/Sec-*.
 * Browser-identity spoofing is impossible from a static page and is not
 * attempted. "Detection avoidance" here = recognition + politeness only.
 *
 * Not executed in this environment.
 * ============================================================================ */

import { cachedValue } from "./retrieval-accelerator";
import type {
  ScheduleContext,
  RetrievalPolicy,
  CrawlPayload,
} from "./retrieval-control-plane";

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET 2 — BOT-CHALLENGE / SPA-SHELL DETECTION
// ============================================================================

export type BlockKind =
  | "none"
  | "cloudflare-challenge"
  | "cloudflare-turnstile"
  | "captcha"
  | "spa-shell";

export interface BlockDetection {
  blocked: boolean;
  kind: BlockKind;
  softShell: boolean;
  markers: string[];
}

const CHALLENGE_MARKERS: RegExp[] = [
  /checking your browser before accessing/i,
  /please stand by, while we are checking your browser/i,
  /cf-browser-verification/i,
  /cf_chl_opt/i,
  /__cf_chl_/i,
  /just a moment/i,
];
const TURNSTILE_MARKERS: RegExp[] = [
  /cf-turnstile/i,
  /challenges\.cloudflare\.com\/turnstile/i,
  /cdn-cgi\/challenge-platform/i,
];
const CAPTCHA_MARKERS: RegExp[] = [
  /www\.google\.com\/recaptcha/i,
  /\bg-recaptcha\b/i,
  /\bhcaptcha\.com\b/i,
  /verify you are human/i,
];
const SPA_SHELL_MARKERS: RegExp[] = [
  /<div\s+id=["'](?:app|root|__next|__nuxt)["']\s*>\s*<\/div>/i,
  /__NEXT_DATA__[^<]*"props"\s*:\s*\{\s*\}/i,
];

export function detectPageBlock(html: string): BlockDetection {
  const sample = (html || "").slice(0, 60_000);
  const markers: string[] = [];

  for (const re of CHALLENGE_MARKERS) if (re.test(sample)) markers.push(re.source);
  if (markers.length > 0) {
    return { blocked: true, kind: "cloudflare-challenge", softShell: false, markers };
  }
  for (const re of TURNSTILE_MARKERS) if (re.test(sample)) markers.push(re.source);
  if (markers.length > 0) {
    return { blocked: true, kind: "cloudflare-turnstile", softShell: false, markers };
  }
  for (const re of CAPTCHA_MARKERS) if (re.test(sample)) markers.push(re.source);
  if (markers.length > 0) {
    return { blocked: true, kind: "captcha", softShell: false, markers };
  }

  let spa = false;
  for (const re of SPA_SHELL_MARKERS) if (re.test(sample)) { spa = true; markers.push(re.source); }
  if (!spa && html.length > 4000) {
    const textOnly = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (textOnly.length < 200) { spa = true; markers.push("low-text-ratio"); }
  }
  if (spa) return { blocked: false, kind: "spa-shell", softShell: true, markers };

  return { blocked: false, kind: "none", softShell: false, markers: [] };
}

export function withChallengeGate<T>(
  reader: (url: string, ctx: ScheduleContext, policy: RetrievalPolicy) => Promise<CrawlPayload<T>>,
  onBlock?: (url: string, detection: BlockDetection) => void,
): (url: string, ctx: ScheduleContext, policy: RetrievalPolicy) => Promise<CrawlPayload<T>> {
  return async (url, ctx, policy) => {
    const payload = await reader(url, ctx, policy);
    const detection = detectPageBlock(payload.text || "");
    if (detection.blocked) {
      onBlock?.(url, detection);
      throw new Error(`challenge_detected:${detection.kind}`);
    }
    return payload;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET 1 — RFC-9309 ROBOTS.TXT (plugs canonical's robotsDecision seam)
// ============================================================================

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const ROBOTS_MAX_BYTES = 512 * 1024;

function parseRobotsTxt(text: string): Array<{ allow: boolean; path: string }> {
  const rules: Array<{ allow: boolean; path: string }> = [];
  let inWildcard = false;
  let sawUA = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") { sawUA = true; inWildcard = value === "*"; continue; }
    if (!sawUA || !inWildcard) continue;
    if (key === "disallow" && value) rules.push({ allow: false, path: value });
    else if (key === "allow" && value) rules.push({ allow: true, path: value });
  }
  return rules;
}

function matchesRule(path: string, rulePath: string): boolean {
  if (!rulePath) return false;
  if (rulePath.endsWith("$")) return path === rulePath.slice(0, -1);
  return path.startsWith(rulePath);
}

export interface RobotsAdvisory {
  decision: "allow" | "deny" | "unknown";
  checkedPath: string;
  matchedRule?: string;
}

async function robotsRulesFor(origin: string, signal?: AbortSignal) {
  const { value } = await cachedValue<Array<{ allow: boolean; path: string }>>(
    `rcp-robots\u0000${origin}`,
    ROBOTS_TTL_MS,
    async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
        const res = await fetch(`${origin}/robots.txt`, {
          signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer",
        });
        clearTimeout(timer);
        return res.ok ? parseRobotsTxt((await res.text()).slice(0, ROBOTS_MAX_BYTES)) : [];
      } catch {
        return [];
      }
    },
  );
  return value;
}

export async function checkRobotsAdvisory(
  targetUrl: string,
  signal?: AbortSignal,
): Promise<RobotsAdvisory> {
  let origin: string, path: string;
  try {
    const u = new URL(targetUrl);
    origin = u.origin;
    path = u.pathname + u.search;
  } catch {
    return { decision: "unknown", checkedPath: targetUrl };
  }
  const rules = await robotsRulesFor(origin, signal);
  let best: { allow: boolean; path: string } | null = null;
  for (const r of rules) {
    if (matchesRule(path, r.path) && (!best || r.path.length > best.path.length)) best = r;
  }
  const decision: "allow" | "deny" = best ? (best.allow ? "allow" : "deny") : "allow";
  return { decision, checkedPath: path, matchedRule: best?.path };
}

export function makeRobotsDecision(): (
  url: string,
  signal?: AbortSignal,
) => Promise<"allow" | "deny" | "unknown"> {
  return async (url, signal) => (await checkRobotsAdvisory(url, signal)).decision;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET 3 — VALUE-AWARE PRIORITY
// ============================================================================

export function assertPublicUrl(raw: string): URL {
  if (!raw || typeof raw !== "string" || !raw.trim()) throw new TypeError("URL empty");
  if (raw.length > 4096) throw new TypeError("URL too long");
  let u: URL;
  try { u = new URL(raw); } catch { throw new TypeError("URL invalid"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new TypeError("scheme disallowed");
  if (u.username || u.password) throw new TypeError("credentials disallowed");
  const h = u.hostname.toLowerCase();
  const BLOCKED = new Set(["localhost","localhost.localdomain","metadata.google.internal","metadata.amazonaws.com","metadata.azure.com"]);
  if (BLOCKED.has(h) || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) throw new TypeError("target disallowed");
  u.hash = "";
  return u;
}

const DOMAIN_PRIORITY: Record<string, { priority: number; tier: string }> = {
  "arxiv.org": { priority: 0.95, tier: "academic" },
  "doi.org": { priority: 0.95, tier: "academic" },
  "nih.gov": { priority: 0.95, tier: "gov" },
  "cdc.gov": { priority: 0.93, tier: "gov" },
  "who.int": { priority: 0.93, tier: "gov" },
  "pubmed.ncbi.nlm.nih.gov": { priority: 0.93, tier: "academic" },
  "nature.com": { priority: 0.92, tier: "academic" },
  "science.org": { priority: 0.92, tier: "academic" },
  "ieee.org": { priority: 0.90, tier: "academic" },
  "acm.org": { priority: 0.90, tier: "academic" },
  "openalex.org": { priority: 0.88, tier: "academic" },
  "crossref.org": { priority: 0.88, tier: "academic" },
  "semanticscholar.org": { priority: 0.87, tier: "academic" },
  "wikipedia.org": { priority: 0.85, tier: "reference" },
  "reuters.com": { priority: 0.82, tier: "news" },
  "apnews.com": { priority: 0.82, tier: "news" },
  "bbc.com": { priority: 0.78, tier: "news" },
  "bloomberg.com": { priority: 0.78, tier: "news" },
  "archive.org": { priority: 0.75, tier: "reference" },
  "github.com": { priority: 0.65, tier: "general" },
  "stackoverflow.com": { priority: 0.60, tier: "general" },
  "medium.com": { priority: 0.40, tier: "low" },
  "substack.com": { priority: 0.40, tier: "low" },
  "reddit.com": { priority: 0.35, tier: "low" },
};

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

export interface DomainScore { url: string; priority: number; tier: string; }

export function domainPriority(url: string): DomainScore {
  const host = hostOf(url);
  let entry = DOMAIN_PRIORITY[host];
  if (!entry) {
    for (const [suffix, v] of Object.entries(DOMAIN_PRIORITY)) {
      if (host === suffix || host.endsWith("." + suffix)) { entry = v; break; }
    }
  }
  if (!entry) {
    const tld = host.split(".").pop() || "";
    if (tld === "gov") entry = { priority: 0.80, tier: "gov" };
    else if (tld === "edu") entry = { priority: 0.75, tier: "academic" };
    else if (tld === "int") entry = { priority: 0.78, tier: "gov" };
    else if (tld === "org") entry = { priority: 0.55, tier: "general" };
    else entry = { priority: 0.45, tier: "general" };
  }
  return { url, priority: entry.priority, tier: entry.tier };
}

export function prioritizeSeeds(urls: string[]): string[] {
  return urls
    .map(domainPriority)
    .sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url))
    .map((s) => s.url);
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

export async function runPolicyAugmentDiagnostics(): Promise<{
  ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }>;
}> {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, p: boolean, d: string) => checks.push({ id, passed: p, detail: d });

  const cf = detectPageBlock("<html><body>Please stand by, while we are checking your browser...</body></html>");
  add("detect-cf-challenge", cf.blocked && cf.kind === "cloudflare-challenge", cf.kind);

  const ts = detectPageBlock('<div class="cf-turnstile" data-sitekey="x"></div><article>Some real content alongside the widget in a longer paragraph for realism.</article>');
  add("detect-turnstile", ts.blocked && ts.kind === "cloudflare-turnstile", ts.kind);

  const clean = detectPageBlock("<article><p>This is a normal article with substantial content about widget markets and quarterly growth figures spanning multiple sentences for realism.</p></article>");
  add("detect-clean", !clean.blocked && !clean.softShell, clean.kind);

  const spa = detectPageBlock('<html><body><div id="__next"></div><script src="/app.js"></script></body></html>');
  add("detect-spa-soft-not-thrown", !spa.blocked && spa.softShell && spa.kind === "spa-shell", spa.kind);

  const badReader = async () => ({ value: 1, text: "Just a moment... checking your browser", contentType: "text/html" });
  const goodReader = async () => ({ value: 2, text: "A".repeat(50) + " normal readable article body content here.", contentType: "text/html" });
  let threw = false;
  try {
    await withChallengeGate(badReader as any)("https://x.test/", {} as any, {} as any);
  } catch { threw = true; }
  add("gate-throws-on-challenge", threw, `threw=${threw}`);

  let passed = false;
  try {
    const r = await withChallengeGate(goodReader as any)("https://x.test/", {} as any, {} as any);
    passed = (r as any).value === 2;
  } catch { /* */ }
  add("gate-passes-clean", passed, `passed=${passed}`);

  const rules = parseRobotsTxt("User-agent: *\nDisallow: /private\nAllow: /private/public\n");
  add("robots-disallow-parsed", rules.some((r) => !r.allow && r.path === "/private"), JSON.stringify(rules));

  const bestPublic = rules.filter((r) => matchesRule("/private/public/x", r.path))
    .reduce((a, b) => (!a || b.path.length > a.path.length ? b : a), null as any);
  add("robots-longest-match-allow-wins", bestPublic?.allow === true, JSON.stringify(bestPublic));

  const named = parseRobotsTxt("User-agent: SpecificBot\nDisallow: /\n");
  add("robots-ignores-named-agent", named.length === 0, JSON.stringify(named));

  const ordered = prioritizeSeeds([
    "https://reddit.com/r/test",
    "https://arxiv.org/abs/2024.1",
    "https://medium.com/a",
    "https://www.nih.gov/x",
    "https://data.census.gov/y",
  ]);
  const firstTier = domainPriority(ordered[0]).tier;
  add("priority-high-value-first", firstTier === "academic" || firstTier === "gov", `first=${ordered[0]}`);
  add("priority-low-last", domainPriority(ordered[ordered.length - 1]).priority < domainPriority(ordered[0]).priority, `last=${ordered[ordered.length - 1]}`);
  add("priority-tld-gov-fallback", domainPriority("https://data.census.gov/y").tier === "gov", "census→gov");

  return { ok: checks.every((c) => c.passed), checks };
}
