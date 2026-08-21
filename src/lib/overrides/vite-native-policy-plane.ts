/**
 * vite-native-policy-plane.ts — L2: Dynamic Feature Flags & Overrides
 * Dynamic feature flagging backed by SQLite, allowing runtime degradation.
 * Zero-dependency: node:* only.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ghost load for SQLite
let DatabaseSync: any = null;
let dbAvailable = false;
try {
  const anyProc: any = globalThis.process as any;
  if (anyProc && typeof anyProc.getBuiltinModule === 'function') {
    const mod = anyProc.getBuiltinModule('node:sqlite');
    if (mod?.DatabaseSync) { DatabaseSync = mod.DatabaseSync; dbAvailable = true; }
  }
} catch {}
if (!dbAvailable) {
  try {
    const req = createRequire(import.meta.url);
    ({ DatabaseSync } = req('node:sqlite'));
    dbAvailable = !!DatabaseSync;
  } catch { dbAvailable = false; }
}

const AUDIT_DIR = join(__dirname, '..', '..', '..', 'src', 'audit');
const DB_PATH = join(AUDIT_DIR, 'knowledge.db');

let db: any = null;

function ensureDb(): boolean {
  if (db) return true;
  if (!dbAvailable) return false;
  try {
    if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA busy_timeout = 3000;');
    db.exec(`
      CREATE TABLE IF NOT EXISTS policy_flags (
        name TEXT PRIMARY KEY,
        valueJson TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
    `);
    return true;
  } catch (e: any) {
    console.warn('[policy-plane] DB init failed:', e?.message);
    return false;
  }
}

export interface PolicyState {
  useDdg: boolean;
  useBing: boolean;
  useYahoo: boolean;
  useMojeek: boolean;
  enableSSE: boolean;
  enablePrefetch: boolean;
  enableAutoRag: boolean;
  enableRateLimit: boolean;
  enableCircuitBreaker: boolean;
  maxResultsPerEngine: number;
  searchTimeoutMs: number;
}

export const DEFAULT_POLICY: PolicyState = {
  useDdg: true,
  useBing: true,
  useYahoo: true,
  useMojeek: true,
  enableSSE: true,
  enablePrefetch: true,
  enableAutoRag: true,
  enableRateLimit: true,
  enableCircuitBreaker: true,
  maxResultsPerEngine: 5,
  searchTimeoutMs: 8000,
};

export function getPolicyOverrides(): Partial<PolicyState> {
  if (!ensureDb()) return {};
  try {
    const rows = db.prepare(`SELECT name, valueJson FROM policy_flags`).all() as Array<{name: string; valueJson: string}>;
    const result: Partial<PolicyState> = {};
    for (const row of rows) {
      try {
        // Wrap JSON.parse — corrupted rows must be ignored, not thrown
        const val = JSON.parse(row.valueJson);
        (result as any)[row.name] = val;
      } catch {
        // Silently ignore corrupted DB rows
      }
    }
    return result;
  } catch { return {}; }
}

// UPSERT implementation for SQLite
export function setPolicyOverride(name: keyof PolicyState | string, value: unknown): boolean {
  if (!ensureDb()) return false;
  try {
    // Hand-trace: calling twice with same name — second call hits ON CONFLICT
    // First: INSERT succeeds, row created with name, valueJson, ts
    // Second: INSERT fails ON CONFLICT(name), DO UPDATE SET fires instead
    // Both calls result in the same row with updated valueJson and ts
    const stmt = db.prepare(`
      INSERT INTO policy_flags (name, valueJson, ts)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET valueJson = excluded.valueJson, ts = excluded.ts
    `);
    stmt.run(name, JSON.stringify(value), Date.now());
    return true;
  } catch { return false; }
}

export function deletePolicyOverride(name: string): boolean {
  if (!ensureDb()) return false;
  try {
    db.prepare(`DELETE FROM policy_flags WHERE name = ?`).run(name);
    return true;
  } catch { return false; }
}

// ── Policy Evaluation ─────────────────────────────────────────────────────
// Hand-trace: DB override sets enablePrefetch = true, but ctx.pressure = 'hot'
// Step 1: merged = {...DEFAULT_POLICY, ...overrides} => enablePrefetch = true
// Step 2: pressure === 'hot' => forcefully set enablePrefetch = false, enableSSE = false, enableAutoRag = false
// Final value of enablePrefetch = FALSE (hot pressure wins, ignores DB override)
export function evaluatePolicy(ctx: { pressure: 'ok' | 'warm' | 'hot' }): PolicyState {
  const overrides = getPolicyOverrides();
  const merged: PolicyState = { ...DEFAULT_POLICY, ...overrides };

  // Hot pressure: force shed non-critical features — DB overrides are IGNORED
  if (ctx.pressure === 'hot') {
    merged.enablePrefetch = false;
    merged.enableSSE = false;
    merged.enableAutoRag = false;
  }

  // Total engine blackout prevention: force useDdg if all four engines disabled
  if (!merged.useDdg && !merged.useBing && !merged.useYahoo && !merged.useMojeek) {
    merged.useDdg = true;
  }

  return merged;
}

// ── Self-test remediation ─────────────────────────────────────────────────
export interface SelfTestResult {
  passed: boolean;
  failures: string[];
}

export function applySelfTestRemediation(result: SelfTestResult): void {
  for (const failure of result.failures) {
    if (failure.includes('parser.bing.href.capture')) {
      console.warn('[policy-plane] Bing parser failure detected — disabling Bing engine');
      setPolicyOverride('useBing', false);
    }
    if (failure.includes('parser.ddg.href.capture')) {
      console.warn('[policy-plane] DDG parser failure detected — disabling DDG engine');
      setPolicyOverride('useDdg', false);
    }
    if (failure.includes('parser.yahoo.href.capture')) {
      setPolicyOverride('useYahoo', false);
    }
    if (failure.includes('parser.mojeek.href.capture')) {
      setPolicyOverride('useMojeek', false);
    }
  }
}

export function getAllPolicyFlags(): Array<{ name: string; value: unknown; ts: number }> {
  if (!ensureDb()) return [];
  try {
    const rows = db.prepare(`SELECT name, valueJson, ts FROM policy_flags ORDER BY name`).all() as Array<{name:string;valueJson:string;ts:number}>;
    return rows.map(r => {
      try { return { name: r.name, value: JSON.parse(r.valueJson), ts: r.ts }; }
      catch { return { name: r.name, value: null, ts: r.ts }; }
    });
  } catch { return []; }
}
