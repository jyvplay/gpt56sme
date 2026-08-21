/**
 * prompt-forge.ts — NET-NEW WORKSPACE MODULE (Type C seam)
 * ===========================================================================
 * SELF-IMPROVEMENT ENGINE
 *
 * Intent: paste in an output produced by the logic system (or by any other
 * LLM), and get back a SPECIFIC, ADDRESSED diagnosis of which part of the
 * prompt is capping the score — plus a concrete patch that should move a
 * third-party judge from ~6-7 to 9-10.
 *
 * DESIGN PROVENANCE (web-researched, 2026)
 *   · ProTeGi / TextGrad — "textual gradients": an LLM critiques failing
 *     examples; the critique is applied as an edit. Most interpretable family.
 *     We implement the critique→patch step and expose the critique verbatim.
 *   · OPRO — condition the optimizer on a (prompt, score) TRAJECTORY rather
 *     than a single critique. We persist a score history per prompt lineage.
 *   · GEPA — reflection over traces with a Pareto front across multiple
 *     objectives. We keep all rubric dimensions separate and never collapse
 *     them into a single number before showing the user the breakdown.
 *   · Prometheus-2 — judges need EXPLICIT custom rubrics with per-dimension
 *     anchors, or they score on vibes.
 *
 * THE KNOWN FAILURE MODE, HANDLED EXPLICITLY
 *   "The optimizer is only as good as the signal it maximizes. A vague or
 *   biased scorer produces a prompt that games the scorer, not a better
 *   prompt." — Automatic Prompt Optimization in 2026 (futureagi.com, 2026-05-29)
 *
 *   Mitigation implemented here:
 *     1. A DETERMINISTIC scorer runs ALWAYS. It is pure text analysis — no
 *        model, no network, fully reproducible, cannot be flattered.
 *     2. The LLM judge is OPTIONAL and runs against an explicit anchored
 *        rubric with a forced JSON contract.
 *     3. Both are displayed side by side. DIVERGENCE IS SURFACED, never
 *        averaged away. A large gap means the judge is being gamed OR the
 *        deterministic proxy is blind — either way the user must look.
 * ===========================================================================
 */

import { geminiGenerate } from '@/lib/v15-gemini';
import { getGeminiKey } from "@/lib/v15-state";

// ───────────────────────────────────────────────────────────────────────────
// PROMPT REGIONS — the addressable "parameters" of the prompt
// ───────────────────────────────────────────────────────────────────────────
// A diagnosis is only useful if it points at a SPECIFIC region. These are the
// levers; every rubric dimension is wired to the regions that control it.

export type RegionId =
  | "ROLE"
  | "TASK"
  | "CONTEXT"
  | "EVIDENCE_POLICY"
  | "CONSTRAINTS"
  | "DEPTH"
  | "FORMAT"
  | "EXAMPLES"
  | "TONE"
  | "STOP_CONDITION";

export interface RegionMeta {
  id: RegionId;
  label: string;
  controls: string;
}

export const REGIONS: RegionMeta[] = [
  { id: "ROLE", label: "Role / Persona", controls: "Expertise register, vocabulary, standard-of-care." },
  { id: "TASK", label: "Task Statement", controls: "What is actually being asked; scope boundaries." },
  { id: "CONTEXT", label: "Context Block", controls: "Background the model may assume." },
  { id: "EVIDENCE_POLICY", label: "Evidence Policy", controls: "Citation requirements, source tiering, unknown-handling." },
  { id: "CONSTRAINTS", label: "Hard Constraints", controls: "Must/must-not rules, exclusions, comparison targets." },
  { id: "DEPTH", label: "Depth Directive", controls: "Length, granularity, how far to decompose." },
  { id: "FORMAT", label: "Output Format", controls: "Structure, headings, tables, schema." },
  { id: "EXAMPLES", label: "Few-shot Exemplars", controls: "Demonstrated quality bar." },
  { id: "TONE", label: "Tone / Style", controls: "Hedging level, directness, audience." },
  { id: "STOP_CONDITION", label: "Stop Condition", controls: "When the answer is done; anti-truncation." },
];

// ───────────────────────────────────────────────────────────────────────────
// RUBRIC — anchored, multi-dimensional, weighted
// ───────────────────────────────────────────────────────────────────────────

export interface RubricDim {
  id: string;
  label: string;
  weight: number;
  /** Which prompt regions move this dimension. */
  regions: RegionId[];
  /** Explicit anchors — Prometheus-2 style. Vague rubrics produce vibe scores. */
  anchor3: string;
  anchor7: string;
  anchor10: string;
}

export const RUBRIC: RubricDim[] = [
  {
    id: "grounding", label: "Evidence Grounding", weight: 1.6, regions: ["EVIDENCE_POLICY", "CONSTRAINTS"],
    anchor3: "Assertions float free; no sources, no uncertainty marks.",
    anchor7: "Some claims sourced; several load-bearing claims still unattributed.",
    anchor10: "Every load-bearing claim carries a source or an explicit [UNVERIFIED]/[ASSUMPTION] tag.",
  },
  {
    id: "specificity", label: "Specificity", weight: 1.5, regions: ["TASK", "DEPTH", "EXAMPLES"],
    anchor3: "Generic advice that would apply to any question in the domain.",
    anchor7: "Concrete in places, generic in others; named entities sparse.",
    anchor10: "Named entities, exact figures with units, versions, and thresholds throughout.",
  },
  {
    id: "structure", label: "Structure", weight: 1.0, regions: ["FORMAT", "DEPTH"],
    anchor3: "Undifferentiated prose wall.",
    anchor7: "Headings present but hierarchy inconsistent; no scannable summary.",
    anchor10: "Clear hierarchy, tables where comparative, front-loaded answer.",
  },
  {
    id: "directness", label: "Directness", weight: 1.3, regions: ["TONE", "ROLE", "STOP_CONDITION"],
    anchor3: "Hedged into meaninglessness; refuses to commit.",
    anchor7: "Commits, but padded with disclaimers and throat-clearing.",
    anchor10: "Answer first, then support. Hedges only where genuinely uncertain.",
  },
  {
    id: "completeness", label: "Completeness", weight: 1.4, regions: ["TASK", "CONSTRAINTS", "STOP_CONDITION"],
    anchor3: "Ignores most of what was asked.",
    anchor7: "Covers the main ask; misses sub-questions or edge cases.",
    anchor10: "Every clause of the request addressed, including implicit sub-questions.",
  },
  {
    id: "depth", label: "Analytical Depth", weight: 1.5, regions: ["DEPTH", "ROLE", "EXAMPLES"],
    anchor3: "Restates the question with definitions.",
    anchor7: "One level of causal reasoning; no mechanism, no second-order effects.",
    anchor10: "Mechanism-level reasoning, trade-offs quantified, second-order effects named.",
  },
  {
    id: "actionability", label: "Actionability", weight: 1.2, regions: ["TASK", "FORMAT"],
    anchor3: "Nothing the reader can do next.",
    anchor7: "Recommendations present but unprioritised and unowned.",
    anchor10: "Prioritised next steps with thresholds, owners, and verification method.",
  },
  {
    id: "calibration", label: "Calibration", weight: 1.2, regions: ["EVIDENCE_POLICY", "TONE"],
    anchor3: "Uniform false confidence, or uniform hedging.",
    anchor7: "Some uncertainty flagged, but confidence not differentiated by claim.",
    anchor10: "Confidence varies per claim and matches actual evidence strength.",
  },
  {
    id: "nonredundancy", label: "Non-Redundancy", weight: 0.9, regions: ["FORMAT", "STOP_CONDITION"],
    anchor3: "Same point restated in three sections.",
    anchor7: "Noticeable repetition in summary/conclusion.",
    anchor10: "Every paragraph adds new information.",
  },
  {
    id: "compliance", label: "Format Compliance", weight: 1.0, regions: ["FORMAT", "CONSTRAINTS"],
    anchor3: "Ignores the requested shape entirely.",
    anchor7: "Roughly the right shape; some required elements missing.",
    anchor10: "Exactly the requested structure, nothing extra, nothing missing.",
  },
];

// ───────────────────────────────────────────────────────────────────────────
// DETERMINISTIC SCORER — no model, no network, fully reproducible
// ───────────────────────────────────────────────────────────────────────────

const HEDGES = [
  "might", "may", "could", "perhaps", "possibly", "arguably", "somewhat", "generally",
  "typically", "often", "sometimes", "it depends", "in some cases", "relatively",
  "fairly", "quite", "rather", "tends to", "can be seen as", "to some extent",
];
const FILLER = [
  "it is important to note", "it's important to note", "it is worth noting",
  "in today's world", "in conclusion", "as an ai", "i hope this helps",
  "let's dive in", "delve into", "navigating the", "in the realm of",
  "it's worth mentioning", "at the end of the day",
];
const ACTION_MARKERS = [
  "next step", "recommend", "should", "must", "action", "implement", "verify",
  "measure", "threshold", "owner", "deadline", "checklist", "step 1", "priority",
];
const UNCERTAINTY_TAGS = [
  "[unverified]", "[assumption]", "[assumed]", "[estimate]", "[post-cutoff]",
  "[unknown]", "unverified", "cannot verify", "no source",
];

function words(t: string): string[] {
  return t.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
}
function countOccurrences(hay: string, needles: string[]): number {
  const l = hay.toLowerCase();
  let n = 0;
  for (const nd of needles) {
    let i = 0;
    for (;;) {
      const j = l.indexOf(nd, i);
      if (j === -1) break;
      n++;
      i = j + nd.length;
    }
  }
  return n;
}
/** Map an unbounded density to 0-10 with a target band. */
function band(v: number, lo: number, hi: number): number {
  if (v <= 0) return 1;
  if (v < lo) return 1 + 9 * (v / lo) * 0.55;
  if (v > hi) return Math.max(3, 10 - 6 * Math.min(1, (v - hi) / (hi * 2)));
  return 5.5 + 4.5 * ((v - lo) / Math.max(1e-9, hi - lo));
}

export interface DimScore {
  id: string;
  label: string;
  score: number;
  weight: number;
  evidence: string;
}

export interface ScoreReport {
  overall: number;
  dims: DimScore[];
  method: "deterministic" | "llm-judge";
  raw?: string;
  notes: string[];
}

export function scoreDeterministic(output: string, prompt: string): ScoreReport {
  const w = words(output);
  const wc = Math.max(1, w.length);
  const per100 = (n: number) => (n / wc) * 100;
  const notes: string[] = [];

  // grounding: citation tags [S1], [1], (Author, 2024), bare URLs, uncertainty tags
  const citeTags = (output.match(/\[[Ss]?\d{1,3}\]/g) ?? []).length;
  const urls = (output.match(/https?:\/\/\S+/g) ?? []).length;
  const authorYear = (output.match(/\([A-Z][A-Za-z.\s&]+,\s*(19|20)\d{2}\)/g) ?? []).length;
  const uncTags = countOccurrences(output, UNCERTAINTY_TAGS);
  const groundingDensity = per100(citeTags + urls + authorYear + uncTags);

  // specificity: digits-with-units, proper nouns, versions, dates
  const numbers = (output.match(/\b\d[\d,.]*\s?(%|ms|s\b|kb|mb|gb|tb|kg|km|mm|cm|°c|°f|usd|\$|€|x\b)/gi) ?? []).length;
  const bareNums = (output.match(/\b\d[\d,.]{1,}\b/g) ?? []).length;
  const versions = (output.match(/\bv?\d+\.\d+(\.\d+)?\b/g) ?? []).length;
  const propers = (output.match(/\b[A-Z][a-zA-Z0-9]{2,}(?:[-.][A-Za-z0-9]+)*\b/g) ?? []).length;
  const specificity = per100(numbers * 2 + versions * 2 + bareNums + propers * 0.4);

  // structure
  const headings = (output.match(/^#{1,6}\s+\S/gm) ?? []).length;
  const bullets = (output.match(/^\s*[-*•]\s+\S/gm) ?? []).length;
  const numbered = (output.match(/^\s*\d+[.)]\s+\S/gm) ?? []).length;
  const tableRows = (output.match(/^\s*\|.*\|\s*$/gm) ?? []).length;
  const structureSignal = per100(headings * 6 + tableRows * 3 + (bullets + numbered) * 1.2);

  // directness (inverse hedging + filler)
  const hedgeN = countOccurrences(output, HEDGES);
  const fillerN = countOccurrences(output, FILLER);
  const hedgeDensity = per100(hedgeN + fillerN * 3);
  const directness = Math.max(1, 10 - hedgeDensity * 1.7);

  // completeness: coverage of content terms from the prompt
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "was", "have", "has", "will", "what", "how", "why", "please", "make", "sure", "into", "also", "each", "them", "then", "there", "which", "when", "can", "not", "all", "any", "our"]);
  const promptTerms = [...new Set(words(prompt).filter((t) => t.length > 3 && !stop.has(t)))];
  const outSet = new Set(w);
  const covered = promptTerms.filter((t) => outSet.has(t)).length;
  const coverage = promptTerms.length ? covered / promptTerms.length : 0.5;
  if (promptTerms.length < 5) notes.push("Prompt too short for a reliable coverage signal — completeness is low-confidence.");

  // depth: causal/mechanism connectives + clause complexity
  const causal = countOccurrences(output, ["because", "therefore", "consequently", "which means", "as a result", "trade-off", "tradeoff", "mechanism", "root cause", "second-order", "downstream", "implies", "leads to", "driven by"]);
  const sentences = Math.max(1, (output.match(/[.!?]+\s/g) ?? []).length);
  const avgSentLen = wc / sentences;
  const depth = Math.min(10, band(per100(causal), 0.6, 3.2) * 0.7 + Math.min(10, avgSentLen / 3.2) * 0.3);

  // actionability
  const actionability = band(per100(countOccurrences(output, ACTION_MARKERS)), 0.8, 4.0);

  // calibration: uncertainty tags should exist, but be differentiated not uniform
  const calibration = uncTags === 0
    ? (groundingDensity > 2 ? 6.0 : 3.0)
    : band(per100(uncTags), 0.15, 1.6);
  if (uncTags === 0) notes.push("No explicit uncertainty markers found — calibration cannot exceed 6.");

  // non-redundancy: repeated 6-gram ratio
  const grams = new Map<string, number>();
  for (let i = 0; i + 6 <= w.length; i++) {
    const g = w.slice(i, i + 6).join(" ");
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let repeated = 0;
  for (const c of grams.values()) if (c > 1) repeated += c - 1;
  const redundancyRatio = grams.size ? repeated / grams.size : 0;
  const nonredundancy = Math.max(1, 10 - redundancyRatio * 120);

  // format compliance: does output honour shapes named in the prompt?
  const asks = {
    table: /\btable\b/i.test(prompt),
    bullets: /\bbullet|list\b/i.test(prompt),
    heading: /\bsection|heading\b/i.test(prompt),
    json: /\bjson\b/i.test(prompt),
    code: /\bcode\b/i.test(prompt),
  };
  let hits = 0, asked = 0;
  if (asks.table) { asked++; if (tableRows > 1) hits++; }
  if (asks.bullets) { asked++; if (bullets + numbered > 2) hits++; }
  if (asks.heading) { asked++; if (headings > 0) hits++; }
  if (asks.json) { asked++; if (/[[{]/.test(output)) hits++; }
  if (asks.code) { asked++; if (/```/.test(output)) hits++; }
  const compliance = asked === 0 ? 7.0 : 2 + 8 * (hits / asked);
  if (asked === 0) notes.push("Prompt declared no explicit format — compliance defaults to 7 (neutral).");

  const scored: Record<string, { s: number; e: string }> = {
    grounding: { s: band(groundingDensity, 0.5, 3.5), e: `${citeTags} tag(s), ${urls} url(s), ${authorYear} author-year, ${uncTags} uncertainty mark(s) → ${groundingDensity.toFixed(2)}/100w` },
    specificity: { s: band(specificity, 3, 14), e: `${numbers} unit-bearing, ${versions} version(s), ${bareNums} numeral(s), ${propers} proper noun(s) → ${specificity.toFixed(1)}/100w` },
    structure: { s: band(structureSignal, 1.5, 9), e: `${headings} heading(s), ${tableRows} table row(s), ${bullets + numbered} list item(s)` },
    directness: { s: directness, e: `${hedgeN} hedge(s) + ${fillerN} filler phrase(s) → ${hedgeDensity.toFixed(2)}/100w` },
    completeness: { s: 1 + 9 * coverage, e: `${covered}/${promptTerms.length} prompt content terms present (${(coverage * 100).toFixed(0)}%)` },
    depth: { s: depth, e: `${causal} causal connective(s), avg sentence ${avgSentLen.toFixed(1)}w` },
    actionability: { s: actionability, e: `${countOccurrences(output, ACTION_MARKERS)} action marker(s)` },
    calibration: { s: calibration, e: `${uncTags} uncertainty marker(s) across ${wc} words` },
    nonredundancy: { s: nonredundancy, e: `repeated 6-gram ratio ${(redundancyRatio * 100).toFixed(1)}%` },
    compliance: { s: compliance, e: asked === 0 ? "no explicit format requested" : `${hits}/${asked} declared format element(s) honoured` },
  };

  const dims: DimScore[] = RUBRIC.map((r) => ({
    id: r.id,
    label: r.label,
    weight: r.weight,
    score: Math.max(1, Math.min(10, Number(scored[r.id].s.toFixed(2)))),
    evidence: scored[r.id].e,
  }));

  const totalW = dims.reduce((a, d) => a + d.weight, 0);
  const overall = Number((dims.reduce((a, d) => a + d.score * d.weight, 0) / totalW).toFixed(2));

  return { overall, dims, method: "deterministic", notes };
}

// ───────────────────────────────────────────────────────────────────────────
// LLM JUDGE — anchored rubric, forced JSON contract
// ───────────────────────────────────────────────────────────────────────────

function buildJudgePrompt(prompt: string, output: string): string {
  const rubricText = RUBRIC.map(
    (r) => `- ${r.id} (${r.label}, weight ${r.weight})\n    3 = ${r.anchor3}\n    7 = ${r.anchor7}\n    10 = ${r.anchor10}`
  ).join("\n");
  return `You are a strict third-party evaluator. You did NOT write this output and have no stake in it. Score harshly; a 10 must be genuinely exceptional.

Score the RESPONSE against the anchored rubric. Use the anchors literally — do not invent your own standard.

RUBRIC
${rubricText}

For EACH dimension return an integer or one-decimal score 1-10 and a one-sentence justification quoting or naming the specific textual evidence.

Then identify the SINGLE highest-leverage prompt defect: which region of the ORIGINAL PROMPT, if rewritten, would most raise the weakest dimensions. Choose the region id from exactly this set:
ROLE, TASK, CONTEXT, EVIDENCE_POLICY, CONSTRAINTS, DEPTH, FORMAT, EXAMPLES, TONE, STOP_CONDITION

Return ONLY JSON, no prose, no code fence:
{"dims":[{"id":"grounding","score":0,"why":""}],"weakest":["id","id"],"primaryRegion":"EVIDENCE_POLICY","gradient":"<one paragraph: exactly why the prompt — not the model — produced this ceiling>","patch":"<the literal replacement text to insert into that prompt region>"}

ORIGINAL PROMPT
<<<
${prompt.slice(0, 6000)}
>>>

RESPONSE TO SCORE
<<<
${output.slice(0, 14000)}
>>>`;
}

export interface JudgeResult {
  report: ScoreReport;
  weakest: string[];
  primaryRegion: RegionId | null;
  gradient: string;
  patch: string;
  model: string;
}

export async function judgeWithLLM(
  prompt: string,
  output: string,
  model = "gemini-2.0-flash"
): Promise<JudgeResult> {
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error("No Gemini API key configured. Set it in the V15 panel, or use the deterministic scorer.");

  const res: any = await geminiGenerate({
    apiKey,
    model,
    prompt: buildJudgePrompt(prompt, output),
    maxOutputTokens: 2400,
  });
  const text: string = String(res?.text ?? res?.output ?? "");
  if (!text) throw new Error(`Judge returned no text (model=${model}).`);

  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Judge did not return parseable JSON. Raw output shown below.");
  let parsed: any;
  try {
    parsed = JSON.parse(m[0]);
  } catch (e) {
    throw new Error(`Judge JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const byId = new Map<string, any>((parsed.dims ?? []).map((d: any) => [String(d.id), d]));
  const dims: DimScore[] = RUBRIC.map((r) => {
    const d = byId.get(r.id);
    const s = Number(d?.score);
    return {
      id: r.id,
      label: r.label,
      weight: r.weight,
      score: Number.isFinite(s) ? Math.max(1, Math.min(10, s)) : 5,
      evidence: String(d?.why ?? "(judge returned no justification for this dimension)"),
    };
  });
  const totalW = dims.reduce((a, d) => a + d.weight, 0);
  const overall = Number((dims.reduce((a, d) => a + d.score * d.weight, 0) / totalW).toFixed(2));

  const region = String(parsed.primaryRegion ?? "").toUpperCase();
  return {
    report: { overall, dims, method: "llm-judge", raw: text, notes: [] },
    weakest: Array.isArray(parsed.weakest) ? parsed.weakest.map(String) : [],
    primaryRegion: (REGIONS.find((r) => r.id === region)?.id ?? null) as RegionId | null,
    gradient: String(parsed.gradient ?? ""),
    patch: String(parsed.patch ?? ""),
    model,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// TEXTUAL GRADIENT → PROMPT PATCH (deterministic fallback, always available)
// ───────────────────────────────────────────────────────────────────────────

export interface PromptDiagnosis {
  targetScore: number;
  currentScore: number;
  gap: number;
  /** Ordered by leverage = weight × deficit. This is the "gradient magnitude". */
  leverage: Array<{
    dim: DimScore;
    deficit: number;
    leverage: number;
    regions: RegionId[];
    fix: string;
    insert: string;
  }>;
  primaryRegion: RegionId | null;
  /** Concrete text block to append/replace in the prompt. */
  patchBlock: string;
  caveats: string[];
}

/** Deterministic, dimension-specific prompt repairs. */
const FIXES: Record<string, { fix: string; insert: string }> = {
  grounding: {
    fix: "The prompt never made attribution mandatory, so the model treated sourcing as optional.",
    insert: "EVIDENCE POLICY (hard): every load-bearing claim must carry an inline source marker in the form [S#] mapped to a source list at the end, OR an explicit tag from {[UNVERIFIED], [ASSUMPTION], [ESTIMATE], [POST-CUTOFF]}. An unmarked factual assertion is a defect. Do not fill gaps with plausible-sounding detail — say what is unknown.",
  },
  specificity: {
    fix: "The prompt asked for a topic, not for resolvable particulars, so the model answered at category level.",
    insert: "SPECIFICITY (hard): name concrete entities, exact figures WITH UNITS, version numbers, dates, and thresholds. Any sentence that would still be true if the subject were swapped for a different one in the same category must be deleted or made specific.",
  },
  structure: {
    fix: "No output shape was specified, so the model defaulted to undifferentiated prose.",
    insert: "FORMAT: open with a 2-3 sentence direct answer before any heading. Then use `##` sections. Use a markdown table for anything comparative (≥2 options × ≥2 attributes). No section shorter than 3 sentences.",
  },
  directness: {
    fix: "Nothing in the prompt gave permission to commit, so the model hedged to stay safe.",
    insert: "STANCE: you are permitted and required to commit to a position. State the conclusion first, then the support. Hedge ONLY where the evidence is genuinely split, and when you hedge, say precisely what evidence would resolve it. Ban: 'it depends', 'it is important to note', 'in conclusion', 'delve'.",
  },
  completeness: {
    fix: "Multi-part requests were not enumerated, so later clauses were dropped.",
    insert: "COVERAGE: before answering, silently enumerate every distinct question in the request, including implicit sub-questions. Address each one under its own heading. End with a coverage checklist mapping each enumerated question to the section that answers it.",
  },
  depth: {
    fix: "The prompt requested an answer but not a mechanism, so the model stopped at the first causal layer.",
    insert: "DEPTH: for each main claim, give the MECHANISM (why it happens, not just that it happens), quantify at least one trade-off, and name at least one second-order effect. Stop-condition: a domain expert must learn something they could not have guessed from the question alone.",
  },
  actionability: {
    fix: "No consumer of the output was defined, so nothing was made operational.",
    insert: "ACTIONABILITY: end with a prioritised action list. Each item: the action, the trigger threshold, who owns it, and how to verify it worked. Rank by (impact ÷ effort). No item may be a restatement of the analysis.",
  },
  calibration: {
    fix: "Confidence was never asked for, so all claims were stated at one uniform level.",
    insert: "CALIBRATION: attach a confidence to each major claim from {HIGH, MEDIUM, LOW} and justify the level with the evidence class behind it (measured / cited / derived / assumed). Uniform confidence across all claims is a defect.",
  },
  nonredundancy: {
    fix: "A summary was implicitly invited, so content was restated instead of extended.",
    insert: "ANTI-REDUNDANCY: no point may appear twice. Do not write a concluding summary that restates earlier sections — if a conclusion is included it must contain only new synthesis or the decision that follows.",
  },
  compliance: {
    fix: "Format requirements were stated as preference, not as a contract, so they were partially ignored.",
    insert: "FORMAT CONTRACT: the structure specified above is a hard contract. Before emitting, verify every required element is present. If any element cannot be produced, say so explicitly instead of silently omitting it.",
  },
};

export function diagnose(report: ScoreReport, targetScore = 9.0): PromptDiagnosis {
  const leverage = report.dims
    .map((dim) => {
      const deficit = Math.max(0, targetScore - dim.score);
      const meta = RUBRIC.find((r) => r.id === dim.id)!;
      const f = FIXES[dim.id];
      return {
        dim,
        deficit: Number(deficit.toFixed(2)),
        leverage: Number((deficit * dim.weight).toFixed(3)),
        regions: meta.regions,
        fix: f.fix,
        insert: f.insert,
      };
    })
    .filter((x) => x.deficit > 0.25)
    .sort((a, b) => b.leverage - a.leverage);

  // Primary region = region with the highest summed leverage across dimensions.
  const regionScore = new Map<RegionId, number>();
  for (const l of leverage) {
    for (const r of l.regions) regionScore.set(r, (regionScore.get(r) ?? 0) + l.leverage);
  }
  const primaryRegion =
    [...regionScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const top = leverage.slice(0, 4);
  const patchBlock = top.length
    ? [
        "# ── PROMPT PATCH (generated from measured deficits) ──",
        `# target=${targetScore.toFixed(1)}  current=${report.overall.toFixed(2)}  gap=${(targetScore - report.overall).toFixed(2)}`,
        `# primary region: ${primaryRegion ?? "n/a"}`,
        "",
        ...top.map((l) => `## ${l.dim.label} — measured ${l.dim.score.toFixed(2)}/10 (leverage ${l.leverage})\n${l.insert}`),
      ].join("\n")
    : "# No dimension is below target. The prompt is not the bottleneck — investigate the pipeline trace instead.";

  const caveats = [
    "This diagnosis maximises a proxy signal. A prompt that games the scorer is not a better prompt — re-judge with a THIRD-PARTY model after patching.",
    "Deterministic scores measure surface properties of text. They cannot detect a factually wrong but well-formatted answer. Grounding truth still requires the pipeline's citation audit.",
    ...report.notes,
  ];

  return {
    targetScore,
    currentScore: report.overall,
    gap: Number((targetScore - report.overall).toFixed(2)),
    leverage,
    primaryRegion,
    patchBlock,
    caveats,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// OPRO — score trajectory across prompt revisions
// ───────────────────────────────────────────────────────────────────────────

export interface TrajectoryPoint {
  iteration: number;
  ts: number;
  label: string;
  overall: number;
  method: ScoreReport["method"];
  dims: Record<string, number>;
}

const TRAJ_KEY = "veritas.promptforge.trajectory";

export function loadTrajectory(): TrajectoryPoint[] {
  try {
    const raw = localStorage.getItem(TRAJ_KEY);
    return raw ? (JSON.parse(raw) as TrajectoryPoint[]) : [];
  } catch {
    return [];
  }
}

export function recordTrajectory(label: string, report: ScoreReport): TrajectoryPoint[] {
  const prev = loadTrajectory();
  const pt: TrajectoryPoint = {
    iteration: prev.length + 1,
    ts: Date.now(),
    label,
    overall: report.overall,
    method: report.method,
    dims: Object.fromEntries(report.dims.map((d) => [d.id, d.score])),
  };
  const next = [...prev, pt].slice(-40);
  try {
    localStorage.setItem(TRAJ_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — trajectory is best-effort */
  }
  return next;
}

export function clearTrajectory(): void {
  try {
    localStorage.removeItem(TRAJ_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * OPRO meta-prompt: hand the optimizer the (prompt, score) history rather than
 * a single critique. Copy this into any third-party LLM instance.
 */
export function buildOproMetaPrompt(traj: TrajectoryPoint[], currentPrompt: string, target = 9.0): string {
  const hist = traj
    .slice(-12)
    .map((p) => `  iter ${p.iteration} · ${p.label} · overall ${p.overall.toFixed(2)} · ${Object.entries(p.dims).map(([k, v]) => `${k}=${Number(v).toFixed(1)}`).join(" ")}`)
    .join("\n");
  return `You are a prompt optimizer. Below is the score TRAJECTORY of successive prompt revisions, evaluated against a fixed anchored rubric (1-10 per dimension, weighted overall).

TRAJECTORY (oldest → newest)
${hist || "  (no history yet — this is iteration 1)"}

TARGET: overall ≥ ${target.toFixed(1)} with NO single dimension below 8.

CURRENT PROMPT
<<<
${currentPrompt}
>>>

Read the curve. Identify which edits moved which dimensions and which edits regressed others (dimension conflict is expected — textual gradients are not orthogonal). Then write ONE new prompt that beats the whole curve.

Constraints on your rewrite:
- Do not simply append more rules; consolidate and remove instructions that the trajectory shows had no effect.
- If two dimensions are in tension, state the trade-off explicitly and choose, do not hedge.
- Preserve every hard constraint from the current prompt.

Return: (1) a 5-line analysis of the curve, (2) the full rewritten prompt, (3) the single dimension you expect to move most and by how much.`;
}

/** ProTeGi-style handoff bundle for an external LLM instance. */
export function buildExternalAuditBundle(opts: {
  prompt: string;
  output: string;
  deterministic: ScoreReport;
  llm?: ScoreReport | null;
  diagnosis: PromptDiagnosis;
}): string {
  const { prompt, output, deterministic, llm, diagnosis } = opts;
  const divergence = llm ? Math.abs(llm.overall - deterministic.overall) : null;
  return `# EXTERNAL AUDIT BUNDLE — veritas.prompt-forge/1
Generated: ${new Date().toISOString()}

## 1. SCORES
Deterministic (reproducible text analysis): ${deterministic.overall.toFixed(2)}/10
${llm ? `LLM judge (${llm.method}): ${llm.overall.toFixed(2)}/10` : "LLM judge: not run"}
${divergence !== null ? `Divergence: ${divergence.toFixed(2)}${divergence > 1.5 ? "  ⚠ LARGE — one of the two scorers is wrong. Investigate before acting." : ""}` : ""}

## 2. PER-DIMENSION (deterministic)
${deterministic.dims.map((d) => `- ${d.label}: ${d.score.toFixed(2)}/10 (w=${d.weight})  — ${d.evidence}`).join("\n")}

${llm ? `## 2b. PER-DIMENSION (LLM judge)\n${llm.dims.map((d) => `- ${d.label}: ${d.score.toFixed(2)}/10 — ${d.evidence}`).join("\n")}\n` : ""}
## 3. GRADIENT (leverage = weight x deficit vs target ${diagnosis.targetScore})
${diagnosis.leverage.map((l, i) => `${i + 1}. ${l.dim.label} — score ${l.dim.score.toFixed(2)}, deficit ${l.deficit}, leverage ${l.leverage}\n   regions: ${l.regions.join(", ")}\n   root cause: ${l.fix}`).join("\n")}

## 4. PRIMARY PROMPT REGION TO EDIT
${diagnosis.primaryRegion ?? "none — prompt is not the bottleneck"}

## 5. PROPOSED PATCH
${diagnosis.patchBlock}

## 6. CAVEATS
${diagnosis.caveats.map((c) => `- ${c}`).join("\n")}

## 7. ORIGINAL PROMPT
<<<
${prompt}
>>>

## 8. OUTPUT UNDER TEST
<<<
${output.slice(0, 20000)}
>>>

## 9. TASK FOR YOU (the receiving LLM)
Independently re-score the OUTPUT against the same rubric WITHOUT looking at the scores above first. Then compare your scores to section 2. Where you disagree by more than 2 points, explain which scorer is wrong and why. Finally, either ratify the patch in section 5 or replace it with a better one, and state the specific dimension you expect it to move.`;
}
