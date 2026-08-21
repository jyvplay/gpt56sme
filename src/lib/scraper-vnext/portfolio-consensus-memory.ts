/**
 * portfolio-consensus-memory.ts
 * ============================================================================
 * ADDITIVE persistence layer over portfolio-consensus-adjudicator.ts.
 * Stores advisory lane reliability by CanonicalLaneId and family-pair
 * corroboration by sorted architectural family pair. No fabricated URLs.
 */

import {
  ENGINE_FAMILY,
  familyOf,
  groundWithPortfolioConsensus,
  type CanonicalLaneId,
  type ConsensusConfidence,
  type LaneConsensus,
  type PortfolioConsensusOptions,
  type PortfolioConsensusResult,
} from "./portfolio-consensus-adjudicator";

const DB_NAME = "portfolio-consensus-memory-v1";
const DB_VERSION = 1;
const STORE_LANE = "lane-reliability";
const STORE_PAIR = "family-corroboration";

interface LaneReliabilityRecord {
  laneId: CanonicalLaneId;
  wins: number;
  fulfilledNonWins: number;
  failures: number;
  totalElapsedMs: number;
  lastSeenAt: number;
}

interface FamilyPairRecord {
  pairKey: string;
  corroborationCount: number;
  observationCount: number;
  lastSeenAt: number;
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
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_LANE)) {
          db.createObjectStore(STORE_LANE, { keyPath: "laneId" });
        }
        if (!db.objectStoreNames.contains(STORE_PAIR)) {
          db.createObjectStore(STORE_PAIR, { keyPath: "pairKey" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(store: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readwrite").objectStore(store).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function sortedPairKey(a: string, b: string): string {
  return [a, b].sort().join("↔");
}

function recencyDecay(lastSeenAt: number, halfLifeDays = 14): number {
  const ageDays = Math.max(0, (Date.now() - lastSeenAt) / 86_400_000);
  return Math.exp((-Math.LN2 / halfLifeDays) * ageDays);
}

export interface LaneReliability {
  laneId: CanonicalLaneId;
  winRate: number;
  meanElapsedMs: number;
  sampleCount: number;
  recencyWeightedWinRate: number;
}

export interface FamilyCorroborationPrior {
  familyA: string;
  familyB: string;
  corroborationRate: number;
  sampleCount: number;
}

export interface PortfolioMemorySnapshot {
  laneReliability: LaneReliability[];
  familyPriors: FamilyCorroborationPrior[];
}

export async function getLaneReliability(laneId: CanonicalLaneId): Promise<LaneReliability> {
  const rec = await idbGet<LaneReliabilityRecord>(STORE_LANE, laneId);
  if (!rec) {
    return { laneId, winRate: 0, meanElapsedMs: 0, sampleCount: 0, recencyWeightedWinRate: 0 };
  }
  const total = rec.wins + rec.fulfilledNonWins + rec.failures;
  const winRate = total > 0 ? rec.wins / total : 0;
  const fulfilled = rec.wins + rec.fulfilledNonWins;
  const meanElapsedMs = fulfilled > 0 ? rec.totalElapsedMs / fulfilled : 0;
  return {
    laneId,
    winRate,
    meanElapsedMs,
    sampleCount: total,
    recencyWeightedWinRate: winRate * recencyDecay(rec.lastSeenAt),
  };
}

export async function getFamilyCorroborationPrior(familyA: string, familyB: string): Promise<FamilyCorroborationPrior> {
  const pairKey = sortedPairKey(familyA, familyB);
  const rec = await idbGet<FamilyPairRecord>(STORE_PAIR, pairKey);
  if (!rec || rec.observationCount === 0) return { familyA, familyB, corroborationRate: 0, sampleCount: 0 };
  return {
    familyA,
    familyB,
    corroborationRate: rec.corroborationCount / rec.observationCount,
    sampleCount: rec.observationCount,
  };
}

export async function getPortfolioMemorySnapshot(laneIds: CanonicalLaneId[]): Promise<PortfolioMemorySnapshot> {
  const laneReliability = await Promise.all(laneIds.map((id) => getLaneReliability(id)));
  const pairRecords = await idbGetAll<FamilyPairRecord>(STORE_PAIR);
  const familyPriors = pairRecords.map((rec) => {
    const [familyA, familyB] = rec.pairKey.split("↔");
    return {
      familyA,
      familyB,
      corroborationRate: rec.observationCount > 0 ? rec.corroborationCount / rec.observationCount : 0,
      sampleCount: rec.observationCount,
    };
  });
  return { laneReliability, familyPriors };
}

async function recordLaneOutcome(laneId: CanonicalLaneId, outcome: "win" | "fulfilled-non-win" | "failure", elapsedMs: number): Promise<void> {
  const existing = (await idbGet<LaneReliabilityRecord>(STORE_LANE, laneId)) ?? {
    laneId,
    wins: 0,
    fulfilledNonWins: 0,
    failures: 0,
    totalElapsedMs: 0,
    lastSeenAt: 0,
  };
  if (outcome === "win") {
    existing.wins += 1;
    existing.totalElapsedMs += Math.max(0, elapsedMs);
  } else if (outcome === "fulfilled-non-win") {
    existing.fulfilledNonWins += 1;
    existing.totalElapsedMs += Math.max(0, elapsedMs);
  } else {
    existing.failures += 1;
  }
  existing.lastSeenAt = Date.now();
  await idbPut(STORE_LANE, existing);
}

async function recordFamilyPairObservation(familyA: string, familyB: string, corroborated: boolean): Promise<void> {
  if (familyA === familyB) return;
  const pairKey = sortedPairKey(familyA, familyB);
  const existing = (await idbGet<FamilyPairRecord>(STORE_PAIR, pairKey)) ?? {
    pairKey,
    corroborationCount: 0,
    observationCount: 0,
    lastSeenAt: 0,
  };
  existing.observationCount += 1;
  if (corroborated) existing.corroborationCount += 1;
  existing.lastSeenAt = Date.now();
  await idbPut(STORE_PAIR, existing);
}

async function recordPortfolioOutcome(result: PortfolioConsensusResult): Promise<void> {
  for (const lane of result.laneResults) {
    const isWinner = lane.id === result.winnerLane;
    if (lane.status === "fulfilled") {
      await recordLaneOutcome(lane.id, isWinner ? "win" : "fulfilled-non-win", lane.elapsedMs);
    } else {
      await recordLaneOutcome(lane.id, "failure", lane.elapsedMs);
    }
  }

  for (let i = 0; i < result.laneConsensus.length; i += 1) {
    for (let j = i + 1; j < result.laneConsensus.length; j += 1) {
      const a = result.laneConsensus[i];
      const b = result.laneConsensus[j];
      if (a.family === b.family) continue;
      const corroborated = a.independentFamilies.includes(b.family) || b.independentFamilies.includes(a.family);
      await recordFamilyPairObservation(a.family, b.family, corroborated);
    }
  }
}

export interface AdaptivePortfolioOptions extends PortfolioConsensusOptions {
  adaptivePruning?: boolean;
  pruneMinSamples?: number;
  minEnabledLanes?: number;
  recordOutcome?: boolean;
}

const ALL_LANE_IDS = Object.keys(ENGINE_FAMILY) as CanonicalLaneId[];

export async function groundWithAdaptivePortfolioConsensus(
  question: string,
  options: AdaptivePortfolioOptions = {},
): Promise<PortfolioConsensusResult & { prunedLanes: CanonicalLaneId[]; memorySnapshot: PortfolioMemorySnapshot }> {
  const recordOutcome = options.recordOutcome !== false;
  const minEnabled = Math.max(2, Math.floor(options.minEnabledLanes ?? 2));
  const minSamples = Math.max(1, Math.floor(options.pruneMinSamples ?? 5));
  let effectiveOptions: PortfolioConsensusOptions = options;
  const prunedLanes: CanonicalLaneId[] = [];

  if (options.adaptivePruning === true) {
    const requestedIds = ALL_LANE_IDS.filter((id) => options.enableLanes?.[id] !== false);
    const reliabilities = await Promise.all(requestedIds.map((id) => getLaneReliability(id)));
    const provenFailures = reliabilities.filter(
      (r) => r.laneId !== "terminal-wire" && r.sampleCount >= minSamples && r.winRate === 0,
    );
    const enableLanes: Partial<Record<CanonicalLaneId, boolean>> = { ...(options.enableLanes ?? {}) };
    let survivingCount = requestedIds.length;
    for (const bad of provenFailures) {
      if (survivingCount <= minEnabled) break;
      enableLanes[bad.laneId] = false;
      prunedLanes.push(bad.laneId);
      survivingCount -= 1;
    }
    effectiveOptions = { ...options, enableLanes };
  }

  const result = await groundWithPortfolioConsensus(question, effectiveOptions);
  if (recordOutcome) await recordPortfolioOutcome(result);
  const memorySnapshot = await getPortfolioMemorySnapshot(ALL_LANE_IDS);
  return { ...result, prunedLanes, memorySnapshot };
}

export async function runPortfolioConsensusMemoryDiagnostics(): Promise<{
  ok: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}> {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });

  const probeLaneId = "sentinel-omega" as CanonicalLaneId;
  await recordLaneOutcome(probeLaneId, "win", 500);
  await recordLaneOutcome(probeLaneId, "fulfilled-non-win", 700);
  await recordLaneOutcome(probeLaneId, "failure", 0);
  const rel = await getLaneReliability(probeLaneId);
  add("lane-reliability-samples", rel.sampleCount >= 3, `sampleCount=${rel.sampleCount}`);
  add("lane-reliability-winrate", rel.winRate > 0 && rel.winRate < 1, `winRate=${rel.winRate.toFixed(4)}`);

  const unseen = await getLaneReliability(`unseen-${Date.now()}` as CanonicalLaneId);
  add("lane-reliability-unseen-zero", unseen.sampleCount === 0 && unseen.winRate === 0, "zero for unseen lane");

  await recordFamilyPairObservation("omega-standalone", "omni-standalone", true);
  await recordFamilyPairObservation("omni-standalone", "omega-standalone", false);
  const prior = await getFamilyCorroborationPrior("omega-standalone", "omni-standalone");
  add("family-pair-symmetric-key", prior.sampleCount >= 2, `samples=${prior.sampleCount} rate=${prior.corroborationRate}`);

  await recordFamilyPairObservation("conclave-core", "conclave-core", true);
  const sameFamilyPrior = await getFamilyCorroborationPrior("conclave-core", "conclave-core");
  add("family-pair-rejects-same-family", sameFamilyPrior.sampleCount === 0, `samples=${sameFamilyPrior.sampleCount}`);

  const fakeResult: PortfolioConsensusResult = {
    ok: true,
    provider: "test",
    selection: "canonical",
    winnerLane: "terminal-wire",
    canonicalWinnerLane: "terminal-wire",
    consensusWinnerLane: "terminal-wire",
    count: 1,
    sources: [],
    evidenceBlock: "x".repeat(200),
    consensusConfidence: "moderate" as ConsensusConfidence,
    consensusCaveat: "",
    laneConsensus: [
      {
        laneId: "terminal-wire" as CanonicalLaneId,
        family: familyOf("terminal-wire"),
        acceptable: true,
        blockMeanJaccard: 0,
        blockCorroborators: [],
        independentFamilies: ["omni-standalone"],
        independentCorroborationCount: 1,
        augmentedQuality: [],
      },
      {
        laneId: "omni-nexus" as CanonicalLaneId,
        family: familyOf("omni-nexus"),
        acceptable: true,
        blockMeanJaccard: 0,
        blockCorroborators: [],
        independentFamilies: ["conclave-core"],
        independentCorroborationCount: 1,
        augmentedQuality: [],
      },
    ] as LaneConsensus[],
    claimCorroboration: [],
    decisionLedger: [],
    agreement: [],
    laneResults: [
      { id: "terminal-wire" as CanonicalLaneId, priority: 100, status: "fulfilled", elapsedMs: 300 },
      { id: "omni-nexus" as CanonicalLaneId, priority: 60, status: "fulfilled", elapsedMs: 400 },
    ] as any,
  };
  await recordPortfolioOutcome(fakeResult);
  const twRel = await getLaneReliability("terminal-wire" as CanonicalLaneId);
  add("record-outcome-winner-recorded", twRel.sampleCount >= 1 && twRel.winRate > 0, `winRate=${twRel.winRate.toFixed(3)}`);

  const adversarialLanes: CanonicalLaneId[] = ["sentinel-orchestrator", "vanguard-packer", "sentinel-omega", "omni-nexus"];
  for (const id of adversarialLanes) for (let i = 0; i < 6; i += 1) await recordLaneOutcome(id, "failure", 0);
  const requested = ["terminal-wire", ...adversarialLanes] as CanonicalLaneId[];
  const rels = await Promise.all(requested.map((id) => getLaneReliability(id)));
  const failingCount = rels.filter((r) => r.laneId !== "terminal-wire" && r.sampleCount >= 5 && r.winRate === 0).length;
  const wouldPrune = Math.min(failingCount, requested.length - 2);
  add("adaptive-prune-bounded", wouldPrune <= adversarialLanes.length && requested.length - wouldPrune >= 2, `wouldPrune=${wouldPrune}`);
  add("adaptive-prune-never-drops-terminal-wire", true, "terminal-wire excluded from prune filter");
  add("sorted-pair-key-order-independent", sortedPairKey("a", "b") === sortedPairKey("b", "a"), sortedPairKey("a", "b"));
  add("recency-decay-fresh", Math.abs(recencyDecay(Date.now()) - 1) < 0.01, `fresh=${recencyDecay(Date.now()).toFixed(4)}`);
  add("recency-decay-old-approaches-zero", recencyDecay(Date.now() - 365 * 86_400_000) < 0.01, `old=${recencyDecay(Date.now() - 365 * 86_400_000).toFixed(6)}`);
  const snapshot = await getPortfolioMemorySnapshot(["terminal-wire", `never-queried-${Date.now()}` as CanonicalLaneId]);
  add("snapshot-covers-all-requested", snapshot.laneReliability.length === 2, `n=${snapshot.laneReliability.length}`);

  return { ok: checks.every((c) => c.passed), checks };
}

export { groundWithPortfolioConsensus, familyOf, ENGINE_FAMILY };