/** Alias-reachable T0 structured search wrapper. */
export * from "./structured-source-adapter.orig";

import { structuredSearch as packageStructuredSearch } from "./structured-source-adapter.orig";
import { dedupeSources, filterRelevantSourcesAny, hardenRetrievalQuery } from "@/lib/debug/retrieval-hardener";

type StructuredOpts = Parameters<typeof packageStructuredSearch>[1];
type StructuredResult = Awaited<ReturnType<typeof packageStructuredSearch>>;

export async function structuredSearch(query: string, opts?: StructuredOpts): Promise<StructuredResult> {
  const hardened = hardenRetrievalQuery(query, "general");
  const selected = hardened.alternatives.slice(0, 3);
  const results = await Promise.all(
    selected.map((q) => packageStructuredSearch(q.q, opts).catch(() => ({ items: [], totalFound: 0, queriedSources: [] } as StructuredResult)))
  );
  const allItems = dedupeSources(results.flatMap((r) => r.items));
  // Accept if coherent with ANY dispatched facet query; reject only if all say drift.
  const accepted = filterRelevantSourcesAny(allItems, selected, 0.2).accepted;
  return {
    items: accepted,
    totalFound: results.reduce((n, r) => n + Number(r.totalFound ?? 0), 0),
    queriedSources: [...new Set(results.flatMap((r) => r.queriedSources))],
  } as StructuredResult;
}


// [unify.mjs] Explicit type re-exports for Rollup resolution
export type { StructuredItem } from "./structured-source-adapter.orig";


// [unify.mjs] Emergency mocks for symbols lost from package/wrapper
export function buildAmpCacheUrl(url: string): string { return "https://cdn.ampproject.org/c/s/" + url.replace(/^https?:\/\//, ""); }
export async function fetchViaAmpCache(url: string, init?: any): Promise<Response> { return fetch(buildAmpCacheUrl(url), init); }
export async function wrappedStructuredChallengeReader(url: string): Promise<any> { return { url, content: "", title: "Fallback" }; }
