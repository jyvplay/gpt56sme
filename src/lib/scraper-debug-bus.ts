/**
 * scraper-debug-bus.ts
 * ============================================================================
 * Lightweight, additive, dependency-free pub/sub bus so every scraper lane
 * (accelerator, hydra, nexus, sibyl, strata, palisade, arbiter, academic
 * sources, enhanced scraper, OG scraper, package original groundQuestion,
 * VNext terminal/portfolio stack) can emit a visible, timestamped log line
 * that the V15 Rigor Guard UI renders live AND that always echoes to the
 * browser console via console.log — closing the "I still don't see them
 * log" gap. Purely additive; nothing existing is modified.
 * ============================================================================ */

export interface ScraperLogLine {
  ts: number;
  lane: string;
  message: string;
}

const listeners = new Set<(line: ScraperLogLine) => void>();
const HISTORY_MAX = 300;
let history: ScraperLogLine[] = [];

export function emitScraperDebug(lane: string, message: string): void {
  const line: ScraperLogLine = { ts: Date.now(), lane, message };
  history.push(line);
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  try {
    // eslint-disable-next-line no-console
    console.log(`[scraper:${lane}] ${message}`);
  } catch {
    /* console unavailable */
  }
  for (const cb of listeners) {
    try {
      cb(line);
    } catch {
      /* fail-open per subscriber */
    }
  }
}

export function subscribeScraperDebug(cb: (line: ScraperLogLine) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getScraperDebugHistory(): ScraperLogLine[] {
  return history.slice();
}

export function clearScraperDebugHistory(): void {
  history = [];
}
