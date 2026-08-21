/**
 * intent-lattice.ts — Intent Facet Lattice (IFL) query synthesis.
 *
 * PROBLEM (from the supplied scraper-forensics export):
 *   The dispatched queries were literally the raw, truncated user prompt —
 *   e.g. `"a product that doesn't exist but solves a large un"` — the SAME
 *   generic string reused across BLUF, Situation, and Diagnostic sections.
 *   Result: a cannabis + heart-rate + strategy prompt retrieved "Moldovan
 *   youth", "printed-circuit-board failures", and "CHAGEE tea market share".
 *   Two root causes, both durable to fix in the workspace without materialize:
 *     (a) TRUNCATION — `buildTemplateSearchQueries` slices the topic and the
 *         log shows an even shorter live query; and
 *     (b) NO INTENT DECOMPOSITION — one flat query cannot serve seven
 *         structurally different sections.
 *
 * WHY NOT the obvious things (negative space — why each fails the contract):
 *   1. Raw prompt as query → returns topical noise (the observed failure).
 *   2. Truncated prompt → drops the operative nouns; strictly worse.
 *   3. Single LLM decomposition call → the log shows 429/503; a model-only
 *      path has no floor and produced `gap analysis unavailable`.
 *   4. Self-Ask / sequential sub-questions → serial, latency-heavy, and each
 *      sub-question is still a sentence, not a search string.
 *   5. HyDE hypothetical-doc expansion → fabricates content the retriever
 *      then "confirms"; a citation-fabrication vector we must avoid.
 *   6. Keyword bag (all non-stopword tokens joined) → the package's existing
 *      `keywordize`; loses section specificity, still one query for all.
 *   7. Query per template section using the section TITLE as the query →
 *      returns definitions of "BLUF"/"T-Bar", not the topic. (Detectably
 *      wrong: facetCoherence≈0 against the domain facet.)
 *
 * THE METHOD — Intent Facet Lattice (original to this codebase; not Self-Ask,
 * not HyDE, not Plan×RAG, not sub-question decomposition):
 *   1. Deterministically extract FACETS along five orthogonal axes:
 *      domain · object · constraint · metric · temporal · entity
 *      Each facet is a short high-signal phrase, NOT a sentence, NEVER
 *      truncated below a whole token boundary.
 *   2. Each template section declares a FACET AFFINITY VECTOR — which axes
 *      matter for that section (e.g. Diagnostic → domain×metric×temporal;
 *      Options → domain×object×constraint).
 *   3. For each section, take the CROSS-PRODUCT of its affine facets and emit
 *      the top-k coherent combinations as queries. A query therefore reads
 *      like `cannabis vaporizer market size 2024` — several operative facets
 *      joined — instead of a truncated prompt slice.
 *   4. Every query carries its facet provenance, enabling downstream
 *      `facetCoherence(result, query)`: a retrieved doc that shares none of
 *      the query's facet tokens is drift (the "CHAGEE tea" case) and is
 *      down-weighted.
 *
 * Determinism: same prompt ⇒ same lattice, always. No network, no model. An
 * optional LLM enrichment layer may ADD facets but can never remove the
 * deterministic floor — if it 429/503s, the lattice still stands.
 */
export type FacetAxis = "domain" | "object" | "constraint" | "metric" | "temporal" | "entity";

export interface Facet {
  axis: FacetAxis;
  phrase: string;
  /** Deterministic salience 0..1 (token rarity × axis weight). */
  weight: number;
}

export interface LatticeQuery {
  q: string;
  section: string;
  facets: Facet[];
  axes: FacetAxis[];
}

export interface IntentLattice {
  original: string;
  facets: Facet[];
  byAxis: Record<FacetAxis, Facet[]>;
  queries: LatticeQuery[];
  llmEnriched: boolean;
}

// ─── Lexicons (deterministic facet extraction) ─────────────────────────────
const DOMAIN_LEX: Record<string, string[]> = {
  cannabis: ["cannabis", "marijuana", "cbd", "thc", "hemp", "weed", "dispensary", "vaporizer", "vape", "edible", "cannabinoid", "terpene"],
  medical: ["medical", "health", "clinical", "patient", "therapy", "disease", "nerve", "heart rate", "blood pressure", "dose", "dosage", "tachycardia"],
  technology: ["technology", "sensor", "device", "hardware", "software", "iot", "wearable", "biofeedback", "micro-needle", "transdermal", "ppg", "photoplethysmography"],
  finance: ["market", "revenue", "npv", "irr", "tam", "sam", "som", "valuation", "margin", "cagr", "investment", "pricing"],
  legal: ["regulation", "compliance", "fda", "schedule i", "legal", "statute", "approval", "510(k)"],
  manufacturing: ["manufacturing", "production", "assembly", "supply chain", "tooling", "extraction", "co2 extraction"],
};

const CONSTRAINT_PATTERNS: Array<{ re: RegExp; phrase: string }> = [
  { re: /\b(existing|current|available)\s+(technolog|tech|infrastructure)/i, phrase: "existing technology feasibility" },
  { re: /\b(unmet|underserved)\s+(demand|need|market)/i, phrase: "unmet demand market gap" },
  { re: /\b(doesn'?t exist|not exist|novel|new|first-of-its-kind)\b/i, phrase: "novel product whitespace" },
  { re: /\b(large|big|major|significant|multi-?billion)\b/i, phrase: "large addressable market" },
  { re: /\b(safe|safety|risk|adverse|side effect)\b/i, phrase: "safety risk profile" },
  { re: /\b(scal(e|able)|mass production)\b/i, phrase: "scalability" },
];

const METRIC_PATTERNS: Array<{ re: RegExp; phrase: string }> = [
  { re: /\b(market size|tam|sam|som|addressable market)\b/i, phrase: "market size TAM SAM SOM" },
  { re: /\b(growth|cagr|projection|forecast)\b/i, phrase: "growth rate forecast" },
  { re: /\b(npv|irr|roi|payback|valuation)\b/i, phrase: "NPV IRR valuation" },
  { re: /\b(share|competitive|competitor)\b/i, phrase: "competitive market share" },
  { re: /\b(heart rate|blood pressure|hr|bp|physiolog)\b/i, phrase: "physiological measurement" },
];

const TEMPORAL_PATTERNS: Array<{ re: RegExp; phrase: string }> = [
  { re: /\b(20\d\d)\b/, phrase: "$1" },
  { re: /\b(latest|recent|current|today|now|emerging)\b/i, phrase: "2024 2025 latest" },
  { re: /\b(trend|projection|forecast|future)\b/i, phrase: "trends forecast" },
];

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "be", "can",
  "that", "this", "with", "using", "made", "solve", "solves", "find", "me", "large", "but",
  "please", "help", "product", "doesn't", "exist", "demand", "unmet", "space", "existing",
]);

const NOISE_LEX = ["moldovan", "youth", "printed circuit board", "chagee", "tea", "ellipsis", "civil engineering", "automotive seals", "nanopore", "genome assembly"];

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(t => t.length > 2 && !STOP.has(t));
}

/** Deterministically extract the full facet set — NO truncation of the input. */
export function extractFacets(question: string): Facet[] {
  const facets: Facet[] = [];
  const seen = new Set<string>();
  const push = (axis: FacetAxis, phrase: string, weight: number) => {
    const key = `${axis}:${phrase.toLowerCase()}`;
    if (!phrase.trim() || seen.has(key)) return;
    seen.add(key);
    facets.push({ axis, phrase: phrase.trim(), weight: Math.max(0, Math.min(1, weight)) });
  };

  // domain
  for (const [domain, lex] of Object.entries(DOMAIN_LEX)) {
    const hits = lex.filter(k => question.toLowerCase().includes(k));
    if (hits.length) {
      push("domain", domain, 0.9);
      for (const h of hits.slice(0, 3)) push("object", h, 0.75); // concrete objects mentioned
    }
  }

  // entity (proper nouns / acronyms) — full token, never sliced
  for (const e of question.match(/\b([A-Z][a-zA-Z0-9-]+(?:\s+[A-Z][a-zA-Z0-9-]+){0,2}|[A-Z]{2,})\b/g) ?? []) {
    if (e.length >= 2 && !/^(Find|Please|Help)$/i.test(e)) push("entity", e, 0.6);
  }

  for (const { re, phrase } of CONSTRAINT_PATTERNS) if (re.test(question)) push("constraint", phrase, 0.7);
  for (const { re, phrase } of METRIC_PATTERNS) if (re.test(question)) push("metric", phrase, 0.8);
  for (const { re, phrase } of TEMPORAL_PATTERNS) {
    const m = re.exec(question);
    if (m) push("temporal", phrase.replace("$1", m[1] ?? ""), 0.55);
  }

  // Residual high-signal nouns as objects (token rarity weight), never truncated.
  const toks = tokenize(question);
  const freq = new Map<string, number>();
  for (const t of toks) freq.set(t, (freq.get(t) ?? 0) + 1);
  const rare = [...freq.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
  for (const t of rare.slice(0, 6)) push("object", t, 0.5);

  return facets;
}

// ─── Section facet-affinity vectors ────────────────────────────────────────
// Which axes each OMEGA-STRATEGY section actually needs to search for.
const SECTION_AFFINITY: Record<string, FacetAxis[]> = {
  "BLUF": ["domain", "object", "metric"],
  "Situation (SCQA)": ["domain", "object", "constraint"],
  "Diagnostic (T-Bar)": ["domain", "metric", "temporal"],
  "Options Tournament": ["domain", "object", "constraint"],
  "Recommendation & Value Bridge": ["domain", "metric", "object"],
  "Implementation (Wave Architecture)": ["domain", "object", "constraint"],
  "Risk Register & Assumption Ledger": ["domain", "constraint", "metric"],
  "Appendix (T-Body)": ["domain", "metric", "temporal"],
  // Generic fallback for non-OMEGA-STRATEGY templates / HDIG / adv-repair.
  "general": ["domain", "object", "metric"],
};

/** Search-role facets guarantee each query contains more than the domain. */
const SECTION_ROLE_FACETS: Record<string, Facet[]> = {
  "BLUF": [{ axis: "metric", phrase: "market opportunity product innovation", weight: 0.8 }],
  "Situation (SCQA)": [{ axis: "constraint", phrase: "current unmet need user pain", weight: 0.8 }],
  "Diagnostic (T-Bar)": [
    { axis: "metric", phrase: "market size TAM SAM SOM", weight: 0.9 },
    { axis: "temporal", phrase: "2024 2025", weight: 0.6 },
  ],
  "Options Tournament": [{ axis: "constraint", phrase: "alternatives comparison tradeoffs", weight: 0.8 }],
  "Recommendation & Value Bridge": [{ axis: "metric", phrase: "business model revenue NPV IRR", weight: 0.8 }],
  "Implementation (Wave Architecture)": [{ axis: "constraint", phrase: "implementation milestones regulatory pathway", weight: 0.8 }],
  "Risk Register & Assumption Ledger": [{ axis: "constraint", phrase: "safety regulatory technical risks", weight: 0.8 }],
  "Appendix (T-Body)": [{ axis: "metric", phrase: "research evidence methodology data", weight: 0.8 }],
  "general": [{ axis: "constraint", phrase: "research evidence application", weight: 0.65 }],
};

function facetsByAxis(facets: Facet[]): Record<FacetAxis, Facet[]> {
  const out = { domain: [], object: [], constraint: [], metric: [], temporal: [], entity: [] } as Record<FacetAxis, Facet[]>;
  for (const f of facets) out[f.axis].push(f);
  for (const axis of Object.keys(out) as FacetAxis[]) out[axis].sort((a, b) => b.weight - a.weight);
  return out;
}

/**
 * Cross-product synthesis: for a section, take its affine axes and join one
 * high-salience facet from each into a compact, high-signal query. Emits up to
 * `perSection` distinct queries by rotating the object/metric facets.
 */
function buildFromFacets(question: string, facets: Facet[], sections: string[], perSection: number): IntentLattice {
  const byAxis = facetsByAxis(facets);
  const domain = byAxis.domain[0]?.phrase ?? byAxis.object[0]?.phrase ?? "";
  const queries: LatticeQuery[] = [];

  for (const section of sections) {
    const axes = SECTION_AFFINITY[section] ?? SECTION_AFFINITY.general;
    // Rotate the most-variable axis (object, else metric) to make each query distinct.
    const rotAxis: FacetAxis = byAxis.object.length >= byAxis.metric.length ? "object" : "metric";
    const rawRotPool = byAxis[rotAxis].length ? byAxis[rotAxis] : byAxis.object.length ? byAxis.object : byAxis.domain;
    // Do not rotate an object identical to the domain — that produced the
    // one-token query `cannabis` in prior runs.
    const rotPool = rawRotPool.filter((f) => f.phrase.toLowerCase() !== domain.toLowerCase());
    const roles = SECTION_ROLE_FACETS[section] ?? SECTION_ROLE_FACETS.general;

    for (let i = 0; i < Math.max(1, perSection); i++) {
      const parts: Facet[] = [];
      for (const axis of axes) {
        const pool = axis === rotAxis ? rotPool : byAxis[axis];
        const pick = pool.length ? pool[(axis === rotAxis ? i : 0) % pool.length] : undefined;
        if (pick && !parts.some(p => p.phrase === pick.phrase)) parts.push(pick);
      }
      // Always anchor on the domain so a section can never drift off-topic.
      if (domain && !parts.some(p => p.phrase === domain)) parts.unshift({ axis: "domain", phrase: domain, weight: 0.9 });
      // Fill absent axes from the section role. This prevents domain-only
      // queries while preserving all extracted prompt facets.
      for (const role of roles) {
        if (!parts.some((p) => p.axis === role.axis)) parts.push(role);
      }

      const q = parts.map(p => p.phrase).join(" ").replace(/\s+/g, " ").trim();
      if (q && q.length >= 6 && !queries.some(x => x.section === section && x.q === q)) {
        queries.push({ q, section, facets: parts, axes });
      }
    }
  }

  return { original: question, facets, byAxis, queries, llmEnriched: false };
}

export function buildLatticeQueries(question: string, sections: string[], perSection = 2): IntentLattice {
  return buildFromFacets(question, extractFacets(question), sections, perSection);
}

/**
 * Facet coherence of a retrieved result against a query: fraction of the
 * query's facet tokens that appear in the result's title+snippet. Used to
 * down-rank cross-facet drift (the "CHAGEE tea" result for a cannabis query).
 * Pure, exported for self-test.
 */
export function facetCoherence(query: LatticeQuery, resultText: string): number {
  const hay = resultText.toLowerCase();
  const toks = Array.from(new Set(query.facets.flatMap(f => tokenize(f.phrase))));
  if (toks.length === 0) return 1;
  const hits = toks.filter(t => hay.includes(t)).length;
  return Math.round((hits / toks.length) * 100) / 100;
}

/** Detect the obviously-off-topic noise results the logs were full of. Pure. */
export function isLikelyDriftResult(resultText: string, query: LatticeQuery): boolean {
  const hay = resultText.toLowerCase();
  if (NOISE_LEX.some(n => hay.includes(n))) return facetCoherence(query, resultText) < 0.34;
  return facetCoherence(query, resultText) < 0.2;
}

/**
 * Render the lattice as an untruncated, model-readable directive block. This
 * is what gets appended to the question envelope so the package's
 * relative-path grounding receives decomposed, per-section intents instead of
 * a single raw prompt. NOTHING here is truncated.
 */
export function renderLatticeDirective(lattice: IntentLattice): string {
  const lines: string[] = [
    "## RETRIEVAL INTENT LATTICE (deterministic facet decomposition — search these, not the raw prompt)",
    `Facets: ${lattice.facets.map(f => `${f.axis}:${f.phrase}`).join(" · ")}`,
    "Per-section high-signal queries (each is a keyword query, already decomposed and NOT truncated):",
  ];
  const bySection = new Map<string, string[]>();
  for (const q of lattice.queries) {
    const arr = bySection.get(q.section) ?? [];
    arr.push(q.q);
    bySection.set(q.section, arr);
  }
  for (const [section, qs] of bySection) {
    lines.push(`- ${section}: ${qs.map(q => `"${q}"`).join(" | ")}`);
  }
  lines.push("When grounding a section, dispatch that section's queries verbatim; do not fall back to the raw user prompt as a search string.");
  return lines.join("\n");
}

/**
 * Optional LLM enrichment — ADDS facets only, never removes the deterministic
 * floor. Fails safe: on any error/429/503 the input lattice is returned
 * unchanged. Caller supplies the generate function to avoid a hard dependency.
 */
export async function enrichLatticeWithLlm(
  lattice: IntentLattice,
  generate: (prompt: string) => Promise<{ ok: boolean; text: string; error?: string }>,
): Promise<{ lattice: IntentLattice; ok: boolean; error?: string }> {
  const prompt = [
    "Extract additional high-signal SEARCH FACETS for web retrieval from the user prompt below.",
    "Return ONLY a JSON array of {axis, phrase} where axis ∈ [domain,object,constraint,metric,temporal,entity].",
    "Each phrase must be a short keyword phrase (2-6 words), NOT a sentence, NOT the raw prompt.",
    "Do NOT invent facts, products, numbers, or URLs — only reformulate what is present.",
    "",
    `USER PROMPT (full, untruncated):\n${lattice.original}`,
    "",
    `Facets already found deterministically (do not repeat): ${lattice.facets.map(f => `${f.axis}:${f.phrase}`).join(", ")}`,
  ].join("\n");

  try {
    const res = await generate(prompt);
    if (!res.ok) return { lattice, ok: false, error: res.error };
    const m = res.text.replace(/```json/gi, "").replace(/```/g, "").match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : res.text) as Array<{ axis?: string; phrase?: string }>;
    if (!Array.isArray(arr)) return { lattice, ok: false, error: "non-array" };

    const validAxes = new Set<FacetAxis>(["domain", "object", "constraint", "metric", "temporal", "entity"]);
    const added: Facet[] = [];
    for (const a of arr.slice(0, 12)) {
      const axis = String(a.axis ?? "").toLowerCase() as FacetAxis;
      const phrase = String(a.phrase ?? "").trim();
      if (validAxes.has(axis) && phrase && phrase.length >= 2 && phrase.length <= 60) {
        added.push({ axis, phrase, weight: 0.65 });
      }
    }
    if (added.length === 0) return { lattice, ok: true };

    const merged = [...lattice.facets];
    const seen = new Set(lattice.facets.map(f => `${f.axis}:${f.phrase.toLowerCase()}`));
    for (const f of added) {
      const k = `${f.axis}:${f.phrase.toLowerCase()}`;
      if (!seen.has(k)) { seen.add(k); merged.push(f); }
    }

    // Rebuild queries with the enriched facet set, keeping the same sections.
    const sections = Array.from(new Set(lattice.queries.map(q => q.section)));
    const rebuilt = buildFromFacets(lattice.original, merged, sections.length ? sections : ["general"], 2);
    return { lattice: { ...rebuilt, llmEnriched: true }, ok: true };
  } catch (e) {
    return { lattice, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
