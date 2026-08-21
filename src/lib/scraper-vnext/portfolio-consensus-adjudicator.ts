/**
 * portfolio-consensus-adjudicator.ts
 * ============================================================================
 * ADDITIVE layer over the canonical canonical-portfolio-orchestrator.ts.
 *
 * WHAT THE CANONICAL PORTFOLIO LEAVES ON THE TABLE (verified by hand-trace):
 *   groundWithCanonicalPortfolio() computes an `agreement` matrix across all
 *   completed engine lanes, but chooseBest() never consults it. The winner is
 *   selected on a 7-field quality vector and final ties break on static
 *   `priority`. Cross-engine corroboration — a genuine reliability signal — is
 *   discarded.
 *
 * WHAT THIS ADDS (nothing else touched):
 *   1. FAMILY-AWARE CORROBORATION
 *      Portfolio lanes are NOT all independent. terminal-wire /
 *      sentinel-orchestrator / vanguard-packer share the conclave-core
 *      internals; sentinel-omega and omni-nexus are self-contained;
 *      structured-search is API-only. Only agreement ACROSS distinct
 *      architectural families is counted as independent corroboration.
 *
 *   2. TWO CORROBORATION SIGNALS, HONESTLY LABELED
 *      - Block-level token Jaccard (already in portfolio.agreement) — noted as
 *        inflated by shared security-boundary boilerplate.
 *      - Claim-level echo: does another family's raw result contain a claim
 *        whose text matches a winner claim above a similarity floor. This is
 *        the STRONGER signal because it compares claim texts, not whole blocks.
 *      A non-winner family counts as an independent corroborator if EITHER
 *      signal fires.
 *
 *   3. STRICTLY-DOMINANT TIE-BREAK (opt-in)
 *      selection:"consensus" appends independent-corroboration count as an
 *      8th, LOWEST-priority dimension. The first 7 dimensions are byte-for-byte
 *      the canonical quality vector, so the winner can only differ from the
 *      canonical winner when two lanes are EXACTLY equal on every hard trust
 *      dimension — in which case preferring the more-corroborated one is a
 *      strict reliability gain with zero loss. Default selection:"canonical"
 *      reproduces the canonical winner EXACTLY (no regression).
 *
 *   4. AUDITABLE DECISION LEDGER + CONSENSUS CONFIDENCE BAND
 *      Records which dimension decided each pairwise comparison and reports a
 *      strong/moderate/solo confidence label derived from the number of
 *      distinct independent families corroborating the winner.
 *
 * HONEST CEILING:
 *   Cross-engine textual agreement is surface corroboration, not factual
 *   verification. Several engines share internal components, so agreement is
 *   only meaningful across families and is used solely as a tie-break and an
 *   advisory confidence readout — never as a trust multiplier.
 *
 * ADDITIVE ONLY. No canonical file modified. No new npm dependency.
 * NOT EXECUTED in this environment.
 * ============================================================================ */

import {
  groundWithCanonicalPortfolio,
  type CanonicalLaneId,
  type PortfolioOptions,
  type LaneExecution,
  type AgreementCell,
  type StandardSource,
} from "./canonical-portfolio-orchestrator";

export type { CanonicalLaneId } from "./canonical-portfolio-orchestrator";

// ═══════════════════════════════════════════════════════════════════════════
// Engine families (which lanes share internal machinery)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Architectural family of each canonical lane. Lanes in the same family are
 * NOT independent witnesses because they wrap the same internal engines.
 */
export const ENGINE_FAMILY: Record<CanonicalLaneId, string> = {
  "terminal-wire": "conclave-core",
  "sentinel-orchestrator": "conclave-core",
  "vanguard-packer": "conclave-core",
  "sentinel-omega": "omega-standalone",
  "omni-nexus": "omni-standalone",
  "structured-search": "structured-apis",
};

export function familyOf(id: CanonicalLaneId): string {
  return ENGINE_FAMILY[id] ?? "unknown";
}

// ═══════════════════════════════════════════════════════════════════════════
// Public types
// ═══════════════════════════════════════════════════════════════════════════

export type ConsensusSelection = "canonical" | "consensus";

export interface PortfolioConsensusOptions
  extends Omit<PortfolioOptions, "mode"> {
  /** "canonical" = identical to canonical winner (default). */
  selection?: ConsensusSelection;
  /** Block-level Jaccard floor for corroboration. Default 0.30. */
  blockCorroborationThreshold?: number;
  /** Claim-text Jaccard floor for echo. Default 0.60. */
  claimCorroborationSim?: number;
  /** How many of the winner's claims to check for echo. Default 8. */
  topClaims?: number;
}

export interface LaneConsensus {
  laneId: CanonicalLaneId;
  family: string;
  acceptable: boolean;
  blockMeanJaccard: number;
  blockCorroborators: CanonicalLaneId[];
  independentFamilies: string[];
  independentCorroborationCount: number;
  augmentedQuality: number[];
}

export interface ClaimCorroboration {
  claimText: string;
  winnerLane: CanonicalLaneId;
  echoedByLanes: CanonicalLaneId[];
  echoedByFamilies: string[];
  independentEchoCount: number;
}

export interface DecisionLedgerEntry {
  winner: CanonicalLaneId;
  challenger: CanonicalLaneId;
  decidedBy: string;
  winnerValue: number;
  challengerValue: number;
}

export type ConsensusConfidence =
  | "strong"
  | "moderate"
  | "solo"
  | "none";

export interface PortfolioConsensusResult {
  ok: boolean;
  provider: string;
  selection: ConsensusSelection;

  canonicalWinnerLane?: CanonicalLaneId;
  consensusWinnerLane?: CanonicalLaneId;
  winnerLane?: CanonicalLaneId;

  count: number;
  sources: StandardSource[];
  evidenceBlock: string;

  consensusConfidence: ConsensusConfidence;
  consensusCaveat: string;

  laneConsensus: LaneConsensus[];
  claimCorroboration: ClaimCorroboration[];
  decisionLedger: DecisionLedgerEntry[];

  agreement: AgreementCell[];
  laneResults: LaneExecution[];
  winnerRaw?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers (pure, hand-traceable)
// ═══════════════════════════════════════════════════════════════════════════

const DIMENSION_NAMES = [
  "acceptable",
  "proofRank",
  "attested",
  "supported",
  "claims",
  "sources",
  "blockLength",
  "independentCorroboration",
] as const;

const CONSENSUS_CAVEAT =
  "Cross-engine corroboration is SURFACE textual agreement, not factual " +
  "verification. Several portfolio engines share internal components " +
  "(conclave-core family); only cross-family agreement is counted as " +
  "independent, and block-level Jaccard is inflated by shared security " +
  "boundary boilerplate. Claim-level echo is the stronger of the two signals.";

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function tokenSet(text: string): Set<string> {
  let tokens: string[];
  try {
    tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  } catch {
    tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  }
  return new Set(tokens.filter((t) => t.length > 2));
}

export function tokenJaccard(left: string, right: string): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Extract claim texts from an arbitrary engine's raw result, defensively. */
export function extractClaimTexts(raw: unknown): string[] {
  if (!isRecord(raw)) return [];
  const arr = Array.isArray(raw.claims) ? raw.claims : [];
  const out: string[] = [];
  for (const claim of arr) {
    if (typeof claim === "string") {
      if (claim.trim()) out.push(claim.trim());
      continue;
    }
    if (isRecord(claim)) {
      const text =
        asString(claim.text) ||
        asString(claim.representativeText) ||
        asString(claim.canonicalText) ||
        asString(claim.claim);
      if (text.trim()) out.push(text.trim());
    }
  }
  return out;
}

function jaccardBetween(
  a: CanonicalLaneId,
  b: CanonicalLaneId,
  agreement: AgreementCell[],
): number | undefined {
  for (const cell of agreement) {
    if (
      (cell.left === a && cell.right === b) ||
      (cell.left === b && cell.right === a)
    ) {
      return cell.tokenJaccard;
    }
  }
  return undefined;
}

function completedEligible(
  lanes: LaneExecution[],
): Array<
  LaneExecution & {
    normalized: NonNullable<LaneExecution["normalized"]>;
  }
> {
  return lanes.filter(
    (
      lane,
    ): lane is LaneExecution & {
      normalized: NonNullable<LaneExecution["normalized"]>;
    } =>
      lane.status === "fulfilled" &&
      lane.normalized !== undefined &&
      lane.normalized.eligibleForWinner,
  );
}

function compareAugmented(
  a: readonly number[],
  b: readonly number[],
): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Core corroboration computation
// ═══════════════════════════════════════════════════════════════════════════

interface WorkingLane {
  id: CanonicalLaneId;
  family: string;
  priority: number;
  acceptable: boolean;
  qualityVector: readonly number[];
  evidenceBlock: string;
  sources: StandardSource[];
  claims: string[];
  raw: unknown;
}

function toWorkingLane(
  lane: LaneExecution & {
    normalized: NonNullable<LaneExecution["normalized"]>;
  },
): WorkingLane {
  return {
    id: lane.id,
    family: familyOf(lane.id),
    priority: lane.priority,
    acceptable: lane.normalized.acceptable,
    qualityVector: lane.normalized.qualityVector,
    evidenceBlock: lane.normalized.evidenceBlock,
    sources: lane.normalized.sources,
    claims: extractClaimTexts(lane.raw),
    raw: lane.raw,
  };
}

/**
 * Compute, for `target`, the set of DISTINCT non-family families that
 * corroborate it via block-level Jaccard OR claim-level echo.
 */
function independentCorroboration(
  target: WorkingLane,
  others: WorkingLane[],
  agreement: AgreementCell[],
  blockThreshold: number,
  claimSim: number,
  topClaims: number,
): {
  independentFamilies: string[];
  blockCorroborators: CanonicalLaneId[];
  blockMeanJaccard: number;
} {
  const winnerClaims = target.claims.slice(0, topClaims);
  const families = new Set<string>();
  const blockCorroborators: CanonicalLaneId[] = [];

  let jaccardSum = 0;
  let jaccardCount = 0;

  for (const other of others) {
    if (other.id === target.id) continue;

    const j = jaccardBetween(target.id, other.id, agreement);
    if (j !== undefined) {
      jaccardSum += j;
      jaccardCount += 1;
    }

    const blockOk = j !== undefined && j >= blockThreshold;
    if (blockOk) blockCorroborators.push(other.id);

    const claimOk =
      winnerClaims.length > 0 &&
      other.claims.length > 0 &&
      winnerClaims.some((wc) =>
        other.claims.some(
          (oc) => tokenJaccard(wc, oc) >= claimSim,
        ),
      );

    if ((blockOk || claimOk) && other.family !== target.family) {
      families.add(other.family);
    }
  }

  return {
    independentFamilies: Array.from(families).sort(),
    blockCorroborators,
    blockMeanJaccard:
      jaccardCount > 0 ? jaccardSum / jaccardCount : 0,
  };
}

function confidenceFor(
  independentFamilyCount: number,
  acceptable: boolean,
): ConsensusConfidence {
  if (!acceptable) return "none";
  if (independentFamilyCount >= 2) return "strong";
  if (independentFamilyCount === 1) return "moderate";
  return "solo";
}

function buildDecisionLedger(
  winner: {
    id: CanonicalLaneId;
    augmented: number[];
    priority: number;
  },
  challengers: Array<{
    id: CanonicalLaneId;
    augmented: number[];
    priority: number;
  }>,
): DecisionLedgerEntry[] {
  const ledger: DecisionLedgerEntry[] = [];
  for (const challenger of challengers) {
    if (challenger.id === winner.id) continue;
    let decidedBy = "priority";
    let winnerValue = winner.priority;
    let challengerValue = challenger.priority;

    const n = Math.max(
      winner.augmented.length,
      challenger.augmented.length,
    );
    for (let i = 0; i < n; i += 1) {
      const w = winner.augmented[i] ?? 0;
      const c = challenger.augmented[i] ?? 0;
      if (w !== c) {
        decidedBy = DIMENSION_NAMES[i] ?? `dim${i}`;
        winnerValue = w;
        challengerValue = c;
        break;
      }
    }

    ledger.push({
      winner: winner.id,
      challenger: challenger.id,
      decidedBy,
      winnerValue,
      challengerValue,
    });
  }
  return ledger;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════════════════

export async function groundWithPortfolioConsensus(
  question: string,
  options: PortfolioConsensusOptions = {},
): Promise<PortfolioConsensusResult> {
  const selection: ConsensusSelection =
    options.selection ?? "canonical";
  const blockThreshold =
    options.blockCorroborationThreshold ?? 0.3;
  const claimSim = options.claimCorroborationSim ?? 0.6;
  const topClaims = Math.max(
    1,
    Math.min(32, Math.floor(options.topClaims ?? 8)),
  );

  // Consensus needs multiple completed engines → force audit-all.
  const portfolio = await groundWithCanonicalPortfolio(question, {
    ...options,
    mode: "audit-all",
  });

  const eligible = completedEligible(portfolio.laneResults);

  const emptyReturn = (): PortfolioConsensusResult => ({
    ok: portfolio.ok,
    provider: `portfolio-consensus(${selection}:${portfolio.provider})`,
    selection,
    canonicalWinnerLane: portfolio.winnerLane,
    consensusWinnerLane: portfolio.winnerLane,
    winnerLane: portfolio.winnerLane,
    count: portfolio.count,
    sources: portfolio.sources,
    evidenceBlock: portfolio.evidenceBlock,
    consensusConfidence: "none",
    consensusCaveat: CONSENSUS_CAVEAT,
    laneConsensus: [],
    claimCorroboration: [],
    decisionLedger: [],
    agreement: portfolio.agreement,
    laneResults: portfolio.laneResults,
    winnerRaw: portfolio.winnerRaw,
  });

  if (eligible.length === 0) return emptyReturn();

  const working = eligible.map(toWorkingLane);

  // Per-lane corroboration + augmented quality vector.
  const laneConsensus: LaneConsensus[] = [];
  const augmentedById = new Map<CanonicalLaneId, number[]>();

  for (const lane of working) {
    const corr = independentCorroboration(
      lane,
      working,
      portfolio.agreement,
      blockThreshold,
      claimSim,
      topClaims,
    );
    const augmented = [
      ...lane.qualityVector,
      corr.independentFamilies.length,
    ];
    augmentedById.set(lane.id, augmented);

    laneConsensus.push({
      laneId: lane.id,
      family: lane.family,
      acceptable: lane.acceptable,
      blockMeanJaccard: corr.blockMeanJaccard,
      blockCorroborators: corr.blockCorroborators,
      independentFamilies: corr.independentFamilies,
      independentCorroborationCount:
        corr.independentFamilies.length,
      augmentedQuality: augmented,
    });
  }

  const acceptableLanes = working.filter((l) => l.acceptable);

  // ── Canonical winner: exactly what the canonical portfolio chose ────────
  const canonicalWinnerId = portfolio.winnerLane;

  // ── Consensus winner: augmented lexicographic (7 hard dims + corroboration)
  let consensusWinner: WorkingLane | undefined;
  for (const lane of acceptableLanes) {
    if (!consensusWinner) {
      consensusWinner = lane;
      continue;
    }
    const cmp = compareAugmented(
      augmentedById.get(lane.id) ?? [],
      augmentedById.get(consensusWinner.id) ?? [],
    );
    if (cmp > 0 || (cmp === 0 && lane.priority > consensusWinner.priority)) {
      consensusWinner = lane;
    }
  }
  const consensusWinnerId = consensusWinner?.id;

  // ── Choose the lane whose output we actually surface ────────────────────
  const finalWinnerId =
    selection === "consensus"
      ? consensusWinnerId ?? canonicalWinnerId
      : canonicalWinnerId;

  const finalWorking = working.find((l) => l.id === finalWinnerId);
  const finalNormalizedLane = eligible.find(
    (l) => l.id === finalWinnerId,
  );

  // If default (canonical) selection, preserve canonical output byte-for-byte.
  const surfacedEvidence =
    selection === "canonical"
      ? portfolio.evidenceBlock
      : finalNormalizedLane?.normalized.evidenceBlock ??
        portfolio.evidenceBlock;

  const surfacedSources =
    selection === "canonical"
      ? portfolio.sources
      : finalNormalizedLane?.normalized.sources ??
        portfolio.sources;

  const surfacedCount =
    selection === "canonical"
      ? portfolio.count
      : finalNormalizedLane?.normalized.sourceCount ??
        portfolio.count;

  const surfacedRaw =
    selection === "canonical"
      ? portfolio.winnerRaw
      : finalNormalizedLane?.raw ?? portfolio.winnerRaw;

  // ── Confidence + claim corroboration for the surfaced winner ────────────
  const finalConsensus = laneConsensus.find(
    (c) => c.laneId === finalWinnerId,
  );
  const confidence = confidenceFor(
    finalConsensus?.independentCorroborationCount ?? 0,
    finalConsensus?.acceptable ?? false,
  );

  const claimCorroboration: ClaimCorroboration[] = [];
  if (finalWorking) {
    const others = working.filter((l) => l.id !== finalWorking.id);
    for (const claimText of finalWorking.claims.slice(0, topClaims)) {
      const echoedByLanes: CanonicalLaneId[] = [];
      const echoedByFamilies = new Set<string>();
      for (const other of others) {
        const echoed = other.claims.some(
          (oc) => tokenJaccard(claimText, oc) >= claimSim,
        );
        if (echoed) {
          echoedByLanes.push(other.id);
          if (other.family !== finalWorking.family) {
            echoedByFamilies.add(other.family);
          }
        }
      }
      if (echoedByLanes.length > 0) {
        claimCorroboration.push({
          claimText: claimText.slice(0, 200),
          winnerLane: finalWorking.id,
          echoedByLanes,
          echoedByFamilies: Array.from(echoedByFamilies).sort(),
          independentEchoCount: echoedByFamilies.size,
        });
      }
    }
  }

  // ── Decision ledger for the surfaced winner ─────────────────────────────
  const decisionLedger = finalWinnerId
    ? buildDecisionLedger(
        {
          id: finalWinnerId,
          augmented: augmentedById.get(finalWinnerId) ?? [],
          priority:
            eligible.find((l) => l.id === finalWinnerId)?.priority ?? 0,
        },
        acceptableLanes.map((l) => ({
          id: l.id,
          augmented: augmentedById.get(l.id) ?? [],
          priority: l.priority,
        })),
      )
    : [];

  return {
    ok: portfolio.ok && finalWinnerId !== undefined,
    provider: `portfolio-consensus(${selection}:${finalWinnerId ?? "none"}→conf=${confidence})`,
    selection,
    canonicalWinnerLane: canonicalWinnerId,
    consensusWinnerLane: consensusWinnerId,
    winnerLane: finalWinnerId,
    count: surfacedCount,
    sources: surfacedSources,
    evidenceBlock: surfacedEvidence,
    consensusConfidence: confidence,
    consensusCaveat: CONSENSUS_CAVEAT,
    laneConsensus,
    claimCorroboration,
    decisionLedger,
    agreement: portfolio.agreement,
    laneResults: portfolio.laneResults,
    winnerRaw: surfacedRaw,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Diagnostics — pure, synchronous, no network, fully awaited by construction
// ═══════════════════════════════════════════════════════════════════════════

export function runPortfolioConsensusDiagnostics(): {
  ok: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
} {
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
  const add = (id: string, passed: boolean, detail: string) =>
    checks.push({ id, passed, detail });

  // 1. tokenJaccard bounds
  add(
    "jaccard-identical",
    tokenJaccard("alpha beta gamma", "alpha beta gamma") === 1,
    "identical=1",
  );
  add(
    "jaccard-disjoint",
    tokenJaccard("alpha beta gamma", "quartz violin nebula") === 0,
    "disjoint=0",
  );

  // 2. family map
  add(
    "family-conclave-core",
    familyOf("terminal-wire") === "conclave-core" &&
      familyOf("vanguard-packer") === "conclave-core",
    "shared-core grouped",
  );
  add(
    "family-standalone-distinct",
    familyOf("sentinel-omega") !== familyOf("omni-nexus") &&
      familyOf("sentinel-omega") !== familyOf("terminal-wire"),
    "standalone families separate",
  );

  // 3. claim extraction duck-typing
  const claims = extractClaimTexts({
    claims: [
      "a plain string claim",
      { text: "text-field claim" },
      { representativeText: "rep-field claim" },
      { canonicalText: "canonical-field claim" },
      { irrelevant: "ignored" },
    ],
  });
  add(
    "extract-claims-shapes",
    claims.length === 4 &&
      claims.includes("a plain string claim") &&
      claims.includes("rep-field claim"),
    `n=${claims.length}`,
  );
  add(
    "extract-claims-nonrecord",
    extractClaimTexts("not an object").length === 0,
    "non-record → []",
  );

  // 4. augmented comparison: equal 7 dims, higher corroboration wins
  const base = [1, 4, 2, 1, 3, 3, 500] as const;
  add(
    "augmented-corroboration-tiebreak",
    compareAugmented([...base, 2], [...base, 1]) > 0 &&
      compareAugmented([...base, 0], [...base, 2]) < 0,
    "dim8 breaks exact tie",
  );
  add(
    "augmented-hard-dim-dominates",
    // higher attested (dim2) beats higher corroboration (dim8)
    compareAugmented([1, 4, 9, 1, 3, 3, 500, 0], [1, 4, 2, 1, 3, 3, 500, 9]) > 0,
    "hard trust dimension dominates corroboration",
  );

  // 5. jaccardBetween lookup (order-independent)
  const agreement: AgreementCell[] = [
    { left: "terminal-wire", right: "omni-nexus", tokenJaccard: 0.5 },
    { left: "sentinel-omega", right: "terminal-wire", tokenJaccard: 0.2 },
  ];
  add(
    "agreement-lookup-symmetric",
    jaccardBetween("omni-nexus", "terminal-wire", agreement) === 0.5 &&
      jaccardBetween("terminal-wire", "sentinel-omega", agreement) === 0.2 &&
      jaccardBetween("terminal-wire", "vanguard-packer", agreement) === undefined,
    "symmetric lookup + undefined for absent",
  );

  // 6. independentCorroboration: cross-family counts, same-family excluded
  const mkLane = (
    id: CanonicalLaneId,
    claimsArr: string[],
  ): WorkingLane => ({
    id,
    family: familyOf(id),
    priority: 0,
    acceptable: true,
    qualityVector: base,
    evidenceBlock: "",
    sources: [],
    claims: claimsArr,
    raw: {},
  });

  const winner = mkLane("terminal-wire", [
    "the widget market grew twelve percent in the third quarter",
  ]);
  const sameFamily = mkLane("sentinel-orchestrator", [
    "the widget market grew twelve percent in the third quarter",
  ]);
  const crossFamily = mkLane("omni-nexus", [
    "the widget market grew twelve percent in the third quarter",
  ]);

  const corr = independentCorroboration(
    winner,
    [winner, sameFamily, crossFamily],
    [],
    0.3,
    0.6,
    8,
  );
  add(
    "corroboration-cross-family-only",
    corr.independentFamilies.length === 1 &&
      corr.independentFamilies[0] === "omni-standalone",
    `families=${JSON.stringify(corr.independentFamilies)}`,
  );

  // 7. confidence bands
  add(
    "confidence-strong",
    confidenceFor(2, true) === "strong" &&
      confidenceFor(1, true) === "moderate" &&
      confidenceFor(0, true) === "solo" &&
      confidenceFor(2, false) === "none",
    "band thresholds",
  );

  // 8. decision ledger names the deciding dimension
  const ledger = buildDecisionLedger(
    { id: "terminal-wire", augmented: [1, 4, 5, 0, 0, 0, 0, 0], priority: 100 },
    [
      { id: "omni-nexus", augmented: [1, 4, 2, 0, 0, 0, 0, 0], priority: 60 },
    ],
  );
  add(
    "ledger-decides-on-attested",
    ledger.length === 1 &&
      ledger[0].decidedBy === "attested" &&
      ledger[0].winnerValue === 5,
    `decidedBy=${ledger[0]?.decidedBy}`,
  );

  return { ok: checks.every((c) => c.passed), checks };
}
