import { browserScraperSearch as baseSearch, browserScraperRead } from "./browser-search-scraper.base";
import { searchAcademicSources } from "./academic-sources";

export interface BrowserScraperSearchResult { title: string; url: string; description: string; content: string }
export { browserScraperRead };

function normalize(q: string) {
  return q.replace(/^\s*(please|find me|can you|could you|help me)\b/gi, "").replace(/\s+/g, " ").trim() || q;
}

function curated(query: string): BrowserScraperSearchResult[] {
  const q = query.toLowerCase();
  if (!/(cannabis|marijuana|hemp|thc|cbd)/.test(q)) return [];
  return [
    { title: "PubMed cannabis research", url: "https://pubmed.ncbi.nlm.nih.gov/?term=cannabis", description: "PubMed search entry point for cannabis literature.", content: "Use PubMed for peer-reviewed biomedical cannabis studies and reviews." },
    { title: "ClinicalTrials.gov cannabis studies", url: "https://clinicaltrials.gov/search?term=cannabis", description: "ClinicalTrials.gov search for cannabis trials.", content: "ClinicalTrials.gov indexes active and completed cannabis-related interventional and observational studies." },
    { title: "Reddit search: cannabis product unmet needs", url: "https://www.reddit.com/search/?q=cannabis%20product%20unmet%20needs", description: "Forum discovery seed.", content: "Use forum posts only as qualitative demand signals; validate claims with primary literature and legal caveats." },
  ];
}

async function wikipedia(query: string, count: number): Promise<BrowserScraperSearchResult[]> {
  const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${count}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.query?.search ?? []).map((h: any) => ({ title: h.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/\s/g, "_"))}`, description: String(h.snippet || "").replace(/<[^>]+>/g, " "), content: String(h.snippet || "").replace(/<[^>]+>/g, " ") }));
}

// HackerNews Algolia — CORS-safe JSON, strong for tech/product-demand signals.
async function hnAlgolia(query: string, count: number): Promise<BrowserScraperSearchResult[]> {
  const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${count}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.hits ?? []).filter((h: any) => h.url || h.objectID).map((h: any) => ({
    title: String(h.title || h.story_title || "HN discussion"),
    url: String(h.url || `https://news.ycombinator.com/item?id=${h.objectID}`),
    description: `HN · ${h.points ?? 0} pts · ${h.num_comments ?? 0} comments`,
    content: `${h.title || h.story_title || ""}. ${(h.story_text || h._highlightResult?.title?.value || "").replace(/<[^>]+>/g, " ").slice(0, 400)}`,
  }));
}

// DuckDuckGo Instant Answer — CORS-safe JSON topic summaries.
async function ddgInstant(query: string, count: number): Promise<BrowserScraperSearchResult[]> {
  const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
  if (!res.ok) return [];
  const data = await res.json();
  const out: BrowserScraperSearchResult[] = [];
  if (data.AbstractText && data.AbstractURL) out.push({ title: String(data.Heading || query), url: String(data.AbstractURL), description: "DuckDuckGo abstract", content: String(data.AbstractText).slice(0, 500) });
  for (const t of (data.RelatedTopics ?? [])) {
    if (out.length >= count) break;
    if (t.FirstURL && t.Text) out.push({ title: String(t.Text).slice(0, 120), url: String(t.FirstURL), description: "DuckDuckGo related", content: String(t.Text).slice(0, 400) });
  }
  return out;
}

export async function browserScraperSearch(query: string, opts?: { count?: number; signal?: AbortSignal; onDebug?: (msg: string) => void; enrich?: boolean }): Promise<BrowserScraperSearchResult[]> {
  const count = Math.max(1, Math.min(20, opts?.count ?? 8));
  // Truncate overly long queries for search engines (template-directed queries can be 200+ chars)
  const q = normalize(query).slice(0, 100);
  
  // PRIORITY ORDER FIX: CORS-safe JSON APIs FIRST (they actually work in 2026),
  // proxy-based HTML scraping LAST (search engines changed their DOM structure,
  // proxy scraping returns 0 hits consistently as of mid-2026).
  const [academic, wiki, hn, ddg] = await Promise.all([
    searchAcademicSources(q, { count, onDebug: opts?.onDebug }).catch(() => []),
    wikipedia(q, count).catch(() => []),
    hnAlgolia(q, Math.min(count, 5)).catch(() => []),
    ddgInstant(q, Math.min(count, 4)).catch(() => []),
  ]);
  const academicHits = academic.map(a => ({ title: a.title, url: a.url, description: a.description, content: a.content }));
  
  // Assemble CORS-safe results first
  const corsResults = [...academicHits, ...wiki, ...hn, ...ddg, ...curated(q)];
  
  // Only attempt proxy-based HTML scraping if CORS-safe APIs returned < 2 results
  // (saves 30+ seconds of proxy timeout on most queries)
  let base: BrowserScraperSearchResult[] = [];
  if (corsResults.length < 2) {
    opts?.onDebug?.(`[OG+] CORS-safe APIs returned ${corsResults.length} — trying proxy-based scraping as fallback`);
    base = await baseSearch(q, opts).catch((e: any) => { opts?.onDebug?.(`[OG+] proxy scraper failed: ${e?.message ?? "error"}`); return []; });
  } else {
    opts?.onDebug?.(`[OG+] CORS-safe APIs returned ${corsResults.length} results — skipping slow proxy scraping`);
  }
  
  // Interleave: CORS results first (higher reliability), proxy results second
  const all = [...corsResults, ...base];
  const seen = new Set<string>();
  const out = all.filter(r => r.url && !seen.has(r.url) && seen.add(r.url)).slice(0, count);
  opts?.onDebug?.(`[OG+] merged ${out.length}/${all.length} unique — academic ${academicHits.length} · wiki ${wiki.length} · hn ${hn.length} · ddg ${ddg.length} · proxy ${base.length}`);
  return out;
}