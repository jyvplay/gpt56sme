/**
 * vite-native-replay-plane.ts — L3: Traffic Logging & Deterministic Diffing
 * Zero-dependency: node:* only.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      CREATE TABLE IF NOT EXISTS replay_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route TEXT NOT NULL,
        requestJson TEXT NOT NULL,
        responseJson TEXT NOT NULL,
        statusCode INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        durationMs REAL NOT NULL,
        ts INTEGER NOT NULL
      );
    `);
    // Indices for fast querying — prevents table scans on rolling cap deletion
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_replay_route ON replay_log(route);
      CREATE INDEX IF NOT EXISTS idx_replay_ts ON replay_log(ts);
    `);
    return true;
  } catch (e: any) {
    console.warn('[replay-plane] DB init failed:', e?.message);
    return false;
  }
}

const ROLLING_CAP = 5000;
const TRIM_COUNT = 1000;

function safeStringify(obj: unknown): string {
  try {
    // Guard against BigInt and circular references
    return JSON.stringify(obj, (_k, v) => {
      if (typeof v === 'bigint') return v.toString() + 'n';
      return v;
    });
  } catch {
    return JSON.stringify({ error: 'Unstringifiable object' });
  }
}

export interface ReplayEntry {
  id?: number;
  route: string;
  requestJson: string;
  responseJson: string;
  statusCode: number;
  ok: boolean;
  durationMs: number;
  ts: number;
}

export function recordReplay(entry: Omit<ReplayEntry, 'id' | 'ts'>): boolean {
  if (!ensureDb()) return false;
  try {
    db.prepare(`
      INSERT INTO replay_log (route, requestJson, responseJson, statusCode, ok, durationMs, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.route,
      entry.requestJson,
      entry.responseJson,
      entry.statusCode,
      entry.ok ? 1 : 0,
      entry.durationMs,
      Date.now(),
    );

    // Rolling cap enforcement
    // Hand-trace: If table has 5001 rows after insert:
    //   SELECT COUNT(*) returns 5001 > 5000
    //   DELETE WHERE id IN (SELECT id FROM replay_log ORDER BY ts ASC LIMIT 1000)
    //   Deletes the 1000 oldest entries by timestamp (index on ts makes this efficient)
    const count = (db.prepare(`SELECT COUNT(*) as c FROM replay_log`).get() as any)?.c ?? 0;
    if (count > ROLLING_CAP) {
      db.prepare(`
        DELETE FROM replay_log WHERE id IN (
          SELECT id FROM replay_log ORDER BY ts ASC LIMIT ${TRIM_COUNT}
        )
      `).run();
    }
    return true;
  } catch { return false; }
}

export function getReplayLog(route?: string, limit = 50): ReplayEntry[] {
  if (!ensureDb()) return [];
  try {
    if (route) {
      return db.prepare(`SELECT * FROM replay_log WHERE route = ? ORDER BY ts DESC LIMIT ?`).all(route, limit) as ReplayEntry[];
    }
    return db.prepare(`SELECT * FROM replay_log ORDER BY ts DESC LIMIT ?`).all(limit) as ReplayEntry[];
  } catch { return []; }
}

// ── Deterministic Diffing ─────────────────────────────────────────────────
// Hand-trace: stored = {a:1, b:2}, current = {b:2, a:1}
// JSON.stringify({a:1,b:2}) = '{"a":1,"b":2}'
// JSON.stringify({b:2,a:1}) = '{"b":2,"a":1}'
// SHA-256 of both are DIFFERENT — key order matters in standard JSON.stringify
// => hashMatch = false, structuralDrift contains analysis
export interface ReplayDiff {
  storedHash: string;
  currentHash: string;
  hashMatch: boolean;
  addedKeys: string[];
  removedKeys: string[];
  statusDrift: boolean;
  structuralDrift: boolean;
}

export function summarizeReplayDiff(stored: unknown, current: unknown): ReplayDiff {
  const storedStr = safeStringify(stored);
  const currentStr = safeStringify(current);
  const storedHash = createHash('sha256').update(storedStr).digest('hex');
  const currentHash = createHash('sha256').update(currentStr).digest('hex');
  const hashMatch = storedHash === currentHash;

  let addedKeys: string[] = [];
  let removedKeys: string[] = [];
  let statusDrift = false;

  try {
    if (typeof stored === 'object' && stored && typeof current === 'object' && current) {
      const storedKeys = new Set(Object.keys(stored as object));
      const currentKeys = new Set(Object.keys(current as object));
      addedKeys = [...currentKeys].filter(k => !storedKeys.has(k));
      removedKeys = [...storedKeys].filter(k => !currentKeys.has(k));
      const s = stored as any;
      const c = current as any;
      if (s.statusCode !== undefined && c.statusCode !== undefined) {
        statusDrift = s.statusCode !== c.statusCode;
      }
    }
  } catch {}

  return {
    storedHash,
    currentHash,
    hashMatch,
    addedKeys,
    removedKeys,
    statusDrift,
    structuralDrift: addedKeys.length > 0 || removedKeys.length > 0 || statusDrift,
  };
}

export function getReplayStats(): { totalEntries: number; routes: string[] } {
  if (!ensureDb()) return { totalEntries: 0, routes: [] };
  try {
    const total = (db.prepare(`SELECT COUNT(*) as c FROM replay_log`).get() as any)?.c ?? 0;
    const routes = (db.prepare(`SELECT DISTINCT route FROM replay_log ORDER BY route`).all() as Array<{route:string}>).map(r => r.route);
    return { totalEntries: total, routes };
  } catch { return { totalEntries: 0, routes: [] }; }
}
