export * from "./strata-engine.orig";

import { strataCollect as packageCollect } from "./strata-engine.orig";
import { filterRelevantSourcesAny, hardenRetrievalQuery } from "@/lib/debug/retrieval-hardener";

export async function strataCollect(...args: Parameters<typeof packageCollect>): Promise<Awaited<ReturnType<typeof packageCollect>>> {
  const [query, opts] = args;
  const h = hardenRetrievalQuery(String(query), "general");
  const result: any = await packageCollect(h.query, opts);
  const gate = filterRelevantSourcesAny(Array.isArray(result?.sources) ? result.sources : [], h.alternatives);
  try { opts?.onDebug?.(`workspace-relevance-gate: strata accepted ${gate.accepted.length}, rejected ${gate.rejected.length}`); } catch {}
  return { ...result, sources: gate.accepted, ok: !!result?.ok && gate.accepted.length >= 2 };
}
