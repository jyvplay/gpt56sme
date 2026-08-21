export * from "./arbiter-omega.orig";

import { arbiterResearch as packageResearch } from "./arbiter-omega.orig";
import { filterRelevantSourcesAny, hardenRetrievalQuery } from "@/lib/debug/retrieval-hardener";

export async function arbiterResearch(...args: Parameters<typeof packageResearch>): Promise<Awaited<ReturnType<typeof packageResearch>>> {
  const [query, opts] = args;
  const h = hardenRetrievalQuery(String(query), "general");
  const result: any = await packageResearch(h.query, opts);
  const gate = filterRelevantSourcesAny(Array.isArray(result?.sources) ? result.sources : [], h.alternatives);
  try { opts?.onDebug?.(`workspace-relevance-gate: arbiter accepted ${gate.accepted.length}, rejected ${gate.rejected.length}`); } catch {}
  return { ...result, sources: gate.accepted, ok: !!result?.ok && gate.accepted.length >= 2 };
}
