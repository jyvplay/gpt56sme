/** Palisade claims are also mapped to `source-N`; force URL-bearing fallthrough. */
export * from "./palisade-adjudicator.orig";

import { palisadeGround as packagePalisadeGround } from "./palisade-adjudicator.orig";
import { hardenRetrievalQuery } from "@/lib/debug/retrieval-hardener";

export async function palisadeGround(...args: Parameters<typeof packagePalisadeGround>): Promise<Awaited<ReturnType<typeof packagePalisadeGround>>> {
  const [query, opts] = args;
  const hardened = hardenRetrievalQuery(String(query), "general");
  const result: any = await packagePalisadeGround(hardened.query, opts);
  try { opts?.onDebug?.(`workspace-provenance-gate: palisade terminal acceptance disabled; ${result?.counts?.attested ?? 0} attested / ${result?.counts?.supported ?? 0} supported; forcing URL-bearing fallthrough`); } catch {}
  return { ...result, ok: false, workspaceProvenanceRejected: true };
}
