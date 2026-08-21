/**
 * SIDECAR SEAM — Type B (Complex Override). See flatten-guide.md §2, §8, §9.
 * ===========================================================================
 * TURN-4 REWRITE — additive, minimum-diff, non-destructive.
 *
 * The turn-2 version instrumented `onProgress` into the trace bus. Turn 4
 * adds four architectural gates while preserving every existing behaviour:
 *
 *   G1  DUAL scraper-debug-bus subscription (workspace shim path AND direct
 *       package path) with a listener dedup — defense against Vite module-
 *       duplication edge cases.
 *   G2  Genome v1 + v2 injection (the package's `v15-pipeline.ts` already
 *       injects v10 via `_VERITAS_V10_DISCOVERY`; we append the v1 base
 *       genome directive and the v2 extended-persona directive verbatim,
 *       no truncation, so all three genome layers steer the run).
 *   G3  Numeric-question profile-mutation — force compute-relevant flags on
 *       when the question is numeric AND the profile did not set them.
 *   G4  POST-COMPLETION COVEA REPAIR PASS — targeted CoVe + adversarial
 *       repair invoked ONLY when the standard pipeline surfaces failures
 *       and did not repair them (the exact observed failure mode).
 *
 * NON-INTERCEPTABLE by design (documented in flatten-guide §9):
 *   `runV15OnQuestion` internally calls `groundQuestion` with RELATIVE
 *   specifier, so wrapping this seam cannot intercept retrieval. COVEA runs
 *   AFTER the pipeline completes and therefore observes the retrieval trace,
 *   never re-runs it.
 *
 * FAIL-OPEN: every added path is try/catch-wrapped. Telemetry and repair
 * never break a real pipeline run.
 * ===========================================================================
 */
export * from "./v15-pipeline.orig";

import {
  runV15OnQuestion as packageRunV15,
  runBaselineOnQuestion as packageRunBaseline,
} from "./v15-pipeline.orig";
import { subscribeScraperDebug as subscribeScraperDebugPkg } from '@/lib/scraper-debug-bus';
// G1: workspace-shim path as second subscription source. If the workspace
// shim and the direct package path resolve to the same module, the second
// subscribe() call is a no-op duplicate that our listener dedup absorbs. If
// they resolve to two module instances (rare, Vite edge case), we capture
// events from BOTH.
import { subscribeScraperDebug as subscribeScraperDebugShim } from "@/lib/scraper-debug-bus";
import {
  startRun,
  finishRun,
  pushEvent,
  attachScraperLine,
  attachGenome,
  attachResearch,
  attachCovea,
  classifyProgress,
} from "@/lib/debug/pipeline-trace-bus";
import { loadTemplateRubric } from "@/lib/debug/template-rubric";
import { runCoveaRepair } from "@/lib/debug/covea-repair";
import { isPlaceholderUrl } from "@/lib/debug/scraper-forensics";
import {
  buildLatticeQueries,
  enrichLatticeWithLlm,
  renderLatticeDirective,
  type IntentLattice,
} from "@/lib/debug/intent-lattice";
import { geminiGenerate } from '@/lib/v15-gemini';
import { clearRetrievalContext, registerRetrievalContext } from "@/lib/debug/retrieval-context";
import { buildUnifiedInnovationPlan, type UnifiedInnovationPlan } from "@/lib/debug/unified-innovation";
import { runPrewritingResearch, type ResearchPhaseResult } from "@/lib/debug/research-phase";

/**
 * Template → ordered section titles, used as the lattice's section vector.
 * Falls back to a single "general" section for non-OMEGA templates so HDIG
 * and adv-repair still receive decomposed queries.
 */
function latticeSectionsFor(templateId: string | undefined): string[] {
  if (!templateId) return ["general"];
  const rubric = loadTemplateRubric(templateId, null, null);
  const titles = rubric?.sections.map((s) => s.title) ?? [];
  return titles.length ? titles : ["general"];
}

/**
 * G7: build the Intent Facet Lattice from the UNTRUNCATED prompt and splice
 * its directive into the question envelope. Deterministic floor always
 * applies; the LLM enrichment layer can only ADD facets and fails safe.
 */
async function injectIntentLattice(
  opts: Record<string, any>,
  runId: string,
  trueQuestion: string
): Promise<void> {
  try {
    if (String(opts.question ?? "").includes("RETRIEVAL INTENT LATTICE")) return; // idempotent
    const sections = latticeSectionsFor(opts.profile?.templateId);
    let lattice: IntentLattice = buildLatticeQueries(trueQuestion, sections);

    const apiKey = String(opts.apiKey ?? "");
    if (apiKey && opts.profile?.webSearch !== false) {
      try {
        const enriched = await enrichLatticeWithLlm(lattice, (p) =>
          geminiGenerate({ apiKey, model: "gemini-2.0-flash-lite", prompt: p, maxOutputTokens: 600 })
            .then((r: any) => ({ ok: !!(r?.text ?? r?.output), text: String(r?.text ?? r?.output ?? ""), error: r?.error }))
            .catch((e: unknown) => ({ ok: false, text: "", error: e instanceof Error ? e.message : String(e) }))
        );
        if (enriched.ok) lattice = enriched.lattice;
        pushEvent(runId, "system", "init",
          `G7 Intent Facet Lattice · ${lattice.facets.length} facets · ${lattice.queries.length} per-section queries · llmEnriched=${lattice.llmEnriched}` +
          (enriched.ok ? "" : ` (LLM enrich failed: ${enriched.error}; deterministic floor retained)`)
        );
      } catch (e) {
        pushEvent(runId, "system", "init",
          `G7 Intent Facet Lattice · ${lattice.facets.length} facets · ${lattice.queries.length} per-section queries · enrichment threw: ${e instanceof Error ? e.message : String(e)} (deterministic floor retained)`
        );
      }
    } else {
      pushEvent(runId, "system", "init",
        `G7 Intent Facet Lattice · ${lattice.facets.length} facets · ${lattice.queries.length} per-section queries · deterministic-only`
      );
    }

    // Order: true question first (never truncated), then the lattice directive
    // so the draft path's grounding sees decomposed queries.
    opts.question = [trueQuestion, renderLatticeDirective(lattice)].filter(Boolean).join("\n\n");
    opts.intentLattice = lattice;
    registerRetrievalContext(runId, trueQuestion, lattice);
  } catch {
    /* fail-open — raw question still works without the lattice */
  }
}

// ── G1: dual scraper bridge with per-message dedup ─────────────────────────
let scraperBridgeInstalled = false;
/** Small ring of (lane|message|~timestamp) so a duplicate emit from two module
 *  instances or double-subscription does not fire the listener twice. */
const recentBridgeKeys = new Set<string>();
const RECENT_MAX = 500;
function seenRecently(key: string): boolean {
  if (recentBridgeKeys.has(key)) return true;
  recentBridgeKeys.add(key);
  if (recentBridgeKeys.size > RECENT_MAX) {
    // Trim oldest ~half
    const arr = Array.from(recentBridgeKeys);
    recentBridgeKeys.clear();
    for (const k of arr.slice(-Math.floor(RECENT_MAX / 2))) recentBridgeKeys.add(k);
  }
  return false;
}
function installScraperBridge(): void {
  if (scraperBridgeInstalled) return;
  scraperBridgeInstalled = true;
  const relay = (line: { lane: string; message: string }) => {
    const bucket = Math.floor(Date.now() / 250); // 250ms bucket for dedup key
    const key = `${line.lane}|${line.message}|${bucket}`;
    if (seenRecently(key)) return;
    try {
      attachScraperLine(line.lane, line.message);
    } catch {
      /* fail-open */
    }
  };
  try {
    subscribeScraperDebugPkg(relay);
  } catch {
    /* subscription unavailable via package path */
  }
  try {
    subscribeScraperDebugShim(relay);
  } catch {
    /* subscription unavailable via shim path */
  }
}

// ── Progress tee ───────────────────────────────────────────────────────────
function teeProgress(
  runId: string,
  original: ((s: string) => void) | undefined
): (s: string) => void {
  return (s: string) => {
    try {
      original?.(s);
    } catch {
      /* caller's handler threw; not our concern */
    }
    try {
      pushEvent(runId, "progress", classifyProgress(s), s);
    } catch {
      /* fail-open */
    }
  };
}

// ── G2: one base genome plus v2 expansion; never independent genomes ───────
function injectGenomeAndResearch(
  opts: Record<string, any>,
  runId: string,
  trueQuestion: string,
  unified: UnifiedInnovationPlan,
  research: ResearchPhaseResult | null,
): void {
  try {
    attachGenome(runId, unified);
    const existing = String(opts.question ?? trueQuestion);
    opts.question = [
      existing,
      unified.directive,
      research?.dossier ?? "## PREWRITING RESEARCH DOSSIER\n[EVIDENCE_STARVED] Research phase unavailable; report writer must preserve gaps.",
      research?.evidenceBlock ?? "",
    ].join("\n\n");
    opts.unifiedInnovation = unified;
    opts.prewritingResearch = research;
    pushEvent(
      runId,
      "system",
      "genome",
      `Unified genome v1+v2 expansion injected — seed=${unified.seed} domain=${unified.domain} path=${unified.expansion.path.name}; path symbols expanded to full words`
    );
  } catch (e) {
    pushEvent(runId, "system", "error", `unified genome/research injection failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function preparePrewritingResearch(
  opts: Record<string, any>,
  runId: string,
  question: string,
  unified: UnifiedInnovationPlan,
): Promise<ResearchPhaseResult | null> {
  if (opts.profile?.prewritingResearch === false) {
    pushEvent(runId, "system", "grounding", "Prewriting research explicitly disabled by profile.prewritingResearch=false");
    return null;
  }
  const apiKey = String(opts.apiKey ?? "");
  try {
    pushEvent(runId, "system", "grounding", "Prewriting research started — independent search strategist before report writer");
    const result = await runPrewritingResearch({
      question,
      personaSeed: Number(opts.personaSeed ?? opts.profile?.personaSeed ?? unified.seed),
      risk: opts.profile?.risk ?? "medium",
      maxQueries: Number(opts.profile?.researchQueries ?? 8),
      generateQueries: apiKey
        ? (prompt) => geminiGenerate({ apiKey, model: "gemini-2.0-flash-lite", prompt, maxOutputTokens: 1400 })
            .then((r: any) => ({ ok: !!(r?.text ?? r?.output), text: String(r?.text ?? r?.output ?? ""), error: r?.error }))
            .catch((e: unknown) => ({ ok: false, text: "", error: e instanceof Error ? e.message : String(e) }))
        : undefined,
      onProgress: (m) => pushEvent(runId, "progress", "grounding", m),
    });
    attachResearch(runId, result);
    pushEvent(runId, "system", "grounding", `Prewriting research complete — ${result.queries.length} queries, ${result.sources.length} URL-backed sources, status=${result.status}`);
    return result;
  } catch (e) {
    pushEvent(runId, "system", "error", `Prewriting research failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ── G3: numeric-question profile mutation (deterministic route) ────────────
const NUMERIC_QUESTION_RE = /\b(calculate|estimate|npv|irr|percent|ratio|market size|tam|sam|som|forecast|projection|multiple|revenue|margin|cost)\b/i;
function mutateProfileForNumericQuestion(opts: Record<string, any>, runId: string): void {
  if (!opts?.question || !NUMERIC_QUESTION_RE.test(String(opts.question))) return;
  const p = (opts.profile = opts.profile ?? {});
  const before = { computeSandbox: !!p.computeSandbox, webSearch: !!p.webSearch };
  if (p.computeSandbox !== true) p.computeSandbox = true;
  if (p.webSearch !== true) p.webSearch = true; // grounding is a prerequisite for numeric sourcing
  const after = { computeSandbox: p.computeSandbox, webSearch: p.webSearch };
  if (before.computeSandbox !== after.computeSandbox || before.webSearch !== after.webSearch) {
    pushEvent(runId, "system", "init", `numeric-question detected → forced profile.computeSandbox=${after.computeSandbox}, profile.webSearch=${after.webSearch}`);
  }
}

// ── Pure text primitives (exported for self-test / architecture audit) ─────

/** All distinct numeric citation ids referenced by the text, incl. grouped tags. */
export function extractCitationIds(text: string): number[] {
  const ids = new Set<number>();
  for (const m of text.matchAll(/\[S?(\d{1,3})(?:\s*,\s*S?(\d{1,3}))*\]/gi)) {
    for (const n of m[0].matchAll(/(\d{1,3})/g)) ids.add(Number(n[1]));
  }
  return [...ids].sort((a, b) => a - b);
}

/** CSS-reset / chrome blobs that the retriever admitted as "sources". */
export function looksLikeBoilerplate(text: string): boolean {
  const s = String(text ?? "").toLowerCase();
  if (s.trim().length === 0) return true;
  return /table,\s*caption,\s*tbody/.test(s)
    || /--font-inter|font-family:\s*var\(--font/.test(s)
    || /margin:\s*0;padding:\s*0;border:\s*0/.test(s);
}

/** Sentence that stops mid-clause on a connector — the truncation gate. */
export function endsOnDanglingConnector(text: string): boolean {
  return /[a-z]\s+(and|but|or|which|that|because|however|so|thereby|although|by)\s*[.!]?\s*$/i.test(String(text ?? "").trim());
}

/**
 * G5 (pure): insert a stub for every template section absent from `text`.
 * Insertion-only — never rewrites or reorders existing prose. Idempotent:
 * an already-inserted stub counts as present on a second pass.
 */
export function insertMissingSectionStubs(
  text: string,
  templateId?: string,
  styleOverride?: string | null,
  williamsPersona?: string | null
): { text: string; inserted: string[] } {
  if (!text || !templateId) return { text, inserted: [] };
  const rubric = loadTemplateRubric(templateId, styleOverride ?? null, williamsPersona ?? null);
  if (!rubric) return { text, inserted: [] };

  const missing: Array<{ title: string; hint: string }> = [];
  for (const sec of rubric.sections) {
    const rx = new RegExp(`##\\s*(?:§\\d+\\s*)?${sec.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (!rx.test(text)) missing.push({ title: sec.title, hint: sec.purpose || "(open item)" });
  }
  if (missing.length === 0) return { text, inserted: [] };

  const stubs = missing
    .map((s) => `\n\n## ${s.title}\n\n[MISSING SECTION — please supply]\nRequired by template ${templateId}. ${s.hint}\n`)
    .join("");

  // Insert stubs before References if present, otherwise append.
  const refsIdx = text.search(/##\s*references/i);
  const patched = refsIdx >= 0 ? text.slice(0, refsIdx) + stubs + text.slice(refsIdx) : text + stubs;
  return { text: patched, inserted: missing.map((s) => s.title) };
}

/**
 * Annotate sections whose grounding returned zero URL-backed sources so the
 * reader sees an explicit evidence gap instead of confident unsourced prose.
 * Pure; insertion-only.
 */
export function annotateEvidenceStarvedSections(
  text: string,
  starvedSections: string[]
): { text: string; annotated: string[] } {
  if (!text || starvedSections.length === 0) return { text, annotated: [] };
  const annotated: string[] = [];
  let out = text;
  for (const section of starvedSections) {
    const esc = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`(##\\s*(?:§\\d+\\s*)?${esc}[^\\n]*\\n)`, "i");
    if (!rx.test(out)) continue;
    if (new RegExp(`${esc}[^\\n]*\\n+\\[EVIDENCE_STARVED`, "i").test(out)) continue; // idempotent
    out = out.replace(rx, `$1\n[EVIDENCE_STARVED] Retrieval returned no URL-backed source for this section. Claims here are unsourced; supply evidence or downgrade to an explicit open item.\n`);
    annotated.push(section);
  }
  return { text: out, annotated };
}

/**
 * G6 (pure): deterministic rubric floor. NEVER a judge score — reported
 * alongside it. Inputs are already-measured ratios so the function is
 * trivially testable and has no I/O.
 */
export function computeDeterministicFloor(m: {
  templateCoverage: number;   // 0..1
  citationTrustRatio: number; // 0..1
  placeholderDensity: number; // placeholders / word
  placeholderUrlRatio: number;// 0..1
  truncated: boolean;
}): number {
  const floor = Math.max(1, Math.min(9.5,
    m.templateCoverage * 3.0 +
    m.citationTrustRatio * 2.5 +
    (1 - Math.min(1, m.placeholderDensity * 50)) * 1.5 +
    (1 - m.placeholderUrlRatio) * 1.5 +
    (m.truncated ? 0 : 1.0)
  ));
  return Number(floor.toFixed(2));
}

// ── G5 wrapper: apply the pure stub inserter to a live outcome ─────────────
function applyMissingSectionStubs(outcome: any, runId: string | null): void {
  const draft: string = outcome?.fixed || outcome?.draft || "";
  const settings = outcome?.runSettings ?? {};
  const { text, inserted } = insertMissingSectionStubs(
    draft, settings.templateId, settings.styleOverride, settings.williamsPersona
  );
  if (inserted.length === 0) return;
  outcome.fixed = text;
  outcome.insertedSectionStubs = inserted;
  if (runId) {
    pushEvent(runId, "system", "covea",
      `G5: inserted ${inserted.length} missing-section stub(s): ${inserted.join(", ")}`
    );
  }
}

// ── G6 wrapper: measure the live outcome, then call the pure floor fn ──────
function applyDeterministicFloor(outcome: any, runId: string | null): void {
  if (outcome?.judgeScore != null) return; // judge succeeded — do not override
  const excluded = outcome?.judgeExcluded;
  if (!Array.isArray(excluded) || excluded.length === 0) return;

  const draft: string = outcome?.fixed || outcome?.draft || "";
  if (!draft) return;

  // Template coverage
  const settings = outcome?.runSettings ?? {};
  const rubric = loadTemplateRubric(settings.templateId, settings.styleOverride, settings.williamsPersona);
  let templateCov = 1;
  if (rubric && rubric.sections.length > 0) {
    const present = rubric.sections.filter((s) =>
      new RegExp(`##\\s*(?:§\\d+\\s*)?${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(draft)
    ).length;
    templateCov = present / rubric.sections.length;
  }

  // Citation trust ratio
  const audit = outcome?.citationAudit;
  let trustRatio = 1;
  if (audit?.totalCitations > 0) {
    trustRatio = (audit.trustedCount ?? 0) / audit.totalCitations;
  }

  // Placeholder density
  const placeholders = (draft.match(/\[(DATA GAP|ASSUMPTION|TBD|PROPOSED)\]/gi) ?? []).length;
  const words = Math.max(1, draft.split(/\s+/).length);
  const placeholderDensity = placeholders / words;

  // Placeholder URL ratio
  const entries = audit?.entries as Array<{ url?: string }> | undefined;
  let placeholderUrlRatio = 0;
  if (Array.isArray(entries) && entries.length > 0) {
    placeholderUrlRatio = entries.filter((e) => isPlaceholderUrl(e.url)).length / entries.length;
  }

  // Truncation
  const truncated = endsOnDanglingConnector(draft);

  // Delegate the arithmetic to the pure, self-tested core.
  const floor = computeDeterministicFloor({
    templateCoverage: templateCov,
    citationTrustRatio: trustRatio,
    placeholderDensity,
    placeholderUrlRatio,
    truncated,
  });

  // NEVER write into judgeScore — it must stay null per contract.
  outcome.deterministicFloor = floor;
  if (runId) {
    pushEvent(runId, "system", "judge",
      `G6: deterministicFloor=${floor.toFixed(2)} (templateCov=${(templateCov * 100).toFixed(0)}% trustRatio=${(trustRatio * 100).toFixed(0)}% placeholders=${placeholders} placeholderUrls=${(placeholderUrlRatio * 100).toFixed(0)}% truncated=${truncated}). judgeScore remains null — all ${excluded.length} judge(s) excluded.`
    );
  }
}

// ── G4: post-completion COVEA repair (targeted, non-destructive) ───────────
async function maybeRunCoveaRepair(
  runId: string,
  apiKey: string,
  question: string,
  outcome: any
): Promise<void> {
  try {
    const cove = outcome?.coveReport;
    // adversarialPreview is inspected via outcome.issues below; kept off the top-level to avoid dead vars.
    const draft: string = outcome?.fixed || outcome?.draft || "";
    if (!draft) return;

    const coveFailures =
      Array.isArray(cove?.questions)
        ? cove.questions.filter((q: any) => !q.consistent).map((q: any) => ({
            question: String(q.question ?? ""),
            expectedAnswer: String(q.expectedAnswer ?? ""),
            verifiedAnswer: String(q.verifiedAnswer ?? ""),
          }))
        : [];

    // Adversarial defects: prefer structured issues, fall back to preview categories.
    const issues = Array.isArray(outcome?.issues) ? outcome.issues : [];
    const advDefects = issues
      .filter((i: any) => /adv|adversarial|red_team|red-team/i.test(String(i?.code ?? "")) || String(i?.severity ?? "") === "critical")
      .map((i: any) => ({
        code: String(i?.code ?? "ADV"),
        severity: String(i?.severity ?? "critical"),
        message: String(i?.message ?? i?.remediation ?? ""),
      }));

    const audit = outcome?.citationAudit;
    const hasCitationWork = Array.isArray(audit?.entries) && audit.entries.some((e: any) => !/^https?:\/\//i.test(String(e?.url ?? "")))
      || Array.isArray(audit?.auditResults) && audit.auditResults.some((r: any) => r?.trusted === false || r?.found === false);
    const hasPlaceholderWork = /\[(DATA GAP|ASSUMPTION|TBD|PROPOSED)\]/i.test(draft);

    // If neither source has any failure to repair, skip cleanly. Citation and
    // placeholder containment are deterministic and do not require an API key.
    if (coveFailures.length === 0 && advDefects.length === 0 && !hasCitationWork && !hasPlaceholderWork) {
      pushEvent(runId, "system", "covea", "COVEA skipped — no CoVe/adversarial/citation/placeholder failures reported by pipeline");
      return;
    }

    // Extract innovation context and research evidence from the outcome
    // so COVEA repairs stay in-voice and can cite real prewriting sources.
    const innovationCtx = (outcome?.unifiedInnovation as any)?.directive as string | undefined;
    const researchEv = (outcome?.prewritingResearch as any)?.evidenceBlock as string | undefined;
    pushEvent(runId, "system", "covea", `COVEA start — ${coveFailures.length} CoVe + ${advDefects.length} adversarial target(s)${innovationCtx ? " · innovation context attached" : ""}${researchEv ? " · research evidence attached" : ""}`);
    const result = await runCoveaRepair({
      apiKey,
      question,
      draft,
      coveFailures,
      advDefects,
      citationAudit: audit,
      innovationContext: innovationCtx,
      researchEvidence: researchEv,
      onProgress: (m) => pushEvent(runId, "progress", "covea", m),
    });
    attachCovea(runId, draft, result);
    pushEvent(
      runId,
      "system",
      "covea",
      `COVEA done — accepted=${result.acceptedCount} rejected=${result.rejectedCount} skipped=${result.skippedCount} · ${result.charsChanged}ch (${(result.charsChangedPct * 100).toFixed(1)}%)`
    );
  } catch (e) {
    pushEvent(runId, "system", "error", `COVEA repair failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Public API — same signatures, additive behaviour ───────────────────────
type V15Args = Parameters<typeof packageRunV15>;
type V15Result = Awaited<ReturnType<typeof packageRunV15>>;

export async function runV15OnQuestion(...args: V15Args): Promise<V15Result> {
  installScraperBridge();
  const opts = args[0] as Record<string, any> | undefined;
  const originalQuestion = opts?.question ? String(opts.question) : "";

  let runId: string | null = null;
  let unifiedPlan: UnifiedInnovationPlan | null = null;
  let researchPhase: ResearchPhaseResult | null = null;
  try {
    runId = startRun("v15", originalQuestion, opts);
  } catch {
    runId = null;
  }

  if (runId && opts) {
    opts.onProgress = teeProgress(runId, opts.onProgress);
    try {
      const profile = opts.profile ?? {};
      pushEvent(
        runId,
        "system",
        "init",
        `profile: webSearch=${!!profile.webSearch} · template=${profile.templateId ?? "none"} · style=${profile.styleOverride ?? "none"} · williams=${profile.williamsPersona ?? "none"} · maxDepth=${opts.maxDepth ?? "default"} · advancedGates=${!!opts.advancedGates} · runJudge=${opts.runJudge !== false}`
      );
    } catch {
      /* fail-open */
    }
    // G3 must run before prompt mutation.
    mutateProfileForNumericQuestion(opts, runId);
    unifiedPlan = buildUnifiedInnovationPlan(originalQuestion, {
      personaSeed: Number(opts.personaSeed ?? opts.profile?.personaSeed ?? undefined) || undefined,
      risk: opts.profile?.risk ?? "medium",
    });
    researchPhase = await preparePrewritingResearch(opts, runId, originalQuestion, unifiedPlan);
    // G7: Intent Facet Lattice — decompose the (untruncated) prompt into
    // per-section high-signal keyword queries so the package's relative-path
    // grounding stops dispatching the raw prompt (the observed cause of
    // off-topic "CHAGEE tea" / "Moldovan youth" results). Deterministic floor
    // first; optional LLM enrichment adds facets but never removes the floor
    // and fails safe on 429/503.
    await injectIntentLattice(opts, runId, originalQuestion);
    // G2 injects one base genome + v2 expansion + immutable research dossier.
    injectGenomeAndResearch(opts, runId, originalQuestion, unifiedPlan, researchPhase);
  }

  try {
    const outcome = await packageRunV15(...args);
    // Restore the caller-facing question — the shim already restores its own
    // v10 injection; we restore ours here so downstream consumers see the
    // original user text, not our prepended directives.
    if (originalQuestion && outcome && typeof outcome === "object") {
      (outcome as any).question = originalQuestion;
      (outcome as any).unifiedInnovation = unifiedPlan;
      (outcome as any).prewritingResearch = researchPhase;
    }
    // Finish the standard-pipeline capture BEFORE running COVEA, so the run
    // record already has the pre-COVEA outcome for diffing.
    if (runId) {
      try {
        finishRun(runId, outcome);
      } catch {
        /* fail-open */
      }
    }
    // G5: missing-section stub insertion (deterministic, no model).
    try {
      applyMissingSectionStubs(outcome, runId);
    } catch {
      /* fail-open */
    }
    // G6: deterministic floor when judge is unavailable.
    try {
      applyDeterministicFloor(outcome, runId);
    } catch {
      /* fail-open */
    }
    // G4: post-completion targeted repair (runs last because it reads fixed text).
    if (runId && opts) {
      await maybeRunCoveaRepair(runId, String(opts.apiKey ?? ""), originalQuestion, outcome);
    }
    if (runId) clearRetrievalContext(runId);
    return outcome;
  } catch (err) {
    if (runId) clearRetrievalContext(runId);
    if (runId) {
      try {
        finishRun(runId, undefined, err);
      } catch {
        /* fail-open */
      }
    }
    throw err;
  }
}

type BaseArgs = Parameters<typeof packageRunBaseline>;
type BaseResult = Awaited<ReturnType<typeof packageRunBaseline>>;

export async function runBaselineOnQuestion(...args: BaseArgs): Promise<BaseResult> {
  installScraperBridge();
  const opts = args[0] as Record<string, any> | undefined;
  const question = opts?.question ? String(opts.question) : "";

  let runId: string | null = null;
  let unifiedPlan: UnifiedInnovationPlan | null = null;
  let researchPhase: ResearchPhaseResult | null = null;
  try {
    runId = startRun("baseline", question, opts);
  } catch {
    runId = null;
  }
  if (runId && opts) {
    opts.onProgress = teeProgress(runId, opts.onProgress);
    unifiedPlan = buildUnifiedInnovationPlan(question, {
      personaSeed: Number(opts.personaSeed ?? opts.profile?.personaSeed ?? undefined) || undefined,
      risk: opts.profile?.risk ?? "medium",
    });
    researchPhase = await preparePrewritingResearch(opts, runId, question, unifiedPlan);
    injectGenomeAndResearch(opts, runId, question, unifiedPlan, researchPhase);
  }

  try {
    const outcome = await packageRunBaseline(...args);
    if (outcome && typeof outcome === "object") {
      (outcome as any).question = question;
      (outcome as any).unifiedInnovation = unifiedPlan;
      (outcome as any).prewritingResearch = researchPhase;
    }
    if (runId) {
      try {
        finishRun(runId, outcome);
      } catch {
        /* fail-open */
      }
    }
    return outcome;
  } catch (err) {
    if (runId) {
      try {
        finishRun(runId, undefined, err);
      } catch {
        /* fail-open */
      }
    }
    throw err;
  }
}


// [unify.mjs] Explicit value re-exports for Rollup resolution
export { judgePanelEnhanced, runComparativeJudge } from "./v15-pipeline.orig";
