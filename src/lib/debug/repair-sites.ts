/**
 * repair-sites.ts — NET-NEW (Type C). See flatten-guide.md.
 * ===========================================================================
 * EXACT CODE COORDINATES FOR EVERY DIAGNOSED DEFECT.
 *
 * Turn-5 ask: "for diagnosis, much more specific about exactly code repair the
 * repo as which file, line, etc."
 *
 * ═══ PROVENANCE DISCIPLINE ═══
 * Every `line` and `anchor` below was obtained by grepping the INSTALLED
 * package in this workspace during turn 5. Each entry ships a `verifyCmd`
 * so you can re-confirm the coordinate yourself in one command — line numbers
 * drift when the package version changes, and the anchor string is the
 * durable identifier, not the number.
 *
 * If a `verifyCmd` returns a different line than `line`, TRUST THE ANCHOR.
 *
 * ═══ REACHABILITY ═══
 *   workspace-seam  fixable today in src/, package untouched
 *   alias-seam      reachable because the consumer imports via `@/...`
 *   post-pass       not interceptable; fix runs AFTER the package returns
 *   materialize     requires `node materialize.mjs <file>` to become editable
 * ===========================================================================
 */

export type Reachability = "workspace-seam" | "alias-seam" | "post-pass" | "materialize";

export interface RepairRoute {
  action: string;
  /** Precisely what to change, in code terms. */
  change: string;
  /** What must hold after the change for it to count as fixed. */
  verify: string;
  /** What to do if this route's dependency is unavailable. */
  fallback: string;
}

export interface RepairSite {
  /** Detector id this site repairs. */
  detector: string;
  file: string;
  /** Line as verified in this workspace at turn 5. Anchor is authoritative. */
  line: number;
  symbol: string;
  /** Verbatim source substring — the durable identifier. */
  anchor: string;
  /** The actual code at that coordinate, copied verbatim from the package. */
  currentCode: string;
  /** Why this exact line causes the observed defect. */
  mechanism: string;
  reachability: Reachability;
  /** One-shot command to re-confirm the coordinate. */
  verifyCmd: string;
  deterministic: RepairRoute;
  llm: RepairRoute;
  /** Where the durable workspace fix lives (or would live). */
  durableHook: string;
  /** Estimated guard-score lift if repaired. */
  expectedLift: number;
}

export const REPAIR_SITES: RepairSite[] = [
  // ══════════════════════════════════════════════════════════════════════
  // WORKSPACE CONTAINMENT — no materialize.mjs required
  // ══════════════════════════════════════════════════════════════════════
  {
    detector: "lane-zero-yield",
    file: "src/lib/v15-grounding.ts",
    line: 36,
    symbol: "groundQuestion workspace wrapper → post-return yield assertion",
    anchor: "EVIDENCE_STARVED",
    currentCode:
      "error: `EVIDENCE_STARVED: ${sources.length} atom/proxy source(s), 0 resolvable URL(s)`,",
    mechanism:
      "Alias callers now fail closed when a grounding result contains only atom/proxy records and zero resolvable URLs. This is not the package-internal relative path cure, but it repairs the reachable workspace seam and gives the rest of the app a deterministic no-materialize guard.",
    reachability: "workspace-seam",
    verifyCmd: "grep -n 'EVIDENCE_STARVED' src/lib/v15-grounding.ts",
    deterministic: {
      action: "Fail closed on zero URL-backed yield in the workspace alias seam.",
      change:
        "Return `ok:false`, `error:EVIDENCE_STARVED`, `sources:[]`, and an evidence block instructing the draft to emit an explicit data gap rather than confident prose.",
      verify: "Alias callers of `@/lib/v15-grounding` cannot receive `ok:true` with zero absolute URLs.",
      fallback: "COVEA post-pass strips resulting invalid citations if the package relative path still admits them.",
    },
    llm: { action: "None — deterministic provenance gate.", change: "N/A", verify: "N/A", fallback: "Deterministic only." },
    durableHook: "src/lib/v15-grounding.ts (LIVE)",
    expectedLift: 1.2,
  },
  {
    detector: "placeholder-citation-url",
    file: "src/lib/debug/covea-repair.ts",
    line: 225,
    symbol: "stripInvalidCitationTags → grouped and single tag containment",
    anchor: "function stripInvalidCitationTags",
    currentCode:
      "function stripInvalidCitationTags(text: string, badIds: Set<number>): { text: string; actions: string[] } {",
    mechanism:
      "Post-pass containment removes every citation tag whose ledger entry is missing, untrusted, non-http, CSS-reset content, or zero-overlap with the question. It handles grouped tags like `[S3, S4]` as well as single `[S3]` tags.",
    reachability: "post-pass",
    verifyCmd: "grep -n 'function stripInvalidCitationTags' src/lib/debug/covea-repair.ts",
    deterministic: {
      action: "Strip invalid citation tags after the package returns, including grouped tags.",
      change: "Compute bad ids from `citationAudit.entries` and `auditResults`, then remove only those ids from the draft.",
      verify: "COVEA `deterministicActions` lists every removed [S#]; final draft contains no invalid ids.",
      fallback: "If no audit exists, leave text unchanged and surface unmeasured state in Diagnosis.",
    },
    llm: { action: "Localized recast only after deterministic strip.", change: "Use LLM only to recast an anchor sentence after bad tags are removed.", verify: "Anchor must match exactly once.", fallback: "Deterministic strip remains valid." },
    durableHook: "src/lib/debug/covea-repair.ts (LIVE)",
    expectedLift: 1.1,
  },
  {
    detector: "weak-content-gate",
    file: "src/lib/debug/covea-repair.ts",
    line: 215,
    symbol: "invalidCitationIds → CSS reset / zero-overlap quarantine",
    anchor: "sourceWordOverlap(question, text) === 0",
    currentCode:
      "if (!isRealUrl(entry.url) || isCssResetSnippet(text) || sourceWordOverlap(question, text) === 0) bad.add(id);",
    mechanism:
      "The no-materialize containment path now quarantines irrelevant admitted records such as CSS reset blobs, genome-protocol pages for cannabis-market questions, and other zero-overlap sources before their [S#] tags can survive the final answer.",
    reachability: "post-pass",
    verifyCmd: "grep -n 'sourceWordOverlap(question, text)' src/lib/debug/covea-repair.ts",
    deterministic: {
      action: "Quarantine CSS-reset and zero-overlap citation ids in COVEA.",
      change: "Treat those ids as invalid and run the same grouped-tag strip path.",
      verify: "A CSS-reset snippet or zero-overlap source cannot keep a citation tag in final text.",
      fallback: "Diagnosis still reports weak-content-gate if run telemetry lacks citationAudit.",
    },
    llm: { action: "None for quarantine; optional local sentence recast after strip.", change: "N/A", verify: "N/A", fallback: "Deterministic only." },
    durableHook: "src/lib/debug/covea-repair.ts (LIVE)",
    expectedLift: 0.9,
  },
  {
    detector: "unresolved-placeholder",
    file: "src/lib/debug/covea-repair.ts",
    line: 244,
    symbol: "normalizeBarePlaceholders → explicit open-item conversion",
    anchor: "function normalizeBarePlaceholders",
    currentCode:
      "function normalizeBarePlaceholders(text: string): { text: string; actions: string[] } {",
    mechanism:
      "Bare `[DATA GAP]` / `[ASSUMPTION]` markers are no longer left as fake-shaped quantities. COVEA converts them into explicit open-input or explicit-assumption markers requiring owner/source/formula/sensitivity before 10/10 sign-off.",
    reachability: "post-pass",
    verifyCmd: "grep -n 'function normalizeBarePlaceholders' src/lib/debug/covea-repair.ts",
    deterministic: {
      action: "Convert bare placeholder tokens into explicit open-item markers.",
      change: "Replace `[DATA GAP]`/`[TBD]` with `[OPEN_INPUT: ...]` and `[ASSUMPTION]` with `[EXPLICIT_ASSUMPTION: ...]`.",
      verify: "No bare `[DATA GAP]`, `[TBD]`, or `[ASSUMPTION]` token survives COVEA.",
      fallback: "If the user wants zero unresolved markers, block publication rather than fabricate values.",
    },
    llm: { action: "Classify impact only.", change: "Use model to classify owner/input, never to supply the missing value.", verify: "No invented numeric value.", fallback: "Deterministic marker conversion." },
    durableHook: "src/lib/debug/covea-repair.ts (LIVE)",
    expectedLift: 0.8,
  },

  // ══════════════════════════════════════════════════════════════════════
  // THE PLACEHOLDER-URL BUG — root cause of every `source-N` in your ledger
  // ══════════════════════════════════════════════════════════════════════
  {
    detector: "placeholder-citation-url",
    file: "../v15-grounding.orig",
    line: 113,
    symbol: "groundQuestion → vanguard tier → vanguardSources.map()",
    anchor: 'vanguard-attested',
    currentCode:
      'url: c.atomBindings[0]?.sourceIndex !== undefined ? `source-${c.atomBindings[0].sourceIndex + 1}` : "vanguard-attested",',
    mechanism:
      "This line MANUFACTURES the url field from an array index. `source-3` is not a URL — it is the string 'source-' concatenated with an integer. Every `source-1`/`source-2`/`source-3` entry in your citation ledger was born here. The downstream citation audit then correctly marks them untrusted, but the damage is upstream: a claim was already written against a citation that can never resolve.",
    reachability: "materialize",
    verifyCmd: "grep -n 'vanguard-attested' node_modules/src/lib/v15-grounding.orig.ts",
    deterministic: {
      action: "Resolve the real URL from the vanguard source table, or refuse to emit the claim as a source.",
      change:
        "Use `c.atomBindings[0].sourceIndex` as an index into `vanguard.sources` and emit `vanguard.sources[idx].url`. If the index does not resolve to an absolute http(s) URL, do NOT push the claim into `vanguardSources` — route it to a separate `derivedClaims[]` field that the evidence block may quote but the citation ledger may never cite.",
      verify:
        "After the fix, `citationAudit.entries.every(e => /^https?:\\/\\//.test(e.url))` must be true for every vanguard-sourced entry.",
      fallback:
        "Workspace post-pass (already live): COVEA strips any [S#] whose ledger url fails the http test, and the Scrapers tab lists every placeholder URL by lane.",
    },
    llm: {
      action: "None applicable — this is a pure data-plumbing defect.",
      change:
        "Do not ask a model to 'find the real URL'. That is the exact mechanism by which citation fabrication occurs. The URL either exists in the source table or the claim is not citable.",
      verify: "N/A",
      fallback: "Deterministic route only.",
    },
    durableHook: "src/lib/debug/covea-repair.ts → stripUntrustedCitationTags (containment, not cure)",
    expectedLift: 1.8,
  },
  {
    detector: "placeholder-citation-url",
    file: "../v15-grounding.orig",
    line: 131,
    symbol: "groundQuestion → palisade tier → palisadeSources.map()",
    anchor: 'palisade-attested',
    currentCode:
      'url: c.atomBindings[0]?.sourceIndex !== undefined ? `source-${c.atomBindings[0].sourceIndex + 1}` : "palisade-attested",',
    mechanism:
      "Identical defect to :113, duplicated in the palisade tier. Because the logic is copy-pasted rather than shared, fixing one tier silently leaves the other broken.",
    reachability: "materialize",
    verifyCmd: "grep -n 'palisade-attested' node_modules/src/lib/v15-grounding.orig.ts",
    deterministic: {
      action: "Extract a shared `resolveAtomUrl(claim, sources)` helper used by BOTH tiers.",
      change:
        "Define one helper above line 111 and call it from both :113 and :131. A single implementation makes drift structurally impossible.",
      verify: "grep -c 'source-\\${' on the file must return 0 after the fix.",
      fallback: "Same COVEA containment as :113.",
    },
    llm: { action: "None applicable.", change: "Data-plumbing defect.", verify: "N/A", fallback: "Deterministic only." },
    durableHook: "src/lib/debug/covea-repair.ts",
    expectedLift: 0.6,
  },

  // ══════════════════════════════════════════════════════════════════════
  // THE ZERO-YIELD ACCEPTANCE BUG — lanes 'succeed' with 0 real documents
  // ══════════════════════════════════════════════════════════════════════
  {
    detector: "lane-zero-yield",
    file: "../v15-grounding.orig",
    line: 116,
    symbol: "groundQuestion → vanguard acceptance predicate",
    anchor: "if (vanguard.ok && vanguardSources.length >= 1)",
    currentCode: "if (vanguard.ok && vanguardSources.length >= 1) {",
    mechanism:
      "`vanguardSources` counts CLAIMS (epistemic atoms), not documents. Your log shows `vanguard: 7 claims packed, 0 sources packed, utilization=6.6%` immediately followed by `grounded [...]: +2 source(s)` — the predicate passed on atoms while `tokenBudget.sourcesPacked` was literally 0. The pipeline then drafts confident prose believing it is grounded. This is the single highest-leverage retrieval fix in the codebase.",
    reachability: "materialize",
    verifyCmd: "grep -n 'vanguardSources.length >= 1' node_modules/src/lib/v15-grounding.orig.ts",
    deterministic: {
      action: "Require real document yield, not atom yield, before accepting the tier.",
      change:
        "Change the predicate to `if (vanguard.ok && vanguard.tokenBudget.sourcesPacked >= 1 && vanguardSources.some(s => /^https?:\\/\\//.test(s.url)))`. On failure, fall through to palisade instead of returning.",
      verify:
        "Re-run the same question; the Scrapers tab `zeroYieldLanes` array must be empty, and no section may report `+N source(s)` while its lane reports `0 sources packed`.",
      fallback:
        "Workspace alias-seam: `src/lib/v15-grounding.ts` can wrap the exported `groundQuestion` and assert yield on the RETURN value, marking the section EVIDENCE_STARVED. Note this only intercepts alias callers — the pipeline calls it relatively, so this fallback does not cover the main draft path.",
    },
    llm: {
      action: "On zero yield, re-dispatch query-strategist with a broadened query before giving up.",
      change: "Insert a single broadened retry between the failed predicate and the palisade fallthrough.",
      verify: "Retry must be capped at 1 per section to avoid unbounded retrieval cost.",
      fallback: "Deterministic predicate change above.",
    },
    durableHook: "src/lib/v15-grounding.ts (alias-seam, partial coverage) + Scrapers tab D14 detector (full visibility)",
    expectedLift: 2.2,
  },
  {
    detector: "lane-quarantined",
    file: "../v15-grounding.orig",
    line: 98,
    symbol: "groundQuestion → portfolio delegation",
    anchor: "portfolio: no acceptable result; delegating to vanguard",
    currentCode: 'opts.onDebug?.("portfolio: no acceptable result; delegating to vanguard");',
    mechanism:
      "The portfolio orchestrator narrates its own failure and moves on. There is no aggregate assertion that the delegation CHAIN eventually produced evidence — each hop only checks its own tier. Your log shows this line firing 6 times across sections, ending with sources that were all placeholder URLs.",
    reachability: "materialize",
    verifyCmd: "grep -n 'no acceptable result' node_modules/src/lib/v15-grounding.orig.ts",
    deterministic: {
      action: "Add a terminal assertion after the whole delegation chain.",
      change:
        "At the end of `groundQuestion`, if the accumulated source list contains zero absolute-URL entries, return `{ ok: false, error: 'EVIDENCE_STARVED', sources: [] }` rather than a list of attested atoms.",
      verify: "A starved section must produce an explicit [DATA GAP] with owner, not confident unsourced prose.",
      fallback: "Scrapers tab already surfaces every quarantined lane with its delegation target.",
    },
    llm: { action: "None — orchestration control flow.", change: "N/A", verify: "N/A", fallback: "Deterministic only." },
    durableHook: "src/lib/debug/scraper-forensics.ts → quarantinedLanes (observability today)",
    expectedLift: 0.8,
  },
  {
    detector: "weak-content-gate",
    file: "../v15-grounding.orig",
    line: 221,
    symbol: "groundQuestion → native-vnext content admission filter",
    anchor: "s.url && s.content.length>=80",
    currentCode: "}).filter((s)=> s.url && s.content.length>=80)",
    mechanism:
      "80 characters is the ONLY relevance bar. This is why your ledger admitted two Wikipedia entries about the ELLIPSIS PUNCTUATION MARK during HDIG — the HDIG hypothesis string was literally '...' and any page over 80 chars qualified. There is no lexical-overlap floor between source content and the dispatched query.",
    reachability: "materialize",
    verifyCmd: "grep -n 'content.length>=80' node_modules/src/lib/v15-grounding.orig.ts",
    deterministic: {
      action: "Add a lexical-overlap floor between source content and dispatched query.",
      change:
        "Compute token-Jaccard between the query and the first 2000 chars of `s.content`; reject below ~0.04 and record the rejection with its score so the drop is auditable rather than silent.",
      verify: "Re-run the same question; no admitted source may have overlap below the floor with its dispatch query.",
      fallback:
        "Guard the HDIG dispatch instead: refuse to search when the extracted hypothesis is under ~12 chars or is pure punctuation. That kills the '...' query at the source and is a smaller change.",
    },
    llm: {
      action: "Score relevance with a cheap model before admission.",
      change: "Batch 10 candidate snippets per call, return keep/drop.",
      verify: "Adds one model call per section — measure against rate budget.",
      fallback: "Deterministic Jaccard floor, which needs no network.",
    },
    durableHook: "src/lib/debug/pipeline-diagnosis.ts → irrelevant-source detector",
    expectedLift: 0.9,
  },

  // ══════════════════════════════════════════════════════════════════════
  // THE FULL-REWRITE REPAIR BUG — why adversarial fixes never land
  // ══════════════════════════════════════════════════════════════════════
  {
    detector: "adversarial-blocking",
    file: "../v15-pipeline.orig",
    line: 1050,
    symbol: "runV15OnQuestion → adversarial monotonic repair → shrink guard",
    anchor: "adversarial repair: generation failed or shrank too much",
    currentCode:
      'onProgress?.("adversarial repair: generation failed or shrank too much — keeping pre-repair text, defects logged");',
    mechanism:
      "The repair prompt asks the model to regenerate the ENTIRE document. One long generation must beat the old score on every axis simultaneously, so a single truncation or one dropped section discards ALL repairs at once. Your log shows exactly this: 4 blocking defects found, whole-document repair attempted, rejected on size, zero defects fixed, guard stayed 4.4.",
    reachability: "post-pass",
    verifyCmd: "grep -n 'shrank too much' node_modules/src/lib/v15-pipeline.orig.ts",
    deterministic: {
      action: "Replace whole-document rewrite with an anchored find/replace edit list.",
      change:
        "Emit `{anchor, replacement}[]`; apply each independently; a failed edit costs ONE defect instead of the entire repair. Cap each replacement at 1.4× its anchor length and require the anchor to appear exactly once.",
      verify: "Post-repair defect count must strictly decrease. Per-edit accept/reject must be individually logged.",
      fallback:
        "ALREADY IMPLEMENTED as a post-pass in `src/lib/debug/covea-repair.ts` — runs after the package returns, ≤1 paragraph per patch, ≤20% total edit budget, ≥60% region retention, citation tags preserved.",
    },
    llm: {
      action: "Feed defects as MANDATORY rather than INFORMATIONAL constraints.",
      change: "Rewrite the injected N-Deep constraint block from advisory phrasing to a hard validity condition.",
      verify: "Measure defect resolution rate before/after; if unchanged, the constraint text is not the bottleneck.",
      fallback: "COVEA post-pass covers this regardless.",
    },
    durableHook: "src/lib/debug/covea-repair.ts → runCoveaRepair (LIVE)",
    expectedLift: 1.6,
  },
  {
    detector: "missing-references",
    file: "../v15-pipeline.orig",
    line: 514,
    symbol: "runPolishPass → structure/scaffolding fix",
    anchor: "polish pass: fixing structure/scaffolding without changing content",
    currentCode: 'opts.onProgress?.("polish pass: fixing structure/scaffolding without changing content");',
    mechanism:
      "The References section is generated by a MODEL that is asked to list sources. That call is subject to 429/503 (both appear in your logs) and to invention. But the citation ledger already holds title + url + hash for every admitted source — the section is fully derivable with zero model involvement.",
    reachability: "post-pass",
    verifyCmd: "grep -n 'polish pass' node_modules/src/lib/v15-pipeline.orig.ts",
    deterministic: {
      action: "Build References from the citation ledger, not from a model.",
      change:
        "Render `## References` by iterating `citationAudit.entries`, emitting only entries whose url passes the http test. Zero model calls, immune to 503, structurally incapable of inventing a URL.",
      verify: "Every [S#] in the body must appear in References; every References line must carry an absolute URL.",
      fallback: "If the ledger is empty, emit `## References\\n(no admissible sources retrieved)` — honest, not blank.",
    },
    llm: { action: "None needed.", change: "Model involvement is the defect here, not the cure.", verify: "N/A", fallback: "Deterministic only." },
    durableHook: "src/lib/debug/covea-repair.ts → deterministic References synthesis",
    expectedLift: 0.5,
  },
  {
    detector: "cove-inconsistent",
    file: "../v15-pipeline.orig",
    line: 469,
    symbol: "runCoVeVerification → plan prompt assembly",
    anchor: "opts.draft.slice(0, 6000)",
    currentCode: "const planPrompt = `…DRAFT:\\n${opts.draft.slice(0, 6000)}…`;",
    mechanism:
      "CoVe only ever sees the first 6000 characters of the draft. Your 15,679-char draft had ~62% of its body invisible to verification, and the claim cap is 4. Anything in the back half of the report is unverifiable by construction — not because it passed, but because it was never read.",
    reachability: "post-pass",
    verifyCmd: "grep -n 'opts.draft.slice' node_modules/src/lib/v15-pipeline.orig.ts",
    deterministic: {
      action: "Remove the slice; chunk the draft and verify each chunk.",
      change:
        "Replace the single 6000-char window with N sequential windows of ~6000 chars each, union the returned claims, and lift the 4-claim cap to `min(4 * chunks, 16)`.",
      verify: "Claim coverage must span the whole document — assert that at least one verified claim originates past the 60% mark.",
      fallback:
        "ALREADY MITIGATED post-pass: `covea-repair.ts` receives the FULL draft with no slice and re-anchors every CoVe failure against the complete text.",
    },
    llm: { action: "Increase claim count per window.", change: "Raise the per-call claim ask from 4 to 8.", verify: "Watch token budget.", fallback: "Chunking above." },
    durableHook: "src/lib/debug/covea-repair.ts (full draft, no truncation)",
    expectedLift: 1.4,
  },
  {
    detector: "depth-repair-abandoned",
    file: "../v15-pipeline.orig",
    line: 988,
    symbol: "N-Deep loop → localized patch acceptance test",
    anchor: "rejected localized patches (no score or severity improvement)",
    currentCode:
      'onProgress?.(`depth ${d}: rejected localized patches (no score or severity improvement) — stopping instead of rescanning an unchanged draft`);',
    mechanism:
      "The loop `break`s on the FIRST rejected pass, abandoning the entire remaining depth budget. Your run had maxDepth=4 but executed depth 1 only, then stopped. The acceptance test is also global (whole-document guard score) rather than per-defect, so a patch that genuinely fixes defect A is discarded because unrelated defect B still drags the aggregate.",
    reachability: "post-pass",
    verifyCmd: "grep -n 'rejected localized patches' node_modules/src/lib/v15-pipeline.orig.ts",
    deterministic: {
      action: "Score patches per-defect, and continue the loop instead of breaking.",
      change:
        "Accept a patch if the specific gate it targets clears, even when the global score is flat. Replace `break` with `continue` and track a per-depth no-progress counter; break only after 2 consecutive no-progress depths.",
      verify: "A run with maxDepth=4 must execute 4 depths or log an explicit reason per skipped depth.",
      fallback: "COVEA post-pass performs per-defect anchored repair with exactly this acceptance semantics.",
    },
    llm: { action: "None — control-flow defect.", change: "N/A", verify: "N/A", fallback: "Deterministic only." },
    durableHook: "src/lib/debug/covea-repair.ts (per-target accept/reject)",
    expectedLift: 1.2,
  },
  {
    detector: "unresolved-placeholder",
    file: "../v15-pipeline.orig",
    line: 804,
    symbol: "runV15OnQuestion → template directive assembly",
    anchor: "templateId: profile.templateId, onProgress,",
    currentCode: "templateId: profile.templateId, onProgress,",
    mechanism:
      "No section-scoped placeholder policy exists. `[DATA GAP]` inside BLUF or Value-at-Stake is scored as a WARNING by the guard, identical to a placeholder in an appendix. Because the judge panel was fully excluded (429 + JSON parse failure in your log), nothing else caught it and the report shipped with fabricated-shaped `[DATA GAP] USD` figures in the decision section.",
    reachability: "workspace-seam",
    verifyCmd: "grep -n 'templateId: profile.templateId' node_modules/src/lib/v15-pipeline.orig.ts",
    deterministic: {
      action: "Per-section zero-placeholder policy: CRITICAL in decision sections, warning elsewhere.",
      change:
        "In the workspace template rubric, mark BLUF / Recommendation / Value Bridge as zero-placeholder. On violation, rewrite the sentence into an explicit open item — `Not yet sized; requires <input>, owner <role>` — rather than a fake quantity token.",
      verify: "Zero `[DATA GAP]` tokens may survive inside a decision-critical section heading scope.",
      fallback: "COVEA deterministic annotation `[COVEA:PLACEHOLDER_UNRESOLVED]` for reviewer triage.",
    },
    llm: {
      action: "Route the number through the compute sandbox with cited inputs.",
      change: "Force `profile.computeSandbox = true` for numeric questions (already live as G3) and emit a bottom-up estimate with stated assumptions.",
      verify: "Every emitted figure must carry a unit and a compute record.",
      fallback: "Deterministic open-item restatement above.",
    },
    durableHook: "src/lib/debug/template-rubric.ts → SECTION_HINTS zero-placeholder policy (LIVE)",
    expectedLift: 1.0,
  },
  {
    detector: "judge-unavailable",
    file: "../v15-pipeline.orig",
    line: 1094,
    symbol: "runV15OnQuestion → judge panel invocation (NOT the baseline one at :661)",
    anchor: "const panel = await judgePanelEnhanced({ apiKey, question, answer: currentText",
    currentCode:
      "const panel = await judgePanelEnhanced({ apiKey, question, answer: currentText, judgeModels, templateId: profile.templateId, styleOverride: profile.styleOverride });",
    mechanism:
      "Your run excluded BOTH judges (`gemini-2.5-pro: HTTP 429`, `gemini-3.5-flash: JSON parse failure`) leaving `judgeScore: null`. The pipeline correctly refuses to fabricate 7.5 — that is good behaviour — but it then has NO independent signal at all, so the deterministic guard score is the only gate, and it is not calibrated for sign-off.",
    reachability: "workspace-seam",
    verifyCmd: "grep -n 'judgePanelEnhanced({' node_modules/src/lib/v15-pipeline.orig.ts",
    deterministic: {
      action: "Emit a deterministic rubric floor beside the model score — never instead of it.",
      change:
        "Compute a floor from template-section coverage, citation trust ratio, placeholder density, and truncation state. Report as `deterministicFloor`, clearly labelled as NOT a judge score.",
      verify: "`judgeScore` must remain null on exclusion; the floor must never be written into that field.",
      fallback: "Retry the excluded judge on a supported model with the exact final-text hash.",
    },
    llm: {
      action: "Retry with a different model tier after backoff.",
      change: "Rotate to a non-429 model and re-submit the identical final candidate.",
      verify: "The retried judge must score the same text hash, not a regenerated candidate.",
      fallback: "Deterministic floor above.",
    },
    durableHook: "src/lib/v15-pipeline.ts post-completion (proposed — not yet implemented)",
    expectedLift: 0.7,
  },
];

/** Index by detector id — a detector may map to several sites. */
export function sitesFor(detector: string): RepairSite[] {
  return REPAIR_SITES.filter((s) => s.detector === detector);
}

/** All distinct files that need touching, with their reachability. */
export function repairFileSummary(sites: RepairSite[]): Array<{ file: string; reach: Reachability; count: number }> {
  const m = new Map<string, { file: string; reach: Reachability; count: number }>();
  for (const s of sites) {
    const k = `${s.file}::${s.reachability}`;
    const cur = m.get(k) ?? { file: s.file, reach: s.reachability, count: 0 };
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/** Machine-readable repair order — paste into an IDE agent or another LLM. */
export function exportRepairOrder(sites: RepairSite[], ctx: { runId?: string; prompt?: string; template?: string; style?: string; persona?: string; guard?: number | null }): string {
  const byFile = new Map<string, RepairSite[]>();
  for (const s of sites) {
    const arr = byFile.get(s.file) ?? [];
    arr.push(s);
    byFile.set(s.file, arr);
  }
  return JSON.stringify(
    {
      schema: "veritas.repair-order/1",
      generatedAt: new Date().toISOString(),
      context: ctx,
      note: "Line numbers verified at authoring time. If verifyCmd disagrees, TRUST THE ANCHOR STRING.",
      reachabilityLegend: {
        "workspace-seam": "fixable today in src/, package untouched",
        "alias-seam": "reachable because the consumer imports via @/…",
        "post-pass": "not interceptable; fix runs after the package returns",
        materialize: "run `node materialize.mjs <file>` first to make it editable",
      },
      files: [...byFile.entries()].map(([file, edits]) => ({
        file,
        applyVia: edits[0].reachability,
        edits: edits.map((e) => ({
          line: e.line,
          symbol: e.symbol,
          anchor: e.anchor,
          currentCode: e.currentCode,
          mechanism: e.mechanism,
          deterministicChange: e.deterministic.change,
          deterministicVerify: e.deterministic.verify,
          deterministicFallback: e.deterministic.fallback,
          llmChange: e.llm.change,
          durableHook: e.durableHook,
          expectedLift: e.expectedLift,
          verifyCmd: e.verifyCmd,
        })),
      })),
    },
    null,
    2
  );
}
