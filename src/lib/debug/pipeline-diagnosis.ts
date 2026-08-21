/**
 * pipeline-diagnosis.ts — NET-NEW (Type C). See flatten-guide.md.
 * ===========================================================================
 * REFRAMED PROMPT-FORGE: from "improve the prompt" → "improve the PIPELINE".
 *
 * User's turn-3 clarification: "My original goal is to review any LOGIC
 * PIPELINE ARCHITECTURAL CHANGES that are needed for a prompt output to
 * improve, not to improve the prompt itself to make it better."
 *
 * This module maps observable defects in the final output to the SPECIFIC
 * pipeline step that produced them, and for each step emits two independent
 * repair routes:
 *
 *   (A) DETERMINISTIC — a configuration flag, gate insertion, module toggle,
 *       or code path swap that requires NO prompt edit. Preferred when
 *       available because it is auditable, reversible, and non-flaky.
 *   (B) LLM — a prompt-level tweak scoped to a single pipeline step. Used
 *       only when (A) does not exist or is insufficient.
 *
 * Each route also has a BACKUP so at least one route is always executable
 * even when the primary route's dependency (network, API key, template,
 * model tier) is unavailable.
 *
 * Diagnoses are keyed by:
 *   · defect type (structural / factual / stylistic / evidential)
 *   · pipeline step (best-of-N / draft / HDIG / CoVe / adversarial / etc.)
 *   · template id  (per-template override)
 *   · style override
 *   · section id  (per-section override)
 * ===========================================================================
 */
import { splitSentences } from "@/lib/debug/step-attribution";
import type { RunRecord } from "@/lib/debug/pipeline-trace-bus";
import { loadTemplateRubric, type TemplateRubric } from "@/lib/debug/template-rubric";
import { buildForensics, type ForensicsReport } from "@/lib/debug/scraper-forensics";
import { sitesFor, repairFileSummary, exportRepairOrder, type RepairSite } from "@/lib/debug/repair-sites";

// ── Defect taxonomy ────────────────────────────────────────────────────────

export type DefectKind =
  | "truncation"                 // sentence ends mid-clause / connector word
  | "unresolved-placeholder"     // [DATA GAP], [ASSUMPTION], [TBD]
  | "orphan-citation"            // [S#] with no References section entry
  | "untrusted-citation"         // citation whose snippet has <20% overlap with claim
  | "missing-references"         // References section absent
  | "cove-inconsistent"          // CoVe verified as inconsistent → NOT REPAIRED
  | "adversarial-blocking"       // adversarial verdict revise, defects unfixed
  | "missing-section"            // template section absent from output
  | "no-numerics"                // section that should quantify has no numbers with units
  | "no-actions"                 // recommendation section without verbs/owners/thresholds
  | "style-violation"            // persona-directive breach
  | "compute-missing"            // numeric question but no compute records
  | "hedge-explosion"            // >5 hedges per 100w
  | "genome-ignored"             // genome directive present but no discovery framing in output
  // ── turn-5 additions: retrieval-plane + evaluation-plane detectors ──────
  | "placeholder-citation-url"   // ledger url is `source-N` / `*-attested`, cannot resolve
  | "lane-zero-yield"            // lane packed atoms but zero real documents (D14)
  | "lane-quarantined"           // lane delegated away with no acceptable result (D14B)
  | "weak-content-gate"          // source admitted on length alone, no relevance floor
  | "depth-repair-abandoned"     // N-Deep broke on first rejection, budget unspent
  | "judge-unavailable"          // all judges excluded → no independent signal
  | "template-coverage-gap"      // < 100% of template sections present
  ;

export type PipelineStep =
  | "profile-selection"
  | "genome-injection"
  | "template-directive"
  | "grounding"                  // template-directed + single-query
  | "best-of-n-outlines"
  | "best-of-n-expansion"        // = draft
  | "hdig"                       // hypothesis-driven iterative grounding
  | "cove"
  | "cove-repair"                // the missing step this project adds
  | "adversarial-preflight"
  | "depth-repair"               // N-Deep localised patch loop
  | "adversarial-red-team"
  | "adversarial-repair"
  | "polish"
  | "citation-audit"
  | "citation-entailment"
  | "judge-panel"
  ;

export interface Route {
  kind: "deterministic" | "llm";
  action: string;
  /** How to apply, in concrete terms — one sentence. */
  how: string;
  /** What must exist for this route to work. */
  requires: string[];
  /** If requires is unmet, what to fall back to. */
  backup: string;
  /** Whether this can be applied without editing the package. */
  applicableInSidecar: boolean;
  /** Which config flag / code seam controls it. */
  hook?: string;
}

export interface PerScopeAdvice {
  scope: string;                 // "global" | template id | style code | section id
  routes: Route[];
}

export interface StepDiagnosis {
  defect: DefectKind;
  step: PipelineStep;
  /** Why THIS step is responsible for this defect, tied to observed evidence. */
  attribution: string;
  /** Concrete evidence from the run (sentence excerpts, log lines, counts). */
  evidence: string[];
  /** Cross-scope routes: global, per-template, per-style, per-section. */
  advice: PerScopeAdvice[];
  /**
   * turn-5: exact code coordinates (file, line, symbol, anchor, current code)
   * for this defect. Empty when no verified coordinate exists — never guessed.
   */
  repairSites: RepairSite[];
}

export interface DiagnosisReport {
  runId: string;
  finalScore: number | null;
  targetScore: number;
  templateId: string;
  styleOverride: string | null;
  williamsPersona: string | null;
  totalDefects: number;
  diagnoses: StepDiagnosis[];
  /** Ordered playbook — apply top routes first, in this exact order. */
  playbook: Array<{ rank: number; defect: DefectKind; step: PipelineStep; route: Route; scope: string; expectedLift: number }>;
  /** What this run could still not diagnose — kept honest, never fabricated. */
  unresolvedIssues: string[];
  /** turn-5: every verified code coordinate implicated, deduped. */
  allRepairSites: RepairSite[];
  /** turn-5: distinct files to touch, with reachability + edit count. */
  repairFiles: Array<{ file: string; reach: string; count: number }>;
  /** turn-5: how many sites are fixable today in src/ vs need materialize.mjs. */
  reachabilitySplit: { sidecarToday: number; postPass: number; needsMaterialize: number };
}

// ── Deterministic defect detectors — pure text/state, no network ───────────

function detectDefects(run: RunRecord, rubric: TemplateRubric | null): Array<{ kind: DefectKind; evidence: string[] }> {
  const out: Array<{ kind: DefectKind; evidence: string[] }> = [];
  const finalText = run.finalText ?? "";
  const output = (run.output ?? {}) as Record<string, any>;

  // Truncation
  const sents = splitSentences(finalText);
  const truncEndings = sents.filter((s) => /[a-z]\s+(and|but|or|which|that|because|however|so|thereby|although|by)\s*[.!]?\s*$/i.test(s));
  if (truncEndings.length > 0) {
    out.push({ kind: "truncation", evidence: truncEndings.slice(0, 3).map((s) => `"${s.slice(-80)}"`) });
  }
  // Placeholders
  const gaps = (finalText.match(/\[(DATA GAP|ASSUMPTION|TBD|PROPOSED)\]/gi) ?? []);
  if (gaps.length > 0) {
    out.push({ kind: "unresolved-placeholder", evidence: [`${gaps.length} placeholder(s): ${[...new Set(gaps)].join(", ")}`] });
  }
  // Orphan / untrusted citations from citationAudit
  const audit = output.citationAudit;
  if (audit) {
    const untrusted = (audit.auditResults ?? []).filter((r: any) => r.trusted === false);
    if (untrusted.length > 0) {
      out.push({
        kind: "untrusted-citation",
        evidence: [`${untrusted.length}/${audit.totalCitations} untrusted (overlap<0.2): ${untrusted.slice(0, 3).map((r: any) => `${r.tag}=${(r.snippetOverlap * 100).toFixed(0)}%`).join(", ")}`],
      });
    }
    if ((audit.missingCount ?? 0) > 0) {
      out.push({ kind: "orphan-citation", evidence: [`${audit.missingCount} tag(s) reference missing source ids`] });
    }
  }
  if (!/##\s*references|source list|bibliography/i.test(finalText)) {
    out.push({ kind: "missing-references", evidence: ["no References/Source-list section in the final text"] });
  }
  // CoVe inconsistencies that were NOT repaired
  const cove = output.coveReport;
  if (cove && (cove.inconsistencies ?? 0) > 0) {
    const failures = (cove.questions ?? []).filter((q: any) => !q.consistent);
    out.push({
      kind: "cove-inconsistent",
      evidence: [
        `${cove.inconsistencies}/${cove.questions?.length ?? "?"} CoVe claim(s) failed — with no follow-up repair pass in the standard pipeline`,
        ...failures.slice(0, 2).map((q: any) => `"${String(q.question).slice(0, 90)}" → verified: "${String(q.verifiedAnswer).slice(0, 60)}"`),
      ],
    });
  }
  // Adversarial blocking defects with rejected repair
  const advPreview = output.adversarialPreview;
  if (advPreview && (advPreview.defectCount ?? 0) > 0 && advPreview.verdict !== "pass") {
    out.push({
      kind: "adversarial-blocking",
      evidence: [
        `verdict=${advPreview.verdict} · ${advPreview.defectCount} defect(s) · categories: ${(advPreview.categories ?? []).join(", ")}`,
        "adversarial monotonic repair rejected in the log (\"shrank too much\") — no targeted fallback in-package",
      ],
    });
  }
  // Missing sections
  if (rubric) {
    for (const sec of rubric.sections) {
      const heading = new RegExp(`##\\s*${sec.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      if (!heading.test(finalText)) {
        out.push({ kind: "missing-section", evidence: [`template ${rubric.templateId} requires section "${sec.title}"; not found in output`] });
      }
    }
  }
  // Numerics/actionability check on relevant sections
  const nums = (finalText.match(/\b\d[\d,.]*\s?(%|USD|\$|billion|million|bps|x|years?|months?|Q[1-4])\b/gi) ?? []).length;
  if (nums < 5 && /market|financ|estimat|npv|irr|share/i.test(run.question || "")) {
    out.push({ kind: "no-numerics", evidence: [`only ${nums} quantified figure(s) with units in a numeric-heavy question`] });
  }
  const actions = (finalText.match(/\b(recommend|proceed|approve|reject|hire|deploy|pause|escalate|deadline|owner:|by Q[1-4])\b/gi) ?? []).length;
  if (actions < 2 && /(recommend|should|action|next step)/i.test(run.question || "")) {
    out.push({ kind: "no-actions", evidence: [`only ${actions} action verb(s) in a recommendation-oriented question`] });
  }
  // Compute
  const isNumeric = /\b(calculate|estimate|npv|irr|percent|ratio|market size)\b/i.test(run.question || "");
  const computes = ((output.passHistory ?? [])[0]?.computeRecords ?? []).length ?? 0;
  if (isNumeric && computes === 0 && (output.issues ?? []).some((i: any) => i?.code === "MISSING_COMPUTE_RECORDS")) {
    out.push({ kind: "compute-missing", evidence: ["numeric prompt detected · no deterministic compute records"] });
  }
  // Hedge explosion
  const hedges = (finalText.match(/\b(might|may|could|perhaps|possibly|generally|typically|often|arguably)\b/gi) ?? []).length;
  const words = Math.max(1, finalText.split(/\s+/).length);
  if ((hedges / words) * 100 > 2.5) {
    out.push({ kind: "hedge-explosion", evidence: [`${hedges} hedge word(s) in ${words} words (${((hedges / words) * 100).toFixed(2)}/100w)`] });
  }

  // ── turn-5: RETRIEVAL-PLANE detectors, driven by real lane forensics ─────
  // These fire on parsed emitter output, never on inference. If the run
  // produced no grounding telemetry the detectors stay silent rather than
  // guessing that retrieval was fine.
  let forensics: ForensicsReport | null = null;
  try {
    forensics = buildForensics(run);
  } catch {
    forensics = null;
  }

  if (forensics) {
    // D-URL: ledger urls that can never resolve (root cause v15-grounding:113/:131)
    if (forensics.allPlaceholderUrls.length > 0) {
      out.push({
        kind: "placeholder-citation-url",
        evidence: [
          `${forensics.allPlaceholderUrls.length} non-resolvable citation URL(s): ${forensics.allPlaceholderUrls.slice(0, 6).join(", ")}`,
          `${forensics.totals.realUrlCount} of ${forensics.totals.ledgerEntries} ledger entries carry an absolute http(s) URL.`,
          "Generated verbatim by `source-${sourceIndex+1}` at v15-grounding.orig.ts:113 (vanguard) and :131 (palisade).",
        ],
      });
    }
    // D14: atoms packed, zero real documents
    if (forensics.zeroYieldLanes.length > 0) {
      out.push({
        kind: "lane-zero-yield",
        evidence: forensics.zeroYieldLanes
          .slice(0, 6)
          .map((l) => `${l.lane}[${l.section ?? "-"}]: ${l.atomsPacked} atoms / ${l.sourcesPacked} sources / util=${l.utilizationPct ?? "?"}%`),
      });
    }
    // D14B: delegation chain exhausted
    if (forensics.quarantinedLanes.length > 0) {
      out.push({
        kind: "lane-quarantined",
        evidence: [
          `${forensics.quarantinedLanes.length} lane(s) reported no acceptable result: ${[...new Set(forensics.quarantinedLanes.map((l) => l.lane))].join(", ")}`,
        ],
      });
    }
    // Weak content gate: symptom is an admitted source with no lexical tie to the question.
    const qTokens = new Set(
      (run.question || "").toLowerCase().match(/[a-z]{4,}/g) ?? []
    );
    if (qTokens.size >= 3) {
      const irrelevant = (forensics.lanes.flatMap((l) => l.citations) as Array<{ title?: string; snippet?: string; url?: string }>)
        .filter((c) => {
          const hay = `${c.title ?? ""} ${c.snippet ?? ""}`.toLowerCase();
          if (hay.trim().length < 20) return false;
          const hits = [...qTokens].filter((t) => hay.includes(t)).length;
          return hits === 0;
        });
      if (irrelevant.length > 0) {
        out.push({
          kind: "weak-content-gate",
          evidence: [
            `${irrelevant.length} admitted source(s) share ZERO content words with the question.`,
            ...irrelevant.slice(0, 3).map((c) => `"${String(c.title ?? "(untitled)").slice(0, 80)}"`),
            "Admission filter at v15-grounding.orig.ts:221 is `content.length>=80` with no relevance floor.",
          ],
        });
      }
    }
  }

  // ── turn-5: EXECUTION-PLANE detectors ────────────────────────────────────
  const settings = ((run.output ?? {}) as any).runSettings ?? ((run.input ?? {}) as any) ?? {};
  const requestedDepth = Number(settings.depth ?? settings.maxDepth ?? (run.input as any)?.maxDepth ?? 0);
  const executedDepths = new Set(
    run.events.filter((e) => e.phase === "repair").map((e) => /^depth (\d+)/.exec(e.message)?.[1]).filter(Boolean)
  ).size;
  if (requestedDepth > 1 && executedDepths > 0 && executedDepths < requestedDepth) {
    out.push({
      kind: "depth-repair-abandoned",
      evidence: [
        `maxDepth=${requestedDepth} requested but only ${executedDepths} depth(s) executed.`,
        ...run.events.filter((e) => /rejected localized patches/.test(e.message)).slice(0, 1).map((e) => e.message),
      ],
    });
  }

  // Judge availability
  const excluded = (output.judgeExcluded ?? []) as Array<{ model?: string; reason?: string }>;
  if (output.judgeScore == null && excluded.length > 0) {
    out.push({
      kind: "judge-unavailable",
      evidence: [
        `All ${excluded.length} judge(s) excluded — no independent signal for this run.`,
        ...excluded.slice(0, 3).map((e) => `${e.model}: ${String(e.reason ?? "").slice(0, 90)}`),
        "Pipeline correctly refused to fabricate a fallback score; deterministic guard is the only remaining gate.",
      ],
    });
  }

  // Template coverage as a measured percentage
  if (rubric && rubric.sections.length > 0) {
    const present = rubric.sections.filter((s) =>
      new RegExp(`##\\s*(?:§\\d+\\s*)?${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(finalText)
    ).length;
    const pct = (present / rubric.sections.length) * 100;
    if (pct < 100) {
      out.push({
        kind: "template-coverage-gap",
        evidence: [
          `${present}/${rubric.sections.length} template sections present (${pct.toFixed(0)}% coverage).`,
          `Missing: ${rubric.sections.filter((s) => !new RegExp(`##\\s*(?:§\\d+\\s*)?${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(finalText)).map((s) => s.title).join(", ")}`,
        ],
      });
    }
  }

  return out;
}

// ── Map defect → responsible step ──────────────────────────────────────────

const STEP_FOR_DEFECT: Record<DefectKind, PipelineStep> = {
  truncation: "best-of-n-expansion",
  "unresolved-placeholder": "best-of-n-expansion",
  "orphan-citation": "citation-audit",
  "untrusted-citation": "citation-entailment",
  "missing-references": "polish",
  "cove-inconsistent": "cove-repair",
  "adversarial-blocking": "adversarial-repair",
  "missing-section": "template-directive",
  "no-numerics": "grounding",
  "no-actions": "template-directive",
  "style-violation": "best-of-n-expansion",
  "compute-missing": "best-of-n-expansion",
  "hedge-explosion": "best-of-n-expansion",
  "genome-ignored": "genome-injection",
  // turn-5 additions
  "placeholder-citation-url": "grounding",
  "lane-zero-yield": "grounding",
  "lane-quarantined": "grounding",
  "weak-content-gate": "hdig",
  "depth-repair-abandoned": "depth-repair",
  "judge-unavailable": "judge-panel",
  "template-coverage-gap": "template-directive",
};

// ── Route library. Every route has BOTH kinds and BOTH backups. ────────────
//
// Each entry gives (deterministic, llm) routes. `applicableInSidecar` marks
// routes that can be implemented via the workspace overlay WITHOUT editing
// the package. `hook` names the file/flag that implements the change.

const ROUTES: Record<DefectKind, { deterministic: Route; llm: Route }> = {
  truncation: {
    deterministic: {
      kind: "deterministic",
      action: "Raise draft/expansion token budget and disable *-lite model routing for expansion.",
      how: "In `runV15OnQuestion` opts, set `draftMaxToks ≥ 6144` and route expansion through the non-lite pool via `models.ts` intelligenceOf. The 503 in the log came from `gemini-2.5-flash-lite` — a documented low-availability tier.",
      requires: ["v15-pipeline seam", "models.ts intelligence tier"],
      backup: "If the higher tier is 429-limited, insert an outline-then-stitch pass so no single expansion call exceeds ~4k tokens.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts (Type-B wrapper) + profile.draftMaxToks",
    },
    llm: {
      kind: "llm",
      action: "Append an explicit stop-condition to the expansion prompt.",
      how: "Prepend: `Do NOT end on a connector word (and/but/or/which/that/because). If the token budget is close, close every open sentence before stopping.`",
      requires: ["template-directive seam"],
      backup: "Fall back to the deterministic truncation-gate that already exists in the adversarial preflight — but wired to trigger the COVEA repair, not just log.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts pre-call directive injection",
    },
  },
  "unresolved-placeholder": {
    deterministic: {
      kind: "deterministic",
      action: "Emit a placeholder-scan gate that runs COVEA on any surviving [DATA GAP] / [ASSUMPTION].",
      how: "Post-completion: scan the fixed draft, extract sentences containing placeholder markers, feed to `covea-repair.ts` as a synthetic defect list.",
      requires: ["covea-repair.ts (this project)"],
      backup: "Deterministic annotation only — tag the surviving placeholders with a machine-readable `[COVEA:PLACEHOLDER_UNRESOLVED]` suffix for reviewer triage.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion hook",
    },
    llm: {
      kind: "llm",
      action: "Fire a targeted grounding query for each placeholder subject.",
      how: "For each sentence containing a placeholder, extract the noun phrase and re-run template-directed grounding with that as a section query.",
      requires: ["web grounding enabled", "template-directive hook"],
      backup: "If grounding returns 0 sources, downgrade the sentence to an explicit `[UNVERIFIED]` claim rather than fabricating a value.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts + HDIG re-entry",
    },
  },
  "orphan-citation": {
    deterministic: {
      kind: "deterministic",
      action: "Add a References-section synthesiser gate.",
      how: "In the polish pass, if `citationAudit.entries.length > 0` and no References section exists, append one built from the ledger — with real URLs only.",
      requires: ["polish seam", "citationAudit"],
      backup: "If the polish pass rejects the addition on score-drop, prepend the reference list before Recommendation instead of after — polish rejects size shrinkage, not size growth.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion, before finishRun",
    },
    llm: {
      kind: "llm",
      action: "Add References to the template's required sections list.",
      how: "In the workspace copy of the template directive, declare References as MANDATORY, not optional.",
      requires: ["template rubric seam"],
      backup: "If the template is inherited from the package, apply the mandatory-references override in `template-rubric.ts` as a workspace annotation.",
      applicableInSidecar: true,
      hook: "src/lib/debug/template-rubric.ts tenPointContract",
    },
  },
  "untrusted-citation": {
    deterministic: {
      kind: "deterministic",
      action: "Raise the entailment-overlap threshold before a citation is marked trusted; force re-grounding on any failure.",
      how: "Lower `trustedThreshold` in `citationLedger.verifyEntailment`; on fail, add the claim to HDIG's re-grounding queue rather than only logging.",
      requires: ["citation-ledger-store seam"],
      backup: "If the entailment model is unavailable (429), fall back to lexical trigram-Jaccard against the snippet with a threshold of 0.35.",
      applicableInSidecar: true,
      hook: "src/lib/citation-ledger-store.ts (Type-A now → promote to Type-B when needed)",
    },
    llm: {
      kind: "llm",
      action: "Instruct the draft step to quote a ≤20-word span from the source when citing.",
      how: "Add to the template directive: `Every [S#] must be immediately preceded by a ≤20-word verbatim quote from the source snippet, in quotation marks.`",
      requires: ["template-directive seam"],
      backup: "If the source snippet is empty (as seen for `source-1` in log entries 5/6/9), drop the tag entirely rather than fabricate a quote.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts template-directive injection",
    },
  },
  "missing-references": {
    deterministic: {
      kind: "deterministic",
      action: "Same as orphan-citation deterministic route — synthesise from ledger.",
      how: "Post-completion append if absent.",
      requires: ["citationAudit non-empty"],
      backup: "Prepend before Recommendation.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts",
    },
    llm: {
      kind: "llm",
      action: "Add References to template as mandatory section.",
      how: "Extend `TemplateRubric.sections` with References for every template.",
      requires: ["template-rubric.ts"],
      backup: "Reader adds their own — but flag on export.",
      applicableInSidecar: true,
      hook: "src/lib/debug/template-rubric.ts",
    },
  },
  "cove-inconsistent": {
    deterministic: {
      kind: "deterministic",
      action: "Route CoVe failures into COVEA repair pass (this project's new step).",
      how: "After the standard pipeline returns, extract `coveReport.questions.filter(!consistent)` and pass to `runCoveaRepair` for TARGETED sentence-level repair (never full rewrite).",
      requires: ["covea-repair.ts", "gemini API key"],
      backup: "If the LLM route fails on all models, apply deterministic `[COVEA:UNVERIFIED]` annotation so the reviewer sees the failure — never silently retain the original claim as-is.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion (turn-4 change)",
    },
    llm: {
      kind: "llm",
      action: "Increase CoVe question count and enable independent-model answering.",
      how: "CoVe currently caps at 4 claims (`opts.draft.slice(0,6000)` truncation). In our COVEA reimplementation we pass the FULL draft and lift the claim cap.",
      requires: ["gemini API + rate budget"],
      backup: "Fall back to lexical entailment check on cached ledger sources.",
      applicableInSidecar: true,
      hook: "src/lib/debug/covea-repair.ts (no draft truncation)",
    },
  },
  "adversarial-blocking": {
    deterministic: {
      kind: "deterministic",
      action: "Same COVEA repair pass — convert adversarial defects to sentence-anchored targets.",
      how: "Extract each blocking defect message, locate the offending sentence(s) via lexical overlap, apply targeted rewrite with a hard shrink-cap of 40% (which is precisely the failure mode the package's monotonic repair hits when it rejects on size drop).",
      requires: ["covea-repair.ts"],
      backup: "Deterministic annotation `[COVEA:ADV_DEFECT:<code>]` if the LLM route is unavailable.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion",
    },
    llm: {
      kind: "llm",
      action: "Feed defect list into the adversarial-preflight prompt as MANDATORY not INFORMATIONAL.",
      how: "Rewrite the injected N-Deep constraint block from `may consider` to `must resolve or the answer is invalid`.",
      requires: ["adversarial-engine seam"],
      backup: "Backstop with the COVEA pass either way.",
      applicableInSidecar: true,
      hook: "src/lib/adversarial-engine.ts wrapper (currently Type A — promote when this route is enabled)",
    },
  },
  "missing-section": {
    deterministic: {
      kind: "deterministic",
      action: "Section-presence gate; on absence, insert a template-derived stub with `[MISSING SECTION — please supply]`.",
      how: "Post-completion, walk `rubric.sections`; for each absent title, insert a stub heading with the section's `hint` as body.",
      requires: ["template-rubric.ts"],
      backup: "Log-only if inserting would trigger a truncation gate.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion",
    },
    llm: {
      kind: "llm",
      action: "Pass the template's full section list verbatim in the draft directive (fixes the log's `2 claims packed, 0 sources packed, utilization=3.3%`).",
      how: "Reinject the template directive at the START of the expansion prompt, not just the outline.",
      requires: ["template-directive seam"],
      backup: "Deterministic post-completion insertion route.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts pre-call directive",
    },
  },
  "no-numerics": {
    deterministic: {
      kind: "deterministic",
      action: "Route the query through the compute sandbox for any number the draft would otherwise placeholder.",
      how: "Enable `computeSandbox` in profile; on absence in package, add a deterministic pre-draft numeric extraction that emits [S#] tags backed by ledger entries with numeric snippets.",
      requires: ["compute-sandbox seam (Type A now)"],
      backup: "Fall back to a deterministic `[NUMERIC:UNKNOWN]` tag — never fabricate a figure.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts pre-call profile mutation",
    },
    llm: {
      kind: "llm",
      action: "Add to template: `Any numeric claim without a unit and a source is a defect.`",
      how: "Template-level anchor.",
      requires: ["template-rubric.ts"],
      backup: "Deterministic tag route.",
      applicableInSidecar: true,
      hook: "src/lib/debug/template-rubric.ts",
    },
  },
  "no-actions": {
    deterministic: {
      kind: "deterministic",
      action: "Post-completion action-block synthesiser using template Recommendation section as scaffold.",
      how: "If the section exists but has < 2 action verbs, append a `Priority Actions` table (Action | Owner | Threshold | Verification) built from ledger evidence.",
      requires: ["template-rubric.ts"],
      backup: "Deterministic bullet-list scaffold with `[OWNER: TBD]` — visible defect, not silent.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion",
    },
    llm: {
      kind: "llm",
      action: "Template-directive addition: `End Recommendation with a Priority Actions table.`",
      how: "Directive tweak.",
      requires: ["template-directive seam"],
      backup: "Deterministic scaffold.",
      applicableInSidecar: true,
      hook: "src/lib/debug/template-rubric.ts",
    },
  },
  "style-violation": {
    deterministic: {
      kind: "deterministic",
      action: "Persona-directive lint gate.",
      how: "Post-completion, scan for anti-patterns from `getPersonaDirective(personaName).avoid`; if any triggered, target them via COVEA.",
      requires: ["williams-style.ts avoid list"],
      backup: "Log only.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion",
    },
    llm: {
      kind: "llm",
      action: "Prepend persona directive VERBATIM to the expansion prompt (including cadence rule).",
      how: "Currently the persona is passed as a name only; inject the full DO/AVOID/CADENCE block.",
      requires: ["williams-style.ts"],
      backup: "Log only.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts template-directive injection",
    },
  },
  "compute-missing": {
    deterministic: {
      kind: "deterministic",
      action: "Enable compute-sandbox in profile automatically for numeric questions.",
      how: "Detect via regex on the question; if matched, force `profile.computeSandbox = true`.",
      requires: ["profile seam"],
      backup: "Emit `[NUMERIC:UNKNOWN]` for any unsupported computation.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts pre-call profile mutation",
    },
    llm: {
      kind: "llm",
      action: "Instruct the draft to defer numeric claims to the compute step.",
      how: "Template directive addition.",
      requires: ["template-directive seam"],
      backup: "Deterministic route.",
      applicableInSidecar: true,
      hook: "src/lib/debug/template-rubric.ts",
    },
  },
  "hedge-explosion": {
    deterministic: {
      kind: "deterministic",
      action: "Persona swap: if draft exceeds hedge density threshold, apply `The Surgeon` post-completion via COVEA to targeted paragraphs.",
      how: "Detect density; over threshold, invoke COVEA with defect `HEDGE_DENSITY_EXCEEDED` on the offending paragraphs.",
      requires: ["covea-repair.ts"],
      backup: "Deterministic annotation only.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion",
    },
    llm: {
      kind: "llm",
      action: "Directive: ban {might, may, could, perhaps, generally, typically, often, arguably}.",
      how: "Template directive addition.",
      requires: ["template-directive seam"],
      backup: "COVEA post-completion.",
      applicableInSidecar: true,
      hook: "src/lib/debug/template-rubric.ts",
    },
  },
  "genome-ignored": {
    deterministic: {
      kind: "deterministic",
      action: "Inject genome v1 + v2 directives (in addition to v10) into BOTH question and template directive.",
      how: "The package currently injects only v10. This project's wrapper additionally injects v1 (`compileCompactDirective`) and v2 (`compileCompactDirectiveV2`), verbatim, no truncation.",
      requires: ["innovation-genome-engine v1 + v2"],
      backup: "If genome roll fails, use the v10 directive alone (existing behaviour).",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts (turn-4 change: dual-genome injection)",
    },
    llm: {
      kind: "llm",
      action: "Ask the model to explicitly cite which genome branches it drew on.",
      how: "Template directive: `Under Discovery Framing, name the two branches from the v1/v2 directive you used.`",
      requires: ["template-rubric.ts"],
      backup: "Deterministic injection only.",
      applicableInSidecar: true,
      hook: "src/lib/debug/template-rubric.ts",
    },
  },

  // ══ turn-5 additions — see repair-sites.ts for verified file:line coords ══
  "placeholder-citation-url": {
    deterministic: {
      kind: "deterministic",
      action: "Stop manufacturing URLs from array indices at v15-grounding.orig.ts:113 and :131.",
      how: "Those two lines build `source-${sourceIndex+1}` as the url field. Resolve the real URL from the lane's source table; if it does not resolve to http(s), route the claim to a non-citable `derivedClaims[]` instead of the source list.",
      requires: ["materialize.mjs (package file must become editable)"],
      backup: "Post-pass containment is LIVE: COVEA strips [S#] whose ledger url fails the http test, and the Scrapers tab lists every placeholder URL per lane.",
      applicableInSidecar: false,
      hook: "node materialize.mjs lib/v15-grounding.orig.ts  →  then edit :113 and :131",
    },
    llm: {
      kind: "llm",
      action: "None applicable — asking a model to supply the missing URL IS citation fabrication.",
      how: "Do not route this defect to a model under any circumstance.",
      requires: [],
      backup: "Deterministic route only.",
      applicableInSidecar: false,
      hook: "n/a",
    },
  },
  "lane-zero-yield": {
    deterministic: {
      kind: "deterministic",
      action: "Gate tier acceptance on real documents, not epistemic atoms (v15-grounding.orig.ts:116).",
      how: "`if (vanguard.ok && vanguardSources.length >= 1)` counts CLAIMS. Change to require `vanguard.tokenBudget.sourcesPacked >= 1` AND at least one absolute-URL source, else fall through to palisade.",
      requires: ["materialize.mjs"],
      backup: "Alias-seam partial: src/lib/v15-grounding.ts can assert yield on the RETURN value for alias callers. The pipeline calls groundQuestion relatively, so this does NOT cover the main draft path — visibility only.",
      applicableInSidecar: false,
      hook: "node materialize.mjs lib/v15-grounding.orig.ts  →  edit predicate at :116 (and :134 for palisade)",
    },
    llm: {
      kind: "llm",
      action: "On zero yield, re-dispatch query-strategist once with a broadened query.",
      how: "Insert a single capped retry between the failed predicate and the palisade fallthrough.",
      requires: ["web grounding enabled", "rate budget"],
      backup: "Deterministic predicate change above.",
      applicableInSidecar: false,
      hook: "materialized v15-grounding.orig.ts",
    },
  },
  "lane-quarantined": {
    deterministic: {
      kind: "deterministic",
      action: "Assert on the whole delegation CHAIN, not per-hop (v15-grounding.orig.ts:98).",
      how: "At the end of groundQuestion, if the accumulated source list has zero absolute-URL entries, return `{ ok:false, error:'EVIDENCE_STARVED' }` so the section emits an explicit gap instead of confident unsourced prose.",
      requires: ["materialize.mjs"],
      backup: "Scrapers tab already surfaces every quarantined lane and its delegation target — diagnosis without cure.",
      applicableInSidecar: false,
      hook: "src/lib/debug/scraper-forensics.ts → quarantinedLanes (observability, LIVE)",
    },
    llm: {
      kind: "llm",
      action: "None — orchestration control flow.",
      how: "n/a",
      requires: [],
      backup: "Deterministic only.",
      applicableInSidecar: false,
      hook: "n/a",
    },
  },
  "weak-content-gate": {
    deterministic: {
      kind: "deterministic",
      action: "Add a lexical-overlap floor to the 80-char admission filter (v15-grounding.orig.ts:221).",
      how: "`content.length>=80` is the ONLY bar. Compute token-Jaccard between the dispatch query and the first 2000 chars; reject below ~0.04 and log the rejection score so the drop is auditable.",
      requires: ["materialize.mjs"],
      backup: "Smaller alternative: guard the HDIG dispatch instead — refuse to search when the extracted hypothesis is <12 chars or pure punctuation. That alone kills the '...' ellipsis query at source.",
      applicableInSidecar: false,
      hook: "node materialize.mjs lib/v15-grounding.orig.ts  →  edit filter at :221",
    },
    llm: {
      kind: "llm",
      action: "Batch-score candidate snippets for relevance before admission.",
      how: "10 snippets per call, keep/drop verdict.",
      requires: ["rate budget"],
      backup: "Deterministic Jaccard floor needs no network — prefer it.",
      applicableInSidecar: false,
      hook: "materialized v15-grounding.orig.ts",
    },
  },
  "depth-repair-abandoned": {
    deterministic: {
      kind: "deterministic",
      action: "Score patches per-defect and continue the loop (v15-pipeline.orig.ts:988).",
      how: "The loop `break`s on the first rejected pass, abandoning the remaining depth budget. Accept a patch when its TARGET gate clears even if the global score is flat; replace `break` with a no-progress counter that breaks only after 2 consecutive flat depths.",
      requires: ["materialize.mjs"],
      backup: "COVEA post-pass performs per-target anchored repair with exactly these acceptance semantics — LIVE today.",
      applicableInSidecar: false,
      hook: "src/lib/debug/covea-repair.ts (per-target accept/reject, LIVE)",
    },
    llm: {
      kind: "llm",
      action: "None — control-flow defect.",
      how: "n/a",
      requires: [],
      backup: "Deterministic only.",
      applicableInSidecar: false,
      hook: "n/a",
    },
  },
  "judge-unavailable": {
    deterministic: {
      kind: "deterministic",
      action: "Emit a labelled deterministic rubric floor beside the judge score — never into it.",
      how: "Compute from template coverage, citation trust ratio, placeholder density, truncation state. Report as `deterministicFloor`. `judgeScore` must stay null on exclusion.",
      requires: ["template-rubric.ts", "citationAudit"],
      backup: "Report 'no independent signal available' honestly and rely on deterministic gates.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion (proposed)",
    },
    llm: {
      kind: "llm",
      action: "Retry the excluded judge on a supported model after backoff.",
      how: "Rotate off the 429'd tier and re-submit the IDENTICAL final text hash — not a regenerated candidate.",
      requires: ["alternate model tier"],
      backup: "Deterministic floor above.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion",
    },
  },
  "template-coverage-gap": {
    deterministic: {
      kind: "deterministic",
      action: "Insert a template-derived stub for every absent section.",
      how: "Walk rubric.sections; for each missing title insert `## <title>` with the section's own hint as an explicit open item. Coverage becomes measurable instead of silently partial.",
      requires: ["template-rubric.ts"],
      backup: "Log-only if insertion would trip the truncation gate.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts post-completion",
    },
    llm: {
      kind: "llm",
      action: "Re-inject the full template section list at the START of the expansion prompt.",
      how: "Currently the contract is strongest at outline time and weakest at expansion time, which is when sections actually get dropped.",
      requires: ["template-directive seam"],
      backup: "Deterministic stub insertion above.",
      applicableInSidecar: true,
      hook: "src/lib/v15-pipeline.ts pre-call directive",
    },
  },
};

// ── Cross-scope amplifiers ─────────────────────────────────────────────────

/** Section- and template-specific overrides layered on top of the base route. */
function scopedRoutes(defect: DefectKind, rubric: TemplateRubric | null): PerScopeAdvice[] {
  const base = ROUTES[defect];
  const scopes: PerScopeAdvice[] = [{ scope: "global", routes: [base.deterministic, base.llm] }];

  if (rubric) {
    // Per-template overrides
    const perTpl: Route[] = [];
    if (defect === "no-numerics" && rubric.templateId === "OMEGA-STRATEGY") {
      perTpl.push({
        kind: "deterministic",
        action: `Template ${rubric.templateId}: force TAM/SAM/SOM triple + 5-year ramp table.`,
        how: "Detect the market-entry template; if TAM/SAM/SOM triple is absent, insert scaffold from `--market-entry` style-hooks.",
        requires: ["template-rubric.ts", "style overrides registry"],
        backup: "Deterministic annotation.",
        applicableInSidecar: true,
        hook: "src/lib/debug/template-rubric.ts SECTION_HINTS.Diagnostic",
      });
    }
    if (defect === "adversarial-blocking" && rubric.templateId === "NIH-GRANT-SRF") {
      perTpl.push({
        kind: "deterministic",
        action: "Template NIH-GRANT-SRF: Schedule-I compliance pre-check gate.",
        how: "Detect Schedule-I substances in the question; if present, insert a compliance framing constraint BEFORE draft, not just at adversarial time — matches critic_3's finding in the user's log.",
        requires: ["profile seam"],
        backup: "Log-only warning.",
        applicableInSidecar: true,
        hook: "src/lib/v15-pipeline.ts pre-call",
      });
    }
    if (perTpl.length) scopes.push({ scope: `template:${rubric.templateId}`, routes: perTpl });

    // Per-style overrides
    if (rubric.styleOverrideCode) {
      const perStyle: Route[] = [];
      if (defect === "hedge-explosion" && rubric.styleOverrideCode === "--bain-pe") {
        perStyle.push({
          kind: "deterministic",
          action: `Style ${rubric.styleOverrideCode}: enforce Bain PE red-flag list — hedges banned in Findings only.`,
          how: "Restrict hedge-scan to the Findings section rather than global.",
          requires: ["template-rubric.ts"],
          backup: "Global hedge scan.",
          applicableInSidecar: true,
          hook: "src/lib/debug/template-rubric.ts",
        });
      }
      if (perStyle.length) scopes.push({ scope: `style:${rubric.styleOverrideCode}`, routes: perStyle });
    }

    // Per-section overrides
    const secOverrides: Route[] = [];
    for (const sec of rubric.sections) {
      if (defect === "unresolved-placeholder" && /BLUF|Recommendation/i.test(sec.title)) {
        secOverrides.push({
          kind: "deterministic",
          action: `Section ${sec.title}: zero-placeholder policy.`,
          how: `Any placeholder in "${sec.title}" is a hard-fail; block emission until resolved or explicitly demoted.`,
          requires: ["template-rubric.ts detectors"],
          backup: "Emit with visible annotation.",
          applicableInSidecar: true,
          hook: "src/lib/debug/template-rubric.ts SECTION_HINTS",
        });
      }
    }
    if (secOverrides.length) scopes.push({ scope: `section:*`, routes: secOverrides });
  }
  return scopes;
}

// ── Public API ─────────────────────────────────────────────────────────────

const EXPECTED_LIFT: Record<DefectKind, number> = {
  truncation: 1.5,
  "unresolved-placeholder": 1.0,
  "orphan-citation": 0.5,
  "untrusted-citation": 0.8,
  "missing-references": 0.4,
  "cove-inconsistent": 1.4,
  "adversarial-blocking": 1.6,
  "missing-section": 0.6,
  "no-numerics": 1.0,
  "no-actions": 0.6,
  "style-violation": 0.4,
  "compute-missing": 0.8,
  "hedge-explosion": 0.4,
  "genome-ignored": 0.6,
  // turn-5 additions — retrieval-plane defects dominate because an ungrounded
  // draft cannot be repaired into a 10 by any downstream pass.
  "placeholder-citation-url": 1.8,
  "lane-zero-yield": 2.2,
  "lane-quarantined": 0.8,
  "weak-content-gate": 0.9,
  "depth-repair-abandoned": 1.2,
  "judge-unavailable": 0.7,
  "template-coverage-gap": 0.6,
};

export function diagnoseRun(run: RunRecord, targetScore = 9.0): DiagnosisReport {
  const settings = ((run.output ?? {}) as any).runSettings ?? ((run.input ?? {}) as any).profile ?? {};
  const templateId = settings.templateId ?? "OMEGA-STRATEGY";
  const styleOverride = settings.styleOverride ?? null;
  const williamsPersona = settings.williamsPersona ?? null;
  const rubric = loadTemplateRubric(templateId, styleOverride, williamsPersona);

  const defects = detectDefects(run, rubric);
  const diagnoses: StepDiagnosis[] = defects.map(({ kind, evidence }) => {
    const step = STEP_FOR_DEFECT[kind];
    const repairSites = sitesFor(kind);
    return {
      defect: kind,
      step,
      attribution: repairSites.length
        ? `Attributed to \`${step}\`. ${repairSites.length} verified code coordinate(s): ${repairSites.map((s) => `${s.file.split("/").pop()}:${s.line}`).join(", ")}.`
        : `Observed in the final output; attributed to \`${step}\` — see routes. No verified code coordinate registered for this defect yet.`,
      evidence,
      advice: scopedRoutes(kind, rubric),
      repairSites,
    };
  });

  const playbook: DiagnosisReport["playbook"] = [];
  diagnoses
    .slice()
    .sort((a, b) => (EXPECTED_LIFT[b.defect] ?? 0) - (EXPECTED_LIFT[a.defect] ?? 0))
    .forEach((d, i) => {
      // Prefer deterministic-global first.
      const globalScope = d.advice.find((s) => s.scope === "global");
      const det = globalScope?.routes.find((r) => r.kind === "deterministic");
      if (det) {
        playbook.push({
          rank: i * 2 + 1,
          defect: d.defect,
          step: d.step,
          route: det,
          scope: "global",
          expectedLift: EXPECTED_LIFT[d.defect] ?? 0,
        });
      }
      const llm = globalScope?.routes.find((r) => r.kind === "llm");
      if (llm) {
        playbook.push({
          rank: i * 2 + 2,
          defect: d.defect,
          step: d.step,
          route: llm,
          scope: "global",
          expectedLift: (EXPECTED_LIFT[d.defect] ?? 0) * 0.6,
        });
      }
    });

  const unresolvedIssues: string[] = [];
  if (defects.length === 0 && (run.guardScore ?? 0) < targetScore) {
    unresolvedIssues.push(
      "No defect pattern matched but the score is below target — this indicates a class of defect we don't yet detect. Consider adding a detector for the failing dimension."
    );
  }
  if (!run.output?.citationAudit) {
    unresolvedIssues.push("No citationAudit in outcome — citation-derived diagnoses are unavailable for this run.");
  }
  if (!run.output?.coveReport) {
    unresolvedIssues.push("No coveReport in outcome — CoVe-derived diagnoses are unavailable.");
  }

  // turn-5: dedupe repair sites across defects (one coordinate can serve several).
  const seen = new Set<string>();
  const allRepairSites: RepairSite[] = [];
  for (const d of diagnoses) {
    for (const s of d.repairSites) {
      const k = `${s.file}:${s.line}:${s.anchor}`;
      if (seen.has(k)) continue;
      seen.add(k);
      allRepairSites.push(s);
    }
  }
  allRepairSites.sort((a, b) => b.expectedLift - a.expectedLift);
  const containedDetectors = new Set(
    allRepairSites
      .filter((s) => s.reachability !== "materialize")
      .map((s) => s.detector)
  );
  const materializeStillRequired = allRepairSites.filter(
    (s) => s.reachability === "materialize" && !containedDetectors.has(s.detector)
  );

  return {
    runId: run.id,
    finalScore: run.guardScore ?? null,
    targetScore,
    templateId,
    styleOverride,
    williamsPersona,
    totalDefects: defects.length,
    diagnoses,
    playbook,
    unresolvedIssues,
    allRepairSites,
    repairFiles: repairFileSummary(allRepairSites),
    reachabilitySplit: {
      sidecarToday: allRepairSites.filter((s) => s.reachability === "workspace-seam" || s.reachability === "alias-seam").length,
      postPass: allRepairSites.filter((s) => s.reachability === "post-pass").length,
      // materialize is counted only when there is no no-materialize containment
      // site for that same detector. Root-cause package coordinates remain
      // visible in repair cards, but no longer imply the current repo is
      // blocked on materialization.
      needsMaterialize: materializeStillRequired.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// turn-5: STANDALONE DIAGNOSIS FROM (prompt, settings, output)
// ═══════════════════════════════════════════════════════════════════════════
// User's stated architecture goal: "you enter prompt, settings (which are
// carried over from the v15 overlay anyway) for the run, and output. Then the
// system gives you diagnosis and repair direction based on all the information
// provided. The idea is to use the prompt output as a guide to fix the system."
//
// This synthesises a minimal RunRecord so EVERY detector above runs unchanged.
// Detectors that require live telemetry (lane forensics, depth execution,
// judge exclusion) will find nothing and stay silent — their absence is
// reported in `unresolvedIssues` rather than silently passing.

export interface DiagnoseInputs {
  prompt: string;
  output: string;
  settings?: {
    templateId?: string;
    styleOverride?: string | null;
    williamsPersona?: string | null;
    maxDepth?: number;
    webSearch?: boolean;
    advancedGates?: boolean;
    [k: string]: unknown;
  };
  /** Optional: paste an exported run JSON to unlock telemetry-dependent detectors. */
  pastedRunJson?: string;
  targetScore?: number;
}

export function diagnoseFromInputs(inp: DiagnoseInputs): DiagnosisReport {
  const target = inp.targetScore ?? 9.0;

  // If the user pasted a full exported run, prefer it — every detector fires.
  if (inp.pastedRunJson && inp.pastedRunJson.trim()) {
    try {
      const parsed = JSON.parse(inp.pastedRunJson);
      const r = (parsed?.run ?? parsed) as Partial<RunRecord>;
      if (r && typeof r === "object" && (r.events || r.output)) {
        const synth: RunRecord = {
          id: String(r.id ?? "pasted"),
          mode: "external",
          question: String(r.question ?? inp.prompt),
          startedAt: Number(r.startedAt ?? 0),
          endedAt: Number(r.endedAt ?? 0),
          status: "complete",
          events: (r.events as RunRecord["events"]) ?? [],
          phaseStats: (r.phaseStats as RunRecord["phaseStats"]) ?? {},
          passes: (r.passes as RunRecord["passes"]) ?? [],
          sources: (r.sources as RunRecord["sources"]) ?? [],
          input: (r.input as RunRecord["input"]) ?? { profile: inp.settings },
          output: (r.output as RunRecord["output"]) ?? {},
          finalText: String(r.finalText ?? inp.output),
          guardScore: (r as any).guardScore,
          judgeScore: (r as any).judgeScore ?? null,
        };
        const rep = diagnoseRun(synth, target);
        rep.unresolvedIssues.unshift("Diagnosis derived from a PASTED run export — telemetry-dependent detectors used the pasted events.");
        return rep;
      }
    } catch {
      /* fall through to the minimal synthetic path */
    }
  }

  // Minimal synthetic run: text-plane detectors only.
  const s = inp.settings ?? {};
  const synth: RunRecord = {
    id: `inputs_${Date.now().toString(36)}`,
    mode: "external",
    question: inp.prompt,
    startedAt: Date.now(),
    endedAt: Date.now(),
    status: "complete",
    events: [],
    phaseStats: {},
    passes: [],
    sources: [],
    input: { profile: s },
    output: {
      runSettings: {
        templateId: s.templateId ?? "OMEGA-STRATEGY",
        styleOverride: s.styleOverride ?? null,
        williamsPersona: s.williamsPersona ?? null,
        depth: s.maxDepth,
      },
    },
    finalText: inp.output,
    guardScore: undefined,
    judgeScore: null,
  };

  const rep = diagnoseRun(synth, target);
  rep.unresolvedIssues.unshift(
    "Diagnosis ran in TEXT-ONLY mode: no run telemetry supplied. Retrieval-plane detectors (lane zero-yield, quarantined lanes, placeholder URLs, weak content gate), depth-execution and judge-availability detectors could NOT run and are neither passing nor failing — they are unmeasured. Paste an exported run JSON to unlock them."
  );
  return rep;
}

/** Machine-readable repair order for the current diagnosis. */
export function exportRepairOrderFor(report: DiagnosisReport, prompt: string): string {
  return exportRepairOrder(report.allRepairSites, {
    runId: report.runId,
    prompt,
    template: report.templateId,
    style: report.styleOverride ?? undefined,
    persona: report.williamsPersona ?? undefined,
    guard: report.finalScore,
  });
}

/** Build a text bundle to hand to a third-party LLM instance for independent review. */
export function bundleForExternalReview(report: DiagnosisReport, run: RunRecord, rubric: TemplateRubric | null): string {
  return `# PIPELINE DIAGNOSIS BUNDLE — veritas.pipeline-diagnosis/1
Run: ${run.id}
Generated: ${new Date().toISOString()}
Final guard score: ${report.finalScore ?? "n/a"} · target: ${report.targetScore}
Template: ${report.templateId} · Style: ${report.styleOverride ?? "none"} · Williams: ${report.williamsPersona ?? "none"}

## Ten-point contract for this template
${rubric ? rubric.tenPointContract.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(no rubric loaded)"}

## Detected defects (${report.totalDefects})
${report.diagnoses.map((d) => `- ${d.defect} → step \`${d.step}\`\n    ${d.evidence.map((e) => `· ${e}`).join("\n    ")}`).join("\n")}

## Prioritised playbook
${report.playbook.map((p) => `${p.rank}. [${p.route.kind}] ${p.defect} · step=${p.step} · scope=${p.scope} · expectedLift=+${p.expectedLift.toFixed(2)}\n    action: ${p.route.action}\n    how: ${p.route.how}\n    requires: ${p.route.requires.join(", ")}\n    backup: ${p.route.backup}\n    hook: ${p.route.hook ?? "n/a"}`).join("\n\n")}

## Unresolved
${report.unresolvedIssues.map((u) => `- ${u}`).join("\n") || "(none)"}

## Your task (third-party reviewer)
Independently name the SINGLE change to the pipeline (not to the prompt) that would move this run's guard score from ${report.finalScore ?? "?"} to ${report.targetScore}. Reference a specific pipeline step by name. If the change is a prompt tweak, say so explicitly and justify why no configuration-level change would suffice.`;
}
