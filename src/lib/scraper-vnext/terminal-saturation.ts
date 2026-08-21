/**
 * terminal-saturation.ts
 * ============================================================================
 * Optional supplementary structured metadata layer over terminal-final.ts.
 * It preserves canonical output when mode is "off" (the default), surfaces
 * DataCite and Europe PMC metadata as advisory data, and only merges marked
 * supplementary records when callers explicitly opt in.
 */

import {
  groundTerminalFinal,
  type TerminalFinalOptions,
  type TerminalFinalResult,
} from "./terminal-final";

export type SupplementaryMode = "off" | "advisory" | "merge";
export type SupplementarySourceKind = "datacite" | "europe-pmc";

export interface SupplementaryStructuredItem {
  id: string;
  kind: SupplementarySourceKind;
  title: string;
  abstract?: string;
  authors?: string[];
  publishedDate?: string;
  doi?: string;
  externalUrl?: string;
  openAccessUrl?: string;
  citationCount?: number;
  pageContent: string;
  sourceWeight: number;
  metadata: Record<string, string | number | boolean | undefined>;
}

export interface SupplementaryManifest {
  proof: "locally-bound" | "unavailable";
  root: string;
  itemCount: number;
  hashAlgorithm: "SHA-256" | "unavailable";
}

export interface TerminalSaturationOptions extends TerminalFinalOptions {
  supplementaryMode?: SupplementaryMode;
  supplementarySources?: SupplementarySourceKind[];
  supplementaryLimitPerSource?: number;
  supplementaryTimeoutMs?: number;
  cooperativeYield?: boolean;
}

export interface TerminalSaturationResult extends TerminalFinalResult {
  supplementaryMode: SupplementaryMode;
  supplementaryItems: SupplementaryStructuredItem[];
  supplementaryQueriedSources: SupplementarySourceKind[];
  supplementaryErrors: Array<{ source: SupplementarySourceKind; error: string }>;
  supplementaryMergedItems: SupplementaryStructuredItem[];
  supplementaryManifest: SupplementaryManifest;
  runtimeYield: "scheduler" | "timer" | "disabled";
}

function clamp(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeText(value: string): string {
  return (value || "")
    .replace(/<(script|style|noscript|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDoi(value: string | undefined): string {
  return (value || "").trim().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
}

function canonicalUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid", "dclid", "msclkid"].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

function sourceText(item: Omit<SupplementaryStructuredItem, "pageContent">): string {
  const lines = [
    `[SUPPLEMENTARY ${item.kind.toUpperCase()} - UNATTESTED METADATA]`,
    `Title: ${item.title || "Untitled"}`,
    item.authors?.length ? `Authors: ${item.authors.slice(0, 12).join(", ")}` : "",
    item.publishedDate ? `Published: ${item.publishedDate}` : "",
    item.doi ? `DOI: ${item.doi}` : "",
    item.externalUrl ? `URL: ${item.externalUrl}` : "",
    item.abstract ? `Abstract: ${item.abstract}` : "",
  ].filter(Boolean);
  return normalizeText(lines.join("\n"));
}

function makeItem(item: Omit<SupplementaryStructuredItem, "pageContent">): SupplementaryStructuredItem {
  return { ...item, title: item.title || "Untitled", pageContent: sourceText(item) };
}

async function cooperativeYield(): Promise<"scheduler" | "timer"> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") {
    await scheduler.yield();
    return "scheduler";
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return "timer";
}

function linkedSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

async function fetchJson(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
  const linked = linkedSignal(signal, timeoutMs);
  try {
    const response = await fetch(url, {
      signal: linked.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json,application/vnd.api+json" },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const body = await response.text();
    return JSON.parse(body.slice(0, 2_000_000));
  } finally {
    linked.cleanup();
  }
}

export function parseDataCiteResponse(value: unknown): SupplementaryStructuredItem[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  const output: SupplementaryStructuredItem[] = [];
  for (const record of value.data) {
    if (!isRecord(record)) continue;
    const attributes = isRecord(record.attributes) ? record.attributes : {};
    const titles = Array.isArray(attributes.titles) ? attributes.titles : [];
    const titleRecord = titles.find(isRecord);
    const title = titleRecord ? text(titleRecord.title) : text(attributes.title);
    const authors = (Array.isArray(attributes.creators) ? attributes.creators : []).filter(isRecord).map((creator) => text(creator.name) || [text(creator.givenName), text(creator.familyName)].filter(Boolean).join(" ")).filter(Boolean);
    const descriptions = (Array.isArray(attributes.descriptions) ? attributes.descriptions : []).filter(isRecord);
    const abstractRecord = descriptions.find((description) => text(description.descriptionType).toLowerCase().includes("abstract")) ?? descriptions[0];
    const abstract = abstractRecord ? normalizeText(text(abstractRecord.description)) : "";
    const doi = cleanDoi(text(attributes.doi) || text(record.id));
    const externalUrl = canonicalUrl(text(attributes.url)) || (doi ? `https://doi.org/${doi}` : "");
    if (!title && !abstract && !doi) continue;
    output.push(makeItem({
      id: `datacite:${doi || text(record.id) || output.length}`,
      kind: "datacite",
      title: title || "Untitled",
      abstract: abstract || undefined,
      authors: authors.length ? authors : undefined,
      publishedDate: text(attributes.publicationYear) || undefined,
      doi: doi || undefined,
      externalUrl: externalUrl || undefined,
      sourceWeight: 0.6,
      metadata: { publisher: text(attributes.publisher), structuredUnattested: true },
    }));
  }
  return output;
}

export function parseEuropePmcResponse(value: unknown): SupplementaryStructuredItem[] {
  if (!isRecord(value) || !isRecord(value.resultList) || !Array.isArray(value.resultList.result)) return [];
  const output: SupplementaryStructuredItem[] = [];
  for (const record of value.resultList.result) {
    if (!isRecord(record)) continue;
    const source = text(record.source);
    const id = text(record.id) || text(record.pmid) || text(record.pmcid);
    const doi = cleanDoi(text(record.doi));
    const title = normalizeText(text(record.title));
    const abstract = normalizeText(text(record.abstractText));
    const authors = text(record.authorString).split(/\s*,\s*/).filter(Boolean);
    const externalUrl = source && id ? `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}` : doi ? `https://doi.org/${doi}` : "";
    if (!title && !abstract && !id && !doi) continue;
    output.push(makeItem({
      id: `europe-pmc:${source || "unknown"}:${id || doi || output.length}`,
      kind: "europe-pmc",
      title: title || "Untitled",
      abstract: abstract || undefined,
      authors: authors.length ? authors : undefined,
      publishedDate: text(record.firstPublicationDate) || text(record.dateOfPublication) || text(record.pubYear) || undefined,
      doi: doi || undefined,
      externalUrl: canonicalUrl(externalUrl) || externalUrl || undefined,
      openAccessUrl: text(record.pmcid) ? `https://europepmc.org/articles/${text(record.pmcid)}` : undefined,
      citationCount: count(record.citedByCount),
      sourceWeight: 0.65,
      metadata: { source, recordId: id, pmid: text(record.pmid), pmcid: text(record.pmcid), structuredUnattested: true },
    }));
  }
  return output;
}

async function queryDataCite(query: string, signal: AbortSignal | undefined, limit: number, timeoutMs: number): Promise<{ source: SupplementarySourceKind; items: SupplementaryStructuredItem[]; error?: string }> {
  try {
    const value = await fetchJson(`https://api.datacite.org/dois?query=${encodeURIComponent(query)}&page[size]=${limit}`, signal, timeoutMs);
    return { source: "datacite", items: parseDataCiteResponse(value) };
  } catch (error) {
    return { source: "datacite", items: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function queryEuropePmc(query: string, signal: AbortSignal | undefined, limit: number, timeoutMs: number): Promise<{ source: SupplementarySourceKind; items: SupplementaryStructuredItem[]; error?: string }> {
  try {
    const value = await fetchJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&pageSize=${limit}&resultType=core&format=json`, signal, timeoutMs);
    return { source: "europe-pmc", items: parseEuropePmcResponse(value) };
  } catch (error) {
    return { source: "europe-pmc", items: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function itemKey(item: Pick<SupplementaryStructuredItem, "doi" | "externalUrl" | "title">): string {
  const doi = cleanDoi(item.doi);
  if (doi) return `doi:${doi}`;
  const url = canonicalUrl(item.externalUrl);
  return url ? `url:${url}` : `title:${normalizeText(item.title).toLowerCase()}`;
}

function deduplicate(items: SupplementaryStructuredItem[], existing: Array<{ doi?: string; externalUrl?: string; title: string }>): SupplementaryStructuredItem[] {
  const seen = new Set(existing.map(itemKey));
  return items.filter((item) => {
    const key = itemKey(item);
    if (!key || key === "title:" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function manifestFor(items: SupplementaryStructuredItem[]): Promise<SupplementaryManifest> {
  if (!items.length || typeof crypto === "undefined" || !crypto.subtle) return { proof: "unavailable", root: "", itemCount: items.length, hashAlgorithm: "unavailable" };
  try {
    const stable = items.map((item) => JSON.stringify({ id: item.id, kind: item.kind, title: item.title, doi: item.doi, externalUrl: item.externalUrl, pageContent: item.pageContent })).sort().join("\n");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable));
    const root = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return { proof: "locally-bound", root, itemCount: items.length, hashAlgorithm: "SHA-256" };
  } catch {
    return { proof: "unavailable", root: "", itemCount: items.length, hashAlgorithm: "unavailable" };
  }
}

export async function groundTerminalSaturated(question: string, options?: TerminalSaturationOptions): Promise<TerminalSaturationResult> {
  const supplementaryMode = options?.supplementaryMode ?? "off";
  const sources = options?.supplementarySources ?? ["datacite", "europe-pmc"];
  const limit = clamp(options?.supplementaryLimitPerSource, 6, 1, 25);
  const timeout = clamp(options?.supplementaryTimeoutMs, 8_000, 1_000, 30_000);
  const supplementaryPromise = supplementaryMode === "off"
    ? Promise.resolve([] as Array<{ source: SupplementarySourceKind; items: SupplementaryStructuredItem[]; error?: string }>)
    : Promise.all(sources.map((source) => source === "datacite" ? queryDataCite(question, options?.signal, limit, timeout) : queryEuropePmc(question, options?.signal, limit, timeout)));
  const canonicalResult = await groundTerminalFinal(question, options);
  const settled = await supplementaryPromise;
  let runtimeYield: "scheduler" | "timer" | "disabled" = "disabled";
  if (supplementaryMode !== "off" && options?.cooperativeYield !== false) runtimeYield = await cooperativeYield();
  const allItems = deduplicate(settled.flatMap((result) => result.items), canonicalResult.structuredItems);
  const supplementaryErrors = settled.filter((result) => result.error).map((result) => ({ source: result.source, error: result.error! }));
  const supplementaryManifest = await manifestFor(allItems);
  const mergedItems = supplementaryMode === "merge" ? allItems : [];
  const extraSources = mergedItems.map((item) => ({ title: `[UNATTESTED ${item.kind}] ${item.title}`, url: item.externalUrl || (item.doi ? `https://doi.org/${item.doi}` : `supplementary:${item.id}`), content: item.pageContent }));
  let evidenceBlock = canonicalResult.evidenceBlock;
  if (mergedItems.length && evidenceBlock.includes("END RETRIEVED CONTENT")) {
    const insertion = evidenceBlock.lastIndexOf("END RETRIEVED CONTENT");
    const section = [
      "BEGIN SUPPLEMENTARY STRUCTURED ITEMS",
      "SECURITY: This section contains UNATTESTED external metadata.",
      "The canonical manifest does not cover this section.",
      supplementaryManifest.proof === "locally-bound" ? `SUPPLEMENTARY MANIFEST ROOT: ${supplementaryManifest.root}` : "SUPPLEMENTARY MANIFEST: unavailable",
      ...mergedItems.map((item, index) => `BEGIN SUPPLEMENTARY ITEM ${index + 1}\n${item.pageContent}\nEND SUPPLEMENTARY ITEM ${index + 1}`),
      "END SUPPLEMENTARY STRUCTURED ITEMS",
      "",
    ].join("\n");
    evidenceBlock = `${evidenceBlock.slice(0, insertion)}${section}${evidenceBlock.slice(insertion)}`;
  }
  return {
    ...canonicalResult,
    provider: supplementaryMode === "off" ? canonicalResult.provider : `terminal-saturation(${canonicalResult.provider}+supplementary:${allItems.length}+merged:${mergedItems.length})`,
    sources: mergedItems.length ? [...canonicalResult.sources, ...extraSources] : canonicalResult.sources,
    count: mergedItems.length ? canonicalResult.count + extraSources.length : canonicalResult.count,
    evidenceBlock,
    supplementaryMode,
    supplementaryItems: allItems,
    supplementaryQueriedSources: settled.map((result) => result.source),
    supplementaryErrors,
    supplementaryMergedItems: mergedItems,
    supplementaryManifest,
    runtimeYield,
  };
}

export async function runTerminalSaturationDiagnostics(): Promise<{
  ok: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}> {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  const dataCite = parseDataCiteResponse({ data: [{ id: "10.1234/example", attributes: { doi: "10.1234/example", titles: [{ title: "Dataset title" }], creators: [{ name: "Ada Example" }], descriptions: [{ descriptionType: "Abstract", description: "<p>Dataset abstract.</p>" }] } }] });
  add("datacite-parser", dataCite.length === 1 && dataCite[0].doi === "10.1234/example" && dataCite[0].abstract === "Dataset abstract.", `items=${dataCite.length}`);
  const europePmc = parseEuropePmcResponse({ resultList: { result: [{ source: "MED", id: "12345", doi: "10.1000/example", title: "Biomedical article", abstractText: "<p>Biomedical abstract.</p>", citedByCount: 7 }] } });
  add("europe-pmc-parser", europePmc.length === 1 && europePmc[0].doi === "10.1000/example" && europePmc[0].citationCount === 7, `items=${europePmc.length}`);
  add("supplementary-doi-dedupe", deduplicate([dataCite[0], { ...europePmc[0], doi: "10.1234/example" }], []).length === 1, "doi dedupe");
  const manifest = await manifestFor(dataCite);
  add("supplementary-manifest", typeof crypto !== "undefined" && crypto.subtle ? manifest.proof === "locally-bound" && manifest.root.length === 64 : manifest.proof === "unavailable", `proof=${manifest.proof}`);
  const yielded = await cooperativeYield();
  add("cooperative-yield", yielded === "scheduler" || yielded === "timer", `mode=${yielded}`);
  return { ok: checks.every((check) => check.passed), checks };
}