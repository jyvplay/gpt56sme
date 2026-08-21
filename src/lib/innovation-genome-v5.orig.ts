/**
 * innovation-genome-v5.ts — Production Assurance Plane for V1/V2/V3/V4.
 * ============================================================================
 * Additive only. Imports V4 and adds:
 *   1.  Policy-as-code governance over runtime actions.
 *   2.  OpenTelemetry-inspired trace/span observability.
 *   3.  Canary leakage detection and taint labels.
 *   4.  Sealed challenge-suite commitments.
 *   5.  Standardized verifier adapter protocol.
 *   6.  Replay manifests and deterministic replay matrix.
 *   7.  Dynamic tool-inventory drift detection.
 *   8.  Operational SLO / health gates.
 *   9.  Promotion-time assurance gate (V4 audit + V5 policies).
 *   10. Fail-closed audit / policy-check / replay-check / health-check entries.
 *
 * RUNTIME HONESTY: no Python interpreter, no SQLite, no browser in this
 * session. This is a structural/semantic port verified by side-by-side
 * reading of the pasted Python V5, not by execute-and-diff. SQLite tables
 * become in-memory typed collections on the V4 store (same disclosure as
 * V3/V4). Every class, field, rule id, threshold and predicate name below
 * matches the Python source.
 */

import type { RiskTier } from '@/lib/innovation-genome-engine-v2';
import {
  Candidate,
  ToolRegistry,
  canonicalJson,
  sha256Text,
  utcNow,
} from "@/lib/innovation-genome-v3";
import {
  AtomicGovernanceStore,
  auditRuntime,
  type EvidenceKind,
  type EvidenceMaterial,
  type PromotionRecord,
} from "@/lib/innovation-genome-v4";

export const ZERO_HASH = "0".repeat(64);

// ═══════════════════════════════════════════════════════════════════════
// 1. V5 store (extends V4's AtomicGovernanceStore)
// ═══════════════════════════════════════════════════════════════════════

export interface PolicyDecisionRow {
  decisionId: string;
  runId: string;
  createdUtc: string;
  subject: string;
  action: string;
  allowed: boolean;
  violationsJson: string;
  inputHash: string;
}

export interface SpanRow {
  spanId: string;
  runId: string;
  traceId: string;
  parentSpanId: string;
  name: string;
  kind: string;
  startUtc: string;
  endUtc: string;
  durationMs: number;
  status: string;
  attributesJson: string;
}

export interface CanaryRow {
  canaryId: string;
  runId: string;
  label: string;
  tokenHash: string;
  taint: string;
  createdUtc: string;
}

export interface CanaryHitRow {
  hitId: string;
  runId: string;
  canaryId: string;
  candidateId: string;
  location: string;
  severity: string;
  createdUtc: string;
}

export interface ChallengeSuiteRow {
  suiteId: string;
  runId: string;
  name: string;
  tier: string;
  commitmentHash: string;
  diagnosticRelease: string;
  createdUtc: string;
}

export interface VerifierRunRow {
  verifierRunId: string;
  runId: string;
  candidateId: string;
  verifierName: string;
  verifierVersion: string;
  jobHash: string;
  verdict: string;
  resultJson: string;
  resultHash: string;
  createdUtc: string;
}

export interface ReplayManifestRow {
  manifestId: string;
  runId: string;
  subjectId: string;
  manifestJson: string;
  manifestHash: string;
  createdUtc: string;
}

export interface ReplayResultRow {
  replayId: string;
  runId: string;
  manifestId: string;
  success: boolean;
  resultJson: string;
  resultHash: string;
  createdUtc: string;
}

export interface ToolInventoryRow {
  runId: string;
  snapshotId: string;
  inventoryHash: string;
  inventoryJson: string;
  createdUtc: string;
}

export interface HealthReportRow {
  reportId: string;
  runId: string;
  status: string;
  reportJson: string;
  reportHash: string;
  createdUtc: string;
}

/** Extends V4's AtomicGovernanceStore. Does not alter V1-V4 behavior. */
export class V5AssuranceStore extends AtomicGovernanceStore {
  protected policyDecisions = new Map<string, PolicyDecisionRow>();
  protected spans: SpanRow[] = [];
  protected canaryRows = new Map<string, CanaryRow>();
  protected canaryHits = new Map<string, CanaryHitRow>();
  protected challengeSuites = new Map<string, ChallengeSuiteRow>();
  protected verifierRuns = new Map<string, VerifierRunRow>();
  protected replayManifests = new Map<string, ReplayManifestRow>();
  protected replayResults = new Map<string, ReplayResultRow>();
  protected toolInventory = new Map<string, ToolInventoryRow>();
  protected healthReports = new Map<string, HealthReportRow>();

  _putPolicyDecision(row: PolicyDecisionRow): void {
    this.policyDecisions.set(row.decisionId, row);
  }
  _countPolicyDenials(runId: string): number {
    let n = 0;
    for (const row of this.policyDecisions.values()) {
      if (row.runId === runId && !row.allowed) n += 1;
    }
    return n;
  }

  _putSpan(row: SpanRow): void {
    this.spans.push(row);
  }
  _getSpans(runId: string): SpanRow[] {
    return this.spans.filter((s) => s.runId === runId);
  }

  _putCanary(row: CanaryRow): void {
    this.canaryRows.set(row.canaryId, row);
  }
  /** Public accessor so the "plaintext token is never persisted" property is
   *  testable without reaching into a protected field (which a property-mangling
   *  minifier could rename, turning the test into a vacuous pass). */
  _getCanaryRows(runId: string): CanaryRow[] {
    return [...this.canaryRows.values()].filter((r) => r.runId === runId);
  }
  _putCanaryHit(row: CanaryHitRow): void {
    this.canaryHits.set(row.hitId, row);
  }
  _countCanaryHits(runId: string, candidateId: string): number {
    let n = 0;
    for (const hit of this.canaryHits.values()) {
      if (hit.runId === runId && hit.candidateId === candidateId) n += 1;
    }
    return n;
  }

  _putChallengeSuite(row: ChallengeSuiteRow): void {
    this.challengeSuites.set(row.suiteId, row);
  }
  _getChallengeSuite(suiteId: string): ChallengeSuiteRow | undefined {
    return this.challengeSuites.get(suiteId);
  }

  _putVerifierRun(row: VerifierRunRow): void {
    this.verifierRuns.set(row.verifierRunId, row);
  }
  _getVerifierRuns(runId: string, candidateId: string): VerifierRunRow[] {
    return [...this.verifierRuns.values()]
      .filter((r) => r.runId === runId && r.candidateId === candidateId)
      .sort((a, b) => a.createdUtc.localeCompare(b.createdUtc));
  }

  _putReplayManifest(row: ReplayManifestRow): void {
    this.replayManifests.set(row.manifestId, row);
  }
  _putReplayResult(row: ReplayResultRow): void {
    this.replayResults.set(row.replayId, row);
  }
  _getReplayResult(runId: string, replayId: string): ReplayResultRow | undefined {
    const row = this.replayResults.get(replayId);
    return row && row.runId === runId ? row : undefined;
  }

  _putToolInventory(row: ToolInventoryRow): void {
    this.toolInventory.set(`${row.runId}:${row.snapshotId}`, row);
  }
  _getToolInventory(runId: string, snapshotId: string): ToolInventoryRow | undefined {
    return this.toolInventory.get(`${runId}:${snapshotId}`);
  }

  _putHealthReport(row: HealthReportRow): void {
    this.healthReports.set(row.reportId, row);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Policy-as-code
// ═══════════════════════════════════════════════════════════════════════

export type PolicySeverity = "info" | "warning" | "error" | "fatal";

export interface PolicyViolation {
  ruleId: string;
  severity: PolicySeverity;
  message: string;
  location?: string;
}

export interface PolicyInput {
  runId: string;
  subject: string;
  action: string;
  resource: string;
  risk: string;
  payload: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}

export class PolicyDecision {
  constructor(
    public readonly allowed: boolean,
    public readonly subject: string,
    public readonly action: string,
    public readonly violations: readonly PolicyViolation[],
    public readonly inputHash: string,
  ) {}

  toDict(): Record<string, unknown> {
    return {
      allowed: this.allowed,
      subject: this.subject,
      action: this.action,
      violations: this.violations.map((v) => ({ ...v })),
      input_hash: this.inputHash,
    };
  }
}

export interface PolicyRule {
  ruleId: string;
  description: string;
  severity: PolicySeverity;
  predicate: (input: PolicyInput) => string | null;
}

export class PolicyEngine {
  readonly rules: readonly PolicyRule[];

  constructor(rules: readonly PolicyRule[]) {
    this.rules = rules;
  }

  evaluate(policyInput: PolicyInput): PolicyDecision {
    const violations: PolicyViolation[] = [];

    for (const rule of this.rules) {
      const message = rule.predicate(policyInput);
      if (message) {
        violations.push({
          ruleId: rule.ruleId,
          severity: rule.severity,
          message,
          location: policyInput.resource,
        });
      }
    }

    const fatal = violations.some(
      (v) => v.severity === "error" || v.severity === "fatal",
    );

    return new PolicyDecision(
      !fatal,
      policyInput.subject,
      policyInput.action,
      violations,
      sha256Text(canonicalJson(policyInput as unknown as Record<string, unknown>)),
    );
  }

  /** Persists the decision, emits the event, and THROWS when denied (fail-closed). */
  enforce(store: V5AssuranceStore, decision: PolicyDecision, runId: string): void {
    const decisionId =
      "policy-" +
      sha256Text(
        canonicalJson({
          run_id: runId,
          subject: decision.subject,
          action: decision.action,
          input_hash: decision.inputHash,
          violations: decision.violations.map((v) => ({ ...v })),
        }),
      ).slice(0, 32);

    store._putPolicyDecision({
      decisionId,
      runId,
      createdUtc: utcNow(),
      subject: decision.subject,
      action: decision.action,
      allowed: decision.allowed,
      violationsJson: canonicalJson(decision.violations.map((v) => ({ ...v }))),
      inputHash: decision.inputHash,
    });

    store.appendEvent(runId, "policy_decision_v5", {
      decision_id: decisionId,
      allowed: decision.allowed,
      subject: decision.subject,
      action: decision.action,
      input_hash: decision.inputHash,
    });

    if (!decision.allowed) {
      throw new Error(decision.violations.map((v) => v.message).join("; "));
    }
  }
}

export function defaultPolicyRules(): readonly PolicyRule[] {
  const highStakesNeedsHuman = (input: PolicyInput): string | null => {
    if (input.risk === "high" || input.risk === "critical") {
      const approvals = (input.payload.human_approvals ?? []) as unknown[];
      if (!approvals || approvals.length === 0) {
        return "High-stakes action lacks human approval";
      }
    }
    return null;
  };

  const worldActionNeedsScope = (input: PolicyInput): string | null => {
    if (input.action === "tool_call" && input.payload.world_action) {
      const scopes = new Set((input.payload.grant_scopes ?? []) as string[]);
      if (!scopes.has("world:action") && !scopes.has("*")) {
        return "World action lacks world:action scope";
      }
    }
    return null;
  };

  const noUndeclaredTool = (input: PolicyInput): string | null => {
    if (input.action === "tool_call") {
      const tool = input.payload.tool_name as string | undefined;
      const declared = new Set(
        ((input.capabilities?.declared_tools ?? []) as string[]),
      );
      if (!tool || !declared.has(tool)) {
        return `Tool ${JSON.stringify(tool)} is not declared`;
      }
    }
    return null;
  };

  const promotionRequiresEvidence = (input: PolicyInput): string | null => {
    if (input.action === "promote_candidate") {
      if (!input.payload.evidence_closed) {
        return "Promotion attempted without evidence closure";
      }
    }
    return null;
  };

  const canaryLeakBlocks = (input: PolicyInput): string | null => {
    if (((input.payload.canary_hits as number) ?? 0) > 0) {
      return "Canary leakage detected";
    }
    return null;
  };

  return [
    {
      ruleId: "V5-POL-001",
      description: "High-stakes actions require human approval.",
      severity: "error",
      predicate: highStakesNeedsHuman,
    },
    {
      ruleId: "V5-POL-002",
      description: "World actions require explicit world:action scope.",
      severity: "error",
      predicate: worldActionNeedsScope,
    },
    {
      ruleId: "V5-POL-003",
      description: "Tool calls must use declared tools.",
      severity: "error",
      predicate: noUndeclaredTool,
    },
    {
      ruleId: "V5-POL-004",
      description: "Promotion requires claim evidence closure.",
      severity: "error",
      predicate: promotionRequiresEvidence,
    },
    {
      ruleId: "V5-POL-005",
      description: "Canary leakage blocks promotion or external action.",
      severity: "fatal",
      predicate: canaryLeakBlocks,
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Telemetry spans
// ═══════════════════════════════════════════════════════════════════════

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId: string;
}

function randomHex(bytes: number): string {
  const out = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < bytes; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(out).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class TelemetryRecorder {
  constructor(
    protected readonly store: V5AssuranceStore,
    protected readonly runId: string,
  ) {}

  startSpan(
    _name: string,
    _kind: string,
    parent?: SpanContext,
  ): { context: SpanContext; startMonotonic: number; startUtc: string } {
    const traceId = parent ? parent.traceId : randomHex(16);
    const spanId = randomHex(8);
    const parentSpanId = parent ? parent.spanId : "";
    const startMonotonic =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      context: { traceId, spanId, parentSpanId },
      startMonotonic,
      startUtc: utcNow(),
    };
  }

  endSpan(
    context: SpanContext,
    name: string,
    kind: string,
    startMonotonic: number,
    startUtc: string,
    status: string,
    attributes: Record<string, unknown>,
  ): void {
    const nowMonotonic =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const durationMs = Math.max(0, Math.round(nowMonotonic - startMonotonic));

    this.store._putSpan({
      spanId: context.spanId,
      runId: this.runId,
      traceId: context.traceId,
      parentSpanId: context.parentSpanId,
      name,
      kind,
      startUtc,
      endUtc: utcNow(),
      durationMs,
      status,
      attributesJson: canonicalJson(attributes),
    });

    this.store.appendEvent(this.runId, "span_recorded_v5", {
      trace_id: context.traceId,
      span_id: context.spanId,
      parent_span_id: context.parentSpanId,
      name,
      kind,
      status,
      duration_ms: durationMs,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Canary leakage and taint labels
// ═══════════════════════════════════════════════════════════════════════

export type CanarySeverity = "low" | "medium" | "high" | "critical";

export interface Canary {
  canaryId: string;
  label: string;
  token: string;
  taint: string;
  severity: CanarySeverity;
  tokenHash: string;
}

export interface CanaryHit {
  canaryId: string;
  label: string;
  candidateId: string;
  location: string;
  severity: CanarySeverity;
}

/** Keeps canary plaintext in memory; persists only hashes. */
export class CanaryRegistry {
  private readonly canaries = new Map<string, Canary>();

  constructor(
    private readonly store: V5AssuranceStore,
    private readonly runId: string,
  ) {}

  register(
    label: string,
    token: string,
    taint: string,
    severity: CanarySeverity = "high",
  ): Canary {
    if (!token) throw new Error("Canary token cannot be empty");

    const tokenHash = sha256Text(token);
    const canaryId =
      "canary-" +
      sha256Text(
        canonicalJson({ run_id: this.runId, label, token_hash: tokenHash }),
      ).slice(0, 32);

    const canary: Canary = { canaryId, label, token, taint, severity, tokenHash };
    this.canaries.set(canaryId, canary);

    this.store._putCanary({
      canaryId,
      runId: this.runId,
      label,
      tokenHash,
      taint,
      createdUtc: utcNow(),
    });

    this.store.appendEvent(this.runId, "canary_registered_v5", {
      canary_id: canaryId,
      label,
      token_hash: tokenHash,
      taint,
      severity,
    });

    return canary;
  }

  scan(candidateId: string, text: string, location: string): CanaryHit[] {
    const hits: CanaryHit[] = [];

    for (const canary of this.canaries.values()) {
      if (!text.includes(canary.token)) continue;

      hits.push({
        canaryId: canary.canaryId,
        label: canary.label,
        candidateId,
        location,
        severity: canary.severity,
      });

      const hitId =
        "hit-" +
        sha256Text(
          canonicalJson({
            candidate_id: candidateId,
            canary_id: canary.canaryId,
            location,
          }),
        ).slice(0, 32);

      this.store._putCanaryHit({
        hitId,
        runId: this.runId,
        canaryId: canary.canaryId,
        candidateId,
        location,
        severity: canary.severity,
        createdUtc: utcNow(),
      });

      this.store.appendEvent(this.runId, "canary_hit_v5", {
        hit_id: hitId,
        canary_id: canary.canaryId,
        candidate_id: candidateId,
        location,
        severity: canary.severity,
      });
    }

    return hits;
  }

  hitCount(candidateId: string): number {
    return this.store._countCanaryHits(this.runId, candidateId);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Sealed challenge suite commitments
// ═══════════════════════════════════════════════════════════════════════

export type DiagnosticRelease = "full" | "summary" | "none";

export interface ChallengeCase {
  caseId: string;
  inputDigest: string;
  expectedDigest: string;
  metadata?: Record<string, unknown>;
}

export class ChallengeSuite {
  constructor(
    public readonly suiteId: string,
    public readonly name: string,
    public readonly tier: string,
    public readonly cases: readonly ChallengeCase[],
    public readonly diagnosticRelease: DiagnosticRelease,
  ) {}

  get commitmentHash(): string {
    return sha256Text(
      canonicalJson({
        suite_id: this.suiteId,
        name: this.name,
        tier: this.tier,
        cases: this.cases.map((c) => ({ ...c })),
        diagnostic_release: this.diagnosticRelease,
      }),
    );
  }
}

export class ChallengeSuiteRegistry {
  constructor(
    private readonly store: V5AssuranceStore,
    private readonly runId: string,
  ) {}

  register(suite: ChallengeSuite): void {
    this.store._putChallengeSuite({
      suiteId: suite.suiteId,
      runId: this.runId,
      name: suite.name,
      tier: suite.tier,
      commitmentHash: suite.commitmentHash,
      diagnosticRelease: suite.diagnosticRelease,
      createdUtc: utcNow(),
    });

    this.store.appendEvent(this.runId, "challenge_suite_registered_v5", {
      suite_id: suite.suiteId,
      tier: suite.tier,
      commitment_hash: suite.commitmentHash,
      diagnostic_release: suite.diagnosticRelease,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Verifier protocol
// ═══════════════════════════════════════════════════════════════════════

export type VerificationVerdict = "pass" | "fail" | "inconclusive" | "error";

export interface VerificationJob {
  candidateId: string;
  artifactDigest: string;
  artifactMediaType: string;
  goalHash: string;
  evaluatorHash: string;
  verifierScope: string;
  arguments?: Record<string, unknown>;
}

export class VerificationResult {
  constructor(
    public readonly verifierName: string,
    public readonly verifierVersion: string,
    public readonly verdict: VerificationVerdict,
    public readonly evidence: readonly EvidenceMaterial[],
    public readonly witness: string = "",
    public readonly counterexample: string = "",
    public readonly diagnostics: readonly string[] = [],
  ) {}

  toDict(): Record<string, unknown> {
    return {
      verifier_name: this.verifierName,
      verifier_version: this.verifierVersion,
      verdict: this.verdict,
      evidence: this.evidence.map((ev) => ({
        evidence_id: ev.evidenceId,
        kind: ev.kind as EvidenceKind,
        content_hash: sha256Text(ev.content),
        media_type: ev.mediaType ?? "text/plain",
        locator: ev.locator ?? "",
      })),
      witness_hash: sha256Text(this.witness),
      counterexample_hash: sha256Text(this.counterexample),
      diagnostics: this.diagnostics,
    };
  }
}

export interface VerifierAdapter {
  name: string;
  version: string;
  verify(job: VerificationJob): VerificationResult | Promise<VerificationResult>;
}

export class FunctionVerifier implements VerifierAdapter {
  constructor(
    public readonly name: string,
    public readonly version: string,
    private readonly fn: (job: VerificationJob) => VerificationResult | Promise<VerificationResult>,
  ) {}
  verify(job: VerificationJob) {
    return this.fn(job);
  }
}

export class VerifierOrchestrator {
  readonly verifiers: readonly VerifierAdapter[];

  constructor(
    private readonly store: V5AssuranceStore,
    private readonly runId: string,
    verifiers: readonly VerifierAdapter[],
  ) {
    if (verifiers.length === 0) throw new Error("At least one verifier is required");
    this.verifiers = verifiers;
  }

  async run(job: VerificationJob): Promise<VerificationResult[]> {
    const jobHash = sha256Text(canonicalJson(job as unknown as Record<string, unknown>));
    const results: VerificationResult[] = [];

    for (const verifier of this.verifiers) {
      let result: VerificationResult;
      try {
        result = await verifier.verify(job);
      } catch (exc) {
        result = new VerificationResult(
          verifier.name,
          verifier.version,
          "error",
          [],
          "",
          "",
          [`${exc instanceof Error ? exc.constructor.name : "Error"}: ${exc instanceof Error ? exc.message : String(exc)}`],
        );
      }

      const resultJson = canonicalJson(result.toDict());
      const resultHash = sha256Text(resultJson);
      const verifierRunId =
        "verifier-" +
        sha256Text(
          canonicalJson({
            run_id: this.runId,
            candidate_id: job.candidateId,
            verifier: verifier.name,
            job_hash: jobHash,
            result_hash: resultHash,
          }),
        ).slice(0, 32);

      this.store._putVerifierRun({
        verifierRunId,
        runId: this.runId,
        candidateId: job.candidateId,
        verifierName: verifier.name,
        verifierVersion: verifier.version,
        jobHash,
        verdict: result.verdict,
        resultJson,
        resultHash,
        createdUtc: utcNow(),
      });

      this.store.appendEvent(this.runId, "verifier_run_v5", {
        verifier_run_id: verifierRunId,
        candidate_id: job.candidateId,
        verifier: verifier.name,
        verdict: result.verdict,
        job_hash: jobHash,
        result_hash: resultHash,
      });

      results.push(result);
    }

    return results;
  }

  /**
   * NOTE (carried forward verbatim from the Python V5): this returns true when
   * ALL PRESENT rows pass. V7's VerifierClosureGate replaces it with an exact
   * required-set check, because a missing required verifier passes here.
   */
  allRequiredPassed(candidateId: string): boolean {
    const rows = this.store._getVerifierRuns(this.runId, candidateId);
    return rows.length > 0 && rows.every((r) => r.verdict === "pass");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 7. Replay manifests
// ═══════════════════════════════════════════════════════════════════════

export interface ReplayStep {
  name: string;
  inputHash: string;
  expectedOutputHash: string;
  toolReceipts?: readonly string[];
}

export class ReplayManifest {
  constructor(
    public readonly subjectId: string,
    public readonly environment: Record<string, unknown>,
    public readonly steps: readonly ReplayStep[],
  ) {}

  get manifestHash(): string {
    return sha256Text(
      canonicalJson({
        subject_id: this.subjectId,
        environment: this.environment,
        steps: this.steps.map((s) => ({ ...s })),
      }),
    );
  }
}

export interface ReplayRunner {
  runStep(step: ReplayStep): string | Promise<string>;
}

export class ReplayMatrix {
  constructor(
    private readonly store: V5AssuranceStore,
    private readonly runId: string,
  ) {}

  saveManifest(manifest: ReplayManifest): string {
    const manifestId = "replay-manifest-" + manifest.manifestHash.slice(0, 32);
    const manifestJson = canonicalJson({
      subject_id: manifest.subjectId,
      environment: manifest.environment,
      steps: manifest.steps.map((s) => ({ ...s })),
    });

    this.store._putReplayManifest({
      manifestId,
      runId: this.runId,
      subjectId: manifest.subjectId,
      manifestJson,
      manifestHash: manifest.manifestHash,
      createdUtc: utcNow(),
    });

    this.store.appendEvent(this.runId, "replay_manifest_saved_v5", {
      manifest_id: manifestId,
      subject_id: manifest.subjectId,
      manifest_hash: manifest.manifestHash,
    });

    return manifestId;
  }

  async run(manifest: ReplayManifest, runner: ReplayRunner): Promise<boolean> {
    const manifestId = this.saveManifest(manifest);
    const stepResults: Array<Record<string, unknown>> = [];
    let success = true;

    for (const step of manifest.steps) {
      const actualHash = await runner.runStep(step);
      const ok = actualHash === step.expectedOutputHash;
      success = success && ok;
      stepResults.push({
        name: step.name,
        expected_output_hash: step.expectedOutputHash,
        actual_output_hash: actualHash,
        ok,
      });
    }

    const result = {
      manifest_id: manifestId,
      subject_id: manifest.subjectId,
      steps: stepResults,
      success,
    };
    const resultJson = canonicalJson(result);
    const replayId = "replay-" + sha256Text(resultJson).slice(0, 32);

    this.store._putReplayResult({
      replayId,
      runId: this.runId,
      manifestId,
      success,
      resultJson,
      resultHash: sha256Text(resultJson),
      createdUtc: utcNow(),
    });

    this.store.appendEvent(this.runId, "replay_run_v5", {
      replay_id: replayId,
      manifest_id: manifestId,
      success,
    });

    return success;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 8. Tool inventory drift
// ═══════════════════════════════════════════════════════════════════════

export class ToolInventoryMonitor {
  constructor(
    private readonly store: V5AssuranceStore,
    private readonly runId: string,
  ) {}

  static snapshot(registry: ToolRegistry): Record<string, unknown> {
    // V3's ToolRegistry exposes an allowlist of name → function. There is no
    // version/side_effects metadata in the browser port, so the snapshot keys
    // on the sorted tool names and a stable descriptor. Disclosed difference
    // from the Python (which reads adapter.version / adapter.side_effects).
    const names = (registry as unknown as { allowlist?: Map<string, unknown> }).allowlist;
    const entries: Record<string, unknown> = {};
    if (names instanceof Map) {
      for (const name of [...names.keys()].sort()) {
        entries[name] = { version: "1", side_effects: false };
      }
    }
    return entries;
  }

  record(registry: ToolRegistry, snapshotId: string): string {
    const inventory = ToolInventoryMonitor.snapshot(registry);
    const inventoryJson = canonicalJson(inventory);
    const inventoryHash = sha256Text(inventoryJson);

    this.store._putToolInventory({
      runId: this.runId,
      snapshotId,
      inventoryHash,
      inventoryJson,
      createdUtc: utcNow(),
    });

    this.store.appendEvent(this.runId, "tool_inventory_recorded_v5", {
      snapshot_id: snapshotId,
      inventory_hash: inventoryHash,
    });

    return inventoryHash;
  }

  drifted(beforeId: string, afterId: string): boolean {
    const before = this.store._getToolInventory(this.runId, beforeId);
    const after = this.store._getToolInventory(this.runId, afterId);
    if (!before || !after) throw new Error("Missing inventory snapshot");
    return before.inventoryHash !== after.inventoryHash;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 9. Health monitor and assurance gateway
// ═══════════════════════════════════════════════════════════════════════

export interface HealthThresholdsOptions {
  maxErrorRate?: number;
  maxP95LatencyMs?: number;
  maxPolicyDenials?: number;
  requireSemanticChain?: boolean;
  requireBlobIntegrity?: boolean;
}

export class HealthThresholds {
  readonly maxErrorRate: number;
  readonly maxP95LatencyMs: number;
  readonly maxPolicyDenials: number;
  readonly requireSemanticChain: boolean;
  readonly requireBlobIntegrity: boolean;

  constructor(options: HealthThresholdsOptions = {}) {
    this.maxErrorRate = options.maxErrorRate ?? 0.05;
    this.maxP95LatencyMs = options.maxP95LatencyMs ?? 60_000;
    this.maxPolicyDenials = options.maxPolicyDenials ?? 0;
    this.requireSemanticChain = options.requireSemanticChain ?? true;
    this.requireBlobIntegrity = options.requireBlobIntegrity ?? true;
  }
}

export class RunHealthMonitor {
  constructor(
    private readonly store: V5AssuranceStore,
    private readonly runId: string,
    private readonly thresholds: HealthThresholds,
  ) {}

  report(): Record<string, unknown> {
    const spans = this.store._getSpans(this.runId);
    const durations = spans.map((s) => s.durationMs);
    const errors = spans.filter((s) => s.status !== "ok");

    let p95 = 0;
    if (durations.length > 0) {
      const ordered = [...durations].sort((a, b) => a - b);
      const index = Math.min(ordered.length - 1, Math.floor(0.95 * ordered.length));
      p95 = ordered[index];
    }

    const errorRate = errors.length / Math.max(1, spans.length);
    const denials = this.store._countPolicyDenials(this.runId);
    const baseAudit = auditRuntime(this.store, this.runId);

    let status = "ok";
    const reasons: string[] = [];

    if (errorRate > this.thresholds.maxErrorRate) {
      status = "fail";
      reasons.push("span error rate exceeds threshold");
    }
    if (p95 > this.thresholds.maxP95LatencyMs) {
      status = "fail";
      reasons.push("p95 latency exceeds threshold");
    }
    if (denials > this.thresholds.maxPolicyDenials) {
      status = "fail";
      reasons.push("policy denials exceed threshold");
    }
    if (this.thresholds.requireSemanticChain && !baseAudit.v4_semantic_chain_valid) {
      status = "fail";
      reasons.push("semantic chain invalid");
    }
    if (this.thresholds.requireBlobIntegrity && !baseAudit.blob_integrity_valid) {
      status = "fail";
      reasons.push("blob integrity invalid");
    }

    const report: Record<string, unknown> = {
      run_id: this.runId,
      status,
      reasons,
      span_count: spans.length,
      error_rate: Math.round(errorRate * 10000) / 10000,
      p95_latency_ms: p95,
      policy_denials: denials,
      base_audit: baseAudit,
    };

    const reportJson = canonicalJson(report);
    const reportId = "health-" + sha256Text(reportJson).slice(0, 32);

    this.store._putHealthReport({
      reportId,
      runId: this.runId,
      status,
      reportJson,
      reportHash: sha256Text(reportJson),
      createdUtc: utcNow(),
    });

    this.store.appendEvent(this.runId, "health_report_v5", {
      report_id: reportId,
      status,
      report_hash: sha256Text(reportJson),
    });

    return report;
  }
}

/**
 * Final promotion-time assurance. V4 decides candidate promotion; V5 decides
 * whether promotion is operationally releasable.
 */
export class AssuranceGateway {
  constructor(
    private readonly store: V5AssuranceStore,
    private readonly runId: string,
    private readonly policy: PolicyEngine,
    private readonly health: RunHealthMonitor,
    private readonly canaries: CanaryRegistry,
    private readonly verifier?: VerifierOrchestrator,
  ) {}

  releasable(
    candidate: Candidate,
    promotion: PromotionRecord,
    risk: RiskTier,
    humanApprovals: readonly string[] = [],
  ): boolean {
    const canaryHits = this.canaries.hitCount(candidate.candidateId);

    const decision = this.policy.evaluate({
      runId: this.runId,
      subject: candidate.candidateId,
      action: "promote_candidate",
      resource: "candidate",
      risk,
      payload: {
        evidence_closed: promotion.evidenceClosed,
        canary_hits: canaryHits,
        human_approvals: humanApprovals,
      },
    });
    this.policy.enforce(this.store, decision, this.runId);

    if (this.verifier && !this.verifier.allRequiredPassed(candidate.candidateId)) {
      return false;
    }

    const health = this.health.report();
    return (
      promotion.promoted &&
      promotion.evidenceClosed &&
      canaryHits === 0 &&
      health.status === "ok"
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 10. Fail-closed command entry points (CLI equivalents)
// ═══════════════════════════════════════════════════════════════════════

export function cliHealthCheck(store: V5AssuranceStore, runId: string): {
  exitCode: number;
  report: Record<string, unknown>;
} {
  const report = new RunHealthMonitor(store, runId, new HealthThresholds()).report();
  return { exitCode: report.status === "ok" ? 0 : 1, report };
}

export function cliPolicyCheck(input: PolicyInput): {
  exitCode: number;
  decision: Record<string, unknown>;
} {
  const decision = new PolicyEngine(defaultPolicyRules()).evaluate(input);
  return { exitCode: decision.allowed ? 0 : 1, decision: decision.toDict() };
}

export function cliReplayResult(
  store: V5AssuranceStore,
  runId: string,
  replayId: string,
): { exitCode: number; result: Record<string, unknown> } {
  const row = store._getReplayResult(runId, replayId);
  if (!row) return { exitCode: 2, result: { error: "replay_id not found" } };
  return { exitCode: row.success ? 0 : 1, result: JSON.parse(row.resultJson) };
}
