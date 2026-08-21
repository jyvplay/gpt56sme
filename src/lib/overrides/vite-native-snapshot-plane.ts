/**
 * vite-native-snapshot-plane.ts — L3: SQLite Hot-Backup Orchestration
 * Zero-dependency: node:* only.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let DatabaseSync: any = null;
let sqliteBackup: any = null;
let dbAvailable = false;

try {
  const anyProc: any = globalThis.process as any;
  if (anyProc && typeof anyProc.getBuiltinModule === 'function') {
    const mod = anyProc.getBuiltinModule('node:sqlite');
    if (mod?.DatabaseSync) {
      DatabaseSync = mod.DatabaseSync;
      sqliteBackup = mod.backup;
      dbAvailable = true;
    }
  }
} catch {}
if (!dbAvailable) {
  try {
    const req = createRequire(import.meta.url);
    const mod = req('node:sqlite');
    ({ DatabaseSync, backup: sqliteBackup } = mod);
    dbAvailable = !!DatabaseSync;
  } catch { dbAvailable = false; }
}

const AUDIT_DIR = join(__dirname, '..', '..', '..', 'src', 'audit');
const DB_PATH = join(AUDIT_DIR, 'knowledge.db');
const SNAPSHOTS_DIR = join(AUDIT_DIR, 'snapshots');

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── Hot Backup ────────────────────────────────────────────────────────────
// Hand-trace: if sqliteBackup is undefined:
//   typeof sqliteBackup === 'function' = false
//   Return { ok: false, error: 'backup API not available in this Node.js version', label, outFile }
export async function createHotBackup(label?: string): Promise<{ ok: boolean; outFile?: string; error?: string; label: string }> {
  const l = label || `snapshot-${Date.now()}`;
  const outFile = join(SNAPSHOTS_DIR, `${l}.db`);

  if (!existsSync(SNAPSHOTS_DIR)) mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  if (!existsSync(DB_PATH)) {
    return { ok: false, error: 'Source database does not exist', label: l };
  }

  // API availability check — must check typeof, not truthiness
  if (typeof sqliteBackup !== 'function') {
    return { ok: false, error: 'backup API not available in this Node.js version', label: l, outFile };
  }

  if (!dbAvailable) {
    return { ok: false, error: 'SQLite not available', label: l };
  }

  try {
    const sourceDb = new DatabaseSync(DB_PATH);
    sourceDb.exec('PRAGMA journal_mode = WAL;');
    sourceDb.exec('PRAGMA busy_timeout = 3000;');
    await sqliteBackup(sourceDb, outFile, { rate: 32 });
    return { ok: true, outFile, label: l };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Backup failed', label: l, outFile };
  }
}

// ── Snapshot Manifest ─────────────────────────────────────────────────────
export async function getSnapshotManifest(): Promise<{
  dbPath: string;
  exists: boolean;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
  snapshots: Array<{ name: string; sizeBytes: number; mtimeMs: number }>;
}> {
  const manifest = {
    dbPath: DB_PATH,
    exists: existsSync(DB_PATH),
    sizeBytes: 0,
    mtimeMs: 0,
    sha256: '',
    snapshots: [] as Array<{ name: string; sizeBytes: number; mtimeMs: number }>,
  };

  if (manifest.exists) {
    const stat = statSync(DB_PATH);
    manifest.sizeBytes = stat.size;
    manifest.mtimeMs = stat.mtimeMs;
    // Note: hashing while DB is writing may yield inconsistent results or EBUSY on Windows
    try { manifest.sha256 = await sha256File(DB_PATH); } catch { manifest.sha256 = 'unavailable'; }
  }

  if (existsSync(SNAPSHOTS_DIR)) {
    const files = readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith('.db'));
    manifest.snapshots = files.map(f => {
      const p = join(SNAPSHOTS_DIR, f);
      const s = statSync(p);
      return { name: f, sizeBytes: s.size, mtimeMs: s.mtimeMs };
    }).sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  return manifest;
}

export function getSnapshotDir(): string { return SNAPSHOTS_DIR; }
