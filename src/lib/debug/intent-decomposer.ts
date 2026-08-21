/**
 * intent-decomposer.ts — NET-NEW (Type C). See flatten-guide.md.
 * ===========================================================================
 * DETERMINISTIC INTENT DECOMPOSITION FOR SEARCH QUERIES.
 *
 * OBSERVED DEFECT (from user turn-7 logs):
 *   Template-directed grounding dispatches the same raw user question to every
 *   section: "a product that doesn't exist but solves a large unmet demand and
 *   can be made using existing technology in the cannabis space." The retrieval
 *   fleet then returns CSS resets, genome protocols, tea market reports, and
 *   printed-circuit-board analysis because the query is too vague for academic
 *   and patent databases.
 *
 * APPROACH (novel, deterministic, no model call, no rate budget):
 *   Faceted Intent Cascade (FIC). Instead of sending one opaque question to N
 *   section-queries that are all identical, we:
 *     1. Extract DOMAIN ANCHORS from the question — noun phrases that name a
 *        real-world domain (cannabis, technology, market, product design).
 *     2. Extract INTENT VERBS — action primitives (find, create, solve, build,
 *        assess, compare, quantify, recommend, validate).
 *     3. Cross-product domain anchors × intent verbs against template SECTION
 *        ROLES to produce faceted queries that are section-appropriate:
 *          - BLUF section → "cannabis product innovation market opportunity"
 *          - Diagnostic → "cannabis market TAM SAM SOM size 2024 2025"
 *          - Options → "cannabis product delivery methods comparison"
 *     4. Append a RELEVANCE GUARD suffix to each query so the structured
 *        adapter's academic-database dispatch (crossref, semantic-scholar) hits
 *        the domain, not a homophone or abbreviation collision.
 *
 * WHY THIS IS NOT KEYWORD STUFFING:
 *   The queries are structurally distinct per section — a Diagnostic query asks
 *   for market sizing, an Options query asks for competitive alternatives. The
 *   current system sends the same string to all sections and gets 0 relevant
 *   sources from 14 template-directed queries. Any per-section specialization
 *   is strictly superior.
 *
 * This module is PURE — no network, no model, no import of the package's
 * query-strategist. It returns an enrichment object that the v15-pipeline
 * wrapper prepends to opts.question so the package's own
 * `buildTemplateSearchQueries` sees better raw material.
 * ===========================================================================
 */

export interface IntentFacet {
  /** Template section this facet targets. */
  section: string;
  /** The enriched query — domain-anchored, section-scoped. */
  query: string;
  /** Which domain anchors were used. */
  anchors: string[];
  /** Which intent verb was used. */
  intent: string;
}

export interface DecompositionResult {
  /** Original user question, untouched. */
  original: string;
  /** Domain anchors extracted from the question. */
  domainAnchors: string[];
  /** Intent verbs extracted. */
  intents: string[];
  /** Per-section faceted queries. */
  facets: IntentFacet[];
  /**
   * A block of text to PREPEND to the question so the package's own
   * `buildTemplateSearchQueries` sees section-scoped keywords.
   * Format: one line per section, each a search-ready phrase.
   */
  searchHintBlock: string;
}

// ── Domain anchor extraction ───────────────────────────────────────────────
// These are kept domain-general. Cannabis-specific terms are added dynamically
// when a domain match fires.

const DOMAIN_LEXICONS: Record<string, string[]> = {
  cannabis: [
    "cannabis", "marijuana", "hemp", "CBD", "THC", "cannabinoid",
    "terpene", "vaporizer", "edible", "dispensary", "cultivar",
    "extraction", "concentrate", "tincture", "topical",
  ],
  technology: [
    "technology", "existing technology", "hardware", "software", "sensor",
    "IoT", "Industry 4.0", "automation", "AI", "machine learning",
    "wearable", "biometric", "biosensor", "platform",
  ],
  market: [
    "market", "demand", "unmet demand", "TAM", "SAM", "SOM",
    "market size", "growth rate", "CAGR", "market share",
    "competitive landscape", "consumer segment",
  ],
  product: [
    "product", "product design", "product development", "innovation",
    "prototype", "formulation", "delivery system", "dosage form",
  ],
  finance: [
    "NPV", "IRR", "revenue", "margin", "valuation", "investment",
    "funding", "seed round", "Series A", "exit multiple",
  ],
  regulation: [
    "regulation", "FDA", "Schedule I", "Schedule II", "compliance",
    "510(k)", "GMP", "COA", "state license", "federal law",
  ],
};

function extractAnchors(question: string): string[] {
  const q = question.toLowerCase();
  const found: string[] = [];
  for (const [domain, terms] of Object.entries(DOMAIN_LEXICONS)) {
    for (const term of terms) {
      if (q.includes(term.toLowerCase())) {
        if (!found.includes(domain)) found.push(domain);
        break;
      }
    }
  }
  // Always include the literal content nouns from the question.
  const contentNouns = question
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .filter((w) => !/^(that|this|with|from|have|what|your|will|into|using|made|find|doesn|doesnt|exist|large|there|been|some|also|very|just|more|most|than|them|then|about|would|could|should|which|their|these|those|other|each|every|does|dont|wont|cant)$/i.test(w));
  return [...new Set([...found, ...contentNouns.slice(0, 6)])];
}

// ── Intent verb extraction ─────────────────────────────────────────────────

const INTENT_MAP: Record<string, string[]> = {
  discover: ["find", "discover", "identify", "uncover", "explore"],
  create: ["create", "build", "develop", "design", "invent", "make"],
  solve: ["solve", "address", "fix", "remedy", "mitigate"],
  assess: ["assess", "evaluate", "analyze", "measure", "quantify"],
  compare: ["compare", "contrast", "benchmark", "rank"],
  recommend: ["recommend", "suggest", "propose", "advise"],
  validate: ["validate", "verify", "confirm", "test", "prove"],
};

function extractIntents(question: string): string[] {
  const q = question.toLowerCase();
  const found: string[] = [];
  for (const [intent, verbs] of Object.entries(INTENT_MAP)) {
    for (const v of verbs) {
      if (q.includes(v)) {
        if (!found.includes(intent)) found.push(intent);
        break;
      }
    }
  }
  return found.length > 0 ? found : ["discover"]; // default
}

// ── Section-role mapping ───────────────────────────────────────────────────
// Maps OMEGA-STRATEGY section names to the KIND of information they need.

const SECTION_SEARCH_ROLES: Record<string, {
  role: string;
  queryTemplate: (anchors: string[], intent: string) => string;
}> = {
  BLUF: {
    role: "executive summary, recommendation, decision trigger",
    queryTemplate: (a, _i) =>
      `${a.join(" ")} market opportunity innovation overview`,
  },
  "Situation (SCQA)": {
    role: "baseline state, complication, current landscape",
    queryTemplate: (a, _i) =>
      `${a.join(" ")} current state challenges problems landscape ${new Date().getFullYear()}`,
  },
  "Diagnostic (T-Bar)": {
    role: "market sizing TAM SAM SOM, competitive position, root cause",
    queryTemplate: (a, _i) =>
      `${a.join(" ")} market size TAM SAM SOM growth rate ${new Date().getFullYear()} ${new Date().getFullYear() - 1}`,
  },
  "Options Tournament": {
    role: "alternative approaches, competing solutions, trade-offs",
    queryTemplate: (a, _i) =>
      `${a.join(" ")} product alternatives delivery methods comparison advantages disadvantages`,
  },
  "Recommendation & Value Bridge": {
    role: "implementation path, value creation, financial metrics",
    queryTemplate: (a, _i) =>
      `${a.join(" ")} business model revenue NPV IRR investment strategy`,
  },
  "Implementation (Wave Architecture)": {
    role: "execution timeline, milestones, resource requirements",
    queryTemplate: (a, _i) =>
      `${a.join(" ")} implementation timeline phases milestones regulatory pathway`,
  },
  "Risk Register & Assumption Ledger": {
    role: "risk factors, regulatory hurdles, assumptions to validate",
    queryTemplate: (a, _i) =>
      `${a.join(" ")} risks regulatory compliance safety challenges`,
  },
  "Appendix (T-Body)": {
    role: "data exhibits, methodology, supporting evidence",
    queryTemplate: (a, _i) =>
      `${a.join(" ")} research data methodology studies evidence`,
  },
};

// ── Main decomposition ─────────────────────────────────────────────────────

export function decomposeIntent(question: string, _templateId = "OMEGA-STRATEGY"): DecompositionResult {
  const domainAnchors = extractAnchors(question);
  const intents = extractIntents(question);
  const primaryIntent = intents[0];

  // Build domain-specific anchor terms from matched lexicons.
  const domainTerms: string[] = [];
  for (const anchor of domainAnchors) {
    const lexicon = DOMAIN_LEXICONS[anchor];
    if (lexicon) {
      // Take the first 3 terms from matched domains for query enrichment.
      domainTerms.push(...lexicon.slice(0, 3));
    }
  }
  // Dedupe and cap to avoid query bloat.
  const enrichedAnchors = [...new Set([...domainAnchors, ...domainTerms])].slice(0, 10);

  const facets: IntentFacet[] = [];
  for (const [section, role] of Object.entries(SECTION_SEARCH_ROLES)) {
    const query = role.queryTemplate(enrichedAnchors, primaryIntent);
    facets.push({
      section,
      query: query.slice(0, 200), // search APIs have length limits
      anchors: enrichedAnchors,
      intent: primaryIntent,
    });
  }

  // Build the hint block that will be prepended to the question.
  // The package's `buildTemplateSearchQueries` uses the question text to
  // generate per-section queries. By prepending these specialized terms,
  // the generated queries become domain-specific rather than generic.
  const searchHintBlock = [
    "## SEARCH INTENT DECOMPOSITION (for template-directed grounding)",
    `Domain anchors: ${enrichedAnchors.join(", ")}`,
    `Primary intent: ${primaryIntent}`,
    "",
    ...facets.map((f) => `[${f.section}] → ${f.query}`),
    "",
  ].join("\n");

  return {
    original: question,
    domainAnchors: enrichedAnchors,
    intents,
    facets,
    searchHintBlock,
  };
}

/**
 * Build a RELEVANCE GUARD suffix for a search query.
 * Appended to every dispatched query so the structured adapter's academic
 * databases (crossref, semantic-scholar, pubmed) scope to the right domain
 * instead of returning homophone/abbreviation collisions.
 *
 * Example: for a cannabis question, the guard might be "cannabis cannabinoid
 * hemp" — so a search for "market size" doesn't return tea market studies.
 */
export function buildRelevanceGuard(question: string): string {
  const q = question.toLowerCase();
  const guards: string[] = [];

  // Domain-specific guards — only fire when the domain is detected.
  if (/cannabis|marijuana|hemp|thc|cbd|cannabinoid|terpene|dispensary/i.test(q)) {
    guards.push("cannabis", "cannabinoid");
  }
  if (/pharma|drug|clinical trial|fda|nih|medical device/i.test(q)) {
    guards.push("pharmaceutical", "clinical");
  }
  if (/fintech|blockchain|cryptocurrency|defi/i.test(q)) {
    guards.push("fintech", "digital assets");
  }
  if (/biotech|genomics|crispr|gene therapy/i.test(q)) {
    guards.push("biotechnology", "genomics");
  }

  return guards.length > 0 ? guards.join(" ") : "";
}
