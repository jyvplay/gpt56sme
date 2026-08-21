/**
 * Adversarial Engine — persistent workspace override (Vite interceptor pattern).
 *
 * ROOT-CAUSE FINDING (deep audit of the REAL production pipeline, not just
 * the V15 calibration engine): `runStructuralGates()` — the deterministic,
 * zero-LLM-call gate used by EVERY quality checkpoint in the app —
 * (ChatApp.tsx standard single-pass path, lib/pipeline.ts's 4-Stage Stage 3.5
 * routing for BOTH the large-draft OOM-guard branch and the standard branch,
 * lib/n-deep.ts's per-pass critique step, AND the V15 calibration engine's
 * adversarial preview) had ZERO gate for mid-sentence truncation, hanging
 * connectors/hyphens, or unclosed code fences at the end of a draft.
 *
 * This means a truncated answer with no OTHER defect (no placeholders, no
 * empty NIH sections, no citation bleed) would score a clean "pass" verdict
 * and ship to the user as-is — even though `detectTruncation()` already
 * existed and was proven effective inside the V15 engine. It was simply never
 * wired into the shared adversarial gate that the REAL production pipeline
 * actually uses. This is very likely a primary contributor to "answers not as
 * good as before": the single most severe answer defect (an incomplete
 * response) had no detector in the pipeline everyone actually uses.
 *
 * Fix: add ONE new deterministic gate (GATE-TRUNCATED-*) to the shared
 * `runStructuralGates()` used everywhere, so truncation is caught for free
 * (no LLM call) at every quality checkpoint across BOTH the real production
 * pipeline and the calibration engine. Purely additive — nothing removed,
 * all existing gates, personas, and repair flows are untouched.
 */
export * from "./adversarial-engine.base";
import {
  runStructuralGates as baseRunStructuralGates,
  runAdversarialRedTeam as baseRunAdversarialRedTeam,
  type Defect,
  type AdversarialReport,
} from "./adversarial-engine.base";
import type { GenerateParams } from "@/lib/models";

/** Deterministic, zero-LLM-call truncation gate — mirrors the proven
 *  `detectTruncation()` logic from the V15 engine so both systems agree on
 *  what "complete" means. Returns the single most-relevant defect, or null. */
function detectTruncationDefect(text: string): Defect | null {
  const t = (text || "").trim();
  if (t.length === 0) {
    return { id: "GATE-TRUNCATED-EMPTY", severity: "critical", category: "Completeness", detail: "The draft is empty — regenerate a complete answer." };
  }
  const lastLine = t.slice(t.lastIndexOf("\n") + 1).trim();
  const danglingHyphen = /[-\u2013\u2014]\s*$/.test(lastLine) || /\\times\s*$/.test(lastLine);
  const danglingConnector = /[,;:]\s*$|\b(and|or|but|the|a|an|to|of|with|for|in|on|as|by|that|which|because|however|therefore|thus|since|while|where|when|is|are|was|were)\s*$/i.test(lastLine);
  const openFence = (t.match(/```/g) ?? []).length % 2 !== 0;
  const openMath = (t.match(/\$\$/g) ?? []).length % 2 !== 0;
  const noTerminal = !/[.!?)"'\u00bb\u201d\]\}`]\s*$/.test(lastLine) && !/^[#>|*\-+\d]/.test(lastLine) && /\w$/.test(lastLine) && lastLine.length > 0;

  if (danglingHyphen) return { id: "GATE-TRUNCATED-HYPHEN", severity: "critical", category: "Completeness", detail: "Draft ends on a hanging hyphen or mid-formula cut-off — regenerate a COMPLETE answer end-to-end, do not stop mid-sentence or mid-formula." };
  if (danglingConnector) return { id: "GATE-TRUNCATED-CONNECTOR", severity: "critical", category: "Completeness", detail: "Draft ends on a dangling connector word (mid-sentence cut-off) — regenerate a COMPLETE answer that finishes every sentence." };
  if (openFence) return { id: "GATE-TRUNCATED-CODEFENCE", severity: "major", category: "Completeness", detail: "Draft has an unclosed code fence (```) — close every code block or remove the dangling fence." };
  if (openMath) return { id: "GATE-TRUNCATED-MATH", severity: "major", category: "Completeness", detail: "Draft has an unclosed math delimiter ($$) — close every math block." };
  if (noTerminal) return { id: "GATE-TRUNCATED-NOTERMINAL", severity: "critical", category: "Completeness", detail: "Final line lacks terminal punctuation (mid-sentence cut-off) — regenerate a COMPLETE answer end-to-end." };
  return null;
}

/** Enhanced structural gates: all original gates PLUS the truncation gate. */
export function runStructuralGates(draft: string, opts?: { domain?: string }): Defect[] {
  const base = baseRunStructuralGates(draft, opts);
  if (base.some(d => d.id.startsWith("GATE-TRUNCATED"))) return base; // already covered upstream
  const trunc = detectTruncationDefect(draft);
  return trunc ? [trunc, ...base] : base;
}

/** Enhanced red-team: guarantees truncation is caught even in the LLM-call-failed
 *  fallback path (base falls back to structural-only gates on red-team error). */
export async function runAdversarialRedTeam(
  draft: string,
  userQuery: string,
  baseParams: GenerateParams,
  opts?: { domain?: string; rpm?: number; onDebug?: (m: string) => void },
): Promise<AdversarialReport> {
  const report = await baseRunAdversarialRedTeam(draft, userQuery, baseParams, opts);
  if (report.defects.some(d => d.id.startsWith("GATE-TRUNCATED"))) return report;
  const trunc = detectTruncationDefect(draft);
  if (!trunc) return report;
  opts?.onDebug?.(`[truncation-gate] ${trunc.id}: ${trunc.detail}`);
  return { ...report, defects: [trunc, ...report.defects], verdict: "revise" };
}
