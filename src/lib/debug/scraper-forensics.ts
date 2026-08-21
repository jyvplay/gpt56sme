/**
 * scraper-forensics.ts — NET-NEW (Type C). See flatten-guide.md.
 * ===========================================================================
 * PER-LANE RETRIEVAL FORENSICS.
 *
 * Turn-5 ask: "exact links scraped per scraper system, and exact citation each
 * scraper added during a specific run, and also clean sources, atoms,
 * quarantined, and any of the scraper specific metadata."
 *
 * The V15 grounding portfolio narrates itself through `onProgress`. Every
 * string below was taken VERBATIM from the package emitters — this module
 * parses only real emissions and never synthesises a lane that did not report.
 *
 * VERIFIED EMITTER COORDINATES (grepped, not assumed):
 *   v15-grounding.orig.ts:98   "portfolio: no acceptable result; delegating to vanguard"
 *   v15-grounding.orig.ts:117  "vanguard: N claims packed, M sources packed, utilization=X%"
 *   v15-grounding.orig.ts:135  "palisade: N attested, M supported, proof=P"
 *   v15-grounding.orig.ts:138  "palisade: insufficient attested claims; delegating to arbiter-omega"
 *   v15-pipeline.orig.ts:749   "grounded [Section]: +N source(s) for \"query\""
 *   v15-pipeline.orig.ts:763   "template-directed grounding complete: N total sources across M queries"
 *   v15-pipeline.orig.ts:833   "HDIG: +N source(s) for \"...\" (ledger now K)"
 *
 * CLEAN-SOURCE SEMANTICS (verified in package source, surfaced here so the
 * numbers in the UI mean something precise):
 *   arbiter-omega.ts:427        clean := !s.hardQuarantined && s.content.length >= 80
 *   strata-engine.ts:2384/2442  clean := !s.quarantined     && s.content.length >= 80
 *   nexus-consensus.ts:836      clean := !s.quarantined     && s.content && length >= 80
 *   sibyl-oracle.ts:332         clean := s.content && s.content.length >= 80
 *   v15-grounding.orig.ts:221   clean := s.url && s.content.length >= 80
 *   → A source is DROPPED (quarantined-equivalent) below 80 chars of body text.
 *
 * ATOM SEMANTICS:
 *   vanguard-titanium.ts:421    tokenBudget.sourcesPacked = packedSources.length
 *   "claims packed" are epistemic ATOMS, not documents. A lane can pack many
 *   atoms and zero sources — that is the D14 zero-yield defect.
 * ===========================================================================
 */
import type { TraceEvent, RunRecord, SourceRecord } from "@/lib/debug/pipeline-trace-bus";

export type LaneOutcome = "fulfilled" | "quarantined" | "delegated" | "winner" | "running" | "unknown";

export interface LaneRecord {
  /** Lane identity as the package names it: portfolio, terminal-wire, vanguard, … */
  lane: string;
  /** Template section this lane was serving, when the emitter carried one. */
  section: string | null;
  /** Query the lane was dispatched against, when carried. */
  query: string | null;
  firstDt: number;
  lastDt: number;
  durationMs: number | null;
  outcome: LaneOutcome;
  /** Epistemic atoms/claims packed by the lane (vanguard/palisade emit this). */
  atomsPacked: number | null;
  /** REAL documents packed. Zero here + nonzero atoms = D14 zero-yield. */
  sourcesPacked: number | null;
  /** Explicit clean-source count reported by nexus/native-vnext/etc. */
  cleanSources: number | null;
  /** Explicit quarantine/drop count reported by lane. */
  quarantined: number | null;
  /** Native-vnext/fusion result counts, when reported. */
  fusedResults: number | null;
  enrichedResults: number | null;
  /** Token-budget utilization percentage reported by the lane. */
  utilizationPct: number | null;
  /** Palisade disposition counts. */
  attested: number | null;
  supported: number | null;
  proof: string | null;
  /** Seeds the crawler expanded. */
  seedsCrawled: number | null;
  /** Sources this lane declared it contributed (from `grounded […]: +N`). */
  sourcesContributed: number;
  /** Structured-adapter provider list, when reported. */
  adapters: string[];
  /** Transport/backend failures parsed from hydraRead/native-vnext diagnostics. */
  failures: string[];
  /** Verbatim emissions attributed to this lane — full audit trail. */
  rawLines: Array<{ dt: number; message: string }>;
  /** Ledger entries whose admission timestamp falls inside this lane's window. */
  citations: SourceRecord[];
  /** Distinct absolute URLs among those citations. */
  realUrls: string[];
  /** Non-resolvable placeholder URLs (`source-N`, `*-attested`) — the bug at :113/:131. */
  placeholderUrls: string[];
}

export interface ForensicsReport {
  lanes: LaneRecord[];
  /** Lanes that reported zero real sources despite packing atoms. */
  zeroYieldLanes: LaneRecord[];
  /** Lanes explicitly quarantined / delegated away by the orchestrator. */
  quarantinedLanes: LaneRecord[];
  /** Winner declared by the portfolio, if it declared one. */
  winner: { lane: string; sources: number; lanes: number } | null;
  totals: {
    lanesSeen: number;
    totalSourcesDeclared: number;
    queriesDispatched: number;
    ledgerEntries: number;
    realUrlCount: number;
    placeholderUrlCount: number;
    cleanSourceThresholdChars: 80;
  };
  /** Ledger entries no lane window could claim — surfaced, never hidden. */
  unattributedCitations: SourceRecord[];
  /** Distinct absolute URLs across the whole run, deduped. */
  allRealUrls: string[];
  /** Distinct placeholder URLs across the whole run. */
  allPlaceholderUrls: string[];
}

// ── URL classification ─────────────────────────────────────────────────────
// Verified generator: v15-grounding.orig.ts:113 / :131 emit `source-${n}` or
// `<lane>-attested` as the *url* field. Those can never resolve.
const PLACEHOLDER_URL_RE = /^(?:source-\d+|[a-z-]+-attested|unknown|n\/a|)$/i;

export function isPlaceholderUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const u = String(url).trim();
  if (PLACEHOLDER_URL_RE.test(u)) return true;
  return !/^https?:\/\//i.test(u);
}

// ── Emitter grammar (all patterns taken verbatim from package source) ──────

/** `grounding [Section] · lane: message`  |  `HDIG · lane: message` */
const PREFIXED_RE = /^(?:grounding\s*\[([^\]]+)\]|HDIG|Re-ground\s*\(([^)]+)\))\s*·\s*([a-z0-9-]+):\s*(.*)$/i;
/** `grounded [Section]: +N source(s) for "query"` */
const GROUNDED_RE = /^grounded\s*\[([^\]]+)\]:\s*\+(\d+)\s+source\(s\)\s+for\s+"?(.*?)"?\s*$/i;
/** `HDIG: +N source(s) for "…" (ledger now K)` */
const HDIG_YIELD_RE = /^HDIG:\s*\+(\d+)\s+source\(s\)\s+for\s+"?(.*?)"?\s*(?:\(ledger now (\d+)\))?$/i;
/** `vanguard: 7 claims packed, 0 sources packed, utilization=6.6%` */
const VANGUARD_RE = /(\d+)\s+claims?\s+packed,\s*(\d+)\s+sources?\s+packed,\s*utilization=([\d.]+)%/i;
/** `palisade: 3 attested, 2 supported, proof=verified` */
const PALISADE_RE = /(\d+)\s+attested,\s*(\d+)\s+supported,\s*proof=([a-z-]+)/i;
/** `nexusResearch: 1 clean sources, 1 atoms, 0 quarantined` */
const CLEAN_ATOMS_RE = /(\d+)\s+clean\s+sources?,\s*(\d+)\s+atoms?,\s*(\d+)\s+quarantined/i;
/** `native-vnext: 6/10 fused results; 1 enriched; 0 quarantined` */
const FUSED_RE = /(\d+)\/(\d+)\s+fused\s+results;\s*(\d+)\s+enriched;\s*(\d+)\s+quarantined/i;
/** `portfolio: lane fulfilled in 1992ms` */
const FULFILLED_RE = /^([a-z0-9-]+)\s+fulfilled\s+in\s+(\d+)ms/i;
/** `portfolio: winner=terminal-wire sources=6 lanes=1` */
const WINNER_RE = /winner=([a-z0-9-]+)\s+sources=(\d+)\s+lanes=(\d+)/i;
/** `terminal-wire: crawl 3 seeds` */
const SEEDS_RE = /crawl\s+(\d+)\s+seeds?/i;
/** `structured-adapter: integrated 3 item(s) from crossref, semantic-scholar, …` */
const ADAPTER_RE = /integrated\s+(\d+)\s+items?\s+from\s+(.+)$/i;
/** `template-directed grounding complete: 12 total sources across 6 queries` */
const COMPLETE_RE = /grounding complete:\s*(\d+)\s+total sources across\s+(\d+)\s+quer/i;
/** `portfolio: no acceptable result; delegating to vanguard`  (:98 verbatim) */
const DELEGATE_RE = /no acceptable result;\s*delegating to\s+([a-z0-9-]+)/i;
/** `palisade: insufficient attested claims; delegating to arbiter-omega` (:138) */
const INSUFFICIENT_RE = /insufficient[^;]*;\s*delegating to\s+([a-z0-9-]+)/i;
/** `portfolio: starting sentinel-orchestrator` */
const STARTING_RE = /^starting\s+([a-z0-9-]+)/i;

function blankLane(lane: string, section: string | null, dt: number): LaneRecord {
  return {
    lane, section, query: null,
    firstDt: dt, lastDt: dt, durationMs: null,
    outcome: "running",
    atomsPacked: null, sourcesPacked: null, utilizationPct: null,
    cleanSources: null, quarantined: null, fusedResults: null, enrichedResults: null,
    attested: null, supported: null, proof: null, seedsCrawled: null,
    sourcesContributed: 0, adapters: [], failures: [],
    rawLines: [], citations: [], realUrls: [], placeholderUrls: [],
  };
}

/**
 * Build the forensics report from a run's raw event stream + citation ledger.
 * Pure function — no network, no model, fully reproducible from the run record.
 */
export function buildForensics(run: RunRecord): ForensicsReport {
  const byKey = new Map<string, LaneRecord>();
  const key = (lane: string, section: string | null) => `${lane}::${section ?? "-"}`;

  let winner: ForensicsReport["winner"] = null;
  let totalSourcesDeclared = 0;
  let queriesDispatched = 0;

  const relevant: TraceEvent[] = run.events.filter(
    (e) => e.source === "scraper" || e.phase === "grounding" || e.phase === "hdig" || e.phase === "reground"
  );

  for (const ev of relevant) {
    const msg = ev.message;

    // ── Section-scoped yield line ────────────────────────────────────────
    const g = GROUNDED_RE.exec(msg);
    if (g) {
      const section = g[1];
      const n = Number(g[2]);
      const q = g[3] || null;
      // Attribute the yield to the most recently active lane in that section.
      const candidates = [...byKey.values()].filter((l) => l.section === section);
      const target = candidates.sort((a, b) => b.lastDt - a.lastDt)[0];
      if (target) {
        target.sourcesContributed += n;
        if (q && !target.query) target.query = q;
      }
      totalSourcesDeclared += n;
      continue;
    }
    const h = HDIG_YIELD_RE.exec(msg);
    if (h) {
      const n = Number(h[1]);
      const candidates = [...byKey.values()].filter((l) => l.section === "HDIG");
      const target = candidates.sort((a, b) => b.lastDt - a.lastDt)[0];
      if (target) target.sourcesContributed += n;
      totalSourcesDeclared += n;
      continue;
    }
    const c = COMPLETE_RE.exec(msg);
    if (c) {
      queriesDispatched = Number(c[2]);
      continue;
    }

    // ── Lane-prefixed emission ───────────────────────────────────────────
    let lane: string | null = null;
    let section: string | null = null;
    let body = "";
    const p = PREFIXED_RE.exec(msg);
    if (p) {
      section = p[1] ?? p[2] ?? (/^HDIG/i.test(msg) ? "HDIG" : null);
      lane = p[3].toLowerCase();
      body = p[4];
    } else if (ev.source === "scraper" && ev.lane) {
      lane = String(ev.lane).toLowerCase();
      section = null;
      body = msg;
    } else {
      continue;
    }

    const k = key(lane, section);
    let rec = byKey.get(k);
    if (!rec) {
      rec = blankLane(lane, section, ev.dt);
      byKey.set(k, rec);
    }
    rec.lastDt = ev.dt;
    rec.rawLines.push({ dt: ev.dt, message: body });

    // ── Structured field extraction ──────────────────────────────────────
    const v = VANGUARD_RE.exec(body);
    if (v) {
      rec.atomsPacked = Number(v[1]);
      rec.sourcesPacked = Number(v[2]);
      rec.utilizationPct = Number(v[3]);
    }
    const pl = PALISADE_RE.exec(body);
    if (pl) {
      rec.attested = Number(pl[1]);
      rec.supported = Number(pl[2]);
      rec.proof = pl[3];
    }
    const ca = CLEAN_ATOMS_RE.exec(body);
    if (ca) {
      rec.cleanSources = Number(ca[1]);
      rec.atomsPacked = Number(ca[2]);
      rec.quarantined = Number(ca[3]);
      if (rec.sourcesPacked == null) rec.sourcesPacked = Number(ca[1]);
    }
    const fu = FUSED_RE.exec(body);
    if (fu) {
      rec.fusedResults = Number(fu[1]);
      rec.enrichedResults = Number(fu[3]);
      rec.quarantined = Number(fu[4]);
      if (rec.cleanSources == null) rec.cleanSources = Number(fu[3]);
      if (rec.sourcesPacked == null) rec.sourcesPacked = Number(fu[3]);
    }
    if (/exhausted|failed|circuit_open|too thin|no retrieval path succeeded|failed to fetch|401|403/i.test(body)) {
      rec.failures.push(body);
    }
    const s = SEEDS_RE.exec(body);
    if (s) rec.seedsCrawled = Number(s[1]);
    const a = ADAPTER_RE.exec(body);
    if (a) {
      rec.adapters = a[2].split(/,\s*/).map((x) => x.trim()).filter(Boolean);
      if (rec.sourcesPacked == null) rec.sourcesPacked = Number(a[1]);
    }
    const f = FULFILLED_RE.exec(body);
    if (f) {
      const child = f[1].toLowerCase();
      const ck = key(child, section);
      const childRec = byKey.get(ck) ?? blankLane(child, section, ev.dt);
      childRec.outcome = "fulfilled";
      childRec.durationMs = Number(f[2]);
      childRec.lastDt = ev.dt;
      byKey.set(ck, childRec);
    }
    const w = WINNER_RE.exec(body);
    if (w) {
      winner = { lane: w[1].toLowerCase(), sources: Number(w[2]), lanes: Number(w[3]) };
      const wk = key(w[1].toLowerCase(), section);
      const wr = byKey.get(wk);
      if (wr) wr.outcome = "winner";
    }
    const d = DELEGATE_RE.exec(body) ?? INSUFFICIENT_RE.exec(body);
    if (d) {
      rec.outcome = "quarantined";
      const nk = key(d[1].toLowerCase(), section);
      if (!byKey.has(nk)) byKey.set(nk, blankLane(d[1].toLowerCase(), section, ev.dt));
    }
    const st = STARTING_RE.exec(body);
    if (st) {
      const nk = key(st[1].toLowerCase(), section);
      if (!byKey.has(nk)) byKey.set(nk, blankLane(st[1].toLowerCase(), section, ev.dt));
    }
  }

  const lanes = [...byKey.values()].sort((a, b) => a.firstDt - b.firstDt);

  // ── Citation attribution by admission-timestamp window ───────────────────
  // Ledger entries carry the wall-clock ms at which the source was admitted.
  // Match each entry to the lane whose [firstDt,lastDt] window (converted to
  // wall clock via run.startedAt) contains it. Deterministic, no guessing.
  const unattributed: SourceRecord[] = [];
  const entries = (run.output as any)?.citationAudit?.entries as
    | Array<{ url?: string; title?: string; snippet?: string; stage?: string; timestamp?: number }>
    | undefined;

  const ledger: SourceRecord[] =
    Array.isArray(entries) && entries.length
      ? entries.map((e) => ({ stage: String(e.stage ?? "unknown"), title: e.title, url: e.url, snippet: e.snippet }))
      : run.sources;

  const stamps: number[] = Array.isArray(entries) ? entries.map((e) => Number(e.timestamp ?? 0)) : [];

  ledger.forEach((src, i) => {
    const ts = stamps[i] ?? 0;
    const dt = ts > 0 ? ts - run.startedAt : -1;
    let owner: LaneRecord | null = null;
    if (dt >= 0) {
      // Prefer the innermost lane window that contains the admission moment.
      const containing = lanes.filter((l) => dt >= l.firstDt - 1500 && dt <= l.lastDt + 1500);
      // Innermost = latest-starting lane in the containing set.
      owner = containing.sort((a, b) => b.firstDt - a.firstDt)[0] ?? null;
    }
    if (owner) {
      owner.citations.push(src);
      if (isPlaceholderUrl(src.url)) {
        if (src.url && !owner.placeholderUrls.includes(src.url)) owner.placeholderUrls.push(src.url);
      } else if (src.url && !owner.realUrls.includes(src.url)) {
        owner.realUrls.push(src.url);
      }
    } else {
      unattributed.push(src);
    }
  });

  // ── Zero-yield / quarantine classification (D14 / D14B) ──────────────────
  const zeroYieldLanes = lanes.filter(
    (l) => (l.atomsPacked ?? 0) > 0 && (l.sourcesPacked ?? 0) === 0
  );
  const quarantinedLanes = lanes.filter((l) => l.outcome === "quarantined");

  const allReal = [...new Set(lanes.flatMap((l) => l.realUrls).concat(unattributed.filter((u) => !isPlaceholderUrl(u.url)).map((u) => u.url!)))].filter(Boolean);
  const allPlaceholder = [...new Set(lanes.flatMap((l) => l.placeholderUrls).concat(unattributed.filter((u) => isPlaceholderUrl(u.url) && u.url).map((u) => u.url!)))].filter(Boolean);

  return {
    lanes,
    zeroYieldLanes,
    quarantinedLanes,
    winner,
    totals: {
      lanesSeen: lanes.length,
      totalSourcesDeclared,
      queriesDispatched,
      ledgerEntries: ledger.length,
      realUrlCount: allReal.length,
      placeholderUrlCount: allPlaceholder.length,
      cleanSourceThresholdChars: 80,
    },
    unattributedCitations: unattributed,
    allRealUrls: allReal,
    allPlaceholderUrls: allPlaceholder,
  };
}

/** Deterministic export artefact for handing to an external reviewer. */
export function exportForensics(run: RunRecord, rep: ForensicsReport): string {
  return JSON.stringify(
    {
      schema: "veritas.scraper-forensics/1",
      runId: run.id,
      question: run.question,
      exportedAt: new Date().toISOString(),
      cleanSourceRule: "clean := !quarantined && !hardQuarantined && content.length >= 80 (verified in package source)",
      placeholderUrlRule: "placeholder := !/^https?:\\/\\//  — generated at v15-grounding.orig.ts:113 and :131",
      totals: rep.totals,
      winner: rep.winner,
      lanes: rep.lanes.map((l) => ({
        lane: l.lane, section: l.section, query: l.query,
        outcome: l.outcome, durationMs: l.durationMs,
        atomsPacked: l.atomsPacked, sourcesPacked: l.sourcesPacked, utilizationPct: l.utilizationPct,
        cleanSources: l.cleanSources, quarantined: l.quarantined, fusedResults: l.fusedResults, enrichedResults: l.enrichedResults,
        attested: l.attested, supported: l.supported, proof: l.proof,
        seedsCrawled: l.seedsCrawled, adapters: l.adapters,
        failures: l.failures,
        sourcesContributed: l.sourcesContributed,
        realUrls: l.realUrls, placeholderUrls: l.placeholderUrls,
        citations: l.citations,
        rawLines: l.rawLines,
      })),
      zeroYieldLanes: rep.zeroYieldLanes.map((l) => `${l.lane}[${l.section ?? "-"}]: ${l.atomsPacked} atoms / ${l.sourcesPacked} sources / util=${l.utilizationPct}%`),
      quarantinedLanes: rep.quarantinedLanes.map((l) => `${l.lane}[${l.section ?? "-"}]`),
      unattributedCitations: rep.unattributedCitations,
      allRealUrls: rep.allRealUrls,
      allPlaceholderUrls: rep.allPlaceholderUrls,
    },
    null,
    2
  );
}
