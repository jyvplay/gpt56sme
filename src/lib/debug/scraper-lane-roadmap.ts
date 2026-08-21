/**
 * scraper-lane-roadmap.ts — code-level repair and verification contract per lane.
 *
 * Each entry names the actual workspace seam that is live today. `test` is a
 * falsifiable predicate, not "inspect manually". Runtime tests require a real
 * browser/network run; pure gates are covered by self-test.ts.
 */
export interface LaneRoadmapEntry {
  lane: string;
  role: string;
  observedFailure: string;
  workspaceFile: string;
  intervention: string;
  test: string;
  status: "hardened" | "observability-only" | "transport-limited";
}

export const SCRAPER_LANE_ROADMAP: LaneRoadmapEntry[] = [
  {
    lane: "structured-adapter",
    role: "Academic/vertical API fan-out: Crossref, Semantic Scholar, arXiv, PubMed, Wikipedia, Internet Archive.",
    observedFailure: "One vague/truncated query returned CSS resets, genome protocols, civil-engineering and tea-market papers.",
    workspaceFile: "src/lib/scraper-vnext/structured-source-adapter.ts",
    intervention: "IFL fan-out over up to 3 whole-token facet queries; URL dedupe; accept only items coherent with at least one dispatched facet query.",
    test: "For cannabis prompt, every accepted item has an absolute URL, >=80 chars, and facetCoherence >=0.2 against at least one dispatched query; CSS reset fixture rejected.",
    status: "hardened",
  },
  {
    lane: "canonical-portfolio",
    role: "Bounded hedged orchestrator across terminal/sentinel/other retrieval lanes.",
    observedFailure: "Winner could report sources while ledger later contained off-topic or placeholder records.",
    workspaceFile: "src/lib/scraper-vnext/canonical-portfolio-orchestrator.ts",
    intervention: "Harden input query through IFL; filter winner sources by URL, content, quarantine and facet coherence; set ok=false if none survive.",
    test: "`portfolio.ok === true` implies `portfolio.sources.length >= 1` and every source passes filterRelevantSources.",
    status: "hardened",
  },
  {
    lane: "terminal-wire",
    role: "High-priority structured search + arbiter + crawl lane inside canonical portfolio.",
    observedFailure: "Often reports fulfilled/winner while downstream reads abort or final relevance is weak.",
    workspaceFile: "src/lib/scraper-vnext/canonical-portfolio-orchestrator.ts",
    intervention: "Cannot intercept terminal-wire's relative internal adapter directly; canonical-portfolio wrapper gates its final source set and forensics retains every failure.",
    test: "Terminal winner may remain fulfilled, but portfolio return cannot contain a source rejected by the workspace relevance gate.",
    status: "hardened",
  },
  {
    lane: "sentinel-orchestrator / sentinel-omega / vanguard-packer / omni-nexus",
    role: "Internal canonical-portfolio hedge lanes.",
    observedFailure: "Sparse/no direct source metadata; completion status alone is not evidence yield.",
    workspaceFile: "src/lib/scraper-vnext/canonical-portfolio-orchestrator.ts",
    intervention: "Final portfolio source gate; per-lane event retention in scraper-forensics. Internal relative calls are not individually interceptable.",
    test: "No internal lane completion can cause `portfolio.ok=true` unless at least one gated source survives.",
    status: "observability-only",
  },
  {
    lane: "vanguard",
    role: "Epistemic claim/atom packing.",
    observedFailure: "Repeatedly packed 2–19 atoms and 0 sources; package mapper then fabricated `source-N` URL fields.",
    workspaceFile: "src/lib/scraper-vnext/vanguard-titanium.ts",
    intervention: "Run for diagnostics/atoms but force `ok=false` so it can never terminate the grounding chain until the package exposes absolute source URLs.",
    test: "Workspace vanguard wrapper always returns `ok=false`; subsequent debug log shows palisade/arbiter fallthrough; no new ledger URL matches /^source-\\d+$/. ",
    status: "hardened",
  },
  {
    lane: "palisade",
    role: "Disposition/provenance adjudication over claims.",
    observedFailure: "Supported/attested claims are also converted to `source-N` by package grounding.",
    workspaceFile: "src/lib/scraper-palisade/palisade-adjudicator.ts",
    intervention: "Run adjudication but force `ok=false`, delegating to URL-bearing arbiter and later lanes.",
    test: "Workspace palisade wrapper always returns `ok=false`; no palisade claim enters citation ledger as `source-N`.",
    status: "hardened",
  },
  {
    lane: "arbiter-omega",
    role: "Frame-aware contradiction resolution over URL-bearing sources.",
    observedFailure: "Length-only source admission permitted topical drift.",
    workspaceFile: "src/lib/scraper-vnext/arbiter-omega.ts",
    intervention: "IFL query hardening + URL/content/quarantine/facet gate; ok=false when fewer than 2 survive.",
    test: "`arbiter.ok` implies >=2 surviving coherent URL-backed sources.",
    status: "hardened",
  },
  {
    lane: "sibyl",
    role: "Bayesian confidence + syndication/independence detection.",
    observedFailure: "Could delegate after weak evidence; returned items were only length-gated.",
    workspaceFile: "src/lib/scraper-vnext/sibyl-oracle.ts",
    intervention: "IFL query hardening + final source relevance gate; preserve upstream syndication logic.",
    test: "`sibyl.ok` implies >=2 surviving coherent URL-backed sources; otherwise delegation continues.",
    status: "hardened",
  },
  {
    lane: "strata",
    role: "Quorum attestation + transport-resolved reconstruction.",
    observedFailure: "Quorum could be computed over documents unrelated to the prompt.",
    workspaceFile: "src/lib/scraper-vnext/strata-engine.ts",
    intervention: "IFL query hardening + post-quorum facet gate; ok=false when fewer than 2 survive.",
    test: "`strata.ok` implies >=2 coherent URL-backed sources after quarantine.",
    status: "hardened",
  },
  {
    lane: "nexus",
    role: "Cross-source triangulation and consensus clustering.",
    observedFailure: "Logs showed 1 clean source; insufficient independence; downstream still continued through many failed transports.",
    workspaceFile: "src/lib/scraper-vnext/nexus-consensus.ts",
    intervention: "IFL query hardening + post-consensus facet gate; preserve clusters but prevent drift source return.",
    test: "`nexus.ok` implies >=2 coherent URL-backed sources; 1-source result remains false and delegates.",
    status: "hardened",
  },
  {
    lane: "hydra",
    role: "Text-density cascade and multi-transport reader.",
    observedFailure: "Direct/Jina/proxy/Wayback failures and circuit-open states dominated logs.",
    workspaceFile: "src/lib/scraper-vnext/hydra-reader.ts",
    intervention: "IFL query hardening + source relevance gate. Transport failures remain external constraints and are surfaced unchanged.",
    test: "A transport failure never becomes a source; `hydra.ok` implies >=2 coherent URL-backed sources. Circuit errors remain visible in forensics.",
    status: "transport-limited",
  },
  {
    lane: "native-vnext",
    role: "Browser retrieval, fusion/RRF, enrichment.",
    observedFailure: "Fused results included irrelevant sources and thin/failed enrichments.",
    workspaceFile: "src/lib/scraper-vnext/native-scraper-browser-vnext.ts",
    intervention: "IFL query hardening + post-fusion URL/content/facet gate. Keeps fusion metadata, removes drift results.",
    test: "Every returned result has resolvable URL, >=80 chars combined text, facetCoherence >=0.2, and no quarantine flag.",
    status: "hardened",
  },
  {
    lane: "omega reader",
    role: "Read/enrichment attempts for DOI and page content.",
    observedFailure: "Many ABORTED reads; malformed log URL included trailing colon.",
    workspaceFile: "src/lib/debug/scraper-forensics.ts",
    intervention: "Failure observability only; the reader is internal to package portfolio and not separately alias-imported by the live grounding file.",
    test: "Every ABORTED/read-failed event appears under lane failures and is never counted as a clean source.",
    status: "transport-limited",
  },
];
