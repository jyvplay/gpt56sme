/**
 * step-attribution.ts — NET-NEW (Type C). See flatten-guide.md.
 * ===========================================================================
 * ANSWERS "which pipeline step wrote this sentence?"
 *
 * The V15 pipeline records intermediate texts at each stage. This module
 * walks them in the ORDER they were produced and assigns each final-output
 * sentence to the earliest stage where a sufficiently-similar sentence first
 * appeared. That earliest match is the stage that ORIGINATED the sentence;
 * any later stage that changed it also earns a "modified" attribution.
 *
 * Attribution stages (from actual pipeline traces, verbatim):
 *   outline        — best-of-N outline candidates
 *   draft          — expansion of the winning outline
 *   depth-N        — each accepted repair pass in passHistory (N = 1..maxDepth)
 *   adv-repair     — adversarial monotonic repair, if accepted
 *   polish         — polish pass, if applied
 *   covea          — targeted CoVe/Adversarial repair we run in this workspace
 *
 * Similarity metric: token Jaccard on a normalised sentence. Tolerates
 * whitespace, punctuation, casing, minor edits (≤~30% token drift).
 * ===========================================================================
 */

export type StageKind =
  | "outline"
  | "draft"
  | "depth"
  | "adv-repair"
  | "polish"
  | "covea";

export interface StageSnapshot {
  kind: StageKind;
  label: string;
  order: number;
  text: string;
}

export interface SentenceAttribution {
  index: number;
  sentence: string;
  originStage: StageSnapshot | null;
  modifiedByStages: StageSnapshot[];
  /** How much of the sentence's tokens survive to the final version (0..1). */
  survivalScore: number;
}

export interface AttributionReport {
  stages: StageSnapshot[];
  sentences: SentenceAttribution[];
  /** Aggregate: how many final sentences each stage originated. */
  originCounts: Record<string, number>;
  /** Aggregate: how many final sentences each stage modified. */
  modifiedCounts: Record<string, number>;
  /** Sentences whose origin we could not locate — usually the model added them ex nihilo. */
  unattributed: number;
}

// ── Sentence split & normalise ─────────────────────────────────────────────

const SENT_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9*\-#[])/g;
export function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/\r\n/g, "\n")
    .split(SENT_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/\[[Ss]?\d+\]/g, "") // strip citation markers so citation churn does not count
      .match(/[a-z0-9][a-z0-9'-]{1,}/g) ?? []
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── Build stage list from a RunRecord's outcome ────────────────────────────

export function buildStages(input: {
  bestOfNCandidates?: Array<{ index: number; snippet?: string; charCount?: number; chosen?: boolean; stage?: string }>;
  draft?: string;
  passHistory?: Array<{ text?: string; pass?: number; note?: string; guardScore?: number }>;
  advRepairText?: string;
  polishText?: string;
  coveaText?: string;
}): StageSnapshot[] {
  const out: StageSnapshot[] = [];
  let order = 0;
  if (Array.isArray(input.bestOfNCandidates)) {
    for (const c of input.bestOfNCandidates) {
      if (c.snippet && c.chosen) {
        out.push({ kind: "outline", label: `outline #${(c.index ?? 0) + 1} (chosen)`, order: order++, text: c.snippet });
      }
    }
  }
  if (input.draft) out.push({ kind: "draft", label: "best-of-N expansion", order: order++, text: input.draft });
  if (Array.isArray(input.passHistory)) {
    input.passHistory.forEach((p, i) => {
      if (typeof p.text === "string" && p.text.length > 0) {
        out.push({
          kind: "depth",
          label: `depth ${p.pass ?? i + 1}${p.note ? ` (${p.note})` : ""}${p.guardScore != null ? ` · guard=${p.guardScore.toFixed(2)}` : ""}`,
          order: order++,
          text: p.text,
        });
      }
    });
  }
  if (input.advRepairText) out.push({ kind: "adv-repair", label: "adversarial repair", order: order++, text: input.advRepairText });
  if (input.polishText) out.push({ kind: "polish", label: "polish pass", order: order++, text: input.polishText });
  if (input.coveaText) out.push({ kind: "covea", label: "COVEA targeted repair", order: order++, text: input.coveaText });
  return out;
}

// ── Attribute each final sentence ──────────────────────────────────────────

const SIM_THRESHOLD_ORIGIN = 0.62; // sentence considered "same" across stages
const SIM_THRESHOLD_MODIFIED = 0.4; // sentence considered "modified but derived"

export function attributeSentences(
  finalText: string,
  stages: StageSnapshot[]
): AttributionReport {
  const finals = splitSentences(finalText);
  // Precompute stage sentence token sets, keeping ordering.
  const stageSentences = stages.map((s) => {
    const sents = splitSentences(s.text);
    return { stage: s, sents, toks: sents.map(tokens) };
  });

  const originCounts: Record<string, number> = {};
  const modifiedCounts: Record<string, number> = {};
  let unattributed = 0;

  const sentences: SentenceAttribution[] = finals.map((sent, idx) => {
    const ft = tokens(sent);
    // Earliest stage where a similar sentence appears = origin.
    let origin: StageSnapshot | null = null;
    let originSurv = 0;
    const modifiedBy: StageSnapshot[] = [];

    for (const { stage, toks } of stageSentences) {
      let best = 0;
      for (const st of toks) {
        const j = jaccard(ft, st);
        if (j > best) best = j;
      }
      if (best >= SIM_THRESHOLD_ORIGIN) {
        if (!origin) {
          origin = stage;
          originSurv = best;
        } else if (best < 0.98) {
          // Later stage differs enough → counts as a modification of this sentence.
          modifiedBy.push(stage);
        }
      } else if (best >= SIM_THRESHOLD_MODIFIED && origin) {
        modifiedBy.push(stage);
      }
    }

    if (origin) {
      originCounts[originLabel(origin)] = (originCounts[originLabel(origin)] ?? 0) + 1;
    } else {
      unattributed++;
    }
    for (const m of modifiedBy) {
      modifiedCounts[originLabel(m)] = (modifiedCounts[originLabel(m)] ?? 0) + 1;
    }

    return {
      index: idx,
      sentence: sent,
      originStage: origin,
      modifiedByStages: modifiedBy,
      survivalScore: originSurv,
    };
  });

  return { stages, sentences, originCounts, modifiedCounts, unattributed };
}

function originLabel(s: StageSnapshot): string {
  return `${s.kind}:${s.order}:${s.label}`;
}

/** Group sentences that trace back to the same stage — useful for the UI. */
export function bucketByOrigin(report: AttributionReport): Array<{
  stage: StageSnapshot | null;
  sentences: SentenceAttribution[];
}> {
  const map = new Map<string, { stage: StageSnapshot | null; sentences: SentenceAttribution[] }>();
  for (const s of report.sentences) {
    const key = s.originStage ? originLabel(s.originStage) : "(unattributed)";
    const bucket = map.get(key) ?? { stage: s.originStage, sentences: [] };
    bucket.sentences.push(s);
    map.set(key, bucket);
  }
  return [...map.values()];
}
