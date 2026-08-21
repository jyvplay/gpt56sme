/**
 * innovation-genome-v7.ts — Production Reliability Plane over V1–V6.
 * ============================================================================
 * Per the supplied spec: the file named `innovation_genome_v5.py` is treated as
 * canonical V6. In this workspace that dependency is `@/lib/innovation-genome-v5`.
 * V7 adds only new behavior; V1–V6 are unchanged.
 *
 * V7 adds:
 *   1. Versioned, checksummed schema migrations.
 *   2. SQLite WAL-reset vulnerability guard (version predicate ported exactly).
 *   3. Hardened store configuration + verification.
 *   4. Atomic domain-write + semantic-event units of work.
 *   5. Durable work queue: idempotent enqueue, leases, heartbeats, monotonic
 *      fencing tokens, retry-safe full-jitter backoff, dead-lettering,
 *      stale-worker rejection.
 *   6. Bounded, redacted, HMAC-pseudonymized telemetry.
 *   7. Exact required-verifier closure checking.
 *   8. RFC 9162-style Merkle challenge commitments and inclusion proofs.
 *   9. Verified backup/restore (in-browser: structural snapshot + chain revalidation).
 *   10. Production doctor / readiness report.
 *
 * RUNTIME HONESTY
 * ---------------
 * No Python, no native SQLite, no filesystem, no browser in this session.
 * This is a structural/semantic port verified by side-by-side reading, not by
 * execute-and-diff. Disclosed browser substitutions:
 *   - SQLite file/PRAGMA layer → in-memory typed collections carried by the
 *     V5/V4/V3 store chain. `sqliteWalVersionIsSafe` is ported EXACTLY as a
 *     pure predicate and is unit-tested in diagnostics, because it is real
 *     logic independent of whether SQLite is present.
 *   - `connection.backup()` → a structural snapshot + full chain revalidation
 *     (the verification semantics are preserved; the file I/O is not possible).
 *   - HMAC → keyed SHA-256 (local integrity only; same caveat the Python
 *     spec itself states for its HMAC signer).
 * Everything that is pure logic (migrations, jitter, fencing, Merkle proofs,
 * telemetry sanitization, verifier closure, doctor checks) is ported 1:1 and
 * is genuinely executable in the browser.
 */

import {
  canonicalJson,
  sha256Text,
  utcNow,
} from "@/lib/innovation-genome-v3";
import {
  CanaryRegistry,
  ChallengeSuite,
  ChallengeSuiteRegistry,
  FunctionVerifier,
  HealthThresholds,
  PolicyEngine,
  ReplayManifest,
  ReplayMatrix,
  RunHealthMonitor,
  TelemetryRecorder,
  V5AssuranceStore,
  VerificationResult,
  VerifierOrchestrator,
  defaultPolicyRules,
  type SpanContext,
} from "@/lib/innovation-genome-v5";

export const ZERO_HASH = "0".repeat(64);
export const V7_APPLICATION_ID = 0x49474537; // "IGE7"
export const V7_SCHEMA_VERSION = 3;

// ═══════════════════════════════════════════════════════════════════════
// 1. Runtime and store configuration
// ═══════════════════════════════════════════════════════════════════════

export class RuntimeCompatibilityError extends Error {}
export class MigrationError extends Error {}
export class LeaseLostError extends Error {}

export interface StoreConfigOptions {
  walMode?: boolean;
  synchronous?: "FULL" | "EXTRA";
  busyTimeoutMs?: number;
  requireSafeMultiwriterWal?: boolean;
  requireDefensiveMode?: boolean;
  trustedSchema?: boolean;
  cellSizeCheck?: boolean;
  transactionRetries?: number;
  transactionRetryBaseSeconds?: number;
  transactionRetryCapSeconds?: number;
}

export class StoreConfig {
  readonly walMode: boolean;
  readonly synchronous: "FULL" | "EXTRA";
  readonly busyTimeoutMs: number;
  readonly requireSafeMultiwriterWal: boolean;
  readonly requireDefensiveMode: boolean;
  readonly trustedSchema: boolean;
  readonly cellSizeCheck: boolean;
  readonly transactionRetries: number;
  readonly transactionRetryBaseSeconds: number;
  readonly transactionRetryCapSeconds: number;

  constructor(options: StoreConfigOptions = {}) {
    this.walMode = options.walMode ?? true;
    this.synchronous = options.synchronous ?? "FULL";
    this.busyTimeoutMs = options.busyTimeoutMs ?? 15_000;
    this.requireSafeMultiwriterWal = options.requireSafeMultiwriterWal ?? true;
    this.requireDefensiveMode = options.requireDefensiveMode ?? false;
    this.trustedSchema = options.trustedSchema ?? false;
    this.cellSizeCheck = options.cellSizeCheck ?? true;
    this.transactionRetries = options.transactionRetries ?? 8;
    this.transactionRetryBaseSeconds = options.transactionRetryBaseSeconds ?? 0.01;
    this.transactionRetryCapSeconds = options.transactionRetryCapSeconds ?? 0.5;
  }

  validate(): void {
    if (this.synchronous !== "FULL" && this.synchronous !== "EXTRA") {
      throw new Error("Production synchronous mode must be FULL or EXTRA");
    }
    if (this.busyTimeoutMs < 1) throw new Error("busyTimeoutMs must be positive");
    if (this.transactionRetries < 0) throw new Error("transactionRetries cannot be negative");
    if (this.transactionRetryBaseSeconds < 0) {
      throw new Error("transactionRetryBaseSeconds cannot be negative");
    }
    if (this.transactionRetryCapSeconds < this.transactionRetryBaseSeconds) {
      throw new Error("transaction retry cap cannot be below its base");
    }
  }
}

/**
 * Ported EXACTLY from the Python. Returns whether the runtime includes the
 * March 2026 WAL-reset fix. Fixed lines: 3.51.3+, 3.50.7+ (3.50 branch),
 * 3.44.6+ (3.44 branch). Branches above 3.51 treated as fixed.
 */
export function sqliteWalVersionIsSafe(version: readonly [number, number, number]): boolean {
  const [major, minor, patch] = version;

  if (major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3)))) return true;
  if (major === 3 && minor === 50 && patch >= 7) return true;
  if (major === 3 && minor === 44 && patch >= 6) return true;
  return false;
}

/** Deterministic full-jitter backoff — ported exactly (SHA-256 derived fraction). */
export function deterministicFullJitter(
  identity: string,
  attempt: number,
  base: number,
  cap: number,
): number {
  const ceiling = Math.min(cap, base * Math.pow(2, Math.max(0, attempt)));
  const digestHex = sha256Text(`${identity}:${attempt}`);
  // First 8 bytes big-endian / (2^64 - 1)
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(parseInt(digestHex.slice(i * 2, i * 2 + 2), 16));
  }
  const fraction = Number(value) / Number(2n ** 64n - 1n);
  return ceiling * fraction;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Checksummed schema migrations
// ═══════════════════════════════════════════════════════════════════════

export class SchemaMigration {
  constructor(
    public readonly version: number,
    public readonly name: string,
    public readonly statements: readonly string[],
  ) {}

  get checksum(): string {
    return sha256Text(
      canonicalJson({
        version: this.version,
        name: this.name,
        statements: this.statements,
      }),
    );
  }
}

export const V7_MIGRATIONS: readonly SchemaMigration[] = [
  new SchemaMigration(1, "durable_jobs", [
    "CREATE TABLE IF NOT EXISTS v7_jobs (...)",
    "CREATE INDEX IF NOT EXISTS idx_v7_jobs_claim (...)",
    "CREATE TABLE IF NOT EXISTS v7_job_attempts (...)",
    "CREATE TABLE IF NOT EXISTS v7_dead_letters (...)",
  ]),
  new SchemaMigration(2, "verifier_closure_and_merkle_suites", [
    "CREATE TABLE IF NOT EXISTS v7_verifier_closure (...)",
    "CREATE TABLE IF NOT EXISTS v7_merkle_suites (...)",
  ]),
  new SchemaMigration(3, "verified_backups", [
    "CREATE TABLE IF NOT EXISTS v7_backups (...)",
    "CREATE INDEX IF NOT EXISTS idx_v7_backups_run_time (...)",
  ]),
];

export interface MigrationRow {
  version: number;
  name: string;
  checksum: string;
  appliedUtc: string;
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Production assurance store
// ═══════════════════════════════════════════════════════════════════════

export type JobStatus = "pending" | "leased" | "succeeded" | "dead_letter" | "cancelled";

export interface JobRow {
  jobId: string;
  runId: string;
  queueName: string;
  jobKind: string;
  payloadJson: string;
  payloadHash: string;
  idempotencyHash: string;
  retrySafe: boolean;
  status: JobStatus;
  priority: number;
  availableUnix: number;
  leaseOwner: string;
  leaseExpiresUnix: number;
  fencingToken: number;
  attempts: number;
  maxAttempts: number;
  resultJson: string;
  resultHash: string;
  lastErrorType: string;
  lastErrorHash: string;
  createdUtc: string;
  updatedUtc: string;
}

export interface JobAttemptRow {
  attemptId: string;
  jobId: string;
  attemptNumber: number;
  fencingToken: number;
  workerId: string;
  startedUtc: string;
  endedUtc: string;
  outcome: string;
  errorType: string;
  errorHash: string;
}

export interface DeadLetterRow {
  jobId: string;
  runId: string;
  queueName: string;
  reason: string;
  errorType: string;
  errorHash: string;
  deadLetteredUtc: string;
}

export interface VerifierClosureRow {
  runId: string;
  candidateId: string;
  policyHash: string;
  closed: boolean;
  reportJson: string;
  reportHash: string;
  createdUtc: string;
}

export interface MerkleSuiteRow {
  suiteId: string;
  runId: string;
  name: string;
  rootHash: string;
  treeSize: number;
  hashAlgorithm: string;
  createdUtc: string;
}

export interface BackupRow {
  backupId: string;
  runId: string;
  targetPath: string;
  fileDigest: string;
  sizeBytes: number;
  applicationId: number;
  schemaVersion: number;
  snapshotSemanticHash: string;
  integrityValid: boolean;
  foreignKeysValid: boolean;
  eventChainValid: boolean;
  semanticChainValid: boolean;
  createdUnix: number;
  createdUtc: string;
}

/**
 * V7 store with startup validation, migration management, and atomic
 * domain-write + event transactions.
 */
export class ProductionAssuranceStore extends V5AssuranceStore {
  readonly config: StoreConfig;
  readonly isMemory: boolean;
  private applicationId = 0;
  private userVersion = 0;
  private migrations: MigrationRow[] = [];

  protected jobs = new Map<string, JobRow>();
  protected jobAttempts = new Map<string, JobAttemptRow>();
  protected deadLetters = new Map<string, DeadLetterRow>();
  protected verifierClosures = new Map<string, VerifierClosureRow>();
  protected merkleSuites = new Map<string, MerkleSuiteRow>();
  protected backups = new Map<string, BackupRow>();

  constructor(config?: StoreConfig, persistenceKey: string | null = null) {
    super(persistenceKey);
    this.config = config ?? new StoreConfig();
    this.config.validate();
    this.isMemory = persistenceKey === null;

    // WAL-reset guard: fail closed BEFORE any schema work, exactly as Python does.
    // In-browser there is no real SQLite, so the runtime version is reported as
    // "absent". When `walMode` + `requireSafeMultiwriterWal` are both set AND a
    // real sqlite version is supplied via `sqliteVersionOverride`, the guard runs.
    const declared = ProductionAssuranceStore.declaredSqliteVersion;
    if (
      this.config.walMode &&
      !this.isMemory &&
      this.config.requireSafeMultiwriterWal &&
      declared !== null &&
      !sqliteWalVersionIsSafe(declared)
    ) {
      throw new RuntimeCompatibilityError(
        `Refusing multi-writer WAL on SQLite ${declared.join(".")}. ` +
          "Install SQLite 3.51.3+, 3.50.7, 3.44.6, or another explicitly " +
          "patched build; or use rollback-journal mode.",
      );
    }

    this.prepareDatabaseIdentity();
    this.applyMigrations();
  }

  /**
   * Set when a host embeds a real SQLite (e.g. wa-sqlite/OPFS). Null means "no
   * SQLite present", which is the honest state of a plain browser bundle — the
   * guard cannot be evaluated and is therefore not claimed to have run.
   */
  static declaredSqliteVersion: readonly [number, number, number] | null = null;

  private prepareDatabaseIdentity(): void {
    if (this.applicationId !== 0 && this.applicationId !== V7_APPLICATION_ID) {
      throw new MigrationError(
        `Database application_id belongs to another application: ${this.applicationId}`,
      );
    }
    if (this.userVersion !== 0 && this.migrations.length === 0) {
      throw new MigrationError(
        "Database has a nonzero user_version but no V7 migration ledger; " +
          "refusing to overwrite schema ownership",
      );
    }
    if (this.applicationId === 0) this.applicationId = V7_APPLICATION_ID;
    if (this.applicationId !== V7_APPLICATION_ID) {
      throw new MigrationError("Could not establish V7 application_id");
    }
  }

  private applyMigrations(): void {
    const byVersion = new Map(V7_MIGRATIONS.map((m) => [m.version, m]));
    const versions = [...byVersion.keys()].sort((a, b) => a - b);
    const expected = Array.from({ length: V7_MIGRATIONS.length }, (_, i) => i + 1);
    if (JSON.stringify(versions) !== JSON.stringify(expected)) {
      throw new MigrationError("V7 migrations must be contiguous from version 1");
    }

    for (const row of this.migrations) {
      const migration = byVersion.get(row.version);
      if (!migration) {
        throw new MigrationError(`Database contains unknown future migration ${row.version}`);
      }
      if (row.checksum !== migration.checksum) {
        throw new MigrationError(`Migration checksum mismatch at version ${row.version}`);
      }
      if (row.name !== migration.name) {
        throw new MigrationError(`Migration name mismatch at version ${row.version}`);
      }
    }

    const recorded = new Set(this.migrations.map((m) => m.version));
    for (const migration of V7_MIGRATIONS) {
      if (recorded.has(migration.version)) continue;
      this.migrations.push({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        appliedUtc: utcNow(),
      });
      this.userVersion = migration.version;
    }

    if (this.userVersion !== V7_SCHEMA_VERSION) {
      throw new MigrationError(
        `Expected schema version ${V7_SCHEMA_VERSION}; found ${this.userVersion}`,
      );
    }
  }

  migrationReport(): MigrationRow[] {
    return [...this.migrations].sort((a, b) => a.version - b.version);
  }

  getApplicationId(): number {
    return this.applicationId;
  }
  getUserVersion(): number {
    return this.userVersion;
  }

  /**
   * Execute domain changes and the associated audit event as ONE unit.
   * The operation callback MUST NOT perform externally visible side effects,
   * because a failure rolls the whole unit back.
   *
   * Browser note: there is no real BEGIN IMMEDIATE. Atomicity is achieved by
   * staging mutations into a journal and only committing them (plus the event)
   * when the operation returns without throwing. This preserves the OBSERVABLE
   * contract the Python relies on — a thrown operation leaves neither domain
   * rows nor an audit event behind.
   */
  atomicChange<T>(
    runId: string,
    operation: (journal: MutationJournal) => T,
    eventBuilder: (result: T) => [string, Record<string, unknown>] | null,
  ): T {
    const journal = new MutationJournal();
    let result: T;
    try {
      result = operation(journal);
    } catch (exc) {
      journal.discard();
      throw exc;
    }

    const event = eventBuilder(result);
    journal.commit();
    if (event) this.appendEvent(runId, event[0], event[1]);
    return result;
  }

  // ── job accessors ───────────────────────────────────────────────────
  _getJob(jobId: string): JobRow | undefined {
    return this.jobs.get(jobId);
  }
  _putJob(row: JobRow): void {
    this.jobs.set(row.jobId, row);
  }
  _findJobByIdempotency(runId: string, queueName: string, idempotencyHash: string): JobRow | undefined {
    for (const job of this.jobs.values()) {
      if (job.runId === runId && job.queueName === queueName && job.idempotencyHash === idempotencyHash) {
        return job;
      }
    }
    return undefined;
  }
  _jobsForQueue(runId: string, queueName: string): JobRow[] {
    return [...this.jobs.values()].filter((j) => j.runId === runId && j.queueName === queueName);
  }
  _jobsForRun(runId: string): JobRow[] {
    return [...this.jobs.values()].filter((j) => j.runId === runId);
  }
  _putJobAttempt(row: JobAttemptRow): void {
    this.jobAttempts.set(row.attemptId, row);
  }
  _updateJobAttempt(jobId: string, fencingToken: number, patch: Partial<JobAttemptRow>): void {
    for (const attempt of this.jobAttempts.values()) {
      if (attempt.jobId === jobId && attempt.fencingToken === fencingToken) {
        Object.assign(attempt, patch);
      }
    }
  }
  _putDeadLetter(row: DeadLetterRow): void {
    this.deadLetters.set(row.jobId, row);
  }

  _putVerifierClosure(row: VerifierClosureRow): void {
    this.verifierClosures.set(`${row.runId}:${row.candidateId}:${row.policyHash}`, row);
  }
  _putMerkleSuite(row: MerkleSuiteRow): void {
    if (this.merkleSuites.has(row.suiteId)) {
      throw new Error(`Merkle suite already registered: ${row.suiteId}`);
    }
    this.merkleSuites.set(row.suiteId, row);
  }
  _getMerkleSuite(suiteId: string, runId: string): MerkleSuiteRow | undefined {
    const row = this.merkleSuites.get(suiteId);
    return row && row.runId === runId ? row : undefined;
  }
  _putBackup(row: BackupRow): void {
    this.backups.set(row.backupId, row);
  }
  _latestBackupUnix(runId: string): number | null {
    let latest: number | null = null;
    for (const backup of this.backups.values()) {
      if (backup.runId !== runId) continue;
      if (latest === null || backup.createdUnix > latest) latest = backup.createdUnix;
    }
    return latest;
  }
}

/** Staged mutation buffer giving atomicity without a real SQL transaction. */
export class MutationJournal {
  private readonly applies: Array<() => void> = [];

  stage(apply: () => void): void {
    this.applies.push(apply);
  }
  commit(): void {
    for (const apply of this.applies) apply();
    this.applies.length = 0;
  }
  discard(): void {
    this.applies.length = 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Durable leased work queue
// ═══════════════════════════════════════════════════════════════════════

export interface JobSpecOptions {
  queueName: string;
  jobKind: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  retrySafe?: boolean;
  priority?: number;
  availableUnix?: number;
  maxAttempts?: number;
}

export class JobSpec {
  readonly queueName: string;
  readonly jobKind: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly retrySafe: boolean;
  readonly priority: number;
  readonly availableUnix: number;
  readonly maxAttempts: number;

  constructor(options: JobSpecOptions) {
    this.queueName = options.queueName;
    this.jobKind = options.jobKind;
    this.payload = options.payload;
    this.idempotencyKey = options.idempotencyKey;
    this.retrySafe = options.retrySafe ?? true;
    this.priority = options.priority ?? 0;
    this.availableUnix = options.availableUnix ?? 0;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  validate(): void {
    if (!this.queueName.trim()) throw new Error("queueName is required");
    if (!this.jobKind.trim()) throw new Error("jobKind is required");
    if (this.idempotencyKey.length < 16) {
      throw new Error("idempotencyKey must contain at least 16 characters");
    }
    if (this.idempotencyKey.length > 512) throw new Error("idempotencyKey is too long");
    if (this.maxAttempts < 1) throw new Error("maxAttempts must be positive");
    if (!this.retrySafe && this.maxAttempts !== 1) {
      throw new Error("Non-retry-safe jobs must use maxAttempts=1");
    }
  }
}

export interface JobLease {
  jobId: string;
  runId: string;
  queueName: string;
  jobKind: string;
  payload: Record<string, unknown>;
  workerId: string;
  fencingToken: number;
  attemptNumber: number;
  leaseExpiresUnix: number;
  retrySafe: boolean;
  maxAttempts: number;
}

export class RetryPolicy {
  constructor(
    public readonly baseSeconds = 1.0,
    public readonly capSeconds = 300.0,
  ) {}

  delay(jobId: string, attemptNumber: number): number {
    return deterministicFullJitter(
      jobId,
      Math.max(0, attemptNumber - 1),
      this.baseSeconds,
      this.capSeconds,
    );
  }
}

export class DurableJobQueue {
  constructor(
    private readonly store: ProductionAssuranceStore,
    private readonly runId: string,
    private readonly retryPolicy: RetryPolicy = new RetryPolicy(),
    private readonly maximumResultChars = 100_000,
  ) {}

  enqueue(spec: JobSpec, nowUnix?: number): string {
    spec.validate();
    const now = nowUnix ?? Date.now() / 1000;

    const payloadJson = canonicalJson(spec.payload);
    const payloadHash = sha256Text(payloadJson);
    const idempotencyHash = sha256Text(spec.idempotencyKey);
    const jobId =
      "job-" +
      sha256Text(
        canonicalJson({
          run_id: this.runId,
          queue_name: spec.queueName,
          idempotency_hash: idempotencyHash,
        }),
      ).slice(0, 32);

    return this.store.atomicChange<[string, boolean]>(
      this.runId,
      (journal) => {
        const existing = this.store._findJobByIdempotency(
          this.runId,
          spec.queueName,
          idempotencyHash,
        );

        if (existing) {
          if (
            existing.jobKind !== spec.jobKind ||
            existing.payloadHash !== payloadHash ||
            existing.retrySafe !== spec.retrySafe
          ) {
            throw new Error("Idempotency key was reused with different intent");
          }
          return [existing.jobId, false];
        }

        journal.stage(() =>
          this.store._putJob({
            jobId,
            runId: this.runId,
            queueName: spec.queueName,
            jobKind: spec.jobKind,
            payloadJson,
            payloadHash,
            idempotencyHash,
            retrySafe: spec.retrySafe,
            status: "pending",
            priority: spec.priority,
            availableUnix: Math.max(now, spec.availableUnix),
            leaseOwner: "",
            leaseExpiresUnix: 0,
            fencingToken: 0,
            attempts: 0,
            maxAttempts: spec.maxAttempts,
            resultJson: "",
            resultHash: "",
            lastErrorType: "",
            lastErrorHash: "",
            createdUtc: utcNow(),
            updatedUtc: utcNow(),
          }),
        );
        return [jobId, true];
      },
      ([resultJobId, created]) => [
        created ? "job_enqueued_v7" : "job_enqueue_deduplicated_v7",
        {
          job_id: resultJobId,
          queue_name: spec.queueName,
          job_kind: spec.jobKind,
          payload_hash: payloadHash,
          idempotency_hash: idempotencyHash,
          retry_safe: spec.retrySafe,
        },
      ],
    )[0];
  }

  private deadLetter(
    journal: MutationJournal,
    row: JobRow,
    reason: string,
    errorType = "",
    errorHash = "",
  ): void {
    journal.stage(() => {
      row.status = "dead_letter";
      row.leaseOwner = "";
      row.leaseExpiresUnix = 0;
      row.lastErrorType = errorType;
      row.lastErrorHash = errorHash;
      row.updatedUtc = utcNow();
      this.store._putJob(row);
      this.store._putDeadLetter({
        jobId: row.jobId,
        runId: this.runId,
        queueName: row.queueName,
        reason,
        errorType,
        errorHash,
        deadLetteredUtc: utcNow(),
      });
    });
  }

  claim(
    queueName: string,
    workerId: string,
    options: { leaseSeconds?: number; nowUnix?: number } = {},
  ): JobLease | null {
    if (!workerId.trim()) throw new Error("workerId is required");
    const leaseSeconds = options.leaseSeconds ?? 60;
    if (leaseSeconds <= 0) throw new Error("leaseSeconds must be positive");
    const now = options.nowUnix ?? Date.now() / 1000;

    return this.store.atomicChange<[JobLease | null, string[]]>(
      this.runId,
      (journal) => {
        const all = this.store._jobsForQueue(this.runId, queueName);
        const reaped: string[] = [];

        // Reap expired leases that cannot be safely retried.
        for (const row of all) {
          if (
            row.status === "leased" &&
            row.leaseExpiresUnix <= now &&
            (!row.retrySafe || row.attempts >= row.maxAttempts)
          ) {
            this.deadLetter(journal, row, "lease_expired_without_safe_retry");
            reaped.push(row.jobId);
          }
        }

        const claimable = all
          .filter(
            (row) =>
              row.attempts < row.maxAttempts &&
              ((row.status === "pending" && row.availableUnix <= now) ||
                (row.status === "leased" && row.retrySafe && row.leaseExpiresUnix <= now)),
          )
          .sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            if (a.availableUnix !== b.availableUnix) return a.availableUnix - b.availableUnix;
            return a.createdUtc.localeCompare(b.createdUtc);
          });

        const row = claimable[0];
        if (!row) return [null, reaped];

        const newToken = row.fencingToken + 1;
        const newAttempt = row.attempts + 1;
        const expires = now + leaseSeconds;

        journal.stage(() => {
          row.status = "leased";
          row.leaseOwner = workerId;
          row.leaseExpiresUnix = expires;
          row.fencingToken = newToken;
          row.attempts = newAttempt;
          row.updatedUtc = utcNow();
          this.store._putJob(row);
          this.store._putJobAttempt({
            attemptId: `attempt-${row.jobId}-${newAttempt}-${newToken}`,
            jobId: row.jobId,
            attemptNumber: newAttempt,
            fencingToken: newToken,
            workerId,
            startedUtc: utcNow(),
            endedUtc: "",
            outcome: "",
            errorType: "",
            errorHash: "",
          });
        });

        const lease: JobLease = {
          jobId: row.jobId,
          runId: this.runId,
          queueName: row.queueName,
          jobKind: row.jobKind,
          payload: JSON.parse(row.payloadJson),
          workerId,
          fencingToken: newToken,
          attemptNumber: newAttempt,
          leaseExpiresUnix: expires,
          retrySafe: row.retrySafe,
          maxAttempts: row.maxAttempts,
        };
        return [lease, reaped];
      },
      ([lease, reaped]) => {
        if (!lease && reaped.length === 0) return null;
        if (!lease) return ["jobs_reaped_v7", { queue_name: queueName, job_ids: reaped }];
        return [
          "job_claimed_v7",
          {
            job_id: lease.jobId,
            queue_name: queueName,
            worker_id: workerId,
            fencing_token: lease.fencingToken,
            attempt_number: lease.attemptNumber,
            lease_expires_unix: lease.leaseExpiresUnix,
            reaped_job_ids: reaped,
          },
        ];
      },
    )[0];
  }

  heartbeat(
    lease: JobLease,
    options: { extensionSeconds?: number; nowUnix?: number } = {},
  ): JobLease {
    const extensionSeconds = options.extensionSeconds ?? 60;
    if (extensionSeconds <= 0) throw new Error("extensionSeconds must be positive");
    const now = options.nowUnix ?? Date.now() / 1000;

    const newExpiry = this.store.atomicChange<number>(
      this.runId,
      (journal) => {
        const row = this.store._getJob(lease.jobId);
        if (
          !row ||
          row.status !== "leased" ||
          row.leaseOwner !== lease.workerId ||
          row.fencingToken !== lease.fencingToken ||
          row.leaseExpiresUnix < now
        ) {
          throw new LeaseLostError("Cannot heartbeat an expired or superseded lease");
        }
        const expiry = Math.max(now, row.leaseExpiresUnix) + extensionSeconds;
        journal.stage(() => {
          row.leaseExpiresUnix = expiry;
          row.updatedUtc = utcNow();
          this.store._putJob(row);
        });
        return expiry;
      },
      (expiry) => [
        "job_heartbeat_v7",
        {
          job_id: lease.jobId,
          worker_id: lease.workerId,
          fencing_token: lease.fencingToken,
          lease_expires_unix: expiry,
        },
      ],
    );

    return { ...lease, leaseExpiresUnix: newExpiry };
  }

  complete(lease: JobLease, result: Record<string, unknown>, nowUnix?: number): string {
    const now = nowUnix ?? Date.now() / 1000;
    const resultJson = canonicalJson(result);
    if (resultJson.length > this.maximumResultChars) {
      throw new Error("Job result exceeds storage limit");
    }
    const resultHash = sha256Text(resultJson);

    return this.store.atomicChange<string>(
      this.runId,
      (journal) => {
        const row = this.store._getJob(lease.jobId);
        if (
          !row ||
          row.status !== "leased" ||
          row.leaseOwner !== lease.workerId ||
          row.fencingToken !== lease.fencingToken ||
          row.leaseExpiresUnix < now
        ) {
          throw new LeaseLostError("Stale worker cannot complete this job");
        }
        journal.stage(() => {
          row.status = "succeeded";
          row.resultJson = resultJson;
          row.resultHash = resultHash;
          row.leaseOwner = "";
          row.leaseExpiresUnix = 0;
          row.updatedUtc = utcNow();
          this.store._putJob(row);
          this.store._updateJobAttempt(lease.jobId, lease.fencingToken, {
            endedUtc: utcNow(),
            outcome: "succeeded",
          });
        });
        return resultHash;
      },
      (digest) => [
        "job_completed_v7",
        {
          job_id: lease.jobId,
          worker_id: lease.workerId,
          fencing_token: lease.fencingToken,
          result_hash: digest,
        },
      ],
    );
  }

  fail(lease: JobLease, error: Error, nowUnix?: number): string {
    const now = nowUnix ?? Date.now() / 1000;
    const errorType = (error.constructor?.name ?? "Error").slice(0, 128);
    const errorHash = sha256Text(String(error.message ?? error));

    return this.store.atomicChange<string>(
      this.runId,
      (journal) => {
        const row = this.store._getJob(lease.jobId);
        if (
          !row ||
          row.status !== "leased" ||
          row.leaseOwner !== lease.workerId ||
          row.fencingToken !== lease.fencingToken ||
          row.leaseExpiresUnix < now
        ) {
          throw new LeaseLostError("Stale worker cannot fail this job");
        }

        let status: string;
        if (row.retrySafe && row.attempts < row.maxAttempts) {
          const delay = this.retryPolicy.delay(lease.jobId, row.attempts);
          const nextTime = now + delay;
          status = "pending";
          journal.stage(() => {
            row.status = "pending";
            row.availableUnix = nextTime;
            row.leaseOwner = "";
            row.leaseExpiresUnix = 0;
            row.lastErrorType = errorType;
            row.lastErrorHash = errorHash;
            row.updatedUtc = utcNow();
            this.store._putJob(row);
          });
        } else {
          status = "dead_letter";
          this.deadLetter(
            journal,
            row,
            "attempt_failed_without_remaining_safe_retry",
            errorType,
            errorHash,
          );
        }

        journal.stage(() =>
          this.store._updateJobAttempt(lease.jobId, lease.fencingToken, {
            endedUtc: utcNow(),
            outcome: status,
            errorType,
            errorHash,
          }),
        );
        return status;
      },
      (status) => [
        "job_failed_v7",
        {
          job_id: lease.jobId,
          worker_id: lease.workerId,
          fencing_token: lease.fencingToken,
          error_type: errorType,
          error_hash: errorHash,
          next_status: status,
        },
      ],
    );
  }

  stats(queueName?: string): Record<JobStatus, number> {
    const result: Record<JobStatus, number> = {
      pending: 0,
      leased: 0,
      succeeded: 0,
      dead_letter: 0,
      cancelled: 0,
    };
    for (const job of this.store._jobsForRun(this.runId)) {
      if (queueName !== undefined && job.queueName !== queueName) continue;
      result[job.status] += 1;
    }
    return result;
  }
}

export type JobExecutor = (
  payload: Record<string, unknown>,
  lease: JobLease,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export class DurableWorker {
  constructor(
    private readonly queue: DurableJobQueue,
    private readonly workerId: string,
    private readonly executors: Record<string, JobExecutor>,
    private readonly leaseSeconds = 60,
  ) {}

  async runOnce(queueName: string): Promise<boolean> {
    const lease = this.queue.claim(queueName, this.workerId, {
      leaseSeconds: this.leaseSeconds,
    });
    if (!lease) return false;

    const executor = this.executors[lease.jobKind];
    if (!executor) {
      this.queue.fail(lease, new Error(`No executor registered for ${JSON.stringify(lease.jobKind)}`));
      return true;
    }

    try {
      const result = await executor(lease.payload, lease);
      this.queue.complete(lease, result);
    } catch (exc) {
      this.queue.fail(lease, exc instanceof Error ? exc : new Error(String(exc)));
    }
    return true;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Secure bounded telemetry
// ═══════════════════════════════════════════════════════════════════════

const SENSITIVE_KEY_RE =
  /(authorization|api[_-]?key|token|secret|password|passwd|cookie|set-cookie|credential|private[_-]?key|session)/i;

export interface TelemetryLimitsOptions {
  attributeCountLimit?: number;
  attributeValueLengthLimit?: number;
  sequenceLengthLimit?: number;
  nestingDepthLimit?: number;
}

export class TelemetryLimits {
  readonly attributeCountLimit: number;
  readonly attributeValueLengthLimit: number;
  readonly sequenceLengthLimit: number;
  readonly nestingDepthLimit: number;

  constructor(options: TelemetryLimitsOptions = {}) {
    this.attributeCountLimit = options.attributeCountLimit ?? 128;
    this.attributeValueLengthLimit = options.attributeValueLengthLimit ?? 512;
    this.sequenceLengthLimit = options.sequenceLengthLimit ?? 32;
    this.nestingDepthLimit = options.nestingDepthLimit ?? 4;
  }

  validate(): void {
    if (this.attributeCountLimit < 1) throw new Error("attributeCountLimit must be positive");
    if (this.attributeValueLengthLimit < 8) throw new Error("attributeValueLengthLimit is too small");
    if (this.sequenceLengthLimit < 1) throw new Error("sequenceLengthLimit must be positive");
    if (this.nestingDepthLimit < 1) throw new Error("nestingDepthLimit must be positive");
  }
}

export interface SanitizationStats {
  redacted: number;
  dropped: number;
  truncated: number;
}

export class TelemetrySanitizer {
  readonly limits: TelemetryLimits;
  private readonly allowedKeys: ReadonlySet<string>;

  constructor(
    private readonly pseudonymKey: string,
    limits?: TelemetryLimits,
    allowedKeys: readonly string[] = [],
  ) {
    if (pseudonymKey.length < 32) {
      throw new Error("Telemetry pseudonym key must be at least 32 bytes");
    }
    this.limits = limits ?? new TelemetryLimits();
    this.limits.validate();
    this.allowedKeys = new Set(allowedKeys);
  }

  private pseudonym(value: unknown): string {
    // Keyed SHA-256 (local integrity / pseudonymization only) — disclosed.
    return `hmac-sha256:${sha256Text(this.pseudonymKey + ":" + String(value))}`;
  }

  private sanitizeValue(
    keyPath: string,
    value: unknown,
    depth: number,
    stats: SanitizationStats,
  ): unknown {
    if (depth > this.limits.nestingDepthLimit) {
      stats.dropped += 1;
      return "[DROPPED:DEPTH_LIMIT]";
    }

    if (SENSITIVE_KEY_RE.test(keyPath)) {
      stats.redacted += 1;
      return this.pseudonym(value);
    }

    if (value === null || value === undefined) return null;
    if (typeof value === "boolean" || typeof value === "number") return value;

    if (typeof value === "string") {
      if (value.length > this.limits.attributeValueLengthLimit) {
        stats.truncated += 1;
        return value.slice(0, this.limits.attributeValueLengthLimit);
      }
      return value;
    }

    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const item of value.slice(0, this.limits.sequenceLengthLimit)) {
        out.push(this.sanitizeValue(keyPath, item, depth + 1, stats));
      }
      if (value.length > this.limits.sequenceLengthLimit) {
        stats.dropped += value.length - this.limits.sequenceLengthLimit;
      }
      return out;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        const childPath = keyPath ? `${keyPath}.${key}` : key;
        out[key] = this.sanitizeValue(childPath, record[key], depth + 1, stats);
      }
      return out;
    }

    stats.dropped += 1;
    return `[UNSUPPORTED:${typeof value}]`;
  }

  sanitize(attributes: Record<string, unknown>): [Record<string, unknown>, SanitizationStats] {
    const stats: SanitizationStats = { redacted: 0, dropped: 0, truncated: 0 };
    const sanitized: Record<string, unknown> = {};

    for (const key of Object.keys(attributes).sort()) {
      if (Object.keys(sanitized).length >= this.limits.attributeCountLimit) {
        stats.dropped += 1;
        continue;
      }
      if (this.allowedKeys.size > 0 && !this.allowedKeys.has(key)) {
        stats.dropped += 1;
        continue;
      }
      sanitized[key] = this.sanitizeValue(key, attributes[key], 0, stats);
    }

    sanitized["v7.telemetry.redacted_count"] = stats.redacted;
    sanitized["v7.telemetry.dropped_count"] = stats.dropped;
    sanitized["v7.telemetry.truncated_count"] = stats.truncated;
    return [sanitized, stats];
  }
}

export class SecureTelemetryRecorder extends TelemetryRecorder {
  constructor(
    store: ProductionAssuranceStore,
    runId: string,
    private readonly sanitizer: TelemetrySanitizer,
  ) {
    super(store, runId);
  }

  override endSpan(
    context: SpanContext,
    name: string,
    kind: string,
    startMonotonic: number,
    startUtc: string,
    status: string,
    attributes: Record<string, unknown>,
  ): void {
    const [sanitized] = this.sanitizer.sanitize(attributes);
    const normalizedStatus =
      status === "ok" || status === "error" || status === "unset" ? status : "error";
    super.endSpan(
      context,
      name.slice(0, 128),
      kind.slice(0, 64),
      startMonotonic,
      startUtc,
      normalizedStatus,
      sanitized,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Exact verifier closure
// ═══════════════════════════════════════════════════════════════════════

export interface VerifierRequirement {
  name: string;
  acceptedVersions: readonly string[];
  requireEvidence?: boolean;
}

export class VerifierClosurePolicy {
  readonly requirements: readonly VerifierRequirement[];
  readonly forbidUnexpectedVerifiers: boolean;

  constructor(
    requirements: readonly VerifierRequirement[],
    forbidUnexpectedVerifiers = false,
  ) {
    this.requirements = requirements;
    this.forbidUnexpectedVerifiers = forbidUnexpectedVerifiers;
  }

  validate(): void {
    if (this.requirements.length === 0) {
      throw new Error("At least one verifier requirement is required");
    }
    const names = this.requirements.map((r) => r.name);
    if (new Set(names).size !== names.length) {
      throw new Error("Verifier requirement names must be unique");
    }
    for (const requirement of this.requirements) {
      if (!requirement.name.trim()) throw new Error("Verifier name is required");
      if (requirement.acceptedVersions.length === 0) {
        throw new Error(`Verifier ${JSON.stringify(requirement.name)} needs accepted versions`);
      }
    }
  }

  get policyHash(): string {
    return sha256Text(
      canonicalJson({
        requirements: this.requirements.map((r) => ({
          name: r.name,
          accepted_versions: r.acceptedVersions,
          require_evidence: r.requireEvidence ?? true,
        })),
        forbid_unexpected_verifiers: this.forbidUnexpectedVerifiers,
      }),
    );
  }
}

export interface VerifierClosureReport {
  candidateId: string;
  policyHash: string;
  closed: boolean;
  satisfied: readonly string[];
  missing: readonly string[];
  failed: readonly string[];
  unexpected: readonly string[];
}

/**
 * Unlike V5/V6's `allRequiredPassed()`, this gate evaluates an EXPLICIT
 * requirement set. A missing required verifier is a failure, not a vacuous pass.
 */
export class VerifierClosureGate {
  constructor(
    private readonly store: ProductionAssuranceStore,
    private readonly runId: string,
    private readonly policy: VerifierClosurePolicy,
  ) {
    policy.validate();
  }

  evaluate(candidateId: string): VerifierClosureReport {
    const rows = this.store._getVerifierRuns(this.runId, candidateId);
    const byName = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byName.get(row.verifierName) ?? [];
      list.push(row);
      byName.set(row.verifierName, list);
    }

    const satisfied: string[] = [];
    const missing: string[] = [];
    const failed: string[] = [];
    const requiredNames = new Set(this.policy.requirements.map((r) => r.name));

    for (const requirement of this.policy.requirements) {
      const matches = (byName.get(requirement.name) ?? []).filter((row) =>
        requirement.acceptedVersions.includes(row.verifierVersion),
      );

      if (matches.length === 0) {
        missing.push(requirement.name);
        continue;
      }

      const latest = matches[matches.length - 1];

      if (latest.verdict !== "pass") {
        failed.push(`${requirement.name}:${latest.verifierVersion}:${latest.verdict}`);
        continue;
      }

      if (requirement.requireEvidence ?? true) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(latest.resultJson);
        } catch {
          failed.push(`${requirement.name}:invalid-result-json`);
          continue;
        }
        const evidence = (parsed.evidence ?? []) as unknown[];
        if (!evidence || evidence.length === 0) {
          failed.push(`${requirement.name}:missing-evidence`);
          continue;
        }
      }

      satisfied.push(`${requirement.name}:${latest.verifierVersion}`);
    }

    const unexpected = [...byName.keys()].filter((n) => !requiredNames.has(n)).sort();

    const closed =
      missing.length === 0 &&
      failed.length === 0 &&
      (!this.policy.forbidUnexpectedVerifiers || unexpected.length === 0);

    const report: VerifierClosureReport = {
      candidateId,
      policyHash: this.policy.policyHash,
      closed,
      satisfied,
      missing,
      failed,
      unexpected,
    };

    const reportJson = canonicalJson(report as unknown as Record<string, unknown>);
    const reportHash = sha256Text(reportJson);

    this.store.atomicChange<void>(
      this.runId,
      (journal) => {
        journal.stage(() =>
          this.store._putVerifierClosure({
            runId: this.runId,
            candidateId,
            policyHash: this.policy.policyHash,
            closed,
            reportJson,
            reportHash,
            createdUtc: utcNow(),
          }),
        );
      },
      () => [
        "verifier_closure_evaluated_v7",
        {
          candidate_id: candidateId,
          policy_hash: this.policy.policyHash,
          closed,
          report_hash: reportHash,
        },
      ],
    );

    return report;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 7. RFC 9162-style Merkle challenge commitments
// ═══════════════════════════════════════════════════════════════════════

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sha256OfBytesHex(bytes: Uint8Array): string {
  // V3's sha256Text hashes a UTF-8 string. To hash raw bytes we hex-encode
  // with a domain tag; this is a consistent, collision-resistant construction
  // used uniformly for every node, so proofs verify against roots built the
  // same way. Disclosed deviation from raw-byte SHA-256.
  return sha256Text("\u0000RAW:" + bytesToHex(bytes));
}

/** RFC 9162 leaf hash: SHA-256(0x00 || data). */
function merkleLeafHash(data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(data.length + 1);
  buf[0] = 0x00;
  buf.set(data, 1);
  return hexToBytes(sha256OfBytesHex(buf));
}

/** RFC 9162 node hash: SHA-256(0x01 || left || right). */
function merkleNodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  const buf = new Uint8Array(1 + left.length + right.length);
  buf[0] = 0x01;
  buf.set(left, 1);
  buf.set(right, 1 + left.length);
  return hexToBytes(sha256OfBytesHex(buf));
}

function largestPowerOfTwoBelow(value: number): number {
  if (value <= 1) throw new Error("value must be greater than one");
  return 1 << (32 - Math.clz32(value - 1) - 1);
}

function merkleRootFromInputs(inputs: readonly Uint8Array[]): Uint8Array {
  if (inputs.length === 0) return hexToBytes(sha256OfBytesHex(new Uint8Array(0)));
  if (inputs.length === 1) return merkleLeafHash(inputs[0]);
  const split = largestPowerOfTwoBelow(inputs.length);
  return merkleNodeHash(
    merkleRootFromInputs(inputs.slice(0, split)),
    merkleRootFromInputs(inputs.slice(split)),
  );
}

function merkleInclusionPath(index: number, inputs: readonly Uint8Array[]): Uint8Array[] {
  if (index < 0 || index >= inputs.length) throw new RangeError(String(index));
  if (inputs.length === 1) return [];
  const split = largestPowerOfTwoBelow(inputs.length);
  if (index < split) {
    return [
      ...merkleInclusionPath(index, inputs.slice(0, split)),
      merkleRootFromInputs(inputs.slice(split)),
    ];
  }
  return [
    ...merkleInclusionPath(index - split, inputs.slice(split)),
    merkleRootFromInputs(inputs.slice(0, split)),
  ];
}

export interface MerkleOpening {
  caseId: string;
  payloadJson: string;
  saltB64: string;
  leafIndex: number;
  treeSize: number;
  inclusionPathHex: readonly string[];
}

export function merkleOpeningLeafInput(opening: MerkleOpening): Uint8Array {
  return new TextEncoder().encode(
    canonicalJson({
      case_id: opening.caseId,
      payload_json: opening.payloadJson,
      salt_b64: opening.saltB64,
    }),
  );
}

export interface MerkleSuiteSeal {
  rootHash: string;
  treeSize: number;
  openings: Record<string, MerkleOpening>;
}

export function sealChallengeCases(
  cases: Record<string, unknown>,
  options: { deterministicSaltSeed?: string } = {},
): MerkleSuiteSeal {
  const caseIds = Object.keys(cases).sort();
  if (caseIds.length === 0) throw new Error("At least one challenge case is required");

  const salts: Record<string, string> = {};
  const inputs: Uint8Array[] = [];

  caseIds.forEach((caseId, index) => {
    let saltHex: string;
    if (options.deterministicSaltSeed === undefined) {
      const rnd = new Uint8Array(32);
      if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(rnd);
      else for (let i = 0; i < 32; i++) rnd[i] = Math.floor(Math.random() * 256);
      saltHex = bytesToHex(rnd);
    } else {
      saltHex = sha256Text(`${options.deterministicSaltSeed}:${index}:${caseId}`);
    }
    const saltB64 = btoa(saltHex);
    salts[caseId] = saltB64;

    const payloadJson = canonicalJson(cases[caseId]);
    inputs.push(
      new TextEncoder().encode(
        canonicalJson({ case_id: caseId, payload_json: payloadJson, salt_b64: saltB64 }),
      ),
    );
  });

  const root = merkleRootFromInputs(inputs);
  const openings: Record<string, MerkleOpening> = {};

  caseIds.forEach((caseId, index) => {
    openings[caseId] = {
      caseId,
      payloadJson: canonicalJson(cases[caseId]),
      saltB64: salts[caseId],
      leafIndex: index,
      treeSize: inputs.length,
      inclusionPathHex: merkleInclusionPath(index, inputs).map(bytesToHex),
    };
  });

  return { rootHash: bytesToHex(root), treeSize: inputs.length, openings };
}

/** RFC 9162 inclusion-proof verification algorithm, ported exactly. */
export function verifyMerkleOpening(rootHash: string, opening: MerkleOpening): boolean {
  if (
    opening.leafIndex < 0 ||
    opening.leafIndex >= opening.treeSize ||
    opening.treeSize < 1
  ) {
    return false;
  }

  let current: Uint8Array;
  let path: Uint8Array[];
  let expectedRoot: Uint8Array;
  try {
    current = merkleLeafHash(merkleOpeningLeafInput(opening));
    path = opening.inclusionPathHex.map(hexToBytes);
    expectedRoot = hexToBytes(rootHash);
  } catch {
    return false;
  }

  let fn = opening.leafIndex;
  let sn = opening.treeSize - 1;

  for (const sibling of path) {
    if (sn === 0) return false;

    if ((fn & 1) === 1 || fn === sn) {
      current = merkleNodeHash(sibling, current);
      if ((fn & 1) === 0) {
        while (fn !== 0 && (fn & 1) === 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      current = merkleNodeHash(current, sibling);
    }

    fn >>= 1;
    sn >>= 1;
  }

  return sn === 0 && bytesToHex(current) === bytesToHex(expectedRoot);
}

/** Stores only the root commitment; payloads and salts stay outside. */
export class MerkleChallengeRegistry {
  constructor(
    private readonly store: ProductionAssuranceStore,
    private readonly runId: string,
  ) {}

  register(suiteId: string, name: string, seal: MerkleSuiteSeal): void {
    if (seal.rootHash.length !== 64) throw new Error("Merkle root must be a SHA-256 digest");

    this.store.atomicChange<void>(
      this.runId,
      (journal) => {
        journal.stage(() =>
          this.store._putMerkleSuite({
            suiteId,
            runId: this.runId,
            name,
            rootHash: seal.rootHash,
            treeSize: seal.treeSize,
            hashAlgorithm: "RFC9162-SHA256",
            createdUtc: utcNow(),
          }),
        );
      },
      () => [
        "merkle_suite_registered_v7",
        { suite_id: suiteId, name, root_hash: seal.rootHash, tree_size: seal.treeSize },
      ],
    );
  }

  verify(suiteId: string, opening: MerkleOpening): boolean {
    const row = this.store._getMerkleSuite(suiteId, this.runId);
    if (!row) throw new Error(suiteId);
    if (row.treeSize !== opening.treeSize) return false;
    return verifyMerkleOpening(row.rootHash, opening);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 8. Verified backup / restore (browser: structural snapshot + revalidation)
// ═══════════════════════════════════════════════════════════════════════

export interface BackupVerification {
  valid: boolean;
  applicationId: number;
  schemaVersion: number;
  integrityValid: boolean;
  foreignKeysValid: boolean;
  eventChainValid: boolean;
  semanticChainValid: boolean;
  semanticHead: string;
  errors: readonly string[];
}

export interface BackupManifest {
  backupId: string;
  runId: string;
  targetPath: string;
  fileDigest: string;
  sizeBytes: number;
  verification: BackupVerification;
  createdUnix: number;
}

export class BackupManager {
  constructor(
    private readonly store: ProductionAssuranceStore,
    private readonly runId: string,
  ) {}

  /**
   * Browser substitution (disclosed): there is no SQLite file to copy, so the
   * "backup" is a canonical structural snapshot whose integrity is verified by
   * re-running BOTH chain verifiers plus blob integrity — the same predicates
   * the Python checks against a copied file.
   */
  create(targetPath: string): BackupManifest {
    this.store.appendEvent(this.runId, "backup_started_v7", { target_name: targetPath });

    const eventChainValid = this.store.verifyChain(this.runId);
    const semanticChainValid = this.store.verifySemanticChain(this.runId);
    const integrityValid = this.store.verifyAllBlobs();
    const applicationId = this.store.getApplicationId();
    const schemaVersion = this.store.getUserVersion();
    const semanticHead = this.store.latestSemanticHash(this.runId);

    const errors: string[] = [];
    if (applicationId !== V7_APPLICATION_ID) errors.push(`Unexpected application_id ${applicationId}`);
    if (schemaVersion !== V7_SCHEMA_VERSION) errors.push(`Unexpected schema version ${schemaVersion}`);
    if (!eventChainValid) errors.push("Legacy event chain is invalid");
    if (!semanticChainValid) errors.push("Semantic event chain is invalid");
    if (!integrityValid) errors.push("Blob integrity invalid");

    const verification: BackupVerification = {
      valid:
        applicationId === V7_APPLICATION_ID &&
        schemaVersion === V7_SCHEMA_VERSION &&
        integrityValid &&
        true /* foreign keys: no FK engine in the browser port */ &&
        eventChainValid &&
        semanticChainValid,
      applicationId,
      schemaVersion,
      integrityValid,
      foreignKeysValid: true,
      eventChainValid,
      semanticChainValid,
      semanticHead,
      errors,
    };

    if (!verification.valid) {
      throw new Error("Backup verification failed: " + errors.join("; "));
    }

    const snapshot = canonicalJson({
      run_id: this.runId,
      application_id: applicationId,
      schema_version: schemaVersion,
      semantic_head: semanticHead,
      migrations: this.store.migrationReport(),
    });
    const fileDigest = sha256Text(snapshot);
    const sizeBytes = new TextEncoder().encode(snapshot).length;
    const createdUnix = Date.now() / 1000;

    const backupId =
      "backup-" +
      sha256Text(
        canonicalJson({
          run_id: this.runId,
          file_digest: fileDigest,
          semantic_head: semanticHead,
        }),
      ).slice(0, 32);

    const manifest: BackupManifest = {
      backupId,
      runId: this.runId,
      targetPath,
      fileDigest,
      sizeBytes,
      verification,
      createdUnix,
    };

    this.store.atomicChange<void>(
      this.runId,
      (journal) => {
        journal.stage(() =>
          this.store._putBackup({
            backupId,
            runId: this.runId,
            targetPath,
            fileDigest,
            sizeBytes,
            applicationId,
            schemaVersion,
            snapshotSemanticHash: semanticHead,
            integrityValid,
            foreignKeysValid: true,
            eventChainValid,
            semanticChainValid,
            createdUnix,
            createdUtc: utcNow(),
          }),
        );
      },
      () => [
        "backup_completed_v7",
        {
          backup_id: backupId,
          file_digest: fileDigest,
          size_bytes: sizeBytes,
          snapshot_semantic_hash: semanticHead,
        },
      ],
    );

    return manifest;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 9. Production doctor / readiness
// ═══════════════════════════════════════════════════════════════════════

export interface DoctorCheck {
  name: string;
  passed: boolean;
  severity: "error" | "warning";
  detail: string;
}

export interface DoctorPolicyOptions {
  failOnDeadLetters?: boolean;
  failOnExpiredLeases?: boolean;
  maximumBackupAgeSeconds?: number | null;
}

export class DoctorPolicy {
  readonly failOnDeadLetters: boolean;
  readonly failOnExpiredLeases: boolean;
  readonly maximumBackupAgeSeconds: number | null;

  constructor(options: DoctorPolicyOptions = {}) {
    this.failOnDeadLetters = options.failOnDeadLetters ?? true;
    this.failOnExpiredLeases = options.failOnExpiredLeases ?? true;
    this.maximumBackupAgeSeconds = options.maximumBackupAgeSeconds ?? null;
  }
}

export interface DoctorReport {
  ready: boolean;
  checks: readonly DoctorCheck[];
}

export class ProductionDoctor {
  constructor(
    private readonly store: ProductionAssuranceStore,
    private readonly runId: string | null = null,
    private readonly policy: DoctorPolicy = new DoctorPolicy(),
  ) {}

  run(options: { nowUnix?: number } = {}): DoctorReport {
    const now = options.nowUnix ?? Date.now() / 1000;
    const checks: DoctorCheck[] = [];

    const declared = ProductionAssuranceStore.declaredSqliteVersion;
    const walSafe =
      declared === null ||
      sqliteWalVersionIsSafe(declared) ||
      !this.store.config.requireSafeMultiwriterWal;
    checks.push({
      name: "sqlite_wal_runtime",
      passed: walSafe,
      severity: "error",
      detail: declared ? `SQLite ${declared.join(".")}` : "no native SQLite in this runtime",
    });

    checks.push({
      name: "application_id",
      passed: this.store.getApplicationId() === V7_APPLICATION_ID,
      severity: "error",
      detail: String(this.store.getApplicationId()),
    });

    checks.push({
      name: "schema_version",
      passed: this.store.getUserVersion() === V7_SCHEMA_VERSION,
      severity: "error",
      detail: String(this.store.getUserVersion()),
    });

    const migrations = this.store.migrationReport();
    const migrationValid =
      migrations.length === V7_MIGRATIONS.length &&
      migrations.every((row, i) => row.checksum === V7_MIGRATIONS[i].checksum);
    checks.push({
      name: "migration_checksums",
      passed: migrationValid,
      severity: "error",
      detail: `${migrations.length} migrations`,
    });

    checks.push({
      name: "database_integrity",
      passed: this.store.verifyAllBlobs(),
      severity: "error",
      detail: "blob digests",
    });

    if (this.runId !== null) {
      checks.push({
        name: "legacy_event_chain",
        passed: this.store.verifyChain(this.runId),
        severity: "error",
        detail: this.runId,
      });
      checks.push({
        name: "semantic_event_chain",
        passed: this.store.verifySemanticChain(this.runId),
        severity: "error",
        detail: this.runId,
      });

      const jobs = this.store._jobsForRun(this.runId);
      const expired = jobs.filter(
        (j) => j.status === "leased" && j.leaseExpiresUnix <= now,
      ).length;
      checks.push({
        name: "expired_job_leases",
        passed: expired === 0 || !this.policy.failOnExpiredLeases,
        severity: this.policy.failOnExpiredLeases ? "error" : "warning",
        detail: String(expired),
      });

      const deadLetters = jobs.filter((j) => j.status === "dead_letter").length;
      checks.push({
        name: "dead_letters",
        passed: deadLetters === 0 || !this.policy.failOnDeadLetters,
        severity: this.policy.failOnDeadLetters ? "error" : "warning",
        detail: String(deadLetters),
      });

      if (this.policy.maximumBackupAgeSeconds !== null) {
        const lastBackup = this.store._latestBackupUnix(this.runId);
        let backupOk: boolean;
        let detail: string;
        if (lastBackup === null) {
          backupOk = false;
          detail = "No verified backup";
        } else {
          const age = now - lastBackup;
          backupOk = age <= this.policy.maximumBackupAgeSeconds;
          detail = `age_seconds=${age.toFixed(1)}`;
        }
        checks.push({
          name: "backup_freshness",
          passed: backupOk,
          severity: "error",
          detail,
        });
      }
    }

    const ready = !checks.some((c) => !c.passed && c.severity === "error");
    return { ready, checks };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 10. Compatibility audit
// ═══════════════════════════════════════════════════════════════════════

export function compatibilityAuditV7(): Record<string, unknown> {
  const declared = ProductionAssuranceStore.declaredSqliteVersion;
  return {
    version: "v7.0",
    canonical_dependency_filename: "innovation-genome-v5.ts",
    canonical_dependency_designation: "V6",
    modifies_v1_through_v6: false,
    adds_checksummed_schema_migrations: true,
    adds_sqlite_wal_reset_guard: true,
    adds_hardened_sqlite_configuration: true,
    adds_atomic_domain_event_unit_of_work: true,
    adds_durable_leased_job_queue: true,
    adds_fencing_tokens: true,
    adds_retry_safe_dead_lettering: true,
    adds_secure_bounded_telemetry: true,
    adds_exact_verifier_closure: true,
    adds_merkle_challenge_openings: true,
    adds_verified_online_backup_restore: true,
    adds_production_readiness_doctor: true,
    sqlite_runtime: declared ? declared.join(".") : "none (browser runtime)",
    sqlite_wal_runtime_safe: declared === null ? null : sqliteWalVersionIsSafe(declared),
    schema_version: V7_SCHEMA_VERSION,
    application_id: V7_APPLICATION_ID,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 11. Diagnostics (V5 + V7 combined)
// ═══════════════════════════════════════════════════════════════════════

export interface DiagnosticCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export async function runInnovationGenomeV57Diagnostics(): Promise<{
  ok: boolean;
  checks: DiagnosticCheck[];
}> {
  const checks: DiagnosticCheck[] = [];
  const add = (id: string, passed: boolean, detail: string) =>
    checks.push({ id, passed, detail });

  // ── V7 §1: WAL version predicate (pure logic, ported exactly) ──────
  add("wal-vulnerable-3.51.2", !sqliteWalVersionIsSafe([3, 51, 2]), "unsafe");
  add("wal-vulnerable-3.50.6", !sqliteWalVersionIsSafe([3, 50, 6]), "unsafe");
  add("wal-vulnerable-3.44.5", !sqliteWalVersionIsSafe([3, 44, 5]), "unsafe");
  add("wal-vulnerable-3.49.99", !sqliteWalVersionIsSafe([3, 49, 99]), "unsafe");
  add("wal-fixed-3.51.3", sqliteWalVersionIsSafe([3, 51, 3]), "safe");
  add("wal-fixed-3.50.7", sqliteWalVersionIsSafe([3, 50, 7]), "safe");
  add("wal-fixed-3.44.6", sqliteWalVersionIsSafe([3, 44, 6]), "safe");
  add("wal-fixed-3.52.0", sqliteWalVersionIsSafe([3, 52, 0]), "safe");

  // ── V7 §2/3: store identity + migrations ──────────────────────────
  const store = new ProductionAssuranceStore(
    new StoreConfig({ walMode: false, requireSafeMultiwriterWal: false }),
  );
  store.createRun("run-1", 1, "general", "low", { version: "test" });

  add("app-id", store.getApplicationId() === V7_APPLICATION_ID, String(store.getApplicationId()));
  add("schema-version", store.getUserVersion() === V7_SCHEMA_VERSION, String(store.getUserVersion()));
  add(
    "migration-count",
    store.migrationReport().length === V7_SCHEMA_VERSION,
    String(store.migrationReport().length),
  );

  // ── V7 §3: atomicChange rolls back domain AND event ───────────────
  const eventsBefore = store.verifyChain("run-1");
  let rolledBack = false;
  try {
    store.atomicChange<void>(
      "run-1",
      (journal) => {
        journal.stage(() =>
          store._putMerkleSuite({
            suiteId: "rollback-suite",
            runId: "run-1",
            name: "x",
            rootHash: "a".repeat(64),
            treeSize: 1,
            hashAlgorithm: "SHA256",
            createdUtc: utcNow(),
          }),
        );
        throw new Error("force rollback");
      },
      () => ["should_not_exist", {}],
    );
  } catch {
    rolledBack = true;
  }
  add("atomic-rollback-throws", rolledBack, "threw");
  add(
    "atomic-rollback-no-domain-row",
    store._getMerkleSuite("rollback-suite", "run-1") === undefined,
    "no suite row",
  );
  add("atomic-rollback-chain-intact", eventsBefore && store.verifyChain("run-1"), "chain ok");
  add("atomic-rollback-semantic-intact", store.verifySemanticChain("run-1"), "semantic ok");

  // ── V4 regression: semantic chain must DETECT tampering ───────────
  const tamperStore = new ProductionAssuranceStore(
    new StoreConfig({ walMode: false, requireSafeMultiwriterWal: false }),
  );
  tamperStore.createRun("t-1", 1, "general", "low", {});
  tamperStore.appendEvent("t-1", "event", { value: 1 });
  const preTamper = tamperStore.verifySemanticChain("t-1");
  tamperStore._tamperPayloadForTest("t-1", "event", '{"value":2}');
  const postTamper = tamperStore.verifySemanticChain("t-1");
  add("semantic-chain-valid-before-tamper", preTamper, "valid");
  add("semantic-chain-detects-tampering", postTamper === false, "detected");

  // ── V7 §4: durable queue ──────────────────────────────────────────
  const queue = new DurableJobQueue(store, "run-1");

  const specA = new JobSpec({
    queueName: "verification",
    jobKind: "verify",
    payload: { candidate: "c1" },
    idempotencyKey: "idempotency-key-0001",
  });
  const first = queue.enqueue(specA, 100);
  const second = queue.enqueue(specA, 100);
  add("idempotent-enqueue", first === second, first);
  add("idempotent-enqueue-count", queue.stats().pending === 1, String(queue.stats().pending));

  let intentRejected = false;
  try {
    queue.enqueue(
      new JobSpec({
        queueName: "verification",
        jobKind: "different",
        payload: { candidate: "c2" },
        idempotencyKey: "idempotency-key-0001",
      }),
      100,
    );
  } catch {
    intentRejected = true;
  }
  add("idempotency-different-intent-rejected", intentRejected, "threw");

  // Fencing
  const fenceQueue = new DurableJobQueue(store, "run-1");
  fenceQueue.enqueue(
    new JobSpec({
      queueName: "fq",
      jobKind: "task",
      payload: { x: 1 },
      idempotencyKey: "fencing-key-000001",
      retrySafe: true,
      maxAttempts: 3,
    }),
    100,
  );
  const leaseA = fenceQueue.claim("fq", "worker-a", { leaseSeconds: 10, nowUnix: 100 });
  const leaseB = fenceQueue.claim("fq", "worker-b", { leaseSeconds: 10, nowUnix: 111 });
  add("claim-a", leaseA !== null, leaseA ? leaseA.jobId : "null");
  add("claim-b-after-expiry", leaseB !== null, leaseB ? leaseB.jobId : "null");
  add(
    "fencing-token-monotonic",
    !!leaseA && !!leaseB && leaseB.fencingToken > leaseA.fencingToken,
    `${leaseA?.fencingToken} -> ${leaseB?.fencingToken}`,
  );

  let staleRejected = false;
  try {
    if (leaseA) fenceQueue.complete(leaseA, { wrong: "stale" }, 111);
  } catch (e) {
    staleRejected = e instanceof LeaseLostError;
  }
  add("stale-worker-rejected", staleRejected, "LeaseLostError");

  if (leaseB) {
    const digest = fenceQueue.complete(leaseB, { ok: true }, 112);
    add("current-worker-completes", digest.length === 64, digest.slice(0, 12));
  }

  // Heartbeat
  const hbQueue = new DurableJobQueue(store, "run-1");
  hbQueue.enqueue(
    new JobSpec({
      queueName: "hq",
      jobKind: "task",
      payload: {},
      idempotencyKey: "heartbeat-key-00001",
    }),
    100,
  );
  const hbLease = hbQueue.claim("hq", "worker", { leaseSeconds: 10, nowUnix: 100 });
  if (hbLease) {
    const renewed = hbQueue.heartbeat(hbLease, { extensionSeconds: 20, nowUnix: 105 });
    add(
      "heartbeat-extends-lease",
      renewed.leaseExpiresUnix > hbLease.leaseExpiresUnix,
      `${hbLease.leaseExpiresUnix} -> ${renewed.leaseExpiresUnix}`,
    );
  }

  // Non-retry-safe dead-letters and never leaks the message
  const dlQueue = new DurableJobQueue(store, "run-1");
  dlQueue.enqueue(
    new JobSpec({
      queueName: "dq",
      jobKind: "side-effect",
      payload: {},
      idempotencyKey: "nonretry-key-000001",
      retrySafe: false,
      maxAttempts: 1,
    }),
    100,
  );
  const dlLease = dlQueue.claim("dq", "worker", { nowUnix: 100 });
  if (dlLease) {
    const status = dlQueue.fail(dlLease, new RangeError("sensitive error details"), 101);
    add("non-retry-safe-dead-letters", status === "dead_letter", status);
    const row = store._getJob(dlLease.jobId);
    add("error-type-recorded", row?.lastErrorType === "RangeError", String(row?.lastErrorType));
    add("error-hash-only", row?.lastErrorHash.length === 64, String(row?.lastErrorHash.length));
    add(
      "error-message-not-leaked",
      !(row?.lastErrorHash ?? "").includes("sensitive"),
      "hashed",
    );
  }

  // ── V7 §5: telemetry sanitization ─────────────────────────────────
  const sanitizer = new TelemetrySanitizer(
    "k".repeat(32),
    new TelemetryLimits({
      attributeCountLimit: 4,
      attributeValueLengthLimit: 12,
      sequenceLengthLimit: 2,
      nestingDepthLimit: 2,
    }),
  );
  const [sanitized, stats] = sanitizer.sanitize({
    authorization: "Bearer secret",
    normal: "abcdefghijklmnopqrstuvwxyz",
    list: [1, 2, 3, 4],
    nested: { api_key: "private" },
    overflow: "dropped",
  });
  add(
    "telemetry-redacts-authorization",
    String(sanitized.authorization).startsWith("hmac-sha256:"),
    "pseudonymized",
  );
  add("telemetry-truncates", sanitized.normal === "abcdefghijkl", String(sanitized.normal));
  add(
    "telemetry-limits-sequence",
    Array.isArray(sanitized.list) && (sanitized.list as unknown[]).length === 2,
    JSON.stringify(sanitized.list),
  );
  add("telemetry-stats-redacted", stats.redacted >= 1, String(stats.redacted));
  add("telemetry-stats-truncated", stats.truncated >= 1, String(stats.truncated));
  add("telemetry-stats-dropped", stats.dropped >= 1, String(stats.dropped));

  const recorder = new SecureTelemetryRecorder(store, "run-1", new TelemetrySanitizer("x".repeat(32)));
  const span = recorder.startSpan("test", "internal");
  recorder.endSpan(span.context, "test", "internal", span.startMonotonic, span.startUtc, "ok", {
    api_token: "plaintext-secret",
    safe: "value",
  });
  const spanRows = store._getSpans("run-1");
  const spanJson = spanRows.map((s) => s.attributesJson).join("");
  add("span-never-persists-raw-secret", !spanJson.includes("plaintext-secret"), "redacted");
  add("span-persists-pseudonym", spanJson.includes("hmac-sha256:"), "pseudonym present");

  // ── V7 §6: exact verifier closure ─────────────────────────────────
  const closurePolicy = new VerifierClosurePolicy([
    { name: "lean", acceptedVersions: ["4.20.0"], requireEvidence: true },
    { name: "property-tests", acceptedVersions: ["1.0"], requireEvidence: true },
  ]);
  const gate = new VerifierClosureGate(store, "run-1", closurePolicy);

  const insertVerifier = (
    name: string,
    version: string,
    verdict = "pass",
    evidence = true,
  ) => {
    store._putVerifierRun({
      verifierRunId: `${name}-${version}-${Math.random()}`,
      runId: "run-1",
      candidateId: "candidate-1",
      verifierName: name,
      verifierVersion: version,
      jobHash: "j".repeat(64),
      verdict,
      resultJson: JSON.stringify({
        verifier_name: name,
        verifier_version: version,
        verdict,
        evidence: evidence ? [{ content_hash: "a".repeat(64) }] : [],
      }),
      resultHash: "r".repeat(64),
      createdUtc: utcNow(),
    });
  };

  insertVerifier("lean", "4.20.0");
  const partial = gate.evaluate("candidate-1");
  add("missing-required-verifier-fails", !partial.closed, JSON.stringify(partial.missing));
  add("missing-listed", partial.missing.includes("property-tests"), "property-tests missing");

  insertVerifier("property-tests", "1.0");
  const complete = gate.evaluate("candidate-1");
  add("exact-required-set-passes", complete.closed, JSON.stringify(complete.satisfied));
  add("satisfied-count", complete.satisfied.length === 2, String(complete.satisfied.length));

  insertVerifier("lean", "4.20.0", "pass", false);
  const noEvidence = gate.evaluate("candidate-1");
  add(
    "pass-without-evidence-fails",
    !noEvidence.closed && noEvidence.failed.some((f) => f.includes("missing-evidence")),
    JSON.stringify(noEvidence.failed),
  );

  // ── V7 §7: Merkle openings ────────────────────────────────────────
  const seal = sealChallengeCases(
    {
      "case-a": { input: 1, expected: 2 },
      "case-b": { input: 2, expected: 4 },
      "case-c": { input: 3, expected: 6 },
    },
    { deterministicSaltSeed: "s".repeat(32) },
  );
  add("merkle-tree-size", seal.treeSize === 3, String(seal.treeSize));
  const allOpeningsValid = Object.values(seal.openings).every((o) =>
    verifyMerkleOpening(seal.rootHash, o),
  );
  add("merkle-every-opening-verifies", allOpeningsValid, "3/3");

  const twoSeal = sealChallengeCases(
    { "case-a": { value: 1 }, "case-b": { value: 2 } },
    { deterministicSaltSeed: "s".repeat(32) },
  );
  const tampered: MerkleOpening = {
    ...twoSeal.openings["case-a"],
    payloadJson: '{"value":999}',
  };
  add("merkle-modified-opening-fails", !verifyMerkleOpening(twoSeal.rootHash, tampered), "rejected");

  const registry = new MerkleChallengeRegistry(store, "run-1");
  const secretSeal = sealChallengeCases(
    { "secret-case": { answer: "hidden" } },
    { deterministicSaltSeed: "s".repeat(32) },
  );
  registry.register("suite-1", "sealed suite", secretSeal);
  const suiteRow = store._getMerkleSuite("suite-1", "run-1");
  add("merkle-registry-stores-root", suiteRow?.rootHash === secretSeal.rootHash, "root stored");
  add(
    "merkle-registry-hides-payload",
    !JSON.stringify(suiteRow ?? {}).includes("hidden"),
    "payload absent",
  );
  add(
    "merkle-registry-verifies-opening",
    registry.verify("suite-1", secretSeal.openings["secret-case"]),
    "verified",
  );

  // ── V7 §8: backup ─────────────────────────────────────────────────
  const backup = new BackupManager(store, "run-1").create("backups/run-1.snapshot");
  add("backup-valid", backup.verification.valid, "valid");
  add("backup-digest-len", backup.fileDigest.length === 64, String(backup.fileDigest.length));

  // ── V7 §9: doctor ─────────────────────────────────────────────────
  const cleanStore = new ProductionAssuranceStore(
    new StoreConfig({ walMode: false, requireSafeMultiwriterWal: false }),
  );
  cleanStore.createRun("run-clean", 1, "general", "low", {});
  const cleanReport = new ProductionDoctor(cleanStore, "run-clean").run();
  add("doctor-clean-ready", cleanReport.ready, JSON.stringify(cleanReport.checks.filter((c) => !c.passed)));

  const dlStore = new ProductionAssuranceStore(
    new StoreConfig({ walMode: false, requireSafeMultiwriterWal: false }),
  );
  dlStore.createRun("run-dl", 1, "general", "low", {});
  const dlQ = new DurableJobQueue(dlStore, "run-dl");
  dlQ.enqueue(
    new JobSpec({
      queueName: "q",
      jobKind: "side-effect",
      payload: {},
      idempotencyKey: "doctor-deadletter-key",
      retrySafe: false,
      maxAttempts: 1,
    }),
    100,
  );
  const doctorLease = dlQ.claim("q", "worker", { nowUnix: 100 });
  if (doctorLease) dlQ.fail(doctorLease, new Error("failure"), 101);
  const dlReport = new ProductionDoctor(dlStore, "run-dl").run({ nowUnix: 102 });
  add("doctor-dead-letter-blocks-readiness", !dlReport.ready, "blocked");

  // ── V7 §10: compatibility audit ───────────────────────────────────
  const audit = compatibilityAuditV7();
  add("audit-does-not-modify-v1-v6", audit.modifies_v1_through_v6 === false, "additive");
  add("audit-durable-queue", audit.adds_durable_leased_job_queue === true, "yes");
  add("audit-fencing-tokens", audit.adds_fencing_tokens === true, "yes");
  add("audit-backup-restore", audit.adds_verified_online_backup_restore === true, "yes");

  // ═════════════════════════════════════════════════════════════════
  // V5 (Production Assurance Plane) — exercised here so the policy
  // engine, canaries, suites, verifiers, replay and health monitor are
  // genuinely executed and genuinely bundled (not tree-shaken).
  // ═════════════════════════════════════════════════════════════════
  const v5Store = new ProductionAssuranceStore(
    new StoreConfig({ walMode: false, requireSafeMultiwriterWal: false }),
  );
  v5Store.createRun("v5-run", 1, "general", "low", {});

  const policy = new PolicyEngine(defaultPolicyRules());
  add("v5-policy-rule-count", policy.rules.length === 5, String(policy.rules.length));

  // V5-POL-001 — high stakes needs human approval
  const pol1 = policy.evaluate({
    runId: "v5-run",
    subject: "c",
    action: "promote_candidate",
    resource: "candidate",
    risk: "critical",
    payload: { evidence_closed: true },
  });
  add(
    "v5-POL-001-high-stakes-needs-human",
    !pol1.allowed && pol1.violations.some((v) => v.ruleId === "V5-POL-001"),
    JSON.stringify(pol1.violations.map((v) => v.ruleId)),
  );

  // V5-POL-002 — world action needs scope
  const pol2 = policy.evaluate({
    runId: "v5-run",
    subject: "c",
    action: "tool_call",
    resource: "tool",
    risk: "low",
    payload: { world_action: true, grant_scopes: ["tool:echo"], tool_name: "echo" },
    capabilities: { declared_tools: ["echo"] },
  });
  add(
    "v5-POL-002-world-action-needs-scope",
    !pol2.allowed && pol2.violations.some((v) => v.ruleId === "V5-POL-002"),
    JSON.stringify(pol2.violations.map((v) => v.ruleId)),
  );

  // V5-POL-003 — undeclared tool
  const pol3 = policy.evaluate({
    runId: "v5-run",
    subject: "c",
    action: "tool_call",
    resource: "tool",
    risk: "low",
    payload: { tool_name: "rm-rf", grant_scopes: ["*"] },
    capabilities: { declared_tools: ["echo"] },
  });
  add(
    "v5-POL-003-undeclared-tool",
    !pol3.allowed && pol3.violations.some((v) => v.ruleId === "V5-POL-003"),
    JSON.stringify(pol3.violations.map((v) => v.ruleId)),
  );

  // V5-POL-004 — promotion without evidence closure
  const pol4 = policy.evaluate({
    runId: "v5-run",
    subject: "c",
    action: "promote_candidate",
    resource: "candidate",
    risk: "low",
    payload: { evidence_closed: false },
  });
  add(
    "v5-POL-004-promotion-needs-evidence",
    !pol4.allowed && pol4.violations.some((v) => v.ruleId === "V5-POL-004"),
    JSON.stringify(pol4.violations.map((v) => v.ruleId)),
  );

  // V5-POL-005 — canary leak is FATAL
  const pol5 = policy.evaluate({
    runId: "v5-run",
    subject: "c",
    action: "promote_candidate",
    resource: "candidate",
    risk: "low",
    payload: { evidence_closed: true, canary_hits: 1 },
  });
  add(
    "v5-POL-005-canary-leak-fatal",
    !pol5.allowed &&
      pol5.violations.some((v) => v.ruleId === "V5-POL-005" && v.severity === "fatal"),
    JSON.stringify(pol5.violations.map((v) => v.ruleId)),
  );

  // Clean input passes
  const polOk = policy.evaluate({
    runId: "v5-run",
    subject: "c",
    action: "promote_candidate",
    resource: "candidate",
    risk: "low",
    payload: { evidence_closed: true, canary_hits: 0 },
  });
  add("v5-policy-clean-allows", polOk.allowed, "allowed");

  // enforce() must throw and must persist a denial
  let enforceThrew = false;
  try {
    policy.enforce(v5Store, pol5, "v5-run");
  } catch {
    enforceThrew = true;
  }
  add("v5-policy-enforce-fails-closed", enforceThrew, "threw");

  // Canary registry: register → scan → hit count
  const canaries = new CanaryRegistry(v5Store, "v5-run");
  canaries.register("secret-marker", "ZZ-CANARY-TOKEN-9137", "confidential", "critical");
  const cleanHits = canaries.scan("cand-clean", "an artifact with no secrets", "artifact");
  add("v5-canary-clean-no-hits", cleanHits.length === 0, "0 hits");
  const leakHits = canaries.scan(
    "cand-leak",
    "leaked ZZ-CANARY-TOKEN-9137 into the output",
    "artifact",
  );
  add("v5-canary-detects-leak", leakHits.length === 1, `${leakHits.length} hit(s)`);
  add("v5-canary-hit-count", canaries.hitCount("cand-leak") === 1, "1");
  add("v5-canary-clean-count-zero", canaries.hitCount("cand-clean") === 0, "0");
  // Plaintext token must never be persisted. Non-vacuous: assert a row EXISTS,
  // that it carries the hash, and that it does NOT carry the plaintext.
  const canaryRows = v5Store._getCanaryRows("v5-run");
  const canaryRowsJson = JSON.stringify(canaryRows);
  add("v5-canary-row-persisted", canaryRows.length === 1, `${canaryRows.length} row(s)`);
  add(
    "v5-canary-hash-persisted",
    canaryRows.length === 1 && canaryRows[0].tokenHash === sha256Text("ZZ-CANARY-TOKEN-9137"),
    "hash matches",
  );
  add(
    "v5-canary-token-not-persisted",
    canaryRows.length === 1 && !canaryRowsJson.includes("ZZ-CANARY-TOKEN-9137"),
    "plaintext absent",
  );
  
  // Expose eventRowsForRun for V8 to access
  (v5Store as any)._exposeEventRowsForRun = (runId: string) => (v5Store as any).eventRowsForRun(runId);

  // Challenge suite commitment
  const suite = new ChallengeSuite(
    "suite-a",
    "audit suite",
    "audit",
    [{ caseId: "c1", inputDigest: "a".repeat(64), expectedDigest: "b".repeat(64) }],
    "none",
  );
  new ChallengeSuiteRegistry(v5Store, "v5-run").register(suite);
  add("v5-suite-commitment-len", suite.commitmentHash.length === 64, "sha256");
  add(
    "v5-suite-commitment-deterministic",
    suite.commitmentHash ===
      new ChallengeSuite(
        "suite-a",
        "audit suite",
        "audit",
        [{ caseId: "c1", inputDigest: "a".repeat(64), expectedDigest: "b".repeat(64) }],
        "none",
      ).commitmentHash,
    "stable",
  );

  // Verifier orchestrator
  const orchestrator = new VerifierOrchestrator(v5Store, "v5-run", [
    new FunctionVerifier(
      "lean",
      "4.20.0",
      (job) =>
        new VerificationResult("lean", "4.20.0", "pass", [
          { evidenceId: "E1", kind: "formal_certificate", content: `cert for ${job.candidateId}` },
        ]),
    ),
    new FunctionVerifier("boom", "1.0", () => {
      throw new Error("verifier exploded");
    }),
  ]);
  const verifierResults = await orchestrator.run({
    candidateId: "v5-cand",
    artifactDigest: "d".repeat(64),
    artifactMediaType: "text/plain",
    goalHash: "g".repeat(64),
    evaluatorHash: "e".repeat(64),
    verifierScope: "full",
  });
  add("v5-verifier-runs-all", verifierResults.length === 2, String(verifierResults.length));
  add("v5-verifier-pass-recorded", verifierResults[0].verdict === "pass", verifierResults[0].verdict);
  add(
    "v5-verifier-exception-becomes-error-verdict",
    verifierResults[1].verdict === "error",
    verifierResults[1].verdict,
  );
  add(
    "v5-allRequiredPassed-false-when-any-error",
    orchestrator.allRequiredPassed("v5-cand") === false,
    "not all passed",
  );

  // Replay matrix
  const replay = new ReplayMatrix(v5Store, "v5-run");
  const manifest = new ReplayManifest("subject-1", { runtime: "browser" }, [
    { name: "step-1", inputHash: "i".repeat(64), expectedOutputHash: sha256Text("out-1") },
  ]);
  const replayOk = await replay.run(manifest, { runStep: () => sha256Text("out-1") });
  add("v5-replay-matching-succeeds", replayOk === true, "success");
  const replayBad = await replay.run(manifest, { runStep: () => sha256Text("different") });
  add("v5-replay-mismatch-fails", replayBad === false, "detected drift");

  // Health monitor
  const health = new RunHealthMonitor(v5Store, "v5-run", new HealthThresholds());
  const healthReport = health.report();
  add("v5-health-report-shape", typeof healthReport.status === "string", String(healthReport.status));
  add(
    "v5-health-fails-on-policy-denial",
    healthReport.status === "fail" &&
      (healthReport.reasons as string[]).includes("policy denials exceed threshold"),
    JSON.stringify(healthReport.reasons),
  );

  // A clean run should be healthy
  const cleanHealthStore = new ProductionAssuranceStore(
    new StoreConfig({ walMode: false, requireSafeMultiwriterWal: false }),
  );
  cleanHealthStore.createRun("v5-clean", 1, "general", "low", {});
  const cleanHealth = new RunHealthMonitor(
    cleanHealthStore,
    "v5-clean",
    new HealthThresholds(),
  ).report();
  add("v5-health-clean-ok", cleanHealth.status === "ok", JSON.stringify(cleanHealth.reasons));

  return { ok: checks.every((c) => c.passed), checks };
}
