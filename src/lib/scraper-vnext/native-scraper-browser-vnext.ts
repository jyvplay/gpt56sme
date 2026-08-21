export * from "./native-scraper-browser-vnext.orig";

import { nativeSearchBrowserVNext as packageSearch } from "./native-scraper-browser-vnext.orig";
import { filterRelevantSourcesAny, hardenRetrievalQuery } from "@/lib/debug/retrieval-hardener";

export async function nativeSearchBrowserVNext(...args: Parameters<typeof packageSearch>): Promise<Awaited<ReturnType<typeof packageSearch>>> {
  const [query, count, onDebug, options] = args;
  const h = hardenRetrievalQuery(String(query), "general");
  const result: any = await packageSearch(h.query, count, onDebug, options);
  const gate = filterRelevantSourcesAny(Array.isArray(result?.results) ? result.results : [], h.alternatives);
  try { onDebug?.(`workspace-relevance-gate: native-vnext accepted ${gate.accepted.length}, rejected ${gate.rejected.length}`); } catch {}
  return { ...result, results: gate.accepted };
}
