/**
 * Enhanced Scraper — patched with preserveSourceDuplicates to allow RRF accumulation.
 * This is a verbatim copy of the package's implementation with the single additive option.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  relevanceScore?: number;
  publishedAt?: string;
  domain?: string;
}
export interface ScraperResult {
  url: string;
  title: string;
  content: string;
  extractedData: { dates?: string[]; numbers?: string[]; entities?: string[]; citations?: string[]; emails?: string[]; urls?: string[] };
  qualityScore: number;
  contentLength: number;
}

const SEARCH_ENGINES = {
  google: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  bing: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q: string) => `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  wikipedia: (q: string) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
  scholar: (q: string) => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`,
  arxiv: (q: string) => `https://arxiv.org/search/?query=${encodeURIComponent(q)}&searchtype=all`,
};

const NICHE_APIS = {
  hackernews: (q: string) => `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=10`,
  stackexchange: (q: string, site = "stackoverflow") => `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=${site}&pagesize=10`,
  reddit: (q: string) => `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=10&sort=relevance`,
  semanticscholar: (q: string) => `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=10&fields=title,abstract,authors,year,url,venue,citationCount`,
  crossref: (q: string) => `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=10`,
  openalex: (q: string) => `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=10`,
  pubmed: (q: string) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(q)}&retmax=10&retmode=json`,
  sec_edgar: (q: string) => `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&dateRange=custom&forms=10-K,10-Q,8-K`,
  patents: (q: string) => `https://api.patentsview.org/patents/query?q={"_text_any":{"patent_title":"${encodeURIComponent(q)}"}}&f=["patent_number","patent_title","patent_date","patent_abstract"]&o={"per_page":10}`,
  wayback: (url: string) => `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
  github: (q: string) => `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=10`,
};

const STACK_EXCHANGE_SITES = ["stackoverflow","stats","math","physics","chemistry","biology","engineering","medicalsciences","law","money","quant","datascience","ai","electronics","workplace","academia"];

const PROXY_FLEET = [
  { name: "corsproxy.io", build: (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { name: "allorigins-raw", build: (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { name: "codetabs", build: (u: string) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}` },
  { name: "cors.sh", build: (u: string) => `https://proxy.cors.sh/${u}` },
  { name: "yacdn", build: (u: string) => `https://yacdn.org/proxy/${u}` },
  { name: "thingproxy", build: (u: string) => `https://thingproxy.freeboard.io/fetch/${u}` },
  { name: "cors-anywhere", build: (u: string) => `https://cors-anywhere.herokuapp.com/${u}` },
  { name: "corsproxy.org", build: (u: string) => `https://corsproxy.org/?${encodeURIComponent(u)}` },
];

const TRUSTED_DOMAINS: Record<string, number> = {
  "nature.com":0.3,"science.org":0.3,"cell.com":0.3,"nejm.org":0.3,"thelancet.com":0.3,"bmj.com":0.25,
  "ieee.org":0.25,"acm.org":0.25,"springer.com":0.2,"sciencedirect.com":0.2,"wiley.com":0.2,"jstor.org":0.2,
  "sec.gov":0.3,"federalreserve.gov":0.3,"bls.gov":0.3,"census.gov":0.3,"who.int":0.3,"cdc.gov":0.3,"nih.gov":0.3,"fda.gov":0.3,
  "arxiv.org":0.2,"biorxiv.org":0.15,"ssrn.com":0.15,"reuters.com":0.15,"ft.com":0.2,"bloomberg.com":0.2,"wsj.com":0.2,
  "economist.com":0.15,"hbr.org":0.15,"mckinsey.com":0.15,"bain.com":0.15,"bcg.com":0.15,"deloitte.com":0.1,"pwc.com":0.1,"kpmg.com":0.1,
  "gartner.com":0.15,"forrester.com":0.15,"idc.com":0.15,"github.com":0.1,"stackoverflow.com":0.1,
};

function domainOf(url: string): string { try{ return new URL(url).hostname.replace(/^www\./,""); }catch{ return ""; } }
function trustBoost(url: string): number { const d=domainOf(url); for (const [k,v] of Object.entries(TRUSTED_DOMAINS)) if (d.endsWith(k)) return v; return 0; }

export async function enhancedSearch(
  query: string,
  options?: {
    engines?: Array<keyof typeof SEARCH_ENGINES>;
    maxResults?: number;
    includeAcademic?: boolean;
    includeIndustry?: boolean;
    includeForums?: boolean;
    stackExchangeSites?: string[];
    preserveSourceDuplicates?: boolean;
  }
): Promise<SearchResult[]> {
  const engines = options?.engines || ["google","bing","duckduckgo"];
  const maxResults = options?.maxResults || 20;
  const includeAcademic = options?.includeAcademic !== false;
  const includeIndustry = options?.includeIndustry !== false;
  const includeForums = options?.includeForums !== false;
  const seSites = options?.stackExchangeSites || ["stackoverflow","stats","engineering"];
  const promises: Promise<SearchResult[]>[] = [];
  for (const engine of engines) {
    promises.push((async ()=>{ try{ const r=await fetch(SEARCH_ENGINES[engine](query)); if (!r.ok) return []; const html=await r.text(); return parseSearchResults(html,engine); }catch{ return []; } })());
  }
  if (includeAcademic){ promises.push(fetchSemanticScholar(query)); promises.push(fetchCrossref(query)); promises.push(fetchOpenAlex(query)); promises.push(fetchPubMed(query)); }
  if (includeForums){ promises.push(fetchHackerNews(query)); for (const site of seSites) promises.push(fetchStackExchange(query,site)); promises.push(fetchReddit(query)); }
  if (includeIndustry){ promises.push(fetchGitHub(query)); }
  const all=(await Promise.allSettled(promises)).flatMap((p)=> p.status==="fulfilled" ? p.value : []);
  const seen=new Set<string>();
  const deduped=all.filter((result)=>{
    if (!result.url) return false;
    const dedupeKey = options?.preserveSourceDuplicates ? `${result.source||"web"}\u0000${result.url}` : result.url;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    result.domain=domainOf(result.url);
    result.relevanceScore=(result.relevanceScore ?? 0.5)+trustBoost(result.url);
    return true;
  });
  deduped.sort((a,b)=>(b.relevanceScore ?? 0)-(a.relevanceScore ?? 0));
  return deduped.slice(0,maxResults);
}

async function fetchHackerNews(q: string): Promise<SearchResult[]> {
  try{ const r=await fetch(NICHE_APIS.hackernews(q)); if (!r.ok) return []; const j=await r.json(); return (j.hits||[]).slice(0,10).map((h:any)=>({ title:h.title||h.story_title||"HN discussion", url:h.url||`https://news.ycombinator.com/item?id=${h.objectID}`, snippet:(h.story_text||h.comment_text||"").replace(/<[^>]*>/g,"").slice(0,300), source:"hackernews", relevanceScore: Math.min(1,0.5+(h.points||0)/200+(h.num_comments||0)/200), publishedAt:h.created_at })); }catch{ return []; }
}
async function fetchStackExchange(q: string, site: string): Promise<SearchResult[]> {
  try{ const r=await fetch(NICHE_APIS.stackexchange(q,site)); if (!r.ok) return []; const j=await r.json(); return (j.items||[]).slice(0,5).map((it:any)=>({ title:it.title||"SE question", url:it.link, snippet:`${it.answer_count} answer(s) · score ${it.score} · [${site}]`, source:`se-${site}`, relevanceScore: Math.min(1,0.4+(it.score||0)/50+(it.is_answered?0.2:0)) })); }catch{ return []; }
}
async function fetchReddit(q: string): Promise<SearchResult[]> {
  try{ const r=await fetch(NICHE_APIS.reddit(q),{headers:{"User-Agent":"veritas-scraper/1.0"}}); if (!r.ok) return []; const j=await r.json(); return (j.data?.children||[]).slice(0,10).map((c:any)=>({ title:c.data.title, url:`https://reddit.com${c.data.permalink}`, snippet:(c.data.selftext||"").slice(0,300), source:`reddit-r/${c.data.subreddit}`, relevanceScore: Math.min(1,0.4+(c.data.score||0)/500) })); }catch{ return []; }
}
async function fetchSemanticScholar(q: string): Promise<SearchResult[]> {
  try{ const r=await fetch(NICHE_APIS.semanticscholar(q)); if (!r.ok) return []; const j=await r.json(); return (j.data||[]).slice(0,10).map((p:any)=>({ title:p.title, url:p.url, snippet:(p.abstract||"").slice(0,400), source:"semantic-scholar", relevanceScore: Math.min(1,0.6+(p.citationCount||0)/500), publishedAt:p.year?String(p.year):undefined })); }catch{ return []; }
}
async function fetchCrossref(q: string): Promise<SearchResult[]> {
  try{ const r=await fetch(NICHE_APIS.crossref(q)); if (!r.ok) return []; const j=await r.json(); return (j.message?.items||[]).slice(0,10).map((it:any)=>({ title:(it.title||[""])[0], url:it.URL||(it.DOI?`https://doi.org/${it.DOI}`:""), snippet:(it.abstract||"").replace(/<[^>]*>/g,"").slice(0,400), source:"crossref", relevanceScore: Math.min(1,0.55+(it["is-referenced-by-count"]||0)/300), publishedAt:it.created?.["date-time"] })); }catch{ return []; }
}
async function fetchOpenAlex(q: string): Promise<SearchResult[]> {
  try{ const r=await fetch(NICHE_APIS.openalex(q)); if (!r.ok) return []; const j=await r.json(); return (j.results||[]).slice(0,10).map((w:any)=>({ title:w.title, url:w.doi?`https://doi.org/${w.doi.replace("https://doi.org/","")}`:w.id, snippet:(w.abstract_inverted_index ? Object.keys(w.abstract_inverted_index).slice(0,60).join(" ") : "").slice(0,400), source:"openalex", relevanceScore: Math.min(1,0.55+(w.cited_by_count||0)/500), publishedAt:w.publication_year?String(w.publication_year):undefined })); }catch{ return []; }
}
async function fetchPubMed(q: string): Promise<SearchResult[]> {
  try{ const r=await fetch(NICHE_APIS.pubmed(q)); if (!r.ok) return []; const j=await r.json(); const ids:string[]=j?.esearchresult?.idlist||[]; return ids.slice(0,10).map((id)=>({ title:`PubMed PMID ${id}`, url:`https://pubmed.ncbi.nlm.nih.gov/${id}/`, snippet:"PubMed record — resolve via PMID for abstract", source:"pubmed", relevanceScore:0.7 })); }catch{ return []; }
}
async function fetchGitHub(q: string): Promise<SearchResult[]> {
  try{ const r=await fetch(NICHE_APIS.github(q)); if (!r.ok) return []; const j=await r.json(); return (j.items||[]).slice(0,10).map((it:any)=>({ title:`${it.full_name} — ${it.description||"GitHub repo"}`, url:it.html_url, snippet:(it.description||"").slice(0,300), source:"github", relevanceScore: Math.min(1,0.4+(it.stargazers_count||0)/5000) })); }catch{ return []; }
}
export async function deepScrape(url: string): Promise<ScraperResult> {
  try{ const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) veritas-scraper/2.0",Accept:"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5"}}); if (r.ok){ const html=await r.text(); return parseAndExtract(html,url); } }catch{}
  for (const proxy of PROXY_FLEET){ try{ const r=await fetch(proxy.build(url),{headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",Accept:"text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8","Accept-Language":"en-US,en;q=0.9"}}); if (!r.ok) continue; const html=await r.text(); return parseAndExtract(html,url); }catch{ continue; } }
  throw new Error(`Failed to scrape ${url} — all proxies exhausted`);
}
function parseSearchResults(html: string, engine: string): SearchResult[] {
  const results: SearchResult[]=[]; const titleRegex=/<h3[^>]*>([\s\S]*?)<\/h3>/gi; let m; while((m=titleRegex.exec(html))!==null){ results.push({ title:m[1].replace(/<[^>]*>/g,"").trim(), url:"", snippet:"", source:engine, relevanceScore:0.5 }); } return results;
}
function parseAndExtract(html: string, url: string): ScraperResult {
  const titleMatch=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); const title=titleMatch?titleMatch[1].trim():"Untitled";
  const bodyMatch=html.match(/<body[^>]*>([\s\S]*?)<\/body>/i); const body=bodyMatch?bodyMatch[1]:html;
  const content=body.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,80000);
  const extractedData={ dates: content.match(/\b(19|20)\d{2}\b/g)?.slice(0,100)||[], numbers: content.match(/\b\d+(?:\.\d+)?(?:%|K|M|B|T)?\b/g)?.slice(0,200)||[], entities: content.match(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+\b/g)?.slice(0,100)||[], citations: content.match(/\[\d+\]/g)?.slice(0,100)||[], emails: content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g)?.slice(0,50)||[], urls: content.match(/https?:\/\/[^\s<>"']+/g)?.slice(0,100)||[] };
  let qualityScore=0.4; if (content.length>3000) qualityScore+=0.15; if (content.length>15000) qualityScore+=0.1; if (extractedData.dates.length>5) qualityScore+=0.1; if (extractedData.numbers.length>15) qualityScore+=0.1; if (extractedData.entities.length>8) qualityScore+=0.1; if (extractedData.citations.length>3) qualityScore+=0.05; qualityScore+=trustBoost(url);
  return { url, title, content, extractedData, qualityScore: Math.min(1.0,qualityScore), contentLength: content.length };
}
export const STACK_EXCHANGE_ALL_SITES=STACK_EXCHANGE_SITES;
export { PROXY_FLEET, TRUSTED_DOMAINS };
export * from "./scraper-hardener";
