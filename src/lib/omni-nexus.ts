/**
 * omni-nexus.ts
 * ============================================================================
 * Additive canonical Omni Nexus endpoint for the portfolio orchestrator.
 * Delegates to Nexus Consensus engine.
 */

import { nexusResearch } from "./scraper-vnext/nexus-consensus";

export async function omniNexusGround(
  opts: {
    query: string;
    depth?: number;
    maxTokens?: number;
    concurrency?: number;
    signal?: AbortSignal;
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
    const nexus = await nexusResearch(opts.query, {
      depth: opts.depth,
      enrichTop: Math.min(opts.depth ?? 5, 5),
      enrichConcurrency: opts.concurrency ?? 3,
      signal: opts.signal,
      allowJina: true,
      allowPublicProxies: true,
      allowWayback: true,
      onDebug: opts.onDebug,
    });
    if (nexus.ok && nexus.evidenceBlock) {
      return {
        ok: true,
        provider: `omni-nexus(${nexus.provider})`,
        evidenceBlock: nexus.evidenceBlock,
        sources: (nexus.sources || []).map((s) => ({
          title: s.title || "Untitled",
          url: s.canonicalUrl || s.url,
          content: s.content || "",
        })),
        claims: (nexus.atoms || []) as any[],
        counts: { supported: nexus.sources?.length || 0 },
      };
    }
  } catch (e) {
    opts.onDebug?.(`omni-nexus fail: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    ok: false,
    provider: "omni-nexus(unresolved)",
    evidenceBlock: "",
    sources: [],
    claims: [],
    counts: {},
  };
}
