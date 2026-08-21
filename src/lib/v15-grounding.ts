/**
 * Workspace grounding seam (Type B).
 *
 * Package-internal V15 pipeline calls `./v15-grounding` relatively, so this
 * alias seam cannot intercept that main path. It still protects every alias
 * caller (`@/lib/v15-grounding`) and provides the exact same yield assertion
 * used by the debug diagnosis: a successful grounding result must contain at
 * least one resolvable absolute URL. Claim atoms (`source-1`,
 * `vanguard-attested`) are not provenance.
 */
export * from "./v15-grounding.orig";

import { groundQuestion as packageGroundQuestion } from "./v15-grounding.orig";
import { heliosGround } from "@/lib/debug/helios-ground";

type GroundQuestionArgs = Parameters<typeof packageGroundQuestion>[0];
type GroundQuestionResult = Awaited<ReturnType<typeof packageGroundQuestion>>;

function isRealUrl(url: unknown): boolean {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

export async function groundQuestion(opts: GroundQuestionArgs): Promise<GroundQuestionResult> {
  const result = await packageGroundQuestion(opts);
  if (!result?.ok || !Array.isArray((result as any).sources)) return result;

  const sources = (result as any).sources as Array<{ url?: string; title?: string; content?: string }>;
  const realSources = sources.filter((s) => isRealUrl(s.url));
  const rejected = sources.length - realSources.length;

  if (realSources.length === 0) {
    // HELIOS FALLBACK: package lanes produced zero usable URLs.
    // Try browser-native CORS-friendly APIs before giving up.
    try {
      const cleanQ = typeof opts?.question === "string" ? opts.question : "";
      const helios = await heliosGround(cleanQ, { onDebug: opts?.onDebug });
      if (helios.ok && helios.sources.length >= 1) {
        opts?.onDebug?.(`helios-fallback: ${helios.sources.length} source(s) via ${helios.provider}`);
        return {
          ok: true,
          provider: helios.provider,
          count: helios.count,
          sources: helios.sources,
          evidenceBlock: helios.evidenceBlock,
        } as GroundQuestionResult;
      }
    } catch {
      /* helios failed — fall through to EVIDENCE_STARVED */
    }
    return {
      ...(result as any),
      ok: false,
      count: 0,
      sources: [],
      error: `EVIDENCE_STARVED: ${sources.length} atom/proxy source(s), 0 resolvable URL(s)`,
      evidenceBlock:
        `[EVIDENCE_STARVED] Retrieval returned ${sources.length} source-like record(s) but none had an absolute URL. ` +
        `Do not draft confident factual claims for this section; emit an explicit data gap with owner/input.`,
    } as GroundQuestionResult;
  }

  if (rejected > 0) {
    return {
      ...(result as any),
      count: realSources.length,
      sources: realSources,
      evidenceBlock:
        `[GROUNDING_YIELD_ASSERTION] Dropped ${rejected} non-resolvable source record(s); retained ${realSources.length} URL-backed source(s).\n\n` +
        String((result as any).evidenceBlock ?? ""),
    } as GroundQuestionResult;
  }

  return result;
}


// [unify.mjs] Emergency mocks for symbols lost from package/wrapper
export function getTitaniumEgressEnabled(): boolean { try { return localStorage.getItem("veritas.v15.enableTitaniumEgress") === "true"; } catch { return false; } }
export function setTitaniumEgressEnabled(enabled: boolean): void { try { localStorage.setItem("veritas.v15.enableTitaniumEgress", enabled ? "true" : "false"); if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("veritas:titanium-egress-changed", { detail: enabled })); } catch {} }
