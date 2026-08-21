/**
 * Persistent OMEGA-aware SLOOP runner.
 * Fixes the package runner's lossy generic mapping and page-based section drop.
 */
export * from "./sloop-runner.base";
import { runSloopReport as baseRunSloopReport, type SloopRunResult } from "./sloop-runner.base";
import { generateSynthesizedResponse, type GenerateParams } from "@/lib/models";
import type { PipelineTrace } from "@/lib/pipeline";
import { intelligenceOf } from "@/lib/model-intelligence";
import { settleHeap } from "@/lib/memory-governor";
import { buildAdaptiveTemplateContract, getOmegaTemplate } from "./omega-templates";

type Opts = {
  query: string;
  baseParams: GenerateParams;
  sources: { title: string; url: string; content: string }[];
  templateId?: string;
  pages: number;
  onTrace?: (t: PipelineTrace) => void;
  onDebug?: (msg: string) => void;
};

const NATIVE_THRESHOLD = 85;
const NATIVE_PAGE_CEILING = 8;

function sourceSlice(sources: Opts["sources"], sectionIndex = 0, max = 10) {
  if (!sources.length) return [];
  const start = (sectionIndex * 3) % sources.length;
  return [...sources.slice(start), ...sources.slice(0, start)].slice(0, max).map(s => ({ ...s, content: (s.content || "").slice(0, 900) }));
}

function sectionCoverage(text: string, headings: string[]) {
  const lower = text.toLowerCase();
  const hits = headings.filter(h => lower.includes(h.toLowerCase())).length;
  const empty = headings.filter(h => {
    const at = lower.indexOf(h.toLowerCase());
    if (at < 0) return false;
    const next = headings.map(x => lower.indexOf(x.toLowerCase(), at + h.length)).filter(x => x > at).sort((a, b) => a - b)[0] ?? text.length;
    return text.slice(at + h.length, next).replace(/\s/g, "").length < 40;
  });
  return { hits, empty };
}

async function sectioned(opts: Opts, contract: string): Promise<SloopRunResult> {
  const t = getOmegaTemplate(opts.templateId)!;
  const trace: PipelineTrace[] = [];
  const summaries: string[] = [];
  const targetWords = Math.max(700, opts.pages * 550);
  const mainCount = Math.max(1, t.sections.filter(s => !/^§A/.test(s.id)).length);
  const wordsPer = Math.max(90, Math.floor(targetWords / mainCount));
  let full = "";
  for (let i = 0; i < t.sections.length; i++) {
    const s = t.sections[i];
    const prompt = [
      `Write ONLY the "${s.title}" section of a ${t.id} report.`,
      `Section contract: ${s.hint}`,
      `Target: ${/^§A/.test(s.id) ? "a compact evidence/method appendix" : `about ${wordsPer} words`}.`,
      "Use the exact heading shown below. No other report sections. No placeholders, invented evidence, fake interviews, fake calculations, or bare headings.",
      `Exact heading: ## ${s.title}`,
      contract,
      summaries.length ? `Prior-section continuity summaries:\n${summaries.slice(-3).join("\n")}` : "",
      `USER ASK: ${opts.query}`,
    ].filter(Boolean).join("\n\n");
    opts.onDebug?.(`[SLOOP OMEGA sectioned] ${i + 1}/${t.sections.length}: ${s.title}`);
    const raw = await generateSynthesizedResponse({ ...opts.baseParams, userMessage: prompt, retrievedWebData: sourceSlice(opts.sources, i), conversationHistory: [] });
    const cleaned = raw.trim().replace(new RegExp(`^#{1,6}\\s*${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "").trim();
    const block = `## ${s.title}\n\n${cleaned || "[DATA GAP] Section generation returned no substantive content."}`;
    full += (full ? "\n\n" : "") + block;
    summaries.push(`${s.title}: ${cleaned.slice(0, 220).replace(/\s+/g, " ")}`);
    const tr: PipelineTrace = { stage: 4 + (i + 1) / 100, label: `SLOOP OMEGA section: ${s.title}`, ts: Date.now(), ok: cleaned.length >= 40, data: { chars: cleaned.length, preview: cleaned.slice(0, 160) } };
    trace.push(tr); opts.onTrace?.(tr);
    await settleHeap(12);
  }
  return { finalText: full, trace, calls: t.sections.length, mode: "sectioned" };
}

export async function runSloopReport(opts: Opts): Promise<SloopRunResult> {
  const template = getOmegaTemplate(opts.templateId);
  if (!template) return baseRunSloopReport(opts);
  const contract = buildAdaptiveTemplateContract({ templateId: opts.templateId, targetPages: opts.pages, evidenceAvailable: opts.sources.length > 0 });
  const native = intelligenceOf(opts.baseParams.model) >= NATIVE_THRESHOLD && opts.pages <= NATIVE_PAGE_CEILING;
  if (!native) return sectioned(opts, contract);

  const headings = template.sections.map(s => s.title);
  const wordTarget = Math.max(700, opts.pages * 550);
  opts.onDebug?.(`[SLOOP OMEGA native] ${template.id}: ALL ${headings.length} sections, ~${wordTarget} words`);
  const raw = await generateSynthesizedResponse({
    ...opts.baseParams,
    userMessage: `${contract}\n\nWrite the complete report now. Include ALL contracted sections in order, fully written. USER ASK: ${opts.query}`,
    retrievedWebData: sourceSlice(opts.sources, 0, 16),
    conversationHistory: [],
  });
  const text = raw.trim();
  const coverage = sectionCoverage(text, headings);
  const minChars = Math.max(1200, opts.pages * 1300);
  if (coverage.hits < headings.length || coverage.empty.length || text.length < minChars) {
    opts.onDebug?.(`[SLOOP OMEGA native] incomplete (${coverage.hits}/${headings.length}, empty=${coverage.empty.join(",") || "none"}, chars=${text.length}) — sectioned fallback`);
    const fallback = await sectioned(opts, contract);
    return { ...fallback, calls: fallback.calls + 1 };
  }
  const tr: PipelineTrace = { stage: 4, label: `SLOOP OMEGA native: ${headings.length} sections`, ts: Date.now(), ok: true, data: { chars: text.length, sections: headings.length } };
  opts.onTrace?.(tr);
  return { finalText: text, trace: [tr], calls: 1, mode: "native" };
}