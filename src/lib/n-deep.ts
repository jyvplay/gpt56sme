/**
 * N-Deep — persistent workspace override (Vite interceptor pattern).
 *
 * The base `runNDeep()` (real production adversarial refinement engine, used
 * directly by ChatApp.tsx's "⚡ N-Deep" toggle AND by lib/pipeline.ts's 4-Stage
 * Stage 3.5 routing) already benefits from the truncation gate added to
 * `./adversarial-engine.ts` (its per-pass critique step now correctly flags a
 * truncated draft as "revise" instead of a false "pass"). This closes most of
 * the truncation-slips-through-N-Deep gap for free.
 *
 * Residual gap: if the pass BUDGET is exhausted (`pass === cap`) while the
 * draft is STILL truncated, the base loop breaks with `stable: false` and
 * returns the truncated text as-is — the caller then ships it unchanged. Per
 * the standing product requirement ("always rewrite, never block/ship a
 * truncated answer"), this wrapper adds ONE bounded completion-repair call
 * that fires ONLY in that rare residual case, and is REJECTED (original text
 * kept) unless the repair is both longer and verifiably non-truncated —
 * a strict, monotonic, never-regress safety net. Purely additive: passes,
 * totalLlmCalls, fullRewrites, and the entire section-splice/tie-break/
 * core-rewrite algorithm are completely untouched.
 */
export * from "./n-deep.base";
import { runNDeep as baseRunNDeep, type NDeepOpts, type NDeepResult } from "./n-deep.base";
import { generateSynthesizedResponse } from "@/lib/models";
import { detectTruncation } from "./v15-pipeline";

const MAX_REPAIR_DRAFT_CHARS = 20_000; // matches the established convention in lib/pipeline.ts's own repair prompts

export async function runNDeep(opts: NDeepOpts): Promise<NDeepResult> {
  const result = await baseRunNDeep(opts);
  const trunc = detectTruncation(result.finalText, { longForm: !!opts.fullSloopReport });
  if (!trunc.truncated) return result;

  opts.onDebug?.(`[N-Deep completion-guard] final draft still truncated after ${result.passes.length} pass(es) (${trunc.reason}) — issuing one bounded completion repair (never regresses; original kept if repair fails)`);
  try {
    const repairPrompt = `The DRAFT below was cut off before completion (${trunc.reason}). Continue writing from EXACTLY where it left off and FINISH it completely — do not restart, do not repeat earlier content, do not summarize what came before. Output the FULL corrected document (original content + your completion), ending on a complete sentence.\n\nUSER ASK: ${opts.userQuery}\n\nDRAFT TO COMPLETE:\n${result.finalText.slice(0, MAX_REPAIR_DRAFT_CHARS)}`;
    const repaired = await generateSynthesizedResponse({
      ...opts.baseParams, userMessage: repairPrompt, retrievedWebData: undefined, conversationHistory: [],
    });
    const repairedTrunc = detectTruncation(repaired, { longForm: !!opts.fullSloopReport });
    if (repaired && repaired.trim().length > result.finalText.length && !repairedTrunc.truncated) {
      opts.onDebug?.(`[N-Deep completion-guard] repair accepted (${result.finalText.length} → ${repaired.trim().length} chars, no longer truncated)`);
      return { ...result, finalText: repaired.trim(), totalLlmCalls: result.totalLlmCalls + 1 };
    }
    opts.onDebug?.(`[N-Deep completion-guard] repair rejected (still truncated or not longer) — keeping original draft, never regressing`);
    return result;
  } catch (e) {
    opts.onDebug?.(`[N-Deep completion-guard] repair call failed: ${(e as Error).message} — keeping original draft`);
    return result;
  }
}
