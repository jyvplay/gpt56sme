/**
 * Continuation Detector — persistent workspace override (Vite interceptor pattern).
 *
 * Confirmed gap in the REAL production truncation guard used by ChatApp.tsx's
 * final safety net (runs after single-pass, 4-Stage, AND N-Deep paths): the
 * base `diagnoseOutput()` only flags empty trailing sections when >=2 sections
 * are empty AND there are >=3 total headers (`tooManyEmpty`), and separately
 * its `endsAbruptly` check explicitly SKIPS the case where the last line is a
 * heading (`!/^#/.test(...)`) — meaning a draft that ends on a single bare,
 * bodyless section heading (e.g. "## Conclusion" with nothing after it, or any
 * document with fewer than 3 headers total) is silently NOT flagged as
 * truncated, so ChatApp.tsx's continuation-splice repair never engages and the
 * truncated draft ships as final.
 *
 * Fix: purely additive OR-condition — a document whose LAST detected section
 * heading has no body is always truncated, regardless of total header count.
 * The base function's own detection (and its exact reason strings, emptySections
 * list, and endsAbruptly semantics) are called FIRST and returned unchanged
 * whenever it already correctly detects truncation; this override only adds
 * coverage for the case it was missing.
 */
export * from "./continuation-detector.base";
import { diagnoseOutput as baseDiagnoseOutput, type TruncationDiagnosis } from "./continuation-detector.base";

export function diagnoseOutput(text: string): TruncationDiagnosis {
  const base = baseDiagnoseOutput(text);
  if (base.truncated || !text || text.length < 100) return base;

  const lines = text.split("\n");
  let lastHeaderIdx = -1;
  let lastHeaderTitle = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{1,4}\s+(.+)$/) || lines[i].match(/^\*\*(.+?)\*\*\s*$/);
    if (m) { lastHeaderIdx = i; lastHeaderTitle = m[1].trim(); }
  }
  if (lastHeaderIdx === -1) return base;

  const trailingBody = lines.slice(lastHeaderIdx + 1).join(" ").replace(/\s+/g, " ").trim();
  if (trailingBody.length < 40) {
    return {
      truncated: true,
      reason: `trailing section "${lastHeaderTitle}" has no body — draft likely truncated mid-generation`,
      emptySections: [...new Set([...base.emptySections, lastHeaderTitle])],
      endsAbruptly: true,
    };
  }
  return base;
}
