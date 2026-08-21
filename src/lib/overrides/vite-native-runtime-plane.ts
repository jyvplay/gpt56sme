/**
 * vite-native-runtime-plane.ts — L2: Telemetry & Event Loop Governor
 * Monitor Node.js event loop lag and memory usage to shed load during high stress.
 * Zero-dependency: node:perf_hooks, node:diagnostics_channel only.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import diagnosticsChannel from 'node:diagnostics_channel';

export type PressureLevel = 'ok' | 'warm' | 'hot';

export interface RuntimeEvent {
  kind: string;
  ts: number;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface RuntimeStats {
  pressure: PressureLevel;
  eventLoopMeanMs: number;
  eventLoopMaxMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  recentEventCount: number;
  uptime: number;
}

// ── Event Loop Governor ───────────────────────────────────────────────────
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

// Reset timer every 60s — MUST .unref() to avoid zombie process
const lagResetTimer = setInterval(() => {
  try { lag.reset(); } catch {}
}, 60_000);
(lagResetTimer as any).unref?.();

// ── Rolling Event Buffer — O(1) amortized ────────────────────────────────
// Hand-trace: After 505 emitRuntimeEvent calls:
//   recentEvents.length reaches 501 after push
//   splice(0, 501 - 500) = splice(0, 1)
//   start=0, deleteCount=1
//   Result: exactly MAX_EVENTS=500 elements remain
const recentEvents: RuntimeEvent[] = [];
const MAX_EVENTS = 500;

// Diagnostics channel for inter-module pub/sub
const channel = diagnosticsChannel.channel('vite-native-scraper.runtime');

// ── Pressure Calculation (exact thresholds) ───────────────────────────────
export function getRuntimeStats(): RuntimeStats {
  // Guard against NaN/Infinity if lag not yet ticked
  const meanMs = Number((lag as any).mean ?? 0) / 1e6 || 0;
  const maxMs = Number((lag as any).max ?? 0) / 1e6 || 0;
  const mem = process.memoryUsage();

  // Hand-trace: rss=1073741825 (1GB+1byte)
  //   maxMs > 250 = depends on lag
  //   mem.rss > 1_073_741_824 = true (1073741825 > 1073741824)
  //   => pressure = 'hot'
  const pressure: PressureLevel =
    (maxMs > 250 || mem.rss > 1_073_741_824) ? 'hot' :
    (maxMs > 80  || mem.rss > 536_870_912)   ? 'warm' :
    'ok';

  return {
    pressure,
    eventLoopMeanMs: Math.round(meanMs * 100) / 100,
    eventLoopMaxMs: Math.round(maxMs * 100) / 100,
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    recentEventCount: recentEvents.length,
    uptime: Math.floor(process.uptime()),
  };
}

export function getPressure(): PressureLevel {
  return getRuntimeStats().pressure;
}

// ── Load shedding decisions ───────────────────────────────────────────────
export function shouldDeferBackgroundWork(kind: 'prefetch' | 'rag' | 'cleanup' | string): boolean {
  const { pressure } = getRuntimeStats();
  if (pressure === 'hot') return true;
  if (pressure === 'warm' && (kind === 'prefetch' || kind === 'rag')) return true;
  return false;
}

// ── Event emission ────────────────────────────────────────────────────────
export function emitRuntimeEvent(ev: RuntimeEvent): void {
  recentEvents.push(ev);
  // MUST use splice, NOT shift() in a loop — avoids O(N) re-indexing
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_EVENTS);
  }
  // Publish to diagnostics channel if subscribers exist
  if (channel.hasSubscribers) channel.publish(ev);
}

export function getRecentEvents(limit = 100): RuntimeEvent[] {
  return recentEvents.slice(-Math.min(limit, MAX_EVENTS));
}

export function clearEvents(): void {
  recentEvents.splice(0, recentEvents.length);
}
