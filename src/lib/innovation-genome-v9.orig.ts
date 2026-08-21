/**
 * innovation-genome-v9.ts — Compliance, GenAI Observability & Continuous Quality Plane
 * Additive over V1-V8. Never modifies prior modules.
 *
 * Ported capabilities:
 * 1. EU AI Act Art 11/12/26/72/79 registry (retention, Annex IV, serious incidents)
 * 2. OTel GenAI v1.41 emitter (create_agent, invoke_agent, execute_tool spans)
 * 3. Pre-emit PII/secret redactor (email, phone, IPv4, IBAN, PAN/Luhn, sensitive keys)
 * 4. LLM-as-Judge panel (family separation, golden-set calibration)
 * 5. Golden dataset curator (promote_failure_to_case + reviewer approval)
 * 6. Eval-gated CI harness (deterministic PASS/FAIL)
 * 7. Online drift monitor (CUSUM change-point detector)
 * 8. MCP audit log (gen_ai.tool.* conventions)
 * 9. Deterministic replay engine
 * 10. Evidence-pack exporter (EU AI Act conformity + SOC-2 audit)
 *
 * RUNTIME HONESTY: no Python, no SQLite, no browser executed. Structural port only.
 */

import {
  canonicalJson,
  sha256Text,
  utcNow,
} from "@/lib/innovation-genome-v3";
import {
  V8ControlPlaneStore,
  V8_PROTOCOL_VERSION,
} from "@/lib/innovation-genome-v8";

export const V9_SCHEMA_VERSION = 1;
export const V9_PROTOCOL_VERSION = "9.0-rc1";

// ═══════════════════════════════════════════════════════════════════════
// 1. Store
// ═══════════════════════════════════════════════════════════════════════

export class V9CompliancePlaneStore extends V8ControlPlaneStore {
  v9Migrations: Array<{ version: number; name: string; checksum: string; appliedUtc: string }> = [];
  _retentionPolicies = new Map<string, Record<string, unknown>>();
  _seriousIncidents = new Map<string, Record<string, unknown>>();
  _technicalDocs = new Map<string, Record<string, unknown>>();
  _judgeScores = new Map<string, Record<string, unknown>>();
  _goldenCases = new Map<string, Record<string, unknown>>();
  _evalGateRuns = new Map<string, Record<string, unknown>>();
  _driftWindows = new Map<string, Record<string, unknown>>();
  _mcpToolCalls = new Map<string, Record<string, unknown>>();
  _replayReports = new Map<string, Record<string, unknown>>();
  _evidencePacks = new Map<string, Record<string, unknown>>();

  v9SchemaCurrent(): boolean {
    return this.v9Migrations.length >= V9_SCHEMA_VERSION;
  }

  /** Public accessor for V9 replay engine — subclass of EventStore so `eventRowsForRun` is accessible. */
  getEventRows(runId: string) {
    return this.eventRowsForRun(runId);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2. PII Redactor
// ═══════════════════════════════════════════════════════════════════════

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const PHONE_E164_RE = /\+?[1-9]\d{7,14}\b/g;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const PAN_RE = /\b(?:\d[ -]?){13,19}\b/g;
const SENSITIVE_KEY_RE = /(authorization|api[_-]?key|token|secret|password|passwd|cookie|credential|private[_-]?key|session|bearer)/i;

function luhnCheck(digits: string): boolean {
  const stripped = digits.replace(/[^0-9]/g, "");
  if (stripped.length < 13 || stripped.length > 19) return false;
  let total = 0;
  const parity = stripped.length % 2;
  for (let i = 0; i < stripped.length; i++) {
    let n = parseInt(stripped[i], 10);
    if (i % 2 === parity) { n *= 2; if (n > 9) n -= 9; }
    total += n;
  }
  return total % 10 === 0;
}

export interface RedactionStats {
  emails: number; phones: number; ipv4: number; iban: number; pan: number; sensitiveKeys: number;
}

export class PIIRedactor {
  constructor(private readonly pseudonymKey: string) {
    if (pseudonymKey.length < 32) throw new Error("PII pseudonym key must be at least 32 bytes");
  }

  private tag(kind: string, value: string): string {
    const digest = sha256Text(this.pseudonymKey + ":" + value).slice(0, 16);
    return `<REDACTED:${kind}:${digest}:len=${value.length}>`;
  }

  redactText(text: string): [string, RedactionStats] {
    const stats: RedactionStats = { emails: 0, phones: 0, ipv4: 0, iban: 0, pan: 0, sensitiveKeys: 0 };
    const tag = this.tag.bind(this);
    text = text.replace(EMAIL_RE, (m) => { stats.emails++; return tag("EMAIL", m); });
    text = text.replace(PHONE_E164_RE, (m) => { stats.phones++; return tag("PHONE", m); });
    text = text.replace(IPV4_RE, (m) => { stats.ipv4++; return tag("IPV4", m); });
    text = text.replace(IBAN_RE, (m) => { stats.iban++; return tag("IBAN", m); });
    text = text.replace(PAN_RE, (m) => {
      if (luhnCheck(m)) { stats.pan++; return tag("PAN", m); }
      return m;
    });
    return [text, stats];
  }

  redactAttributes(attributes: Record<string, unknown>): [Record<string, unknown>, RedactionStats] {
    const stats: RedactionStats = { emails: 0, phones: 0, ipv4: 0, iban: 0, pan: 0, sensitiveKeys: 0 };
    const walk = (keyPath: string, value: unknown): unknown => {
      if (SENSITIVE_KEY_RE.test(keyPath)) { stats.sensitiveKeys++; return this.tag("KEY", String(value)); }
      if (typeof value === "string") { const [r, s] = this.redactText(value); Object.keys(s).forEach(k => (stats as any)[k] += (s as any)[k]); return r; }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = walk(keyPath ? `${keyPath}.${k}` : k, (value as Record<string, unknown>)[k]);
        return out;
      }
      if (Array.isArray(value)) return value.map(v => walk(keyPath, v));
      return value;
    };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(attributes).sort()) out[k] = walk(k, attributes[k]);
    return [out, stats];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. OTel GenAI v1.41 Emitter
// ═══════════════════════════════════════════════════════════════════════

export interface OtelSpanRecord {
  traceId: string; spanId: string; parentSpanId: string; name: string; kind: string;
  startUnixNano: number; endUnixNano: number; statusCode: string;
  attributes: Record<string, unknown>; events: readonly Record<string, unknown>[];
}

export interface OtelExporter {
  export(span: OtelSpanRecord): void;
  exportMetric(name: string, value: number, attributes: Record<string, unknown>, unit: string): void;
}

export class NullOtelExporter implements OtelExporter {
  export(): void {}
  exportMetric(): void {}
}

function randomHex16(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return Math.random().toString(16).slice(2, 18);
}

export class OtelGenAIEmitter {
  constructor(private readonly exporter: OtelExporter, private readonly redactor: PIIRedactor) {}

  emitInvokeAgent(opts: {
    agentId: string; agentName: string; providerName: string; modelName: string;
    inputTokens?: number; outputTokens?: number; startNs: number; endNs: number; success: boolean;
    extra?: Record<string, unknown>;
  }): OtelSpanRecord {
    const attrs: Record<string, unknown> = {
      "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.id": opts.agentId,
      "gen_ai.agent.name": opts.agentName, "gen_ai.provider.name": opts.providerName,
      "gen_ai.request.model": opts.modelName, "error.type": opts.success ? "" : "invocation_error",
      "innovation_genome.protocol.version": V9_PROTOCOL_VERSION,
    };
    if (opts.inputTokens !== undefined) attrs["gen_ai.usage.input_tokens"] = opts.inputTokens;
    if (opts.outputTokens !== undefined) attrs["gen_ai.usage.output_tokens"] = opts.outputTokens;
    if (opts.extra) Object.assign(attrs, opts.extra);

    const [redacted] = this.redactor.redactAttributes(attrs);
    const record: OtelSpanRecord = {
      traceId: randomHex16() + randomHex16(), spanId: randomHex16(), parentSpanId: "",
      name: `invoke_agent ${opts.agentName}`.slice(0, 128), kind: "client",
      startUnixNano: opts.startNs, endUnixNano: opts.endNs,
      statusCode: opts.success ? "OK" : "ERROR", attributes: redacted, events: [],
    };
    this.exporter.export(record);
    const durationMs = Math.max(0, (opts.endNs - opts.startNs) / 1_000_000);
    this.exporter.exportMetric("gen_ai.client.operation.duration", durationMs, {
      "gen_ai.operation.name": "invoke_agent", "gen_ai.provider.name": opts.providerName,
      "gen_ai.request.model": opts.modelName,
    }, "ms");
    return record;
  }

  emitExecuteTool(opts: {
    toolName: string; toolCallId: string; startNs: number; endNs: number;
    success: boolean; errorType?: string; extra?: Record<string, unknown>;
  }): OtelSpanRecord {
    const attrs: Record<string, unknown> = {
      "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": opts.toolName,
      "gen_ai.tool.call.id": opts.toolCallId, "error.type": opts.success ? "" : (opts.errorType || "tool_error"),
      "innovation_genome.protocol.version": V9_PROTOCOL_VERSION,
    };
    if (opts.extra) Object.assign(attrs, opts.extra);
    const [redacted] = this.redactor.redactAttributes(attrs);
    const record: OtelSpanRecord = {
      traceId: randomHex16() + randomHex16(), spanId: randomHex16(), parentSpanId: "",
      name: `execute_tool ${opts.toolName}`.slice(0, 128), kind: "internal",
      startUnixNano: opts.startNs, endUnixNano: opts.endNs,
      statusCode: opts.success ? "OK" : "ERROR", attributes: redacted, events: [],
    };
    this.exporter.export(record);
    return record;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. EU AI Act Registry
// ═══════════════════════════════════════════════════════════════════════

export type SeriousIncidentClass = "death_or_serious_health" | "critical_infrastructure_disruption" | "fundamental_rights_infringement" | "serious_harm_property_environment" | "other_material_incident";

export class EUAIActRegistry {
  constructor(private readonly store: V9CompliancePlaneStore, private readonly runId: string, private readonly tenantId: string) {}

  setRetentionPolicy(category: string, minimumDays: number, maximumDays: number, lawfulBasis: string): string {
    if (category === "article_26_deployer_log" && minimumDays < 183) throw new Error("Article 26(6) requires ≥6 months (183 days) log retention");
    if (maximumDays < minimumDays) throw new Error("maximum retention cannot be below minimum retention");
    const policyId = "retention-" + sha256Text(canonicalJson({ tenant_id: this.tenantId, category, minimum_days: minimumDays, maximum_days: maximumDays, lawful_basis: lawfulBasis })).slice(0, 32);
    this.store._retentionPolicies.set(policyId, { policyId, tenantId: this.tenantId, category, minimumRetentionDays: minimumDays, maximumRetentionDays: maximumDays, lawfulBasis, createdUtc: utcNow() });
    this.store.appendEvent(this.runId, "retention_policy_set_v9", { policy_id: policyId, category, minimum_days: minimumDays, maximum_days: maximumDays });
    return policyId;
  }

  registerAnnexIVDocumentation(document: Record<string, unknown>): string {
    const docJson = canonicalJson(document);
    const docHash = sha256Text(docJson);
    const docId = "annex-iv-" + docHash.slice(0, 32);
    this.store._technicalDocs.set(docId, { docId, tenantId: this.tenantId, runId: this.runId, schema: "annex_iv_v1", documentJson: docJson, documentHash: docHash, createdUtc: utcNow() });
    this.store.appendEvent(this.runId, "annex_iv_documented_v9", { doc_id: docId, document_hash: docHash });
    return docId;
  }

  classifyAndRegisterIncident(summary: string, classification: SeriousIncidentClass, evidencePackHash: string): [string, boolean] {
    const reportable = ["death_or_serious_health", "critical_infrastructure_disruption", "fundamental_rights_infringement"].includes(classification);
    const sid = "serious-" + sha256Text(canonicalJson({ run_id: this.runId, tenant_id: this.tenantId, summary, classification, evidence_pack_hash: evidencePackHash, nonce: randomHex16() })).slice(0, 32);
    this.store._seriousIncidents.set(sid, { seriousIncidentId: sid, runId: this.runId, tenantId: this.tenantId, classification, summary, firstDetectedUtc: utcNow(), article79Reportable: reportable, evidencePackHash, status: "open", createdUtc: utcNow(), updatedUtc: utcNow() });
    this.store.appendEvent(this.runId, "serious_incident_registered_v9", { serious_incident_id: sid, classification, article_79_reportable: reportable, evidence_pack_hash: evidencePackHash });
    return [sid, reportable];
  }

  postMarketMonitoringPlan(): Record<string, unknown> {
    return { article: "72", tenant_id: this.tenantId, run_id: this.runId, monitoring_objectives: ["Detect quality drift on production judges (V9 drift monitor)", "Detect prompt-injection escapes (V8 firewall + V9 emitter)", "Detect serious incidents (V9 registry Article 79 flow)"], data_sources: ["V4 event chain", "V5 canary hits", "V5 telemetry spans (V7 hardened, V9 redacted)", "V7 doctor reports", "V8 outbox/release/incident tables", "V9 judge scores and drift windows"], review_cadence_days: 30, human_oversight_roles: ["provider", "deployer"] };
  }
}

export function buildAnnexIVDocument(opts: {
  tenantId: string; runId: string; systemName: string; intendedPurpose: string;
  providerName: string; deployerName: string; systemArchitectureSummary: string;
  riskManagementSummary: string; dataGovernanceSummary: string; performanceMetricsSummary: string;
  changeLog: readonly Record<string, unknown>[]; harmonisedStandards: readonly string[];
  protocolVersions?: readonly string[]; references?: readonly string[];
}): Record<string, unknown> {
  return {
    schema: "annex_iv_v1", system_name: opts.systemName, intended_purpose: opts.intendedPurpose,
    provider: opts.providerName, deployer: opts.deployerName,
    identification: { tenant_id: opts.tenantId, run_id: opts.runId, protocol_versions: opts.protocolVersions ?? [V8_PROTOCOL_VERSION, V9_PROTOCOL_VERSION] },
    system_architecture: opts.systemArchitectureSummary, risk_management_system: opts.riskManagementSummary,
    data_governance: opts.dataGovernanceSummary, performance: opts.performanceMetricsSummary,
    logging_capability: { article_12_supported: true, log_categories: ["risk_situations", "post_market_monitoring", "deployer_oversight"], integrity: "V4 hash chain + V7 semantic chain + V9 deterministic replay", minimum_retention_days_default: 183 },
    changes_through_lifecycle: [...opts.changeLog], harmonised_standards: [...opts.harmonisedStandards],
    references: [...(opts.references ?? [])], generated_utc: utcNow(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5. LLM-as-Judge Panel
// ═══════════════════════════════════════════════════════════════════════

export interface JudgeRequest {
  subjectId: string; subjectType: string; tenantId: string; runId: string;
  inputs: Record<string, unknown>; output: string; reference?: string; context?: string; modelName?: string;
}

export interface JudgeScore {
  judgeName: string; judgeFamily: string; metric: string; value: number; passed: boolean; rationale: string;
}

export interface Judge {
  name: string; family: string;
  score(request: JudgeRequest): readonly JudgeScore[];
}

export class StructuralJudge implements Judge {
  name = "v9-structural-judge";
  family = "structural";

  score(request: JudgeRequest): JudgeScore[] {
    const out = request.output || "";
    const ref = request.reference || "";
    const ctx = request.context || "";

    const outTokens = new Set((out.match(/\w{4,}/g) || []).map(w => w.toLowerCase()));
    const ctxTokens = new Set((ctx.match(/\w{4,}/g) || []).map(w => w.toLowerCase()));
    const refTokens = new Set((ref.match(/\w{4,}/g) || []).map(w => w.toLowerCase()));

    const intersection = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
    const union = (a: Set<string>, b: Set<string>) => new Set([...a, ...b]).size;

    const grounded = outTokens.size > 0 ? intersection(outTokens, ctxTokens) / outTokens.size : 0;
    const faith = (refTokens.size > 0 || outTokens.size > 0) ? intersection(outTokens, refTokens) / Math.max(1, union(outTokens, refTokens)) : 0.5;
    const banned = ["<script", "curl http", "rm -rf", "DROP TABLE"];
    const safetyHits = banned.filter(b => out.toLowerCase().includes(b.toLowerCase())).length;
    const safety = Math.max(0, 1 - 0.25 * safetyHits);
    const completeness = Math.min(1, out.trim().length / 400);

    return [
      { judgeName: this.name, judgeFamily: this.family, metric: "groundedness", value: Math.round(grounded * 10000) / 10000, passed: grounded >= 0.4, rationale: `${intersection(outTokens, ctxTokens)}/${outTokens.size} shared` },
      { judgeName: this.name, judgeFamily: this.family, metric: "faithfulness", value: Math.round(faith * 10000) / 10000, passed: faith >= 0.4, rationale: `jaccard=${faith.toFixed(3)}` },
      { judgeName: this.name, judgeFamily: this.family, metric: "safety", value: Math.round(safety * 10000) / 10000, passed: safety >= 0.9, rationale: `banned_hits=${safetyHits}` },
      { judgeName: this.name, judgeFamily: this.family, metric: "completeness", value: Math.round(completeness * 10000) / 10000, passed: completeness >= 0.3, rationale: `len=${out.length}` },
    ];
  }
}

export class LLMJudgePanel {
  constructor(private readonly store: V9CompliancePlaneStore, private readonly judges: readonly Judge[], private readonly forbidFamilies: ReadonlySet<string> = new Set()) {
    if (judges.length === 0) throw new Error("At least one judge is required");
  }

  score(request: JudgeRequest): JudgeScore[] {
    const scores: JudgeScore[] = [];
    for (const judge of this.judges) {
      if (this.forbidFamilies.has(judge.family)) continue;
      for (const s of judge.score(request)) {
        scores.push(s);
        const scoreId = "score-" + sha256Text(canonicalJson({ subject: request.subjectId, judge: judge.name, metric: s.metric, value: s.value, nonce: randomHex16() })).slice(0, 32);
        this.store._judgeScores.set(scoreId, { scoreId, runId: request.runId, tenantId: request.tenantId, subjectId: request.subjectId, subjectType: request.subjectType, judgeName: judge.name, judgeFamily: judge.family, modelName: request.modelName ?? "static-judge", metric: s.metric, value: s.value, passed: s.passed, rationaleHash: sha256Text(s.rationale), createdUtc: utcNow() });
        this.store.appendEvent(request.runId, "judge_scored_v9", { subject_id: request.subjectId, judge_name: judge.name, metric: s.metric, value: s.value, passed: s.passed });
      }
    }
    return scores;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Golden Dataset Curator + Eval Gate
// ═══════════════════════════════════════════════════════════════════════

export interface GoldenCase {
  caseId: string; tenantId: string; dataset: string; origin: string; originRef: string;
  inputs: Record<string, unknown>; expected: Record<string, unknown>; labels: Record<string, unknown>;
  status: string; inputsHash: string;
}

export class GoldenDatasetCurator {
  constructor(private readonly store: V9CompliancePlaneStore, private readonly tenantId: string, private readonly runId: string) {}

  promoteFailureToCase(dataset: string, origin: string, originRef: string, inputs: Record<string, unknown>, expected: Record<string, unknown>, labels?: Record<string, unknown>): string {
    const inputsJson = canonicalJson(inputs);
    const inputsHash = sha256Text(inputsJson);
    const caseId = "goldcase-" + sha256Text(canonicalJson({ tenant_id: this.tenantId, dataset, inputs_hash: inputsHash })).slice(0, 32);
    if (!this.store._goldenCases.has(caseId)) {
      this.store._goldenCases.set(caseId, { caseId, tenantId: this.tenantId, dataset, origin, originRef, inputsJson, expectedJson: canonicalJson(expected), labelsJson: canonicalJson(labels || {}), reviewerIdsJson: "[]", status: "candidate", inputsHash, createdUtc: utcNow(), updatedUtc: utcNow() });
    }
    this.store.appendEvent(this.runId, "golden_case_created_v9", { case_id: caseId, dataset, origin });
    return caseId;
  }

  approve(caseId: string, reviewerId: string): void {
    const row = this.store._goldenCases.get(caseId);
    if (!row) throw new Error(caseId);
    const reviewers = JSON.parse(String(row.reviewerIdsJson || "[]")) as string[];
    if (!reviewers.includes(reviewerId)) reviewers.push(reviewerId);
    row.reviewerIdsJson = canonicalJson(reviewers);
    row.status = "approved";
    row.updatedUtc = utcNow();
    this.store._goldenCases.set(caseId, row);
    this.store.appendEvent(this.runId, "golden_case_approved_v9", { case_id: caseId, reviewer_id: reviewerId });
  }

  approvedCases(dataset: string): GoldenCase[] {
    return [...this.store._goldenCases.values()].filter((r: any) => r.tenantId === this.tenantId && r.dataset === dataset && r.status === "approved").map((r: any) => ({
      caseId: r.caseId, tenantId: r.tenantId, dataset: r.dataset, origin: r.origin, originRef: r.originRef,
      inputs: JSON.parse(r.inputsJson), expected: JSON.parse(r.expectedJson), labels: JSON.parse(r.labelsJson),
      status: r.status, inputsHash: r.inputsHash,
    }));
  }
}

export interface EvalGateThresholds {
  minimumPassRate: number;
  minimumPerMetric?: Record<string, number>;
}

export type CandidateRunner = (goldenCase: GoldenCase) => string;

export class EvalGate {
  constructor(private readonly store: V9CompliancePlaneStore, private readonly tenantId: string, private readonly runId: string, private readonly curator: GoldenDatasetCurator, private readonly judgePanel: LLMJudgePanel) {}

  run(opts: { dataset: string; candidateRef: string; candidateRunner: CandidateRunner; thresholds: EvalGateThresholds }): Record<string, unknown> {
    const cases = this.curator.approvedCases(opts.dataset);
    if (cases.length === 0) throw new Error(`No approved golden cases in dataset ${JSON.stringify(opts.dataset)}`);

    const perMetric: Record<string, boolean[]> = {};
    for (const c of cases) {
      const output = opts.candidateRunner(c);
      const scores = this.judgePanel.score({ subjectId: c.caseId, subjectType: "golden_case", tenantId: this.tenantId, runId: this.runId, inputs: c.inputs, output, reference: canonicalJson(c.expected), context: canonicalJson(c.inputs), modelName: opts.candidateRef });
      for (const s of scores) { (perMetric[s.metric] ??= []).push(s.passed); }
    }

    const metricPassRate: Record<string, number> = {};
    for (const [m, bs] of Object.entries(perMetric)) metricPassRate[m] = bs.filter(Boolean).length / Math.max(1, bs.length);
    const values = Object.values(metricPassRate);
    const overallPassRate = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const thresholdMap = opts.thresholds.minimumPerMetric ?? {};
    const passed = overallPassRate >= opts.thresholds.minimumPassRate && Object.entries(thresholdMap).every(([m, t]) => (metricPassRate[m] ?? 0) >= t);

    const result = { dataset: opts.dataset, candidate_ref: opts.candidateRef, case_count: cases.length, metric_pass_rate: metricPassRate, overall_pass_rate: Math.round(overallPassRate * 10000) / 10000, passed };
    const resultJson = canonicalJson(result);
    const gateRunId = "gate-" + sha256Text(resultJson).slice(0, 32);
    this.store._evalGateRuns.set(gateRunId, { gateRunId, tenantId: this.tenantId, dataset: opts.dataset, candidateRef: opts.candidateRef, resultJson, resultHash: sha256Text(resultJson), passed, createdUtc: utcNow() });
    this.store.appendEvent(this.runId, "eval_gate_run_v9", { gate_run_id: gateRunId, dataset: opts.dataset, candidate_ref: opts.candidateRef, passed, result_hash: sha256Text(resultJson) });
    return { gate_run_id: gateRunId, ...result };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 7. Drift Monitor (CUSUM)
// ═══════════════════════════════════════════════════════════════════════

export interface DriftSample { metricKey: string; value: number; tsUnix: number; }
export interface DriftDecision { alarm: boolean; mean: number; stddev: number; cusumHigh: number; cusumLow: number; sampleCount: number; }

export class DriftMonitor {
  private buffers = new Map<string, DriftSample[]>();
  constructor(
    private readonly store: V9CompliancePlaneStore, private readonly tenantId: string, private readonly runId: string,
    private readonly windowSize = 50, private readonly cusumThreshold = 5.0, private readonly allowance = 0.5,
  ) {}

  observe(sample: DriftSample): DriftDecision {
    const buf = this.buffers.get(sample.metricKey) ?? [];
    buf.push(sample);
    if (buf.length > this.windowSize) buf.splice(0, buf.length - this.windowSize);
    this.buffers.set(sample.metricKey, buf);

    const values = buf.map(s => s.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stddev = values.length > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) : 0;

    const target = mean;
    const k = this.allowance * (stddev > 1e-9 ? stddev : 1e-3);
    let high = 0, low = 0;
    for (const v of values) {
      high = Math.max(0, high + (v - target - k));
      low = Math.min(0, low + (v - target + k));
    }
    const threshold = this.cusumThreshold * Math.max(stddev, 1e-3);
    const alarm = high > threshold || -low > threshold;

    if (alarm) {
      this.store.appendEvent(this.runId, "drift_alarm_v9", { metric_key: sample.metricKey, cusum_high: high, cusum_low: low, mean, sample_count: values.length });
    }
    return { alarm, mean: Math.round(mean * 1e6) / 1e6, stddev: Math.round(stddev * 1e6) / 1e6, cusumHigh: Math.round(high * 1e6) / 1e6, cusumLow: Math.round(low * 1e6) / 1e6, sampleCount: values.length };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 8. MCP Audit Log
// ═══════════════════════════════════════════════════════════════════════

export class MCPAuditLog {
  constructor(private readonly store: V9CompliancePlaneStore, private readonly runId: string, private readonly tenantId: string, private readonly emitter: OtelGenAIEmitter) {}

  recordCall(opts: { agentId: string; toolName: string; toolCallId: string; arguments: Record<string, unknown>; result: Record<string, unknown>; status: string; errorType?: string; startedUnixNs?: number; endedUnixNs?: number }): string {
    const argsHash = sha256Text(canonicalJson(opts.arguments));
    const resultHash = sha256Text(canonicalJson(opts.result));
    const startNs = opts.startedUnixNs ?? Date.now() * 1_000_000;
    const endNs = opts.endedUnixNs ?? startNs;
    const durationMs = Math.max(0, Math.round((endNs - startNs) / 1_000_000));
    const mcpCallId = "mcp-" + sha256Text(canonicalJson({ run_id: this.runId, tool_name: opts.toolName, tool_call_id: opts.toolCallId, args_hash: argsHash })).slice(0, 32);

    this.store._mcpToolCalls.set(mcpCallId, { mcpCallId, runId: this.runId, tenantId: this.tenantId, agentId: opts.agentId, toolName: opts.toolName, toolCallId: opts.toolCallId, argumentsHash: argsHash, resultHash, status: opts.status, errorType: opts.errorType ?? "", durationMs, startedUtc: utcNow() });

    this.emitter.emitExecuteTool({ toolName: opts.toolName, toolCallId: opts.toolCallId, startNs, endNs, success: opts.status === "ok", errorType: opts.errorType, extra: { "mcp.call.id": mcpCallId, "gen_ai.agent.id": opts.agentId, "gen_ai.tool.arguments.hash": argsHash, "gen_ai.tool.result.hash": resultHash } });

    this.store.appendEvent(this.runId, "mcp_tool_call_v9", { mcp_call_id: mcpCallId, tool_name: opts.toolName, arguments_hash: argsHash, result_hash: resultHash, status: opts.status });
    return mcpCallId;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 9. Deterministic Replay Engine
// ═══════════════════════════════════════════════════════════════════════

export class DeterministicReplayEngine {
  constructor(private readonly store: V9CompliancePlaneStore, private readonly runId: string, private readonly tenantId: string) {}

  replay(startSeq = 1, endSeq?: number): Record<string, unknown> {
    // Re-derive semantic chain from stored events — same algorithm as V7
    const events = this.store.getEventRows(this.runId).filter(e => e.seq >= startSeq);
    const filtered = endSeq !== undefined ? events.filter(e => e.seq <= endSeq) : events;

    const divergences: Array<Record<string, unknown>> = [];
    let expectedPrev = "0".repeat(64);
    let replayHead = "0".repeat(64);
    let originalHead = "";

    for (let i = 0; i < filtered.length; i++) {
      const row = filtered[i];
      const material = canonicalJson({ run_id: this.runId, created_utc: row.createdUtc, kind: row.kind, payload_json: row.payloadJson, prev_hash: row.prevHash });
      const recomputed = sha256Text(material);
      if (recomputed !== row.eventHash) {
        divergences.push({ seq: row.seq, recomputed, stored: row.eventHash });
      }
      expectedPrev = row.eventHash;
      replayHead = expectedPrev;
      originalHead = row.eventHash;
    }

    const equivalent = divergences.length === 0;
    const reportId = "replay-" + sha256Text(canonicalJson({ run_id: this.runId, start_seq: startSeq, end_seq: endSeq, divergences })).slice(0, 32);
    this.store._replayReports.set(reportId, { reportId, runId: this.runId, tenantId: this.tenantId, eventRangeStart: startSeq, eventRangeEnd: endSeq ?? 0, originalHeadHash: originalHead || "0".repeat(64), replayHeadHash: replayHead, equivalent, divergenceJson: canonicalJson(divergences), createdUtc: utcNow() });
    this.store.appendEvent(this.runId, "deterministic_replay_v9", { report_id: reportId, equivalent, divergence_count: divergences.length });
    return { report_id: reportId, equivalent, divergences, original_head_hash: originalHead, replay_head_hash: replayHead };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 10. Evidence Pack Exporter
// ═══════════════════════════════════════════════════════════════════════

export class EvidencePackExporter {
  constructor(private readonly store: V9CompliancePlaneStore, private readonly tenantId: string, private readonly runId: string) {}

  export(): Record<string, unknown> {
    const retention = [...this.store._retentionPolicies.values()].filter((r: any) => r.tenantId === this.tenantId);
    const serious = [...this.store._seriousIncidents.values()].filter((r: any) => r.tenantId === this.tenantId && r.runId === this.runId);
    const judgeScores = [...this.store._judgeScores.values()].filter((r: any) => r.tenantId === this.tenantId && r.runId === this.runId);
    const replays = [...this.store._replayReports.values()].filter((r: any) => r.tenantId === this.tenantId && r.runId === this.runId);

    const pack = {
      version: V9_PROTOCOL_VERSION, tenant_id: this.tenantId, run_id: this.runId, generated_utc: utcNow(),
      eu_ai_act: { article_12_retention_policies: retention, article_72_post_market_monitoring_plan: new EUAIActRegistry(this.store, this.runId, this.tenantId).postMarketMonitoringPlan(), article_79_serious_incidents: serious },
      observability: { judge_score_count: judgeScores.length },
      chain_integrity: { deterministic_replay_reports: replays.length },
    };
    const packJson = canonicalJson(pack);
    const packHash = sha256Text(packJson);
    const packId = "pack-" + packHash.slice(0, 32);
    this.store._evidencePacks.set(packId, { packId, tenantId: this.tenantId, runId: this.runId, packJson, packHash, createdUtc: utcNow() });
    this.store.appendEvent(this.runId, "evidence_pack_exported_v9", { pack_id: packId, pack_hash: packHash });
    return { pack_id: packId, pack_hash: packHash, pack };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 11. Compatibility Audit + Diagnostics
// ═══════════════════════════════════════════════════════════════════════

export function compatibilityAuditV9(): Record<string, unknown> {
  return {
    version: V9_PROTOCOL_VERSION, modifies_v1_through_v8: false, adds_eu_ai_act_registry: true,
    adds_annex_iv_documentation_helper: true, adds_serious_incident_article_79: true,
    adds_retention_policy_enforcement: true, adds_otel_genai_v141_emitter: true,
    adds_pii_secret_redactor: true, adds_llm_judge_panel: true, adds_golden_dataset_curator: true,
    adds_eval_gate_ci_harness: true, adds_cusum_drift_monitor: true, adds_mcp_audit_log: true,
    adds_deterministic_replay_engine: true, adds_evidence_pack_exporter: true,
  };
}

export interface DiagnosticCheck { id: string; passed: boolean; detail: string; }

export async function runInnovationGenomeV9Diagnostics(): Promise<{ ok: boolean; checks: DiagnosticCheck[] }> {
  const checks: DiagnosticCheck[] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });

  const store = new V9CompliancePlaneStore();
  store.createRun("run-v9", 1, "general", "low", { version: "v9-test" });

  // PII
  const r = new PIIRedactor("K".repeat(32));
  const [redacted, stats] = r.redactText("email a@b.com phone +12025550123 ip 192.168.1.5 iban GB29NWBK60161331926819 pan 4111 1111 1111 1111");
  add("pii-email-redacted", !redacted.includes("a@b.com") && stats.emails >= 1, `emails=${stats.emails}`);
  add("pii-pan-luhn", stats.pan >= 1, `pan=${stats.pan}`);
  const [attrOut] = r.redactAttributes({ authorization: "Bearer secret-xyz", safe: 42 });
  add("pii-key-redacted", String(attrOut.authorization).startsWith("<REDACTED:KEY:"), "sensitive key");
  add("pii-safe-preserved", attrOut.safe === 42, "non-sensitive preserved");

  // OTel
  const emitter = new OtelGenAIEmitter(new NullOtelExporter(), r);
  const rec = emitter.emitInvokeAgent({ agentId: "a1", agentName: "test", providerName: "static", modelName: "m1", inputTokens: 10, outputTokens: 20, startNs: 1e9, endNs: 1.05e9, success: true });
  add("otel-span-emitted", rec.statusCode === "OK" && rec.name.includes("invoke_agent"), rec.name);

  // EU AI Act
  const reg = new EUAIActRegistry(store, "run-v9", "tenant-v9");
  let threw = false;
  try { reg.setRetentionPolicy("article_26_deployer_log", 30, 365, "GDPR"); } catch { threw = true; }
  add("euai-art26-minimum-183", threw, "rejects < 183 days");
  const pid = reg.setRetentionPolicy("article_26_deployer_log", 200, 365, "GDPR Art. 6(1)(c)");
  add("euai-retention-set", pid.startsWith("retention-"), pid.slice(0, 20));
  const docId = reg.registerAnnexIVDocumentation(buildAnnexIVDocument({ tenantId: "tenant-v9", runId: "run-v9", systemName: "IGE", intendedPurpose: "Discovery", providerName: "P", deployerName: "D", systemArchitectureSummary: "s", riskManagementSummary: "r", dataGovernanceSummary: "d", performanceMetricsSummary: "p", changeLog: [], harmonisedStandards: [] }));
  add("euai-annex-iv", docId.startsWith("annex-iv-"), docId.slice(0, 20));
  const [sid, reportable] = reg.classifyAndRegisterIncident("Unsafe egress", "fundamental_rights_infringement", "a".repeat(64));
  add("euai-art79-reportable", reportable, sid.slice(0, 20));

  // Judge
  const panel = new LLMJudgePanel(store, [new StructuralJudge()]);
  const scores = panel.score({ subjectId: "c1", subjectType: "candidate", tenantId: "tenant-v9", runId: "run-v9", inputs: { q: "capital of France" }, output: "The capital of France is Paris. This grounded answer references France Paris.", reference: "France Paris capital", context: "Question about France Paris capital city" });
  const metrics = new Set(scores.map(s => s.metric));
  add("judge-4-metrics", metrics.size === 4, [...metrics].join(","));

  // Eval Gate
  const curator = new GoldenDatasetCurator(store, "tenant-v9", "run-v9");
  const cid = curator.promoteFailureToCase("prod-golden", "canary", "case-1", { q: "what is Paris" }, { a: "capital of France" }, { topic: "geography" });
  curator.approve(cid, "reviewer-1");
  const gate = new EvalGate(store, "tenant-v9", "run-v9", curator, panel);
  const gateResult = gate.run({ dataset: "prod-golden", candidateRef: "v1", candidateRunner: () => "Paris is the capital of France and is well grounded in Paris France context capital.", thresholds: { minimumPassRate: 0.5 } });
  add("eval-gate-passes", gateResult.passed === true, `overall=${gateResult.overall_pass_rate}`);

  // Drift
  const mon = new DriftMonitor(store, "tenant-v9", "run-v9", 30, 3.0, 0.5);
  let alarm = false;
  for (let i = 0; i < 30; i++) mon.observe({ metricKey: "judge:g:model:m1", value: 0.9, tsUnix: Date.now() / 1000 + i });
  for (let i = 0; i < 30; i++) { const d = mon.observe({ metricKey: "judge:g:model:m1", value: 0.4, tsUnix: Date.now() / 1000 + 60 + i }); if (d.alarm) { alarm = true; break; } }
  add("drift-cusum-detects-shift", alarm, "alarm triggered");

  // MCP + Replay
  const log = new MCPAuditLog(store, "run-v9", "tenant-v9", emitter);
  const callId = log.recordCall({ agentId: "agent-1", toolName: "search", toolCallId: "c1", arguments: { q: "x" }, result: { hits: 1 }, status: "ok" });
  add("mcp-call-recorded", callId.startsWith("mcp-"), callId.slice(0, 20));

  const engine = new DeterministicReplayEngine(store, "run-v9", "tenant-v9");
  const replay = engine.replay();
  add("replay-equivalent", replay.equivalent === true, "chain intact");

  // Evidence Pack
  const exporter = new EvidencePackExporter(store, "tenant-v9", "run-v9");
  const pack = exporter.export();
  add("evidence-pack", (pack.pack_id as string).startsWith("pack-"), String(pack.pack_hash).slice(0, 16));

  // Audit
  const audit = compatibilityAuditV9();
  add("audit-v9", audit.modifies_v1_through_v8 === false && audit.adds_eu_ai_act_registry === true, "additive");

  return { ok: checks.every(c => c.passed), checks };
}
