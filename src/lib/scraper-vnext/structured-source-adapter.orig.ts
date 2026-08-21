/**
 * structured-source-adapter.ts
 * ============================================================================
 * ADDITIVE — composes over canonical retrieval-policy-augments.ts +
 * retrieval-control-plane.ts without modifying any existing file.
 */

import type { CrawlPayload, ScheduleContext, RetrievalPolicy } from "./retrieval-control-plane";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type StructuredSourceKind =
  | "openalex"
  | "crossref"
  | "semantic-scholar"
  | "pubmed"
  | "arxiv"
  | "wikipedia"
  | "internet-archive"
  | "rss-atom"
  | "partial-spa"
  | "none";

export interface StructuredItem {
  kind: StructuredSourceKind;
  title: string;
  abstract?: string;
  authors?: string[];
  publishedDate?: string;
  doi?: string;
  externalUrl?: string;
  openAccessUrl?: string;
  citationCount?: number;
  pageContent: string;
  markdown: string;
  metadata: Record<string, string | number | boolean | undefined>;
  confidence: number;
}

export interface StructuredQueryResult {
  kind: StructuredSourceKind;
  items: StructuredItem[];
  apiUrl: string;
  totalAvailable?: number;
}

export interface StructuredAdapterOptions {
  signal?: AbortSignal;
  limitPerSource?: number;
  sources?: StructuredSourceKind[];
  openAlexApiKey?: string;
  deduplicate?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOMAIN ROUTING
// ═══════════════════════════════════════════════════════════════════════════

const STRUCTURED_DOMAINS: Record<string, StructuredSourceKind> = {
  "arxiv.org":                  "arxiv",
  "export.arxiv.org":           "arxiv",
  "openalex.org":               "openalex",
  "api.openalex.org":           "openalex",
  "crossref.org":               "crossref",
  "api.crossref.org":           "crossref",
  "doi.org":                    "crossref",
  "semanticscholar.org":        "semantic-scholar",
  "api.semanticscholar.org":    "semantic-scholar",
  "pubmed.ncbi.nlm.nih.gov":    "pubmed",
  "ncbi.nlm.nih.gov":           "pubmed",
  "eutils.ncbi.nlm.nih.gov":    "pubmed",
  "en.wikipedia.org":           "wikipedia",
  "wikipedia.org":              "wikipedia",
  "archive.org":                "internet-archive",
  "scholar.archive.org":        "internet-archive",
};

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

export function detectStructuredSource(url: string): StructuredSourceKind {
  const host = hostOf(url);
  if (STRUCTURED_DOMAINS[host]) return STRUCTURED_DOMAINS[host];
  for (const [suffix, kind] of Object.entries(STRUCTURED_DOMAINS)) {
    if (host.endsWith("." + suffix)) return kind;
  }
  return "none";
}

// ═══════════════════════════════════════════════════════════════════════════
// POLITE-FETCH
// ═══════════════════════════════════════════════════════════════════════════

const API_LAST_CALL = new Map<string, number>();
const API_MIN_INTERVAL_MS = 1_000;

async function politeFetch(url: string, signal?: AbortSignal, accept = "application/json"): Promise<Response | null> {
  const apiHost = hostOf(url);
  const last = API_LAST_CALL.get(apiHost) ?? 0;
  const wait = Math.max(0, last + API_MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  API_LAST_CALL.set(apiHost, Date.now());
  try {
    const res = await fetch(url, {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: accept },
    });
    return res.ok ? res : null;
  } catch { return null; }
}

async function politeJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const res = await politeFetch(url, signal, "application/json");
  if (!res) return null;
  try { return (await res.json()) as T; } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

function safeString(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x) => safeString(x)).join(", ");
  return fallback;
}

function buildPageContent(item: Omit<StructuredItem, "pageContent" | "markdown">): string {
  const lines: string[] = [];
  if (item.title) lines.push(`# ${item.title}`);
  if (item.authors?.length) lines.push(`Authors: ${item.authors.slice(0, 6).join(", ")}`);
  if (item.publishedDate) lines.push(`Published: ${item.publishedDate}`);
  if (item.doi) lines.push(`DOI: https://doi.org/${item.doi}`);
  if (item.externalUrl) lines.push(`URL: ${item.externalUrl}`);
  if (item.openAccessUrl && item.openAccessUrl !== item.externalUrl) {
    lines.push(`Open Access: ${item.openAccessUrl}`);
  }
  if (item.citationCount != null) lines.push(`Citations: ${item.citationCount}`);
  if (item.abstract) lines.push(`\n## Abstract\n\n${item.abstract}`);
  return lines.join("\n").trim();
}

function makeItem(
  kind: StructuredSourceKind,
  partial: Omit<StructuredItem, "pageContent" | "markdown" | "kind" | "confidence">,
  confidence = 0.85,
): StructuredItem {
  const full = { ...partial, kind, confidence, pageContent: "", markdown: "" } as StructuredItem;
  full.pageContent = buildPageContent(full);
  full.markdown = full.pageContent;
  return full;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTERS
// ═══════════════════════════════════════════════════════════════════════════

export async function queryCrossref(query: string, opts?: { signal?: AbortSignal; limit?: number }): Promise<StructuredQueryResult> {
  const limit = Math.min(opts?.limit ?? 8, 20);
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&mailto=oss-rcp@example.com`;
  const data = await politeJson<{ message?: { items?: any[]; "total-results"?: number } }>(url, opts?.signal);
  if (!data?.message?.items) return { kind: "crossref", items: [], apiUrl: url };
  const items = data.message.items.map((w) => makeItem("crossref", {
    title: (w.title ?? ["Untitled"])[0],
    abstract: w.abstract ? w.abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : undefined,
    authors: (w.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(" ")),
    publishedDate: (w["published-print"] ?? w["published-online"])?.["date-parts"]?.[0]?.filter(Boolean).join("-"),
    doi: w.DOI,
    externalUrl: w.URL ?? (w.DOI ? `https://doi.org/${w.DOI}` : undefined),
    citationCount: w["is-referenced-by-count"],
    metadata: { doi: w.DOI, citations: w["is-referenced-by-count"] },
  }));
  return { kind: "crossref", items, apiUrl: url, totalAvailable: data.message["total-results"] };
}

export async function querySemanticScholar(query: string, opts?: { signal?: AbortSignal; limit?: number }): Promise<StructuredQueryResult> {
  const limit = Math.min(opts?.limit ?? 8, 20);
  const fields = "paperId,title,abstract,year,authors,externalIds,openAccessPdf,citationCount,url";
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
  const data = await politeJson<{ data?: any[]; total?: number }>(url, opts?.signal);
  if (!data?.data) return { kind: "semantic-scholar", items: [], apiUrl: url };
  const items = data.data.map((p) => makeItem("semantic-scholar", {
    title: p.title ?? "Untitled",
    abstract: p.abstract,
    authors: (p.authors ?? []).map((a: any) => a.name ?? "").filter(Boolean),
    publishedDate: p.year ? String(p.year) : undefined,
    doi: p.externalIds?.DOI,
    externalUrl: p.url ?? (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : undefined),
    openAccessUrl: p.openAccessPdf?.url,
    citationCount: p.citationCount,
    metadata: { paperId: p.paperId, arxivId: p.externalIds?.ArXiv },
  }));
  return { kind: "semantic-scholar", items, apiUrl: url, totalAvailable: data.total };
}

export function invertedIndexToText(inv: Record<string, number[]> | undefined): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) if (p < 10_000) words[p] = word;
  }
  return words.filter(Boolean).join(" ");
}

export async function queryOpenAlex(query: string, opts?: { signal?: AbortSignal; limit?: number; apiKey?: string }): Promise<StructuredQueryResult> {
  if (!opts?.apiKey) return { kind: "openalex", items: [], apiUrl: "" };
  const limit = Math.min(opts.limit ?? 8, 25);
  const fields = "id,title,doi,publication_date,authorships,abstract_inverted_index,best_oa_location,cited_by_count";
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&select=${fields}&api_key=${encodeURIComponent(opts.apiKey)}`;
  const data = await politeJson<{ results?: any[]; meta?: { count?: number } }>(url, opts.signal);
  if (!data?.results) return { kind: "openalex", items: [], apiUrl: url };
  const items = data.results.map((w) => {
    const oaUrl = w.best_oa_location?.pdf_url ?? w.best_oa_location?.landing_page_url;
    return makeItem("openalex", {
      title: w.title ?? "Untitled",
      abstract: invertedIndexToText(w.abstract_inverted_index) || undefined,
      authors: (w.authorships ?? []).map((a: any) => a.author?.display_name ?? "").filter(Boolean),
      publishedDate: w.publication_date,
      doi: w.doi?.replace(/^https?:\/\/doi\.org\//, ""),
      externalUrl: w.doi ?? w.id,
      openAccessUrl: oaUrl,
      citationCount: w.cited_by_count,
      metadata: { openalexId: w.id, hasOA: !!oaUrl },
    }, 0.90);
  });
  return { kind: "openalex", items, apiUrl: url, totalAvailable: data.meta?.count };
}

export async function queryPubMed(query: string, opts?: { signal?: AbortSignal; limit?: number }): Promise<StructuredQueryResult> {
  const limit = Math.min(opts?.limit ?? 8, 20);
  const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json`;
  const esearch = await politeJson<{ esearchresult?: { idlist?: string[]; count?: string } }>(esearchUrl, opts?.signal);
  const ids = esearch?.esearchresult?.idlist ?? [];
  if (!ids.length) return { kind: "pubmed", items: [], apiUrl: esearchUrl };
  const esummaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
  const summary = await politeJson<{ result?: Record<string, any> }>(esummaryUrl, opts?.signal);
  const result = summary?.result ?? {};
  const items = ids.flatMap((id) => {
    const s = result[id]; if (!s) return [];
    return [makeItem("pubmed", {
      title: s.title ?? "Untitled",
      authors: (s.authors ?? []).map((a: any) => a.name ?? "").filter(Boolean),
      publishedDate: (s.sortpubdate ?? s.epubdate)?.split(" ")[0],
      doi: s.elocationid?.startsWith("doi: ") ? s.elocationid.slice(5) : undefined,
      externalUrl: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      metadata: { pmid: id, journal: s.fulljournalname },
    })];
  });
  return { kind: "pubmed", items, apiUrl: esearchUrl, totalAvailable: esearch?.esearchresult?.count ? Number(esearch.esearchresult.count) : undefined };
}

export async function queryArXiv(query: string, opts?: { signal?: AbortSignal; limit?: number }): Promise<StructuredQueryResult> {
  const limit = Math.min(opts?.limit ?? 8, 20);
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`;
  const res = await politeFetch(url, opts?.signal, "application/atom+xml,application/xml");
  if (!res) return { kind: "arxiv", items: [], apiUrl: url };
  const xml = await res.text(); if (typeof DOMParser === "undefined") return { kind: "arxiv", items: [], apiUrl: url };
  let doc: Document; try { doc = new DOMParser().parseFromString(xml, "application/xml"); } catch { return { kind: "arxiv", items: [], apiUrl: url }; }
  const ns = "http://www.w3.org/2005/Atom";
  const entries = Array.from(doc.getElementsByTagNameNS(ns, "entry"));
  const items = entries.map((e) => {
    const get = (tag: string) => e.getElementsByTagNameNS(ns, tag)[0]?.textContent?.trim() ?? "";
    const links = Array.from(e.getElementsByTagNameNS(ns, "link"));
    const pdfLink = links.find((l) => l.getAttribute("title") === "pdf")?.getAttribute("href") ?? "";
    const absLink = links.find((l) => l.getAttribute("rel") === "alternate")?.getAttribute("href") ?? "";
    const authors = Array.from(e.getElementsByTagNameNS(ns, "author")).map((a) => a.getElementsByTagNameNS(ns, "name")[0]?.textContent?.trim() ?? "").filter(Boolean);
    const arXivId = get("id").split("/abs/").pop() ?? "";
    return makeItem("arxiv", { title: get("title").replace(/\s+/g, " "), abstract: get("summary").replace(/\s+/g, " "), authors: authors.length ? authors : undefined, publishedDate: get("published").slice(0, 10), externalUrl: absLink || (arXivId ? `https://arxiv.org/abs/${arXivId}` : undefined), openAccessUrl: pdfLink || (arXivId ? `https://arxiv.org/pdf/${arXivId}` : undefined), metadata: { arxivId: arXivId } });
  });
  return { kind: "arxiv", items, apiUrl: url };
}

export async function queryWikipedia(query: string, opts?: { signal?: AbortSignal; limit?: number }): Promise<StructuredQueryResult> {
  const limit = Math.min(opts?.limit ?? 5, 10);
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&srprop=snippet&format=json&origin=*`;
  const data = await politeJson<{ query?: { search?: any[] } }>(searchUrl, opts?.signal);
  if (!data?.query?.search) return { kind: "wikipedia", items: [], apiUrl: searchUrl };
  const items = await Promise.all(data.query.search.map(async (s) => {
    const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(s.title ?? "")}&prop=extracts&exintro&explaintext&exsentences=10&format=json&origin=*`;
    const ext = await politeJson<{ query?: { pages?: Record<string, any> } }>(extractUrl, opts?.signal);
    const page = Object.values(ext?.query?.pages ?? {})[0] as any;
    return makeItem("wikipedia", { title: s.title ?? "Untitled", abstract: page?.extract || (s.snippet ?? "").replace(/<[^>]+>/g, ""), externalUrl: page?.canonicalurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title ?? "")}`, metadata: { pageid: s.pageid } }, 0.80);
  }));
  return { kind: "wikipedia", items, apiUrl: searchUrl };
}

export async function queryInternetArchive(query: string, opts?: { signal?: AbortSignal; limit?: number }): Promise<StructuredQueryResult> {
  const limit = Math.min(opts?.limit ?? 8, 25);
  const url = `https://scholar.archive.org/search?q=${encodeURIComponent(query)}&limit=${limit}&format=json`;
  const data = await politeJson<{ results?: any[]; count_found?: number }>(url, opts?.signal);
  if (!data?.results) return { kind: "internet-archive", items: [], apiUrl: url };
  const items = data.results.map((r) => {
    const b = r.biblio ?? {};
    return makeItem("internet-archive", { title: b.title ?? "Untitled", abstract: r.abstracts?.[0]?.body, authors: b.contributor_raw?.filter(Boolean), publishedDate: b.release_year ? String(b.release_year) : undefined, doi: b.doi, externalUrl: b.release_url ?? (b.doi ? `https://doi.org/${b.doi}` : undefined), metadata: { key: r.key } }, 0.82);
  });
  return { kind: "internet-archive", items, apiUrl: url, totalAvailable: data.count_found };
}

export function extractSpaStructuredData(html: string, sourceUrl: string): StructuredItem | null {
  if (typeof DOMParser === "undefined") return null;
  let doc: Document; try { const safe = html.replace(/<script\b(?![^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " "); doc = new DOMParser().parseFromString(safe, "text/html"); } catch { return null; }
  const ldScripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of ldScripts) {
    try {
      const data = JSON.parse(script.textContent ?? ""); const items = Array.isArray(data) ? data : [data];
      for (const d of items) {
        const type = safeString(d["@type"]).toLowerCase(); if (!["article", "newsarticle", "blogposting", "scholarlyarticle", "webpage"].some((t) => type.includes(t))) continue;
        const title = safeString(d.headline ?? d.name), abstract = safeString(d.description ?? d.abstract ?? d.articleBody).slice(0, 2000);
        const authorRaw = d.author, authors: string[] = [];
        if (Array.isArray(authorRaw)) for (const a of authorRaw) authors.push(safeString(typeof a === "object" ? a?.name ?? a : a));
        else if (authorRaw) authors.push(safeString(typeof authorRaw === "object" ? authorRaw?.name ?? authorRaw : authorRaw));
        if (!title && !abstract) continue;
        return makeItem("partial-spa", { title: title || "Untitled", abstract: abstract || undefined, authors: authors.filter(Boolean), publishedDate: safeString(d.datePublished ?? d.dateCreated), externalUrl: safeString(d.url ?? d.mainEntityOfPage?.["@id"] ?? sourceUrl), doi: safeString(d.sameAs).includes("doi.org") ? safeString(d.sameAs).split("doi.org/")[1] : undefined, metadata: { schemaType: d["@type"], sourceUrl } }, 0.55);
      }
    } catch {}
  }
  const og: Record<string, string> = {}; doc.querySelectorAll("meta[property]").forEach(m => { const p = m.getAttribute("property")||""; if(p.startsWith("og:")) og[p.slice(3)] = m.getAttribute("content")||""; });
  if (og.title || og.description) return makeItem("partial-spa", { title: og.title || doc.querySelector("title")?.textContent?.trim() || "Untitled", abstract: og.description, publishedDate: og["article:published_time"] || undefined, externalUrl: og.url || sourceUrl, metadata: { og_site_name: og.site_name, sourceUrl } }, 0.40);
  return null;
}

export async function structuredSearch(query: string, opts?: StructuredAdapterOptions): Promise<{ items: StructuredItem[]; totalFound: number; queriedSources: StructuredSourceKind[] }> {
  const sources = opts?.sources ?? ["crossref", "semantic-scholar", "arxiv", "pubmed", "wikipedia", "internet-archive"];
  const limit = opts?.limitPerSource ?? 6; const runners: Array<Promise<StructuredQueryResult>> = [];
  if (sources.includes("crossref")) runners.push(queryCrossref(query, { signal: opts?.signal, limit }));
  if (sources.includes("semantic-scholar")) runners.push(querySemanticScholar(query, { signal: opts?.signal, limit }));
  if (sources.includes("arxiv")) runners.push(queryArXiv(query, { signal: opts?.signal, limit }));
  if (sources.includes("pubmed")) runners.push(queryPubMed(query, { signal: opts?.signal, limit }));
  if (sources.includes("wikipedia")) runners.push(queryWikipedia(query, { signal: opts?.signal, limit }));
  if (sources.includes("internet-archive")) runners.push(queryInternetArchive(query, { signal: opts?.signal, limit }));
  if (sources.includes("openalex") && opts?.openAlexApiKey) runners.push(queryOpenAlex(query, { signal: opts?.signal, limit, apiKey: opts.openAlexApiKey }));
  const settled = await Promise.allSettled(runners), seen = new Set<string>(), all: StructuredItem[] = [], queried: StructuredSourceKind[] = [];
  for (const r of settled) { if (r.status !== "fulfilled") continue; queried.push(r.value.kind); for (const item of r.value.items) { const key = item.doi ?? item.externalUrl; if (key && !seen.has(key)) { seen.add(key); all.push(item); } } }
  return { items: all, totalFound: all.length, queriedSources: queried };
}

export function withStructuredSourceInterception<T>(reader: (url: string, ctx: ScheduleContext, policy: RetrievalPolicy) => Promise<CrawlPayload<T>>, adapterOpts?: Pick<StructuredAdapterOptions, "signal" | "openAlexApiKey">): (url: string, ctx: ScheduleContext, policy: RetrievalPolicy) => Promise<CrawlPayload<T>> {
  return async (url, ctx, policy) => {
    const kind = detectStructuredSource(url);
    if (kind !== "none") {
      const item = await resolveStructuredUrl(url, kind, ctx.signal ?? adapterOpts?.signal, adapterOpts?.openAlexApiKey);
      if (item && item.pageContent.length >= 80) return { value: item as unknown as T, text: item.pageContent, markdown: item.markdown, contentType: "text/markdown", canonicalUrl: item.externalUrl ?? url, bytesRead: item.pageContent.length };
    }
    return await reader(url, ctx, policy);
  };
}

async function resolveStructuredUrl(url: string, kind: StructuredSourceKind, signal?: AbortSignal, openAlexApiKey?: string): Promise<StructuredItem | null> {
  try {
    switch (kind) {
      case "arxiv": { const id = new URL(url).pathname.replace(/^\/(?:abs|pdf|html)\//, "").replace(/v\d+$/, ""); return id ? (await queryArXiv(`id:${id}`, { signal, limit: 1 })).items[0] || null : null; }
      case "pubmed": { const pmid = url.match(/\/(\d+)\/?(?:\?|$)/)?.[1]; return pmid ? (await queryPubMed(pmid, { signal, limit: 1 })).items[0] || null : null; }
      case "crossref": { const doi = url.match(/doi\.org\/(.+)$/)?.[1]; return doi ? (await queryCrossref(doi, { signal, limit: 1 })).items[0] || null : null; }
      case "openalex": return openAlexApiKey ? (await queryOpenAlex(url, { signal, limit: 1, apiKey: openAlexApiKey })).items[0] || null : null;
      case "semantic-scholar": return (await querySemanticScholar(url, { signal, limit: 1 })).items[0] || null;
      case "wikipedia": { const title = decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, "")); return (await queryWikipedia(title, { signal, limit: 1 })).items[0] || null; }
      case "internet-archive": return (await queryInternetArchive(url, { signal, limit: 1 })).items[0] || null;
      default: return null;
    }
  } catch { return null; }
}
