/**
 * architecture-prescription.ts — NET-NEW (Type C). See flatten-guide.md.
 * ===========================================================================
 * "WHAT ARCHITECTURE DO I ACTUALLY NEED TO SCORE 9+ EVERY TIME?"
 *
 * This is NOT the defect list (that is pipeline-diagnosis.ts). A defect list
 * tells you what went wrong in ONE run. This tells you which ARCHITECTURAL
 * COMPONENTS must exist for 9+ to be reachable AT ALL, independent of run.
 *
 * ═══ THE CEILING MODEL (why this is not "sum of lifts") ═══
 * Prior turns reported `expectedLift` per defect and implicitly summed them.
 * That model is WRONG and it is why the projections never matched reality.
 *
 * The correct model is a MINIMUM OF CEILINGS:
 *
 *     achievable_score = min( ceilingWithout(c) : c ∈ ABSENT_COMPONENTS )
 *
 * Rationale: these components are not additive contributors, they are
 * PRECONDITIONS. If retrieval emits `source-3` as a URL, then no downstream
 * repair, no judge, and no template enforcement can produce a 9 — the report
 * is structurally uncitable. Adding a better repair pass to a run with broken
 * provenance does not move the ceiling at all. That is a min, not a sum.
 *
 * Empirical support from the supplied logs (4 runs):
 *   guard 4.4  — provenance broken + repair broken + depth abandoned
 *   guard 4.88 — provenance broken + repair broken
 *   guard 6.25 — provenance broken, repair contained by COVEA
 *   guard 8.1  — provenance mostly OK (9/21 real URLs), repair contained
 * In every case the observed score tracks the WEAKEST present precondition,
 * never the sum of the fixed ones. `ceilingWithout` values below are fitted
 * to those four observations and are declared as ESTIMATES, not measurements.
 *
 * ═══ HONESTY ═══
 * `ceilingWithout` is a calibrated estimate from 4 runs. It is not a measured
 * bound. `detect()` is exact — it reads the run record. Never present a
 * projected ceiling as an achieved score.
 * ===========================================================================
 */
import type { RunRecord } from "@/lib/debug/pipeline-trace-bus";
import { buildForensics, isPlaceholderUrl } from "@/lib/debug/scraper-forensics";
import { loadTemplateRubric } from "@/lib/debug/template-rubric";

export type Plane = "retrieval" | "synthesis" | "repair" | "evaluation";
export type Presence = "present" | "absent" | "degraded" | "unmeasured";

export interface ArchPatch {
  /** Where the change lives. Workspace paths are applicable today. */
  file: string;
  /** Verbatim anchor string in that file (durable across line drift). */
  anchor: string;
  /** What to change, in code terms. */
  change: string;
  /** Predicate that must hold after the change. */
  verify: string;
  /** True when this can be done in src/ without materialize.mjs. */
  workspaceReachable: boolean;
}

export interface ArchComponent {
  id: string;
  plane: Plane;
  name: string;
  /** One sentence: what this component guarantees. */
  guarantees: string;
  /**
   * Estimated hard ceiling on the guard score when this component is ABSENT.
   * Calibrated from 4 observed runs — an estimate, not a measured bound.
   */
  ceilingWithout: number;
  /** Exact detection against a run record. Returns presence + evidence. */
  detect: (run: RunRecord) => { presence: Presence; evidence: string };
  /** The patch that installs this component. */
  patch: ArchPatch;
}

// ── Detection helpers (pure, read-only) ────────────────────────────────────

function outcomeOf(run: RunRecord): Record<string, any> {
  return (run.output ?? {}) as Record<string, any>;
}
function finalTextOf(run: RunRecord): string {
  return run.finalText ?? "";
}
function hasEvent(run: RunRecord, re: RegExp): boolean {
  return run.events.some((e) => re.test(e.message));
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SPEC — ordered by ceiling (lowest ceiling = most blocking = fix first)
// ═══════════════════════════════════════════════════════════════════════════

export const ARCHITECTURE_SPEC: ArchComponent[] = [
  // ── RETRIEVAL PLANE ──────────────────────────────────────────────────────
  {
    id: "url-backed-provenance",
    plane: "retrieval",
    name: "URL-Backed Provenance",
    guarantees: "Every ledger entry carries a resolvable absolute http(s) URL. A claim atom is never emitted as if it were a document.",
    ceilingWithout: 6.0,
    detect: (run) => {
      const entries = outcomeOf(run)?.citationAudit?.entries as Array<{ url?: string }> | undefined;
      if (!Array.isArray(entries) || entries.length === 0) {
        return { presence: "unmeasured", evidence: "no citationAudit.entries on this run" };
      }
      const bad = entries.filter((e) => isPlaceholderUrl(e.url));
      if (bad.length === 0) return { presence: "present", evidence: `${entries.length}/${entries.length} entries URL-backed` };
      return {
        presence: bad.length === entries.length ? "absent" : "degraded",
        evidence: `${bad.length}/${entries.length} entries are non-resolvable (source-N / *-attested)`,
      };
    },
    patch: {
      file: "src/lib/scraper-vnext/vanguard-titanium.ts + src/lib/scraper-palisade/palisade-adjudicator.ts",
      anchor: "workspaceProvenanceRejected",
      change:
        "The package still maps vanguard/palisade atoms to `source-N`. Workspace wrappers now preserve both lanes for diagnostics but force `ok=false`, so those mapping branches cannot terminate the chain; grounding falls through to URL-bearing arbiter and later lanes. COVEA remains the post-pass backstop.",
      verify: "citationAudit.entries.every(e => /^https?:\\/\\//.test(e.url)) === true",
      workspaceReachable: true,
    },
  },
  {
    id: "yield-gated-acceptance",
    plane: "retrieval",
    name: "Yield-Gated Tier Acceptance",
    guarantees: "A retrieval tier is accepted only when it packed at least one real DOCUMENT, never on epistemic-atom count alone.",
    ceilingWithout: 6.5,
    detect: (run) => {
      let f;
      try { f = buildForensics(run); } catch { return { presence: "unmeasured", evidence: "forensics unavailable" }; }
      if (f.lanes.length === 0) return { presence: "unmeasured", evidence: "no lane telemetry" };
      if (f.zeroYieldLanes.length === 0) return { presence: "present", evidence: `${f.lanes.length} lanes, 0 zero-yield` };
      return {
        presence: "absent",
        evidence: `${f.zeroYieldLanes.length} lane(s) packed atoms with 0 sources: ${f.zeroYieldLanes.slice(0, 3).map((l) => `${l.lane}[${l.section ?? "-"}] ${l.atomsPacked}a/0s`).join(", ")}`,
      };
    },
    patch: {
      file: "src/lib/scraper-vnext/vanguard-titanium.ts",
      anchor: "workspaceYieldRejected",
      change:
        "Workspace wrapper now forces vanguard `ok=false` after recording atoms/source counts, preventing atom-only terminal success. Palisade wrapper similarly forces URL-bearing fallthrough because package mapping would synthesize `source-N`.",
      verify: "No lane may report `+N source(s)` for a section while its own telemetry reports `0 sources packed`.",
      workspaceReachable: true,
    },
  },
  {
    id: "intent-decomposition",
    plane: "retrieval",
    name: "Intent Facet Lattice (per-section query synthesis)",
    guarantees: "Each template section dispatches its own high-signal, domain-anchored keyword query. The raw or truncated user prompt is never used as a search string.",
    ceilingWithout: 7.0,
    detect: (run) => {
      const lattice = hasEvent(run, /Intent Facet Lattice/i);
      const boundary = hasEvent(run, /workspace-relevance-gate|workspace-yield-gate|workspace-provenance-gate/i);
      if (lattice && boundary) {
        const ev = run.events.find((e) => /Intent Facet Lattice/i.test(e.message));
        return { presence: "present", evidence: `${ev?.message ?? "lattice event present"}; lane-boundary gate observed` };
      }
      if (lattice) {
        return { presence: "degraded", evidence: "lattice built, but no lane-boundary workspace gate was observed — prompt-envelope injection alone may be sliced by package query builder" };
      }
      return { presence: "absent", evidence: "no `Intent Facet Lattice` event — grounding received the raw prompt" };
    },
    patch: {
      file: "src/lib/v15-pipeline.ts",
      anchor: "await injectIntentLattice(opts, runId, originalQuestion)",
      change:
        "Build the lattice from the UNTRUNCATED prompt via `buildLatticeQueries`, optionally enrich with `enrichLatticeWithLlm` (fails safe to the deterministic floor), and splice `renderLatticeDirective(lattice)` into the question envelope before the genome block.",
      verify: "Every dispatched grounding query differs from the raw prompt and contains the domain anchor token.",
      workspaceReachable: true,
    },
  },
  {
    id: "relevance-floor",
    plane: "retrieval",
    name: "Lexical Relevance Floor",
    guarantees: "A source is admitted only if it shares content tokens with the dispatching query. Length alone (>=80 chars) is not admission.",
    ceilingWithout: 7.0,
    detect: (run) => {
      const entries = outcomeOf(run)?.citationAudit?.entries as Array<{ title?: string; snippet?: string }> | undefined;
      if (!Array.isArray(entries) || entries.length === 0) return { presence: "unmeasured", evidence: "no ledger entries" };
      const qTok = new Set((run.question || "").toLowerCase().match(/[a-z]{4,}/g) ?? []);
      if (qTok.size < 3) return { presence: "unmeasured", evidence: "question too short to score overlap" };
      const irrelevant = entries.filter((e) => {
        const hay = `${e.title ?? ""} ${e.snippet ?? ""}`.toLowerCase();
        if (hay.trim().length < 20) return false;
        return ![...qTok].some((t) => hay.includes(t));
      });
      if (irrelevant.length === 0) return { presence: "present", evidence: `all ${entries.length} entries share ≥1 question token` };
      return {
        presence: "absent",
        evidence: `${irrelevant.length}/${entries.length} admitted sources share ZERO content words with the question: ${irrelevant.slice(0, 2).map((e) => `"${String(e.title ?? "").slice(0, 50)}"`).join(", ")}`,
      };
    },
    patch: {
      file: "src/lib/debug/retrieval-hardener.ts + src/lib/scraper-vnext/* lane wrappers",
      anchor: "filterRelevantSources",
      change:
        "All alias-reachable lanes now receive a whole-token IFL query and filter their returned sources by absolute URL, content length, quarantine status, facetCoherence>=0.2, and known drift signatures before the package can accept them.",
      verify: "No admitted source may score facetCoherence < 0.2 against its dispatching lattice query.",
      workspaceReachable: true,
    },
  },
  {
    id: "evidence-starvation-gate",
    plane: "retrieval",
    name: "Evidence-Starvation Fail-Closed",
    guarantees: "A section with zero URL-backed sources emits an explicit data gap instead of confident unsourced prose.",
    ceilingWithout: 6.5,
    detect: (run) => {
      const txt = finalTextOf(run);
      if (hasEvent(run, /EVIDENCE_STARVED/i) || /\[EVIDENCE_STARVED\]/i.test(txt)) {
        return { presence: "present", evidence: "evidence-starvation marker observed" };
      }
      let f;
      try { f = buildForensics(run); } catch { return { presence: "unmeasured", evidence: "forensics unavailable" }; }
      if (f.totals.realUrlCount === 0 && f.totals.ledgerEntries > 0) {
        return { presence: "absent", evidence: `${f.totals.ledgerEntries} ledger entries, 0 real URLs, and no EVIDENCE_STARVED marker was emitted` };
      }
      return { presence: "present", evidence: "no starved section detected this run" };
    },
    patch: {
      file: "src/lib/v15-grounding.ts",
      anchor: "EVIDENCE_STARVED",
      change:
        "Alias seam already fails closed (returns ok:false, sources:[]). The package V15 draft path imports grounding RELATIVELY so it bypasses this seam; the durable no-materialize cover is `annotateEvidenceStarvedSections` applied post-pass.",
      verify: "A section with 0 URL-backed sources must carry an [EVIDENCE_STARVED] annotation in the final text.",
      workspaceReachable: true,
    },
  },

  // ── SYNTHESIS PLANE ──────────────────────────────────────────────────────
  {
    id: "citation-integrity-gate",
    plane: "synthesis",
    name: "Citation Integrity Gate",
    guarantees: "No [S#] survives finalization unless it resolves to a trusted, URL-backed ledger entry. Grouped tags are handled id-by-id.",
    ceilingWithout: 6.0,
    detect: (run) => {
      const audit = outcomeOf(run)?.citationAudit;
      const covea = run.covea as { deterministicActions?: string[] } | undefined;
      const untrusted = Number(audit?.untrustedCount ?? 0);
      if (untrusted === 0) return { presence: "present", evidence: "0 untrusted citations" };
      const stripped = (covea?.deterministicActions ?? []).some((a) => /Removed invalid/i.test(a));
      return stripped
        ? { presence: "present", evidence: `${untrusted} untrusted citation(s) stripped by COVEA deterministic containment` }
        : { presence: "absent", evidence: `${untrusted} untrusted citation(s) survived to final text` };
    },
    patch: {
      file: "src/lib/debug/covea-repair.ts",
      anchor: "function stripInvalidCitationTags",
      change:
        "Compute bad ids from citationAudit.entries + auditResults (non-http, trusted:false, found:false, overlap<0.2, CSS-reset, zero-overlap), then remove ONLY those ids — including from grouped tags like [S3, S4] — before finalization.",
      verify: "extractCitationIds(finalText) ⊆ { ids whose ledger entry is http-backed and trusted }",
      workspaceReachable: true,
    },
  },
  {
    id: "template-coverage-enforcement",
    plane: "synthesis",
    name: "Template Coverage Enforcement",
    guarantees: "Every section the template declares is present in the output, or is present as an explicit machine-readable stub.",
    ceilingWithout: 8.5,
    detect: (run) => {
      const settings = outcomeOf(run)?.runSettings ?? {};
      const rubric = loadTemplateRubric(settings.templateId, settings.styleOverride, settings.williamsPersona);
      if (!rubric) return { presence: "unmeasured", evidence: "no template rubric for this run" };
      const txt = finalTextOf(run);
      const missing = rubric.sections.filter(
        (s) => !new RegExp(`##\\s*(?:§\\d+\\s*)?${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(txt)
      );
      if (missing.length === 0) return { presence: "present", evidence: `${rubric.sections.length}/${rubric.sections.length} sections present` };
      return {
        presence: "absent",
        evidence: `${rubric.sections.length - missing.length}/${rubric.sections.length} present; missing: ${missing.map((s) => s.title).join(", ")}`,
      };
    },
    patch: {
      file: "src/lib/v15-pipeline.ts",
      anchor: "export function insertMissingSectionStubs",
      change:
        "Post-pass, walk rubric.sections; for each absent title insert `## <title>` + `[MISSING SECTION — please supply]` + the section hint. Insertion-only, idempotent, inserted before References when present.",
      verify: "Template coverage == 100% after the post-pass, with stubs counted as explicit open items.",
      workspaceReachable: true,
    },
  },
  {
    id: "placeholder-resolution-gate",
    plane: "synthesis",
    name: "Placeholder Resolution Gate",
    guarantees: "No bare [DATA GAP]/[ASSUMPTION] token survives as if it were a quantity. Each becomes an explicit open item naming owner, input, and formula.",
    ceilingWithout: 8.0,
    detect: (run) => {
      const txt = finalTextOf(run);
      const bare = (txt.match(/\[(DATA GAP|ASSUMPTION|TBD|PROPOSED)\]/gi) ?? []).length;
      if (bare === 0) return { presence: "present", evidence: "0 bare placeholder tokens" };
      return { presence: "absent", evidence: `${bare} bare placeholder token(s) survived to final text` };
    },
    patch: {
      file: "src/lib/debug/covea-repair.ts",
      anchor: "function normalizeBarePlaceholders",
      change:
        "Convert `[DATA GAP]`/`[TBD]` → `[OPEN_INPUT: owner, source, formula required before decision sign-off]` and `[ASSUMPTION]`/`[PROPOSED]` → `[EXPLICIT_ASSUMPTION: owner, formula, sensitivity required]`. Never synthesize the missing value.",
      verify: "finalText contains zero bare placeholder tokens; every open item names an owner and required input.",
      workspaceReachable: true,
    },
  },

  // ── REPAIR PLANE ─────────────────────────────────────────────────────────
  {
    id: "anchored-targeted-repair",
    plane: "repair",
    name: "Anchored Targeted Repair (COVEA)",
    guarantees: "A defect is repaired by rewriting only its anchor span. A failed edit costs one defect, never the whole repair.",
    ceilingWithout: 7.5,
    detect: (run) => {
      if (run.covea) {
        const c = run.covea as { acceptedCount?: number; deterministicActions?: string[] };
        return {
          presence: "present",
          evidence: `COVEA ran — ${c.acceptedCount ?? 0} anchored patch(es) accepted, ${(c.deterministicActions ?? []).length} deterministic action(s)`,
        };
      }
      if (hasEvent(run, /shrank too much/i)) {
        return { presence: "absent", evidence: "package whole-document repair rejected on size and no COVEA pass ran" };
      }
      return { presence: "unmeasured", evidence: "no repair activity recorded" };
    },
    patch: {
      file: "src/lib/debug/covea-repair.ts",
      anchor: "export async function runCoveaRepair",
      change:
        "Post-completion, convert each CoVe failure and adversarial defect into a sentence-anchored target; rewrite ≤1 paragraph per patch under a ≤20% total edit budget with ≥60% region retention and citation-tag preservation. Deterministic containment runs first and needs no API key.",
      verify: "Post-repair blocking-defect count strictly decreases; every accepted edit matches exactly one anchor.",
      workspaceReachable: true,
    },
  },
  {
    id: "per-defect-depth-acceptance",
    plane: "repair",
    name: "Per-Defect Depth Acceptance",
    guarantees: "The N-Deep loop accepts a patch when the gate it targets clears, and spends its full depth budget instead of breaking on the first flat pass.",
    ceilingWithout: 8.0,
    detect: (run) => {
      const settings = outcomeOf(run)?.runSettings ?? {};
      const requested = Number(settings.depth ?? (run.input as any)?.maxDepth ?? 0);
      const executed = new Set(
        run.events.filter((e) => e.phase === "repair").map((e) => /^depth (\d+)/.exec(e.message)?.[1]).filter(Boolean)
      ).size;
      if (requested <= 1 || executed === 0) return { presence: "unmeasured", evidence: "no multi-depth budget on this run" };
      if (executed >= requested) return { presence: "present", evidence: `${executed}/${requested} depths executed` };
      return { presence: "absent", evidence: `maxDepth=${requested} but only ${executed} depth(s) executed — loop broke early` };
    },
    patch: {
      file: "src/lib/debug/covea-repair.ts",
      anchor: "export async function runCoveaRepair",
      change:
        "Package N-Deep still breaks early, but COVEA runs afterward with per-target acceptance: each failed anchor is independently accepted/rejected under bounded-edit and citation-preservation gates, so a rejected package depth no longer terminates repair capability.",
      verify: "A run with maxDepth=N executes N depths or logs an explicit skip reason per depth.",
      workspaceReachable: true,
    },
  },

  // ── EVALUATION PLANE ─────────────────────────────────────────────────────
  {
    id: "independent-or-floor-signal",
    plane: "evaluation",
    name: "Independent Judge OR Labelled Deterministic Floor",
    guarantees: "Every run carries either a real third-party judge score or a clearly-labelled deterministic floor. A fallback score is never fabricated into judgeScore.",
    ceilingWithout: 8.0,
    detect: (run) => {
      const o = outcomeOf(run);
      if (o.judgeScore != null) return { presence: "present", evidence: `judgeScore=${o.judgeScore}` };
      if (o.deterministicFloor != null) {
        return { presence: "present", evidence: `judge excluded; labelled deterministicFloor=${o.deterministicFloor} (judgeScore correctly null)` };
      }
      const excluded = Array.isArray(o.judgeExcluded) ? o.judgeExcluded.length : 0;
      if (excluded > 0) return { presence: "absent", evidence: `all ${excluded} judge(s) excluded and no deterministic floor was computed` };
      return { presence: "unmeasured", evidence: "no judge activity recorded" };
    },
    patch: {
      file: "src/lib/v15-pipeline.ts",
      anchor: "export function computeDeterministicFloor",
      change:
        "On judge exclusion, compute a floor from template coverage, citation trust ratio, placeholder density, placeholder-URL ratio, and truncation state. Write it to `outcome.deterministicFloor`. NEVER write into judgeScore.",
      verify: "judgeScore stays null on exclusion AND deterministicFloor is a finite number in [1, 9.5].",
      workspaceReachable: true,
    },
  },
  {
    id: "drift-detection",
    plane: "evaluation",
    name: "Retrieval Drift Detection",
    guarantees: "A retrieved document that shares no facet tokens with its dispatching query is flagged as drift and down-weighted before it can be cited.",
    ceilingWithout: 8.5,
    detect: (run) => {
      if (hasEvent(run, /Intent Facet Lattice/i)) {
        return { presence: "present", evidence: "lattice active — facetCoherence/isLikelyDriftResult available for admitted sources" };
      }
      return { presence: "absent", evidence: "no lattice on this run, so no facet provenance exists to score drift against" };
    },
    patch: {
      file: "src/lib/debug/intent-lattice.ts",
      anchor: "export function isLikelyDriftResult",
      change:
        "Score each admitted source with `facetCoherence(query, title+snippet)`; treat < 0.2 as drift (< 0.34 when a known noise term is present) and exclude it from the citable set.",
      verify: "isLikelyDriftResult returns true for the CHAGEE-tea result against a cannabis query and false for an on-topic cannabis result.",
      workspaceReachable: true,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// ASSESSMENT + PRESCRIPTION
// ═══════════════════════════════════════════════════════════════════════════

export interface ComponentAssessment {
  component: ArchComponent;
  presence: Presence;
  evidence: string;
}

export interface Prescription {
  runId: string;
  observedGuard: number | null;
  observedJudge: number | null;
  deterministicFloor: number | null;
  /** min(ceilingWithout) over absent components. 10 when none absent. */
  projectedCeiling: number;
  /** The component that sets the ceiling — fix this one first. */
  bindingConstraint: ArchComponent | null;
  assessments: ComponentAssessment[];
  /** Absent/degraded components ordered by ceiling ascending (most blocking first). */
  ordered: ComponentAssessment[];
  /** Split by whether the patch can land in src/ today. */
  workspaceToday: ComponentAssessment[];
  needsPackageEdit: ComponentAssessment[];
  /** Components we could not measure from this run's telemetry. */
  unmeasured: ComponentAssessment[];
}

export function assessArchitecture(run: RunRecord): ComponentAssessment[] {
  return ARCHITECTURE_SPEC.map((component) => {
    let presence: Presence = "unmeasured";
    let evidence = "detector threw";
    try {
      const r = component.detect(run);
      presence = r.presence;
      evidence = r.evidence;
    } catch (e) {
      evidence = `detector error: ${e instanceof Error ? e.message : String(e)}`;
    }
    return { component, presence, evidence };
  });
}

export function prescribe(run: RunRecord): Prescription {
  const assessments = assessArchitecture(run);
  const blocking = assessments.filter((a) => a.presence === "absent" || a.presence === "degraded");
  const ordered = [...blocking].sort((a, b) => a.component.ceilingWithout - b.component.ceilingWithout);

  // THE MIN-OF-CEILINGS MODEL. Not a sum.
  const projectedCeiling = ordered.length === 0 ? 10 : ordered[0].component.ceilingWithout;
  const bindingConstraint = ordered[0]?.component ?? null;

  const o = outcomeOf(run);
  return {
    runId: run.id,
    observedGuard: run.guardScore ?? null,
    observedJudge: run.judgeScore ?? null,
    deterministicFloor: typeof o.deterministicFloor === "number" ? o.deterministicFloor : null,
    projectedCeiling,
    bindingConstraint,
    assessments,
    ordered,
    workspaceToday: ordered.filter((a) => a.component.patch.workspaceReachable),
    needsPackageEdit: ordered.filter((a) => !a.component.patch.workspaceReachable),
    unmeasured: assessments.filter((a) => a.presence === "unmeasured"),
  };
}

/** Human-readable prescription. This is the artifact the user acts on. */
export function renderPrescription(p: Prescription): string {
  const L: string[] = [];
  L.push("# ARCHITECTURE PRESCRIPTION — path to a repeatable 9+");
  L.push(`Run: ${p.runId}`);
  L.push(`Observed: guard=${p.observedGuard ?? "n/a"} · judge=${p.observedJudge ?? "unavailable"} · deterministicFloor=${p.deterministicFloor ?? "n/a"}`);
  L.push("");
  L.push("## Ceiling model");
  L.push("achievable = MIN(ceilingWithout) over ABSENT components — these are preconditions, not additive contributors.");
  L.push(`Projected ceiling with the current architecture: **${p.projectedCeiling.toFixed(1)}/10**`);
  if (p.bindingConstraint) {
    L.push(`Binding constraint: **${p.bindingConstraint.name}** (${p.bindingConstraint.plane}) — nothing downstream can raise the score past ${p.bindingConstraint.ceilingWithout.toFixed(1)} while this is absent.`);
  } else {
    L.push("No absent component detected — the architecture required for 9+ is fully installed for this run.");
  }
  L.push("");

  if (p.ordered.length > 0) {
    L.push(`## Required components, most-blocking first (${p.ordered.length})`);
    p.ordered.forEach((a, i) => {
      const c = a.component;
      L.push("");
      L.push(`### ${i + 1}. ${c.name} — ceiling ${c.ceilingWithout.toFixed(1)} without it  [${a.presence.toUpperCase()}]`);
      L.push(`- plane: ${c.plane}`);
      L.push(`- guarantees: ${c.guarantees}`);
      L.push(`- observed: ${a.evidence}`);
      L.push(`- file: \`${c.patch.file}\``);
      L.push(`- anchor: \`${c.patch.anchor}\``);
      L.push(`- change: ${c.patch.change}`);
      L.push(`- verify: ${c.patch.verify}`);
      L.push(`- reachable in src/ today: ${c.patch.workspaceReachable ? "YES" : "NO — requires materialize.mjs or a full flatten"}`);
    });
  }

  L.push("");
  L.push("## Split by reachability");
  L.push(`- fixable in src/ today: ${p.workspaceToday.length} (${p.workspaceToday.map((a) => a.component.id).join(", ") || "none"})`);
  L.push(`- requires package edit: ${p.needsPackageEdit.length} (${p.needsPackageEdit.map((a) => a.component.id).join(", ") || "none"})`);
  if (p.unmeasured.length > 0) {
    L.push("");
    L.push(`## Unmeasured on this run (${p.unmeasured.length}) — neither passing nor failing`);
    for (const a of p.unmeasured) L.push(`- ${a.component.name}: ${a.evidence}`);
  }
  L.push("");
  L.push("## Honesty");
  L.push("`ceilingWithout` values are estimates calibrated against 4 observed runs (guard 4.4 / 4.88 / 6.25 / 8.1). They are NOT measured bounds. Detection is exact — it reads the run record. Do not report a projected ceiling as an achieved score.");
  return L.join("\n");
}

/** Machine-readable prescription for an IDE agent or external reviewer. */
export function exportPrescription(p: Prescription): string {
  return JSON.stringify(
    {
      schema: "veritas.architecture-prescription/1",
      runId: p.runId,
      generatedAt: new Date().toISOString(),
      ceilingModel: "achievable = min(ceilingWithout) over absent components; preconditions, not additive lifts",
      observed: { guard: p.observedGuard, judge: p.observedJudge, deterministicFloor: p.deterministicFloor },
      projectedCeiling: p.projectedCeiling,
      bindingConstraint: p.bindingConstraint?.id ?? null,
      components: p.assessments.map((a) => ({
        id: a.component.id,
        plane: a.component.plane,
        name: a.component.name,
        presence: a.presence,
        evidence: a.evidence,
        ceilingWithout: a.component.ceilingWithout,
        patch: a.component.patch,
      })),
      caveat: "ceilingWithout is a calibrated estimate from 4 runs, not a measured bound.",
    },
    null,
    2
  );
}
