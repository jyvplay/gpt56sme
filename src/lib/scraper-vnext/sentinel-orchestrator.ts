/**
 * sentinel-orchestrator.ts
 * ============================================================================
 * Additive canonical Sentinel Orchestrator lane for the portfolio orchestrator.
 * Delegates to Arbiter-Omega + Palisade to adjudicate search evidence.
 */

import { arbiterResearch } from "./arbiter-omega";
import { palisadeGround } from "../scraper-palisade/palisade-adjudicator";

export async function sentinelGround(
  query: string,
  opts?: {
    signal?: AbortSignal;
    depth?: number;
    allowJina?: boolean;
    allowPublicProxies?: boolean;
    allowWayback?: boolean;
    onDebug?: (msg: string) => void;
  }
): Promise<{
  ok: boolean;
  provider: string;
  evidenceBlock: string;
  sources: Array<{ title: string; url: string; content: string }>;
  claims: any[];
  counts: Record<string, number>;
}> {
  try {
    const palisade = await palisadeGround(query, opts);
    if (palisade.ok && palisade.evidenceBlock) {
      return {
        ok: true,
        provider: `sentinel-orchestrator(${palisade.provider})`,
        evidenceBlock: palisade.evidenceBlock,
        sources: (palisade as any).sources || [],
        claims: palisade.claims || [],
        counts: (palisade as any).counts || {},
      };
    }
  } catch (e) {
    opts?.onDebug?.(`sentinel-orchestrator palisade fail: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const arb = await arbiterResearch(query, opts);
    return {
      ok: arb.ok,
      provider: `sentinel-orchestrator(${arb.provider})`,
      evidenceBlock: arb.evidenceBlock || "",
      sources: (arb.sources || []).map((s) => ({
        title: s.title || "Untitled",
        url: s.canonicalUrl || s.url,
        content: s.content || "",
      })),
      claims: arb.claims || [],
      counts: {},
    };
  } catch (e) {
    return {
      ok: false,
      provider: "sentinel-orchestrator(failed)",
      evidenceBlock: "",
      sources: [],
      claims: [],
      counts: {},
    };
  }
}
