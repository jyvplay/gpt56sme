/**
 * sentinel-omega.ts
 * ============================================================================
 * Additive canonical Sentinel Omega lane for the portfolio orchestrator.
 * Self-contained omega grounding over Conclave and Sibyl engines.
 */

import { sibylResearch } from "./sibyl-oracle";

export async function groundWithSentinelOmega(
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
    const sibyl = await sibylResearch(query, opts);
    if (sibyl.ok && sibyl.evidenceBlock) {
      return {
        ok: true,
        provider: `sentinel-omega(${sibyl.provider})`,
        evidenceBlock: sibyl.evidenceBlock,
        sources: (sibyl.sources || []).map((s) => ({
          title: s.title || "Untitled",
          url: s.canonicalUrl || s.url,
          content: s.contentSample || "",
        })),
        claims: sibyl.claims || [],
        counts: { supported: sibyl.sources?.length || 0 },
      };
    }
  } catch (e) {
    opts?.onDebug?.(`sentinel-omega sibyl fail: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    ok: false,
    provider: "sentinel-omega(unresolved)",
    evidenceBlock: "",
    sources: [],
    claims: [],
    counts: {},
  };
}
