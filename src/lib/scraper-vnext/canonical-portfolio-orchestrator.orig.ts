/**
 * canonical-portfolio-orchestrator.ts
 * ============================================================================
 * Portfolio orchestration over the existing canonical terminal engines.
 *
 * IMPORTANT:
 *   This file does NOT replace, flatten, merge, or alter any canonical engine.
 *   Each engine executes as a separate lane and returns its untouched raw
 *   result. The orchestrator only:
 *
 *     1. schedules lanes with bounded delayed hedging;
 *     2. normalizes public output metadata for comparison;
 *     3. chooses the best complete public result lexicographically;
 *     4. preserves every raw lane result for inspection;
 *     5. measures inter-engine evidence-block agreement.
 *
 * Default mode is "hedged":
 *   - start the highest-priority terminal engine;
 *   - after hedgeDelayMs, start another if no acceptable result exists;
 *   - cap concurrent full pipelines;
 *   - abort outstanding lanes once an acceptable output wins.
 *
 * "audit-all" mode runs every enabled canonical engine with bounded
 * parallelism and returns every completed result.
 *
 * This avoids the earlier anti-pattern of replacing a feature-rich canonical
 * stack with a much shorter monolith.
 *
 * ADDITIVE ONLY. No canonical module is modified.
 * No new npm dependencies.
 * Browser/static-build compatible.
 *
 * NOT EXECUTED in this environment.
 * ============================================================================
 */

import {
  terminalWireGround,
} from "./terminal-wire";

import {
  sentinelGround as sentinelOrchestratorGround,
} from "./sentinel-orchestrator";

import {
  groundWithSentinelOmega,
} from "./sentinel-omega";

import {
  vanguardGround,
} from "./vanguard-titanium";

import {
  structuredSearch,
} from "./structured-source-adapter";

import {
  omniNexusGround,
} from "../omni-nexus";

// ═══════════════════════════════════════════════════════════════════════════
// Public types
// ═══════════════════════════════════════════════════════════════════════════

export type CanonicalLaneId =
  | "terminal-wire"
  | "sentinel-orchestrator"
  | "vanguard-packer"
  | "sentinel-omega"
  | "omni-nexus"
  | "structured-search";

export type PortfolioMode =
  | "hedged"
  | "audit-all";

export interface PortfolioOptions {
  signal?: AbortSignal;

  mode?: PortfolioMode;

  depth?: number;
  maxContextTokens?: number;
  charsPerToken?: number;

  allowJina?: boolean;
  allowPublicProxies?: boolean;
  allowWayback?: boolean;

  openAlexApiKey?: string;

  maxParallelLanes?: number;
  hedgeDelayMs?: number;
  laneTimeoutMs?: number;
  overallTimeoutMs?: number;

  enableLanes?: Partial<
    Record<CanonicalLaneId, boolean>
  >;

  /**
   * Google Translate/AMP identity-borrowing remains disabled by default.
   * The canonical modules remain independently callable; this orchestrator
   * does not activate those lanes.
   */
  enableExperimentalTitanium?: boolean;

  onDebug?: (message: string) => void;
}

export interface StandardSource {
  title: string;
  url: string;
  content: string;
}

export interface NormalizedLaneResult {
  ok: boolean;
  eligibleForWinner: boolean;
  acceptable: boolean;

  provider: string;
  evidenceBlock: string;
  sources: StandardSource[];

  sourceCount: number;
  claimCount: number;
  structuredItemCount: number;

  attestedCount: number;
  supportedCount: number;
  conflictedCount: number;

  proof:
    | "verified"
    | "bound"
    | "unavailable"
    | "invalid"
    | "unknown";

  qualityVector: readonly [
    acceptable: number,
    proofRank: number,
    attested: number,
    supported: number,
    claims: number,
    sources: number,
    blockLength: number,
  ];
}

export interface LaneExecution {
  id: CanonicalLaneId;
  priority: number;

  status:
    | "fulfilled"
    | "rejected"
    | "aborted"
    | "timed-out";

  elapsedMs: number;
  error?: string;

  normalized?: NormalizedLaneResult;

  /**
   * Exact untouched canonical engine output.
   */
  raw?: unknown;
}

export interface AgreementCell {
  left: CanonicalLaneId;
  right: CanonicalLaneId;
  tokenJaccard: number;
}

export interface PortfolioGroundingResult {
  ok: boolean;

  provider: string;
  winnerLane?: CanonicalLaneId;

  count: number;
  sources: StandardSource[];
  evidenceBlock: string;

  laneResults: LaneExecution[];
  agreement: AgreementCell[];

  /**
   * Untouched output of the selected canonical engine.
   */
  winnerRaw?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal types
// ═══════════════════════════════════════════════════════════════════════════

interface LaneSpec {
  id: CanonicalLaneId;
  priority: number;
  eligibleForWinner: boolean;

  run: (
    signal: AbortSignal,
  ) => Promise<unknown>;
}

type UnknownRecord = Record<
  string,
  unknown
>;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function isRecord(
  value: unknown,
): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function asString(
  value: unknown,
): string {
  return typeof value === "string"
    ? value
    : "";
}

function asFiniteNumber(
  value: unknown,
): number {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : 0;
}

function nowMs(): number {
  return typeof performance !== "undefined"
    ? performance.now()
    : Date.now();
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.max(
    minimum,
    Math.min(
      maximum,
      Math.floor(value),
    ),
  );
}

function linkSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  const controller =
    new AbortController();

  let timeoutReached = false;

  const onAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (parent?.aborted) {
    controller.abort();
  } else {
    parent?.addEventListener(
      "abort",
      onAbort,
      { once: true },
    );
  }

  const timer = setTimeout(() => {
    timeoutReached = true;
    onAbort();
  }, timeoutMs);

  return {
    signal: controller.signal,

    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener(
        "abort",
        onAbort,
      );
    },

    timedOut: () => timeoutReached,
  };
}

function readProof(
  object: UnknownRecord,
): NormalizedLaneResult["proof"] {
  const direct =
    asString(object.surfaceProof) ||
    asString(object.provenanceProof);

  if (
    direct === "verified" ||
    direct === "bound" ||
    direct === "unavailable" ||
    direct === "invalid"
  ) {
    return direct;
  }

  const provenance = isRecord(
    object.provenance,
  )
    ? object.provenance
    : undefined;

  const nested = asString(
    provenance?.proof,
  );

  if (
    nested === "verified" ||
    nested === "bound" ||
    nested === "unavailable" ||
    nested === "invalid"
  ) {
    return nested;
  }

  return "unknown";
}

function proofRank(
  proof: NormalizedLaneResult["proof"],
): number {
  switch (proof) {
    case "verified":
      return 4;
    case "bound":
      return 3;
    case "unknown":
      return 2;
    case "unavailable":
      return 1;
    case "invalid":
      return 0;
  }
}

function normalizeSource(
  value: unknown,
): StandardSource | null {
  if (!isRecord(value)) return null;

  const title =
    asString(value.title) ||
    "Untitled";

  const url =
    asString(value.canonicalUrl) ||
    asString(value.url) ||
    asString(value.externalUrl);

  const content =
    asString(value.content) ||
    asString(value.pageContent) ||
    asString(value.abstract) ||
    asString(value.snippet);

  if (!url && !content) return null;

  return {
    title,
    url,
    content,
  };
}

function normalizeSources(
  object: UnknownRecord,
): {
  sources: StandardSource[];
  structuredItemCount: number;
} {
  const direct = Array.isArray(
    object.sources,
  )
    ? object.sources
    : [];

  const structured = Array.isArray(
    object.structuredItems,
  )
    ? object.structuredItems
    : [];

  const items = [
    ...direct,
    ...structured,
  ];

  const seen = new Set<string>();
  const sources: StandardSource[] = [];

  for (const item of items) {
    const source = normalizeSource(item);
    if (!source) continue;

    const key =
      source.url ||
      `${source.title}\u0000${source.content.slice(
        0,
        80,
      )}`;

    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }

  return {
    sources,
    structuredItemCount:
      structured.length,
  };
}

function readCount(
  object: UnknownRecord,
  field: string,
): number {
  const direct =
    asFiniteNumber(object[field]);

  if (direct > 0) return direct;

  const counts = isRecord(object.counts)
    ? object.counts
    : isRecord(object.dispositionCounts)
      ? object.dispositionCounts
      : undefined;

  return asFiniteNumber(
    counts?.[field],
  );
}

function normalizeLaneOutput(
  raw: unknown,
  eligibleForWinner: boolean,
): NormalizedLaneResult {
  const object = isRecord(raw)
    ? raw
    : {};

  const sourceData =
    normalizeSources(object);

  const claims = Array.isArray(
    object.claims,
  )
    ? object.claims
    : [];

  const evidenceBlock = asString(
    object.evidenceBlock,
  );

  const provider =
    asString(object.provider) ||
    "unknown-provider";

  const proof = readProof(object);

  const attestedCount =
    readCount(object, "attested") ||
    readCount(
      isRecord(object.stats)
        ? object.stats
        : {},
      "attestedClaims",
    );

  const supportedCount =
    readCount(object, "supported") ||
    readCount(
      isRecord(object.stats)
        ? object.stats
        : {},
      "supportedClaims",
    );

  const conflictedCount =
    readCount(object, "conflicted") ||
    readCount(
      isRecord(object.stats)
        ? object.stats
        : {},
      "conflictedClaims",
    );

  const explicitCount =
    asFiniteNumber(object.count);

  const sourceCount = Math.max(
    sourceData.sources.length,
    explicitCount,
  );

  const claimCount = claims.length;

  const rawOk =
    object.ok === true;

  const acceptable =
    eligibleForWinner &&
    rawOk &&
    evidenceBlock.length >= 128 &&
    (sourceCount >= 1 ||
      claimCount >= 1 ||
      sourceData.structuredItemCount >= 2);

  const qualityVector =
    [
      acceptable ? 1 : 0,
      proofRank(proof),
      attestedCount,
      supportedCount,
      claimCount,
      sourceCount,
      evidenceBlock.length,
    ] as const;

  return {
    ok: rawOk,
    eligibleForWinner,
    acceptable,
    provider,
    evidenceBlock,
    sources: sourceData.sources,
    sourceCount,
    claimCount,
    structuredItemCount:
      sourceData.structuredItemCount,
    attestedCount,
    supportedCount,
    conflictedCount,
    proof,
    qualityVector,
  };
}

function compareNormalized(
  left: NormalizedLaneResult,
  right: NormalizedLaneResult,
): number {
  for (
    let index = 0;
    index <
    left.qualityVector.length;
    index += 1
  ) {
    const delta =
      left.qualityVector[index] -
      right.qualityVector[index];

    if (delta !== 0) return delta;
  }

  return 0;
}

function chooseBest(
  results: LaneExecution[],
): LaneExecution | undefined {
  return results
    .filter(
      (
        result,
      ): result is LaneExecution & {
        normalized: NormalizedLaneResult;
      } =>
        result.status === "fulfilled" &&
        result.normalized !== undefined &&
        result.normalized
          .eligibleForWinner,
    )
    .sort((left, right) => {
      const quality =
        compareNormalized(
          right.normalized,
          left.normalized,
        );

      if (quality !== 0) return quality;

      return (
        right.priority -
        left.priority
      );
    })[0];
}

function tokenSet(
  text: string,
): Set<string> {
  const tokens = (
    text.toLowerCase().match(
      /[\p{L}\p{N}]+/gu,
    ) ?? []
  ).filter(
    (token) => token.length > 2,
  );

  return new Set(tokens);
}

function tokenJaccard(
  left: string,
  right: string,
): number {
  const a = tokenSet(left);
  const b = tokenSet(right);

  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  const union =
    a.size + b.size - intersection;

  return union > 0
    ? intersection / union
    : 0;
}

function buildAgreement(
  results: LaneExecution[],
): AgreementCell[] {
  const successful = results.filter(
    (
      result,
    ): result is LaneExecution & {
      normalized: NormalizedLaneResult;
    } =>
      result.status === "fulfilled" &&
      result.normalized !== undefined &&
      result.normalized.evidenceBlock.length >
        0,
  );

  const agreement: AgreementCell[] = [];

  for (
    let left = 0;
    left < successful.length;
    left += 1
  ) {
    for (
      let right = left + 1;
      right < successful.length;
      right += 1
    ) {
      agreement.push({
        left: successful[left].id,
        right: successful[right].id,
        tokenJaccard: tokenJaccard(
          successful[left].normalized
            .evidenceBlock,
          successful[right].normalized
            .evidenceBlock,
        ),
      });
    }
  }

  return agreement;
}

// ═══════════════════════════════════════════════════════════════════════════
// Canonical lane definitions
// ═══════════════════════════════════════════════════════════════════════════

async function invokeQueryRunner(
  runner: unknown,
  query: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  if (typeof runner !== "function") {
    throw new TypeError(
      "canonical runner is not a function",
    );
  }

  return (
    runner as (
      query: string,
      options?: Record<string, unknown>,
    ) => Promise<unknown>
  )(query, options);
}

function buildLaneSpecs(
  query: string,
  options: PortfolioOptions,
): LaneSpec[] {
  const debug =
    options.onDebug ?? (() => {});

  const common = {
    depth: options.depth,
    maxContextTokens:
      options.maxContextTokens,
    charsPerToken:
      options.charsPerToken,

    allowJina:
      options.allowJina,

    allowPublicProxies:
      options.allowPublicProxies,

    allowProxies:
      options.allowPublicProxies,

    allowWayback:
      options.allowWayback,

    openAlexApiKey:
      options.openAlexApiKey,

    allowTitanium:
      options.enableExperimentalTitanium ===
      true,

    allowAmp:
      options.enableExperimentalTitanium ===
      true,

    onDebug: debug,
  };

  const enabled = (
    id: CanonicalLaneId,
    fallback = true,
  ): boolean =>
    options.enableLanes?.[id] ??
    fallback;

  const specs: LaneSpec[] = [];

  if (enabled("terminal-wire")) {
    specs.push({
      id: "terminal-wire",
      priority: 100,
      eligibleForWinner: true,

      run: (signal) =>
        invokeQueryRunner(
          terminalWireGround,
          query,
          {
            ...common,
            signal,
          },
        ),
    });
  }

  if (enabled("sentinel-orchestrator")) {
    specs.push({
      id: "sentinel-orchestrator",
      priority: 95,
      eligibleForWinner: true,

      run: (signal) =>
        invokeQueryRunner(
          sentinelOrchestratorGround,
          query,
          {
            ...common,
            signal,
          },
        ),
    });
  }

  if (enabled("vanguard-packer")) {
    specs.push({
      id: "vanguard-packer",
      priority: 85,
      eligibleForWinner: true,

      run: (signal) =>
        invokeQueryRunner(
          vanguardGround,
          query,
          {
            ...common,
            signal,
          },
        ),
    });
  }

  if (enabled("sentinel-omega")) {
    specs.push({
      id: "sentinel-omega",
      priority: 75,
      eligibleForWinner: true,

      run: (signal) =>
        invokeQueryRunner(
          groundWithSentinelOmega,
          query,
          {
            ...common,
            signal,
          },
        ),
    });
  }

  if (enabled("omni-nexus")) {
    specs.push({
      id: "omni-nexus",
      priority: 60,
      eligibleForWinner: true,

      run: async (signal) => {
        if (
          typeof omniNexusGround !==
          "function"
        ) {
          throw new TypeError(
            "omniNexusGround is unavailable",
          );
        }

        return (
          omniNexusGround as unknown as (
            options: Record<
              string,
              unknown
            >,
          ) => Promise<unknown>
        )({
          query,
          depth: options.depth,
          maxTokens:
            options.maxContextTokens,
          concurrency:
            options.maxParallelLanes,
          signal,
          onDebug: debug,
        });
      },
    });
  }

  if (enabled("structured-search")) {
    specs.push({
      id: "structured-search",
      priority: 50,
      eligibleForWinner: false,

      run: (signal) =>
        invokeQueryRunner(
          structuredSearch,
          query,
          {
            signal,
            limitPerSource: 6,
            openAlexApiKey:
              options.openAlexApiKey,
          },
        ),
    });
  }

  return specs.sort(
    (left, right) =>
      right.priority - left.priority,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Lane execution
// ═══════════════════════════════════════════════════════════════════════════

async function runLane(
  spec: LaneSpec,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<LaneExecution> {
  const startedAt = nowMs();

  const linked = linkSignal(
    parentSignal,
    timeoutMs,
  );

  try {
    const raw = await spec.run(
      linked.signal,
    );

    return {
      id: spec.id,
      priority: spec.priority,
      status: "fulfilled",
      elapsedMs: Math.round(
        nowMs() - startedAt,
      ),
      raw,
      normalized: normalizeLaneOutput(
        raw,
        spec.eligibleForWinner,
      ),
    };
  } catch (error) {
    const isAb =
      error instanceof Error &&
      (error.name === "AbortError" ||
        error.message === "ABORTED");

    const status: LaneExecution["status"] =
      linked.timedOut()
        ? "timed-out"
        : isAb
          ? "aborted"
          : "rejected";

    return {
      id: spec.id,
      priority: spec.priority,
      status,
      elapsedMs: Math.round(
        nowMs() - startedAt,
      ),
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    linked.cleanup();
  }
}

async function runAuditAll(
  specs: LaneSpec[],
  options: PortfolioOptions,
): Promise<LaneExecution[]> {
  const concurrency = clampInteger(
    options.maxParallelLanes,
    2,
    1,
    4,
  );

  const timeout = clampInteger(
    options.laneTimeoutMs,
    45_000,
    1_000,
    300_000,
  );

  const results =
    new Array<LaneExecution>(
      specs.length,
    );

  let cursor = 0;

  const workers = Array.from(
    {
      length: Math.min(
        concurrency,
        specs.length,
      ),
    },
    async () => {
      while (true) {
        if (options.signal?.aborted) {
          return;
        }

        const index = cursor;
        cursor += 1;

        if (index >= specs.length) {
          return;
        }

        results[index] = await runLane(
          specs[index],
          options.signal,
          timeout,
        );
      }
    },
  );

  await Promise.all(workers);

  return results.filter(Boolean);
}

async function runHedged(
  specs: LaneSpec[],
  options: PortfolioOptions,
): Promise<LaneExecution[]> {
  if (specs.length === 0) return [];

  const maximumParallel = clampInteger(
    options.maxParallelLanes,
    2,
    1,
    4,
  );

  const hedgeDelay = clampInteger(
    options.hedgeDelayMs,
    800,
    0,
    30_000,
  );

  const laneTimeout = clampInteger(
    options.laneTimeoutMs,
    45_000,
    1_000,
    300_000,
  );

  const overallTimeout = clampInteger(
    options.overallTimeoutMs,
    90_000,
    2_000,
    600_000,
  );

  const controller =
    new AbortController();

  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  options.signal?.addEventListener(
    "abort",
    onParentAbort,
    { once: true },
  );

  if (options.signal?.aborted) {
    controller.abort();
  }

  return new Promise((resolve) => {
    const results: LaneExecution[] = [];

    let nextIndex = 0;
    let active = 0;
    let finished = false;

    let hedgeTimer:
      | ReturnType<typeof setTimeout>
      | undefined;

    const overallTimer = setTimeout(
      () => finish(),
      overallTimeout,
    );

    const cleanup = () => {
      clearTimeout(overallTimer);

      if (hedgeTimer !== undefined) {
        clearTimeout(hedgeTimer);
      }

      options.signal?.removeEventListener(
        "abort",
        onParentAbort,
      );
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();

      if (!controller.signal.aborted) {
        controller.abort();
      }

      resolve(
        results
          .slice()
          .sort(
            (left, right) =>
              right.priority -
              left.priority,
          ),
      );
    };

    const hasAcceptable = () =>
      results.some(
        (result) =>
          result.normalized
            ?.acceptable === true,
      );

    const maybeFinish = () => {
      if (hasAcceptable()) {
        finish();
        return;
      }

      if (
        active === 0 &&
        nextIndex >= specs.length
      ) {
        finish();
      }
    };

    const scheduleHedge = () => {
      if (
        finished ||
        nextIndex >= specs.length
      ) {
        return;
      }

      hedgeTimer = setTimeout(() => {
        hedgeTimer = undefined;

        if (
          !finished &&
          !hasAcceptable()
        ) {
          startNext();
          scheduleHedge();
        }
      }, hedgeDelay);
    };

    const startNext = () => {
      if (
        finished ||
        active >= maximumParallel ||
        nextIndex >= specs.length
      ) {
        return;
      }

      const spec = specs[nextIndex];
      nextIndex += 1;
      active += 1;

      options.onDebug?.(
        `portfolio: starting ${spec.id}`,
      );

      void runLane(
        spec,
        controller.signal,
        laneTimeout,
      ).then((result) => {
        active = Math.max(0, active - 1);
        results.push(result);

        options.onDebug?.(
          `portfolio: ${spec.id} ${result.status} in ${result.elapsedMs}ms`,
        );

        if (
          result.normalized
            ?.acceptable === true
        ) {
          finish();
          return;
        }

        if (
          active <
            maximumParallel &&
          nextIndex < specs.length
        ) {
          startNext();
        }

        maybeFinish();
      });
    };

    startNext();
    scheduleHedge();

    if (controller.signal.aborted) {
      finish();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════════════════

export async function groundWithCanonicalPortfolio(
  question: string,
  options: PortfolioOptions = {},
): Promise<PortfolioGroundingResult> {
  const normalizedQuestion =
    question.replace(/\s+/g, " ").trim();

  if (!normalizedQuestion) {
    return {
      ok: false,
      provider:
        "canonical-portfolio(empty)",
      count: 0,
      sources: [],
      evidenceBlock: "",
      laneResults: [],
      agreement: [],
    };
  }

  const specs = buildLaneSpecs(
    normalizedQuestion,
    options,
  );

  if (specs.length === 0) {
    return {
      ok: false,
      provider:
        "canonical-portfolio(no-lanes)",
      count: 0,
      sources: [],
      evidenceBlock: "",
      laneResults: [],
      agreement: [],
    };
  }

  const mode =
    options.mode ?? "hedged";

  const laneResults =
    mode === "audit-all"
      ? await runAuditAll(
          specs,
          options,
        )
      : await runHedged(
          specs,
          options,
        );

  const winner =
    chooseBest(laneResults);

  const agreement =
    buildAgreement(laneResults);

  if (
    !winner?.normalized ||
    !winner.normalized.acceptable
  ) {
    return {
      ok: false,
      provider:
        "canonical-portfolio(exhausted)",
      count: 0,
      sources: [],
      evidenceBlock: "",
      laneResults,
      agreement,
      winnerRaw: winner?.raw,
    };
  }

  return {
    ok: true,

    provider:
      `canonical-portfolio(${winner.id}→${winner.normalized.provider})`,

    winnerLane: winner.id,

    count:
      winner.normalized.sourceCount,

    sources:
      winner.normalized.sources,

    evidenceBlock:
      winner.normalized.evidenceBlock,

    laneResults,
    agreement,

    winnerRaw: winner.raw,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Diagnostics
// ═══════════════════════════════════════════════════════════════════════════

export function runCanonicalPortfolioDiagnostics(): {
  ok: boolean;
  checks: Array<{
    id: string;
    passed: boolean;
    detail: string;
  }>;
} {
  const checks: Array<{
    id: string;
    passed: boolean;
    detail: string;
  }> = [];

  const add = (
    id: string,
    passed: boolean,
    detail: string,
  ) => {
    checks.push({
      id,
      passed,
      detail,
    });
  };

  const base = {
    ok: true,
    provider: "test",
    evidenceBlock:
      "A sufficiently long evidence block. ".repeat(
        20,
      ),
    sources: [
      {
        title: "Source",
        url: "https://example.com",
        content: "Content",
      },
    ],
    claims: [
      {
        id: "C1",
      },
    ],
    counts: {
      attested: 1,
      supported: 0,
      conflicted: 0,
    },
    provenance: {
      proof: "verified",
    },
  };

  const normalized =
    normalizeLaneOutput(
      base,
      true,
    );

  add(
    "normalization-acceptable",
    normalized.acceptable,
    `acceptable=${normalized.acceptable}`,
  );

  add(
    "normalization-proof",
    normalized.proof === "verified",
    `proof=${normalized.proof}`,
  );

  add(
    "normalization-counts",
    normalized.sourceCount === 1 &&
      normalized.claimCount === 1 &&
      normalized.attestedCount === 1,
    `sources=${normalized.sourceCount} claims=${normalized.claimCount} attested=${normalized.attestedCount}`,
  );

  const weaker =
    normalizeLaneOutput(
      {
        ...base,
        evidenceBlock:
          "Another long evidence block. ".repeat(
            20,
          ),
        counts: {
          attested: 0,
          supported: 1,
        },
        provenance: {
          proof: "bound",
        },
      },
      true,
    );

  add(
    "lexicographic-selection",
    compareNormalized(
      normalized,
      weaker,
    ) > 0,
    `strong=${normalized.qualityVector.join(
      ",",
    )} weak=${weaker.qualityVector.join(
      ",",
    )}`,
  );

  const jSame = tokenJaccard(
    "alpha beta gamma",
    "alpha beta gamma",
  );

  const jDifferent = tokenJaccard(
    "alpha beta gamma",
    "quartz violin nebula",
  );

  add(
    "agreement-identical",
    jSame === 1,
    `j=${jSame}`,
  );

  add(
    "agreement-different",
    jDifferent === 0,
    `j=${jDifferent}`,
  );

  const structured =
    normalizeLaneOutput(
      {
        ok: true,
        structuredItems: [
          {
            title: "Paper",
            externalUrl:
              "https://doi.org/example",
            pageContent:
              "Structured metadata",
          },
          {
            title: "Paper 2",
            externalUrl:
              "https://doi.org/example2",
            pageContent:
              "Structured metadata 2",
          },
        ],
      },
      false,
    );

  add(
    "auxiliary-not-final",
    !structured.acceptable &&
      structured.structuredItemCount === 2,
    `acceptable=${structured.acceptable} items=${structured.structuredItemCount}`,
  );

  return {
    ok: checks.every(
      (check) => check.passed,
    ),
    checks,
  };
}
