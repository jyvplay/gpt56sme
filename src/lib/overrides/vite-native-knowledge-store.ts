/**
 * vite-native-knowledge-store.ts — L1: Persistence & Vector/Lexical Math
 * Zero-dependency SQLite storage for scraped content, RAG chunks, and Merkle-lite audit logs.
 * All imports are from node:* only.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Ghost Load Pattern: avoids Rollup static analysis crash ──────────────
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
    // Exact pragmas — MUST execute immediately after open
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA busy_timeout = 3000;');
    initSchema();
    return true;
  } catch (e: any) {
    console.warn('[knowledge-store] DB init failed:', e?.message);
    return false;
  }
}

function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      summary TEXT NOT NULL,
      ts INTEGER NOT NULL,
      refHash TEXT NOT NULL,
      simHash TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
      USING fts5(summary, content='knowledge', content_rowid='id');
  `);
  // Exact FTS5 triggers — must NOT deviate
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS tbl_ai AFTER INSERT ON knowledge BEGIN
      INSERT INTO knowledge_fts(rowid, summary) VALUES (new.id, new.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS tbl_ad AFTER DELETE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, summary) VALUES('delete', old.id, old.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS tbl_au AFTER UPDATE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, summary) VALUES('delete', old.id, old.summary);
      INSERT INTO knowledge_fts(rowid, summary) VALUES (new.id, new.summary);
    END;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      merkleHash TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);
}

// ── 64-bit SimHash using BigInt — NO Number bitwise ops allowed ──────────
// Hand-trace: "hello world"
// toks = ["hello","world"]
// For "hello": sha256 -> 32 bytes; use first 8 bytes as BigInt
// bits = byte[0]<<56 | byte[1]<<48 | ... | byte[7]<<0  (using BigInt shifts)
// For each bit position b in 0..63: v[b] += ((bits >> BigInt(b)) & 1n) === 1n ? 1 : -1
// After all tokens, fp: for b in 0..63 if v[b]>0 then fp |= 1n<<BigInt(b)
// Return fp.toString(16).padStart(16,'0')
export function computeSimHash64(text: string): string {
  const toks = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const v = new Array(64).fill(0);
  for (const tok of toks) {
    const hashBuffer = createHash('sha256').update(tok, 'utf8').digest();
    // Construct 64-bit BigInt from first 8 bytes — strictly BigInt arithmetic
    let bits = 0n;
    for (let i = 0; i < 8; i++) bits = (bits << 8n) | BigInt(hashBuffer[i]);
    // Project onto 64-dimensional vector
    for (let b = 0; b < 64; b++) v[b] += ((bits >> BigInt(b)) & 1n) === 1n ? 1 : -1;
  }
  // Collapse vector to fingerprint — MUST use BigInt, not Number bitwise
  let fp = 0n;
  for (let b = 0; b < 64; b++) if (v[b] > 0) fp |= (1n << BigInt(b));
  return fp.toString(16).padStart(16, '0');
}

export function hammingDistance64(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let dist = 0;
  while (diff > 0n) { dist += Number(diff & 1n); diff >>= 1n; }
  return dist;
}

// ── Secret redaction before any data hits disk ───────────────────────────
export function redactSecrets(text: string): string {
  // AWS keys
  let r = text.replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]');
  // GitHub PATs
  r = r.replace(/ghp_[A-Za-z0-9]{36}/g, '[REDACTED_GH_PAT]');
  r = r.replace(/github_pat_[A-Za-z0-9_]{82}/g, '[REDACTED_GH_PAT]');
  // Generic secrets — bearer tokens, API keys in headers
  r = r.replace(/Bearer\s+[A-Za-z0-9._\-]{20,}/gi, 'Bearer [REDACTED]');
  r = r.replace(/api[_-]?key["\s:=]+[A-Za-z0-9_\-]{20,}/gi, 'api_key=[REDACTED]');
  return r;
}

// ── Prompt injection scanner ──────────────────────────────────────────────
export function scanForInjection(text: string): boolean {
  const lower = text.toLowerCase();
  const injectionPatterns = [
    'ignore previous instructions',
    'ignore all instructions',
    'system prompt:',
    'new instruction:',
    'prompt injection',
    '</system>',
    '<|im_start|>',
    'jailbreak',
    'dan mode',
  ];
  return injectionPatterns.some(p => lower.includes(p));
}

// ── Core storage API ─────────────────────────────────────────────────────
export interface KnowledgeRecord {
  id?: number;
  kind: string;
  ref: string;
  summary: string;
  ts: number;
  refHash: string;
  simHash: string;
}

export function recordKnowledge(kind: string, ref: string, rawSummary: string): { id: number } | null {
  if (!ensureDb()) return null;
  // Redact secrets before writing
  const summary = redactSecrets(rawSummary).slice(0, 4000);
  // Block injection attempts
  if (scanForInjection(summary)) {
    console.warn('[knowledge-store] Injection attempt detected in summary, blocking.');
    return null;
  }
  const ts = Date.now();
  const refHash = createHash('sha256').update(ref, 'utf8').digest('hex');
  const simHash = computeSimHash64(summary);
  try {
    const stmt = db.prepare(`
      INSERT INTO knowledge (kind, ref, summary, ts, refHash, simHash)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(kind, ref, summary, ts, refHash, simHash);
    return { id: Number(result.lastInsertRowid) };
  } catch (e: any) {
    console.warn('[knowledge-store] recordKnowledge failed:', e?.message);
    return null;
  }
}

export function searchKnowledge(query: string, limit = 10): KnowledgeRecord[] {
  if (!ensureDb()) return [];
  try {
    const stmt = db.prepare(`
      SELECT k.* FROM knowledge k
      JOIN knowledge_fts f ON f.rowid = k.id
      WHERE knowledge_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(query, limit) as KnowledgeRecord[];
  } catch {
    // Fallback to LIKE if FTS fails
    try {
      const stmt = db.prepare(`SELECT * FROM knowledge WHERE summary LIKE ? LIMIT ?`);
      return stmt.all(`%${query}%`, limit) as KnowledgeRecord[];
    } catch { return []; }
  }
}

export function getKnowledgeById(id: number): KnowledgeRecord | null {
  if (!ensureDb()) return null;
  try {
    const stmt = db.prepare(`SELECT * FROM knowledge WHERE id = ?`);
    return (stmt.get(id) as KnowledgeRecord) || null;
  } catch { return null; }
}

export function deleteKnowledge(id: number): boolean {
  if (!ensureDb()) return false;
  try {
    const stmt = db.prepare(`DELETE FROM knowledge WHERE id = ?`);
    stmt.run(id);
    return true;
  } catch { return false; }
}

export function repairKnowledgeFts(): boolean {
  if (!ensureDb()) return false;
  try {
    db.exec(`INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')`);
    return true;
  } catch { return false; }
}

// ── Autophagy: purge ghost files (refs no longer on disk) ────────────────
export function purgeGhostFiles(): number {
  if (!ensureDb()) return 0;
  try {
    const rows = db.prepare(`SELECT id, ref FROM knowledge WHERE kind = 'file'`).all() as Array<{id:number, ref:string}>;
    let purged = 0;
    for (const row of rows) {
      if (!existsSync(row.ref)) {
        db.prepare(`DELETE FROM knowledge WHERE id = ?`).run(row.id);
        purged++;
      }
    }
    return purged;
  } catch { return 0; }
}

// ── Stats ─────────────────────────────────────────────────────────────────
export function getKnowledgeStats(): { totalRecords: number; kinds: Record<string, number>; dbPath: string; available: boolean } {
  if (!ensureDb()) return { totalRecords: 0, kinds: {}, dbPath: DB_PATH, available: false };
  try {
    const total = (db.prepare(`SELECT COUNT(*) as c FROM knowledge`).get() as any)?.c ?? 0;
    const kindRows = db.prepare(`SELECT kind, COUNT(*) as c FROM knowledge GROUP BY kind`).all() as Array<{kind:string,c:number}>;
    const kinds: Record<string, number> = {};
    for (const r of kindRows) kinds[r.kind] = r.c;
    return { totalRecords: total, kinds, dbPath: DB_PATH, available: true };
  } catch { return { totalRecords: 0, kinds: {}, dbPath: DB_PATH, available: false }; }
}

export function getDb(): any { ensureDb(); return db; }
export function getDbPath(): string { return DB_PATH; }
export function isDbAvailable(): boolean { return dbAvailable && !!db; }
