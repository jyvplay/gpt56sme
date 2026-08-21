/**
 * PipelineDebugConsole.tsx — NET-NEW WORKSPACE COMPONENT (Type C seam)
 * ===========================================================================
 * TURN-4 REVISION — additive, minimum-diff, preserves every turn-2 tab.
 *
 * Tabs (in this order):
 *   Timeline     phase-classified event log (unchanged)
 *   Phases       per-phase gantt + roles (unchanged)
 *   Passes       repair-pass ledger (unchanged)
 *   Sources      citation ledger + scraper lane trail (unchanged; now dedup)
 *   I/O          redacted request + full outcome + draft/final (unchanged)
 *   Probe        run V15 or production baseline from here (unchanged)
 *   Attribution  ★ NEW · which pipeline step wrote which final sentence
 *   Diagnosis    ★ NEW · pipeline-architectural fixes (not prompt tweaks)
 *   Genome+Tpl   ★ NEW · Williams / Innovation Genome v1+v2 / template rubric
 *   COVEA        ★ NEW · targeted repair audit (accept/reject with reason)
 *   Forge        (turn-2) generic rubric scoring — kept as a supporting tool
 *
 * The Forge tab is retained but explicitly demoted with a banner explaining
 * that Diagnosis (not Forge) is the correct entry point per turn-3 clarification.
 * ===========================================================================
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  PHASES,
  PHASE_MAP,
  subscribeTrace,
  getRuns,
  clearRuns,
  registerExternalRun,
  exportRun,
  type RunRecord,
  type PhaseId,
} from "@/lib/debug/pipeline-trace-bus";
import {
  scoreDeterministic,
  judgeWithLLM,
  diagnose,
  loadTrajectory,
  recordTrajectory,
  clearTrajectory,
  buildOproMetaPrompt,
  buildExternalAuditBundle,
  type ScoreReport,
  type PromptDiagnosis,
  type TrajectoryPoint,
} from "@/lib/debug/prompt-forge";
import { runV15OnQuestion, runBaselineOnQuestion } from "@/lib/v15-pipeline";
import { getGeminiKey, getV15Enabled } from "@/lib/v15-state";
import {
  loadTemplateRubric,
  computeGenomeSnapshot,
  readLiveGenome,
  OMEGA_TEMPLATES,
  ARCHETYPES,
  type TemplateRubric,
} from "@/lib/debug/template-rubric";
import {
  buildStages,
  attributeSentences,
  bucketByOrigin,
  type AttributionReport,
} from "@/lib/debug/step-attribution";
import {
  diagnoseRun,
  diagnoseFromInputs,
  bundleForExternalReview,
  exportRepairOrderFor,
  type DiagnosisReport,
} from "@/lib/debug/pipeline-diagnosis";
import { buildForensics, exportForensics, isPlaceholderUrl, type ForensicsReport } from "@/lib/debug/scraper-forensics";
import { prescribe, renderPrescription, exportPrescription, type Prescription } from "@/lib/debug/architecture-prescription";
import { runSelfTests, type SelfTestReport } from "@/lib/debug/self-test";
import { SCRAPER_LANE_ROADMAP } from "@/lib/debug/scraper-lane-roadmap";
import {
  runScraperDebug,
  type ScraperDebugRun,
  type LaneId,
  type LaneRunRecord,
} from "@/lib/debug/scraper-debug-runner";
import { geminiGenerate } from '@/lib/v15-gemini';
import { getGeminiKey as getKey } from "@/lib/v15-state";

type TabId =
  | "scraper-debug"
  | "timeline"
  | "phases"
  | "passes"
  | "sources"
  | "scrapers"
  | "io"
  | "probe"
  | "attribution"
  | "diagnosis"
  | "genome"
  | "research"
  | "covea"
  | "architecture"
  | "selftest"
  | "forge";

const TABS: { id: TabId; label: string }[] = [
  { id: "scraper-debug", label: "Scraper Debug 🔬" },
  { id: "timeline", label: "Timeline" },
  { id: "phases", label: "Phases" },
  { id: "passes", label: "Passes" },
  { id: "sources", label: "Sources" },
  { id: "scrapers", label: "Scrapers ★" },
  { id: "io", label: "I/O" },
  { id: "probe", label: "Probe" },
  { id: "attribution", label: "Attribution ★" },
  { id: "diagnosis", label: "Diagnosis ★" },
  { id: "genome", label: "Genome+Tpl ★" },
  { id: "research", label: "Research ★" },
  { id: "covea", label: "COVEA ★" },
  { id: "architecture", label: "Architecture ★" },
  { id: "selftest", label: "Self-Test ★" },
  { id: "forge", label: "Forge" },
];

function useTraceTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeTrace(() => setTick((t) => t + 1)), []);
  return tick;
}

function copy(text: string) {
  try {
    navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable */
  }
}
function download(name: string, text: string) {
  try {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    /* download unavailable */
  }
}
const ms = (n: number) => (n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(2)}s`);

/* ── Small primitives ─────────────────────────────────────────────────── */

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: `${color}1a`, color, border: `1px solid ${color}55` }}
    >
      {children}
    </span>
  );
}

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const color = score >= 9 ? "#10b981" : score >= 7.5 ? "#84cc16" : score >= 6 ? "#eab308" : score >= 4 ? "#f97316" : "#ef4444";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-xs text-zinc-500">
      {children}
    </div>
  );
}

/* ── Tab: Timeline (unchanged from turn 2) ────────────────────────────── */

function TimelineTab({ run }: { run: RunRecord | null }) {
  const [filter, setFilter] = useState<PhaseId | "all">("all");
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const events = useMemo(() => {
    if (!run) return [];
    return run.events.filter(
      (e) => (filter === "all" || e.phase === filter) && (!q || e.message.toLowerCase().includes(q.toLowerCase()))
    );
  }, [run, filter, q, run?.events.length]);

  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length, follow]);

  if (!run) return <Empty>No run selected. Run a question in the app or use the <b>Probe</b> tab.</Empty>;
  const active = new Set(run.events.map((e) => e.phase));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setFilter("all")} className={`rounded px-2 py-1 text-[10px] font-bold ${filter === "all" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}>
          ALL ({run.events.length})
        </button>
        {PHASES.filter((p) => active.has(p.id)).map((p) => (
          <button key={p.id} onClick={() => setFilter(p.id)} title={p.role} className="rounded px-2 py-1 text-[10px] font-bold" style={filter === p.id ? { background: p.color, color: "#fff" } : { background: `${p.color}1a`, color: p.color }}>
            {p.label} ({run.phaseStats[p.id]?.count ?? 0})
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search events…" className="ml-auto w-48 rounded border border-zinc-300 px-2 py-1 text-[11px]" />
        <label className="flex items-center gap-1 text-[10px] text-zinc-600">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 p-2 font-mono text-[11px] leading-relaxed">
        {events.length === 0 ? (
          <div className="p-4 text-zinc-500">No events match.</div>
        ) : (
          events.map((e) => {
            const meta = PHASE_MAP[e.phase];
            return (
              <div key={e.seq} className="flex gap-2 border-b border-zinc-900 py-0.5 hover:bg-zinc-900">
                <span className="w-16 shrink-0 text-right text-zinc-600">{ms(e.dt)}</span>
                <span className="w-28 shrink-0 truncate font-bold" style={{ color: meta.color }} title={meta.role}>
                  {e.lane ? `${meta.label}/${e.lane}` : meta.label}
                </span>
                <span className="w-16 shrink-0 text-zinc-600">{e.source}</span>
                <span className="whitespace-pre-wrap break-words text-zinc-200">{e.message}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/* ── Tab: Phases (unchanged) ──────────────────────────────────────────── */
function PhasesTab({ run }: { run: RunRecord | null }) {
  if (!run) return <Empty>No run selected.</Empty>;
  const total = Math.max(1, (run.endedAt ?? Date.now()) - run.startedAt);
  const seen = PHASES.filter((p) => run.phaseStats[p.id]);
  return (
    <div className="space-y-3 overflow-auto">
      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">Execution gantt · total {ms(total)}</div>
        <div className="space-y-1.5">
          {seen.map((p) => {
            const st = run.phaseStats[p.id]!;
            const left = (st.firstDt / total) * 100;
            const width = Math.max(0.8, ((st.lastDt - st.firstDt) / total) * 100);
            return (
              <div key={p.id} className="flex items-center gap-2">
                <div className="w-32 shrink-0 truncate text-[11px] font-semibold" style={{ color: p.color }}>{p.label}</div>
                <div className="relative h-4 flex-1 rounded bg-zinc-100">
                  <div className="absolute top-0 h-4 rounded" style={{ left: `${left}%`, width: `${width}%`, background: p.color }} title={`${ms(st.firstDt)} → ${ms(st.lastDt)}`} />
                </div>
                <div className="w-32 shrink-0 text-right font-mono text-[10px] text-zinc-500">{st.count}× · {ms(st.lastDt - st.firstDt)}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {seen.map((p) => {
          const st = run.phaseStats[p.id]!;
          return (
            <div key={p.id} className="rounded-lg border border-zinc-200 bg-white p-3">
              <div className="mb-1 flex items-center justify-between">
                <Pill color={p.color}>{p.label}</Pill>
                <span className="font-mono text-[10px] text-zinc-500">{st.count} event(s) · {ms(st.firstDt)}→{ms(st.lastDt)}</span>
              </div>
              <p className="text-[11px] leading-snug text-zinc-600">{p.role}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Tab: Passes (unchanged) ──────────────────────────────────────────── */
function PassesTab({ run }: { run: RunRecord | null }) {
  if (!run) return <Empty>No run selected.</Empty>;
  if (run.passes.length === 0) return <Empty>No repair passes recorded.</Empty>;
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead className="sticky top-0 bg-zinc-100">
          <tr>{["#", "Guard", "Δ", "Verdict", "Crit/Major", "Len", "Note"].map((h) => <th key={h} className="border-b border-zinc-300 px-2 py-1.5 text-left font-bold uppercase tracking-wide text-zinc-600">{h}</th>)}</tr>
        </thead>
        <tbody>
          {run.passes.map((p, i) => {
            const prev = run.passes[i - 1];
            const delta = prev && Number.isFinite(p.guardScore) && Number.isFinite(prev.guardScore) ? p.guardScore - prev.guardScore : null;
            return (
              <tr key={i} className={p.accepted ? "" : "bg-red-50"}>
                <td className="border-b border-zinc-200 px-2 py-1 font-mono">{p.index}</td>
                <td className="border-b border-zinc-200 px-2 py-1 font-mono font-bold">{Number.isFinite(p.guardScore) ? p.guardScore.toFixed(2) : "—"}</td>
                <td className="border-b border-zinc-200 px-2 py-1 font-mono" style={{ color: delta == null ? "#94a3b8" : delta >= 0 ? "#16a34a" : "#dc2626" }}>{delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}</td>
                <td className="border-b border-zinc-200 px-2 py-1">{p.accepted ? <Pill color="#16a34a">accepted</Pill> : <Pill color="#dc2626">rejected</Pill>}</td>
                <td className="border-b border-zinc-200 px-2 py-1 font-mono">{p.critical != null ? `${p.critical}/${p.major ?? 0}` : "—"}</td>
                <td className="border-b border-zinc-200 px-2 py-1 font-mono">{p.textLength ?? "—"}</td>
                <td className="border-b border-zinc-200 px-2 py-1 text-zinc-600">{p.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Tab: Sources (unchanged) ─────────────────────────────────────────── */
function SourcesTab({ run }: { run: RunRecord | null }) {
  if (!run) return <Empty>No run selected.</Empty>;
  const scraperEvents = run.events.filter((e) => e.source === "scraper");
  const byStage = new Map<string, typeof run.sources>();
  for (const s of run.sources) { const b = byStage.get(s.stage) ?? []; b.push(s); byStage.set(s.stage, b); }
  return (
    <div className="space-y-3 overflow-auto">
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-[10px] leading-snug text-sky-800">
        Sources are grouped by the stage at which each was <b>first admitted</b> to the citation ledger.
      </div>
      {run.sources.length === 0 ? (
        <Empty>No sources in <code>outcome.citationAudit.entries</code>.</Empty>
      ) : (
        [...byStage.entries()].map(([stage, list]) => (
          <div key={stage} className="rounded-lg border border-zinc-200 bg-white">
            <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
              <Pill color="#0ea5e9">{stage}</Pill>
              <span className="font-mono text-[10px] text-zinc-500">{list.length} source(s)</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {list.map((s, i) => (
                <div key={i} className="px-3 py-2">
                  <div className="truncate text-[11px] font-semibold text-zinc-800">{s.title || "(untitled)"}</div>
                  {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-[10px] text-sky-600 hover:underline">{s.url}</a>}
                  {s.snippet && <p className="mt-1 line-clamp-3 text-[10px] leading-snug text-zinc-500">{s.snippet}</p>}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">Scraper lane log ({scraperEvents.length})</div>
        <div className="max-h-64 overflow-auto bg-zinc-950 p-2 font-mono text-[10px]">
          {scraperEvents.length === 0 ? (
            <div className="text-zinc-500">No lane events captured via <code>scraper-debug-bus</code>. If you see grounding progress lines in the Timeline but no entries here, the lanes are relaying via <code>onProgress</code> only — that is normal for the package's native scraper paths.</div>
          ) : (
            scraperEvents.map((e) => (
              <div key={e.seq} className="flex gap-2 py-0.5">
                <span className="w-14 shrink-0 text-right text-zinc-600">{ms(e.dt)}</span>
                <span className="w-32 shrink-0 truncate font-bold text-cyan-400">{e.lane}</span>
                <span className="break-words text-zinc-300">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Tab: I/O (unchanged) ─────────────────────────────────────────────── */
function IOTab({ run }: { run: RunRecord | null }) {
  const [view, setView] = useState<"input" | "output" | "draft" | "final">("input");
  if (!run) return <Empty>No run selected.</Empty>;
  const body =
    view === "input" ? JSON.stringify(run.input ?? {}, null, 2) :
    view === "output" ? JSON.stringify(run.output ?? {}, null, 2) :
    view === "draft" ? run.draftText ?? "(no draft captured)" :
    run.finalText ?? "(no final text captured)";
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {(["input", "output", "draft", "final"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${view === v ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}>{v}</button>
        ))}
        <span className="ml-2 font-mono text-[10px] text-zinc-500">{body.length.toLocaleString()} chars</span>
        <button onClick={() => copy(body)} className="ml-auto rounded bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-700">Copy</button>
        <button onClick={() => download(`${run.id}.json`, exportRun(run))} className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white">Export run JSON</button>
      </div>
      {view === "input" && <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">Secrets redacted. Functions shown as <code>«fn name»</code>.</div>}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-200">{body}</pre>
    </div>
  );
}

/* ── Tab: Probe (unchanged) ───────────────────────────────────────────── */
function ProbeTab() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<null | "v15" | "baseline">(null);
  const [webSearch, setWebSearch] = useState(true);
  const [maxDepth, setMaxDepth] = useState(3);
  const [advancedGates, setAdvancedGates] = useState(true);
  const [runJudge, setRunJudge] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const hasKey = !!getGeminiKey();

  const go = useCallback(async (mode: "v15" | "baseline") => {
    if (!question.trim() || busy) return;
    setBusy(mode);
    setLog([`▶ ${mode} start`]);
    const onProgress = (s: string) => setLog((l) => [...l.slice(-200), s]);
    try {
      const apiKey = getGeminiKey();
      if (mode === "v15") {
        await runV15OnQuestion({ apiKey, question: question.trim(), profile: { webSearch } as any, maxDepth, advancedGates, runJudge, onProgress } as any);
      } else {
        await runBaselineOnQuestion({ apiKey, question: question.trim(), onProgress } as any);
      }
      setLog((l) => [...l, `✔ ${mode} complete — see Timeline / Attribution / Diagnosis`]);
    } catch (e) {
      setLog((l) => [...l, `✘ ${e instanceof Error ? e.message : String(e)}`]);
    } finally { setBusy(null); }
  }, [question, busy, webSearch, maxDepth, advancedGates, runJudge]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-[11px] leading-snug text-indigo-900">
        <b>Production vs V15.</b> V15 toggle: <b>{getV15Enabled() ? "ON" : "OFF"}</b>. Baseline = single draft + judge. V15 = full rigor stack + COVEA post-repair.
      </div>
      {!hasKey && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-800">No Gemini API key configured.</div>}
      <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} placeholder="Question to run through the pipeline…" className="w-full resize-y rounded-lg border border-zinc-300 p-2 font-mono text-[12px]" />
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} /> web grounding</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={advancedGates} onChange={(e) => setAdvancedGates(e.target.checked)} /> advanced gates</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={runJudge} onChange={(e) => setRunJudge(e.target.checked)} /> judge panel</label>
        <label className="flex items-center gap-1.5">maxDepth<input type="number" min={1} max={8} value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} className="w-14 rounded border border-zinc-300 px-1 py-0.5" /></label>
        <div className="ml-auto flex gap-2">
          <button disabled={!!busy || !question.trim()} onClick={() => go("baseline")} className="rounded bg-zinc-700 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">{busy === "baseline" ? "Running…" : "Run Production Baseline"}</button>
          <button disabled={!!busy || !question.trim()} onClick={() => go("v15")} className="rounded bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">{busy === "v15" ? "Running…" : "Run V15 Pipeline"}</button>
        </div>
      </div>
      <div className="min-h-40 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 p-2 font-mono text-[10px] text-zinc-300">
        {log.length === 0 ? <span className="text-zinc-600">Live progress here; full trace lands in Timeline.</span> : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

/* ── Tab: Attribution ★ ───────────────────────────────────────────────── */

function AttributionTab({ run }: { run: RunRecord | null }) {
  const report: AttributionReport | null = useMemo(() => {
    if (!run || !run.finalText) return null;
    const out = (run.output ?? {}) as any;
    const stages = buildStages({
      bestOfNCandidates: out.bestOfNCandidates,
      draft: out.draft,
      passHistory: out.passHistory,
      polishText: out.polishApplied ? out.fixed : undefined,
      coveaText: (run.covea as any)?.repairedDraft,
    });
    return attributeSentences(run.finalText, stages);
  }, [run?.id, run?.finalText]);

  if (!run) return <Empty>No run selected.</Empty>;
  if (!report) return <Empty>No final text or stage snapshots — attribution needs at least a draft and a final text.</Empty>;

  const buckets = bucketByOrigin(report);

  return (
    <div className="space-y-3 overflow-auto">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] leading-snug text-emerald-900">
        <b>Attribution</b> maps every sentence in the final output back to the earliest pipeline stage where a
        sufficiently-similar sentence appeared. Sentences with no matching origin are ones the model added ex nihilo
        (usually adversarial-repair or polish; sometimes hallucinated).
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Origin counts (who wrote it)</div>
          {Object.keys(report.originCounts).length === 0 ? <div className="text-[11px] text-zinc-500">no attributions</div> :
            Object.entries(report.originCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-zinc-100 py-0.5 font-mono text-[10px]"><span className="truncate text-zinc-700">{k}</span><span className="font-bold">{v}</span></div>
            ))}
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Modification counts (who edited it)</div>
          {Object.keys(report.modifiedCounts).length === 0 ? <div className="text-[11px] text-zinc-500">no modifications tracked</div> :
            Object.entries(report.modifiedCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-zinc-100 py-0.5 font-mono text-[10px]"><span className="truncate text-zinc-700">{k}</span><span className="font-bold">{v}</span></div>
            ))}
          {report.unattributed > 0 && <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800">{report.unattributed} sentence(s) unattributed — the model added them ex nihilo (potential fabrication site)</div>}
        </div>
      </div>
      <div className="space-y-2">
        {buckets.map((b, i) => (
          <details key={i} className="rounded-lg border border-zinc-200 bg-white" open={i < 2}>
            <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-bold text-zinc-800">
              {b.stage ? <span style={{ color: "#7c3aed" }}>{b.stage.label}</span> : <span className="text-amber-700">(unattributed — potential fabrication)</span>}
              <span className="ml-2 font-mono text-[10px] text-zinc-500">{b.sentences.length} sentence(s)</span>
            </summary>
            <div className="divide-y divide-zinc-100">
              {b.sentences.map((s) => (
                <div key={s.index} className="px-3 py-1.5 text-[11px]">
                  <div className="text-zinc-800">{s.sentence}</div>
                  {s.modifiedByStages.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="text-[10px] text-zinc-500">modified by:</span>
                      {s.modifiedByStages.map((m, j) => <span key={j} className="rounded bg-violet-100 px-1 py-0.5 font-mono text-[9px] text-violet-800">{m.label}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

/* ── Tab: Scrapers ★ — per-lane retrieval forensics ───────────────────── */

function ScrapersTab({ run }: { run: RunRecord | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const rep: ForensicsReport | null = useMemo(() => {
    if (!run) return null;
    try { return buildForensics(run); } catch { return null; }
  }, [run?.id, run?.events.length, run?.output]);

  if (!run) return <Empty>No run selected.</Empty>;
  if (!rep) return <Empty>Forensics unavailable for this run.</Empty>;

  const t = rep.totals;
  return (
    <div className="space-y-3 overflow-auto">
      <div className="rounded-lg border border-cyan-300 bg-cyan-50 p-3 text-[11px] leading-snug text-cyan-900">
        <b>Per-lane retrieval forensics.</b> Every row is parsed from a real emitter line — no lane is shown that
        did not report. <b>clean source</b> := <code>!quarantined &amp;&amp; !hardQuarantined &amp;&amp; content.length ≥ 80</code>{" "}
        (verified in package source). <b>atoms</b> are epistemic claims, not documents — a lane can pack many atoms
        and zero sources, which is the zero-yield defect.
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          { k: "lanes", v: t.lanesSeen, c: "#0891b2" },
          { k: "queries", v: t.queriesDispatched, c: "#0891b2" },
          { k: "ledger", v: t.ledgerEntries, c: "#0891b2" },
          { k: "real URLs", v: t.realUrlCount, c: "#059669" },
          { k: "placeholder", v: t.placeholderUrlCount, c: t.placeholderUrlCount > 0 ? "#dc2626" : "#71717a" },
          { k: "zero-yield", v: rep.zeroYieldLanes.length, c: rep.zeroYieldLanes.length > 0 ? "#dc2626" : "#71717a" },
        ].map((m) => (
          <div key={m.k} className="rounded border bg-white p-2" style={{ borderColor: `${m.c}55` }}>
            <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: m.c }}>{m.k}</div>
            <div className="text-xl font-black text-zinc-900">{m.v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => copy(exportForensics(run, rep))} className="rounded bg-cyan-700 px-2 py-1 text-[10px] font-bold text-white">Copy forensics JSON</button>
        <button onClick={() => download(`${run.id}-forensics.json`, exportForensics(run, rep))} className="rounded bg-zinc-900 px-2 py-1 text-[10px] font-bold text-white">Download</button>
        {rep.allRealUrls.length > 0 && (
          <button onClick={() => copy(rep.allRealUrls.join("\n"))} className="rounded bg-emerald-700 px-2 py-1 text-[10px] font-bold text-white">Copy {rep.allRealUrls.length} real URL(s)</button>
        )}
      </div>

      {rep.winner && (
        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-900">
          Portfolio winner: <b>{rep.winner.lane}</b> · sources={rep.winner.sources} · lanes={rep.winner.lanes}
        </div>
      )}

      {t.placeholderUrlCount > 0 && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-red-800">
            {t.placeholderUrlCount} non-resolvable citation URL(s)
          </div>
          <p className="mt-1 text-[11px] leading-snug text-red-900">
            These were manufactured by <code>{"`source-${sourceIndex+1}`"}</code> at{" "}
            <b>v15-grounding.orig.ts:113</b> (vanguard) and <b>:131</b> (palisade). They are string concatenations of an
            array index — not URLs — and can never resolve. See the Diagnosis tab for the exact repair.
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {rep.allPlaceholderUrls.map((u) => (
              <code key={u} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-red-800 ring-1 ring-red-200">{u}</code>
            ))}
          </div>
        </div>
      )}

      {rep.zeroYieldLanes.length > 0 && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-800">Zero-yield lanes (D14)</div>
          <p className="mt-1 text-[11px] text-amber-900">Packed epistemic atoms but returned zero real documents. The acceptance predicate at <b>v15-grounding.orig.ts:116</b> counts claims, not sources.</p>
          <ul className="mt-1 space-y-0.5">
            {rep.zeroYieldLanes.map((l, i) => (
              <li key={i} className="font-mono text-[10px] text-amber-900">
                {l.lane}[{l.section ?? "-"}]: {l.atomsPacked} atoms / {l.sourcesPacked} sources / util={l.utilizationPct ?? "?"}%
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        {rep.lanes.length === 0 && <Empty>No lane telemetry captured. Lanes report through <code>onProgress</code>; if the Timeline shows grounding lines but this is empty, the emitter format changed.</Empty>}
        {rep.lanes.map((l, i) => {
          const id = `${l.lane}-${l.section}-${i}`;
          const open = expanded === id;
          const bad = (l.atomsPacked ?? 0) > 0 && (l.sourcesPacked ?? 0) === 0;
          return (
            <div key={id} className="rounded-lg border bg-white" style={{ borderColor: bad ? "#fca5a5" : l.outcome === "winner" ? "#6ee7b7" : "#e4e4e7" }}>
              <button onClick={() => setExpanded(open ? null : id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left">
                <Pill color={l.outcome === "winner" ? "#059669" : l.outcome === "quarantined" ? "#dc2626" : l.outcome === "fulfilled" ? "#0891b2" : "#71717a"}>{l.lane}</Pill>
                {l.section && <span className="text-[10px] text-zinc-500">[{l.section}]</span>}
                <span className="font-mono text-[10px] text-zinc-500">
                  {l.atomsPacked != null && `${l.atomsPacked}a`}
                  {l.sourcesPacked != null && ` / ${l.sourcesPacked}s`}
                  {l.utilizationPct != null && ` / ${l.utilizationPct}%`}
                  {l.attested != null && ` / att=${l.attested} sup=${l.supported}`}
                  {l.cleanSources != null && ` / clean=${l.cleanSources}`}
                  {l.quarantined != null && ` / quar=${l.quarantined}`}
                  {l.fusedResults != null && ` / fused=${l.fusedResults}`}
                  {l.enrichedResults != null && ` / enriched=${l.enrichedResults}`}
                  {l.proof && ` / proof=${l.proof}`}
                  {l.seedsCrawled != null && ` / ${l.seedsCrawled} seeds`}
                  {l.durationMs != null && ` / ${l.durationMs}ms`}
                </span>
                <span className="ml-auto flex items-center gap-1.5 text-[10px]">
                  {l.realUrls.length > 0 && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800">{l.realUrls.length} url</span>}
                  {l.placeholderUrls.length > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-800">{l.placeholderUrls.length} fake</span>}
                  {l.failures.length > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-800">{l.failures.length} fail</span>}
                  <span className="text-zinc-400">{l.citations.length} cite · {l.rawLines.length} log</span>
                  <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
                </span>
              </button>
              {open && (
                <div className="space-y-2 border-t border-zinc-100 px-3 py-2">
                  {l.query && <div className="text-[10px] text-zinc-600"><b>query:</b> {l.query}</div>}
                  {l.adapters.length > 0 && <div className="text-[10px] text-zinc-600"><b>adapters:</b> {l.adapters.join(", ")}</div>}
                  {l.citations.length > 0 && (
                    <div>
                      <div className="mb-0.5 text-[9px] font-bold uppercase text-zinc-500">Citations this lane admitted</div>
                      <div className="divide-y divide-zinc-100 rounded border border-zinc-200">
                        {l.citations.map((cst, j) => (
                          <div key={j} className="px-2 py-1">
                            <div className="truncate text-[10px] font-semibold text-zinc-800">{cst.title || "(untitled)"}</div>
                            {cst.url && (isPlaceholderUrl(cst.url)
                              ? <code className="text-[10px] text-red-700">⚠ {cst.url} — not resolvable</code>
                              : <a href={cst.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-[10px] text-sky-600 hover:underline">{cst.url}</a>)}
                            <div className="text-[9px] text-zinc-400">stage: {cst.stage}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {l.failures.length > 0 && (
                    <div>
                      <div className="mb-0.5 text-[9px] font-bold uppercase text-red-600">Transport / retrieval failures ({l.failures.length})</div>
                      <div className="max-h-36 overflow-auto rounded bg-red-50 p-2 font-mono text-[10px] text-red-900">
                        {l.failures.map((f, j) => <div key={j}>{f}</div>)}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="mb-0.5 text-[9px] font-bold uppercase text-zinc-500">Raw emissions ({l.rawLines.length})</div>
                    <div className="max-h-48 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-300">
                      {l.rawLines.map((r, j) => (
                        <div key={j}><span className="text-zinc-600">{ms(r.dt)}</span> {r.message}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rep.unattributedCitations.length > 0 && (
        <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-600">
            {rep.unattributedCitations.length} citation(s) no lane window could claim
          </div>
          <p className="mt-1 text-[10px] text-zinc-600">Surfaced rather than hidden — usually admitted outside any lane's reported window.</p>
          {rep.unattributedCitations.map((cst, i) => (
            <div key={i} className="mt-1 text-[10px]">
              <span className="text-zinc-700">{cst.title || "(untitled)"}</span>{" "}
              <code className={isPlaceholderUrl(cst.url) ? "text-red-700" : "text-sky-700"}>{cst.url}</code>
            </div>
          ))}
        </div>
      )}

      <details className="rounded-lg border border-zinc-300 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold text-zinc-800">
          Per-lane repair + verification roadmap ({SCRAPER_LANE_ROADMAP.length})
        </summary>
        <div className="divide-y divide-zinc-100 border-t border-zinc-100">
          {SCRAPER_LANE_ROADMAP.map((r) => (
            <div key={r.lane} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill color={r.status === "hardened" ? "#059669" : r.status === "transport-limited" ? "#dc2626" : "#71717a"}>{r.lane}</Pill>
                <span className="text-[10px] text-zinc-500">{r.role}</span>
                <code className="ml-auto text-[9px] text-zinc-500">{r.workspaceFile}</code>
              </div>
              <div className="mt-1 text-[10px] text-red-800"><b>Observed:</b> {r.observedFailure}</div>
              <div className="mt-1 text-[10px] text-emerald-800"><b>Intervention:</b> {r.intervention}</div>
              <div className="mt-1 text-[10px] text-sky-800"><b>Falsification test:</b> {r.test}</div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/* ── Repair-site card ─────────────────────────────────────────────────── */

function RepairSiteCard({ s }: { s: any }) {
  const reachColor =
    s.reachability === "workspace-seam" || s.reachability === "alias-seam" ? "#059669"
    : s.reachability === "post-pass" ? "#0891b2" : "#dc2626";
  return (
    <div className="rounded border-2 bg-white p-2" style={{ borderColor: `${reachColor}66` }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
          {s.file}:{s.line}
        </code>
        <Pill color={reachColor}>{s.reachability}</Pill>
        <span className="text-[10px] text-zinc-500">{s.symbol}</span>
        <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">+{s.expectedLift.toFixed(1)} lift</span>
      </div>
      <div className="mt-1.5">
        <div className="text-[9px] font-bold uppercase text-zinc-500">Current code</div>
        <pre className="overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-1.5 font-mono text-[10px] text-zinc-200">{s.currentCode}</pre>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-zinc-700"><b>Mechanism:</b> {s.mechanism}</p>
      <div className="mt-1.5 rounded bg-emerald-50 p-1.5">
        <div className="text-[9px] font-bold uppercase text-emerald-700">Deterministic — {s.deterministic.action}</div>
        <div className="text-[10px] text-emerald-900">{s.deterministic.change}</div>
        <div className="mt-0.5 text-[10px] text-emerald-700"><b>Verify:</b> {s.deterministic.verify}</div>
        <div className="text-[10px] text-emerald-700"><b>Fallback:</b> {s.deterministic.fallback}</div>
      </div>
      <div className="mt-1 rounded bg-violet-50 p-1.5">
        <div className="text-[9px] font-bold uppercase text-violet-700">LLM — {s.llm.action}</div>
        <div className="text-[10px] text-violet-900">{s.llm.change}</div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-600">{s.verifyCmd}</code>
        <button onClick={() => copy(s.verifyCmd)} className="rounded bg-zinc-200 px-1.5 py-0.5 text-[9px] font-bold text-zinc-700">copy</button>
        <span className="text-[9px] text-zinc-400">hook: {s.durableHook}</span>
      </div>
    </div>
  );
}

/* ── Tab: Diagnosis ★ ─────────────────────────────────────────────────── */

function DiagnosisTab({ run }: { run: RunRecord | null }) {
  const [target, setTarget] = useState(9.0);
  const [mode, setMode] = useState<"run" | "inputs">("run");
  // Standalone-input mode fields
  const [iPrompt, setIPrompt] = useState("");
  const [iOutput, setIOutput] = useState("");
  const [iTpl, setITpl] = useState("OMEGA-STRATEGY");
  const [iStyle, setIStyle] = useState("");
  const [iPersona, setIPersona] = useState("");
  const [iDepth, setIDepth] = useState(4);
  const [iRunJson, setIRunJson] = useState("");
  const [inputsReport, setInputsReport] = useState<DiagnosisReport | null>(null);

  const runReport: DiagnosisReport | null = useMemo(
    () => (run ? diagnoseRun(run, target) : null),
    [run?.id, run?.output, run?.finalText, target]
  );
  const report = mode === "inputs" ? inputsReport : runReport;

  const rubric = useMemo<TemplateRubric | null>(() => {
    if (!report) return null;
    return loadTemplateRubric(report.templateId, report.styleOverride, report.williamsPersona);
  }, [report?.templateId, report?.styleOverride, report?.williamsPersona]);

  const runDiagnoseInputs = () => {
    setInputsReport(
      diagnoseFromInputs({
        prompt: iPrompt,
        output: iOutput,
        settings: {
          templateId: iTpl,
          styleOverride: iStyle || null,
          williamsPersona: iPersona || null,
          maxDepth: iDepth,
        },
        pastedRunJson: iRunJson,
        targetScore: target,
      })
    );
  };

  const prefillFromRun = () => {
    if (!run) return;
    setIPrompt(run.question || "");
    setIOutput(run.finalText || "");
    const s = ((run.output ?? {}) as any).runSettings ?? {};
    if (s.templateId) setITpl(s.templateId);
    if (s.styleOverride) setIStyle(s.styleOverride);
    if (s.williamsPersona) setIPersona(s.williamsPersona);
    setIRunJson(exportRun(run));
  };

  return (
    <div className="space-y-3 overflow-auto">
      <div className="rounded-lg border-2 border-violet-300 bg-violet-50 p-3">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-violet-800">Pipeline Diagnosis</span>
          <div className="ml-auto flex gap-1">
            <button onClick={() => setMode("run")} className={`rounded px-2 py-0.5 text-[10px] font-bold ${mode === "run" ? "bg-violet-700 text-white" : "bg-white text-violet-700"}`}>From selected run</button>
            <button onClick={() => setMode("inputs")} className={`rounded px-2 py-0.5 text-[10px] font-bold ${mode === "inputs" ? "bg-violet-700 text-white" : "bg-white text-violet-700"}`}>From prompt + settings + output</button>
          </div>
        </div>
        <p className="text-[11px] leading-snug text-violet-900">
          Diagnoses the <b>pipeline architecture</b>, not the prompt. Each defect resolves to verified{" "}
          <code>file:line</code> coordinates with the current code, the causal mechanism, a deterministic route, an
          LLM route, and a backup for each. Coordinates are machine-checkable — run{" "}
          <code>node materialize.mjs --verify-sites</code> to detect drift.
        </p>
      </div>

      {mode === "inputs" && (
        <div className="space-y-2 rounded-lg border border-zinc-300 bg-white p-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase text-zinc-500">Inputs</span>
            <button onClick={prefillFromRun} disabled={!run} className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-700 disabled:opacity-40">Prefill from selected run</button>
            <button onClick={runDiagnoseInputs} disabled={!iOutput.trim()} className="ml-auto rounded bg-violet-600 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-40">Diagnose</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-[9px] font-bold uppercase text-zinc-500">Prompt</label>
              <textarea value={iPrompt} onChange={(e) => setIPrompt(e.target.value)} rows={5} className="w-full resize-y rounded border border-zinc-300 p-2 font-mono text-[11px]" />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase text-zinc-500">Output ({iOutput.length.toLocaleString()} chars)</label>
              <textarea value={iOutput} onChange={(e) => setIOutput(e.target.value)} rows={5} className="w-full resize-y rounded border border-zinc-300 p-2 font-mono text-[11px]" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <label>template <select value={iTpl} onChange={(e) => setITpl(e.target.value)} className="rounded border border-zinc-300 px-1 py-0.5">{(OMEGA_TEMPLATES as any[]).map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}</select></label>
            <label>style <input value={iStyle} onChange={(e) => setIStyle(e.target.value)} placeholder="--bain-pe" className="w-28 rounded border border-zinc-300 px-1 py-0.5" /></label>
            <label>williams <select value={iPersona} onChange={(e) => setIPersona(e.target.value)} className="rounded border border-zinc-300 px-1 py-0.5"><option value="">(none)</option>{(ARCHETYPES as readonly any[]).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}</select></label>
            <label>maxDepth <input type="number" min={1} max={8} value={iDepth} onChange={(e) => setIDepth(Number(e.target.value))} className="w-14 rounded border border-zinc-300 px-1 py-0.5" /></label>
          </div>
          <details>
            <summary className="cursor-pointer text-[10px] font-bold text-zinc-600">Optional: paste exported run JSON to unlock retrieval/telemetry detectors</summary>
            <textarea value={iRunJson} onChange={(e) => setIRunJson(e.target.value)} rows={4} placeholder="paste the JSON from I/O → Export run JSON" className="mt-1 w-full resize-y rounded border border-zinc-300 p-2 font-mono text-[10px]" />
          </details>
        </div>
      )}

      {!report && <Empty>{mode === "inputs" ? "Enter an output and press Diagnose." : "No run selected."}</Empty>}
      {report && (
      <>
      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span>Template: <b>{report.templateId}</b></span>
          <span>Style: <b>{report.styleOverride ?? "none"}</b></span>
          <span>Williams: <b>{report.williamsPersona ?? "none"}</b></span>
          <span>Guard: <b>{report.finalScore ?? "n/a"}</b> → target</span>
          <label className="flex items-center gap-1.5"><input type="number" step={0.5} min={5} max={10} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-16 rounded border border-zinc-300 px-1 py-0.5" /></label>
          <div className="ml-auto flex gap-1.5">
            {run && mode === "run" && <button onClick={() => copy(bundleForExternalReview(report, run, rubric))} className="rounded bg-zinc-900 px-2 py-1 text-[10px] font-bold text-white">Copy review bundle</button>}
            <button onClick={() => copy(exportRepairOrderFor(report, mode === "inputs" ? iPrompt : run?.question ?? ""))} className="rounded bg-emerald-700 px-2 py-1 text-[10px] font-bold text-white">Copy repair order JSON</button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
          <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">{report.reachabilitySplit.sidecarToday} fixable in src/ today</span>
          <span className="rounded bg-cyan-100 px-2 py-0.5 font-bold text-cyan-800">{report.reachabilitySplit.postPass} via COVEA post-pass</span>
          <span className="rounded bg-red-100 px-2 py-0.5 font-bold text-red-800">{report.reachabilitySplit.needsMaterialize} need materialize.mjs</span>
        </div>
        {report.repairFiles.length > 0 && (
          <div className="mt-2">
            <div className="text-[9px] font-bold uppercase text-zinc-500">Files to touch</div>
            {report.repairFiles.map((f, i) => (
              <div key={i} className="font-mono text-[10px] text-zinc-700">{f.count}× <b>{f.file}</b> <span className="text-zinc-400">({f.reach})</span></div>
            ))}
          </div>
        )}
      </div>

      {report.allRepairSites.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-600">
            Verified repair coordinates ({report.allRepairSites.length}) — highest lift first
          </div>
          {report.allRepairSites.map((s, i) => <RepairSiteCard key={i} s={s} />)}
        </div>
      )}

      {report.diagnoses.length === 0 && <Empty>No pipeline defects detected by the active detector set.</Empty>}

      {report.diagnoses.map((d, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-white">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
            <Pill color="#dc2626">{d.defect}</Pill>
            <span className="font-mono text-[10px] text-zinc-500">→ step: <b className="text-zinc-800">{d.step}</b></span>
          </div>
          <div className="space-y-2 px-3 py-2">
            {d.evidence.map((e, j) => <div key={j} className="rounded bg-zinc-50 px-2 py-1 font-mono text-[10px] text-zinc-700">{e}</div>)}
            {d.advice.map((scope, k) => (
              <div key={k} className="rounded border border-zinc-100 bg-zinc-50 p-2">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Scope: {scope.scope}</div>
                {scope.routes.map((r, m) => (
                  <div key={m} className="mt-1 rounded border border-white bg-white p-2">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <Pill color={r.kind === "deterministic" ? "#059669" : "#8b5cf6"}>{r.kind}</Pill>
                      <span className="text-[11px] font-bold text-zinc-800">{r.action}</span>
                      {r.applicableInSidecar && <span className="ml-auto rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">sidecar-ready</span>}
                    </div>
                    <div className="text-[10px] text-zinc-700"><b>How:</b> {r.how}</div>
                    <div className="text-[10px] text-zinc-500"><b>Requires:</b> {r.requires.join(", ")}</div>
                    <div className="text-[10px] text-zinc-500"><b>Backup:</b> {r.backup}</div>
                    {r.hook && <div className="mt-1 font-mono text-[9px] text-zinc-400">hook: {r.hook}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {report.playbook.length > 0 && (
        <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-emerald-800">Prioritised playbook (apply top→bottom)</div>
          <ol className="space-y-1">
            {report.playbook.map((p, i) => (
              <li key={i} className="text-[11px] text-emerald-900">
                <span className="mr-1 font-mono">{p.rank}.</span>
                <Pill color={p.route.kind === "deterministic" ? "#059669" : "#8b5cf6"}>{p.route.kind}</Pill>{" "}
                <b>{p.defect}</b> → <code>{p.step}</code>{" "}
                <span className="text-emerald-700">(+{p.expectedLift.toFixed(2)} lift)</span>
                <div className="ml-6 text-[10px] text-emerald-800">{p.route.action}</div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {report.unresolvedIssues.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] leading-snug text-amber-800">
          <b>Unmeasured / unresolved:</b>
          <ul className="ml-4 list-disc">{report.unresolvedIssues.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </div>
      )}
      </>
      )}
    </div>
  );
}

/* ── Tab: Genome + Templates ★ ────────────────────────────────────────── */

function GenomeTemplateTab({ run }: { run: RunRecord | null }) {
  const [tplId, setTplId] = useState<string>(() => (OMEGA_TEMPLATES as any[])[0]?.id ?? "OMEGA-STRATEGY");
  const [williams, setWilliams] = useState<string>((ARCHETYPES as readonly any[])[0]?.name ?? "");
  const rubric = useMemo(() => loadTemplateRubric(tplId, null, williams || null), [tplId, williams]);
  const live = readLiveGenome();
  const runGenome = (run?.genome ?? null) as any;
  const snapshotSample = useMemo(() => (run?.question ? computeGenomeSnapshot(run.question) : null), [run?.question]);

  return (
    <div className="space-y-3 overflow-auto">
      <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-[11px] leading-snug text-purple-900">
        <b>Williams · Innovation Genome v1+v2 · Report Templates.</b> These are the CRITERIA a 10-rated report must
        satisfy. The Diagnosis tab uses this rubric as the target.
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 bg-white p-2 text-[11px]">
        <label>Template: <select value={tplId} onChange={(e) => setTplId(e.target.value)} className="rounded border border-zinc-300 px-1 py-0.5 text-[11px]">{(OMEGA_TEMPLATES as any[]).map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}</select></label>
        <label>Williams: <select value={williams} onChange={(e) => setWilliams(e.target.value)} className="rounded border border-zinc-300 px-1 py-0.5 text-[11px]">{(ARCHETYPES as readonly any[]).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}</select></label>
      </div>

      {rubric && (
        <div className="rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-3 py-1.5 text-[11px] font-bold text-zinc-800">Template rubric: <span className="text-violet-700">{rubric.templateId}</span> · Williams: <span className="text-emerald-700">{rubric.archetype}</span></div>
          <div className="p-3 text-[10px] leading-snug text-zinc-700">
            <div className="mb-1"><b>Persona directive (verbatim, no truncation):</b></div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200">{rubric.personaDirective}</pre>
            <div className="mt-2 mb-1"><b>Template build prompt (verbatim, no truncation):</b></div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200">{rubric.buildPrompt}</pre>
            <div className="mt-2 mb-1"><b>Ten-point contract for a 10-rated report:</b></div>
            <ol className="ml-4 list-decimal space-y-0.5">
              {rubric.tenPointContract.map((c, i) => <li key={i} className="text-[11px] text-zinc-800">{c}</li>)}
            </ol>
            <div className="mt-2 mb-1"><b>Required sections:</b></div>
            <div className="grid gap-1 sm:grid-cols-2">
              {rubric.sections.map((s) => (
                <div key={s.id} className="rounded border border-zinc-200 bg-zinc-50 p-1.5">
                  <div className="text-[10px] font-bold text-zinc-800">{s.title}</div>
                  <div className="text-[10px] text-zinc-600">{s.purpose || "(no explicit hint)"}</div>
                  {s.requiredMarkers.length > 0 && <div className="mt-0.5 text-[9px] text-emerald-700">requires: {s.requiredMarkers.join(", ")}</div>}
                  {s.antiMarkers.length > 0 && <div className="text-[9px] text-red-700">anti: {s.antiMarkers.join(", ")}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-3 py-1.5 text-[11px] font-bold text-zinc-800">Innovation Genome — this run</div>
        <div className="p-3 text-[10px] leading-snug">
          {!runGenome && !snapshotSample && <div className="text-zinc-500">No genome captured for this run.</div>}
          {runGenome && (
            <>
              <div className="mb-1 font-bold text-purple-800">v1 directive (verbatim, no truncation):</div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200">{runGenome.directiveV1}</pre>
              <div className="mt-2 mb-1 font-bold text-purple-800">v2 directive (verbatim, no truncation):</div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200">{runGenome.directiveV2}</pre>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div><b className="text-zinc-500">domain:</b> {runGenome.domain}</div>
                <div><b className="text-zinc-500">seed:</b> {runGenome.seed}</div>
                <div><b className="text-zinc-500">v1 persona:</b> {runGenome.v1?.persona?.name ?? "n/a"}</div>
              </div>
            </>
          )}
          {!runGenome && snapshotSample && (
            <div>
              <div className="mb-1 text-zinc-500">Preview (not this run — computed for the question):</div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200">{snapshotSample.directiveV1}</pre>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200">{snapshotSample.directiveV2}</pre>
            </div>
          )}
        </div>
      </div>

      {Boolean(live.v4 || live.v10Discovery) && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-[10px]">
          <div className="mb-1 font-bold text-zinc-700">Live genome (window._VERITAS_V*)</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200">{JSON.stringify(live, null, 2).slice(0, 2000)}</pre>
        </div>
      )}
    </div>
  );
}

function ResearchTab({ run }: { run: RunRecord | null }) {
  if (!run) return <Empty>No run selected.</Empty>;
  const r = (run.research ?? null) as any;
  if (!r) return <Empty>No separated prewriting research was attached to this run. New V15/baseline wrapper runs attach it before report generation.</Empty>;
  return (
    <div className="space-y-3 overflow-auto text-[10px]">
      <div className="rounded border border-cyan-300 bg-cyan-50 p-3 text-cyan-900">
        <b>Independent prewriting research.</b> Search strategy and evidence were completed before the report writer ran.
        Queries are hypotheses; only URL-backed sources are evidence.
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[
          ["status", r.status ?? "n/a"],
          ["queries", r.queries?.length ?? 0],
          ["sources", r.sources?.length ?? 0],
          ["duration", r.endedAt && r.startedAt ? ms(r.endedAt - r.startedAt) : "n/a"],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded border border-zinc-200 bg-white p-2 text-center">
            <div className="font-bold text-zinc-800">{String(value)}</div><div className="text-[9px] text-zinc-500">{label}</div>
          </div>
        ))}
      </div>
      <div className="rounded border border-zinc-200 bg-white p-3">
        <div className="mb-1 font-bold text-zinc-700">Unified v1 + v2 expansion path (full words)</div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-zinc-200">{r.innovation?.directive ?? "(missing)"}</pre>
      </div>
      <div className="rounded border border-zinc-200 bg-white p-3">
        <div className="mb-1 font-bold text-zinc-700">Query register</div>
        {(r.queries ?? []).map((q: any) => (
          <div key={q.id} className="mb-1 rounded bg-zinc-50 p-2">
            <b>{q.id} [{q.kind}] [{q.pathNode}]</b> <code>{q.query}</code>
            <div className="text-zinc-500">{q.source} · {q.rationale}</div>
          </div>
        ))}
      </div>
      <div className="rounded border border-zinc-200 bg-white p-3">
        <div className="mb-1 font-bold text-zinc-700">URL-backed sources</div>
        {(r.sources ?? []).length ? (r.sources ?? []).map((s: any, i: number) => (
          <div key={s.url ?? i} className="mb-1">
            <b>[R{i + 1}] {s.title}</b> · <a href={s.url} target="_blank" rel="noreferrer" className="text-sky-700 underline">{s.url}</a>
          </div>
        )) : <div className="text-red-700">EVIDENCE_STARVED — no source survived.</div>}
      </div>
      {r.rejectedQueries?.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <b>Rejected LLM queries</b>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(r.rejectedQueries, null, 2)}</pre>
        </div>
      )}
      <details className="rounded border border-zinc-200 bg-white">
        <summary className="cursor-pointer p-2 font-bold">Full dossier / execution receipt</summary>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap bg-zinc-950 p-2 text-zinc-200">{r.dossier}</pre>
      </details>
    </div>
  );
}

/* ── Tab: COVEA ★ ─────────────────────────────────────────────────────── */

function CoveaTab({ run }: { run: RunRecord | null }) {
  const covea = (run?.covea ?? null) as any;
  if (!run) return <Empty>No run selected.</Empty>;
  if (!covea) return <Empty>No COVEA pass ran for this run. COVEA runs post-completion when the pipeline surfaces CoVe, adversarial, citation, or placeholder failures.</Empty>;
  return (
    <div className="space-y-3 overflow-auto">
      <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-[11px] leading-snug text-violet-900">
        <b>COVEA</b> = deterministic containment + targeted CoVe/Adversarial repair. Never a full rewrite.
        Deterministic path strips invalid citation tags (including grouped tags), converts bare placeholders to
        explicit open items, and appends ledger-derived References without any model call. LLM path remains
        ≤1 paragraph per patch, ≤20% total edit budget, ≥60% region retention.
      </div>
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <div className="rounded border border-emerald-200 bg-emerald-50 p-2"><div className="text-[9px] font-bold uppercase text-emerald-700">accepted</div><div className="text-xl font-black text-emerald-900">{covea.acceptedCount}</div></div>
        <div className="rounded border border-red-200 bg-red-50 p-2"><div className="text-[9px] font-bold uppercase text-red-700">rejected</div><div className="text-xl font-black text-red-900">{covea.rejectedCount}</div></div>
        <div className="rounded border border-zinc-200 bg-zinc-50 p-2"><div className="text-[9px] font-bold uppercase text-zinc-500">skipped</div><div className="text-xl font-black text-zinc-800">{covea.skippedCount}</div></div>
        <div className="rounded border border-sky-200 bg-sky-50 p-2"><div className="text-[9px] font-bold uppercase text-sky-700">edit %</div><div className="text-xl font-black text-sky-900">{(covea.charsChangedPct * 100).toFixed(1)}%</div></div>
      </div>
      {Array.isArray(covea.deterministicActions) && covea.deterministicActions.length > 0 && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">
            Deterministic containment ({covea.deterministicActions.length})
          </div>
          <ul className="mt-1 ml-4 list-disc space-y-0.5 text-[10px] text-emerald-900">
            {covea.deterministicActions.map((a: string, i: number) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
      {Array.isArray(covea.patches) && covea.patches.map((p: any, i: number) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-white">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5">
            <Pill color={p.accepted ? "#059669" : "#dc2626"}>{p.accepted ? "accepted" : "rejected"}</Pill>
            <span className="font-mono text-[10px] text-zinc-500">{p.target?.kind} · {p.model} · {p.latencyMs}ms · attempts={p.attempts}</span>
            {!p.accepted && <span className="ml-auto font-mono text-[10px] text-red-700">{p.rejectReason}</span>}
          </div>
          <div className="grid gap-2 p-2 sm:grid-cols-2">
            <div>
              <div className="mb-0.5 text-[9px] font-bold uppercase text-zinc-500">before</div>
              <pre className="whitespace-pre-wrap rounded bg-red-50 p-2 text-[10px] text-red-900">{p.beforeText}</pre>
            </div>
            <div>
              <div className="mb-0.5 text-[9px] font-bold uppercase text-zinc-500">after</div>
              <pre className="whitespace-pre-wrap rounded bg-emerald-50 p-2 text-[10px] text-emerald-900">{p.afterText}</pre>
            </div>
          </div>
          <div className="border-t border-zinc-100 bg-zinc-50 px-3 py-1 text-[10px] text-zinc-700"><b>reason:</b> {p.target?.reason}</div>
        </div>
      ))}
      {Array.isArray(covea.errors) && covea.errors.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">
          <b>Errors ({covea.errors.length}) — LLM route unavailable for these; deterministic annotation applied:</b>
          <ul className="ml-4 list-disc">{covea.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/* ── Tab: Architecture ★ — what is required for a repeatable 9+ ───────── */

function ArchitectureTab({ run }: { run: RunRecord | null }) {
  const p: Prescription | null = useMemo(() => (run ? prescribe(run) : null), [run?.id, run?.output, run?.finalText, run?.events.length]);
  if (!run) return <Empty>No run selected.</Empty>;
  if (!p) return <Empty>Run has no outcome yet.</Empty>;

  const planeColor: Record<string, string> = {
    retrieval: "#0891b2", synthesis: "#7c3aed", repair: "#dc2626", evaluation: "#eab308",
  };
  const presenceColor: Record<string, string> = {
    present: "#059669", absent: "#dc2626", degraded: "#f59e0b", unmeasured: "#71717a",
  };

  return (
    <div className="space-y-3 overflow-auto">
      <div className="rounded-lg border-2 border-indigo-300 bg-indigo-50 p-3">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-indigo-800">Architecture Prescription</div>
        <p className="text-[11px] leading-snug text-indigo-900">
          These are <b>preconditions</b>, not additive lifts. The achievable score is{" "}
          <code>MIN(ceilingWithout)</code> over the ABSENT components — if retrieval emits{" "}
          <code>source-3</code> as a URL, no downstream repair or judge can produce a 9.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
          <span>observed guard: <b>{p.observedGuard ?? "n/a"}</b></span>
          <span>judge: <b>{p.observedJudge ?? "unavailable"}</b></span>
          <span>floor: <b>{p.deterministicFloor ?? "n/a"}</b></span>
          <span className="rounded bg-indigo-700 px-2 py-0.5 font-bold text-white">projected ceiling {p.projectedCeiling.toFixed(1)}/10</span>
          <div className="ml-auto flex gap-1.5">
            <button onClick={() => copy(renderPrescription(p))} className="rounded bg-zinc-900 px-2 py-1 text-[10px] font-bold text-white">Copy prescription</button>
            <button onClick={() => download(`${run.id}-architecture.json`, exportPrescription(p))} className="rounded bg-indigo-700 px-2 py-1 text-[10px] font-bold text-white">Export JSON</button>
          </div>
        </div>
        {p.bindingConstraint && (
          <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-900">
            <b>Binding constraint: {p.bindingConstraint.name}</b> ({p.bindingConstraint.plane}) — nothing downstream
            can raise the score past <b>{p.bindingConstraint.ceilingWithout.toFixed(1)}</b> while this is absent. Fix this first.
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
          <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">{p.workspaceToday.length} fixable in src/ today</span>
          <span className="rounded bg-red-100 px-2 py-0.5 font-bold text-red-800">{p.needsPackageEdit.length} need package edit</span>
          <span className="rounded bg-zinc-100 px-2 py-0.5 font-bold text-zinc-600">{p.unmeasured.length} unmeasured</span>
        </div>
      </div>

      {p.ordered.length === 0 && (
        <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3 text-[11px] text-emerald-900">
          <b>No absent component detected.</b> The architecture required for 9+ is fully installed for this run.
          Any remaining score gap is content quality, not missing machinery.
        </div>
      )}

      {p.ordered.map((a, i) => {
        const c = a.component;
        return (
          <div key={c.id} className="rounded-lg border-2 bg-white" style={{ borderColor: `${presenceColor[a.presence]}66` }}>
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2">
              <span className="font-mono text-[10px] font-bold text-zinc-400">#{i + 1}</span>
              <Pill color={planeColor[c.plane] ?? "#71717a"}>{c.plane}</Pill>
              <span className="text-[12px] font-bold text-zinc-900">{c.name}</span>
              <Pill color={presenceColor[a.presence]}>{a.presence}</Pill>
              <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                ceiling {c.ceilingWithout.toFixed(1)} without
              </span>
            </div>
            <div className="space-y-1.5 px-3 py-2">
              <p className="text-[11px] text-zinc-700"><b>Guarantees:</b> {c.guarantees}</p>
              <div className="rounded bg-zinc-50 px-2 py-1 font-mono text-[10px] text-zinc-700"><b>Observed:</b> {a.evidence}</div>
              <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">{c.patch.file}</code>
                  {c.patch.workspaceReachable
                    ? <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-[9px] font-bold text-emerald-900">src/ today</span>
                    : <span className="rounded bg-red-200 px-1.5 py-0.5 text-[9px] font-bold text-red-900">needs materialize</span>}
                </div>
                <div className="mt-1 font-mono text-[10px] text-zinc-600">anchor: <code>{c.patch.anchor}</code></div>
                <div className="mt-1 text-[10px] text-emerald-900"><b>Change:</b> {c.patch.change}</div>
                <div className="mt-0.5 text-[10px] text-emerald-700"><b>Verify:</b> {c.patch.verify}</div>
              </div>
            </div>
          </div>
        );
      })}

      {p.unmeasured.length > 0 && (
        <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-[10px] leading-snug text-zinc-700">
          <b>Unmeasured on this run ({p.unmeasured.length}) — neither passing nor failing:</b>
          <ul className="ml-4 list-disc">
            {p.unmeasured.map((a) => <li key={a.component.id}><b>{a.component.name}</b>: {a.evidence}</li>)}
          </ul>
        </div>
      )}

      <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] leading-snug text-amber-800">
        <b>Honesty:</b> <code>ceilingWithout</code> values are estimates calibrated against 4 observed runs
        (guard 4.4 / 4.88 / 6.25 / 8.1). They are NOT measured bounds. Detection is exact — it reads the run record.
        Never report a projected ceiling as an achieved score.
      </div>
    </div>
  );
}

/* ── Tab: Self-Test ★ — executable verification of the pure primitives ──── */

function SelfTestTab() {
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try { setReport(await runSelfTests()); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const bySuite = useMemo(() => {
    if (!report) return [];
    return report.suites.map((s) => ({ suite: s, results: report.results.filter((r) => r.suite === s) }));
  }, [report]);

  return (
    <div className="space-y-3 overflow-auto">
      <div className="rounded-lg border border-teal-300 bg-teal-50 p-3 text-[11px] leading-snug text-teal-900">
        <b>Executable verification.</b> Every function under test is pure — no network, no model, no clock — so
        these are real assertions. The authoring model could only compile-verify this file; <b>clicking Run is what
        turns these into evidence.</b> A test that has never been run is a claim, not a verification.
      </div>

      <div className="flex items-center gap-2">
        <button onClick={run} disabled={busy} className="rounded bg-teal-700 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">
          {busy ? "Running…" : "Run self-tests"}
        </button>
        {report && (
          <>
            <span className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800">{report.passed} passed</span>
            <span className={`rounded px-2 py-1 text-[11px] font-bold ${report.failed > 0 ? "bg-red-100 text-red-800" : "bg-zinc-100 text-zinc-500"}`}>{report.failed} failed</span>
            <span className="font-mono text-[10px] text-zinc-500">{report.suites.length} suites · {new Date(report.ranAt).toLocaleTimeString()}</span>
            <button onClick={() => copy(JSON.stringify(report, null, 2))} className="ml-auto rounded bg-zinc-900 px-2 py-1 text-[10px] font-bold text-white">Copy report</button>
          </>
        )}
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">{err}</div>}
      {!report && !busy && <Empty>Not yet run. Click <b>Run self-tests</b> to produce real evidence.</Empty>}

      {bySuite.map(({ suite, results }) => {
        const failed = results.filter((r) => !r.passed).length;
        return (
          <div key={suite} className="rounded-lg border bg-white" style={{ borderColor: failed > 0 ? "#fca5a5" : "#6ee7b7" }}>
            <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5">
              <Pill color={failed > 0 ? "#dc2626" : "#059669"}>{suite}</Pill>
              <span className="font-mono text-[10px] text-zinc-500">{results.length - failed}/{results.length} passed</span>
            </div>
            <div className="divide-y divide-zinc-50">
              {results.map((r, i) => (
                <div key={i} className="flex gap-2 px-3 py-1">
                  <span className={`shrink-0 font-mono text-[11px] font-bold ${r.passed ? "text-emerald-600" : "text-red-600"}`}>{r.passed ? "PASS" : "FAIL"}</span>
                  <span className="text-[11px] text-zinc-800">{r.name}</span>
                  {r.detail && <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-400">{r.detail.slice(0, 90)}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Tab: Scraper Debug 🔬 ────────────────────────────────────────────── */

const ALL_LANE_IDS: LaneId[] = [
  "helios", "structured-adapter", "canonical-portfolio", "arbiter", "sibyl", "strata", "nexus", "hydra", "native-vnext", "veritas-hybrid",
];

function LaneBadge({ lane }: { lane: LaneRunRecord }) {
  const color = lane.status === "done" ? (lane.error ? "#dc2626" : "#059669")
    : lane.status === "running" ? "#f59e0b"
    : lane.status === "error" ? "#dc2626"
    : "#94a3b8";
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${color}22`, color }}>
      {lane.laneId}
      {lane.status === "running" && <span className="animate-spin">⟳</span>}
      {lane.status === "done" && !lane.error && <span>✓ {lane.acceptedCount}↑ {lane.rejectedCount}↓</span>}
      {lane.status === "error" && <span>✗</span>}
    </span>
  );
}

function ItemRow({ item, idx }: { item: ReturnType<typeof useScraperItems>[number]; idx: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded border ${item.accepted ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-start gap-2 p-2 text-left">
        <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${item.accepted ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {item.accepted ? "ACCEPT" : item.rejectReason ?? "REJECT"}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-zinc-800">{idx + 1}. {item.title || "(untitled)"}</div>
          <div className="truncate font-mono text-[10px] text-sky-600">{item.absoluteUrl || item.url || "no-url"}</div>
          <div className="text-[10px] text-zinc-500">coherence={item.facetCoherence.toFixed(2)}</div>
        </div>
        <span className="ml-auto shrink-0 text-[10px] text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-200 p-2 space-y-1">
          <div className="text-[10px] text-zinc-700"><b>Snippet:</b> {item.snippet || "(empty)"}</div>
          <details>
            <summary className="cursor-pointer text-[10px] font-bold text-zinc-500">Raw JSON</summary>
            <pre className="max-h-48 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200 mt-1">{JSON.stringify(item.rawJson, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

function useScraperItems() { return [] as any[]; }

function ScraperDebugTab() {
  const [prompt, setPrompt] = useState("");
  const [enabledLanes, setEnabledLanes] = useState<LaneId[]>(["structured-adapter", "canonical-portfolio", "nexus", "hydra"]);
  const [parallel, setParallel] = useState(false);
  const [run, setRun] = useState<ScraperDebugRun | null>(null);
  const [running, setRunning] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [selectedLane, setSelectedLane] = useState<LaneId | "combined" | null>(null);
  const [jsonView, setJsonView] = useState<"raw" | "items">("items");
  const apiKey = getKey();

  const toggleLane = (id: LaneId) =>
    setEnabledLanes(prev => prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]);

  const startRun = async () => {
    if (!prompt.trim() || running) return;
    setRun(null);
    setRunning(true);
    try {
      await runScraperDebug({
        prompt: prompt.trim(),
        lanes: enabledLanes,
        parallel,
        onProgress: (r) => setRun({ ...r }),
      });
    } catch (e) {
      console.error("ScraperDebug:", e);
    }
    setRunning(false);
  };

  const analyseWithGemini = async () => {
    if (!run || !apiKey || analysing) return;
    setAnalysing(true);
    const summary = [
      `PROMPT: ${run.cleanPrompt}`,
      `IFL FACETS: ${run.iflFacets.join(" | ")}`,
      `IFL QUERIES: ${run.iflQueries.join("\n")}`,
      ``,
      `LANE RESULTS:`,
      ...run.lanes.map(l =>
        `Lane [${l.laneId}]: status=${l.status} accepted=${l.acceptedCount} rejected=${l.rejectedCount} error=${l.error ?? "none"}\n` +
        `  dispatched: ${l.inputQuery}\n` +
        `  alternatives: ${l.iflAlternatives.join(" | ")}\n` +
        `  gate log: ${l.workspaceGateLog.slice(0, 5).join(" · ")}\n` +
        `  rejected reasons: ${[...new Set(l.items.filter(i => !i.accepted).map(i => i.rejectReason))].join(", ") || "none"}\n` +
        `  accepted titles: ${l.items.filter(i => i.accepted).slice(0, 4).map(i => i.title).join(" | ") || "none"}`
      ),
      ``,
      `TOTAL ACCEPTED: ${run.combinedAccepted.length}`,
      `TOTAL REJECTED: ${run.combinedRejected.length}`,
    ].join("\n");

    const analysisPrompt = [
      "You are a scraper pipeline diagnostician. Below is a full debug dump of one retrieval run. Each lane dispatched specific queries, the IFL lattice shows the facets extracted from the prompt, and the results show what was accepted/rejected.",
      "",
      "Your task:",
      "1. Explain precisely WHY each lane returned few or zero accepted results. Be specific: which query strings were dispatched, and what about them caused off-topic or empty results?",
      "2. Identify the root-cause patterns (query too broad, query not domain-anchored, transport failure, relevance gate too strict, etc.).",
      "3. Suggest specific, concrete changes to the dispatched queries or IFL facets that would improve recall while keeping relevance high.",
      "4. Rate the overall retrieval health on a 1-10 scale and explain.",
      "",
      "DEBUG DUMP:",
      summary,
    ].join("\n");

    try {
      const res: any = await geminiGenerate({ apiKey, model: "gemini-2.0-flash-lite", prompt: analysisPrompt, maxOutputTokens: 1500 });
      const text = String(res?.text ?? res?.output ?? "(no output)");
      setRun(prev => prev ? { ...prev, analysis: text } : null);
    } catch (e) {
      setRun(prev => prev ? { ...prev, analysis: `Error: ${e instanceof Error ? e.message : String(e)}` } : null);
    }
    setAnalysing(false);
  };

  const displayLane = selectedLane && selectedLane !== "combined"
    ? run?.lanes.find(l => l.laneId === selectedLane) ?? null
    : null;
  const displayItems = selectedLane === "combined"
    ? [...(run?.combinedAccepted ?? []), ...(run?.combinedRejected ?? [])]
    : displayLane?.items ?? [];

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      {/* Config row */}
      <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-[11px] leading-snug text-sky-900 shrink-0">
        <b>Scraper Debug 🔬</b> — Runs only the retrieval/grounding phase, fully isolated from model generation.
        Every query dispatched, every API endpoint called, every result and its accept/reject reason is recorded.
        Wire Gemini to get AI diagnosis of why lanes return irrelevant content.
      </div>
      <div className="flex flex-wrap items-end gap-2 shrink-0">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-0.5">Research prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={2}
            className="w-full resize-y rounded border border-zinc-300 p-2 font-mono text-[11px]"
            placeholder="Find me a cannabis product that doesn't exist but solves a large unmet demand…"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-0.5">Lanes</label>
          <div className="flex flex-wrap gap-1">
            {ALL_LANE_IDS.map(id => (
              <button
                key={id}
                onClick={() => toggleLane(id)}
                className={`rounded px-2 py-0.5 text-[10px] font-bold ${enabledLanes.includes(id) ? "bg-sky-600 text-white" : "bg-zinc-200 text-zinc-500"}`}
              >{id}</button>
            ))}
          </div>
          <label className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-600 cursor-pointer">
            <input type="checkbox" checked={parallel} onChange={e => setParallel(e.target.checked)} />
            Parallel (faster, mixed logs)
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <button
            onClick={startRun}
            disabled={running || !prompt.trim()}
            className="rounded bg-sky-700 px-4 py-2 text-[11px] font-bold text-white disabled:opacity-40"
          >{running ? "Running…" : "Run Scraper Debug"}</button>
          {run && (
            <button
              onClick={analyseWithGemini}
              disabled={analysing || !apiKey}
              className="rounded bg-violet-700 px-4 py-2 text-[11px] font-bold text-white disabled:opacity-40"
              title={!apiKey ? "Set Gemini key in V15 panel" : ""}
            >{analysing ? "Analysing…" : "Gemini Analyse"}</button>
          )}
        </div>
      </div>

      {run && (
        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
          {/* Left: run overview */}
          <div className="w-56 shrink-0 flex flex-col gap-1 overflow-auto">
            <div className="rounded border border-zinc-200 bg-white p-2 text-[10px]">
              <div className="font-bold text-zinc-700">Run: <span className="font-mono">{run.runId}</span></div>
              <div className="text-zinc-500">{run.status} · {run.elapsedMs ? `${(run.elapsedMs / 1000).toFixed(1)}s` : "…"}</div>
              <div className="mt-1 text-emerald-700 font-bold">✓ {run.combinedAccepted.length} accepted</div>
              <div className="text-red-700 font-bold">✗ {run.combinedRejected.length} rejected</div>
            </div>
            <div className="rounded border border-zinc-200 bg-white p-2 text-[10px] space-y-0.5">
              <div className="font-bold text-zinc-500 uppercase">IFL facets</div>
              {run.iflFacets.map((f, i) => <div key={i} className="font-mono text-[10px] text-zinc-700">{f}</div>)}
            </div>
            <button
              onClick={() => setSelectedLane("combined")}
              className={`rounded border px-2 py-1 text-[10px] font-bold text-left ${selectedLane === "combined" ? "border-sky-400 bg-sky-50 text-sky-800" : "border-zinc-200 bg-white text-zinc-700"}`}
            >Combined ({run.combinedAccepted.length + run.combinedRejected.length})</button>
            {run.lanes.map(l => (
              <button
                key={l.laneId}
                onClick={() => setSelectedLane(l.laneId)}
                className={`rounded border px-2 py-1 text-[10px] text-left ${selectedLane === l.laneId ? "border-sky-400 bg-sky-50" : "border-zinc-200 bg-white"}`}
              >
                <LaneBadge lane={l} />
              </button>
            ))}
          </div>

          {/* Right: lane detail */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto">
            {run.analysis && (
              <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-[11px] text-violet-900 shrink-0">
                <div className="font-bold mb-1">Gemini Diagnosis</div>
                <pre className="whitespace-pre-wrap font-sans text-[11px]">{run.analysis}</pre>
              </div>
            )}

            {/* IFL queries panel */}
            <details className="shrink-0 rounded border border-zinc-200 bg-white">
              <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-bold text-zinc-700">IFL per-section queries ({run.iflQueries.length})</summary>
              <div className="p-2 space-y-0.5">
                {run.iflQueries.map((q, i) => <div key={i} className="font-mono text-[10px] text-zinc-700">{q}</div>)}
              </div>
              <div className="border-t border-zinc-100 px-3 py-1.5">
                <div className="text-[10px] font-bold text-zinc-500 mb-0.5">Lattice directive (shown to model)</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200">{run.latticeDirective}</pre>
              </div>
            </details>

            {/* Lane detail */}
            {displayLane && (
              <div className="space-y-2 shrink-0">
                <div className="rounded border border-zinc-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <LaneBadge lane={displayLane} />
                    <span className="text-[10px] text-zinc-500">{displayLane.elapsedMs != null ? `${(displayLane.elapsedMs / 1000).toFixed(2)}s` : "…"}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1 text-[10px]">
                    <div><b>Dispatched query:</b> <code className="rounded bg-zinc-100 px-1">{displayLane.inputQuery}</code></div>
                    {displayLane.iflAlternatives.length > 1 && (
                      <div><b>Alternatives:</b> {displayLane.iflAlternatives.slice(1).map((q, i) => <code key={i} className="mr-1 rounded bg-zinc-100 px-1">{q}</code>)}</div>
                    )}
                    {displayLane.requestUrls.length > 0 && (
                      <details>
                        <summary className="cursor-pointer font-bold text-zinc-500">Request URLs ({displayLane.requestUrls.length})</summary>
                        {displayLane.requestUrls.map((u, i) => (
                          <div key={i} className="mt-0.5">
                            <a href={u} target="_blank" rel="noreferrer" className="break-all font-mono text-[10px] text-sky-600 hover:underline">{u}</a>
                          </div>
                        ))}
                      </details>
                    )}
                    {displayLane.workspaceGateLog.length > 0 && (
                      <details>
                        <summary className="cursor-pointer font-bold text-zinc-500">Workspace gate log ({displayLane.workspaceGateLog.length})</summary>
                        <div className="max-h-40 overflow-auto rounded bg-zinc-950 p-2 mt-1">
                          {displayLane.workspaceGateLog.map((l, i) => <div key={i} className="font-mono text-[10px] text-zinc-300">{l}</div>)}
                        </div>
                      </details>
                    )}
                    {displayLane.error && <div className="rounded bg-red-50 border border-red-200 px-2 py-1 text-red-800"><b>Error:</b> {displayLane.error}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-zinc-500">View:</span>
                  {(["items", "raw"] as const).map(v => (
                    <button key={v} onClick={() => setJsonView(v)} className={`rounded px-2 py-0.5 text-[10px] font-bold ${jsonView === v ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}>{v}</button>
                  ))}
                  <button onClick={() => copy(JSON.stringify(displayLane.rawOutput, null, 2))} className="ml-auto rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-700">Copy raw JSON</button>
                </div>
                {jsonView === "raw" ? (
                  <pre className="max-h-96 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200">{JSON.stringify(displayLane.rawOutput, null, 2)}</pre>
                ) : (
                  <div className="space-y-1">
                    {displayItems.length === 0 && <Empty>No items returned by this lane.</Empty>}
                    {displayItems.map((item, i) => <ItemRow key={i} item={item} idx={i} />)}
                  </div>
                )}
              </div>
            )}

            {selectedLane === "combined" && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-600">
                  <span className="text-emerald-700">✓ Accepted: {run.combinedAccepted.length}</span>
                  <span className="text-red-700">✗ Rejected: {run.combinedRejected.length}</span>
                  <button onClick={() => copy(JSON.stringify([...run.combinedAccepted, ...run.combinedRejected], null, 2))} className="ml-auto rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-700">Copy all</button>
                </div>
                {displayItems.map((item, i) => <ItemRow key={i} item={item} idx={i} />)}
              </div>
            )}

            {!selectedLane && (
              <Empty>Select a lane or "Combined" from the left panel to inspect its inputs and outputs.</Empty>
            )}
          </div>
        </div>
      )}

      {!run && !running && (
        <Empty>Enter a prompt, select lanes, and click <b>Run Scraper Debug</b>. No model generation occurs — only retrieval.</Empty>
      )}
    </div>
  );
}

/* ── Tab: Forge (turn-2, demoted — kept as reference) ─────────────────── */

function ForgeTab({ run }: { run: RunRecord | null }) {
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [target, setTarget] = useState(9.0);
  const [det, setDet] = useState<ScoreReport | null>(null);
  const [llm, setLlm] = useState<ScoreReport | null>(null);
  const [llmExtra, setLlmExtra] = useState<{ gradient: string; patch: string; region: string | null } | null>(null);
  const [diag, setDiag] = useState<PromptDiagnosis | null>(null);
  const [traj, setTraj] = useState<TrajectoryPoint[]>(() => loadTrajectory());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pullFromRun = () => { if (!run) return; setPrompt(run.question || ""); setOutput(run.finalText || ""); };
  const analyze = () => {
    setErr(null);
    if (!output.trim()) { setErr("Paste an output."); return; }
    const r = scoreDeterministic(output, prompt);
    setDet(r); setDiag(diagnose(r, target));
    setTraj(recordTrajectory(`det · ${new Date().toLocaleTimeString()}`, r));
  };
  const judge = async () => {
    setErr(null);
    if (!output.trim()) { setErr("Paste an output."); return; }
    setBusy(true);
    try {
      const res = await judgeWithLLM(prompt, output);
      setLlm(res.report); setLlmExtra({ gradient: res.gradient, patch: res.patch, region: res.primaryRegion });
      setTraj(recordTrajectory(`judge · ${res.model}`, res.report));
      if (!det) { const d = scoreDeterministic(output, prompt); setDet(d); setDiag(diagnose(d, target)); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const divergence = det && llm ? Math.abs(det.overall - llm.overall) : null;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-[11px] leading-snug text-amber-900">
        <b>⚠ Forge is a prompt-level scorer.</b> Per turn-3 clarification, the correct entry point for improving
        output is the <b>Diagnosis ★</b> tab, which proposes PIPELINE-architectural changes (not prompt tweaks).
        Forge is retained as a supporting rubric-scoring tool only.
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between"><label className="text-[10px] font-bold uppercase text-zinc-500">Prompt</label><button onClick={pullFromRun} disabled={!run} className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-700 disabled:opacity-40">Pull from run</button></div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} className="w-full resize-y rounded-lg border border-zinc-300 p-2 font-mono text-[11px]" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Output ({output.length.toLocaleString()} chars)</label>
          <textarea value={output} onChange={(e) => setOutput(e.target.value)} rows={6} className="w-full resize-y rounded-lg border border-zinc-300 p-2 font-mono text-[11px]" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px]">target<input type="number" step={0.5} min={5} max={10} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-16 rounded border border-zinc-300 px-1 py-0.5" /></label>
        <button onClick={analyze} className="rounded bg-zinc-900 px-3 py-1.5 text-[11px] font-bold text-white">Score (deterministic)</button>
        <button onClick={judge} disabled={busy} className="rounded bg-violet-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">{busy ? "Judging…" : "Score with LLM judge"}</button>
        <button onClick={() => { clearTrajectory(); setTraj([]); }} className="ml-auto rounded bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-600">Clear trajectory</button>
      </div>
      {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">{err}</div>}
      {det && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-3"><div className="text-[10px] font-bold uppercase text-zinc-500">Deterministic</div><div className="text-3xl font-black">{det.overall.toFixed(2)}</div><ScoreBar score={det.overall} /></div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3"><div className="text-[10px] font-bold uppercase text-zinc-500">LLM judge</div><div className="text-3xl font-black">{llm ? llm.overall.toFixed(2) : "—"}</div>{llm && <ScoreBar score={llm.overall} />}</div>
          <div className="rounded-lg border p-3" style={divergence != null && divergence > 1.5 ? { borderColor: "#fca5a5", background: "#fef2f2" } : { borderColor: "#e4e4e7", background: "#fff" }}>
            <div className="text-[10px] font-bold uppercase text-zinc-500">Divergence</div><div className="text-3xl font-black">{divergence != null ? divergence.toFixed(2) : "—"}</div>
            <div className="mt-1 text-[10px] text-zinc-600">{divergence == null ? "run both scorers" : divergence > 1.5 ? "⚠ large — one scorer is wrong" : "scorers agree"}</div>
          </div>
        </div>
      )}
      {diag && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <div className="mb-2 text-[11px] font-black uppercase text-emerald-800">Prompt-level patch (deterministic route)</div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] text-emerald-300">{diag.patchBlock}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => copy(diag.patchBlock)} className="rounded bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white">Copy prompt patch</button>
            {llmExtra?.patch && <button onClick={() => copy(llmExtra.patch)} className="rounded bg-violet-700 px-2 py-0.5 text-[10px] font-bold text-white">Copy judge patch</button>}
            <button onClick={() => copy(buildExternalAuditBundle({ prompt, output, deterministic: det!, llm, diagnosis: diag }))} className="rounded bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-white">Copy external audit bundle</button>
            <button onClick={() => copy(buildOproMetaPrompt(traj, prompt, target))} className="rounded bg-sky-700 px-2 py-0.5 text-[10px] font-bold text-white">Copy OPRO meta-prompt</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shell (unchanged plumbing; new tabs wired in) ────────────────────── */

export function PipelineDebugConsole() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("timeline");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useTraceTick();

  const runs = getRuns();
  const run = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;
  const liveCount = runs.filter((r) => r.status === "running").length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "D" && e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (typeof document === "undefined") return null;

  const launcher = (
    <button onClick={() => setOpen(true)} title="Pipeline Debug Console (⌘/Ctrl+Shift+D)" className="fixed bottom-4 right-4 z-[9997] flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2.5 text-[11px] font-bold text-white shadow-2xl">
      <span className="relative flex h-2 w-2">
        {liveCount > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${liveCount > 0 ? "bg-emerald-400" : "bg-zinc-500"}`} />
      </span>
      DEBUG {runs.length > 0 && <span className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px]">{runs.length}</span>}
    </button>
  );
  if (!open) return createPortal(launcher, document.body);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-zinc-100">
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-300 bg-white px-4 py-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-zinc-900 to-zinc-600 text-[10px] font-black text-white">DBG</div>
        <div>
          <div className="text-[13px] font-bold leading-tight text-zinc-900">Pipeline Debug Console</div>
          <div className="text-[10px] leading-tight text-zinc-500">V15 rigor stack + production baseline · step attribution · COVEA repair · pipeline-architectural diagnosis</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={clearRuns} className="rounded bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-600">Clear runs</button>
          <button onClick={() => setOpen(false)} className="rounded bg-zinc-900 px-3 py-1.5 text-[11px] font-bold text-white">Close</button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r border-zinc-300 bg-white">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
            <span className="text-[10px] font-bold uppercase text-zinc-500">Runs</span>
            <PasteExternal onDone={(id) => setSelectedId(id)} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {runs.length === 0 ? <div className="p-3 text-[10px] leading-snug text-zinc-500">No runs yet. Run a question or open <b>Probe</b>.</div> :
              runs.map((r) => (
                <button key={r.id} onClick={() => setSelectedId(r.id)} className={`block w-full border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50 ${run?.id === r.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : ""}`}>
                  <div className="flex items-center gap-1.5">
                    <Pill color={r.mode === "v15" ? "#4f46e5" : r.mode === "baseline" ? "#525252" : "#0891b2"}>{r.mode}</Pill>
                    <span className="font-mono text-[9px]" style={{ color: r.status === "running" ? "#16a34a" : r.status === "failed" ? "#dc2626" : "#71717a" }}>{r.status}</span>
                    <span className="ml-auto font-mono text-[9px] text-zinc-400">{r.events.length}ev</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-zinc-700">{r.question || "(no question)"}</div>
                  <div className="mt-0.5 flex gap-2 font-mono text-[9px] text-zinc-400">
                    <span>{new Date(r.startedAt).toLocaleTimeString()}</span>
                    {r.endedAt && <span>{ms(r.endedAt - r.startedAt)}</span>}
                    {r.guardScore != null && <span>g{r.guardScore.toFixed(1)}</span>}
                    {r.covea != null && <span className="text-violet-600">covea</span>}
                    {r.genome != null && <span className="text-purple-600">gen</span>}
                  </div>
                </button>
              ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-300 bg-white px-3 pt-2">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`shrink-0 rounded-t px-3 py-1.5 text-[11px] font-bold ${tab === t.id ? "bg-zinc-100 text-zinc-900 ring-1 ring-inset ring-zinc-300" : "text-zinc-500 hover:text-zinc-800"}`}>{t.label}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            {tab === "scraper-debug" && <ScraperDebugTab />}
            {tab === "timeline" && <TimelineTab run={run} />}
            {tab === "phases" && <PhasesTab run={run} />}
            {tab === "passes" && <PassesTab run={run} />}
            {tab === "sources" && <SourcesTab run={run} />}
            {tab === "scrapers" && <ScrapersTab run={run} />}
            {tab === "io" && <IOTab run={run} />}
            {tab === "probe" && <ProbeTab />}
            {tab === "attribution" && <AttributionTab run={run} />}
            {tab === "diagnosis" && <DiagnosisTab run={run} />}
            {tab === "genome" && <GenomeTemplateTab run={run} />}
            {tab === "research" && <ResearchTab run={run} />}
            {tab === "covea" && <CoveaTab run={run} />}
            {tab === "architecture" && <ArchitectureTab run={run} />}
            {tab === "selftest" && <SelfTestTab />}
            {tab === "forge" && <ForgeTab run={run} />}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PasteExternal({ onDone }: { onDone: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [t, setT] = useState("");
  if (!open) return <button onClick={() => setOpen(true)} className="rounded bg-cyan-600 px-1.5 py-0.5 text-[9px] font-bold text-white">+ paste</button>;
  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/40 p-6" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl rounded-xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-[12px] font-bold text-zinc-900">Register external output</div>
        <p className="mb-2 text-[10px] leading-snug text-zinc-500">Paste an output produced elsewhere. Diagnosis + Attribution still work; pipeline trace will be empty (that absence is shown honestly).</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="prompt / question" className="mb-2 w-full rounded border border-zinc-300 px-2 py-1 text-[11px]" />
        <textarea value={t} onChange={(e) => setT(e.target.value)} rows={8} placeholder="output text" className="w-full resize-y rounded border border-zinc-300 p-2 font-mono text-[11px]" />
        <div className="mt-2 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="rounded bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-600">Cancel</button>
          <button onClick={() => { if (!t.trim()) return; onDone(registerExternalRun(q, t)); setOpen(false); setQ(""); setT(""); }} className="rounded bg-cyan-600 px-3 py-1.5 text-[11px] font-bold text-white">Register</button>
        </div>
      </div>
    </div>
  );
}

export default PipelineDebugConsole;
