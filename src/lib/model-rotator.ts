import { geminiGenerate, type GenerateResult } from "./v15-gemini";
import { GEMINI_ELO_ROSTER, getModelEloInfo, type ModelEloRating } from "./elo-registry";
import { tryAcquire, recordResult, snapshotUsage } from "./v15-rate-limiter";
import { getAllowedModels } from "./v15-state";

export const ROTATION_POOL = [...GEMINI_ELO_ROSTER];

export function getActiveRotationPool(): string[] {
  try {
    const allowed = getAllowedModels();
    const filtered = allowed?.length ? GEMINI_ELO_ROSTER.filter(m => allowed.includes(m)) : [];
    return filtered.length ? filtered : ROTATION_POOL;
  } catch { return ROTATION_POOL; }
}

export interface RotationAttempt { model: string; elo: number; tier?: string; ok: boolean; latencyMs: number; error?: string }
export interface RotatedGenerateResult extends GenerateResult { modelUsed: string; eloInfo: ModelEloRating; attempts: RotationAttempt[] }

const usedThisRound = new Set<string>();
function shuffle<T>(xs: T[]): T[] { const out = [...xs]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }

function roundRobinOrder(pool: string[], preferred?: string) {
  if (usedThisRound.size >= pool.length) usedThisRound.clear();
  const unused = pool.filter(m => !usedThisRound.has(m));
  const used = pool.filter(m => usedThisRound.has(m));
  if (preferred && unused.includes(preferred)) return [preferred, ...shuffle(unused.filter(m => m !== preferred)), ...shuffle(used)];
  return [...shuffle(unused), ...shuffle(used)];
}

export async function generateWithRotation(opts: { apiKey: string; prompt: string; systemInstruction?: string; preferredModel?: string; maxOutputTokens?: number; pool?: string[] }): Promise<RotatedGenerateResult> {
  const pool = opts.pool ?? getActiveRotationPool();
  const order = roundRobinOrder(pool, opts.preferredModel);
  const attempts: RotationAttempt[] = [];
  const webHint = "\n\nIf this model has native web-search/tool grounding available, use it to verify time-sensitive factual claims; otherwise rely only on provided evidence and state uncertainty.";
  for (const model of order) {
    const eloInfo = getModelEloInfo(model);
    const acquired = await tryAcquire(model, true);
    if (!acquired) {
      const s = snapshotUsage(model);
      attempts.push({ model, elo: eloInfo.elo, tier: eloInfo.tier, ok: false, latencyMs: 0, error: `rate-limit skip (RPM ${s.rpmUsed}/${s.rpmMax}, RPD ${s.rpdUsed}/${s.rpdMax})` });
      continue;
    }
    const res = await geminiGenerate({ apiKey: opts.apiKey, model, prompt: opts.prompt + webHint, systemInstruction: opts.systemInstruction, maxOutputTokens: opts.maxOutputTokens });
    recordResult(model, res.ok);
    attempts.push({ model, elo: eloInfo.elo, tier: eloInfo.tier, ok: res.ok, latencyMs: res.latencyMs, error: res.error });
    if (res.ok && res.text.trim()) { usedThisRound.add(model); return { ...res, modelUsed: model, eloInfo, attempts }; }
    await new Promise(r => setTimeout(r, 150));
  }
  const fallback = order[0] ?? "gemini-3.5-flash";
  return { text: "", ok: false, error: `All models failed (${attempts.map(a => `${a.model}: ${a.error}`).join("; ")})`, latencyMs: attempts.reduce((a, b) => a + b.latencyMs, 0), modelUsed: fallback, eloInfo: getModelEloInfo(fallback), attempts };
}

export interface JudgeResult { model: string; score: number; note?: string }
export interface ParallelJudgeResult { judgments: JudgeResult[]; attempts: RotationAttempt[] }

export async function parallelJudgeRotation(opts: { apiKey: string; question: string; answer: string; judgeModels?: string[] }): Promise<ParallelJudgeResult> {
  const models = opts.judgeModels ?? getActiveRotationPool();
  const attempts: RotationAttempt[] = [];
  const judgments: JudgeResult[] = [];
  await Promise.all(models.map(async model => {
    const prompt = `Score the answer 0-10. Penalize truncation, prompt leakage, hallucinated citations, missing scope, and missing computations. Return JSON only: {"score": number, "note": "short rationale"}\n\nQUESTION:\n${opts.question}\n\nANSWER:\n${opts.answer.slice(0, 8000)}`;
    const res = await generateWithRotation({ apiKey: opts.apiKey, prompt, preferredModel: model, pool: [model], maxOutputTokens: 350 });
    attempts.push(...res.attempts);
    if (!res.ok) return;
    try {
      const m = res.text.match(/\{[\s\S]*\}/);
      const j = JSON.parse(m ? m[0] : res.text);
      judgments.push({ model: res.modelUsed, score: Math.max(0, Math.min(10, Number(j.score) || 0)), note: String(j.note ?? "") });
    } catch {
      const truncated = /\b(to|the|of|is|and|a|an)\s*$/i.test(opts.answer.trim()) || opts.answer.trim().length < 160;
      judgments.push({ model: res.modelUsed, score: truncated ? 1 : 7, note: "Deterministic judge fallback; model JSON was malformed." });
    }
  }));
  return { judgments, attempts };
}