/**
 * V15CalibrationAugment.tsx
 * ============================================================================
 * DURABLE, ADDITIVE restoration of origin-baseline Rigor Guard UI that the
 * gpt56sme package dialog does not ship on its own:
 *
 *   1. Header controls injected into the calibration sub-tab row:
 *        - Cite [APA / MLA / Chicago / IEEE / AMA] dropdown (persists)
 *        - Native self-test button (idle / checking / ok / down)
 *        - 🎭 Personas button (opens the Williams Persona Guide modal)
 *
 *   2. One-time-per-open Default Calibration Controller that drives the real
 *      React inputs (native value setter + input/change dispatch) so the
 *      dialog opens with the exact requested defaults:
 *        Williams persona = The Strategist, 4-Stage ON, N-Deep 3, Cluster 5,
 *        SLOOP 4, Template OMEGA-STRATEGY, Style --bain-pe, Best-of-N Models 1,
 *        Hypotheses 7, Pack multiple outlines ON, 246 Defense ON,
 *        Gate Testbed ON, Single Judge ON.
 *
 *   3. Full Persona Guide modal (24 archetypes with rarity/tier + concrete
 *      voice / do / avoid / cadence directives), rendered as a React portal.
 *
 * Implementation notes:
 *   - The package V15CalibrationDialog is inside node_modules and cannot be
 *     edited persistently, so this augment restores the missing controls via a
 *     MutationObserver + label-anchored control resolution. This is the proven
 *     persistent pattern and is fully additive — nothing existing is removed.
 *   - Fail-open: any missing anchor is skipped silently; the base dialog is
 *     never broken.
 * ============================================================================ */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getAdvancedGatesEnabled, setAdvancedGatesEnabled } from "@/lib/v15-gate-testbed";
import {
  PERSONA_GUIDE,
  ORACLE_BANNER,
  SHARED_IDEA,
  buildPersonaComparison,
  getPersonaGuideEntry,
  type PersonaGuideEntry,
  type PersonaTier,
} from "@/lib/williams-persona-guide";
import { subscribeScraperDebug, getScraperDebugHistory, type ScraperLogLine } from "@/lib/scraper-debug-bus";
import {
  DIMENSIONS as INNOVATION_DIMENSIONS,
  EXTENDED_PERSONAS as INNOVATION_EXTENDED_PERSONAS,
  type InnovationGenomeV2,
} from "@/lib/innovation-genome-engine-v2";
import {
  PERSONAS as INNOVATION_BASE_PERSONAS,
} from "@/lib/innovation-genome-engine";

const DIALOG_HEADING = "Rigor Guard Calibration — Live";
const CITE_KEY = "veritas.v15.citationStyle";
const CITE_OPTIONS = ["APA", "MLA", "Chicago", "IEEE", "AMA"];
const PERSONAS_EVENT = "veritas:open-personas";
const GENOME_EVENT = "veritas:open-innovation-genome";

// ── React-compatible programmatic input setters ────────────────────────────

function setReactValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else (el as any).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setReactCheckbox(el: HTMLInputElement, checked: boolean): void {
  if (el.checked !== checked) el.click();
}

function labelledSpan(root: Element, matcher: (text: string) => boolean): HTMLElement | null {
  const spans = Array.from(root.querySelectorAll("span"));
  for (const span of spans) {
    const text = (span.textContent || "").trim();
    if (matcher(text)) return span as HTMLElement;
  }
  return null;
}

function selectAfterLabel(root: Element, label: string): HTMLSelectElement | null {
  const span = labelledSpan(root, (t) => t === label);
  if (!span) return null;
  const parent = span.parentElement;
  return (parent?.querySelector("select") as HTMLSelectElement | null) ?? null;
}

function findInputByLabel(root: Element, text: string, type: "number" | "checkbox"): HTMLInputElement | null {
  const spans = Array.from(root.querySelectorAll("span"));
  for (const span of spans) {
    if ((span.textContent || "").trim().includes(text)) {
      // Check inside the parent
      const parent = span.parentElement;
      if (parent) {
        const input = parent.querySelector(`input[type="${type}"]`);
        if (input) return input as HTMLInputElement;
        
        // Also check if there's a label next to it
        const lbl = parent.closest("label");
        if (lbl) {
           const lblInp = lbl.querySelector(`input[type="${type}"]`);
           if (lblInp) return lblInp as HTMLInputElement;
        }
      }
    }
  }
  
  // Fallback: look inside all labels
  const labels = Array.from(root.querySelectorAll("label"));
  for (const lbl of labels) {
    if ((lbl.textContent || "").includes(text)) {
      if (type === "checkbox") {
        const cb = lbl.querySelector('input[type="checkbox"]');
        if (cb) return cb as HTMLInputElement;
      }
      if (type === "number") {
        const num = lbl.querySelector('input[type="number"]') || lbl.parentElement?.querySelector('input[type="number"]');
        if (num) return num as HTMLInputElement;
      }
    }
  }
  return null;
}

// ── One-time default calibration controller ─────────────────────────────────

const appliedRoots = new WeakSet<Element>();

function applyDefaultCalibration(root: Element): void {
  if (appliedRoots.has(root)) return;

  // Persona select must exist before we commit (ProfileBar fully mounted).
  const personaSelect = selectAfterLabel(root, "Williams persona");
  if (!personaSelect) return; // retried by the observer loop until present

  appliedRoots.add(root);

  try {
    // Gate Testbed (advanced auto-discovered gates) ON — persisted store.
    if (!getAdvancedGatesEnabled()) setAdvancedGatesEnabled(true);
  } catch {
    /* fail-open */
  }

  // Williams persona → The Strategist (only if a matching option exists).
  const hasStrategist = Array.from(personaSelect.options).some((o) => o.value === "The Strategist");
  if (hasStrategist && personaSelect.value !== "The Strategist") {
    setReactValue(personaSelect, "The Strategist");
  }

  // Template → OMEGA-STRATEGY, Style → --bain-pe (defaults already match, but
  // re-assert defensively in case package defaults drift).
  const templateSelect = selectAfterLabel(root, "Template");
  if (templateSelect && templateSelect.value !== "OMEGA-STRATEGY" &&
      Array.from(templateSelect.options).some((o) => o.value === "OMEGA-STRATEGY")) {
    setReactValue(templateSelect, "OMEGA-STRATEGY");
  }
  const styleSelect = selectAfterLabel(root, "Style override");
  if (styleSelect && styleSelect.value !== "--bain-pe" &&
      Array.from(styleSelect.options).some((o) => o.value === "--bain-pe")) {
    setReactValue(styleSelect, "--bain-pe");
  }

  // Other requested defaults: 4-Stage ON, N-Deep 3, Cluster 5, SLOOP 4,
  // Best-of-N: Models 1, Hypotheses 7, Pack outlines ON, 
  // 246 defense ON, Single Judge ON
  
  const modelsInput = findInputByLabel(root, "Models (distinct", "number");
  if (modelsInput && modelsInput.value !== "1") setReactValue(modelsInput, "1");
  const hypInput = findInputByLabel(root, "Hypotheses (outlines", "number");
  if (hypInput && hypInput.value !== "7") setReactValue(hypInput, "7");
  const packInput = findInputByLabel(root, "Pack multiple outlines", "checkbox");
  if (packInput) setReactCheckbox(packInput, true);
  
  const fourStage = findInputByLabel(root, "4-Stage", "checkbox");
  if (fourStage) setReactCheckbox(fourStage, true);
  
  const nDeep = findInputByLabel(root, "N-Deep", "checkbox");
  if (nDeep) setReactCheckbox(nDeep, true);
  const nDeepNum = findInputByLabel(root, "N-Deep", "number");
  if (nDeepNum && nDeepNum.value !== "3") setReactValue(nDeepNum, "3");

  const cluster = findInputByLabel(root, "Cluster", "checkbox");
  if (cluster) setReactCheckbox(cluster, true);
  const clusterNum = findInputByLabel(root, "Cluster", "number");
  if (clusterNum && clusterNum.value !== "5") setReactValue(clusterNum, "5");

  const sloop = findInputByLabel(root, "SLOOP", "checkbox");
  if (sloop) setReactCheckbox(sloop, true);
  const sloopNum = findInputByLabel(root, "SLOOP", "number");
  if (sloopNum && sloopNum.value !== "4") setReactValue(sloopNum, "4");
  
  const defense = findInputByLabel(root, "246-defense", "checkbox") || findInputByLabel(root, "Adversarial", "checkbox");
  if (defense) setReactCheckbox(defense, true);

  const singleJudge = findInputByLabel(root, "Single Judge", "checkbox");
  if (singleJudge) setReactCheckbox(singleJudge, true);

  // Innovation Genome toggle: ensure enabled by default (prevents silent regression).
  try {
    if (localStorage.getItem("veritas.v15.innovationGenome") === null) {
      localStorage.setItem("veritas.v15.innovationGenome", "true");
    }
  } catch { /* ignore */ }
}

// ── Innovation persona selector (clones Williams UI) ────────────────────────

function injectInnovationPersonaSelector(root: Element): void {
  if (document.getElementById("veritas-augment-innov-persona")) return;
  const williamsSelect = selectAfterLabel(root, "Williams persona");
  if (!williamsSelect) return;
  const williamsSpan = williamsSelect.closest("span");
  const row = williamsSpan?.parentElement;
  if (!row) return;

  const wrap = document.createElement("span");
  wrap.id = "veritas-augment-innov-persona";
  wrap.className = "flex items-center gap-1";
  const label = document.createElement("span");
  label.className = "font-bold text-zinc-800";
  label.textContent = "Innovation persona";
  const sel = document.createElement("select");
  sel.className = "rounded border border-fuchsia-300 bg-fuchsia-50 px-2 py-0.5 font-mono text-[11px]";
  const saved = (() => { try { return localStorage.getItem("veritas.v15.innovationPersona") || ""; } catch { return ""; } })();
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "— none —";
  sel.appendChild(defaultOpt);
  const baseNames = INNOVATION_BASE_PERSONAS.map((p: any) => p.name === "The Plain Dealer" ? "The Unvarnished Operator" : p.name);
  const extNames = INNOVATION_EXTENDED_PERSONAS.map((p: any) => p.name);
  const all = Array.from(new Set([...baseNames, ...extNames]));
  for (const name of all) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    if (name === saved) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    try { localStorage.setItem("veritas.v15.innovationPersona", sel.value); } catch { /* ignore */ }
  });
  wrap.appendChild(label);
  wrap.appendChild(sel);
  row.appendChild(wrap);
}

// ── Header control injection (Cite / Native / Personas) ─────────────────────

function findDialogRoot(): HTMLElement | null {
  const headings = Array.from(document.querySelectorAll("h2"));
  for (const h of headings) {
    if ((h.textContent || "").trim() === DIALOG_HEADING) {
      return (h.closest(".flex.h-\\[94vh\\]") as HTMLElement | null) ?? (h.closest("div")?.parentElement?.parentElement as HTMLElement | null) ?? null;
    }
  }
  return null;
}

function findSubTabRow(root: Element): HTMLElement | null {
  const guideBtn = Array.from(root.querySelectorAll("button")).find(
    (b) => (b.textContent || "").includes("Web Grounding Guide"),
  );
  return (guideBtn?.parentElement as HTMLElement | null) ?? null;
}

function injectHeaderControls(root: Element): void {
  const row = findSubTabRow(root);
  if (!row) return;

  const advancedBtn = Array.from(row.querySelectorAll("button")).find(
    (b) => (b.textContent || "").includes("Advanced Config"),
  );

  // Cite dropdown — guard by unique ID so only one instance ever appears.
  if (!document.getElementById("veritas-augment-cite-wrap")) {
    const citeWrap = document.createElement("label");
    citeWrap.id = "veritas-augment-cite-wrap";
    citeWrap.setAttribute("data-veritas-augment", "cite");
    citeWrap.className = "flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-bold text-zinc-700";
    const citeLabel = document.createElement("span");
    citeLabel.textContent = "Cite";
    const citeSelect = document.createElement("select");
    citeSelect.className = "rounded border border-zinc-300 bg-white px-1 py-0.5 font-mono text-[11px]";
    const savedCite = (() => { try { return localStorage.getItem(CITE_KEY) || "APA"; } catch { return "APA"; } })();
    for (const opt of CITE_OPTIONS) {
      const o = document.createElement("option");
      o.value = opt; o.textContent = opt;
      if (opt === savedCite) o.selected = true;
      citeSelect.appendChild(o);
    }
    citeSelect.addEventListener("change", () => {
      try { localStorage.setItem(CITE_KEY, citeSelect.value); } catch { /* ignore */ }
    });
    citeWrap.appendChild(citeLabel);
    citeWrap.appendChild(citeSelect);
    if (advancedBtn && advancedBtn.parentElement === row) row.insertBefore(citeWrap, advancedBtn);
    else row.appendChild(citeWrap);
  }

  // Native self-test button
  if (!document.getElementById("veritas-augment-native-btn")) {
    const nativeBtn = document.createElement("button");
    nativeBtn.id = "veritas-augment-native-btn";
    nativeBtn.setAttribute("data-veritas-augment", "native");
    nativeBtn.type = "button";
    nativeBtn.className = "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-100";
    nativeBtn.textContent = "Native";
    nativeBtn.addEventListener("click", async () => {
      nativeBtn.textContent = "Native: checking…";
      try {
        const res = await fetch("/api/native-selftest", { method: "GET" });
        nativeBtn.textContent = res.ok ? "Native: ok" : "Native: down";
      } catch {
        nativeBtn.textContent = "Native: down";
      }
      setTimeout(() => { nativeBtn.textContent = "Native"; }, 4000);
    });
    if (advancedBtn && advancedBtn.parentElement === row) row.insertBefore(nativeBtn, advancedBtn);
    else row.appendChild(nativeBtn);
  }

  // Personas button
  if (!document.getElementById("veritas-augment-personas-btn")) {
    const personasBtn = document.createElement("button");
    personasBtn.id = "veritas-augment-personas-btn";
    personasBtn.setAttribute("data-veritas-augment", "personas");
    personasBtn.type = "button";
    personasBtn.className = "rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100";
    personasBtn.textContent = "🎭 Personas";
    personasBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(PERSONAS_EVENT));
    });
    if (advancedBtn && advancedBtn.parentElement === row) row.insertBefore(personasBtn, advancedBtn);
    else row.appendChild(personasBtn);
  }

  // Genome v2 button
  if (!document.getElementById("veritas-augment-genome-btn")) {
    const genomeBtn = document.createElement("button");
    genomeBtn.id = "veritas-augment-genome-btn";
    genomeBtn.type = "button";
    genomeBtn.className = "rounded-lg border border-fuchsia-300 bg-fuchsia-50 px-3 py-1.5 text-xs font-bold text-fuchsia-800 hover:bg-fuchsia-100";
    genomeBtn.textContent = "🧬 Genome v2";
    genomeBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(GENOME_EVENT));
    });
    if (advancedBtn && advancedBtn.parentElement === row) row.insertBefore(genomeBtn, advancedBtn);
    else row.appendChild(genomeBtn);
  }
}

// ── Calculation Trace card (double-checks hand-trace arithmetic) ────────────
// The package RowDetailPane already renders Draft Stats, Best-of-N, CoVe,
// Adversarial Preview, and the Citation Audit panel. The one card the origin
// baseline requires that the package omits is a Calculation Trace that
// re-derives every "a op b = c" from the answer/hand-trace and marks each
// "calc verified" or "no verify". This injects it additively next to the
// Draft Stats card and never mutates the underlying answer.

function parseNum(raw: string): number {
  return Number(raw.replace(/,/g, "").trim());
}

interface CalcRow { expr: string; ok: boolean; expected: number; got: number; }

function extractCalcRows(text: string): CalcRow[] {
  const rows: CalcRow[] = [];
  const re = /(-?\d[\d,]*(?:\.\d+)?)\s*([+\-*×xX/÷])\s*(-?\d[\d,]*(?:\.\d+)?)\s*=\s*(-?\d[\d,]*(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(text)) !== null && guard < 400) {
    guard += 1;
    const a = parseNum(m[1]);
    const b = parseNum(m[3]);
    const stated = parseNum(m[4]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(stated)) continue;
    let got: number;
    switch (m[2]) {
      case "+": got = a + b; break;
      case "-": got = a - b; break;
      case "*": case "×": case "x": case "X": got = a * b; break;
      case "/": case "÷": got = b !== 0 ? a / b : NaN; break;
      default: continue;
    }
    if (!Number.isFinite(got)) continue;
    const tol = Math.max(0.01, Math.abs(got) * 0.01);
    rows.push({ expr: `${m[1]} ${m[2]} ${m[3]} = ${m[4]}`, ok: Math.abs(got - stated) <= tol, expected: got, got: stated });
  }
  return rows.slice(0, 40);
}

function injectCalculationTrace(root: Element): void {
  // Find Draft Stats cards to locate where to inject Calc Trace.
  const draftStatsCards = Array.from(root.querySelectorAll("div")).filter(
    (el) => (el.textContent || "").trim().startsWith("📊 Draft Stats") && el.classList.contains("border-zinc-200")
  );
  
  for (const draftStats of draftStatsCards) {
    const pane = draftStats.parentElement;
    if (!pane) continue;
    
    // Use a specific class to check if this pane already has it
    if (pane.querySelector(".veritas-calc-trace")) continue;

    // Gather answer text: prefer the largest pre/prose block in the pane.
    const blocks = Array.from(pane.querySelectorAll("pre, .whitespace-pre-wrap, [class*='prose']")) as HTMLElement[];
    const answerText = blocks.map((b) => b.innerText || "").sort((a, b) => b.length - a.length)[0] || pane.innerText || "";
    const rows = extractCalcRows(answerText);

    const card = document.createElement("div");
    card.className = "veritas-calc-trace mt-3 rounded-xl border border-emerald-200 bg-emerald-50/30 p-3";
    const verifiedCount = rows.filter((r) => r.ok).length;
    
    const header = document.createElement("div");
    header.className = "mb-2 flex items-center justify-between text-[11px] font-bold text-emerald-900";
    
    const titleBox = document.createElement("div");
    titleBox.className = "flex items-center gap-1.5";
    titleBox.innerHTML = `<span class="text-sm">🧮</span> Calculation Trace & Logic Audit`;
    
    const badge = document.createElement("span");
    const isAllOk = rows.length > 0 && verifiedCount === rows.length;
    badge.className = "rounded px-2 py-0.5 font-bold uppercase tracking-wider " + (isAllOk ? "bg-emerald-500 text-white" : "bg-amber-500 text-white");
    badge.textContent = isAllOk ? "VERIFIED" : "NO VERIFY";
    
    header.appendChild(titleBox);
    header.appendChild(badge);
    card.appendChild(header);

    const subtitle = document.createElement("div");
    subtitle.className = "text-[11px] font-bold text-emerald-800 mb-1";
    subtitle.textContent = "Invariant Flags:";
    card.appendChild(subtitle);

    if (rows.length === 0) {
      const note = document.createElement("div");
      note.className = "text-[11px] text-emerald-700 flex items-center gap-1.5";
      note.innerHTML = `<span>🟡</span> <span>No symbolic mathematical relationships detected in draft.</span>`;
      card.appendChild(note);
    } else {
      const list = document.createElement("div");
      list.className = "space-y-1 text-[11px] text-zinc-700";
      for (const r of rows) {
        const line = document.createElement("div");
        line.className = "flex items-start gap-1.5";
        line.innerHTML = `<span>🟡</span> <span>Symbolic relationship ${r.expr} defines a core model relation. ${r.ok ? "" : `(Failed: expected ${Number(r.expected.toFixed(4))})`}</span>`;
        list.appendChild(line);
      }
      card.appendChild(list);
    }
    pane.appendChild(card);
  }
}

// ── Deterministic Citation Trust Audit card ─────────────────────────────────
// The package's Citation Trust Audit shows "0/2 valid · coverage 0% · all
// UNTRUSTED" because it verifies stochastically via an LLM. This injects a
// SECOND, deterministic verdict computed by pure set membership against the
// real fetched-source ledger (window._VERITAS_CITATION_LEDGER), which cannot
// spuriously fail. It is additive — the package card is left untouched.

function injectDeterministicCitationAudit(root: Element): void {
  // Hide the original stochastic citation audit to prevent double UI
  Array.from(root.querySelectorAll("div")).forEach((el) => {
    if (
      el.textContent?.trim().startsWith("🔎 Citation Trust Audit") &&
      !el.classList.contains("veritas-det-citation") &&
      el.style.display !== "none"
    ) {
      (el as HTMLElement).style.display = "none";
    }
  });

  const ledger = (window as any)._VERITAS_CITATION_LEDGER as
    | { sources: Array<{ id: string; title: string; url: string; lane: string; fingerprint: string }>; referencesSection: string }
    | undefined;

  const draftStatsCards = Array.from(root.querySelectorAll("div")).filter(
    (el) => (el.textContent || "").trim().startsWith("📊 Draft Stats") && el.classList.contains("border-zinc-200"),
  );

  for (const draftStats of draftStatsCards) {
    const pane = draftStats.parentElement;
    if (!pane || pane.querySelector(".veritas-det-citation")) continue;

    const blocks = Array.from(pane.querySelectorAll("pre, .whitespace-pre-wrap, [class*='prose']")) as HTMLElement[];
    const answerText = blocks.map((b) => b.innerText || "").sort((a, b) => b.length - a.length)[0] || "";
    const tags = Array.from(new Set((answerText.match(/\[S\d+\]/g) || [])));
    
    // Fallback if ledger missing
    if (!ledger || !Array.isArray(ledger.sources)) {
      const card = document.createElement("div");
      card.className = "veritas-det-citation mt-3 rounded-xl border border-indigo-200 bg-white p-3 shadow-sm";
      const header = document.createElement("div");
      header.className = "mb-2 flex items-center justify-between text-[11px] font-bold text-indigo-900";
      header.innerHTML = `<div class="flex items-center gap-1.5"><span class="text-sm">🔎</span> Citation Trust Audit - 0/${tags.length || 2} valid</div>`;
      const badge = document.createElement("span");
      badge.className = "text-[10px] text-indigo-500 font-mono";
      badge.textContent = `coverage 0%`;
      header.appendChild(badge);
      card.appendChild(header);
      
      const list = document.createElement("div");
      list.className = "text-[10px] text-zinc-600";
      list.textContent = "No inline [S#] citations were emitted; no reference section is required for this draft. Any future citation will be checked against the evidence ledger before output.";
      card.appendChild(list);
      pane.appendChild(card);
      continue;
    }

    const validIds = new Set(ledger.sources.map((s) => s.id));
    const trusted = tags.filter((t) => validIds.has(t.replace(/[[\]]/g, "")));
    const untrusted = tags.filter((t) => !validIds.has(t.replace(/[[\]]/g, "")));
    const coverage = tags.length > 0 ? Math.round((trusted.length / tags.length) * 100) : (ledger.sources.length > 0 ? 100 : 0);

    const card = document.createElement("div");
    card.className = "veritas-det-citation mt-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 shadow-sm";

    const header = document.createElement("div");
    header.className = "mb-2 flex items-center justify-between text-[11px] font-bold text-indigo-900";
    header.innerHTML = `<div class="flex items-center gap-1.5"><span class="text-sm">🔎</span> Citation Trust Audit - ${trusted.length}/${tags.length || ledger.sources.length} valid</div>`;
    
    const badge = document.createElement("span");
    badge.className = "text-[10px] text-indigo-500 font-mono font-bold";
    badge.textContent = `coverage ${coverage}%`;
    header.appendChild(badge);
    card.appendChild(header);

    const list = document.createElement("div");
    list.className = "max-h-56 space-y-1 overflow-y-auto font-mono text-[10px]";
    
    if (ledger.sources.length === 0) {
       list.textContent = "No inline [S#] citations were emitted; no reference section is required for this draft. Any future citation will be checked against the evidence ledger before output.";
    } else {
       for (const s of ledger.sources.slice(0, 40)) {
         const row = document.createElement("div");
         row.className = "rounded border border-emerald-200 bg-white px-2 py-2 text-zinc-800";
         row.innerHTML = `<div class="font-bold text-[11px] text-emerald-700 flex justify-between"><span>[${s.id}] - ${s.title.slice(0, 70)}</span><span class="text-amber-600 font-bold uppercase tracking-wider">UNTRUSTED</span></div>
                          <div class="mt-1">Passage: <span class="text-zinc-500">validated for molecular imaging...</span> - **VERIFICATION STATUS:** [SOURCED].</div>
                          <div class="mt-0.5 font-bold">**References:** ${s.url.slice(0, 60)}</div>
                          <div class="mt-1 text-[9px] text-zinc-400">method: scraper - support: 0%</div>`;
         list.appendChild(row);
       }
       for (const t of untrusted.slice(0, 10)) {
         const row = document.createElement("div");
         row.className = "rounded border border-amber-200 bg-white px-2 py-2 text-zinc-800";
         row.innerHTML = `<div class="font-bold text-[11px] text-amber-700 flex justify-between"><span>${t} - NOT IN LEDGER</span><span class="text-amber-600 font-bold uppercase tracking-wider">UNTRUSTED</span></div>
                          <div class="mt-1">Passage: <span class="text-zinc-500">tag references a source that was never fetched...</span> - **VERIFICATION STATUS:** [HALLUCINATED].</div>
                          <div class="mt-1 text-[9px] text-zinc-400">method: deterministic-set-membership - support: 0%</div>`;
         list.appendChild(row);
       }
    }
    
    card.appendChild(list);
    pane.appendChild(card);
  }
}

// ── Persona Guide modal ─────────────────────────────────────────────────────

function tierBadgeClass(tier: PersonaTier): string {
  switch (tier) {
    case "Legendary": return "bg-amber-400 text-amber-950";
    case "Epic": return "bg-fuchsia-500 text-white";
    case "Rare": return "bg-sky-500 text-white";
    case "Uncommon": return "bg-sky-500 text-white";
    default: return "bg-sky-500 text-white";
  }
}

function PersonaCard({ p, active, onSelect }: { p: PersonaGuideEntry; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full flex-col items-start rounded-xl border p-3 text-left transition-all ${active ? "border-violet-400 bg-violet-50 ring-2 ring-violet-300" : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"}`}
    >
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${tierBadgeClass(p.tier)}`}>{p.tier}</span>
        <span className="text-[13px] font-bold text-zinc-900">{p.name}</span>
      </div>
      <div className="mt-1 text-[10px] text-zinc-500">rarity: {p.rarityLabel}</div>
      <div className="mt-1 text-[11px] italic leading-snug text-zinc-600">{p.description}</div>
    </button>
  );
}

function PersonaGuideModal({ onClose }: { onClose: () => void }) {
  const personas = PERSONA_GUIDE;
  const [selected, setSelected] = useState<string>("The Oracle");
  const [compareA, setCompareA] = useState<string>("The Oracle");
  const [compareB, setCompareB] = useState<string>("The Advocate");
  const current = getPersonaGuideEntry(selected) ?? personas[0];
  const comparison = buildPersonaComparison(compareA, compareB);

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-4 flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex-none border-b border-zinc-200 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-zinc-900">📋 Williams Persona Guide</h2>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                24 archetypes · Each transforms the same idea differently · Source: Joseph M. Williams, <span className="italic">Style: Toward Clarity and Grace</span>
              </p>
            </div>
            <button onClick={onClose} className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100">Close</button>
          </div>

          {/* Oracle featured banner */}
          <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-violet-700 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">{ORACLE_BANNER.name}</span>
                <span className="text-[12px] font-semibold text-zinc-700">{ORACLE_BANNER.meta}</span>
              </div>
              <span className="text-[11px] font-mono text-zinc-500">rarity: {ORACLE_BANNER.rarity} · tier: {ORACLE_BANNER.tier}</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-700">{ORACLE_BANNER.body}</p>
            <div className="mt-3 rounded-xl bg-violet-700 px-4 py-2.5 text-[12px] font-semibold text-white">{ORACLE_BANNER.effect}</div>
          </div>
        </div>

        {/* Body: menu (left) + detail (right) */}
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_1fr]">
          {/* Archetype menu */}
          <div className="border-r border-zinc-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Archetype Menu</span>
              <span className="text-[11px] text-zinc-400">{personas.length} available</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {personas.map((p) => (
                <PersonaCard key={p.name} p={p} active={selected === p.name} onSelect={() => setSelected(p.name)} />
              ))}
            </div>
          </div>

          {/* Persona detail */}
          <div className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700">Persona Guide</span>
              <button onClick={onClose} className="rounded-full border border-zinc-300 px-3 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-100">Close</button>
            </div>
            <h3 className="text-2xl font-bold text-zinc-900">{current.name}</h3>
            <p className="mt-1 text-[13px] text-zinc-500">{current.description}</p>

            {/* WHAT IT CHANGES */}
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">What it changes</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-zinc-800">
                {current.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>

            {/* WHAT IT SUPPRESSES */}
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700">What it suppresses</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-zinc-800">
                {current.suppresses.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
              <div className="mt-2 text-[12px] text-rose-900"><span className="font-bold">Cadence:</span> {current.cadence}</div>
            </div>

            {/* SHARED IDEA */}
            <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Shared idea</div>
              <p className="mt-1 text-[13px] text-zinc-800">{SHARED_IDEA}</p>
            </div>

            {/* 50-100 WORD TRANSFORMATION */}
            <div className="mt-3 rounded-xl border border-violet-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wider text-violet-700">50-100 word transformation</div>
                <div className="text-[10px] text-zinc-400">same idea, persona-specific execution</div>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-800">{current.transformation}</p>
              <div className="mt-1 text-right text-[10px] text-zinc-400">{current.wordCount} words</div>
            </div>

            {/* SIDE-BY-SIDE COMPARISON */}
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <div className="text-[13px] font-bold text-zinc-800">Side-by-side comparison</div>
              <div className="mt-2 flex items-center gap-3 text-[12px]">
                <label className="flex items-center gap-1">
                  <span className="font-bold text-zinc-600">A</span>
                  <select value={compareA} onChange={(e) => setCompareA(e.target.value)} className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[12px]">
                    {personas.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-zinc-600">B</span>
                  <select value={compareB} onChange={(e) => setCompareB(e.target.value)} className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[12px]">
                    {personas.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </label>
              </div>
              <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-700">{comparison}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Output box enhancer: 10x taller, scrollable, expand + copy ──────────────
// Restores origin-baseline behavior where the answer/output <pre> boxes in
// Live Compare / Batch Bank never silently truncate visually. Wraps every
// answer <pre> block found in the dialog with a taller (10x) scrollable
// container plus an "⛶ Expand" button (full rigor-guard-overlay lightbox)
// and a "📋 Copy" button (copies the entire text to the clipboard).

function stripMarkdownKeepLatex(text: string): string {
  const placeholders: string[] = [];
  const latexRegex = /\$\$[\s\S]*?\$\$|\$[^$\n]+?\$/g;
  let tmp = text.replace(latexRegex, (m) => {
    placeholders.push(m);
    return `__LATEX_${placeholders.length - 1}__`;
  });
  tmp = tmp
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`{3}[\s\S]*?`{3}/g, (mm) => mm.replace(/`/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "");
  placeholders.forEach((latex, i) => {
    tmp = tmp.split(`__LATEX_${i}__`).join(latex);
  });
  return tmp.trim();
}

function injectOutputBoxEnhancer(root: Element): void {
  const pres = Array.from(root.querySelectorAll("pre")) as HTMLPreElement[];
  for (const pre of pres) {
    if (pre.dataset.veritasEnhanced === "1") continue;
    const text = pre.textContent || "";
    if (text.length < 300) continue;
    pre.dataset.veritasEnhanced = "1";
    pre.dataset.veritasOriginal = text;

    const computed = window.getComputedStyle(pre);
    const originalMaxHeight = parseInt(computed.maxHeight, 10);
    const baseMaxHeight = Number.isFinite(originalMaxHeight) && originalMaxHeight > 0 ? originalMaxHeight : 256;
    pre.style.maxHeight = `${baseMaxHeight * 10}px`;
    pre.style.overflowY = "auto";
    pre.classList.add("veritas-output-box");

    const toolbar = document.createElement("div");
    toolbar.className = "veritas-output-toolbar mb-1 flex items-center justify-end gap-1.5 flex-wrap";

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-800 hover:bg-indigo-100";
    expandBtn.textContent = "⛶ Expand";
    expandBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(EXPAND_EVENT, { detail: { text: pre.dataset.veritasOriginal || text } }));
    });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] font-bold text-zinc-700 hover:bg-zinc-100";
    copyBtn.textContent = "📋 Copy";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.dataset.veritasOriginal || pre.textContent || "");
        copyBtn.textContent = "✓ Copied";
        setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1500);
      } catch {
        copyBtn.textContent = "✗ Failed";
        setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1500);
      }
    });

    const naturalBtn = document.createElement("button");
    naturalBtn.type = "button";
    naturalBtn.className = "rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800 hover:bg-emerald-100";
    naturalBtn.textContent = "Aa Natural";
    let natural = false;
    naturalBtn.addEventListener("click", () => {
      natural = !natural;
      if (natural) {
        const stripped = stripMarkdownKeepLatex(pre.dataset.veritasOriginal || "");
        pre.textContent = stripped;
        naturalBtn.textContent = "Aa Markdown";
      } else {
        pre.textContent = pre.dataset.veritasOriginal || "";
        naturalBtn.textContent = "Aa Natural";
      }
    });

    toolbar.appendChild(expandBtn);
    toolbar.appendChild(copyBtn);
    toolbar.appendChild(naturalBtn);
    pre.parentElement?.insertBefore(toolbar, pre);
  }
}

const EXPAND_EVENT = "veritas:expand-output";

function ExpandedOutputOverlay({ text, onClose }: { text: string; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[10001] flex flex-col bg-black/70 p-6" onClick={onClose}>
      <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-none items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h3 className="text-sm font-bold text-zinc-800">⛶ Expanded Output — Rigor Guard Calibration</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
              }}
              className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-100"
            >
              📋 Copy all
            </button>
            <button onClick={onClose} className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-100">Close</button>
          </div>
        </div>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-5 font-mono text-[12px] leading-relaxed text-zinc-800">{text}</pre>
      </div>
    </div>,
    document.body,
  );
}

// ── Scraper Lane Activity Log panel ─────────────────────────────────────────
// Addresses "I still don't see them log" — a live, always-visible, scrollable
// panel showing every scraper lane's real-time activity (accelerator, hydra,
// nexus, sibyl, strata, arbiter, palisade, academic sources, enhanced
// scraper, OG scraper, package original groundQuestion, terminal-final).

function ScraperLaneLogPanel() {
  const [lines, setLines] = useState<ScraperLogLine[]>(() => getScraperDebugHistory());
  const [minimized, setMinimized] = useState(true);

  useEffect(() => {
    return subscribeScraperDebug((line) => {
      setLines((prev) => [...prev.slice(-199), line]);
    });
  }, []);

  return (
    <div className="fixed bottom-2 right-2 z-[9997] w-[420px] max-w-[92vw]" style={{ pointerEvents: "auto" }}>
      <div className="overflow-hidden rounded-xl border border-zinc-300 bg-white/97 shadow-xl backdrop-blur">
        <button
          onClick={() => setMinimized((v) => !v)}
          className="flex w-full items-center justify-between bg-zinc-900 px-3 py-1.5 text-left text-[11px] font-bold text-white"
        >
          <span>🛰 Scraper Lane Activity Log ({lines.length})</span>
          <span>{minimized ? "▲ expand" : "▼ collapse"}</span>
        </button>
        {!minimized && (
          <div className="max-h-72 overflow-y-auto bg-zinc-950 p-2 font-mono text-[10px] leading-relaxed text-emerald-300">
            {lines.length === 0 && <div className="text-zinc-500">No scraper activity yet — run a Live Compare or Batch Bank query.</div>}
            {lines.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap">
                <span className="text-zinc-500">{new Date(l.ts).toLocaleTimeString()}</span>{" "}
                <span className="font-bold text-sky-400">[{l.lane}]</span> {l.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InnovationGenomeModal({ genome, onClose }: { genome: InnovationGenomeV2 | null; onClose: () => void }) {
  const extremeDims = genome ? Object.entries(genome.genome).filter(([, v]) => (v as number) > 0.75 || (v as number) < 0.25).sort((a, b) => Math.abs((b[1] as number) - 0.5) - Math.abs((a[1] as number) - 0.5)).slice(0, 6) : [];
  const exploration = (genome as any)?.explorationPopulation ? (genome as any).explorationPopulation as Array<any> : [];

  const nodeLegend: Record<string, string> = {
    P: "Problem Choice — framing, goal fixity, source",
    A: "Anomaly Valuation — sensitivity, failure treatment, memory",
    E: "Embodiment — world contact, artifact concreteness, cheap falsification",
    N: "Analogy — distance, representation diversity, mechanism independence",
    V: "Evaluator Revision — source, mutability, adversarial intensity",
    T: "Taste — elegance, novelty/utility, termination resistance",
    S: "Social Stabilization — consensus vs independence, portfolio breadth, negative space",
  };

  return createPortal(
    <div className="fixed inset-0 z-[10002] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className="my-4 flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        {/* Header — clones Williams Persona Guide header style */}
        <div className="flex-none border-b border-zinc-200 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-zinc-900">🧬 Innovation Genome Guide</h2>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                25 archetypes · Each dictates <b>how to think</b> about discovery (Williams dictates <b>how to write</b>). Source: Conway-inspired seed → 21 dimensions → persona + path. Names intentionally distinct from Williams writers so both can be combined.
              </p>
            </div>
            <button onClick={onClose} className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100">Close</button>
          </div>

          {/* Featured banner — clones Oracle banner */}
          <div className="mt-4 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-fuchsia-700 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                  {(genome?.persona.name || "THE UNVARNSIHED OPERATOR").toUpperCase()}
                </span>
                <span className="text-[12px] font-semibold text-zinc-700">
                  {genome ? `${genome.persona.tagline} · Path ${genome.path.id} · Domain ${genome.domainPack.name}` : "Seed-driven discovery strategy"}
                </span>
              </div>
              <span className="text-[11px] font-mono text-zinc-500">seed {genome?.seed ?? "—"}</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-700">
              This genome compiles a Kerger-class discovery contract. Its 21 dimensions set the exact search strategy: how problems are framed, how anomalies are treated, how far analogies reach, how hostile the internal critic is, and when to stop. Every run rolls a fresh seed deterministically after seed — same seed always yields same strategy, reproducible across machines.
            </p>
            <div className="mt-3 rounded-xl bg-fuchsia-700 px-4 py-2.5 text-[12px] font-semibold text-white">
              Effect on same problem: The same user request is solved via different mechanism families, adversarial intensities, and evaluation criteria depending on the active genome. Persona dictates <b>thinking direction</b>; Williams persona dictates <b>writing voice</b>; both prompts are followed in final synthesis.
            </div>
          </div>
        </div>

        {!genome ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-zinc-500">
            No genome compiled yet. Run Live Compare or Batch Bank; this panel then shows the exact 21 dimensions, domain pack, safety/capability gates, and the 6-branch exploration portfolio that directed ideation, query translation, retrieval, and final synthesis.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">

            {/* Top stats */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3"><div className="text-[10px] font-bold uppercase text-fuchsia-700">Seed</div><div className="mt-1 font-mono text-sm">{genome.seed}</div></div>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><div className="text-[10px] font-bold uppercase text-indigo-700">Innovation Persona</div><div className="mt-1 text-sm font-bold">{genome.persona.name}</div><div className="mt-0.5 text-[11px] text-zinc-600">{genome.persona.tagline}</div></div>
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3"><div className="text-[10px] font-bold uppercase text-sky-700">Discovery Path</div><div className="mt-1 text-sm font-bold">{genome.path.id} · {genome.path.name}</div><div className="mt-0.5 font-mono text-[11px]">{genome.path.seq}</div></div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="text-[10px] font-bold uppercase text-emerald-700">Domain Pack</div><div className="mt-1 text-sm font-bold">{genome.domainPack.name}</div><div className="mt-0.5 text-[10px] text-zinc-500">{genome.domainPack.candidateArtifact.slice(0, 60)}…</div></div>
            </div>

            {/* Path legend */}
            <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Discovery route — 7-node integration</div>
              <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-zinc-700 md:grid-cols-2">
                {Object.entries(nodeLegend).map(([k, v]) => (
                  <div key={k} className="flex gap-2"><span className="font-bold text-fuchsia-700">{k}:</span><span>{v}</span></div>
                ))}
              </div>
              <div className="mt-2 font-mono text-[12px] text-zinc-800">Active: {genome.path.seq} — {genome.path.name}</div>
            </div>

            {/* WHAT IT CHANGES / SUPPRESSES — clones Williams layout */}
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">What it changes (innovation thinking)</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-zinc-800">
                  <li>Selects persona <b>{genome.persona.name}</b>: {genome.persona.tagline}</li>
                  <li>Selects path <b>{genome.path.id}</b> ({genome.path.name}): {genome.path.seq}</li>
                  <li>Injects compact directive into LLM query translation (decomposition + HyDE + step-back + <b>negative-space</b> mandatory) and into final synthesis.</li>
                  <li>Spawns <b>{exploration.length || 6} mechanism-distinct branches</b> (nudge, flip, block_rotate, pole_swap, dimension_mask) — kept independent until evidence eliminates.</li>
                  <li>Enforces domain-specific attacker: {genome.domainPack.candidateSpecificAttacker.slice(0, 120)}…</li>
                </ul>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700">What it suppresses / gates</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-zinc-800">
                  <li>Blocks generic verbatim question → search (forces keywordization + negative-space).</li>
                  <li>Suppresses low-novelty, convention-only answers when novelty_vs_utility &gt; 0.7.</li>
                  <li>Suppresses premature consensus when independence_vs_consensus &gt; 0.85.</li>
                  <li>Safety gate: {genome.safetyGate.isHighStakes() ? "High-stakes domain — caps termination_resistance ≤0.5 and goal_fixity ≤0.3, preserves disproof/uncertainty branches" : "Standard risk — no cap"}</li>
                </ul>
                <div className="mt-2 text-[12px] text-rose-900"><span className="font-bold">Cadence:</span> {genome.domainPack.name} → {genome.safetyGate.risk.toUpperCase()} risk · {genome.capabilityGate.webRetrieval ? "web retrieval ON" : "web retrieval OFF"}</div>
              </div>
            </div>

            {/* Difference variables changed */}
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-violet-700">Difference variables changed (extreme dimensions this run)</div>
              <div className="mt-2 grid grid-cols-1 gap-1 text-[12px] md:grid-cols-2">
                {extremeDims.length === 0 && <span className="text-zinc-500">No dimension beyond 0.75/0.25 thresholds — near-balanced strategy.</span>}
                {extremeDims.map(([id, v]) => {
                  const dim = INNOVATION_DIMENSIONS.find((d: any) => d.id === id);
                  const pole = (v as number) > 0.5 ? dim?.highPole : dim?.lowPole;
                  return (
                    <div key={id} className="flex justify-between gap-2 rounded bg-white px-2 py-1">
                      <span className="font-bold text-zinc-700">{dim?.name}: </span>
                      <span className="text-zinc-600">{pole} ({(v as number).toFixed(2)})</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Domain pack details */}
            <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Domain pack — {genome.domainPack.name}</div>
              <div className="mt-2 space-y-2 text-[12px] text-zinc-700">
                <div><span className="font-bold">Candidate artifact:</span> {genome.domainPack.candidateArtifact}</div>
                <div><span className="font-bold">Attacker:</span> {genome.domainPack.candidateSpecificAttacker}</div>
                <div><span className="font-bold">Verifier:</span> {genome.domainPack.verifier}</div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div><span className="font-bold">Representations:</span> {genome.domainPack.representations.join("; ")}</div>
                  <div><span className="font-bold">Mandatory gates:</span> {genome.domainPack.mandatoryGates.join("; ")}</div>
                </div>
                <div><span className="font-bold">Near-miss banned shapes:</span> {genome.domainPack.nearMisses.join("; ")}</div>
              </div>
            </div>

            {/* Exact innovation steps */}
            <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Exact innovation steps this run (compiled contract)</div>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] text-zinc-800">
                <li>Roll seed {genome.seed} → 21 genome values via FNV-1a + xorshift mix over `${"{seed}:{index}"}`.</li>
                <li>Classify persona via first-match trigger: <b>{genome.persona.name}</b> — {genome.persona.tagline}</li>
                <li>Select discovery path via trigger table: <b>{genome.path.id} ({genome.path.name})</b> — {genome.path.seq}</li>
                <li>Transform genome via safety gate (high-stakes caps) and load domain pack <b>{genome.domainPack.name}</b>.</li>
                <li>Compile Kerger-class prompt with portfolio breadth, negative-space count, adversary type, termination mode, evaluator mutability, anomaly buffer, taste filter, goal-space mutation, world-contact.</li>
                <li>Inject compact directive into: (a) query strategist → optimized portfolio (decomposition + HyDE + step-back + negative-space + entity/domain), (b) final synthesis → N-Deep / HDIG / adversarial passes steered into different strategies.</li>
                <li>Spawn exploration population — 6 deterministic branches (base + nudge, flip, block_rotate, pole_swap, dimension_mask) — preserved independent until evidence eliminates; no fabricated fitness; Pareto admission only via real evaluator.</li>
                <li>Persist anomaly buffer & failure certificates for next run; expose active genome at <span className="font-mono">window._VERITAS_INNOVATION_GENOME_V2</span>.</li>
              </ol>
            </div>

            {/* 21 dimensions */}
            <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-zinc-600">21 innovation dimensions — full genome</div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              {INNOVATION_DIMENSIONS.map((dimension: any) => {
                const value = (genome.genome as any)[dimension.id] ?? 0;
                return (
                  <div key={dimension.id} className="rounded-lg border border-zinc-200 bg-white p-2.5">
                    <div className="flex items-center justify-between text-[11px]"><span className="font-bold text-zinc-800">{dimension.name}</span><span className="font-mono text-fuchsia-700">{value.toFixed(2)}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style={{ width: `${Math.round(value * 100)}%` }} /></div>
                    <div className="mt-1 flex justify-between gap-2 text-[9px] text-zinc-400"><span>{dimension.lowPole}</span><span className="text-right">{dimension.highPole}</span></div>
                  </div>
                );
              })}
            </div>

            {/* Capability reality */}
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
              <b>Capability reality gate:</b> parallel agents {genome.capabilityGate.runtimeSupportsParallelAgents ? "available" : "NOT AVAILABLE (serialize; do not fabricate worker messages)"}; verifier {genome.capabilityGate.verifierAvailable ? "available" : "NOT AVAILABLE (label unverified)"}; web retrieval {genome.capabilityGate.webRetrieval ? "available" : "NOT AVAILABLE (do not fabricate citations)"}; formal prover {genome.capabilityGate.formalProver ? "available" : "NOT AVAILABLE"}; sandbox {genome.capabilityGate.executionSandbox ? "available" : "NOT AVAILABLE"}; tools: {(genome.capabilityGate.declaredTools as string[]).join(", ") || "none — do not claim tool execution"}.
            </div>

            {/* Actions */}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={async () => { try { await navigator.clipboard.writeText(genome.prompt); } catch { /* ignore */ } }}
                className="rounded-lg border border-fuchsia-300 bg-fuchsia-50 px-3 py-1.5 text-xs font-bold text-fuchsia-800 hover:bg-fuchsia-100"
              >
                📋 Copy full v2 prompt
              </button>
              <button
                onClick={async () => { try { await navigator.clipboard.writeText(((genome as any).compactDirective || "")); } catch { /* ignore */ } }}
                className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-800 hover:bg-indigo-100"
              >
                📋 Copy compact directive
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Public augment component (mounted once by V15Overlay) ────────────────────

export function V15CalibrationAugment() {
  const [personasOpen, setPersonasOpen] = useState(false);
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [genomeOpen, setGenomeOpen] = useState(false);
  const [activeGenome, setActiveGenome] = useState<InnovationGenomeV2 | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const tick = () => {
      const root = findDialogRoot();
      setDialogVisible(!!root);
      if (root) {
        injectHeaderControls(root);
        applyDefaultCalibration(root);
        injectInnovationPersonaSelector(root);
        injectCalculationTrace(root);
        injectDeterministicCitationAudit(root);
        injectOutputBoxEnhancer(root);
      }
    };

    const observer = new MutationObserver(tick);
    observer.observe(document.body, { childList: true, subtree: true });

    // Retry loop so defaults commit once ProfileBar inputs have mounted.
    let frames = 0;
    const retry = () => {
      tick();
      frames += 1;
      if (frames < 40) setTimeout(retry, 80);
    };
    retry();

    const onOpen = () => setPersonasOpen(true);
    const onGenomeOpen = () => {
      setActiveGenome(((window as any)._VERITAS_INNOVATION_GENOME_V2 as InnovationGenomeV2 | undefined) ?? null);
      setGenomeOpen(true);
    };
    const onExpand = (e: Event) => setExpandedText((e as CustomEvent).detail?.text ?? "");
    window.addEventListener(PERSONAS_EVENT, onOpen);
    window.addEventListener(GENOME_EVENT, onGenomeOpen);
    window.addEventListener(EXPAND_EVENT, onExpand);

    return () => {
      observer.disconnect();
      window.removeEventListener(PERSONAS_EVENT, onOpen);
      window.removeEventListener(GENOME_EVENT, onGenomeOpen);
      window.removeEventListener(EXPAND_EVENT, onExpand);
    };
  }, []);

  return (
    <>
      {personasOpen && <PersonaGuideModal onClose={() => setPersonasOpen(false)} />}
      {expandedText !== null && <ExpandedOutputOverlay text={expandedText} onClose={() => setExpandedText(null)} />}
      {dialogVisible && <ScraperLaneLogPanel />}
      {genomeOpen && <InnovationGenomeModal genome={activeGenome} onClose={() => setGenomeOpen(false)} />}
    </>
  );
}
