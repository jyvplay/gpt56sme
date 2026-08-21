/**
 * retrieval-hardener.ts — shared workspace guard for every alias-reachable lane.
 *
 * The package template query builder slices the first 120 chars of the raw
 * question before the IFL directive. Therefore prompt-envelope injection alone
 * cannot guarantee the lattice reaches a scraper. Lane wrappers call these
 * pure functions at the actual retrieval boundary.
 */
import {
  buildLatticeQueries,
  facetCoherence,
  isLikelyDriftResult,
  type LatticeQuery,
} from "@/lib/debug/intent-lattice";
import { resolveRetrievalQueries } from "@/lib/debug/retrieval-context";

export interface SourceLike {
  url?: string;
  canonicalUrl?: string;
  externalUrl?: string;
  doi?: string;
  title?: string;
  content?: string;
  snippet?: string;
  pageContent?: string;
  abstract?: string;
  articleText?: string;
  contentSample?: string;
  quarantined?: boolean;
  hardQuarantined?: boolean;
}

export function absoluteUrl(source: SourceLike): string {
  const raw = source.canonicalUrl || source.externalUrl || source.url || source.doi || "";
  if (/^10\.\d{4,9}\//.test(raw)) return `https://doi.org/${raw}`;
  return /^https?:\/\//i.test(raw) ? raw : "";
}

export function sourceText(source: SourceLike): string {
  return [
    source.title,
    source.content,
    source.snippet,
    source.pageContent,
    source.abstract,
    source.articleText,
    source.contentSample,
  ].filter(Boolean).join(" ");
}

/** Whole-token, compact query; never character-slices the user input. */
export function hardenRetrievalQuery(query: string, section = "general"): {
  query: string;
  latticeQuery: LatticeQuery;
  alternatives: LatticeQuery[];
} {
  const active = resolveRetrievalQueries(query, section);
  const lattice = active ? null : buildLatticeQueries(query, [section], 3);
  const alternatives = active?.queries.length
    ? active.queries
    : lattice!.queries.length
      ? lattice!.queries
      : [{ q: query.trim(), section, facets: lattice!.facets, axes: [] }];
  return { query: alternatives[0].q, latticeQuery: alternatives[0], alternatives };
}

function hasAxisSignal(query: LatticeQuery, text: string): boolean {
  const hay = text.toLowerCase();
  const axes = new Map<string, string[]>();
  for (const f of query.facets) {
    const toks = f.phrase.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
    axes.set(f.axis, [...(axes.get(f.axis) ?? []), ...toks]);
  }
  const matched = [...axes.entries()].filter(([, toks]) => toks.some((t) => hay.includes(t))).map(([axis]) => axis);
  const domainRequired = axes.has("domain") ? matched.includes("domain") : true;
  return domainRequired && matched.some((axis) => axis !== "domain");
}

function looksLikeMarkupBoilerplate(text: string): boolean {
  const s = text.toLowerCase();
  return /table,\s*caption,\s*tbody/.test(s)
    || /--font-inter|font-family:\s*var\(--font/.test(s)
    || /margin:\s*0;padding:\s*0;border:\s*0/.test(s);
}

/**
 * URL + content + facet coherence gate. `minCoherence` is deliberately low:
 * domain + one object match is enough, but CHAGEE/genome/CSS drift is not.
 */
export function filterRelevantSources<T extends SourceLike>(
  sources: T[],
  latticeQuery: LatticeQuery,
  minCoherence = 0.2,
): { accepted: T[]; rejected: Array<{ source: T; reason: string; coherence: number }> } {
  const accepted: T[] = [];
  const rejected: Array<{ source: T; reason: string; coherence: number }> = [];
  for (const source of sources) {
    const text = sourceText(source);
    const coherence = facetCoherence(latticeQuery, text);
    let reason = "";
    if (source.quarantined || source.hardQuarantined) reason = "upstream-quarantined";
    else if (!absoluteUrl(source)) reason = "non-resolvable-url";
    else if (looksLikeMarkupBoilerplate(text)) reason = "boilerplate";
    else if (text.trim().length < 80) reason = "thin-content";
    else if (!hasAxisSignal(latticeQuery, text) || isLikelyDriftResult(text, latticeQuery) || coherence < minCoherence) reason = "facet-drift";
    if (reason) rejected.push({ source, reason, coherence });
    else accepted.push(source);
  }
  return { accepted, rejected };
}

/** Accept a source if it coheres with ANY dispatched lattice query. */
export function filterRelevantSourcesAny<T extends SourceLike>(
  sources: T[],
  queries: LatticeQuery[],
  minCoherence = 0.2,
): { accepted: T[]; rejected: Array<{ source: T; reason: string; coherence: number }> } {
  const accepted: T[] = [];
  const rejected: Array<{ source: T; reason: string; coherence: number }> = [];
  for (const source of sources) {
    const attempts = queries.map((q) => filterRelevantSources([source], q, minCoherence));
    if (attempts.some((a) => a.accepted.length === 1)) accepted.push(source);
    else {
      const reasons = attempts.flatMap((a) => a.rejected);
      const best = reasons.sort((a, b) => b.coherence - a.coherence)[0];
      rejected.push(best ?? { source, reason: "facet-drift", coherence: 0 });
    }
  }
  return { accepted, rejected };
}

export function dedupeSources<T extends SourceLike>(sources: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const source of sources) {
    const key = absoluteUrl(source).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}
