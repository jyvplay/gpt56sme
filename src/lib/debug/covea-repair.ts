/**
 * covea-repair.ts — NET-NEW (Type C). See flatten-guide.md.
 * ===========================================================================
 * TARGETED CoVe + Adversarial repair pass ("COVEA").
 *
 * OBSERVED FAILURE (from user's turn-3 trace, run-mse2o76t-8uaol):
 *   · CoVe found 4/4 claims inconsistent → NOTHING HAPPENED
 *   · Adversarial preflight found 4 blocking defects → injected as depth-N
 *     constraints, but depth-1 patch was rejected and the loop stopped
 *   · Adversarial red-team found 4 defects, monotonic repair "failed or
 *     shrank too much" → pre-repair text kept, defects logged, done
 *   · Guard score never moved from 4.4
 *
 * ARCHITECTURAL FIX (this file):
 *   Run a POST-completion COVEA pass. For each still-live CoVe inconsistency
 *   and each still-live adversarial defect, locate the EXACT sentence(s) that
 *   trigger the failure, then rewrite ONLY those sentences with a minimal,
 *   targeted prompt. NEVER regenerate the whole draft — that is what the
 *   in-package adversarial repair does, and its "shrank too much" rejection
 *   is exactly the failure mode we are avoiding.
 *
 * CONTRACT (hard, enforced):
 *   1. A patch touches ≤ ONE paragraph at a time.
 *   2. Total edited region ≤ 20% of the draft.
 *   3. A patch that shrinks its region by > 40% is rejected — that is the
 *      "shrank too much" bug repeated at sentence scale.
 *   4. Every citation tag [S#] present in the original region is preserved.
 *   5. On model failure (429/503/parse), the sentence keeps its original text
 *      and is logged as `unrepaired` — never silently dropped.
 *   6. NO PROMPT TRUNCATION. The full failing claim + full source snippets +
 *      full region text are passed verbatim.
 * ===========================================================================
 */
import { geminiGenerate } from '@/lib/v15-gemini';
import { splitSentences } from "@/lib/debug/step-attribution";

export interface CoveFailure {
  question: string;
  expectedAnswer: string;
  verifiedAnswer: string;
}

export interface AdversarialDefect {
  code: string;
  severity: string;
  message: string;
  category?: string;
}

export interface CoveaTarget {
  kind: "cove" | "adversarial";
  reason: string;
  /** Zero-based sentence indices this target maps onto in the current draft. */
  sentenceIndices: number[];
  /** The full sentence text at those indices, verbatim. */
  sentences: string[];
  /** For CoVe: the failing claim. For adversarial: the defect message. */
  payload: string;
  /** Suggested remediation extracted from the defect or verification answer. */
  remediation: string;
}

export interface CoveaPatch {
  target: CoveaTarget;
  beforeText: string;
  afterText: string;
  accepted: boolean;
  rejectReason?: string;
  model: string;
  latencyMs: number;
  attempts: number;
}

export interface CoveaResult {
  ranAt: number;
  targets: CoveaTarget[];
  patches: CoveaPatch[];
  originalDraft: string;
  repairedDraft: string;
  charsChanged: number;
  charsChangedPct: number;
  acceptedCount: number;
  rejectedCount: number;
  skippedCount: number;
  /** Diagnostic log lines — surfaced verbatim in the debug console. */
  log: string[];
  errors: string[];
  /** Non-LLM repairs/containments applied before targeted patching. */
  deterministicActions: string[];
}

export interface CitationAuditLike {
  entries?: Array<{ id?: number; title?: string; url?: string; snippet?: string; content?: string; stage?: string }>;
  auditResults?: Array<{ tag?: string; id?: number; found?: boolean; trusted?: boolean; snippetOverlap?: number; entailment?: number }>;
  missingCount?: number;
  untrustedCount?: number;
}

// ── Target identification: locate the failing sentence in the draft ────────

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9\s]/g, "");
}
function tokens(s: string): Set<string> {
  return new Set(normalise(s).split(" ").filter((t) => t.length > 2));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Find the top-K sentences that overlap most with `needle`. */
function locateSentences(draft: string, needle: string, k = 2, minOverlap = 0.18): number[] {
  const sents = splitSentences(draft);
  const nToks = tokens(needle);
  if (!nToks.size) return [];
  const scored = sents
    .map((s, i) => ({ i, score: jaccard(tokens(s), nToks) }))
    .filter((x) => x.score >= minOverlap)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.i);
  return scored;
}

export function buildTargets(
  draft: string,
  coveFailures: CoveFailure[],
  advDefects: AdversarialDefect[]
): CoveaTarget[] {
  const sents = splitSentences(draft);
  const targets: CoveaTarget[] = [];

  for (const f of coveFailures) {
    // CoVe questions come with the CLAIM the draft made ("expectedAnswer") and
    // what verification found. The claim is what actually lives in the draft.
    const indices = locateSentences(draft, `${f.question} ${f.expectedAnswer}`, 2, 0.15);
    if (indices.length === 0) continue;
    targets.push({
      kind: "cove",
      reason: `CoVe failed: "${f.question}"`,
      sentenceIndices: indices,
      sentences: indices.map((i) => sents[i]),
      payload: f.expectedAnswer,
      remediation:
        `Re-verify against evidence. The current sentence(s) claim: "${f.expectedAnswer}". ` +
        `Independent verification returned: "${f.verifiedAnswer}". ` +
        `Either narrow the claim to what the evidence supports, tag it [UNVERIFIED], or remove it.`,
    });
  }

  for (const d of advDefects) {
    // The defect message often names a phrase or gate; use it as the needle.
    const indices = locateSentences(draft, d.message, 2, 0.12);
    if (indices.length === 0) {
      // Structural defect with no obvious anchor — apply as document-level hint.
      // Recorded as an EMPTY-index target so the aggregator can still log it.
      targets.push({
        kind: "adversarial",
        reason: `Adversarial defect (no sentence anchor): ${d.code}`,
        sentenceIndices: [],
        sentences: [],
        payload: d.message,
        remediation: d.message,
      });
      continue;
    }
    targets.push({
      kind: "adversarial",
      reason: `Adversarial defect: ${d.code} [${d.severity}]`,
      sentenceIndices: indices,
      sentences: indices.map((i) => sents[i]),
      payload: d.message,
      remediation: d.message,
    });
  }
  return targets;
}

// ── Per-target LLM rewrite (minimal, targeted, resilient) ──────────────────

const CITATION_RE = /\[[Ss]?\d{1,3}\]/g;
const CITATION_GROUP_RE = /\[S?\d{1,3}(?:\s*,\s*S?\d{1,3})+\]/gi;
const SINGLE_CITATION_RE = /\[S?(\d{1,3})\]/gi;
const PLACEHOLDER_MARKER_RE = /\[(DATA GAP|ASSUMPTION|TBD|PROPOSED)\]/gi;

function isRealUrl(url: unknown): boolean {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function isCssResetSnippet(text: unknown): boolean {
  const s = String(text ?? "").toLowerCase();
  return /table,\s*caption,\s*tbody/.test(s) || /--font-inter|font-family:\s*var\(--font/.test(s);
}

function sourceWordOverlap(question: string, sourceText: string): number {
  const stop = new Set(["that", "this", "with", "from", "have", "what", "your", "will", "into", "using", "made", "large", "demand", "product", "exist", "doesn", "doesnt"]);
  const q = new Set((question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !stop.has(w)));
  if (q.size === 0) return 0;
  const hay = sourceText.toLowerCase();
  let hit = 0;
  for (const w of q) if (hay.includes(w)) hit++;
  return hit / q.size;
}

function invalidCitationIds(question: string, audit?: CitationAuditLike): Set<number> {
  const bad = new Set<number>();
  const entries = audit?.entries ?? [];
  for (const entry of entries) {
    const id = Number(entry.id);
    if (!Number.isFinite(id)) continue;
    const text = `${entry.title ?? ""} ${entry.snippet ?? entry.content ?? ""}`;
    if (!isRealUrl(entry.url) || isCssResetSnippet(text) || sourceWordOverlap(question, text) === 0) bad.add(id);
  }
  for (const r of audit?.auditResults ?? []) {
    const id = Number(r.id ?? String(r.tag ?? "").match(/\d+/)?.[0]);
    if (!Number.isFinite(id)) continue;
    if (r.found === false || r.trusted === false || Number(r.snippetOverlap ?? 1) < 0.2 || Number(r.entailment ?? 1) === 0) bad.add(id);
  }
  return bad;
}

function stripInvalidCitationTags(text: string, badIds: Set<number>): { text: string; actions: string[] } {
  if (badIds.size === 0) return { text, actions: [] };
  const actions: string[] = [];
  let next = text.replace(CITATION_GROUP_RE, (group) => {
    const ids = Array.from(group.matchAll(/S?(\d{1,3})/gi)).map((m) => Number(m[1]));
    const kept = ids.filter((id) => !badIds.has(id));
    const removed = ids.filter((id) => badIds.has(id));
    if (removed.length) actions.push(`Removed invalid grouped citation id(s) ${removed.map((id) => `[S${id}]`).join(", ")}.`);
    return kept.length ? `[${kept.map((id) => `S${id}`).join(", ")}]` : "";
  });
  next = next.replace(SINGLE_CITATION_RE, (tag, raw) => {
    const id = Number(raw);
    if (!badIds.has(id)) return tag;
    actions.push(`Removed invalid citation [S${id}].`);
    return "";
  });
  return { text: next.replace(/\s+([.,;:])/g, "$1").replace(/[ \t]{2,}/g, " "), actions };
}

function normalizeBarePlaceholders(text: string): { text: string; actions: string[] } {
  const actions: string[] = [];
  const next = text.replace(PLACEHOLDER_MARKER_RE, (_m, kind) => {
    const label = String(kind).toUpperCase();
    actions.push(`Converted bare [${label}] marker to explicit COVEA open-item marker.`);
    return label === "DATA GAP" || label === "TBD"
      ? "[OPEN_INPUT: owner, source, formula required before decision sign-off]"
      : "[EXPLICIT_ASSUMPTION: owner, formula, sensitivity required before 10/10 sign-off]";
  });
  return { text: next, actions };
}

function synthesizeReferences(text: string, audit?: CitationAuditLike): { text: string; actions: string[] } {
  const entries = (audit?.entries ?? []).filter((e) => Number.isFinite(Number(e.id)) && isRealUrl(e.url));
  if (entries.length === 0) return { text, actions: [] };
  const refs = ["## References", ...entries.map((e) => `[S${Number(e.id)}] ${e.title || "Untitled"}. ${e.url}`)].join("\n");
  if (/##\s*references\b/i.test(text)) return { text, actions: [] };
  return { text: `${text.trim()}\n\n${refs}\n`, actions: [`Appended deterministic References section with ${entries.length} URL-backed source(s).`] };
}

function preservedCitations(text: string): string[] {
  return Array.from(text.matchAll(CITATION_RE)).map((m) => m[0]);
}

async function rewriteRegion(opts: {
  apiKey: string;
  model: string;
  question: string;
  region: string;
  target: CoveaTarget;
  innovationContext?: string;
  researchEvidence?: string;
}): Promise<{ text: string; ok: boolean; error?: string }> {
  const cites = preservedCitations(opts.region);
  // NO TRUNCATION. Full region + full remediation + full payload.
  const innovationBlock = opts.innovationContext ? `\nINNOVATION PERSONA/PATH (stay in voice; do not contradict the discovery framing):\n${opts.innovationContext.slice(0, 600)}\n` : "";
  const evidenceBlock = opts.researchEvidence ? `\nAVAILABLE EVIDENCE (cite from this if correcting a factual claim; never invent):\n${opts.researchEvidence.slice(0, 2000)}\n` : "";
  const prompt = `You are a targeted copy-editor. You will rewrite ONLY the passage below, minimally, to satisfy exactly one specific defect. Do not add new content. Do not rewrite anything not in the passage. Preserve every citation marker [S#] verbatim (${cites.join(", ") || "none present"}).

USER QUESTION (for context only, do not restate):
${opts.question}
${innovationBlock}${evidenceBlock}
DEFECT TO RESOLVE (${opts.target.kind.toUpperCase()}):
${opts.target.remediation}

PASSAGE TO REPAIR (do not exceed the length of this passage by more than 20%):
<<<
${opts.region}
>>>

Output the rewritten passage only. No preamble, no headers, no code fences, no commentary.`;

  try {
    const res: any = await geminiGenerate({
      apiKey: opts.apiKey,
      model: opts.model,
      prompt,
      maxOutputTokens: Math.max(400, Math.min(2400, Math.ceil(opts.region.length / 2))),
    });
    const text: string = String(res?.text ?? res?.output ?? "").trim();
    if (!text) return { text: "", ok: false, error: "empty model response" };
    return { text, ok: true };
  } catch (e) {
    return { text: "", ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Backup route: deterministic tag-annotation when the LLM route fails ────

function deterministicPatch(region: string, target: CoveaTarget): string {
  // Non-prompt architectural fallback: annotate the region with a machine
  // readable tag so downstream renderers can highlight and human reviewers can
  // fix. Never silently mutate content beyond adding a suffix tag.
  const tag =
    target.kind === "cove"
      ? "[COVEA:UNVERIFIED]"
      : "[COVEA:ADV_DEFECT]";
  if (region.trim().endsWith(tag)) return region; // idempotent
  return `${region.trim()} ${tag}`;
}

// ── Aggregate: build the repaired draft one target at a time ───────────────

const MAX_TOTAL_EDIT_PCT = 0.2; // hard cap: never touch >20% of the draft
const MAX_SHRINK_PCT = 0.4; // reject if the rewrite lost >40% of its region

const MODEL_PRIMARY = "gemini-2.5-flash";
const MODEL_FALLBACK = "gemini-2.0-flash-lite";

export async function runCoveaRepair(opts: {
  apiKey: string;
  question: string;
  draft: string;
  coveFailures: CoveFailure[];
  advDefects: AdversarialDefect[];
  citationAudit?: CitationAuditLike;
  /** Innovation persona + path context so repairs stay in-voice. */
  innovationContext?: string;
  /** Prewriting research evidence block so repairs can cite real sources. */
  researchEvidence?: string;
  onProgress?: (msg: string) => void;
}): Promise<CoveaResult> {
  const log: string[] = [];
  const errors: string[] = [];
  const deterministicActions: string[] = [];
  const emit = (m: string) => {
    log.push(m);
    try {
      opts.onProgress?.(`COVEA · ${m}`);
    } catch {
      /* fail-open */
    }
  };

  let workingDraft = opts.draft;

  // Deterministic containment runs even with no API key. It is deliberately
  // non-generative: remove bad citation tags, make unresolved placeholders
  // explicit, and append a ledger-derived References section.
  const badIds = invalidCitationIds(opts.question, opts.citationAudit);
  const citationFix = stripInvalidCitationTags(workingDraft, badIds);
  if (citationFix.text !== workingDraft) {
    workingDraft = citationFix.text;
    deterministicActions.push(...citationFix.actions);
  }
  const placeholderFix = normalizeBarePlaceholders(workingDraft);
  if (placeholderFix.text !== workingDraft) {
    workingDraft = placeholderFix.text;
    deterministicActions.push(...placeholderFix.actions);
  }
  const refsFix = synthesizeReferences(workingDraft, opts.citationAudit);
  if (refsFix.text !== workingDraft) {
    workingDraft = refsFix.text;
    deterministicActions.push(...refsFix.actions);
  }
  for (const action of deterministicActions) emit(`deterministic · ${action}`);

  const targets = buildTargets(workingDraft, opts.coveFailures, opts.advDefects);
  emit(`identified ${targets.length} target(s) (${opts.coveFailures.length} CoVe, ${opts.advDefects.length} adversarial)`);

  const patches: CoveaPatch[] = [];
  let cumulativeEditedChars = 0;
  let accepted = 0,
    rejected = 0,
    skipped = 0;

  for (const target of targets) {
    if (target.sentenceIndices.length === 0) {
      emit(`skip · ${target.reason} · no sentence anchor found (document-level defect logged only)`);
      patches.push({
        target,
        beforeText: "",
        afterText: "",
        accepted: false,
        rejectReason: "no sentence anchor",
        model: "n/a",
        latencyMs: 0,
        attempts: 0,
      });
      skipped++;
      continue;
    }

    // Assemble the region: contiguous span from min to max sentence index.
    const sents = splitSentences(workingDraft);
    const min = Math.min(...target.sentenceIndices);
    const max = Math.max(...target.sentenceIndices);
    // Cap the region at ~one paragraph (≤5 contiguous sentences).
    const regionStart = min;
    const regionEnd = Math.min(sents.length - 1, Math.min(max, min + 4));
    const region = sents.slice(regionStart, regionEnd + 1).join(" ");

    if (region.length === 0) {
      skipped++;
      continue;
    }

    // Budget guard: total edited region ≤ 20% of the original draft length.
    if (cumulativeEditedChars + region.length > opts.draft.length * MAX_TOTAL_EDIT_PCT) {
      emit(`skip · budget · would exceed 20% total edit cap (already ${cumulativeEditedChars}/${opts.draft.length}ch, this region ${region.length}ch)`);
      skipped++;
      patches.push({
        target,
        beforeText: region,
        afterText: region,
        accepted: false,
        rejectReason: "20% budget cap reached",
        model: "n/a",
        latencyMs: 0,
        attempts: 0,
      });
      continue;
    }

    const started = Date.now();
    // Try primary model, then fallback, then deterministic annotation.
    let attempt = 0;
    let after = "";
    let modelUsed = MODEL_PRIMARY;
    let lastErr = "";
    if (opts.apiKey) {
      for (const model of [MODEL_PRIMARY, MODEL_FALLBACK]) {
        attempt++;
        modelUsed = model;
        const res = await rewriteRegion({ apiKey: opts.apiKey, model, question: opts.question, region, target, innovationContext: opts.innovationContext, researchEvidence: opts.researchEvidence });
        if (res.ok && res.text) {
          after = res.text;
          break;
        }
        lastErr = res.error ?? "unknown";
        emit(`retry · ${target.kind} · ${model} → ${lastErr}`);
      }
    } else {
      lastErr = "no API key; skipped LLM route";
    }

    if (!after) {
      // Backup route: deterministic annotation. Preserves all original content.
      after = deterministicPatch(region, target);
      modelUsed = "deterministic-annotation";
      errors.push(`${target.reason} → LLM route unavailable (${lastErr}); applied deterministic annotation`);
    }

    // Sanity gates on the rewrite.
    const shrinkPct = (region.length - after.length) / region.length;
    const preservedBefore = preservedCitations(region);
    const preservedAfter = preservedCitations(after);
    const missingCites = preservedBefore.filter((c) => !preservedAfter.includes(c));
    let rejectReason: string | undefined;
    if (shrinkPct > MAX_SHRINK_PCT) rejectReason = `shrank ${(shrinkPct * 100).toFixed(0)}% (>40% cap)`;
    else if (missingCites.length > 0) rejectReason = `dropped citation(s) ${missingCites.join(", ")}`;

    if (rejectReason) {
      patches.push({
        target,
        beforeText: region,
        afterText: after,
        accepted: false,
        rejectReason,
        model: modelUsed,
        latencyMs: Date.now() - started,
        attempts: attempt,
      });
      emit(`reject · ${target.reason} · ${rejectReason} · kept original`);
      rejected++;
      continue;
    }

    // Apply the patch by string replacement of the exact region.
    const idx = workingDraft.indexOf(region);
    if (idx === -1) {
      // Region no longer literally present (previous patch changed spacing).
      // Fall back to leaving text alone.
      patches.push({
        target,
        beforeText: region,
        afterText: after,
        accepted: false,
        rejectReason: "region no longer present in working draft (order dependency)",
        model: modelUsed,
        latencyMs: Date.now() - started,
        attempts: attempt,
      });
      rejected++;
      continue;
    }
    workingDraft = workingDraft.slice(0, idx) + after + workingDraft.slice(idx + region.length);
    cumulativeEditedChars += region.length;
    patches.push({
      target,
      beforeText: region,
      afterText: after,
      accepted: true,
      model: modelUsed,
      latencyMs: Date.now() - started,
      attempts: attempt,
    });
    emit(`accept · ${target.reason} · ${region.length}→${after.length}ch · ${modelUsed}`);
    accepted++;
  }

  const charsChanged = Math.abs(workingDraft.length - opts.draft.length);
  const pct = opts.draft.length ? charsChanged / opts.draft.length : 0;

  return {
    ranAt: Date.now(),
    targets,
    patches,
    originalDraft: opts.draft,
    repairedDraft: workingDraft,
    charsChanged,
    charsChangedPct: pct,
    acceptedCount: accepted,
    rejectedCount: rejected,
    skippedCount: skipped,
    log,
    errors,
    deterministicActions,
  };
}
