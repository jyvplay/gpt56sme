/**
 * self-test.ts — NET-NEW (Type C). See flatten-guide.md.
 * ===========================================================================
 * EXECUTABLE VERIFICATION for the pure workspace primitives.
 *
 * Every function under test here is PURE — no network, no model, no clock —
 * so these are real assertions, not smoke tests. They run in the browser from
 * the Debug Console ("Self-Test" tab) and return structured results.
 *
 * HONESTY: the authoring model cannot execute this file. It is compile-
 * verified only. Running it in the browser is what turns these into evidence.
 * A test that has never been run is a claim, not a verification.
 * ===========================================================================
 */
import {
  extractCitationIds,
  looksLikeBoilerplate,
  endsOnDanglingConnector,
  computeDeterministicFloor,
  annotateEvidenceStarvedSections,
  insertMissingSectionStubs,
} from "@/lib/v15-pipeline";
import {
  extractFacets,
  buildLatticeQueries,
  facetCoherence,
  isLikelyDriftResult,
  renderLatticeDirective,
  enrichLatticeWithLlm,
} from "@/lib/debug/intent-lattice";
import { isPlaceholderUrl } from "@/lib/debug/scraper-forensics";
import {
  extractMainSemanticContent,
  buildAccessibilityTree,
} from "@/lib/debug/veritas-hybrid-scraper";
import { ARCHITECTURE_SPEC, prescribe, renderPrescription } from "@/lib/debug/architecture-prescription";
import { absoluteUrl, dedupeSources, filterRelevantSources, filterRelevantSourcesAny, hardenRetrievalQuery } from "@/lib/debug/retrieval-hardener";
import { SCRAPER_LANE_ROADMAP } from "@/lib/debug/scraper-lane-roadmap";
import { clearRetrievalContext, registerRetrievalContext, resolveRetrievalQueries } from "@/lib/debug/retrieval-context";
import { buildUnifiedInnovationPlan, expandPath, stableSeed } from "@/lib/debug/unified-innovation";
import { buildDeterministicResearchQueries, longestPromptQuote, queryIsDecomposed } from "@/lib/debug/research-phase";
import type { RunRecord } from "@/lib/debug/pipeline-trace-bus";

export interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface SelfTestReport {
  ranAt: number;
  results: TestResult[];
  passed: number;
  failed: number;
  suites: string[];
}

export async function runSelfTests(): Promise<SelfTestReport> {
  const results: TestResult[] = [];
  let suite = "";
  const check = (name: string, passed: boolean, detail = "") =>
    results.push({ suite, name, passed, detail });

  // ── Pure text primitives ─────────────────────────────────────────────────
  suite = "text-primitives";
  try {
    check("extractCitationIds: single tags", JSON.stringify(extractCitationIds("a [S1] b [S3]")) === "[1,3]", JSON.stringify(extractCitationIds("a [S1] b [S3]")));
    check("extractCitationIds: grouped tags", JSON.stringify(extractCitationIds("x [S4, S10] y")) === "[4,10]", JSON.stringify(extractCitationIds("x [S4, S10] y")));
    check("extractCitationIds: dedupes", JSON.stringify(extractCitationIds("[S2] [S2] [S2]")) === "[2]", JSON.stringify(extractCitationIds("[S2] [S2] [S2]")));
    check("extractCitationIds: empty on none", extractCitationIds("no citations here").length === 0, "empty array");

    check("looksLikeBoilerplate: flags CSS reset", looksLikeBoilerplate("table, caption, tbody, tfoot {margin: 0;padding: 0;border: 0;}") === true, "CSS reset detected");
    check("looksLikeBoilerplate: flags font var block", looksLikeBoilerplate("body {font-family: var(--font-Inter);}") === true, "font chrome detected");
    check("looksLikeBoilerplate: keeps real prose", looksLikeBoilerplate("Cannabis use significantly increases heart rate in the minutes following inhalation.") === false, "real content retained");
    check("looksLikeBoilerplate: empty is boilerplate", looksLikeBoilerplate("") === true, "empty rejected");

    check("endsOnDanglingConnector: flags trailing 'and'", endsOnDanglingConnector("The market is large and") === true, "dangling connector caught");
    check("endsOnDanglingConnector: flags trailing 'because'", endsOnDanglingConnector("This matters because") === true, "dangling connector caught");
    check("endsOnDanglingConnector: clean sentence passes", endsOnDanglingConnector("The market is large.") === false, "complete sentence retained");
  } catch (e) {
    check("text-primitives: threw", false, String(e));
  }

  // ── Deterministic floor ──────────────────────────────────────────────────
  suite = "deterministic-floor";
  try {
    const perfect = computeDeterministicFloor({ templateCoverage: 1, citationTrustRatio: 1, placeholderDensity: 0, placeholderUrlRatio: 0, truncated: false });
    const broken = computeDeterministicFloor({ templateCoverage: 0.5, citationTrustRatio: 0.2, placeholderDensity: 0.01, placeholderUrlRatio: 0.8, truncated: true });
    check("floor: perfect input caps at 9.5", perfect === 9.5, `perfect = ${perfect}`);
    check("floor: broken input scores low", broken < 4, `broken = ${broken}`);
    check("floor: monotone in template coverage",
      computeDeterministicFloor({ templateCoverage: 1, citationTrustRatio: 0.5, placeholderDensity: 0, placeholderUrlRatio: 0, truncated: false }) >
      computeDeterministicFloor({ templateCoverage: 0.5, citationTrustRatio: 0.5, placeholderDensity: 0, placeholderUrlRatio: 0, truncated: false }),
      "higher coverage ⇒ higher floor");
    check("floor: monotone in citation trust",
      computeDeterministicFloor({ templateCoverage: 1, citationTrustRatio: 1, placeholderDensity: 0, placeholderUrlRatio: 0, truncated: false }) >
      computeDeterministicFloor({ templateCoverage: 1, citationTrustRatio: 0, placeholderDensity: 0, placeholderUrlRatio: 0, truncated: false }),
      "higher trust ⇒ higher floor");
    check("floor: truncation is penalised",
      computeDeterministicFloor({ templateCoverage: 1, citationTrustRatio: 1, placeholderDensity: 0, placeholderUrlRatio: 0, truncated: true }) <
      computeDeterministicFloor({ templateCoverage: 1, citationTrustRatio: 1, placeholderDensity: 0, placeholderUrlRatio: 0, truncated: false }),
      "truncated ⇒ lower floor");
    check("floor: never below 1", computeDeterministicFloor({ templateCoverage: 0, citationTrustRatio: 0, placeholderDensity: 1, placeholderUrlRatio: 1, truncated: true }) >= 1, "floor >= 1");
    check("floor: never above 9.5 (not a judge score)", perfect <= 9.5, "floor <= 9.5 — cannot masquerade as a 10");
  } catch (e) {
    check("deterministic-floor: threw", false, String(e));
  }

  // ── Placeholder URL classification ───────────────────────────────────────
  suite = "url-classification";
  try {
    check("isPlaceholderUrl: source-N is placeholder", isPlaceholderUrl("source-3") === true, "index-derived url rejected");
    check("isPlaceholderUrl: vanguard-attested is placeholder", isPlaceholderUrl("vanguard-attested") === true, "attestation token rejected");
    check("isPlaceholderUrl: real doi is not placeholder", isPlaceholderUrl("https://doi.org/10.1089/can.2024.0030") === false, "real URL retained");
    check("isPlaceholderUrl: undefined is placeholder", isPlaceholderUrl(undefined) === true, "missing url rejected");
  } catch (e) {
    check("url-classification: threw", false, String(e));
  }

  // ── insertMissingSectionStubs ────────────────────────────────────────────
  suite = "missing-section-stubs";
  try {
    const partial = "## §1 BLUF\n\nThesis.\n\n## §2 Situation (SCQA)\n\nBaseline.";
    const { text, inserted } = insertMissingSectionStubs(partial, "OMEGA-STRATEGY");
    check("insertMissingSectionStubs: detects the absent Appendix", inserted.includes("Appendix (T-Body)"), `inserted = ${JSON.stringify(inserted)}`);
    check("insertMissingSectionStubs: emits machine-readable open item", text.includes("[MISSING SECTION — please supply]"), "stub marker present");
    check("insertMissingSectionStubs: preserves present sections", text.includes("## §1 BLUF") && text.includes("Baseline."), "no existing content altered");
    check("insertMissingSectionStubs: output grows (insertion-only)", text.length > partial.length, `${partial.length} → ${text.length} chars`);
    const { inserted: none } = insertMissingSectionStubs(text, "OMEGA-STRATEGY");
    check("insertMissingSectionStubs: idempotent (stub now counts as present)", !none.includes("Appendix (T-Body)"), `second pass inserted = ${JSON.stringify(none)}`);
    const { inserted: noTpl } = insertMissingSectionStubs(partial, undefined);
    check("insertMissingSectionStubs: no template ⇒ no-op", noTpl.length === 0, "safe without a template id");
  } catch (e) {
    check("insertMissingSectionStubs: threw", false, String(e));
  }

  // ── annotateEvidenceStarvedSections ──────────────────────────────────────
  suite = "evidence-starvation";
  try {
    const doc = "## BLUF\n\nClaim without evidence.\n\n## Diagnostic (T-Bar)\n\nMore text.";
    const { text, annotated } = annotateEvidenceStarvedSections(doc, ["BLUF"]);
    check("annotateEvidenceStarvedSections: marks the starved section", annotated.includes("BLUF"), `annotated = ${JSON.stringify(annotated)}`);
    check("annotateEvidenceStarvedSections: emits the marker", text.includes("[EVIDENCE_STARVED]"), "marker present");
    check("annotateEvidenceStarvedSections: leaves other sections alone", text.includes("## Diagnostic (T-Bar)\n\nMore text."), "untouched section preserved");
    const { annotated: again } = annotateEvidenceStarvedSections(text, ["BLUF"]);
    check("annotateEvidenceStarvedSections: idempotent", again.length === 0, `second pass annotated = ${JSON.stringify(again)}`);
    const { annotated: missing } = annotateEvidenceStarvedSections(doc, ["Nonexistent Section"]);
    check("annotateEvidenceStarvedSections: skips absent sections", missing.length === 0, "no phantom annotation");
  } catch (e) {
    check("annotateEvidenceStarvedSections: threw", false, String(e));
  }

  // ── Intent Facet Lattice ─────────────────────────────────────────────────
  suite = "intent-facet-lattice";
  try {
    const q = "Find me a product that doesn't exist but solves a large unmet demand and can be made using existing technology in the cannabis space";
    const facets = extractFacets(q);
    check("extractFacets: finds the cannabis domain facet", facets.some(f => f.axis === "domain" && f.phrase === "cannabis"), `facets = ${facets.map(f => `${f.axis}:${f.phrase}`).join(", ")}`);
    check("extractFacets: finds the 'existing technology' constraint", facets.some(f => f.axis === "constraint" && /existing technology/.test(f.phrase)), "constraint facet present");
    check("extractFacets: finds the 'unmet demand' constraint", facets.some(f => f.axis === "constraint" && /unmet demand/.test(f.phrase)), "constraint facet present");
    check("extractFacets: deterministic (same input ⇒ same output)", JSON.stringify(extractFacets(q)) === JSON.stringify(facets), "stable across calls");
    check("extractFacets: every phrase is a keyword, not a sentence", facets.every(f => f.phrase.split(/\s+/).length <= 6), "no sentence-length facets");

    const lattice = buildLatticeQueries(q, ["BLUF", "Diagnostic (T-Bar)"]);
    check("buildLatticeQueries: produces per-section queries",
      lattice.queries.length >= 2 && lattice.queries.some(x => x.section === "Diagnostic (T-Bar)"),
      `queries = ${lattice.queries.map(x => `[${x.section}] ${x.q}`).join(" | ")}`);
    check("buildLatticeQueries: no query is the raw prompt", lattice.queries.every(x => x.q !== q && x.q.length < q.length), "every query is decomposed, not the raw prompt");
    check("buildLatticeQueries: every query anchors on the domain", lattice.queries.every(x => x.q.toLowerCase().includes("cannabis")), "domain anchor present in all queries");
    check("buildLatticeQueries: each query carries facet provenance", lattice.queries.every(x => x.facets.length > 0 && x.axes.length > 0), "provenance attached");
    check("buildLatticeQueries: sections get distinct queries",
      new Set(lattice.queries.map(x => x.q)).size > 1, "queries are not all identical (the observed defect)");
    check("buildLatticeQueries: unknown section falls back to general", buildLatticeQueries(q, ["Totally Unknown Section"]).queries.length > 0, "graceful fallback");

    const cannabisQuery = lattice.queries[0];
    const onTopic = "Cannabis vaporizer market size and growth 2024";
    const offTopic = "Competitive Landscape and Strategic Adjustments of CHAGEE's Market Share tea beverage";
    check("facetCoherence: on-topic scores higher than off-topic",
      facetCoherence(cannabisQuery, onTopic) > facetCoherence(cannabisQuery, offTopic),
      `on=${facetCoherence(cannabisQuery, onTopic)} off=${facetCoherence(cannabisQuery, offTopic)}`);
    check("facetCoherence: bounded 0..1",
      [onTopic, offTopic, ""].every(t => { const c = facetCoherence(cannabisQuery, t); return c >= 0 && c <= 1; }),
      "score in range");
    check("isLikelyDriftResult: flags the CHAGEE-tea noise result", isLikelyDriftResult(offTopic, cannabisQuery) === true, "known drift pattern detected");
    check("isLikelyDriftResult: keeps the on-topic result", isLikelyDriftResult(onTopic, cannabisQuery) === false, "on-topic retained");
    check("isLikelyDriftResult: flags the CSS-reset blob", isLikelyDriftResult("table, caption, tbody {margin:0;padding:0}", cannabisQuery) === true, "boilerplate is drift");

    const directive = renderLatticeDirective(lattice);
    check("renderLatticeDirective: contains the lattice header", directive.includes("RETRIEVAL INTENT LATTICE"), "header present");
    check("renderLatticeDirective: lists every query", lattice.queries.every(x => directive.includes(x.q)), "no query dropped from the directive");
    check("renderLatticeDirective: forbids raw-prompt fallback", /do not fall back to the raw user prompt/i.test(directive), "explicit instruction present");
    check("renderLatticeDirective: nothing truncated", !directive.includes("…") && !directive.includes("[truncated]"), "no ellipsis or truncation marker");
  } catch (e) {
    check("intent-facet-lattice: threw", false, String(e));
  }

  // ── LLM enrichment fail-safe (no network — injected fakes) ───────────────
  suite = "lattice-enrichment-failsafe";
  try {
    const base = buildLatticeQueries("cannabis vaporizer market size 2024", ["BLUF"]);

    const on429 = await enrichLatticeWithLlm(base, async () => ({ ok: false, text: "", error: "HTTP 429 quota" }));
    check("enrich: 429 returns the deterministic floor unchanged", on429.ok === false && on429.lattice === base, "floor retained on 429");

    const onGarbage = await enrichLatticeWithLlm(base, async () => ({ ok: true, text: "this is not json at all" }));
    check("enrich: unparseable response keeps the floor", onGarbage.lattice.queries.length === base.queries.length, "floor retained on parse failure");

    const onThrow = await enrichLatticeWithLlm(base, async () => { throw new Error("network down"); });
    check("enrich: thrown error keeps the floor", onThrow.ok === false && onThrow.lattice === base, "floor retained on throw");

    const onGood = await enrichLatticeWithLlm(base, async () => ({ ok: true, text: '[{"axis":"metric","phrase":"retail sell-through rate"}]' }));
    check("enrich: valid facets are merged", onGood.ok === true && onGood.lattice.facets.some(f => f.phrase === "retail sell-through rate"), "facet added");
    check("enrich: llmEnriched flag set on success", onGood.lattice.llmEnriched === true, "flag set");
    check("enrich: floor facets survive enrichment", base.facets.every(bf => onGood.lattice.facets.some(f => f.phrase === bf.phrase)), "no deterministic facet removed");

    const onBadAxis = await enrichLatticeWithLlm(base, async () => ({ ok: true, text: '[{"axis":"nonsense","phrase":"x"}]' }));
    check("enrich: rejects invalid axis", !onBadAxis.lattice.facets.some(f => f.phrase === "x"), "invalid axis dropped");
  } catch (e) {
    check("lattice-enrichment-failsafe: threw", false, String(e));
  }

  // ── Architecture prescription ────────────────────────────────────────────
  suite = "architecture-prescription";
  try {
    check("spec: every component has a patch anchor", ARCHITECTURE_SPEC.every(c => c.patch.anchor.length > 0), `${ARCHITECTURE_SPEC.length} components`);
    check("spec: every component has a verify predicate", ARCHITECTURE_SPEC.every(c => c.patch.verify.length > 0), "all verifiable");
    check("spec: ceilings are in (0,10]", ARCHITECTURE_SPEC.every(c => c.ceilingWithout > 0 && c.ceilingWithout <= 10), "ceilings sane");
    check("spec: component ids are unique", new Set(ARCHITECTURE_SPEC.map(c => c.id)).size === ARCHITECTURE_SPEC.length, "no duplicate ids");
    check("spec: all four planes represented",
      new Set(ARCHITECTURE_SPEC.map(c => c.plane)).size === 4,
      `planes = ${[...new Set(ARCHITECTURE_SPEC.map(c => c.plane))].join(", ")}`);

    // Synthetic run reproducing the WORST observed log (guard 4.4).
    const brokenRun = {
      id: "synthetic-broken", mode: "v15", question: "cannabis product market size",
      startedAt: 0, endedAt: 1, status: "complete", events: [], phaseStats: {}, passes: [], sources: [],
      input: {}, finalText: "## BLUF\n\nClaim [S1] with [DATA GAP] value.",
      guardScore: 4.4, judgeScore: null,
      output: {
        runSettings: { templateId: "OMEGA-STRATEGY", depth: 4 },
        judgeExcluded: [{ model: "gemini-2.5-pro", reason: "429" }],
        citationAudit: { entries: [{ id: 1, url: "source-1", title: "PCB failure analysis" }], totalCitations: 1, trustedCount: 0, untrustedCount: 1 },
      },
    } as unknown as RunRecord;

    const p = prescribe(brokenRun);
    check("prescribe: projects a ceiling below 9 for the broken run", p.projectedCeiling < 9, `projectedCeiling = ${p.projectedCeiling}`);
    check("prescribe: names a binding constraint", p.bindingConstraint !== null, `binding = ${p.bindingConstraint?.id}`);
    check("prescribe: ceiling equals the MIN over absent components (not a sum)",
      p.ordered.length === 0 || p.projectedCeiling === Math.min(...p.ordered.map(a => a.component.ceilingWithout)),
      `ceiling=${p.projectedCeiling} min=${p.ordered.length ? Math.min(...p.ordered.map(a => a.component.ceilingWithout)) : "n/a"}`);
    check("prescribe: detects the placeholder-URL break",
      p.assessments.some(a => a.component.id === "url-backed-provenance" && (a.presence === "absent" || a.presence === "degraded")),
      "provenance flagged");
    check("prescribe: detects the surviving bare placeholder",
      p.assessments.some(a => a.component.id === "placeholder-resolution-gate" && a.presence === "absent"),
      "placeholder gate flagged");
    check("prescribe: detects the missing intent lattice",
      p.assessments.some(a => a.component.id === "intent-decomposition" && a.presence === "absent"),
      "lattice absence flagged");
    check("prescribe: detects the missing judge signal",
      p.assessments.some(a => a.component.id === "independent-or-floor-signal" && a.presence === "absent"),
      "judge/floor gap flagged");
    check("prescribe: splits reachability", p.workspaceToday.length + p.needsPackageEdit.length === p.ordered.length, "split is exhaustive");
    check("prescribe: ordered is ascending by ceiling",
      p.ordered.every((a, i) => i === 0 || p.ordered[i - 1].component.ceilingWithout <= a.component.ceilingWithout),
      "most-blocking first");

    const md = renderPrescription(p);
    check("renderPrescription: emits the ceiling model", md.includes("MIN(ceilingWithout)"), "model stated");
    check("renderPrescription: states the honesty caveat", /calibrated estimate|NOT measured bounds/i.test(md), "estimate disclosed");
    check("renderPrescription: names files and anchors", md.includes("anchor:") && md.includes("file:"), "actionable coordinates present");

    // A healthy synthetic run must NOT be told to fix everything.
    const healthyRun = {
      ...brokenRun, id: "synthetic-healthy",
      finalText: "## BLUF\n\nClaim [S1].\n\n## Situation (SCQA)\n\nx\n\n## Diagnostic (T-Bar)\n\nx\n\n## Options Tournament\n\nx\n\n## Recommendation & Value Bridge\n\nx\n\n## Implementation (Wave Architecture)\n\nx\n\n## Risk Register & Assumption Ledger\n\nx\n\n## Appendix (T-Body)\n\nx",
      events: [
        { seq: 1, ts: 0, dt: 0, phase: "init", source: "system", message: "G7 Intent Facet Lattice · 9 facets · 16 per-section queries" },
        { seq: 2, ts: 0, dt: 1, phase: "grounding", source: "progress", message: "workspace-relevance-gate: portfolio accepted 2, rejected 0" },
      ],
      guardScore: 9.1,
      output: {
        ...(brokenRun.output as Record<string, unknown>),
        judgeScore: 9.2,
        citationAudit: { entries: [{ id: 1, url: "https://doi.org/10.1089/can.2024.0030", title: "cannabis market" }], totalCitations: 1, trustedCount: 1, untrustedCount: 0 },
      },
    } as unknown as RunRecord;
    const ph = prescribe(healthyRun);
    check("prescribe: healthy run projects a higher ceiling than broken", ph.projectedCeiling > p.projectedCeiling, `healthy=${ph.projectedCeiling} broken=${p.projectedCeiling}`);
    check("prescribe: healthy run detects the lattice as present",
      ph.assessments.some(a => a.component.id === "intent-decomposition" && a.presence === "present"), "lattice present");
    check("prescribe: healthy run has no bare-placeholder defect",
      ph.assessments.some(a => a.component.id === "placeholder-resolution-gate" && a.presence === "present"), "placeholders clean");
  } catch (e) {
    check("architecture-prescription: threw", false, String(e));
  }

  // ── Veritas Hybrid Scraper Engine ───────────────────────────────────────
  suite = "veritas-hybrid-scraper";
  try {
    const testHtml = `
      <!doctype html>
      <html>
      <head><title>Test Article Title</title></head>
      <body>
        <main>
          <article>
            <h1>Main Topic of Interest</h1>
            <p>This is the main semantic body text representing highly relevant evidence.</p>
            <a href="https://doi.org/10.1089/can.2024.0030" title="THC study">Read the cannabis heart-rate study</a>
            <button id="buy" role="button">Purchase product</button>
          </article>
        </main>
      </body>
      </html>
    `;
    const parsed = extractMainSemanticContent(testHtml);
    check("hybrid-scraper: parses correct title", parsed.title === "Test Article Title", parsed.title);
    check("hybrid-scraper: extracts main paragraph text", parsed.body.includes("highly relevant evidence"), parsed.body);

    const { tree, nodes } = buildAccessibilityTree(testHtml);
    check("hybrid-scraper: builds PinchTab-style tree", tree.includes("HEADING") && tree.includes("LINK") && tree.includes("BUTTON"), tree);
    check("hybrid-scraper: parses link node with correct absolute url", nodes.some(n => n.role === "link" && n.url === "https://doi.org/10.1089/can.2024.0030"), JSON.stringify(nodes));
  } catch (e) {
    check("veritas-hybrid-scraper: threw", false, String(e));
  }

  // ── Retrieval hardener + lane roadmap ───────────────────────────────────
  suite = "retrieval-hardener";
  try {
    const query = "Find a cannabis product using existing technology for a large unmet demand";
    const h = hardenRetrievalQuery(query, "Diagnostic (T-Bar)");
    check("hardener: emits compact whole-token query", h.query.length > 5 && h.query.length < query.length, h.query);
    check("hardener: preserves cannabis domain anchor", /cannabis/i.test(h.query), h.query);
    check("hardener: emits alternatives", h.alternatives.length >= 1, `${h.alternatives.length} alternatives`);

    const good = {
      title: "Cannabis product market and cannabinoid delivery technology",
      url: "https://doi.org/10.1089/can.2024.0030",
      content: "Cannabis cannabinoid delivery technology addresses product safety and market demand. ".repeat(3),
    };
    const tea = {
      title: "Competitive Landscape of CHAGEE Tea Beverages",
      url: "https://example.com/tea",
      content: "Tea beverage market competition and store growth. ".repeat(3),
    };
    const fake = { title: "Cannabis claim", url: "source-1", content: "Cannabis market claim. ".repeat(5) };
    const css = { title: "CSS", url: "https://example.com/css", content: "table, caption, tbody {margin:0;padding:0;border:0;}".repeat(3) };
    const gated = filterRelevantSources([good, tea, fake, css], h.latticeQuery);
    check("hardener: keeps on-topic URL-backed source", gated.accepted.includes(good), `accepted=${gated.accepted.length}`);
    check("hardener: rejects CHAGEE tea drift", gated.rejected.some((r) => r.source === tea && r.reason === "facet-drift"), JSON.stringify(gated.rejected.map((r) => r.reason)));
    check("hardener: rejects source-N URL", gated.rejected.some((r) => r.source === fake && r.reason === "non-resolvable-url"), "placeholder URL rejected");
    check("hardener: rejects thin/CSS content", gated.rejected.some((r) => r.source === css), "boilerplate rejected");
    check("absoluteUrl: normalizes bare DOI", absoluteUrl({ doi: "10.1089/can.2024.0030" }) === "https://doi.org/10.1089/can.2024.0030", absoluteUrl({ doi: "10.1089/can.2024.0030" }));
    check("dedupeSources: dedupes by absolute URL", dedupeSources([good, { ...good }]).length === 1, "one retained");

    const full = buildLatticeQueries(query, ["BLUF", "Diagnostic (T-Bar)"], 2);
    registerRetrievalContext("test-run", query, full);
    const resolved = resolveRetrievalQueries("market size growth", "general");
    check("context: recovers full-prompt lattice from truncated/package query", !!resolved && resolved.original === query, resolved?.original ?? "none");
    check("context: selects section-relevant alternatives", !!resolved && resolved.queries.some((q) => /market size|TAM|SOM/i.test(q.q)), resolved?.queries.map((q) => q.q).join(" | ") ?? "none");
    const anyGate = filterRelevantSourcesAny([good, tea], resolved?.queries ?? [h.latticeQuery]);
    check("hardener-any: accepts against any coherent facet alternative", anyGate.accepted.includes(good), `accepted=${anyGate.accepted.length}`);
    check("hardener-any: still rejects drift across every alternative", anyGate.rejected.some((r) => r.source === tea), `rejected=${anyGate.rejected.length}`);
    clearRetrievalContext("test-run");

    check("roadmap: covers >=12 mechanisms", SCRAPER_LANE_ROADMAP.length >= 12, `${SCRAPER_LANE_ROADMAP.length} entries`);
    check("roadmap: every lane has file + falsification test", SCRAPER_LANE_ROADMAP.every((r) => r.workspaceFile && r.test), "all actionable");
    check("roadmap: all live @-imported terminal lanes hardened",
      ["vanguard", "palisade", "arbiter-omega", "sibyl", "strata", "nexus", "hydra", "native-vnext"].every((lane) =>
        SCRAPER_LANE_ROADMAP.some((r) => r.lane === lane && r.status !== "observability-only")
      ), "terminal lanes covered");
  } catch (e) {
    check("retrieval-hardener: threw", false, String(e));
  }

  // ── Unified v1+v2 genome + separated research planner ───────────────────
  suite = "unified-innovation-research";
  try {
    const prompt = "Find me a product that doesn't exist but solves a large unmet demand and can be made using existing technology in the cannabis space";
    const seedA = stableSeed(prompt, "product");
    const seedB = stableSeed(prompt, "product");
    check("unified: stable seed deterministic", seedA === seedB, `${seedA}`);
    const plan = buildUnifiedInnovationPlan(prompt, { seed: seedA, personaSeed: seedA });
    check("unified: v1 and v2 share one seed", plan.base.seed === plan.expansion.seed && plan.seed === seedA, `${plan.base.seed}/${plan.expansion.seed}`);
    check("unified: v2 labelled expansion pack", /V2 IS AN EXPANSION PACK/.test(plan.directive), "explicit contract");
    check("unified: path has full words", /Problem Choice|Anomaly Valuation|Evaluator Revision/.test(plan.expandedPath), plan.expandedPath);
    check("unified: prompt contains no arrow abbreviations", !/[PAENVTS]→[PAENVTS]/.test(plan.directive), "expanded only");
    check("unified: six exploration branches", plan.exploration.length === 6, `${plan.exploration.length}`);
    check("unified: every branch path expanded", plan.exploration.every((b) => /1\. /.test(b.expandedPath) && !b.expandedPath.includes("→")), "full words");
    check("unified: Williams persona shares seed", plan.williams.seed === seedA, `${plan.williams.seed}`);
    check("expandPath: maps canonical symbols", expandPath({ id: "x", name: "test", seq: "P→V→A" }).includes("Evaluator Revision"), expandPath({ id: "x", name: "test", seq: "P→V→A" }));

    const queries = buildDeterministicResearchQueries(prompt, plan);
    check("research: starts with pain points", queries[0]?.kind === "pain-point", queries[0]?.kind ?? "none");
    check("research: includes complaints + failed workarounds", queries.some((q) => q.kind === "complaint") && queries.some((q) => q.kind === "failed-workaround"), queries.map((q) => q.kind).join(","));
    check("research: every query passes no-quote invariant", queries.every((q) => queryIsDecomposed(prompt, q.query)), queries.map((q) => longestPromptQuote(prompt, q.query)).join(","));
    check("research: no query copies >3 prompt words", queries.every((q) => longestPromptQuote(prompt, q.query) <= 3), `max=${Math.max(...queries.map((q) => longestPromptQuote(prompt, q.query)))}`);
    check("research: path nodes use full words", queries.every((q) => !/^[PAENVTS]$/.test(q.pathNode)), queries.map((q) => q.pathNode).join(" | "));
    check("research: rejects raw prompt as query", !queryIsDecomposed(prompt, prompt), `quoteRun=${longestPromptQuote(prompt, prompt)}`);
  } catch (e) {
    check("unified-innovation-research: threw", false, String(e));
  }

  const passed = results.filter(r => r.passed).length;
  return {
    ranAt: Date.now(),
    results,
    passed,
    failed: results.length - passed,
    suites: [...new Set(results.map(r => r.suite))],
  };
}
