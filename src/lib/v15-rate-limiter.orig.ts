export interface ModelLimit {
  rpm: number;
  rpd: number;
  tpm?: number;
  category?: string;
}

export const MODEL_LIMITS: Record<string, ModelLimit> = {
  "gemini-3-flash-preview": { rpm: 5, rpd: 7, tpm: 26370, category: "Text" },
  "gemini-3.5-flash": { rpm: 3, rpd: 5, tpm: 4230, category: "Text" },
  "gemini-2.5-flash": { rpm: 1, rpd: 1, tpm: 2000, category: "Text" },
  "gemini-3.1-flash-lite": { rpm: 2, rpd: 4, tpm: 1590, category: "Text" },
  "gemini-2.5-flash-lite": { rpm: 1, rpd: 2, tpm: 2960, category: "Text" },
  "gemma-4-31b-it": { rpm: 1, rpd: 1, tpm: 846, category: "Other" },
  "gemma-4-26b-it": { rpm: 0, rpd: 0, tpm: 0, category: "Other" },
  "gemma-3-27b-it": { rpm: 5, rpd: 20, tpm: 30000, category: "Other" },
};

const DEFAULT_LIMIT: ModelLimit = { rpm: 2, rpd: 10, tpm: 10000 };

interface UsageBook { minute: number[]; day: number[]; inflight: number }
const usage = new Map<string, UsageBook>();

function book(model: string): UsageBook {
  let u = usage.get(model);
  if (!u) { u = { minute: [], day: [], inflight: 0 }; usage.set(model, u); }
  return u;
}

function prune(u: UsageBook, now: number) {
  u.minute = u.minute.filter(t => now - t < 60000);
  u.day = u.day.filter(t => now - t < 86400000);
}

export function getLimit(model: string): ModelLimit { return MODEL_LIMITS[model] ?? DEFAULT_LIMIT; }

export interface UsageSnapshot {
  model: string;
  rpmUsed: number; rpmMax: number; rpmRemaining: number;
  rpdUsed: number; rpdMax: number; rpdRemaining: number;
  inflight: number; msUntilNextSlot: number; throttled: boolean;
  warning?: string;
}

export function snapshotUsage(model: string): UsageSnapshot {
  const now = Date.now();
  const u = book(model);
  prune(u, now);
  const lim = getLimit(model);
  const rpmUsed = u.minute.length + u.inflight;
  const rpdUsed = u.day.length + u.inflight;
  const rpmRemaining = Math.max(0, lim.rpm - rpmUsed);
  const rpdRemaining = Math.max(0, lim.rpd - rpdUsed);
  const throttled = rpmRemaining <= 0 || rpdRemaining <= 0;
  const oldest = u.minute.length ? Math.min(...u.minute) : now;
  const msUntilNextSlot = rpmRemaining <= 0 ? Math.max(0, 60000 - (now - oldest)) : 0;
  const nearRpm = lim.rpm > 0 && rpmRemaining <= Math.max(1, Math.ceil(lim.rpm * 0.1));
  const nearRpd = lim.rpd > 0 && rpdRemaining < 2;
  const warning = nearRpm || nearRpd
    ? `Rate warning: ${model} RPM ${rpmUsed}/${lim.rpm}, RPD ${rpdUsed}/${lim.rpd}`
    : undefined;
  return { model, rpmUsed, rpmMax: lim.rpm, rpmRemaining, rpdUsed, rpdMax: lim.rpd, rpdRemaining, inflight: u.inflight, msUntilNextSlot, throttled, warning };
}

export function snapshotAllUsage(): UsageSnapshot[] { return Object.keys(MODEL_LIMITS).map(snapshotUsage); }

export function getRateLimitWarnings() { return snapshotAllUsage().filter(s => s.warning); }

export async function tryAcquire(model: string, waitIfShort = true): Promise<boolean> {
  let snap = snapshotUsage(model);
  if (!snap.throttled) { book(model).inflight++; return true; }
  if (waitIfShort && snap.rpdRemaining > 0 && snap.msUntilNextSlot > 0 && snap.msUntilNextSlot <= 3000) {
    await new Promise(r => setTimeout(r, snap.msUntilNextSlot + 50));
    snap = snapshotUsage(model);
    if (!snap.throttled) { book(model).inflight++; return true; }
  }
  return false;
}

export function recordResult(model: string, ok: boolean): void {
  const u = book(model);
  u.inflight = Math.max(0, u.inflight - 1);
  if (ok) { const now = Date.now(); u.minute.push(now); u.day.push(now); prune(u, now); }
}

export function pickLeastLoaded(pool: string[]): string | null {
  const free = pool.map(snapshotUsage).filter(s => !s.throttled);
  if (!free.length) return null;
  free.sort((a, b) => (b.rpmRemaining / Math.max(1, b.rpmMax) + b.rpdRemaining / Math.max(1, b.rpdMax)) - (a.rpmRemaining / Math.max(1, a.rpmMax) + a.rpdRemaining / Math.max(1, a.rpdMax)));
  return free[0].model;
}