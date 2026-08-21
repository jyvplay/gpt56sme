/**
 * Vanguard remains useful for atoms/diagnostics, but v15-grounding converts
 * every accepted claim into `source-N`. Until that mapper exposes real URLs,
 * this wrapper forbids Vanguard from terminating the grounding chain.
 */
export * from "./vanguard-titanium.orig";

import { vanguardGround as packageVanguardGround } from "./vanguard-titanium.orig";
import { hardenRetrievalQuery } from "@/lib/debug/retrieval-hardener";

export async function vanguardGround(...args: Parameters<typeof packageVanguardGround>): Promise<Awaited<ReturnType<typeof packageVanguardGround>>> {
  const [query, opts] = args;
  const hardened = hardenRetrievalQuery(String(query), "general");
  const result: any = await packageVanguardGround(hardened.query, opts);
  try { opts?.onDebug?.(`workspace-yield-gate: vanguard terminal acceptance disabled; ${result?.tokenBudget?.claimsPacked ?? 0} atoms / ${result?.tokenBudget?.sourcesPacked ?? 0} sources; forcing URL-bearing fallthrough`); } catch {}
  return { ...result, ok: false, workspaceYieldRejected: true };
}
