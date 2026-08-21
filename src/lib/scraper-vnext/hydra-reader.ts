export * from "./hydra-reader.orig";

import { hydraGround as packageGround } from "./hydra-reader.orig";
import { filterRelevantSourcesAny, hardenRetrievalQuery } from "@/lib/debug/retrieval-hardener";

export async function hydraGround(...args: Parameters<typeof packageGround>): Promise<Awaited<ReturnType<typeof packageGround>>> {
  const [query, opts] = args;
  const h = hardenRetrievalQuery(String(query), "general");
  const result: any = await packageGround(h.query, opts);
  const gate = filterRelevantSourcesAny(Array.isArray(result?.sources) ? result.sources : [], h.alternatives);
  try { opts?.onDebug?.(`workspace-relevance-gate: hydra accepted ${gate.accepted.length}, rejected ${gate.rejected.length}`); } catch {}
  return { ...result, sources: gate.accepted, count: gate.accepted.length, ok: !!result?.ok && gate.accepted.length >= 2 };
}
