/**
 * pipeline-trace-bus.ts — NET-NEW WORKSPACE MODULE (Type C seam)
 * ===========================================================================
 * Durable, dependency-free recorder for every observable event the VERITAS
 * V15 / GBSE pipeline emits.
 *
 * WHAT THIS IS AND IS NOT
 * -----------------------
 * This module records ONLY events that actually fired. It never synthesises,
 * interpolates, or infers a stage that did not emit. If the pipeline is silent
 * for a phase, the phase is absent from the trace — that absence is itself a
 * finding, not something to paper over.
 *
 * OBSERVABILITY SOURCES (all three are real, verified against package source)
 *   1. `onProgress(s: string)` — threaded by `runV15OnQuestion` through every
 *      stage: grounding, best-of-N, HDIG, CoVe, adversarial preflight, depth-N
 *      repair, adversarial red-team, repair accept/reject, polish, citation
 *      audit. Intercepted in the `src/lib/v15-pipeline.ts` seam.
 *   2. `scraper-debug-bus` — every scraper lane (vanguard, hydra, nexus, sibyl,
 *      strata, palisade, arbiter, vnext, academic) emits timestamped lines.
 *   3. `outcome.*` — the returned object carries passHistory, coveReport,
 *      adversarialPreview, candidates (best-of-N), citationAudit (with the
 *      stage each source was FIRST admitted at), guardScore, judgeScore.
 *
 * NON-INTERCEPTABLE (documented in flatten-guide.md §9)
 *   `groundQuestion` is called RELATIVELY by the pipeline, so it cannot be
 *   wrapped. Retrieval is therefore observed via (1) and (2), not by wrapping.
 * ===========================================================================
 */

export type PhaseId =
  | "init"
  | "genome"
  | "grounding"
  | "bestofn"
  | "draft"
  | "hdig"
  | "reground"
  | "cove"
  | "adv-preflight"
  | "repair"
  | "adversarial"
  | "adv-repair"
  | "polish"
  | "citation"
  | "judge"
  | "covea"
  | "done"
  | "error"
  | "other";

export interface PhaseMeta {
  id: PhaseId;
  label: string;
  color: string;
  /** What this phase is responsible for — shown in the console. */
  role: string;
}

export const PHASES: PhaseMeta[] = [
  { id: "init", label: "Init", color: "#64748b", role: "Profile resolution, model pool, rate-limit budget." },
  { id: "genome", label: "Innovation Genome", color: "#a855f7", role: "v3–v10 creative/compliance plane; injects discovery directive into the question." },
  { id: "grounding", label: "Grounding", color: "#0ea5e9", role: "Template-directed or single-query web retrieval into the citation ledger." },
  { id: "bestofn", label: "Best-of-N", color: "#14b8a6", role: "N distinct outlines generated, scored by density; winner expanded to full draft." },
  { id: "draft", label: "Draft", color: "#22c55e", role: "Full-length generation against the evidence block + style directives." },
  { id: "hdig", label: "HDIG", color: "#06b6d4", role: "Hypothesis-driven iterative grounding — targeted re-search on detected gaps." },
  { id: "reground", label: "Re-ground", color: "#0891b2", role: "Stage-triggered supplemental retrieval." },
  { id: "cove", label: "CoVe", color: "#f59e0b", role: "Chain-of-Verification: plan questions, answer them INDEPENDENTLY, cross-check." },
  { id: "adv-preflight", label: "Adv Preflight", color: "#fb923c", role: "Pre-N-Deep red team; blocking defects become mandatory constraints." },
  { id: "repair", label: "Depth Repair", color: "#8b5cf6", role: "N-Deep localized patch passes; each accepted only on score+severity improvement." },
  { id: "adversarial", label: "Adversarial", color: "#ef4444", role: "Full red-team critique; defect list + verdict." },
  { id: "adv-repair", label: "Adv Repair", color: "#dc2626", role: "Monotonic repair pass — rejected if it would drop the guard score." },
  { id: "polish", label: "Polish", color: "#ec4899", role: "Structure/scaffolding fix without content change; rejected on score drop." },
  { id: "citation", label: "Citation Audit", color: "#3b82f6", role: "Tag census: trusted / untrusted / missing, then entailment verification." },
  { id: "judge", label: "Judge Panel", color: "#eab308", role: "Multi-model panel scoring; excluded judges recorded with reason." },
  { id: "covea", label: "COVEA Repair", color: "#7c3aed", role: "Targeted post-completion CoVe + adversarial repair (workspace-added, sentence-scoped, ≤20% total edit budget)." },
  { id: "done", label: "Done", color: "#10b981", role: "Terminal." },
  { id: "error", label: "Error", color: "#b91c1c", role: "Caught failure — pipeline continued or aborted." },
  { id: "other", label: "Other", color: "#94a3b8", role: "Unclassified emission." },
];

export const PHASE_MAP: Record<PhaseId, PhaseMeta> = Object.fromEntries(
  PHASES.map((p) => [p.id, p])
) as Record<PhaseId, PhaseMeta>;

/**
 * Classifier — maps a raw onProgress string to a phase.
 * Patterns are taken VERBATIM from the emitting call sites in
 * `v15-pipeline.orig.ts`. Order matters: most specific first.
 */
const CLASSIFIERS: Array<[RegExp, PhaseId]> = [
  [/^\[Innovation Genome/i, "genome"],
  [/best-of-N:/i, "bestofn"],
  [/^HDIG/i, "hdig"],
  [/^Re-ground \(/i, "reground"],
  [/^CoVe:/i, "cove"],
  [/adversarial preflight|adv-preflight/i, "adv-preflight"],
  [/adversarial repair/i, "adv-repair"],
  [/adversarial ·|adversarial red-team|adversarial engine|adversarial:/i, "adversarial"],
  [/^depth \d+:/i, "repair"],
  [/^polish/i, "polish"],
  [/citation audit|entailment/i, "citation"],
  [/judging|judge panel|judges excluded/i, "judge"],
  [/template-directed grounding|web grounding|^grounded |^grounding|grounded via|grounding unavailable|grounded \[/i, "grounding"],
  [/^drafting/i, "draft"],
  [/^done$/i, "done"],
  [/unavailable|failed|error/i, "error"],
];

export function classifyProgress(message: string): PhaseId {
  for (const [re, id] of CLASSIFIERS) if (re.test(message)) return id;
  return "other";
}

export interface TraceEvent {
  seq: number;
  ts: number;
  /** ms since run start */
  dt: number;
  phase: PhaseId;
  source: "progress" | "scraper" | "outcome" | "system";
  /** scraper lane name, when source === "scraper" */
  lane?: string;
  message: string;
}

export interface PassRecord {
  index: number;
  guardScore: number;
  accepted: boolean;
  note: string;
  textLength?: number;
  critical?: number;
  major?: number;
}

export interface SourceRecord {
  stage: string;
  title?: string;
  url?: string;
  snippet?: string;
}

export interface RunRecord {
  id: string;
  mode: "v15" | "baseline" | "external";
  question: string;
  /** question as MUTATED by the genome directive, if it was mutated */
  effectiveQuestion?: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "complete" | "failed";
  events: TraceEvent[];
  /** Per-phase aggregate: count + wall time occupied */
  phaseStats: Partial<Record<PhaseId, { count: number; firstDt: number; lastDt: number }>>;
  passes: PassRecord[];
  sources: SourceRecord[];
  /** Raw request options, secrets redacted */
  input?: Record<string, unknown>;
  /** Raw outcome object, large strings truncated for the UI */
  output?: Record<string, unknown>;
  finalText?: string;
  draftText?: string;
  guardScore?: number;
  judgeScore?: number | null;
  error?: string;
  // Turn-4 additions — all optional, populated by the v15-pipeline wrapper.
  /** COVEA repair pass artefact (targeted CoVe + adversarial repair). */
  covea?: unknown;
  /** Genome v1 + v2 + v10 snapshot injected into this run. */
  genome?: unknown;
  /** Independent prewriting research, completed before report generation. */
  research?: unknown;
  /** Original text BEFORE COVEA repair — needed for attribution + diff view. */
  preCoveaText?: string;
}

const HISTORY_MAX = 25;
const EVENT_MAX = 4000;

let runs: RunRecord[] = [];
let activeId: string | null = null;
let seqCounter = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* fail-open per subscriber */
    }
  }
}

export function subscribeTrace(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getRuns(): RunRecord[] {
  return runs;
}

export function getActiveRun(): RunRecord | null {
  return runs.find((r) => r.id === activeId) ?? null;
}

export function clearRuns(): void {
  runs = [];
  activeId = null;
  notify();
}

function redact(v: unknown): unknown {
  if (typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (/key|token|secret|password|auth/i.test(k)) {
      out[k] = typeof val === "string" && val.length > 0 ? `«redacted:${val.length}ch»` : "«redacted»";
    } else if (typeof val === "function") {
      out[k] = `«fn ${(val as Function).name || "anonymous"}»`;
    } else if (typeof val === "string" && val.length > 4000) {
      out[k] = `${val.slice(0, 4000)}\n…«truncated ${val.length - 4000} chars»`;
    } else if (typeof val === "object" && val !== null) {
      try {
        const j = JSON.stringify(val);
        out[k] = j.length > 6000 ? `«object ${j.length}b — truncated»` : (val as unknown);
      } catch {
        out[k] = "«uncloneable»";
      }
    } else {
      out[k] = val;
    }
  }
  return out;
}

export function startRun(mode: RunRecord["mode"], question: string, input?: unknown): string {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const rec: RunRecord = {
    id,
    mode,
    question,
    startedAt: Date.now(),
    status: "running",
    events: [],
    phaseStats: {},
    passes: [],
    sources: [],
    input: redact(input) as Record<string, unknown>,
  };
  runs = [rec, ...runs].slice(0, HISTORY_MAX);
  activeId = id;
  pushEvent(id, "system", "init", `run started · mode=${mode} · q="${question.slice(0, 120)}"`);
  notify();
  return id;
}

export function pushEvent(
  runId: string | null,
  source: TraceEvent["source"],
  phase: PhaseId,
  message: string,
  lane?: string
): void {
  const rec = runs.find((r) => r.id === (runId ?? activeId));
  if (!rec) return;
  const dt = Date.now() - rec.startedAt;
  const ev: TraceEvent = { seq: ++seqCounter, ts: Date.now(), dt, phase, source, lane, message };
  rec.events.push(ev);
  if (rec.events.length > EVENT_MAX) rec.events = rec.events.slice(-EVENT_MAX);

  const st = rec.phaseStats[phase] ?? { count: 0, firstDt: dt, lastDt: dt };
  st.count += 1;
  st.lastDt = dt;
  rec.phaseStats[phase] = st;

  // Structured extraction from known emission formats — parsed, never guessed.
  // "depth 3: guard 8.42 (best-so-far 8.10 @ pass 2) · 14 canonical + 3 testbed"
  const depthM = /^depth (\d+): guard ([\d.]+)/.exec(message);
  if (depthM) {
    rec.passes.push({
      index: Number(depthM[1]),
      guardScore: Number(depthM[2]),
      accepted: true,
      note: message,
    });
  }
  // "depth 3: accepted 2 localized patch(es) · guard 8.10→8.42 · crit/major 1/3→0/1"
  const acceptM = /^depth (\d+): accepted (\d+) localized patch/.exec(message);
  if (acceptM) {
    const sev = /crit\/major (\d+)\/(\d+)→(\d+)\/(\d+)/.exec(message);
    rec.passes.push({
      index: Number(acceptM[1]),
      guardScore: Number(/→([\d.]+)/.exec(message)?.[1] ?? 0),
      accepted: true,
      note: `accepted ${acceptM[2]} patch(es)`,
      critical: sev ? Number(sev[3]) : undefined,
      major: sev ? Number(sev[4]) : undefined,
    });
  }
  if (/rejected localized patches|repair: rejected|polish: rejected/.test(message)) {
    rec.passes.push({ index: rec.passes.length, guardScore: NaN, accepted: false, note: message });
  }

  notify();
}

export function attachScraperLine(lane: string, message: string): void {
  if (!activeId) return;
  pushEvent(activeId, "scraper", "grounding", message, lane);
}

export function finishRun(runId: string, outcome: unknown, error?: unknown): void {
  const rec = runs.find((r) => r.id === runId);
  if (!rec) return;
  rec.endedAt = Date.now();
  rec.status = error ? "failed" : "complete";
  if (error) rec.error = error instanceof Error ? error.message : String(error);

  const o = outcome as Record<string, any> | undefined;
  if (o) {
    rec.output = redact(o) as Record<string, unknown>;
    rec.finalText = typeof o.fixed === "string" && o.fixed ? o.fixed : (o.draft ?? "");
    rec.draftText = typeof o.draft === "string" ? o.draft : undefined;
    rec.guardScore = typeof o.guardScore === "number" ? o.guardScore : undefined;
    rec.judgeScore = typeof o.judgeScore === "number" ? o.judgeScore : null;

    // passHistory is authoritative — overrides the string-parsed approximation.
    if (Array.isArray(o.passHistory) && o.passHistory.length > 0) {
      rec.passes = o.passHistory.map((p: any, i: number) => ({
        index: i + 1,
        guardScore: Number(p?.guardScore ?? p?.score ?? NaN),
        accepted: p?.accepted !== false,
        note: String(p?.note ?? p?.label ?? `pass ${i + 1}`),
        textLength: typeof p?.text === "string" ? p.text.length : undefined,
      }));
    }
    // citationAudit carries the stage each source was FIRST admitted at.
    const entries = o?.citationAudit?.entries;
    if (Array.isArray(entries)) {
      rec.sources = entries
        .filter((e: any) => e?.url)
        .map((e: any) => ({
          stage: String(e.stage ?? "unknown"),
          title: e.title,
          url: e.url,
          snippet: typeof e.snippet === "string" ? e.snippet.slice(0, 600) : undefined,
        }));
    }
  }
  pushEvent(runId, "system", error ? "error" : "done", error ? `run failed: ${rec.error}` : "run complete");
  if (activeId === runId) activeId = null;
  notify();
}

/** Attach a genome snapshot to the active or specified run. */
export function attachGenome(runId: string | null, genome: unknown): void {
  const rec = runs.find((r) => r.id === (runId ?? activeId));
  if (!rec) return;
  rec.genome = genome;
  notify();
}

export function attachResearch(runId: string | null, research: unknown): void {
  const rec = runs.find((r) => r.id === (runId ?? activeId));
  if (!rec) return;
  rec.research = research;
  notify();
}

/** Attach a COVEA repair result and mark preCoveaText for diffing. */
export function attachCovea(runId: string | null, preText: string, covea: unknown): void {
  const rec = runs.find((r) => r.id === (runId ?? activeId));
  if (!rec) return;
  rec.preCoveaText = preText;
  rec.covea = covea;
  // Update finalText to reflect the repaired text if the covea result has one.
  const c = covea as { repairedDraft?: string } | undefined;
  if (c?.repairedDraft && typeof c.repairedDraft === "string") rec.finalText = c.repairedDraft;
  notify();
}

/** Register an output produced OUTSIDE this app (paste-in analysis). */
export function registerExternalRun(question: string, text: string): string {
  const id = startRun("external", question);
  const rec = runs.find((r) => r.id === id)!;
  rec.finalText = text;
  rec.status = "complete";
  rec.endedAt = Date.now();
  pushEvent(id, "system", "done", `external output registered · ${text.length} chars`);
  activeId = null;
  notify();
  return id;
}

/** Full deterministic export — this is the artefact you hand to another LLM. */
export function exportRun(run: RunRecord): string {
  return JSON.stringify(
    {
      schema: "veritas.pipeline-trace/1",
      exportedAt: new Date().toISOString(),
      run: {
        id: run.id,
        mode: run.mode,
        status: run.status,
        question: run.question,
        durationMs: (run.endedAt ?? Date.now()) - run.startedAt,
        guardScore: run.guardScore,
        judgeScore: run.judgeScore,
        phaseStats: run.phaseStats,
        passes: run.passes,
        sources: run.sources,
        events: run.events.map((e) => ({ dt: e.dt, phase: e.phase, source: e.source, lane: e.lane, message: e.message })),
        input: run.input,
        output: run.output,
        finalText: run.finalText,
      },
    },
    null,
    2
  );
}
