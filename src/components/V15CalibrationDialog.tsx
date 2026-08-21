/**
 * V15 Calibration Dialog — Rigor Guard Calibration Live UI
 *
 * Layout matches the uploaded reference screenshots:
 *  - Title bar with V15 Pipeline Enabled / Single Judge / Continuous toggles
 *  - Two sub-tabs: "Live Compare" (single Q&A) and "Batch Bank" (multi-Q calibration)
 *  - Header stats row: API key, V15 mean, Baseline mean, Δ delta
 *  - Config profile bar (4-Stage, N-Deep(n), Cluster(n), SLOOP pages, Template, Style override)
 *  - Live Compare tab: prompt box, roster, 246-Defense Catalog Pack card,
 *    Long-Report Cohesion Pass card, Gate Testbed card
 *  - Batch Bank tab: number of questions (1-5), custom-question input, sequential
 *    row-by-row completion, 3-score display (baseline, V15 guard, third-party judge),
 *    full untruncated result display, and pipeline diagram
 *  - Divergence review log (guard vs judge disagreements → improvement suggestions)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getGeminiKey, getV15Enabled as readV15Enabled, setV15Enabled as writeV15Enabled, subscribeV15 } from "@/lib/v15-state";
import {
  runV15OnQuestion, runBaselineOnQuestion, analyzeDivergence, runCohesionPass, runComparativeJudge,
  getDivergenceLog, saveDivergenceEntry, clearDivergenceLog,
  type V15RunOutcome, type V15Profile, type DivergenceEntry, type CohesionPassResult, type ComparativeJudgeResult,
} from "@/lib/v15-pipeline";
import { ARCHETYPES } from "@/lib/williams-style";
import { shuffleQuestions, type CalibQuestion } from "@/lib/v15-questions";
import { GEMINI_ELO_ROSTER, getModelEloInfo } from "@/lib/elo-registry";
import { getAdvancedGatesEnabled, listTestbedGates, setAdvancedGatesEnabled } from "@/lib/v15-gate-testbed";
import { snapshotAllUsage } from "@/lib/v15-rate-limiter";

interface Row {
  q: CalibQuestion;
  stage: "queued" | "baseline" | "v15" | "judging" | "done" | "error";
  baseline?: V15RunOutcome;
  v15?: V15RunOutcome;
  comparative?: ComparativeJudgeResult;
}

interface Props { open: boolean; onClose: () => void; }

const TARGET_SCORE = 9.0;
const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 5;
const MAX_CONTINUOUS_ROUNDS = 6;

const TEMPLATE_IDS = ["OMEGA-STRATEGY","OMEGA-DILIGENCE","OMEGA-DISCOVERY","OMEGA-COMPLIANCE","OMEGA-BUILD","OMEGA-SCIENCE","OMEGA-CRISIS","NIH-GRANT-SRF"];
const STYLE_OVERRIDES = [
  "--mckinsey-classic","--mgi-research","--bcg-tmodel","--bcg-perspective","--bain-pe","--bain-strategy",
  "--deloitte-engagement","--deloitte-regoutlook","--strategy&-cds","--pwc-ceosurvey","--ey-parthenon",
  "--ey-sectoroutlook","--kpmg-advisory","--kpmg-ceooutlook","--olwyman-finserv","--rolandberger","--lek",
  "--kearney","--alixpartners","--accenture-transform","--accenture-techvision","--ibm","--capgemini",
  "--gao-audit","--gao-par","--federal-rfp","--govcon","--nih-r01","--nih-rppr","--nsf-pappg","--imrad",
  "--prisma","--policybrief","--market-entry","--cdd","--digital-assess","--esg-csrd","--erm-coso","--qofe","--healthcare",
];

type Tab = "live" | "batch" | "guide";

export function V15CalibrationDialog({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("live");

  // Global toggles. V15 enabled is SHARED with the floating overlay via v15-state.
  const [v15Enabled, setV15EnabledState] = useState(() => readV15Enabled());
  const [singleJudge, setSingleJudge] = useState(true);
  const [continuousMode, setContinuousMode] = useState(false);

  // Profile knobs — mirror the real pipeline exactly
  const [fourStage, setFourStage] = useState(true);
  const [nDeep, setNDeep] = useState(true);
  const [nDeepPasses, setNDeepPasses] = useState(3);
  const [cluster, setCluster] = useState(true);
  const [clusterSize, setClusterSize] = useState(5);
  const [sloop, setSloop] = useState(true);
  const [sloopPages, setSloopPages] = useState(4);
  const [templateId, setTemplateId] = useState<string>("OMEGA-STRATEGY");
  const [styleOverride, setStyleOverride] = useState<string>("--bain-pe");
  const [williamsPersona, setWilliamsPersona] = useState<string>("");
  const [adversarial, setAdversarial] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
  const [webOg, setWebOg] = useState(true);
  const [webPrisma, setWebPrisma] = useState(false);
  const [webJina, setWebJina] = useState(false);
  const [webSearxng, setWebSearxng] = useState(true);
  const [bestOfNModels, setBestOfNModels] = useState(2);
  const [bestOfNHypotheses, setBestOfNHypotheses] = useState(5);
  const [bestOfNPackHypotheses, setBestOfNPackHypotheses] = useState(false);
  const [searxngUrl, setSearxngUrl] = useState(() => { try { return localStorage.getItem("veritas.v15.searxngUrl") || "http://localhost:8080"; } catch { return "http://localhost:8080"; } });
  const [searxngApiKey, setSearxngApiKey] = useState(() => { try { return localStorage.getItem("veritas.v15.searxngApiKey") || ""; } catch { return ""; } });
  const [searxngCategories, setSearxngCategories] = useState(() => { try { return localStorage.getItem("veritas.v15.searxngCategories") || "general"; } catch { return "general"; } });
  const [searxngLanguage, setSearxngLanguage] = useState(() => { try { return localStorage.getItem("veritas.v15.searxngLanguage") || "en"; } catch { return "en"; } });
  const [searxngSafe, setSearxngSafe] = useState(() => { try { return localStorage.getItem("veritas.v15.searxngSafe") || "0"; } catch { return "0"; } });
  const [searxngTesting, setSearxngTesting] = useState(false);
  const [searxngTestResult, setSearxngTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  async function testSearxngConnection() {
    setSearxngTesting(true); setSearxngTestResult(null);
    try {
      const base = searxngUrl.replace(/\/+$/, "");
      const params = new URLSearchParams({ q: "test", format: "json", categories: searxngCategories, language: searxngLanguage, safesearch: searxngSafe });
      const headers: Record<string, string> = { Accept: "application/json" };
      if (searxngApiKey) headers["Authorization"] = `Bearer ${searxngApiKey}`;
      const res = await fetch(`${base}/search?${params.toString()}`, { headers });
      if (!res.ok) { setSearxngTestResult({ ok: false, message: `HTTP ${res.status} — ensure format=json is enabled in SearXNG settings.yml.` }); return; }
      const json = await res.json();
      const count = Array.isArray(json.results) ? json.results.length : 0;
      setSearxngTestResult({ ok: true, message: `Connected — ${count} result(s) returned for test query.` });
    } catch (e: any) {
      setSearxngTestResult({ ok: false, message: e?.message || "Connection failed (network/CORS)." });
    } finally { setSearxngTesting(false); }
  }
  const [useDefensePack, setUseDefensePack] = useState(true);
  const [advancedGates, setAdvancedGates] = useState(getAdvancedGatesEnabled());
  const [advancedMode, setAdvancedMode] = useState(true);
  const [liveStage, setLiveStage] = useState<string>("");
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);

  // Batch bank state
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [customQuestion, setCustomQuestion] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [batchLog, setBatchLog] = useState<string[]>([]);
  function pushBatchLog(line: string) {
    const ts = new Date().toLocaleTimeString();
    setBatchLog(prev => [...prev.slice(-500), `${ts} ${line}`]);
  }
  const [selected, setSelected] = useState<number | null>(null);

  // Live Compare tab state
  const [liveQuestion, setLiveQuestion] = useState("Calculate the expected cost of a 3-year project with 8% inflation.");
  const [liveRow, setLiveRow] = useState<Row | null>(null);
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const [cohesionInput, setCohesionInput] = useState("");
  const [cohesionQuestion, setCohesionQuestion] = useState("Write a 4-page report on the strategic implications of AI regulation in 2026.");
  const [cohesionResult, setCohesionResult] = useState<CohesionPassResult | null>(null);
  const [cohesionRunning, setCohesionRunning] = useState(false);

  // Divergence log (auto-updates when new entries are saved)
  const [divergenceLog, setDivergenceLog] = useState<DivergenceEntry[]>(getDivergenceLog());
  const [showDivergenceLog, setShowDivergenceLog] = useState(false);

  // Custom Presets system
  const [presets, setPresets] = useState<Array<{ name: string; date: string; settings: any }>>(() => {
    try {
      const raw = localStorage.getItem("veritas.v15.savedPresets");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [newPresetName, setNewPresetName] = useState("");

  // Auxiliary API keys
  const [auxKeysInput, setAuxKeysInput] = useState("");
  const [auxKeys, setAuxKeys] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("veritas.v15.rotationKeys");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  // Allowed models
  const [allowedModels, setAllowedModels] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("veritas.v15.allowedModels");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  // Rate-limit snapshot
  const [rateUsage, setRateUsage] = useState(() => snapshotAllUsage());
  useEffect(() => {
    const t = setInterval(() => setRateUsage(snapshotAllUsage()), 1500);
    return () => clearInterval(t);
  }, []);

  const abortRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  useEffect(() => {
    if (!open) { abortRef.current.cancelled = true; setRunning(false); setLiveRunning(false); }
  }, [open]);
  useEffect(() => subscribeV15(setV15EnabledState), []);
  function handleV15Enabled(on: boolean) {
    setV15EnabledState(on);
    writeV15Enabled(on);
  }

  const apiKey = getGeminiKey();

  const profile: V15Profile = useMemo(() => ({
    fourStage, nDeep, nDeepPasses,
    cluster, clusterSize, sloop, sloopPages,
    templateId: templateId || undefined,
    styleOverride: styleOverride || undefined,
    williamsPersona: williamsPersona || undefined,
    adversarial,
    webSearch,
    webBackends: { ogScraper: webOg, prismafetch: webPrisma, jina: webJina, searxng: webSearxng },
    useOriginalDefensePack: useDefensePack,
    bestOfNModels,
    bestOfNHypotheses,
    bestOfNPackHypotheses,
  }), [fourStage, nDeep, nDeepPasses, cluster, clusterSize, sloop, sloopPages, templateId, styleOverride, williamsPersona, adversarial, webSearch, webOg, webPrisma, webJina, useDefensePack, bestOfNModels, bestOfNHypotheses, bestOfNPackHypotheses]);

  const effectiveDepth = nDeep ? Math.max(1, Math.min(8, nDeepPasses)) : 1;

  // ── Preset Helpers ────────────────────────────────────────────────────────
  function savePreset() {
    if (!newPresetName.trim()) return;
    const item = {
      name: newPresetName.trim(),
      date: new Date().toLocaleString(),
      settings: {
        fourStage, nDeep, nDeepPasses, cluster, clusterSize, sloop, sloopPages,
        templateId, styleOverride, williamsPersona, adversarial, webSearch,
        webOg, webPrisma, webJina, useDefensePack, advancedGates, singleJudge,
        continuousMode, batchSize, useCustom,
      }
    };
    const next = [...presets.filter(p => p.name !== item.name), item];
    setPresets(next);
    localStorage.setItem("veritas.v15.savedPresets", JSON.stringify(next));
    setNewPresetName("");
  }

  function deletePreset(name: string) {
    const next = presets.filter(p => p.name !== name);
    setPresets(next);
    localStorage.setItem("veritas.v15.savedPresets", JSON.stringify(next));
  }

  function loadPreset(settings: any) {
    if (!settings) return;
    if (settings.fourStage !== undefined) setFourStage(settings.fourStage);
    if (settings.nDeep !== undefined) setNDeep(settings.nDeep);
    if (settings.nDeepPasses !== undefined) setNDeepPasses(settings.nDeepPasses);
    if (settings.cluster !== undefined) setCluster(settings.cluster);
    if (settings.clusterSize !== undefined) setClusterSize(settings.clusterSize);
    if (settings.sloop !== undefined) setSloop(settings.sloop);
    if (settings.sloopPages !== undefined) setSloopPages(settings.sloopPages);
    if (settings.templateId !== undefined) setTemplateId(settings.templateId);
    if (settings.styleOverride !== undefined) setStyleOverride(settings.styleOverride);
    if (settings.williamsPersona !== undefined) setWilliamsPersona(settings.williamsPersona);
    if (settings.adversarial !== undefined) setAdversarial(settings.adversarial);
    if (settings.webSearch !== undefined) setWebSearch(settings.webSearch);
    if (settings.webOg !== undefined) setWebOg(settings.webOg);
    if (settings.webPrisma !== undefined) setWebPrisma(settings.webPrisma);
    if (settings.webJina !== undefined) setWebJina(settings.webJina);
    if (settings.useDefensePack !== undefined) setUseDefensePack(settings.useDefensePack);
    if (settings.advancedGates !== undefined) {
      setAdvancedGates(settings.advancedGates);
      setAdvancedGatesEnabled(settings.advancedGates);
    }
    if (settings.singleJudge !== undefined) setSingleJudge(settings.singleJudge);
    if (settings.continuousMode !== undefined) setContinuousMode(settings.continuousMode);
    if (settings.batchSize !== undefined) setBatchSize(settings.batchSize);
    if (settings.useCustom !== undefined) setUseCustom(settings.useCustom);
  }

  // ── Auxiliary Keys Helpers ────────────────────────────────────────────────
  function addAuxKey() {
    if (!auxKeysInput.trim()) return;
    const next = [...auxKeys.filter(k => k !== auxKeysInput.trim()), auxKeysInput.trim()];
    setAuxKeys(next);
    localStorage.setItem("veritas.v15.rotationKeys", JSON.stringify(next));
    // Import helper is imported from v15-state and triggers registration automatically
    import("../lib/v15-state").then(m => m.saveAuxiliaryGeminiKeys(next));
    setAuxKeysInput("");
  }

  function deleteAuxKey(key: string) {
    const next = auxKeys.filter(k => k !== key);
    setAuxKeys(next);
    localStorage.setItem("veritas.v15.rotationKeys", JSON.stringify(next));
    import("../lib/v15-state").then(m => m.saveAuxiliaryGeminiKeys(next));
  }

  // ── Allowed Models Helpers ────────────────────────────────────────────────
  function toggleAllowedModel(model: string) {
    const next = allowedModels.includes(model)
      ? allowedModels.filter(m => m !== model)
      : [...allowedModels, model];
    setAllowedModels(next);
    import("../lib/v15-state").then(m => m.saveAllowedModels(next));
  }

  // ── Synthesis Settings Port Link ─────────────────────────────────────────
  function downloadPortConfig() {
    const config = {
      veritas_v15_synthesis_port: {
        timestamp: new Date().toISOString(),
        profile,
        rate_limits: rateUsage,
      }
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "v15-synthesis-port.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function pushLog(line: string) {
    const ts = new Date().toLocaleTimeString();
    setLiveLog(prev => [...prev.slice(-200), `${ts} ${line}`]);
  }

  // ── Batch Bank runner (SEQUENTIAL — completes one Q fully, then next) ────
  async function runBatch() {
    if (!apiKey) { setStatus("❌ No Gemini API key found. Set one in Chat → Keys."); return; }
    abortRef.current.cancelled = false;
    setRunning(true);
    setRound(0);
    setSelected(null);
    // ACCUMULATE: prior-run rows are preserved; new rows append below them.
    let baseLen = rows.length;
    const size = Math.max(1, Math.min(MAX_BATCH_SIZE, batchSize));
    const maxRounds = continuousMode ? MAX_CONTINUOUS_ROUNDS : 1;

    for (let r = 0; r < maxRounds; r++) {
      if (abortRef.current.cancelled) break;
      setRound(r + 1);
      // Choose questions
      let questions: CalibQuestion[] = [];
      if (useCustom && customQuestion.trim().length > 0) {
        const parts = customQuestion.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).slice(0, size);
        questions = parts.map((text, i) => ({ id: `custom-${r}-${i}`, domain: "custom", text }));
        if (questions.length < size) {
          const extras = shuffleQuestions(Date.now() + r * 991).slice(0, size - questions.length);
          questions = [...questions, ...extras];
        }
      } else {
        questions = shuffleQuestions(Date.now() + r * 991).slice(0, size);
      }
      const acc: Row[] = questions.map(q => ({ q, stage: "queued" }));
      // Always append (never overwrite prior runs' outputs).
      setRows(prev => [...prev, ...acc]);
      const offset = baseLen;
      baseLen += acc.length;

      // SEQUENTIAL: complete each question fully (baseline+V15+judging+divergence-check) before moving on.
      for (let i = 0; i < acc.length; i++) {
        if (abortRef.current.cancelled) break;
        const globalIdx = offset + i;
        acc[i] = { ...acc[i], stage: "baseline" };
        setRows(prev => { const c = [...prev]; c[globalIdx] = acc[i]; return c; });
        setStatus(`R${r + 1} · Q${i + 1}/${acc.length} [${acc[i].q.domain}] · baseline…`);
        pushBatchLog(`▶ R${r + 1} Q${i + 1} [${acc[i].q.domain}] — ${acc[i].q.text.slice(0, 80)}`);

        const baselineRes = await runBaselineOnQuestion({
          apiKey, question: acc[i].q.text, singleJudge,
          onProgress: (s) => { setStatus(`R${r + 1} · Q${i + 1} baseline · ${s}`); pushBatchLog(`[baseline] ${s}`); },
        });
        acc[i] = { ...acc[i], baseline: baselineRes, stage: "v15" };
        setRows(prev => { const c = [...prev]; c[globalIdx] = acc[i]; return c; });

        if (abortRef.current.cancelled) break;

        setStatus(`R${r + 1} · Q${i + 1} · V15 (depth ${effectiveDepth}, ${clusterSize}-cluster, ${sloop ? sloopPages + "pg" : "no"}-sloop)…`);
        pushBatchLog(`[V15] starting depth ${effectiveDepth}, cluster×${clusterSize}${sloop ? `, SLOOP ${sloopPages}pg` : ""}`);
        const v15Res = v15Enabled ? await runV15OnQuestion({
          apiKey, question: acc[i].q.text,
          maxDepth: effectiveDepth,
          advancedGates, singleJudge, profile,
          onProgress: (s) => { setStatus(`R${r + 1} · Q${i + 1} V15 · ${s}`); setLiveStage(s); pushBatchLog(`[V15] ${s}`); },
        }) : baselineRes;

        // Divergence analysis if guard vs judge disagree by ≥ 1.0
        if (v15Res.judgeScore !== null) {
          const delta = v15Res.judgeScore - v15Res.guardScore;
          if (Math.abs(delta) >= 1.0) {
            setStatus(`R${r + 1} · Q${i + 1} · analyzing guard↔judge divergence (Δ ${delta.toFixed(1)})…`);
            pushBatchLog(`[divergence] guard/judge gap Δ${delta.toFixed(1)} — analyzing root cause`);
            const analysis = await analyzeDivergence({
              apiKey, question: acc[i].q.text, answer: v15Res.fixed,
              guardScore: v15Res.guardScore, judgeScore: v15Res.judgeScore,
              guardIssues: v15Res.issues, judgeNote: v15Res.judgeNote,
            });
            if (analysis) {
              const scoredJudges = (v15Res.judgeRoster ?? []).filter(j => j.score !== undefined);
              const entry: DivergenceEntry = {
                timestamp: Date.now(),
                question: acc[i].q.text,
                guardScore: v15Res.guardScore,
                judgeScore: v15Res.judgeScore,
                delta,
                suggestion: analysis,
                authorityModel: v15Res.eloConsensus?.authorityModel ?? scoredJudges[0]?.model ?? "unknown",
                judgePanel: scoredJudges.map(j => ({ model: j.model, score: j.score ?? 0, elo: j.elo })),
              };
              saveDivergenceEntry(entry);
              setDivergenceLog(getDivergenceLog());
            }
          }
        }

        // Independent comparative judge (fresh context, sees BOTH answers).
        if (!v15Res.error && !baselineRes.error) {
          acc[i] = { ...acc[i], v15: v15Res, stage: "judging" };
          setRows(prev => { const c = [...prev]; c[globalIdx] = acc[i]; return c; });
          setStatus(`R${r + 1} · Q${i + 1} · independent comparative judge…`);
          pushBatchLog(`[judge] independent comparative judge (fresh context)…`);
          const comparative = await runComparativeJudge({
            apiKey, question: acc[i].q.text,
            baselineAnswer: baselineRes.draft, v15Answer: v15Res.fixed,
          });
          acc[i] = { ...acc[i], v15: v15Res, comparative, stage: "done" };
        } else {
          acc[i] = { ...acc[i], v15: v15Res, stage: v15Res.error ? "error" : "done" };
        }
        setRows(prev => { const c = [...prev]; c[globalIdx] = acc[i]; return c; });
      }

      // Round summary
      const scores = acc.map(row => (row.v15?.judgeScore ?? row.v15?.guardScore ?? 0));
      const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
      const allPass = scores.every(s => s >= TARGET_SCORE);
      if (allPass && continuousMode) {
        setStatus(`✓ Round ${r + 1} passed. Mean V15: ${mean.toFixed(2)}/10.`);
        pushBatchLog(`✓ Round ${r + 1} complete — mean V15 ${mean.toFixed(2)}/10`);
        break;
      }
      if (r === maxRounds - 1) {
        setStatus(`■ Set complete (auto-stop). Mean V15: ${mean.toFixed(2)}/10.${continuousMode ? "" : " Enable Continuous Mode to auto-retry with fresh questions."}`);
        pushBatchLog(`■ Set complete — mean V15 ${mean.toFixed(2)}/10`);
      }
    }
    setRunning(false);
  }

  // ── Live Compare tab runner (single question, full pipeline emulation) ───
  async function runLiveOnce() {
    if (!apiKey) { setStatus("❌ No Gemini API key found."); return; }
    if (!liveQuestion.trim()) return;
    abortRef.current.cancelled = false;
    setLiveRunning(true);
    setLiveLog([]);
    setLiveRow(null);
    const q: CalibQuestion = { id: "live-1", domain: "live", text: liveQuestion.trim() };
    pushLog("▶ Live LLM Pipeline Comparison started (Old vs V15)");
    pushLog("[Old Path] Direct generation (no V15 processing)");

    const baselineRes = await runBaselineOnQuestion({
      apiKey, question: q.text, singleJudge,
      onProgress: (s) => pushLog(`[Baseline] ${s}`),
    });
    pushLog(`[Baseline] complete · judge ${baselineRes.judgeScore ?? "—"}`);

    pushLog(`[Universal Rigor] Drafting via 9-model Test & Rotate (random order)`);
    const v15Res = v15Enabled ? await runV15OnQuestion({
      apiKey, question: q.text,
      maxDepth: effectiveDepth,
      advancedGates, singleJudge, profile,
      onProgress: (s) => pushLog(`[Universal Rigor] ${s}`),
    }) : baselineRes;
    pushLog(`[Universal Rigor] ✓ V15 pipeline complete · guard ${v15Res.guardScore} · judge ${v15Res.judgeScore ?? "—"}`);

      let comparative: ComparativeJudgeResult | undefined;
      if (!v15Res.error && !baselineRes.error) {
        pushLog(`[Comparative Judge] evaluating baseline vs V15 in fresh context…`);
        comparative = await runComparativeJudge({
          apiKey,
          question: q.text,
          baselineAnswer: baselineRes.draft,
          v15Answer: v15Res.fixed,
        });
        if (comparative.ok) {
          pushLog(`[Comparative Judge] baseline ${comparative.baselineScore.toFixed(1)} vs V15 ${comparative.v15Score.toFixed(1)} · winner ${comparative.winner}`);
        } else {
          pushLog(`[Comparative Judge] unavailable: ${comparative.error ?? "unknown error"}`);
        }
      }
      const row: Row = { q, stage: "done", baseline: baselineRes, v15: v15Res, comparative };
      setLiveRow(row);

      if (v15Res.judgeScore !== null && Math.abs(v15Res.judgeScore - v15Res.guardScore) >= 1.0) {
        pushLog(`[Divergence] Δ ${(v15Res.judgeScore - v15Res.guardScore).toFixed(1)} — analyzing…`);
        const analysis = await analyzeDivergence({
          apiKey, question: q.text, answer: v15Res.fixed,
          guardScore: v15Res.guardScore, judgeScore: v15Res.judgeScore,
          guardIssues: v15Res.issues, judgeNote: v15Res.judgeNote,
        });
        if (analysis) {
          saveDivergenceEntry({
            timestamp: Date.now(), question: q.text,
            guardScore: v15Res.guardScore, judgeScore: v15Res.judgeScore,
            delta: v15Res.judgeScore - v15Res.guardScore, suggestion: analysis,
            authorityModel: v15Res.eloConsensus?.authorityModel ?? "unknown",
          });
          setDivergenceLog(getDivergenceLog());
          pushLog(`[Divergence] logged: ${analysis.reason.slice(0, 80)}…`);
        }
      }
      setLiveRunning(false);
  }

  async function runCohesion() {
    if (!apiKey) { setStatus("❌ No API key"); return; }
    if (!cohesionInput.trim()) return;
    setCohesionRunning(true);
    setCohesionResult(null);
    const res = await runCohesionPass({
      apiKey,
      question: cohesionQuestion,
      report: cohesionInput,
      onProgress: (s) => pushLog(`[Cohesion] ${s}`),
    });
    setCohesionResult(res);
    setCohesionRunning(false);
  }

  function stop() {
    abortRef.current.cancelled = true;
    setRunning(false); setLiveRunning(false);
    setStatus("⏹ Cancelled by engineer.");
  }

  if (!open) return null;

  const meanV15 = rows.length ? (rows.reduce((a, r) => a + (r.v15?.judgeScore ?? r.v15?.guardScore ?? 0), 0) / rows.length) : 0;
  const meanBase = rows.length ? (rows.reduce((a, r) => a + (r.baseline?.judgeScore ?? 0), 0) / rows.length) : 0;
  const delta = meanV15 - meanBase;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[94vh] max-h-[980px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* ── Title bar ─────────────────────────────────────────── */}
        <div className="flex-none border-b border-zinc-200 px-5 py-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Rigor Guard Calibration — Live</h2>
              <p className="text-[11px] text-zinc-500">Real flaw-registry scans + deterministic remediation convergence + universal scoring</p>
            </div>
            <div className="flex items-center gap-2">
              <label className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold cursor-pointer ${v15Enabled ? "text-emerald-700" : "text-zinc-500"}`}>
                <input type="checkbox" checked={v15Enabled} onChange={e => handleV15Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-emerald-600" />
                V15 Pipeline Enabled
              </label>
              <label className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold cursor-pointer ${singleJudge ? "text-sky-700" : "text-zinc-500"}`}>
                <input type="checkbox" checked={singleJudge} onChange={e => setSingleJudge(e.target.checked)} className="h-3.5 w-3.5 accent-sky-600" />
                Single Judge
              </label>
              <label className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold cursor-pointer ${continuousMode ? "text-amber-700" : "text-zinc-500"}`}>
                <input type="checkbox" checked={continuousMode} onChange={e => setContinuousMode(e.target.checked)} className="h-3.5 w-3.5 accent-amber-600" />
                Continuous
              </label>
              {tab === "batch" && !running && (
                <button onClick={runBatch} disabled={!apiKey} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40" title="Rotate models & restart calibration">
                  ▶ Rotate & Restart
                </button>
              )}
              {running && <button onClick={stop} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white">⏹ Stop</button>}
              <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-100">Close</button>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="mt-3 flex items-center gap-1.5">
            <button onClick={() => setTab("live")} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${tab === "live" ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>Live Compare</button>
            <button onClick={() => setTab("batch")} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${tab === "batch" ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}>Batch Bank</button>
            <button onClick={() => setTab("guide")} className={`rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1 ${tab === "guide" ? "bg-sky-600 text-white" : "border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"}`}>🔗 Web Grounding Guide</button>
            <button onClick={() => setShowAdvancedConfig(v => !v)} className={`ml-auto rounded-lg border px-3 py-1.5 text-xs font-bold ${showAdvancedConfig ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"}`}>
              ⚙️ Advanced Config
            </button>
            <button onClick={() => setShowDivergenceLog(v => !v)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${showDivergenceLog ? "border-fuchsia-400 bg-fuchsia-50 text-fuchsia-800" : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"}`}>
              📋 Divergence Log ({divergenceLog.length})
            </button>
          </div>

          {/* Stats row */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            {!apiKey && <span className="rounded-full bg-rose-100 px-2.5 py-0.5 font-bold text-rose-800">⚠ No Gemini API key — set in Chat → Keys</span>}
            {apiKey && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-emerald-800">key: {apiKey.slice(0, 6)}…{apiKey.slice(-4)}</span>}
            {running && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">▶ round {round}</span>}
            {rows.length > 0 && (
              <>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-zinc-800">V15 mean: <b className={meanV15 >= TARGET_SCORE ? "text-emerald-700" : "text-rose-700"}>{meanV15.toFixed(2)}</b></span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-zinc-800">Baseline mean: <b>{meanBase.toFixed(2)}</b></span>
                <span className={`rounded-full px-2 py-0.5 font-mono font-bold ${delta >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>Δ {delta >= 0 ? "+" : ""}{delta.toFixed(2)}</span>
              </>
            )}
          </div>
          {status && <div className="mt-1.5 font-mono text-[11px] text-zinc-500">{status}</div>}
        </div>

        {/* ── Profile config bar ────── */}
        <ProfileBar
          fourStage={fourStage} setFourStage={setFourStage}
          nDeep={nDeep} setNDeep={setNDeep} nDeepPasses={nDeepPasses} setNDeepPasses={setNDeepPasses}
          cluster={cluster} setCluster={setCluster} clusterSize={clusterSize} setClusterSize={setClusterSize}
          sloop={sloop} setSloop={setSloop} sloopPages={sloopPages} setSloopPages={setSloopPages}
          templateId={templateId} setTemplateId={setTemplateId}
          styleOverride={styleOverride} setStyleOverride={setStyleOverride}
          williamsPersona={williamsPersona} setWilliamsPersona={setWilliamsPersona}
          adversarial={adversarial} setAdversarial={setAdversarial}
          webSearch={webSearch} setWebSearch={setWebSearch}
          webOg={webOg} setWebOg={setWebOg}
          webPrisma={webPrisma} setWebPrisma={setWebPrisma}
          webJina={webJina} setWebJina={setWebJina}
          webSearxng={webSearxng} setWebSearxng={setWebSearxng}
          searxngUrl={searxngUrl} setSearxngUrl={setSearxngUrl}
          searxngApiKey={searxngApiKey} setSearxngApiKey={setSearxngApiKey}
          searxngCategories={searxngCategories} setSearxngCategories={setSearxngCategories}
          searxngLanguage={searxngLanguage} setSearxngLanguage={setSearxngLanguage}
          searxngSafe={searxngSafe} setSearxngSafe={setSearxngSafe}
          searxngTesting={searxngTesting} searxngTestResult={searxngTestResult}
          testSearxngConnection={testSearxngConnection}
          bestOfNModels={bestOfNModels} setBestOfNModels={setBestOfNModels}
          bestOfNHypotheses={bestOfNHypotheses} setBestOfNHypotheses={setBestOfNHypotheses}
          bestOfNPackHypotheses={bestOfNPackHypotheses} setBestOfNPackHypotheses={setBestOfNPackHypotheses}
        />

        {/* ── Advanced configuration panel ── */}
        {showAdvancedConfig && (
          <AdvancedConfigPanel
            presets={presets}
            newPresetName={newPresetName}
            setNewPresetName={setNewPresetName}
            savePreset={savePreset}
            deletePreset={deletePreset}
            loadPreset={loadPreset}
            auxKeys={auxKeys}
            auxKeysInput={auxKeysInput}
            setAuxKeysInput={setAuxKeysInput}
            addAuxKey={addAuxKey}
            deleteAuxKey={deleteAuxKey}
            allowedModels={allowedModels}
            toggleAllowedModel={toggleAllowedModel}
            downloadPortConfig={downloadPortConfig}
            onClose={() => setShowAdvancedConfig(false)}
          />
        )}

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden">
          {showDivergenceLog && (
            <DivergenceLogPanel
              log={divergenceLog}
              onClear={() => { clearDivergenceLog(); setDivergenceLog([]); }}
              onClose={() => setShowDivergenceLog(false)}
            />
          )}
          {!showDivergenceLog && tab === "live" && (
            <LiveCompareTab
              question={liveQuestion} setQuestion={setLiveQuestion}
              onRun={runLiveOnce} running={liveRunning}
              log={liveLog}
              row={liveRow}
              apiKey={!!apiKey}
              rateUsage={rateUsage}
              useDefensePack={useDefensePack} setUseDefensePack={setUseDefensePack}
              advancedGates={advancedGates} setAdvancedGates={(v) => { setAdvancedGates(v); setAdvancedGatesEnabled(v); }}
              cohesionInput={cohesionInput} setCohesionInput={setCohesionInput}
              cohesionQuestion={cohesionQuestion} setCohesionQuestion={setCohesionQuestion}
              cohesionResult={cohesionResult} cohesionRunning={cohesionRunning}
              onCohesion={runCohesion}
            />
          )}
          {!showDivergenceLog && tab === "batch" && (
            <BatchBankTab
              rows={rows} selected={selected} setSelected={setSelected}
              batchSize={batchSize} setBatchSize={setBatchSize}
              useCustom={useCustom} setUseCustom={setUseCustom}
              customQuestion={customQuestion} setCustomQuestion={setCustomQuestion}
              profile={profile} effectiveDepth={effectiveDepth}
              apiKey={!!apiKey}
              onRun={runBatch}
              running={running}
              advancedMode={advancedMode} setAdvancedMode={setAdvancedMode}
              liveStage={liveStage}
              useDefensePack={useDefensePack} setUseDefensePack={setUseDefensePack}
              advancedGates={advancedGates} setAdvancedGates={(v) => { setAdvancedGates(v); setAdvancedGatesEnabled(v); }}
              rateUsage={rateUsage}
              batchLog={batchLog}
            />
          )}
          {!showDivergenceLog && tab === "guide" && <GroundingGuidePanel />}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── SUB-COMPONENTS ─────────────────────────────

function ProfileBar(p: {
  fourStage: boolean; setFourStage: (v: boolean) => void;
  nDeep: boolean; setNDeep: (v: boolean) => void; nDeepPasses: number; setNDeepPasses: (n: number) => void;
  cluster: boolean; setCluster: (v: boolean) => void; clusterSize: number; setClusterSize: (n: number) => void;
  sloop: boolean; setSloop: (v: boolean) => void; sloopPages: number; setSloopPages: (n: number) => void;
  templateId: string; setTemplateId: (v: string) => void;
  styleOverride: string; setStyleOverride: (v: string) => void;
  williamsPersona: string; setWilliamsPersona: (v: string) => void;
  adversarial: boolean; setAdversarial: (v: boolean) => void;
  webSearch: boolean; setWebSearch: (v: boolean) => void;
  webOg: boolean; setWebOg: (v: boolean) => void;
  webPrisma: boolean; setWebPrisma: (v: boolean) => void;
  webJina: boolean; setWebJina: (v: boolean) => void;
  webSearxng: boolean; setWebSearxng: (v: boolean) => void;
  searxngUrl: string; setSearxngUrl: (v: string) => void;
  searxngApiKey: string; setSearxngApiKey: (v: string) => void;
  searxngCategories: string; setSearxngCategories: (v: string) => void;
  searxngLanguage: string; setSearxngLanguage: (v: string) => void;
  searxngSafe: string; setSearxngSafe: (v: string) => void;
  searxngTesting: boolean; searxngTestResult: { ok: boolean; message: string } | null;
  testSearxngConnection: () => void;
  bestOfNModels: number; setBestOfNModels: (v: number) => void;
  bestOfNHypotheses: number; setBestOfNHypotheses: (v: number) => void;
  bestOfNPackHypotheses: boolean; setBestOfNPackHypotheses: (v: boolean) => void;
}) {
  return (
    <div className="flex-none border-b border-indigo-100 bg-indigo-50/30 px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={p.fourStage} onChange={e => p.setFourStage(e.target.checked)} className="accent-indigo-600" />
          <span className="font-bold text-zinc-800">4-Stage</span>
        </label>
        <span className="flex items-center gap-1.5">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={p.nDeep} onChange={e => p.setNDeep(e.target.checked)} className="accent-indigo-600" />
            <span className="font-bold text-zinc-800">N-Deep</span>
          </label>
          <input type="number" min={1} max={8} value={p.nDeepPasses} disabled={!p.nDeep} onChange={e => p.setNDeepPasses(Math.max(1, Math.min(8, Number(e.target.value))))} className="w-14 rounded border border-zinc-300 px-1.5 py-0.5 text-center font-mono disabled:opacity-40" />
        </span>
        <span className="flex items-center gap-1.5">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={p.cluster} onChange={e => p.setCluster(e.target.checked)} className="accent-indigo-600" />
            <span className="font-bold text-zinc-800">Cluster</span>
          </label>
          <input type="number" min={1} max={16} value={p.clusterSize} disabled={!p.cluster} onChange={e => p.setClusterSize(Math.max(1, Math.min(16, Number(e.target.value))))} className="w-14 rounded border border-zinc-300 px-1.5 py-0.5 text-center font-mono disabled:opacity-40" />
        </span>
        <span className="flex items-center gap-1.5">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={p.sloop} onChange={e => p.setSloop(e.target.checked)} className="accent-indigo-600" />
            <span className="font-bold text-zinc-800">SLOOP pages</span>
          </label>
          <input type="number" min={1} max={32} value={p.sloopPages} disabled={!p.sloop} onChange={e => p.setSloopPages(Math.max(1, Math.min(32, Number(e.target.value))))} className="w-14 rounded border border-zinc-300 px-1.5 py-0.5 text-center font-mono disabled:opacity-40" />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-bold text-zinc-800">Template</span>
          <select value={p.templateId} onChange={e => p.setTemplateId(e.target.value)} className="rounded border border-zinc-300 px-2 py-0.5 font-mono text-[11px]">
            <option value="">— none —</option>
            {TEMPLATE_IDS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-bold text-zinc-800">Style override</span>
          <select value={p.styleOverride} onChange={e => p.setStyleOverride(e.target.value)} className="rounded border border-zinc-300 px-2 py-0.5 font-mono text-[11px]">
            <option value="">— none —</option>
            {STYLE_OVERRIDES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] border-t border-indigo-100 pt-2">
        <span className="flex items-center gap-1">
          <span className="font-bold text-zinc-800">Williams persona</span>
          <select value={p.williamsPersona} onChange={e => p.setWilliamsPersona(e.target.value)} className="rounded border border-zinc-300 px-2 py-0.5 font-mono text-[11px]">
            <option value="">— none —</option>
            {ARCHETYPES.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
        </span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={p.adversarial} onChange={e => p.setAdversarial(e.target.checked)} className="accent-rose-600" />
          <span className="font-bold text-rose-700">Adversarial engine</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={p.webSearch} onChange={e => p.setWebSearch(e.target.checked)} className="accent-sky-600" />
          <span className="font-bold text-sky-700">Web grounding</span>
        </label>
        {p.webSearch && (
          <span className="flex items-center gap-2 rounded bg-sky-50 px-2 py-0.5">
            <label className="flex items-center gap-1"><input type="checkbox" checked={p.webOg} onChange={e => p.setWebOg(e.target.checked)} className="accent-sky-600" /><span className="text-sky-800">OG scraper</span></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={p.webPrisma} onChange={e => p.setWebPrisma(e.target.checked)} className="accent-sky-600" /><span className="text-sky-800">PrismaFetch</span></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={p.webJina} onChange={e => p.setWebJina(e.target.checked)} className="accent-sky-600" /><span className="text-sky-800">Jina</span></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={p.webSearxng} onChange={e => p.setWebSearxng(e.target.checked)} className="accent-sky-600" /><span className="text-sky-800">SearXNG</span></label>
          </span>
        )}
      </div>
      {p.webSearch && p.webSearxng && (
        <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-violet-800">SearXNG Configuration</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6 text-[10px]">
            <label className="flex flex-col gap-0.5">
              <span className="font-bold text-zinc-600">Base URL</span>
              <input type="text" value={p.searxngUrl} onChange={e => { p.setSearxngUrl(e.target.value); try { localStorage.setItem("veritas.v15.searxngUrl", e.target.value); } catch {} }} className="rounded border border-zinc-300 px-1.5 py-1 font-mono" placeholder="http://localhost:8080" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-bold text-zinc-600">API Key</span>
              <input type="password" value={p.searxngApiKey} onChange={e => { p.setSearxngApiKey(e.target.value); try { localStorage.setItem("veritas.v15.searxngApiKey", e.target.value); } catch {} }} className="rounded border border-zinc-300 px-1.5 py-1 font-mono" placeholder="optional" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-bold text-zinc-600">Categories</span>
              <select value={p.searxngCategories} onChange={e => { p.setSearxngCategories(e.target.value); try { localStorage.setItem("veritas.v15.searxngCategories", e.target.value); } catch {} }} className="rounded border border-zinc-300 px-1.5 py-1 font-mono">
                <option value="general">general</option>
                <option value="science">science</option>
                <option value="it">it</option>
                <option value="news">news</option>
                <option value="academic">academic</option>
                <option value="files">files</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-bold text-zinc-600">Language</span>
              <select value={p.searxngLanguage} onChange={e => { p.setSearxngLanguage(e.target.value); try { localStorage.setItem("veritas.v15.searxngLanguage", e.target.value); } catch {} }} className="rounded border border-zinc-300 px-1.5 py-1 font-mono">
                <option value="en">en</option>
                <option value="es">es</option>
                <option value="fr">fr</option>
                <option value="de">de</option>
                <option value="all">all</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-bold text-zinc-600">Safe</span>
              <select value={p.searxngSafe} onChange={e => { p.setSearxngSafe(e.target.value); try { localStorage.setItem("veritas.v15.searxngSafe", e.target.value); } catch {} }} className="rounded border border-zinc-300 px-1.5 py-1 font-mono">
                <option value="0">Off</option>
                <option value="1">Moderate</option>
                <option value="2">Strict</option>
              </select>
            </label>
            <div className="flex items-end">
              <button onClick={p.testSearxngConnection} disabled={p.searxngTesting} type="button" className="w-full rounded-lg bg-violet-600 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-violet-700 disabled:opacity-50">
                {p.searxngTesting ? "Testing…" : "🔌 Test Connection"}
              </button>
            </div>
          </div>
          {p.searxngTestResult && (
            <div className={`mt-2 rounded px-2 py-1 text-[10px] font-mono ${p.searxngTestResult.ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
              {p.searxngTestResult.ok ? "✓" : "✗"} {p.searxngTestResult.message}
            </div>
          )}
          <div className="mt-1.5 text-[9px] text-violet-700">Tip: enable format=json in your SearXNG settings.yml under search: formats: [json]. All settings auto-saved to localStorage.</div>
        </div>
      )}
      {p.cluster && (
        <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-indigo-800">Best-of-N Outline-First Drafting (dense skeletons, expand winner only)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[10px]">
            <label className="flex flex-col gap-0.5">
              <span className="font-bold text-zinc-600">Models (distinct LLMs)</span>
              <input type="number" min={1} max={5} value={p.bestOfNModels} onChange={e => p.setBestOfNModels(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} className="rounded border border-zinc-300 px-2 py-1 font-mono" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-bold text-zinc-600">Hypotheses (outlines)</span>
              <input type="number" min={2} max={8} value={p.bestOfNHypotheses} onChange={e => p.setBestOfNHypotheses(Math.max(2, Math.min(8, Number(e.target.value) || 2)))} className="rounded border border-zinc-300 px-2 py-1 font-mono" />
            </label>
            <label className="col-span-2 flex items-end gap-1.5">
              <input type="checkbox" checked={p.bestOfNPackHypotheses} onChange={e => p.setBestOfNPackHypotheses(e.target.checked)} className="accent-indigo-600" />
              <span className="font-bold text-indigo-800">Pack multiple outlines per model call (RPM-saving mode)</span>
            </label>
          </div>
          <div className="mt-1.5 text-[9px] text-indigo-700">Each hypothesis is a DENSE outline (~250 words), not a full draft — only the highest-scoring outline is expanded into the full answer. This saves (N-1)/N of the draft-stage tokens versus generating N full drafts.</div>
        </div>
      )}
      <div className="mt-1 text-[10px] text-zinc-500">Mix freely: any combination or all together, with variable quantities — mirrors the real pipeline knobs. Williams persona · adversarial engine · live web grounding all route through the same stack as the live app.</div>
    </div>
  );
}

// ── Live Compare Tab ─────────────────────────────────────────────────────
function LiveCompareTab(p: {
  question: string; setQuestion: (v: string) => void;
  onRun: () => void; running: boolean;
  log: string[]; row: Row | null;
  apiKey: boolean;
  rateUsage: ReturnType<typeof snapshotAllUsage>;
  useDefensePack: boolean; setUseDefensePack: (v: boolean) => void;
  advancedGates: boolean; setAdvancedGates: (v: boolean) => void;
  cohesionInput: string; setCohesionInput: (v: string) => void;
  cohesionQuestion: string; setCohesionQuestion: (v: string) => void;
  cohesionResult: CohesionPassResult | null; cohesionRunning: boolean;
  onCohesion: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Prompt card */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-zinc-900">Live LLM Pipeline Comparison (Old vs V15)</div>
            <div className="text-[10px] text-zinc-500">Requires a configured provider API key in the Control panel. Without one, this is honestly reported as unavailable — never fabricated. When Test & Rotate is on, the judge ensemble spreads calls across every keyed, non-rate-limited model (Elo-sorted) instead of one fixed model.</div>
          </div>
          <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800 whitespace-nowrap">🔀 Test & Rotate (9 available)</span>
        </div>
        <textarea
          value={p.question}
          onChange={e => p.setQuestion(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-sans"
          placeholder="Enter a question…"
        />
        <button onClick={p.onRun} disabled={p.running || !p.apiKey} className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
          {p.running ? "Running…" : "Run Old vs V15 Live"}
        </button>
      </div>

      {/* Live log (terminal-style) */}
      {p.log.length > 0 && (
        <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-3 font-mono text-[11px] text-emerald-200">
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {p.log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {/* Side-by-side comparison */}
      {p.row && (
        <div className="space-y-3">
          {p.row.v15?.runSettings && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 text-[10px] font-mono text-zinc-700">
              <span className="font-bold text-zinc-500 uppercase mr-1">Run settings:</span>
              depth {p.row.v15.runSettings.depth} · model {p.row.v15.modelUsed}
              {p.row.v15.runSettings.fourStage ? " · 4-Stage" : ""}
              {p.row.v15.runSettings.cluster ? ` · cluster×${p.row.v15.runSettings.clusterSize}` : ""}
              {p.row.v15.runSettings.sloop ? ` · SLOOP ${p.row.v15.runSettings.sloopPages}pg` : ""}
              {p.row.v15.runSettings.templateId ? ` · ${p.row.v15.runSettings.templateId}` : ""}
              {p.row.v15.runSettings.styleOverride ? ` · ${p.row.v15.runSettings.styleOverride}` : ""}
              {p.row.v15.runSettings.williamsPersona ? ` · persona: ${p.row.v15.runSettings.williamsPersona}` : ""}
              {p.row.v15.runSettings.adversarial ? " · adversarial" : ""}
              {p.row.v15.runSettings.webSearch ? ` · web(${p.row.v15.groundingProvider ?? "?"}, ${p.row.v15.groundingCount ?? 0}src)` : ""}
              {p.row.v15.runSettings.defensePack ? " · 246-pack" : ""}
              {p.row.v15.runSettings.advancedGates ? " · testbed" : ""}
              {p.row.v15.runSettings.singleJudge ? " · single-judge" : " · panel-judge"}
            </div>
          )}
          {p.row.v15 && (p.row.v15 as any).citationAudit && <CitationAuditPanel audit={(p.row.v15 as any).citationAudit} />}
          {p.row.v15 && (p.row.v15 as any).passHistory && (p.row.v15 as any).passHistory.length > 0 && <DraftStatsPanel out={p.row.v15} />}
          {p.row.comparative && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50/50 p-3 text-[11px]">
              <div className="mb-1 flex items-center justify-between">
                <div className="font-bold text-amber-900">⚖️ Independent Comparative Judge (fresh context) — {p.row.comparative.judgeModel}</div>
                <div className="font-mono">baseline <b>{p.row.comparative.baselineScore.toFixed(1)}</b> vs V15 <b className={p.row.comparative.v15Score >= 9.5 ? "text-emerald-700" : ""}>{p.row.comparative.v15Score.toFixed(1)}</b> · gap <b className={p.row.comparative.gap >= 0 ? "text-emerald-700" : "text-rose-700"}>{p.row.comparative.gap >= 0 ? "+" : ""}{p.row.comparative.gap.toFixed(1)}</b> · winner: {p.row.comparative.winner}</div>
              </div>
              {p.row.comparative.rationale && <div className="italic text-amber-800 mb-1">{p.row.comparative.rationale}</div>}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-rose-200 bg-white p-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-600">OLD PATH (direct generation)</div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-zinc-800">{p.row.baseline?.draft ?? "…"}</pre>
            {p.row.baseline?.judgeScore !== null && p.row.baseline?.judgeScore !== undefined && (
              <div className="mt-2 border-t pt-2 text-[11px]"><b>Judge (baseline):</b> {p.row.baseline.judgeScore.toFixed(2)}/10</div>
            )}
          </div>
          <div className="rounded-2xl border-2 border-emerald-400 bg-white p-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">V15 PIPELINE (LIVE)</div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-zinc-800">{p.row.v15?.fixed ?? "…"}</pre>
            {p.row.v15 && (
              <div className="mt-2 border-t pt-2 space-y-1 text-[11px]">
                <div className="font-mono text-emerald-700">Guard: {p.row.v15.guardScore.toFixed(2)}/10 · Issues: {p.row.v15.issues.length} · Judge median: {p.row.v15.judgeScore?.toFixed(2) ?? "n/a"}</div>
                {p.row.v15.eloConsensus?.tieBreakApplied && (
                  <div className="rounded bg-indigo-50 p-1.5 text-[10px] italic text-indigo-800">🏅 Elo Tie-Break Applied: {p.row.v15.eloConsensus.rationale}</div>
                )}
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {/* Roster */}
      <ModelRoster rateUsage={p.rateUsage} judgeRoster={p.row?.v15?.judgeRoster ?? []} />

      {/* 246-Defense Catalog Pack card */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-bold text-amber-900">🛡️ 246-Defense Catalog Pack (additive)</div>
            <div className="mt-1 text-[11px] text-amber-800">Adds ~24 signature-based detectors from the original 246-defense catalog (A2, A5, C5, D1, E3, F2, F4, F5, G2, G6, H4, H7, I6, J2, K4, L2, N1, O2, Q4, R3, U1, V1, W1, X2) that complement V15 builtins without duplication. OFF by default — turning it on adds coverage; leaving it off preserves current V15 scoring exactly. Receipts include catalog cross-refs regardless.</div>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900">
            <input type="checkbox" checked={p.useDefensePack} onChange={e => p.setUseDefensePack(e.target.checked)} className="accent-amber-600" />
            Enable catalog-derived pack
          </label>
        </div>
      </div>

      {/* Long-Report Cohesion Pass card */}
      <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-3 space-y-2">
        <div>
          <div className="text-sm font-bold text-violet-900">📑 Long-Report Cohesion Pass (post-processor for 4-stage / N-Deep / cluster / SLOOP)</div>
          <div className="text-[11px] text-violet-800">Additive to the original app: paste a long report → V15 runs deterministic cohesion audit → inserts thesis if missing → rewrites ONLY defective sections (O(defective) not O(total) LLM calls) → preserves everything else verbatim.</div>
        </div>
        <input value={p.cohesionQuestion} onChange={e => p.setCohesionQuestion(e.target.value)} className="w-full rounded border border-violet-300 bg-white px-2 py-1.5 text-[12px]" placeholder="Question the report was written for…" />
        <textarea value={p.cohesionInput} onChange={e => p.setCohesionInput(e.target.value)} rows={5} className="w-full rounded border border-violet-300 bg-white px-2 py-1.5 text-[12px] font-mono" placeholder="Paste the long report output here (from 4-Stage / N-Deep / SLOOP / cluster pipeline)…" />
        <button onClick={p.onCohesion} disabled={p.cohesionRunning || !p.apiKey || !p.cohesionInput.trim()} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
          {p.cohesionRunning ? "Running…" : "▶ Run Cohesion Pass"}
        </button>
        {p.cohesionResult && (
          <div className="rounded bg-white p-2 text-[11px]">
            <div className="font-bold text-violet-900">Cohesion pass complete · rewrote {p.cohesionResult.sectionsRewritten} section(s)</div>
            {p.cohesionResult.cohesionIssues.length > 0 && (
              <ul className="mt-1 text-zinc-700">{p.cohesionResult.cohesionIssues.map((i, k) => <li key={k}>• {i}</li>)}</ul>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer font-bold text-violet-800">View improved report ↓</summary>
              <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap font-sans text-[11px] text-zinc-800">{p.cohesionResult.improved}</pre>
            </details>
          </div>
        )}
      </div>

      {/* Gate Testbed card */}
      <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/40 p-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-bold text-fuchsia-900">🧪 Gate Testbed (Advanced — auto-discovered gates)</div>
            <div className="mt-1 text-[11px] text-fuchsia-800">When enabled, an LLM analyzes each run for failure patterns NOT covered by the current gate registry and proposes new deterministic gates here. Toggle individual gates into live scanning.</div>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-fuchsia-900">
            <input type="checkbox" checked={p.advancedGates} onChange={e => p.setAdvancedGates(e.target.checked)} className="accent-fuchsia-600" />
            Enable cutting-edge testbed gates
          </label>
        </div>
        <div className="mt-2 text-[11px] text-fuchsia-700 italic">
          {listTestbedGates().length === 0
            ? "No gates discovered yet — run a live comparison with the testbed enabled."
            : `${listTestbedGates().length} testbed gate(s) discovered: ${listTestbedGates().map(g => g.code).join(", ")}`}
        </div>
      </div>
    </div>
  );
}

// ── Batch Bank Tab ────────────────────────────────────────────────────────
function BatchBankTab(p: {
  rows: Row[]; selected: number | null; setSelected: (i: number | null) => void;
  batchSize: number; setBatchSize: (n: number) => void;
  useCustom: boolean; setUseCustom: (v: boolean) => void;
  customQuestion: string; setCustomQuestion: (v: string) => void;
  profile: V15Profile; effectiveDepth: number;
  apiKey: boolean;
  onRun: () => void; running: boolean;
  advancedMode: boolean; setAdvancedMode: (v: boolean) => void;
  liveStage: string;
  useDefensePack: boolean; setUseDefensePack: (v: boolean) => void;
  advancedGates: boolean; setAdvancedGates: (v: boolean) => void;
  rateUsage: ReturnType<typeof snapshotAllUsage>;
  batchLog?: string[];
}) {
  const selectedRow = p.selected !== null ? p.rows[p.selected] : null;
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: batch inputs + row list */}
      <div className="w-1/2 overflow-y-auto border-r border-zinc-200">
        <div className="border-b border-zinc-200 bg-white p-3 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Batch calibration</div>
          <label className="flex items-center gap-2 text-[11px]">
            <span className="font-bold text-zinc-700">Questions (1-{MAX_BATCH_SIZE}):</span>
            <input type="number" min={1} max={MAX_BATCH_SIZE} value={p.batchSize} onChange={e => p.setBatchSize(Math.max(1, Math.min(MAX_BATCH_SIZE, Number(e.target.value))))} className="w-16 rounded border border-zinc-300 px-2 py-1 font-mono text-center" />
          </label>
          <label className="flex items-center gap-2 text-[11px]">
            <input type="checkbox" checked={p.useCustom} onChange={e => p.setUseCustom(e.target.checked)} className="accent-indigo-600" />
            <span className="font-bold text-zinc-700">Use custom question(s) instead of random bank</span>
          </label>
          {p.useCustom && (
            <textarea value={p.customQuestion} onChange={e => p.setCustomQuestion(e.target.value)} rows={4} className="w-full rounded border border-zinc-300 px-2 py-1.5 text-[12px]" placeholder="One question per double-line-break. Extra slots are filled from the random bank." />
          )}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={p.advancedMode} onChange={e => p.setAdvancedMode(e.target.checked)} className="accent-fuchsia-600" />
              <span className="font-bold text-fuchsia-800">Advanced diagram (per-pass live status)</span>
            </label>
            <span className="text-[9px] text-zinc-400">outputs accumulate across runs</span>
          </div>
          <button onClick={p.onRun} disabled={p.running || !p.apiKey} className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
            {p.running ? "Running…" : "▶ Run Batch"}
          </button>
        </div>

        {/* Pipeline diagram (live status) */}
        <PipelineDiagram profile={p.profile} effectiveDepth={p.effectiveDepth} advancedMode={p.advancedMode} liveStage={p.liveStage} running={p.running} />

        {/* Live Batch Log (terminal-style, scrollable, persistent) */}
        {p.batchLog && p.batchLog.length > 0 && (
          <div className="border-b border-zinc-200 bg-zinc-950 p-2">
            <div className="mb-1 flex items-center justify-between px-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
              <span>▸ LIVE BATCH LOG</span>
              <span className="text-zinc-500">{p.batchLog.length} LINES</span>
            </div>
            <div className="max-h-56 overflow-y-auto rounded bg-zinc-950 p-1.5 font-mono text-[10px] leading-relaxed text-emerald-200">
              {p.batchLog.map((l, i) => <div key={i} className="whitespace-pre-wrap break-all">{l}</div>)}
            </div>
          </div>
        )}

        {/* Row list */}
        {p.rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-500">Batch has not been run yet.</div>
        ) : (
          p.rows.map((r, i) => (
            <BatchRow key={i} row={r} idx={i} selected={p.selected === i} onSelect={() => p.setSelected(i)} />
          ))
        )}
      </div>

      {/* Right: prompt + baseline/V15 detail */}
      <div className="flex-1 overflow-y-auto bg-zinc-50/50 p-4">
        {!selectedRow ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">Select a batch row to view full untruncated results and telemetry.</div>
        ) : (
          <RowDetailPane row={selectedRow} />
        )}
      </div>
    </div>
  );
}

function BatchRow({ row, idx, selected, onSelect }: { row: Row; idx: number; selected: boolean; onSelect: () => void }) {
  const baseJudge = row.baseline?.judgeScore ?? null;
  const guardScore = row.v15?.guardScore ?? null;
  const v15Judge = row.v15?.judgeScore ?? null;
  const stage = row.stage;
  return (
    <button onClick={onSelect} className={`block w-full border-b border-zinc-100 px-3 py-2.5 text-left text-xs transition-colors hover:bg-indigo-50/50 ${selected ? "bg-indigo-50 border-l-4 border-l-indigo-600" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-700">{row.q.domain}</span>
          <span className={`text-[10px] font-bold ${stage === "done" ? "text-emerald-600" : stage === "error" ? "text-rose-600" : stage === "queued" ? "text-zinc-400" : "text-amber-600"}`}>
            {stage === "queued" ? "…" : stage === "baseline" ? "▶ baseline" : stage === "v15" ? "▶ V15" : stage === "judging" ? "▶ judging" : stage === "done" ? "✓" : "✗"}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="text-zinc-500">base: <b className={baseJudge !== null && baseJudge >= TARGET_SCORE ? "text-emerald-700" : "text-zinc-700"}>{baseJudge?.toFixed(1) ?? "—"}</b></span>
          <span className="text-zinc-500">guard: <b className={guardScore !== null && guardScore >= TARGET_SCORE ? "text-emerald-700" : "text-zinc-700"}>{guardScore?.toFixed(1) ?? "—"}</b></span>
          <span className="text-zinc-500">judge: <b className={v15Judge !== null && v15Judge >= TARGET_SCORE ? "text-emerald-700" : "text-zinc-700"}>{v15Judge?.toFixed(1) ?? "—"}</b></span>
        </div>
      </div>
      <div className="mt-1 line-clamp-2 text-zinc-800 font-medium">Q{idx + 1}. {row.q.text}</div>
      {row.v15 && (
        <div className="mt-1 flex items-center gap-2 text-[9px] text-zinc-500">
          <span>depth: {row.v15.passes}</span>
          <span>model: {row.v15.modelUsed}</span>
        </div>
      )}
    </button>
  );
}

function RowDetailPane({ row }: { row: Row }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">PROMPT ({row.q.domain})</div>
        <div className="mt-1 font-medium text-zinc-900 leading-relaxed">{row.q.text}</div>
      </div>

      {row.v15?.runSettings && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 text-[10px] font-mono text-zinc-700">
          <span className="font-bold text-zinc-500 uppercase mr-1">Run settings:</span>
          depth {row.v15.runSettings.depth} · model {row.v15.modelUsed}
          {row.v15.runSettings.fourStage ? " · 4-Stage" : ""}
          {row.v15.runSettings.cluster ? ` · cluster×${row.v15.runSettings.clusterSize}` : ""}
          {row.v15.runSettings.sloop ? ` · SLOOP ${row.v15.runSettings.sloopPages}pg` : ""}
          {row.v15.runSettings.templateId ? ` · ${row.v15.runSettings.templateId}` : ""}
          {row.v15.runSettings.styleOverride ? ` · ${row.v15.runSettings.styleOverride}` : ""}
          {row.v15.runSettings.williamsPersona ? ` · persona: ${row.v15.runSettings.williamsPersona}` : ""}
          {row.v15.runSettings.adversarial ? " · adversarial" : ""}
          {row.v15.runSettings.webSearch ? ` · web(${row.v15.groundingProvider ?? "?"}, ${row.v15.groundingCount ?? 0}src)` : ""}
          {row.v15.runSettings.defensePack ? " · 246-pack" : ""}
          {row.v15.runSettings.advancedGates ? " · testbed" : ""}
          {row.v15.runSettings.singleJudge ? " · single-judge" : " · panel-judge"}
        </div>
      )}

      {row.comparative && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50/50 p-3 text-[11px]">
          <div className="mb-1 flex items-center justify-between">
            <div className="font-bold text-amber-900">⚖️ Independent Comparative Judge (fresh context) — {row.comparative.judgeModel}</div>
            <div className="font-mono">baseline <b>{row.comparative.baselineScore.toFixed(1)}</b> vs V15 <b className={row.comparative.v15Score >= 9.5 ? "text-emerald-700" : ""}>{row.comparative.v15Score.toFixed(1)}</b> · gap <b className={row.comparative.gap >= 0 ? "text-emerald-700" : "text-rose-700"}>{row.comparative.gap >= 0 ? "+" : ""}{row.comparative.gap.toFixed(1)}</b> · winner: {row.comparative.winner}</div>
          </div>
          {row.comparative.rationale && <div className="italic text-amber-800 mb-1">{row.comparative.rationale}</div>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] font-bold uppercase text-zinc-500">Baseline → 9.9 needs:</div>
              <ul className="mt-0.5 list-disc pl-4 text-zinc-700">{row.comparative.baselineImprovements.map((s, k) => <li key={k}>{s}</li>)}</ul>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase text-zinc-500">V15 → 9.9 needs:</div>
              <ul className="mt-0.5 list-disc pl-4 text-zinc-700">{row.comparative.v15Improvements.map((s, k) => <li key={k}>{s}</li>)}</ul>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">BASELINE (SINGLE PASS)</div>
            {row.baseline?.judgeScore !== null && row.baseline?.judgeScore !== undefined && (
              <div className="font-mono text-xs">judge: <b>{row.baseline.judgeScore.toFixed(2)}</b></div>
            )}
          </div>
          {row.baseline?.error && <div className="mb-2 rounded bg-rose-50 p-2 font-mono text-rose-800">✗ {row.baseline.error}</div>}
          <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-zinc-800">{row.baseline?.draft ?? "…"}</pre>
          {row.baseline?.judgeNote && <div className="mt-2 border-t pt-1.5 text-[10px] italic text-zinc-500">"{row.baseline.judgeNote}"</div>}
        </div>

        <div className={`rounded-xl border bg-white p-3 ${(row.v15?.judgeScore ?? row.v15?.guardScore ?? 0) >= 9 ? "border-emerald-400" : "border-indigo-200"}`}>
          <div className="mb-1 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">V15 RIGOR GUARD</span>
              {row.v15 && <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-mono text-indigo-700">Depth {row.v15.passes}</span>}
            </div>
            {row.v15 && (
              <div className="font-mono text-xs">
                guard: <b>{row.v15.guardScore.toFixed(2)}</b> · judge: <b className={(row.v15.judgeScore ?? 0) >= 9 ? "text-emerald-700" : "text-zinc-700"}>{row.v15.judgeScore?.toFixed(2) ?? "—"}</b>
              </div>
            )}
          </div>
          {row.v15?.error && <div className="mb-2 rounded bg-rose-50 p-2 font-mono text-rose-800">✗ {row.v15.error}</div>}
          <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-zinc-800">{row.v15?.fixed ?? "…"}</pre>
          {row.v15 && (
            <div className="mt-2 border-t pt-2 space-y-1.5">
              {row.v15.eloConsensus && (
                <div className="rounded bg-indigo-50/70 p-2 text-[10px]">
                  <div className="font-bold text-indigo-900">Elo Consensus ({row.v15.eloConsensus.authorityModel} @ {row.v15.eloConsensus.authorityElo} Elo)</div>
                  <div className="text-indigo-800 italic mt-0.5">"{row.v15.eloConsensus.rationale}"</div>
                </div>
              )}
              {row.v15.issues.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600">REMAINING ISSUES ({row.v15.issues.length})</div>
                  <ul className="mt-1 space-y-1">
                    {row.v15.issues.map((i, k) => (
                      <li key={k} className="font-mono text-[9px] text-zinc-700 leading-tight">
                        <span className={`mr-1 rounded px-1 font-bold ${i.severity === "critical" ? "bg-rose-200 text-rose-900" : i.severity === "major" ? "bg-orange-100 text-orange-900" : i.severity === "warning" ? "bg-amber-100 text-amber-900" : "bg-zinc-100 text-zinc-700"}`}>{i.severity}</span>
                        <b>{i.code}</b>: {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {row.v15.autoFixesApplied.length > 0 && (
                <div className="text-[10px] text-emerald-700 font-bold">✓ auto-fixes: {row.v15.autoFixesApplied.join(", ")}</div>
              )}
              {(row.v15.testbedGatesProposed?.length ?? 0) > 0 && (
                <div className="rounded bg-violet-50 p-2 text-[10px]">
                  <div className="font-bold text-violet-900">Advanced Gate Testbed proposals</div>
                  <ul className="mt-1">{row.v15.testbedGatesProposed!.map(g => <li key={g.id} className="font-mono">• <b>{g.code}</b> ({g.severity}) · /{g.regex}/{g.flags || "i"}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelineDiagram({ profile, effectiveDepth, advancedMode, liveStage, running }: { profile: V15Profile; effectiveDepth: number; advancedMode: boolean; liveStage: string; running: boolean }) {
  // Parse the live progress string to know which stage is currently active.
  const stageKey = (s: string): string => {
    const t = (s || "").toLowerCase();
    if (t.includes("draft")) return "draft";
    if (t.includes("depth") && t.includes("scan")) { const m = t.match(/depth (\d+)/); return `scan${m?.[1] ?? "1"}`; }
    if (t.includes("depth") && t.includes("auto")) { const m = t.match(/depth (\d+)/); return `fix${m?.[1] ?? "1"}`; }
    if (t.includes("depth") && t.includes("refin")) { const m = t.match(/depth (\d+)/); return `refine${m?.[1] ?? "1"}`; }
    if (t.includes("gate mining")) return "mine";
    if (t.includes("judg")) return "judge";
    if (t.includes("done")) return "done";
    return "";
  };
  const cur = running ? stageKey(liveStage) : "";

  if (!advancedMode) {
    const stages: { name: string; active: boolean; detail?: string; key?: string }[] = [
      { name: "Draft (rotated)", active: true, detail: profile.templateId ? `template: ${profile.templateId}` : undefined, key: "draft" },
      { name: "4-Stage framing", active: !!profile.fourStage },
      { name: "Cluster synthesis", active: !!profile.cluster, detail: profile.cluster ? `${profile.clusterSize ?? 8} parallel` : undefined },
      { name: `Deterministic scan → auto-fix`, active: true, key: "fix1" },
      { name: `N-Deep refine loop`, active: !!profile.nDeep, detail: `depth ${effectiveDepth}`, key: "refine1" },
      { name: "SLOOP long-form", active: !!profile.sloop, detail: profile.sloop ? `${profile.sloopPages ?? 4} pages` : undefined },
      { name: "246-Defense catalog", active: !!profile.useOriginalDefensePack },
      { name: "Elo-consensus judge", active: true, key: "judge" },
      { name: "Divergence review", active: true },
    ];
    return (
      <div className="border-b border-zinc-200 bg-gradient-to-b from-indigo-50/40 to-white p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mb-2">Pipeline diagram (from current settings){running && <span className="ml-2 text-emerald-600">● live</span>}</div>
        <div className="flex flex-wrap items-center gap-1">
          {stages.map((s, i) => {
            const isCur = s.key && cur === s.key;
            return (
              <div key={i} className="flex items-center gap-1">
                <div className={`rounded-md border px-2 py-1 text-[10px] font-mono ${isCur ? "border-emerald-500 bg-emerald-100 text-emerald-900 animate-pulse" : s.active ? "border-indigo-400 bg-indigo-50 text-indigo-900" : "border-zinc-200 bg-zinc-50 text-zinc-400 line-through"}`}>
                  {s.name}{s.detail && <span className="ml-1 text-[9px] text-indigo-600">({s.detail})</span>}
                </div>
                {i < stages.length - 1 && <span className="text-zinc-400">→</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Advanced mode: per-pass buttons. Each N-Deep pass gets a Draft/Refine + a
  // 246-gate scan node, so N-Deep=4 → 8 nodes for that section.
  const nodes: { label: string; key: string; kind: "draft" | "scan" | "refine" | "gate" | "cluster" | "judge" | "sloop" | "divergence" }[] = [];
  nodes.push({ label: `Draft${profile.templateId ? ` · ${profile.templateId}` : ""}`, key: "draft", kind: "draft" });
  if (profile.fourStage) nodes.push({ label: "4-Stage", key: "fourstage", kind: "cluster" });
  if (profile.cluster) nodes.push({ label: `Cluster ×${profile.clusterSize ?? 8}`, key: "cluster", kind: "cluster" });
  for (let d = 1; d <= effectiveDepth; d++) {
    nodes.push({ label: `Scan #${d}`, key: `scan${d}`, kind: "scan" });
    nodes.push({ label: `246-Gate #${d}`, key: `fix${d}`, kind: "gate" });
    if (d < effectiveDepth) nodes.push({ label: `Refine #${d}`, key: `refine${d}`, kind: "refine" });
  }
  if (profile.sloop) nodes.push({ label: `SLOOP ${profile.sloopPages ?? 4}pg`, key: "sloop", kind: "sloop" });
  nodes.push({ label: "Elo Judge", key: "judge", kind: "judge" });
  nodes.push({ label: "Divergence", key: "done", kind: "divergence" });

  const kindColor: Record<string, string> = {
    draft: "border-indigo-400 bg-indigo-50 text-indigo-900",
    scan: "border-sky-400 bg-sky-50 text-sky-900",
    gate: "border-amber-400 bg-amber-50 text-amber-900",
    refine: "border-violet-400 bg-violet-50 text-violet-900",
    cluster: "border-teal-400 bg-teal-50 text-teal-900",
    sloop: "border-fuchsia-400 bg-fuchsia-50 text-fuchsia-900",
    judge: "border-emerald-400 bg-emerald-50 text-emerald-900",
    divergence: "border-rose-400 bg-rose-50 text-rose-900",
  };

  return (
    <div className="border-b border-zinc-200 bg-gradient-to-b from-fuchsia-50/30 to-white p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-700 mb-2">
        ADVANCED PIPELINE — {nodes.length} NODES{running && <span className="ml-2 text-emerald-600">● live</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {nodes.map((n, i) => {
          const isCur = running && cur === n.key;
          return (
            <div key={i} className="flex items-center gap-1">
              <div className={`rounded-md border px-2 py-1 text-[9px] font-mono ${isCur ? "border-emerald-600 bg-emerald-200 text-emerald-950 animate-pulse ring-2 ring-emerald-300" : kindColor[n.kind]}`}>
                {isCur ? "▶ " : ""}{n.label}
              </div>
              {i < nodes.length - 1 && <span className="text-zinc-300">→</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModelRoster({ rateUsage, judgeRoster }: { rateUsage: ReturnType<typeof snapshotAllUsage>; judgeRoster: NonNullable<V15RunOutcome["judgeRoster"]> }) {
  const judgeMap = new Map(judgeRoster.map(j => [j.model, j]));
  const usageBy = new Map(rateUsage.map(u => [u.model, u]));
  return (
    <div className="rounded-2xl border border-zinc-900/70 bg-white p-3 font-mono text-[11px]">
      <div className="mb-1 flex items-center justify-between">
        <div className="font-sans text-sm font-bold text-zinc-900">🔀 Test-&-Rotate LLM Pool (Elo-ranked)</div>
        <div className="text-[9px] uppercase tracking-wider text-zinc-400">snapshot</div>
      </div>
      <div className="space-y-0.5">
        {GEMINI_ELO_ROSTER.map((model, idx) => {
          const info = getModelEloInfo(model);
          const usage = usageBy.get(model);
          const j = judgeMap.get(model);
          const throttled = usage?.throttled ?? false;
          const dot = throttled ? "bg-amber-500" : j ? (j.ok ? "bg-emerald-500" : "bg-rose-500") : idx === 0 ? "bg-emerald-500" : "bg-sky-500";
          return (
            <div key={model} className="flex items-center justify-between gap-2 whitespace-nowrap">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                <span className="truncate text-zinc-900">{info.name}</span>
              </span>
              <span className="shrink-0 text-zinc-600 text-[10px]">
                {info.elo} · {info.tier}{info.tieBreakAuthority ? " · tie-break authority" : ""}
                {j ? ` · ${j.latencyMs}ms` : ""}
                {usage ? ` · ${usage.rpmUsed}/${usage.rpmMax}rpm ${usage.rpdUsed}/${usage.rpdMax}rpd` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DivergenceLogPanel({ log, onClear, onClose }: { log: DivergenceEntry[]; onClear: () => void; onClose: () => void }) {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50/50 p-3">
        <div>
          <div className="text-sm font-bold text-amber-900">🔎 Improvement Ledger — guard-vs-judge divergences ({log.length}) · engineer decides integration next turn</div>
          <div className="text-[11px] text-amber-800">When guard score and judge score differ by ≥ 1.0, the highest-Elo reviewer model analyzes WHY and proposes concrete improvements (single or multi-option). Nothing is auto-applied — each entry is pending your decision.</div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClear} className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50">Clear</button>
          <button onClick={onClose} className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs font-bold text-zinc-700 hover:bg-zinc-100">Back</button>
        </div>
      </div>
      {log.length === 0 && <div className="rounded border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">No divergences logged yet. Run some calibrations first.</div>}
      {log.slice().reverse().map((e, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 bg-white p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-zinc-500">
              {new Date(e.timestamp).toLocaleString()} · guard {e.guardScore} vs judge {e.judgeScore} (gap {Math.abs(e.delta).toFixed(2)}) · reviewed by {e.authorityModel} · <span className="font-bold text-amber-700">{e.decision ?? "pending-decision"}</span>
            </div>
            <div className="font-mono">Δ <b className={e.delta >= 0 ? "text-emerald-700" : "text-rose-700"}>{e.delta >= 0 ? "+" : ""}{e.delta.toFixed(1)}</b></div>
          </div>
          {e.judgePanel && e.judgePanel.length > 0 && (
            <div className="flex flex-wrap gap-1 text-[9px]">
              {e.judgePanel.map((j, k) => (
                <span key={k} className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-sky-800">
                  {k === 0 ? "judge-1" : `judge-${k + 1}`}: {j.model} (Elo {j.elo}) → {j.score}
                </span>
              ))}
            </div>
          )}
          <div className="rounded bg-zinc-50 p-2 text-[11px] italic text-zinc-700">{e.question.slice(0, 320)}{e.question.length > 320 ? "…" : ""}</div>
          <div className="rounded bg-indigo-50 p-2 text-[11px] text-indigo-900">{e.suggestion.reason}</div>
          <div>
            {e.suggestion.suggestions.map((s, k) => (
              <div key={k} className="text-[11px] mb-0.5">
                <b className="text-blue-700">{s.approach}:</b> <span className="text-zinc-800">{s.description}</span>
                {s.tradeoffs && <span className="text-[10px] italic text-zinc-500"> — trade-off: {s.tradeoffs}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface AdvancedConfigProps {
  presets: Array<{ name: string; date: string; settings: any }>;
  newPresetName: string;
  setNewPresetName: (v: string) => void;
  savePreset: () => void;
  deletePreset: (name: string) => void;
  loadPreset: (settings: any) => void;
  auxKeys: string[];
  auxKeysInput: string;
  setAuxKeysInput: (v: string) => void;
  addAuxKey: () => void;
  deleteAuxKey: (key: string) => void;
  allowedModels: string[];
  toggleAllowedModel: (model: string) => void;
  downloadPortConfig: () => void;
  onClose: () => void;
}

function AdvancedConfigPanel(p: AdvancedConfigProps) {
  // Domain 9.9 index roster definitions
  const SCORE_INDEX_ROSTER = [
    { dom: "General", quant: "worked examples, detailed step traces", qual: "calibrated confidence, clear structured definitions" },
    { dom: "Numeric", quant: "exact worked equations, concrete units on every quantity", qual: "stated constraints, explicit variables defined first" },
    { dom: "Medical", quant: "enrollment target estimates, target dosage mg/kg ceilings", qual: "SABV sex-disaggregated secondary plans, clinic safety crisis triage" },
    { dom: "Legal", quant: "exact Bluebook reporter volume numbers, statute sections", qual: "jurisdiction limit disclosure, explicit attorney advisory disclaimers" },
    { dom: "Finance", quant: "worked CAGR, EBITDA Bridges, NPV/IRR discount rate math", qual: "registered adviser disclaimers, forward-looking past-perf disclaimers" },
    { dom: "Statistics", quant: "exact confidence intervals, effect sizes, p-value caps", qual: "multiplicity correction, causal vs correlation limitations" },
    { dom: "Software", quant: "worked complexity analyses, exact code line validations", qual: "CORS wildcard disclaimers, unhandled exception coverage, strict types" },
    { dom: "Science", quant: "Worked reactants weight balance, descriptive statistics", qual: "IMRAD pure structure, citation DOI lookups, retraction audits" },
  ];

  return (
    <div className="flex-none border-b border-indigo-200 bg-white p-5 space-y-4 text-xs">
      <div className="flex items-center justify-between border-b pb-2">
        <div className="text-sm font-bold text-zinc-900">⚙️ Advanced Configuration Panel (V15 Calibration)</div>
        <button onClick={p.onClose} className="text-zinc-400 hover:text-zinc-600">✕</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 max-h-[65vh] overflow-y-auto pr-2">
        {/* Left: Presets & Rotating Keys */}
        <div className="space-y-4">
          {/* Saved Presets */}
          <div className="rounded-xl border border-zinc-200 p-3 space-y-2 bg-zinc-50/50">
            <div className="font-bold text-zinc-800">💾 Calibration Presets Manager</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={p.newPresetName}
                onChange={e => p.setNewPresetName(e.target.value)}
                placeholder="New preset name..."
                className="flex-1 rounded border border-zinc-300 px-2 py-1"
              />
              <button onClick={p.savePreset} className="rounded bg-indigo-600 px-3 py-1 font-bold text-white hover:bg-indigo-700">Save</button>
            </div>
            {p.presets.length > 0 ? (
              <div className="max-h-36 overflow-y-auto space-y-1">
                {p.presets.map(item => (
                  <div key={item.name} className="flex items-center justify-between rounded border bg-white p-1.5">
                    <div>
                      <div className="font-bold text-zinc-900">{item.name}</div>
                      <div className="text-[10px] text-zinc-400">saved {item.date}</div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => p.loadPreset(item.settings)} className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700 hover:bg-zinc-200">Load</button>
                      <button onClick={() => p.deletePreset(item.name)} className="rounded bg-rose-50 px-2 py-0.5 text-rose-700 hover:bg-rose-100">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-zinc-400 italic">No saved presets yet. Name and save your custom calibration settings above.</div>
            )}
            <button onClick={p.downloadPortConfig} className="w-full rounded border border-indigo-200 bg-white py-1.5 font-bold text-indigo-700 hover:bg-indigo-50">
              📥 Download V15 Synthesis Port Configuration (.json)
            </button>
          </div>

          {/* Auxiliary Rotating API Keys */}
          <div className="rounded-xl border border-zinc-200 p-3 space-y-2 bg-zinc-50/50">
            <div className="font-bold text-zinc-800">🔑 Rotating API Keys (Vendor: Gemini)</div>
            <div className="text-[10px] text-zinc-500">Provide multiple keys to rotate randomly, multiplying your available requests/minute and day quotas.</div>
            <div className="flex gap-2">
              <input
                type="password"
                value={p.auxKeysInput}
                onChange={e => p.setAuxKeysInput(e.target.value)}
                placeholder="Enter extra Gemini key..."
                className="flex-1 rounded border border-zinc-300 px-2 py-1"
              />
              <button onClick={p.addAuxKey} className="rounded bg-indigo-600 px-3 py-1 font-bold text-white hover:bg-indigo-700">Add Key</button>
            </div>
            {p.auxKeys.length > 0 ? (
              <div className="max-h-24 overflow-y-auto space-y-1">
                {p.auxKeys.map((key, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded border bg-white p-1.5 font-mono">
                    <span>Key #{idx + 1}: {key.slice(0, 6)}…{key.slice(-4)}</span>
                    <button onClick={() => p.deleteAuxKey(key)} className="rounded bg-rose-50 px-2 py-0.5 text-rose-700 hover:bg-rose-100">Remove</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-zinc-400 italic">No auxiliary keys added yet. Live runs will fallback strictly to the primary key.</div>
            )}
          </div>
        </div>

        {/* Right: Allowed Models & 9.9 Index */}
        <div className="space-y-4">
          {/* Model Allowlist Checklist */}
          <div className="rounded-xl border border-zinc-200 p-3 bg-zinc-50/50">
            <div className="font-bold text-zinc-800 mb-1.5">🎯 Model Access List (Allow / Disallow)</div>
            <div className="text-[10px] text-zinc-500 mb-2">Check the models below that the calibration pipeline is allowed to query randomly per run. Unchecked models are fully disabled. Empty allowlist = all active.</div>
            <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {GEMINI_ELO_ROSTER.map(model => {
                const info = getModelEloInfo(model);
                const active = p.allowedModels.length === 0 || p.allowedModels.includes(model);
                return (
                  <label key={model} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => p.toggleAllowedModel(model)}
                      className="h-3.5 w-3.5 accent-indigo-600"
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-zinc-900 truncate">{info.name.replace("gemini:", "")}</div>
                      <div className="text-[10px] text-zinc-500">{info.elo} · {info.tier}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 9.9 Score Calibration Index */}
          <div className="rounded-xl border border-zinc-200 p-3 bg-zinc-50/50">
            <div className="font-bold text-zinc-800 mb-1">📐 9.9 Score Calibration Index</div>
            <div className="text-[10px] text-zinc-500 mb-2">The exact balance of quantitative and qualitative data required for a perfect 9.9 score (independent of any specific OMEGA template structure):</div>
            <div className="max-h-36 overflow-y-auto space-y-1 text-[11px] leading-relaxed">
              {SCORE_INDEX_ROSTER.map(item => (
                <div key={item.dom} className="border-b pb-1">
                  <span className="font-bold text-zinc-900">{item.dom}:</span>
                  <span className="text-zinc-600 ml-1">Requires <b>{item.quant}</b> (quantitative) paired with <b>{item.qual}</b> (qualitative).</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Draft Stats Panel (deterministic, no LLM call — from V15 Engine) ────────
function DraftStatsPanel({ out }: { out: any }) {
  const passes = out.passHistory || [];
  if (passes.length === 0) return null;
  const bestIdx = out.bestPassIndex ?? -1;
  const isMonotonic = passes.every((p: any, i: number) => i === 0 || p.guardScore >= passes[i-1].guardScore);

  return (
    <div className="space-y-3 mb-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50/30 overflow-hidden text-[10px]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-sky-100 bg-sky-50">
          <div className="font-bold text-sky-900 flex items-center gap-1.5">
            <span className="text-sm">📊</span> Draft Stats (deterministic, no LLM call)
          </div>
          <div className="text-sky-700">{passes.length} pass(es) - best: pass {bestIdx + 1}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-sky-800 font-bold border-b border-sky-100 bg-sky-50/50">
              <tr>
                <th className="px-3 py-1.5">Pass</th>
                <th className="px-2 py-1.5">Guard</th>
                <th className="px-2 py-1.5">Model</th>
                <th className="px-2 py-1.5">Chars</th>
                <th className="px-2 py-1.5">Words</th>
                <th className="px-2 py-1.5">Sent.</th>
                <th className="px-2 py-1.5">Avg/sent</th>
                <th className="px-2 py-1.5">Cites</th>
                <th className="px-2 py-1.5">Code</th>
                <th className="px-2 py-1.5">H#</th>
                <th className="px-2 py-1.5">Tbl rows</th>
                <th className="px-2 py-1.5">Crit</th>
                <th className="px-2 py-1.5">Major</th>
                <th className="px-2 py-1.5">Warn</th>
                <th className="px-2 py-1.5">Canon gates</th>
                <th className="px-2 py-1.5">Testbed gates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-50 font-mono text-zinc-700">
              {passes.map((p: any, i: number) => {
                const isBest = i === bestIdx;
                return (
                  <tr key={i} className={isBest ? "bg-emerald-50/60" : "hover:bg-white/50"}>
                    <td className="px-3 py-1.5 font-bold flex items-center gap-1">{i + 1} {isBest && <span className="text-emerald-600">★</span>}</td>
                    <td className={"px-2 py-1.5 font-bold " + (p.guardScore >= 9 ? "text-emerald-700" : "text-amber-700")}>{p.guardScore.toFixed(2)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{p.modelUsed.replace("gemini-", "").slice(0, 12)}</td>
                    <td className="px-2 py-1.5">{p.charCount}</td>
                    <td className="px-2 py-1.5 font-bold">{p.wordCount}</td>
                    <td className="px-2 py-1.5">{p.sentenceCount}</td>
                    <td className="px-2 py-1.5">{p.avgSentenceLen.toFixed(1)}</td>
                    <td className="px-2 py-1.5">{p.citationCount}</td>
                    <td className="px-2 py-1.5">{p.codeBlockCount}</td>
                    <td className="px-2 py-1.5">{p.headingCount}</td>
                    <td className="px-2 py-1.5">{p.tableRowCount}</td>
                    <td className={"px-2 py-1.5 font-bold " + (p.criticalCount > 0 ? "text-rose-600" : "text-zinc-400")}>{p.criticalCount}</td>
                    <td className={"px-2 py-1.5 font-bold " + (p.majorCount > 0 ? "text-amber-600" : "text-zinc-400")}>{p.majorCount}</td>
                    <td className={"px-2 py-1.5 " + (p.warningCount > 0 ? "text-zinc-700" : "text-zinc-400")}>{p.warningCount}</td>
                    <td className="px-2 py-1.5">{p.canonicalGateHits?.length || 0}</td>
                    <td className="px-2 py-1.5">{p.testbedGateHits?.length || 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-sky-100 text-sky-800 flex items-center gap-1.5">
          {isMonotonic ? (
            <><span className="text-emerald-600">✅</span> Score was monotonically non-decreasing across all passes.</>
          ) : (
            <><span className="text-amber-600">⚠️</span> {passes.filter((p: any, i: number) => i > 0 && p.guardScore < passes[i-1].guardScore).length} pass(es) scored lower than the previous pass — engine kept pass {bestIdx + 1} as final.</>
          )}
        </div>
      </div>

      {out.bestOfNCandidates && out.bestOfNCandidates.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-3 text-[10px] mt-3">
          <div className="font-bold text-indigo-900 mb-2 flex items-center gap-1.5 justify-between">
            <span><span className="text-sm">🎯</span> Best-of-N Outline-First Candidates</span>
            <span className="text-indigo-700 font-normal">outline-first: only the winning skeleton was expanded to full length</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono">
              <thead className="border-b border-indigo-100 text-indigo-800">
                <tr><th className="px-2 py-1">#</th><th className="px-2 py-1">Model</th><th className="px-2 py-1">Stage</th><th className="px-2 py-1">Chars</th><th className="px-2 py-1">Score</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Snippet</th></tr>
              </thead>
              <tbody>
                {out.bestOfNCandidates.map((c: any, i: number) => (
                  <tr key={i} className={c.chosen ? "bg-emerald-50/60 align-top" : "align-top"}>
                    <td className="px-2 py-1">{c.index + 1}</td>
                    <td className="px-2 py-1">{c.model}</td>
                    <td className="px-2 py-1">
                      <span className={"rounded px-1.5 py-0.5 text-[9px] font-bold " + (c.stage === "expanded" ? "bg-emerald-200 text-emerald-900" : "bg-zinc-200 text-zinc-700")}>
                        {c.stage === "expanded" ? "EXPANDED" : c.stage === "outline" ? "OUTLINE ONLY" : "—"}
                      </span>
                    </td>
                    <td className="px-2 py-1">{c.charCount}</td>
                    <td className="px-2 py-1 font-bold">{typeof c.guardScore === "number" ? c.guardScore.toFixed(2) : "—"}</td>
                    <td className="px-2 py-1">{c.chosen ? "★ CHOSEN" : "discarded (outline)"}</td>
                    <td className="px-2 py-1 max-w-xs whitespace-pre-wrap text-zinc-600 text-[9px]">{c.snippet ? c.snippet + (c.snippet.length >= 160 ? "…" : "") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {out.coveReport && out.coveReport.questions && out.coveReport.questions.length > 0 && (
        <div className="rounded-xl border border-teal-200 bg-teal-50/30 p-3 text-[10px] mt-3">
          <div className="font-bold text-teal-900 mb-2 flex items-center gap-1.5 justify-between">
            <span><span className="text-sm">🔗</span> Chain-of-Verification (CoVe)</span>
            <span className={"px-2 py-0.5 rounded text-white font-bold " + (out.coveReport.inconsistencies === 0 ? "bg-emerald-500" : "bg-amber-500")}>{out.coveReport.inconsistencies}/{out.coveReport.questions.length} mismatch(es)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-teal-100 text-teal-800 font-bold">
                <tr><th className="px-2 py-1">Question</th><th className="px-2 py-1">Draft implied</th><th className="px-2 py-1">Verified</th><th className="px-2 py-1">OK</th></tr>
              </thead>
              <tbody className="divide-y divide-teal-50 font-mono text-zinc-700">
                {out.coveReport.questions.map((q: any, i: number) => (
                  <tr key={i} className={q.consistent ? "" : "bg-amber-50/50"}>
                    <td className="px-2 py-1 align-top">{q.question}</td>
                    <td className="px-2 py-1 align-top">{q.expectedAnswer}</td>
                    <td className="px-2 py-1 align-top">{q.verifiedAnswer}</td>
                    <td className="px-2 py-1 align-top font-bold">{q.consistent ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {out.polishApplied && (
        <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/30 p-3 text-[10px] mt-3">
          <div className="font-bold text-fuchsia-900 flex items-center gap-1.5"><span className="text-sm">✨</span> Polish pass applied</div>
          <div className="mt-1 text-fuchsia-800">The final pass repaired structural issues (e.g. References section, scaffolding leaks, punctuation, or unclosed blocks) without changing the substantive content.</div>
        </div>
      )}

      {out.judgeExcluded && out.judgeExcluded.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-3 text-[10px]">
          <div className="font-bold text-amber-900 mb-1.5 flex items-center gap-1.5">
            <span className="text-sm">⚠️</span> Judges excluded this run (never fabricated as a fallback score)
          </div>
          <ul className="list-disc pl-4 space-y-1 font-mono text-amber-800">
            {out.judgeExcluded.map((e: any, i: number) => (
              <li key={i}><b>{e.model}</b>: {e.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {out.adversarialPreview && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-3 text-[10px] font-mono mt-3">
          <div className="font-bold text-rose-900 mb-1.5 flex items-center gap-1.5 justify-between">
            <span><span className="text-sm">⚔️</span> Adversarial Engine Preview</span>
            <span className={"px-2 py-0.5 rounded text-white font-bold " + (out.adversarialPreview.verdict === "pass" ? "bg-emerald-500" : "bg-rose-500")}>{out.adversarialPreview.verdict.toUpperCase()}</span>
          </div>
          <div className="text-rose-800 mb-2 whitespace-pre-wrap max-h-48 overflow-y-auto bg-rose-100/50 p-2 rounded">
            {out.adversarialPreview.rawCritique || "(No raw critique text returned)"}
          </div>
          {out.adversarialPreview.defectCount > 0 && (
            <div className="text-rose-900 font-bold">
              Detected Categories: {out.adversarialPreview.categories.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Citation Audit Panel ──────────────────────────────────────────────────
function CitationAuditPanel({ audit }: { audit: any }) {
  if (!audit || audit.totalCitations === 0) return null;
  const isOk = audit.missingCount === 0 && audit.untrustedCount === 0;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-3 text-[10px] mt-3">
      <div className="font-bold text-indigo-900 mb-2 flex items-center gap-1.5 justify-between">
        <span><span className="text-sm">📚</span> Citation Provenance Audit</span>
        <span className={"px-2 py-0.5 rounded text-white font-bold " + (isOk ? "bg-emerald-500" : "bg-amber-500")}>
          {audit.trustedCount}/{audit.totalCitations} TRUSTED
        </span>
      </div>
      
      <div className="flex gap-4 mb-2 text-indigo-800">
        <div><b>Total [S#] tags:</b> {audit.totalCitations}</div>
        <div className={audit.untrustedCount > 0 ? "text-amber-700 font-bold" : ""}><b>Untrusted:</b> {audit.untrustedCount}</div>
        <div className={audit.missingCount > 0 ? "text-rose-700 font-bold" : ""}><b>Missing Source:</b> {audit.missingCount}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono bg-white rounded border border-indigo-100">
          <thead className="bg-indigo-50/50 text-indigo-900 border-b border-indigo-100">
            <tr>
              <th className="px-2 py-1.5">Tag</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5">Overlap/Entail</th>
              <th className="px-2 py-1.5">Claim Context (from draft)</th>
              <th className="px-2 py-1.5">Source Snippet (verbatim)</th>
              <th className="px-2 py-1.5">URL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-indigo-50">
            {audit.auditResults.map((r: any, i: number) => (
              <tr key={i} className={!r.found ? "bg-rose-50" : !r.trusted ? "bg-amber-50" : ""}>
                <td className="px-2 py-1.5 font-bold whitespace-nowrap">{r.tag}</td>
                <td className="px-2 py-1.5">
                  <span className={"px-1.5 py-0.5 rounded " + (r.trusted ? "bg-emerald-100 text-emerald-800" : !r.found ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800")}>
                    {r.trusted ? "TRUSTED" : !r.found ? "MISSING" : "UNTRUSTED"}
                  </span>
                </td>
                <td className="px-2 py-1.5">{r.found ? r.entailmentScore !== undefined ? `LLM:${r.entailmentScore.toFixed(2)}` : `Word:${r.snippetOverlap}` : "—"}</td>
                <td className="px-2 py-1.5 text-zinc-800 max-w-[250px] truncate" title={r.claimContext}>
                  {r.claimContext.slice(0, 100)}...
                </td>
                <td className="px-2 py-1.5 text-zinc-600 max-w-[250px] truncate" title={r.entry?.snippet}>
                  {r.entry ? r.entry.snippet.slice(0, 100) + "..." : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {r.entry?.url ? (
                    <a href={r.entry.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                      {new URL(r.entry.url).hostname.replace('www.','')}
                    </a>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Web Grounding Guide (SearXNG vs PrismaFetch comparison & setup) ─────────
function GroundingGuidePanel() {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
        <div className="text-sm font-bold text-sky-900 mb-1">🔗 Web Grounding Guide — SearXNG vs PrismaFetch</div>
        <div className="text-[11px] text-sky-800">Both backends are additive and can be combined freely. This guide compares their capabilities so you can choose the right combination for your calibration run.</div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-zinc-100 font-bold text-zinc-700">
            <tr>
              <th className="px-3 py-2">Capability</th>
              <th className="px-3 py-2">SearXNG</th>
              <th className="px-3 py-2">PrismaFetch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            <tr><td className="px-3 py-2 font-bold">Type</td><td className="px-3 py-2">Self-hosted metasearch aggregator</td><td className="px-3 py-2">Local read/search proxy service</td></tr>
            <tr><td className="px-3 py-2 font-bold">Setup</td><td className="px-3 py-2">Docker one-liner, format=json required</td><td className="px-3 py-2">Local server on 127.0.0.1:8080</td></tr>
            <tr><td className="px-3 py-2 font-bold">API key</td><td className="px-3 py-2">Optional (Bearer token)</td><td className="px-3 py-2">None required</td></tr>
            <tr><td className="px-3 py-2 font-bold">Categories</td><td className="px-3 py-2">general / science / it / news / academic / files</td><td className="px-3 py-2">Single unified index</td></tr>
            <tr><td className="px-3 py-2 font-bold">Language/Safe filters</td><td className="px-3 py-2">Yes — language + safesearch params</td><td className="px-3 py-2">No</td></tr>
            <tr><td className="px-3 py-2 font-bold">Read/Extract full page</td><td className="px-3 py-2">No (search results only)</td><td className="px-3 py-2">Yes — /api/read with OCR modes</td></tr>
            <tr><td className="px-3 py-2 font-bold">Best for</td><td className="px-3 py-2">Broad, category-filtered discovery</td><td className="px-3 py-2">Deep single-page extraction</td></tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-violet-200 bg-violet-50/30 p-4">
        <div className="text-[11px] font-bold text-violet-900 mb-2">🔧 SearXNG Setup</div>
        <ol className="list-decimal pl-5 space-y-1 text-[11px] text-violet-900">
          <li>Run: <code className="rounded bg-violet-100 px-1 font-mono">docker run -d -p 8080:8080 searxng/searxng</code></li>
          <li>Edit <code className="rounded bg-violet-100 px-1 font-mono">settings.yml</code>: under <code className="rounded bg-violet-100 px-1 font-mono">search: formats:</code> add <code className="rounded bg-violet-100 px-1 font-mono">- json</code></li>
          <li>Restart the container, then set the Base URL in the profile bar above (default <code className="rounded bg-violet-100 px-1 font-mono">http://localhost:8080</code>).</li>
          <li>Click <b>Test Connection</b> to verify — a successful test returns a result count for a sample query.</li>
        </ol>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/30 p-4">
        <div className="text-[11px] font-bold text-emerald-900 mb-2">🔧 PrismaFetch Setup</div>
        <ol className="list-decimal pl-5 space-y-1 text-[11px] text-emerald-900">
          <li>Run the PrismaFetch local service (default <code className="rounded bg-emerald-100 px-1 font-mono">http://127.0.0.1:8080</code>).</li>
          <li>Enable it under Chat → Control Plane → PrismaFetch, then confirm the healthz check passes.</li>
          <li>Toggle PrismaFetch in this dialog's Web grounding row to route calibration searches through it first.</li>
        </ol>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-[11px] text-zinc-600">
        <b>Recommendation:</b> enable both. The pipeline tries PrismaFetch → OG scraper → SearXNG → Jina in that order, falling back automatically whenever a backend is unreachable, so mixing backends only increases coverage — never risk.
      </div>
    </div>
  );
}
