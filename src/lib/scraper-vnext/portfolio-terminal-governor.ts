/**
 * portfolio-terminal-governor.ts
 * ============================================================================
 * Corrective, context-scoped memory governor over portfolio-consensus-memory.ts.
 * Additive only. Default behavior preserves canonical evidence and records
 * advisory telemetry after the run.
 */

import {
  ENGINE_FAMILY,
  familyOf,
  groundWithAdaptivePortfolioConsensus as canonicalMemoryGround,
  groundWithPortfolioConsensus,
} from "./portfolio-consensus-memory";
import {
  extractClaimTexts,
  tokenJaccard,
  type PortfolioConsensusOptions,
  type PortfolioConsensusResult,
} from "./portfolio-consensus-adjudicator";
import type { AgreementCell, CanonicalLaneId, LaneExecution } from "./canonical-portfolio-orchestrator";

const MEMORY_EPOCH = "portfolio-terminal-governor-v1";
const DB_NAME = "portfolio-terminal-governor";
const DB_VERSION = 1;
const STORE_LANE = "lane-health";
const STORE_PAIR = "family-pairs";

const CANONICAL_PRIORITY: CanonicalLaneId[] = [
  "terminal-wire",
  "sentinel-orchestrator",
  "vanguard-packer",
  "sentinel-omega",
  "omni-nexus",
  "structured-search",
];

const WINNER_ELIGIBLE = new Set<CanonicalLaneId>([
  "terminal-wire",
  "sentinel-orchestrator",
  "vanguard-packer",
  "sentinel-omega",
  "omni-nexus",
]);

export interface TerminalGovernorOptions extends PortfolioConsensusOptions {
  memoryProfile?: string;
  adaptiveQuarantine?: boolean;
  quarantineMinSamples?: number;
  quarantineCooldownMs?: number;
  minimumEnabledLanes?: number;
  minimumIndependentFamilies?: number;
  claimEchoThreshold?: number;
  blockEchoThreshold?: number;
  topClaims?: number;
  recordMemory?: boolean;
  requestPersistentStorage?: boolean;
  memoryEpoch?: string;
}

export interface LaneHealth {
  laneId: CanonicalLaneId;
  profile: string;
  fulfilled: number;
  acceptable: number;
  wins: number;
  rejected: number;
  timedOut: number;
  aborted: number;
  completedSamples: number;
  hardFailureCount: number;
  claimComparableRuns: number;
  strictClaimEchoRuns: number;
  availabilityPosterior: number;
  acceptabilityPosterior: number;
  strictEchoPosterior: number;
  rawWinRate: number;
  meanFulfilledMs: number;
  recencyWeight: number;
  advisoryUtility: number;
  lastSeenAt: number;
}

export interface FamilyPairPrior {
  familyA: string;
  familyB: string;
  profile: string;
  claimObservations: number;
  claimEchoes: number;
  claimEchoRate: number;
  blockObservations: number;
  blockEchoes: number;
  blockEchoRate: number;
  lastSeenAt: number;
}

export interface SafeLanePlan {
  enableLanes: Partial<Record<CanonicalLaneId, boolean>>;
  requestedLanes: CanonicalLaneId[];
  enabledLanes: CanonicalLaneId[];
  temporarilyQuarantined: Array<{ laneId: CanonicalLaneId; until: number; reason: string }>;
  protectedLanes: CanonicalLaneId[];
  enabledWinnerFamilies: string[];
}

export interface TerminalMemorySnapshot {
  epoch: string;
  profile: string;
  laneHealth: LaneHealth[];
  familyPriors: FamilyPairPrior[];
}

export interface TerminalGovernorMetadata {
  plan: SafeLanePlan;
  snapshot: TerminalMemorySnapshot;
  persistence: "not-requested" | "granted" | "denied" | "unavailable";
  strictCorroboratingFamilies: Record<string, string[]>;
  caveat: string;
}

type CanonicalMemoryResult = Awaited<ReturnType<typeof canonicalMemoryGround>>;
export type TerminalGovernorResult = CanonicalMemoryResult & { terminalGovernor: TerminalGovernorMetadata };

interface LaneHealthRecord {
  key: string;
  epoch: string;
  profile: string;
  laneId: CanonicalLaneId;
  fulfilled: number;
  acceptable: number;
  wins: number;
  rejected: number;
  timedOut: number;
  aborted: number;
  claimComparableRuns: number;
  strictClaimEchoRuns: number;
  totalFulfilledMs: number;
  lastSeenAt: number;
}

interface FamilyPairRecord {
  key: string;
  epoch: string;
  profile: string;
  familyA: string;
  familyB: string;
  claimObservations: number;
  claimEchoes: number;
  blockObservations: number;
  blockEchoes: number;
  lastSeenAt: number;
}

type StoreName = typeof STORE_LANE | typeof STORE_PAIR;
const MEMORY_LANE = new Map<string, LaneHealthRecord>();
const MEMORY_PAIR = new Map<string, FamilyPairRecord>();

function mirrorFor(store: StoreName): Map<string, any> {
  return store === STORE_LANE ? MEMORY_LANE : MEMORY_PAIR;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_LANE)) db.createObjectStore(STORE_LANE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(STORE_PAIR)) db.createObjectStore(STORE_PAIR, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function readRecord<T extends { key: string }>(store: StoreName, key: string): Promise<T | null> {
  const mirror = mirrorFor(store);
  const fallback = (mirror.get(key) as T | undefined) ?? null;
  const db = await openDb();
  if (!db) return fallback;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => {
        const result = (request.result as T | undefined) ?? fallback;
        if (result) mirror.set(key, result);
        resolve(result);
      };
      request.onerror = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
}

async function readAllRecords<T extends { key: string }>(store: StoreName): Promise<T[]> {
  const mirror = mirrorFor(store);
  const db = await openDb();
  if (!db) return Array.from(mirror.values()) as T[];
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => {
        const merged = new Map<string, T>();
        for (const record of request.result as T[]) {
          merged.set(record.key, record);
          mirror.set(record.key, record);
        }
        for (const record of mirror.values()) merged.set(record.key, record as T);
        resolve(Array.from(merged.values()));
      };
      request.onerror = () => resolve(Array.from(mirror.values()) as T[]);
    } catch {
      resolve(Array.from(mirror.values()) as T[]);
    }
  });
}

async function updateRecord<T extends { key: string }>(store: StoreName, key: string, create: () => T, mutate: (record: T) => void): Promise<void> {
  const mirror = mirrorFor(store);
  const db = await openDb();
  if (!db) {
    const record = (mirror.get(key) as T | undefined) ?? create();
    mutate(record);
    mirror.set(key, record);
    return;
  }
  await new Promise<void>((resolve) => {
    let completed = false;
    const finish = () => {
      if (!completed) {
        completed = true;
        resolve();
      }
    };
    const updateMirror = () => {
      const record = (mirror.get(key) as T | undefined) ?? create();
      mutate(record);
      mirror.set(key, record);
    };
    try {
      const tx = db.transaction(store, "readwrite");
      const objectStore = tx.objectStore(store);
      const request = objectStore.get(key);
      request.onsuccess = () => {
        const record = (request.result as T | undefined) ?? (mirror.get(key) as T | undefined) ?? create();
        mutate(record);
        mirror.set(key, record);
        objectStore.put(record);
      };
      request.onerror = updateMirror;
      tx.oncomplete = finish;
      tx.onerror = () => { updateMirror(); finish(); };
      tx.onabort = () => { updateMirror(); finish(); };
    } catch {
      updateMirror();
      finish();
    }
  });
}

function normalizeProfile(profile: string | undefined): string {
  const normalized = (profile ?? "global").trim().replace(/[^a-z0-9.-]/gi, "").slice(0, 64);
  return normalized || "global";
}

function normalizeEpoch(epoch: string | undefined): string {
  const normalized = (epoch ?? MEMORY_EPOCH).trim().replace(/[^a-z0-9.-]/gi, "").slice(0, 96);
  return normalized || MEMORY_EPOCH;
}

function laneKey(epoch: string, profile: string, laneId: CanonicalLaneId): string {
  return [epoch, profile, laneId].join("\u0000");
}

function sortedFamilyPair(left: string, right: string): [string, string] {
  return left <= right ? [left, right] : [right, left];
}

function pairKey(epoch: string, profile: string, familyA: string, familyB: string): string {
  const [left, right] = sortedFamilyPair(familyA, familyB);
  return [epoch, profile, left, right].join("\u0000");
}

function recencyWeight(lastSeenAt: number, halfLifeDays = 14): number {
  if (lastSeenAt <= 0) return 0;
  const ageDays = Math.max(0, (Date.now() - lastSeenAt) / 86_400_000);
  return Math.exp((-Math.LN2 / halfLifeDays) * ageDays);
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function boundedUnit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function agreementValue(agreement: AgreementCell[], left: CanonicalLaneId, right: CanonicalLaneId): number | undefined {
  for (const cell of agreement) {
    if ((cell.left === left && cell.right === right) || (cell.left === right && cell.right === left)) return cell.tokenJaccard;
  }
  return undefined;
}

function strictClaimEcho(leftClaims: string[], rightClaims: string[], threshold: number): boolean {
  return leftClaims.some((left) => rightClaims.some((right) => tokenJaccard(left, right) >= threshold));
}

async function rawLaneRecord(laneId: CanonicalLaneId, profile: string, epoch: string): Promise<LaneHealthRecord> {
  const key = laneKey(epoch, profile, laneId);
  return (await readRecord<LaneHealthRecord>(STORE_LANE, key)) ?? {
    key, epoch, profile, laneId,
    fulfilled: 0, acceptable: 0, wins: 0, rejected: 0, timedOut: 0, aborted: 0,
    claimComparableRuns: 0, strictClaimEchoRuns: 0, totalFulfilledMs: 0, lastSeenAt: 0,
  };
}

export async function getTerminalLaneHealth(laneId: CanonicalLaneId, options?: { memoryProfile?: string; memoryEpoch?: string }): Promise<LaneHealth> {
  const profile = normalizeProfile(options?.memoryProfile);
  const epoch = normalizeEpoch(options?.memoryEpoch);
  const record = await rawLaneRecord(laneId, profile, epoch);
  const completedSamples = record.fulfilled + record.rejected + record.timedOut;
  const hardFailureCount = record.rejected + record.timedOut;
  const availabilityPosterior = (record.fulfilled + 1) / (completedSamples + 2);
  const acceptabilityPosterior = (record.acceptable + 1) / (record.fulfilled + 2);
  const strictEchoPosterior = (record.strictClaimEchoRuns + 1) / (record.claimComparableRuns + 2);
  const rawWinRate = record.fulfilled > 0 ? record.wins / record.fulfilled : 0;
  const meanFulfilledMs = record.fulfilled > 0 ? record.totalFulfilledMs / record.fulfilled : 0;
  const recency = recencyWeight(record.lastSeenAt);
  const advisoryUtility = availabilityPosterior * acceptabilityPosterior * (0.5 + 0.5 * strictEchoPosterior) * (record.lastSeenAt > 0 ? recency : 1);
  return { laneId, profile, fulfilled: record.fulfilled, acceptable: record.acceptable, wins: record.wins, rejected: record.rejected, timedOut: record.timedOut, aborted: record.aborted, completedSamples, hardFailureCount, claimComparableRuns: record.claimComparableRuns, strictClaimEchoRuns: record.strictClaimEchoRuns, availabilityPosterior, acceptabilityPosterior, strictEchoPosterior, rawWinRate, meanFulfilledMs, recencyWeight: recency, advisoryUtility, lastSeenAt: record.lastSeenAt };
}

export async function getTerminalFamilyPrior(familyA: string, familyB: string, options?: { memoryProfile?: string; memoryEpoch?: string }): Promise<FamilyPairPrior> {
  const profile = normalizeProfile(options?.memoryProfile);
  const epoch = normalizeEpoch(options?.memoryEpoch);
  const [left, right] = sortedFamilyPair(familyA, familyB);
  const key = pairKey(epoch, profile, left, right);
  const record = (await readRecord<FamilyPairRecord>(STORE_PAIR, key)) ?? { key, epoch, profile, familyA: left, familyB: right, claimObservations: 0, claimEchoes: 0, blockObservations: 0, blockEchoes: 0, lastSeenAt: 0 };
  return { familyA: left, familyB: right, profile, claimObservations: record.claimObservations, claimEchoes: record.claimEchoes, claimEchoRate: record.claimObservations > 0 ? record.claimEchoes / record.claimObservations : 0, blockObservations: record.blockObservations, blockEchoes: record.blockEchoes, blockEchoRate: record.blockObservations > 0 ? record.blockEchoes / record.blockObservations : 0, lastSeenAt: record.lastSeenAt };
}

export async function getTerminalMemorySnapshot(options?: { memoryProfile?: string; memoryEpoch?: string; laneIds?: CanonicalLaneId[] }): Promise<TerminalMemorySnapshot> {
  const profile = normalizeProfile(options?.memoryProfile);
  const epoch = normalizeEpoch(options?.memoryEpoch);
  const laneIds = options?.laneIds ?? (Object.keys(ENGINE_FAMILY) as CanonicalLaneId[]);
  const laneHealth = await Promise.all(laneIds.map((laneId) => getTerminalLaneHealth(laneId, { memoryProfile: profile, memoryEpoch: epoch })));
  const pairRecords = await readAllRecords<FamilyPairRecord>(STORE_PAIR);
  const familyPriors = pairRecords.filter((record) => record.epoch === epoch && record.profile === profile).map((record) => ({ familyA: record.familyA, familyB: record.familyB, profile, claimObservations: record.claimObservations, claimEchoes: record.claimEchoes, claimEchoRate: record.claimObservations > 0 ? record.claimEchoes / record.claimObservations : 0, blockObservations: record.blockObservations, blockEchoes: record.blockEchoes, blockEchoRate: record.blockObservations > 0 ? record.blockEchoes / record.blockObservations : 0, lastSeenAt: record.lastSeenAt }));
  return { epoch, profile, laneHealth, familyPriors };
}

interface PairRunAggregate { familyA: string; familyB: string; claimComparable: boolean; claimEcho: boolean; blockComparable: boolean; blockEcho: boolean; }

async function recordCompletedRun(result: PortfolioConsensusResult, options: { profile: string; epoch: string; claimEchoThreshold: number; blockEchoThreshold: number; topClaims: number }): Promise<Record<string, string[]>> {
  const fulfilled = result.laneResults.filter((lane): lane is LaneExecution & { status: "fulfilled" } => lane.status === "fulfilled");
  const claimsByLane = new Map<CanonicalLaneId, string[]>();
  for (const lane of fulfilled) claimsByLane.set(lane.id, extractClaimTexts(lane.raw).slice(0, options.topClaims));
  const pairAggregates = new Map<string, PairRunAggregate>();

  for (let left = 0; left < fulfilled.length; left += 1) {
    for (let right = left + 1; right < fulfilled.length; right += 1) {
      const a = fulfilled[left];
      const b = fulfilled[right];
      const familyA = familyOf(a.id);
      const familyB = familyOf(b.id);
      if (familyA === familyB) continue;
      const [first, second] = sortedFamilyPair(familyA, familyB);
      const key = pairKey(options.epoch, options.profile, first, second);
      const aggregate = pairAggregates.get(key) ?? { familyA: first, familyB: second, claimComparable: false, claimEcho: false, blockComparable: false, blockEcho: false };
      const leftClaims = claimsByLane.get(a.id) ?? [];
      const rightClaims = claimsByLane.get(b.id) ?? [];
      if (leftClaims.length > 0 && rightClaims.length > 0) {
        aggregate.claimComparable = true;
        if (strictClaimEcho(leftClaims, rightClaims, options.claimEchoThreshold)) aggregate.claimEcho = true;
      }
      const blockAgreement = agreementValue(result.agreement, a.id, b.id);
      if (blockAgreement !== undefined) {
        aggregate.blockComparable = true;
        if (blockAgreement >= options.blockEchoThreshold) aggregate.blockEcho = true;
      }
      pairAggregates.set(key, aggregate);
    }
  }

  const strictFamiliesByLane = new Map<CanonicalLaneId, Set<string>>();
  const comparableFamilies = new Set<string>();
  for (const aggregate of pairAggregates.values()) {
    if (aggregate.claimComparable) {
      comparableFamilies.add(aggregate.familyA);
      comparableFamilies.add(aggregate.familyB);
    }
    if (aggregate.claimEcho) {
      for (const lane of fulfilled) {
        const family = familyOf(lane.id);
        const other = family === aggregate.familyA ? aggregate.familyB : family === aggregate.familyB ? aggregate.familyA : null;
        if (other) {
          const set = strictFamiliesByLane.get(lane.id) ?? new Set<string>();
          set.add(other);
          strictFamiliesByLane.set(lane.id, set);
        }
      }
    }
    const key = pairKey(options.epoch, options.profile, aggregate.familyA, aggregate.familyB);
    await updateRecord<FamilyPairRecord>(STORE_PAIR, key, () => ({ key, epoch: options.epoch, profile: options.profile, familyA: aggregate.familyA, familyB: aggregate.familyB, claimObservations: 0, claimEchoes: 0, blockObservations: 0, blockEchoes: 0, lastSeenAt: 0 }), (record) => {
      if (aggregate.claimComparable) record.claimObservations += 1;
      if (aggregate.claimEcho) record.claimEchoes += 1;
      if (aggregate.blockComparable) record.blockObservations += 1;
      if (aggregate.blockEcho) record.blockEchoes += 1;
      record.lastSeenAt = Date.now();
    });
  }

  for (const lane of result.laneResults) {
    const key = laneKey(options.epoch, options.profile, lane.id);
    await updateRecord<LaneHealthRecord>(STORE_LANE, key, () => ({ key, epoch: options.epoch, profile: options.profile, laneId: lane.id, fulfilled: 0, acceptable: 0, wins: 0, rejected: 0, timedOut: 0, aborted: 0, claimComparableRuns: 0, strictClaimEchoRuns: 0, totalFulfilledMs: 0, lastSeenAt: 0 }), (record) => {
      if (lane.status === "fulfilled") {
        record.fulfilled += 1;
        record.totalFulfilledMs += Math.max(0, lane.elapsedMs);
        if (lane.normalized?.acceptable === true) record.acceptable += 1;
        if (lane.id === result.winnerLane) record.wins += 1;
        if (comparableFamilies.has(familyOf(lane.id))) record.claimComparableRuns += 1;
        if ((strictFamiliesByLane.get(lane.id)?.size ?? 0) > 0) record.strictClaimEchoRuns += 1;
      } else if (lane.status === "rejected") record.rejected += 1;
      else if (lane.status === "timed-out") record.timedOut += 1;
      else if (lane.status === "aborted") record.aborted += 1;
      record.lastSeenAt = Date.now();
    });
  }

  const strictCorroboratingFamilies: Record<string, string[]> = {};
  for (const lane of result.laneResults) strictCorroboratingFamilies[lane.id] = Array.from(strictFamiliesByLane.get(lane.id) ?? []).sort();
  return strictCorroboratingFamilies;
}

export async function buildSafeLanePlan(portfolioOptions: PortfolioConsensusOptions, memoryOptions?: { memoryProfile?: string; memoryEpoch?: string; quarantineMinSamples?: number; quarantineCooldownMs?: number; minimumEnabledLanes?: number; minimumIndependentFamilies?: number }): Promise<SafeLanePlan> {
  const profile = normalizeProfile(memoryOptions?.memoryProfile);
  const epoch = normalizeEpoch(memoryOptions?.memoryEpoch);
  const minSamples = boundedInteger(memoryOptions?.quarantineMinSamples, 5, 1, 1_000);
  const cooldownMs = boundedInteger(memoryOptions?.quarantineCooldownMs, 60 * 60_000, 1_000, 7 * 24 * 60 * 60_000);
  const minimumEnabled = boundedInteger(memoryOptions?.minimumEnabledLanes, 2, 2, CANONICAL_PRIORITY.length);
  const requested = CANONICAL_PRIORITY.filter((laneId) => portfolioOptions.enableLanes?.[laneId] !== false);
  const requestedWinnerLanes = requested.filter((laneId) => WINNER_ELIGIBLE.has(laneId));
  const requestedFamilies = new Set(requestedWinnerLanes.map(familyOf));
  const minimumFamilies = Math.min(Math.max(1, boundedInteger(memoryOptions?.minimumIndependentFamilies, 2, 1, CANONICAL_PRIORITY.length)), Math.max(1, requestedFamilies.size));
  const health = await Promise.all(requested.map((laneId) => getTerminalLaneHealth(laneId, { memoryProfile: profile, memoryEpoch: epoch })));
  const anchor = requestedWinnerLanes[0];
  const protectedLanes = requested.filter((laneId) => laneId === anchor || laneId === "structured-search");
  const protectedSet = new Set(protectedLanes);
  const now = Date.now();
  const candidates = health.filter((lane) => !protectedSet.has(lane.laneId) && lane.fulfilled === 0 && lane.hardFailureCount >= minSamples && lane.lastSeenAt > 0 && lane.lastSeenAt + cooldownMs > now).sort((left, right) => right.hardFailureCount - left.hardFailureCount || left.lastSeenAt - right.lastSeenAt);
  const enabled = new Set<CanonicalLaneId>(requested);
  const enableLanes: Partial<Record<CanonicalLaneId, boolean>> = { ...(portfolioOptions.enableLanes ?? {}) };
  const temporarilyQuarantined: SafeLanePlan["temporarilyQuarantined"] = [];
  const enabledFamilyCount = (lanes: Set<CanonicalLaneId>) => new Set(Array.from(lanes).filter((laneId) => WINNER_ELIGIBLE.has(laneId)).map(familyOf)).size;

  for (const candidate of candidates) {
    if (enabled.size - 1 < minimumEnabled) break;
    const trial = new Set(enabled);
    trial.delete(candidate.laneId);
    if (enabledFamilyCount(trial) < minimumFamilies) continue;
    enabled.delete(candidate.laneId);
    enableLanes[candidate.laneId] = false;
    temporarilyQuarantined.push({ laneId: candidate.laneId, until: candidate.lastSeenAt + cooldownMs, reason: `zero fulfilled results across ${candidate.hardFailureCount} completed failures` });
  }

  return { enableLanes, requestedLanes: requested, enabledLanes: Array.from(enabled), temporarilyQuarantined, protectedLanes, enabledWinnerFamilies: Array.from(new Set(Array.from(enabled).filter((laneId) => WINNER_ELIGIBLE.has(laneId)).map(familyOf))).sort() };
}

export async function requestTerminalMemoryPersistence(): Promise<"granted" | "denied" | "unavailable"> {
  try {
    if (typeof navigator === "undefined" || typeof navigator.storage?.persist !== "function") return "unavailable";
    return (await navigator.storage.persist()) ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

export async function groundWithTerminalPortfolioGovernor(question: string, options: TerminalGovernorOptions = {}): Promise<TerminalGovernorResult> {
  const { memoryProfile, memoryEpoch, adaptiveQuarantine = false, quarantineMinSamples, quarantineCooldownMs, minimumEnabledLanes, minimumIndependentFamilies, claimEchoThreshold, blockEchoThreshold, topClaims, recordMemory = true, requestPersistentStorage = false, ...portfolioOptions } = options;
  const profile = normalizeProfile(memoryProfile);
  const epoch = normalizeEpoch(memoryEpoch);
  const claimThreshold = boundedUnit(claimEchoThreshold, 0.60);
  const blockThreshold = boundedUnit(blockEchoThreshold, 0.30);
  const claimLimit = boundedInteger(topClaims, 8, 1, 64);
  const persistence = requestPersistentStorage ? await requestTerminalMemoryPersistence() : "not-requested";
  const plan = adaptiveQuarantine ? await buildSafeLanePlan(portfolioOptions, { memoryProfile: profile, memoryEpoch: epoch, quarantineMinSamples, quarantineCooldownMs, minimumEnabledLanes, minimumIndependentFamilies }) : { enableLanes: { ...(portfolioOptions.enableLanes ?? {}) }, requestedLanes: CANONICAL_PRIORITY.filter((laneId) => portfolioOptions.enableLanes?.[laneId] !== false), enabledLanes: CANONICAL_PRIORITY.filter((laneId) => portfolioOptions.enableLanes?.[laneId] !== false), temporarilyQuarantined: [], protectedLanes: [], enabledWinnerFamilies: Array.from(new Set(CANONICAL_PRIORITY.filter((laneId) => portfolioOptions.enableLanes?.[laneId] !== false && WINNER_ELIGIBLE.has(laneId)).map(familyOf))).sort() };
  const canonicalResult = await canonicalMemoryGround(question, { ...portfolioOptions, enableLanes: plan.enableLanes, adaptivePruning: false, recordOutcome: false });
  let strictCorroboratingFamilies: Record<string, string[]> = {};
  if (recordMemory) strictCorroboratingFamilies = await recordCompletedRun(canonicalResult, { profile, epoch, claimEchoThreshold: claimThreshold, blockEchoThreshold: blockThreshold, topClaims: claimLimit });
  const snapshot = await getTerminalMemorySnapshot({ memoryProfile: profile, memoryEpoch: epoch, laneIds: Object.keys(ENGINE_FAMILY) as CanonicalLaneId[] });
  return { ...canonicalResult, terminalGovernor: { plan, snapshot, persistence, strictCorroboratingFamilies, caveat: "Portfolio memory is advisory routing telemetry, not evidence. Aborted lanes are censored, claim echo is stored separately from boilerplate-sensitive block Jaccard, and temporary quarantine uses zero fulfillment rather than zero wins." } };
}

export async function runPortfolioTerminalGovernorDiagnostics(): Promise<{ ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> }> {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  const profile = `diagnostic_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const epoch = `${MEMORY_EPOCH}_diagnostic`;
  const commonText = "The widget market grew twelve percent during the third quarter.";
  const normalized = { ok: true, eligibleForWinner: true, acceptable: true, provider: "diagnostic", evidenceBlock: "A sufficiently long diagnostic evidence block. ".repeat(10), sources: [], sourceCount: 1, claimCount: 1, structuredItemCount: 0, attestedCount: 1, supportedCount: 0, conflictedCount: 0, proof: "verified", qualityVector: [1, 4, 1, 0, 1, 1, 500] as const };
  const fakeResult = { ok: true, provider: "diagnostic", selection: "canonical", canonicalWinnerLane: "terminal-wire", consensusWinnerLane: "terminal-wire", winnerLane: "terminal-wire", count: 1, sources: [], evidenceBlock: normalized.evidenceBlock, consensusConfidence: "moderate", consensusCaveat: "", laneConsensus: [], claimCorroboration: [], decisionLedger: [], agreement: [{ left: "terminal-wire", right: "omni-nexus", tokenJaccard: 0.7 }, { left: "sentinel-orchestrator", right: "omni-nexus", tokenJaccard: 0.7 }], laneResults: [{ id: "terminal-wire", priority: 100, status: "fulfilled", elapsedMs: 100, normalized, raw: { claims: [{ text: commonText }] } }, { id: "sentinel-orchestrator", priority: 95, status: "fulfilled", elapsedMs: 120, normalized, raw: { claims: [{ representativeText: commonText }] } }, { id: "omni-nexus", priority: 60, status: "fulfilled", elapsedMs: 140, normalized, raw: { claims: [{ canonicalText: commonText }] } }, { id: "sentinel-omega", priority: 75, status: "aborted", elapsedMs: 25 }] } as unknown as PortfolioConsensusResult;
  const strict = await recordCompletedRun(fakeResult, { profile, epoch, claimEchoThreshold: 0.6, blockEchoThreshold: 0.3, topClaims: 8 });
  const nonWinner = await getTerminalLaneHealth("sentinel-orchestrator", { memoryProfile: profile, memoryEpoch: epoch });
  add("fulfilled-nonwinner-not-failure", nonWinner.fulfilled === 1 && nonWinner.wins === 0 && nonWinner.hardFailureCount === 0, `fulfilled=${nonWinner.fulfilled} wins=${nonWinner.wins} failures=${nonWinner.hardFailureCount}`);
  const aborted = await getTerminalLaneHealth("sentinel-omega", { memoryProfile: profile, memoryEpoch: epoch });
  add("abort-is-censored", aborted.aborted === 1 && aborted.hardFailureCount === 0, `aborted=${aborted.aborted} failures=${aborted.hardFailureCount}`);
  const prior = await getTerminalFamilyPrior("conclave-core", "omni-standalone", { memoryProfile: profile, memoryEpoch: epoch });
  add("family-pair-deduplicated-per-run", prior.claimObservations === 1 && prior.blockObservations === 1, `claimObs=${prior.claimObservations} blockObs=${prior.blockObservations}`);
  add("strict-claim-echo-recorded", prior.claimEchoes === 1 && strict["omni-nexus"]?.includes("conclave-core"), `claimEchoes=${prior.claimEchoes}`);
  const healthyPlan = await buildSafeLanePlan({}, { memoryProfile: profile, memoryEpoch: epoch, quarantineMinSamples: 1 });
  add("zero-win-fulfilled-lane-kept", healthyPlan.enableLanes["sentinel-orchestrator"] !== false, `enabled=${healthyPlan.enableLanes["sentinel-orchestrator"] !== false}`);
  const failedLane = "vanguard-packer" as CanonicalLaneId;
  const failedKey = laneKey(epoch, profile, failedLane);
  for (let index = 0; index < 3; index += 1) await updateRecord<LaneHealthRecord>(STORE_LANE, failedKey, () => ({ key: failedKey, epoch, profile, laneId: failedLane, fulfilled: 0, acceptable: 0, wins: 0, rejected: 0, timedOut: 0, aborted: 0, claimComparableRuns: 0, strictClaimEchoRuns: 0, totalFulfilledMs: 0, lastSeenAt: 0 }), (record) => { record.rejected += 1; record.lastSeenAt = Date.now(); });
  const quarantinePlan = await buildSafeLanePlan({}, { memoryProfile: profile, memoryEpoch: epoch, quarantineMinSamples: 3, quarantineCooldownMs: 60 * 60_000 });
  add("proven-unavailable-lane-temporarily-quarantined", quarantinePlan.enableLanes[failedLane] === false, `quarantined=${quarantinePlan.enableLanes[failedLane] === false}`);
  await updateRecord<LaneHealthRecord>(STORE_LANE, failedKey, () => { throw new Error("record must exist"); }, (record) => { record.lastSeenAt = Date.now() - 2 * 60 * 60_000; });
  const reprobePlan = await buildSafeLanePlan({}, { memoryProfile: profile, memoryEpoch: epoch, quarantineMinSamples: 3, quarantineCooldownMs: 60 * 60_000 });
  add("cooldown-expiry-reenables-probe", reprobePlan.enableLanes[failedLane] !== false, `enabled=${reprobePlan.enableLanes[failedLane] !== false}`);
  const snapshot = await getTerminalMemorySnapshot({ memoryProfile: profile, memoryEpoch: epoch });
  const current = snapshot.laneHealth.find((lane) => lane.laneId === "terminal-wire");
  add("snapshot-includes-current-run", (current?.fulfilled ?? 0) >= 1, `fulfilled=${current?.fulfilled ?? 0}`);
  add("claim-and-block-memory-separated", prior.claimObservations === 1 && prior.blockObservations === 1 && Number.isFinite(prior.claimEchoRate) && Number.isFinite(prior.blockEchoRate), `claimRate=${prior.claimEchoRate} blockRate=${prior.blockEchoRate}`);
  const health = await getTerminalLaneHealth("terminal-wire", {});
  add("memory-profile-does-not-contain-query", health.profile === "global", `profile=${health.profile}`);
  return { ok: checks.every((check) => check.passed), checks };
}

export {
  groundWithPortfolioConsensus,
  familyOf,
  ENGINE_FAMILY,
};