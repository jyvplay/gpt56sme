/**
 * research-phase.ts — prewriting innovation research, separated from report writing.
 *
 * Sequence:
 *   user intent -> unified v1+v2 genome -> Williams-seeded query planner
 *   -> HELIOS retrieval -> immutable research dossier -> report writer
 *
 * Query invariant: no query may copy more than three consecutive words from
 * the user's original prompt. This forces genuine intent decomposition rather
 * than feeding the prose request back into a search engine.
 */
import { heliosGround } from "@/lib/debug/helios-ground";
import {
  buildUnifiedInnovationPlan,
  PATH_NODE_NAMES,
  type UnifiedInnovationPlan,
} from "@/lib/debug/unified-innovation";

export type ResearchQueryKind =
  | "pain-point"
  | "complaint"
  | "failed-workaround"
  | "adjacent-solution"
  | "technical-building-block"
  | "regulatory-constraint"
  | "market-evidence"
  | "falsification";

export interface ResearchQuery {
  id: string;
  kind: ResearchQueryKind;
  query: string;
  rationale: string;
  pathNode: string;
  source: "deterministic" | "llm";
}

export interface ResearchPhaseResult {
  version: "prewriting-research/1";
  startedAt: number;
  endedAt: number;
  question: string;
  innovation: UnifiedInnovationPlan;
  queries: ResearchQuery[];
  rejectedQueries: Array<{ query: string; reason: string }>;
  sources: Array<{ title: string; url: string; content: string }>;
  provider: string;
  evidenceBlock: string;
  dossier: string;
  debug: string[];
  status: "grounded" | "evidence-starved";
}

export interface ResearchPhaseOptions {
  question: string;
  personaSeed?: number;
  risk?: "low" | "medium" | "high" | "critical";
  /** Optional independent LLM planner. Deterministic queries always remain. */
  generateQueries?: (prompt: string) => Promise<{ ok: boolean; text: string; error?: string }>;
  onProgress?: (message: string) => void;
  maxQueries?: number;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? [];
}

/** Find the longest exact consecutive word run shared with the prompt. */
export function longestPromptQuote(prompt: string, query: string): number {
  const p = words(prompt), q = words(query);
  let best = 0;
  for (let i = 0; i < q.length; i++) {
    for (let j = 0; j < p.length; j++) {
      let n = 0;
      while (i + n < q.length && j + n < p.length && q[i + n] === p[j + n]) n++;
      if (n > best) best = n;
    }
  }
  return best;
}

export function queryIsDecomposed(prompt: string, query: string): boolean {
  const q = query.trim();
  return q.length >= 8 && q.length <= 180 && longestPromptQuote(prompt, q) <= 3;
}

function keyTerms(question: string, plan: UnifiedInnovationPlan): { domain: string; objects: string[] } {
  const stop = new Set(["find", "product", "doesn't", "exist", "large", "unmet", "demand", "made", "using", "existing", "technology", "space"]);
  const tokens = words(question).filter((w) => w.length > 3 && !stop.has(w));
  return { domain: plan.domain === "general" ? (tokens[0] ?? "industry") : plan.domain, objects: [...new Set(tokens)].slice(0, 4) };
}

/** Persona-seeded deterministic floor. These are investigation tasks, not paraphrases. */
export function buildDeterministicResearchQueries(
  question: string,
  plan: UnifiedInnovationPlan,
): ResearchQuery[] {
  const { domain, objects } = keyTerms(question, plan);
  const object = objects[0] ?? domain;
  const voice = plan.williams.archetype.name;
  const nodes = plan.expansion.path.seq.split(/\s*→\s*/);
  const node = (i: number) => PATH_NODE_NAMES[nodes[i % Math.max(1, nodes.length)]] ?? "Problem Choice";
  const rows: Array<[ResearchQueryKind, string, string]> = [
    ["pain-point", `${domain} user pain points recurring complaints unmet needs`, "Discover repeated user harm before proposing a product."],
    ["complaint", `${object} negative reviews failure frustration workaround forum`, "Find first-person evidence and current product failures."],
    ["failed-workaround", `${domain} failed solutions abandoned products limitations case study`, "Map near-misses and why prior approaches failed."],
    ["adjacent-solution", `${domain} adjacent industries analogous devices transferable mechanism`, "Search for proven mechanisms outside the obvious category."],
    ["technical-building-block", `${object} available components manufacturing feasibility sensor delivery platform`, "Verify that the required building blocks exist now."],
    ["regulatory-constraint", `${domain} regulation safety approval compliance adverse event`, "Expose constraints before ideation collapses onto an illegal or unsafe design."],
    ["market-evidence", `${domain} market segments adoption willingness pay underserved users evidence`, "Test whether the pain is sufficiently broad and economically meaningful."],
    ["falsification", `${object} contraindications failure modes false assumptions validation experiment`, "Construct the cheapest test that can kill a weak concept."],
  ];
  return rows.map(([kind, query, rationale], i) => ({
    id: `D${i + 1}`,
    kind,
    query,
    rationale: `${rationale} Persona lens: ${voice}.`,
    pathNode: node(i),
    source: "deterministic" as const,
  })).filter((q) => queryIsDecomposed(question, q.query));
}

function plannerPrompt(question: string, plan: UnifiedInnovationPlan, deterministic: ResearchQuery[]): string {
  return [
    "You are the independent SEARCH STRATEGIST. You do not write the report and do not propose the final product.",
    "Deconstruct intent into exact web-search strings that collect evidence before ideation.",
    "Return JSON only: {\"queries\":[{\"kind\":\"pain-point|complaint|failed-workaround|adjacent-solution|technical-building-block|regulatory-constraint|market-evidence|falsification\",\"query\":\"...\",\"rationale\":\"...\",\"pathNode\":\"full node name\"}]}",
    "HARD RULES:",
    "- 8 to 12 queries; 3 to 14 search terms each; no sentence-length queries.",
    "- No query may copy four consecutive words from the user's prompt.",
    "- Begin with pain points, complaints, failed workarounds and adjacent products; only then search mechanisms, feasibility, regulation and market evidence.",
    "- Never invent a company, statistic, URL, product or user quote.",
    "- Path nodes MUST use full names, never P/A/E/N/V/T/S abbreviations.",
    `WILLIAMS PERSONA: ${plan.williams.archetype.name}\n${plan.williams.systemPromptFragment}`,
    `UNIFIED INNOVATION PATH:\n${plan.expandedPath}`,
    `USER INPUT (for intent only; do not quote it in queries):\n${question}`,
    "DETERMINISTIC FLOOR ALREADY PRESENT (add orthogonal searches; do not paraphrase these):",
    ...deterministic.map((q) => `- ${q.kind}: ${q.query}`),
  ].join("\n");
}

function parseLlmQueries(raw: string, question: string): { accepted: ResearchQuery[]; rejected: Array<{ query: string; reason: string }> } {
  const accepted: ResearchQuery[] = [];
  const rejected: Array<{ query: string; reason: string }> = [];
  try {
    const clean = raw.replace(/```json/gi, "").replace(/```/g, "");
    const match = clean.match(/\{[\s\S]*\}/);
    const json = JSON.parse(match?.[0] ?? clean);
    const rows = Array.isArray(json?.queries) ? json.queries : [];
    const validKinds = new Set<ResearchQueryKind>([
      "pain-point", "complaint", "failed-workaround", "adjacent-solution",
      "technical-building-block", "regulatory-constraint", "market-evidence", "falsification",
    ]);
    for (const row of rows.slice(0, 16)) {
      const query = String(row?.query ?? "").trim();
      const kind = String(row?.kind ?? "") as ResearchQueryKind;
      if (!validKinds.has(kind)) { rejected.push({ query, reason: "invalid-kind" }); continue; }
      if (!queryIsDecomposed(question, query)) {
        rejected.push({ query, reason: `quote-or-length-rule (longest exact run ${longestPromptQuote(question, query)})` });
        continue;
      }
      accepted.push({
        id: `L${accepted.length + 1}`,
        kind,
        query,
        rationale: String(row?.rationale ?? "LLM-added orthogonal search"),
        pathNode: String(row?.pathNode ?? "Problem Choice"),
        source: "llm",
      });
    }
  } catch (e) {
    rejected.push({ query: raw.slice(0, 200), reason: `parse-error: ${e instanceof Error ? e.message : String(e)}` });
  }
  return { accepted, rejected };
}

function dedupeQueries(rows: ResearchQuery[]): ResearchQuery[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.query.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runPrewritingResearch(opts: ResearchPhaseOptions): Promise<ResearchPhaseResult> {
  const startedAt = Date.now();
  const debug: string[] = [];
  const say = (m: string) => { debug.push(m); opts.onProgress?.(m); };
  const innovation = buildUnifiedInnovationPlan(opts.question, {
    personaSeed: opts.personaSeed,
    risk: opts.risk,
  });
  const deterministic = buildDeterministicResearchQueries(opts.question, innovation);
  let llm: ResearchQuery[] = [];
  const rejectedQueries: Array<{ query: string; reason: string }> = [];

  if (opts.generateQueries) {
    try {
      say("research-query-planner: independent LLM decomposition started");
      const result = await opts.generateQueries(plannerPrompt(opts.question, innovation, deterministic));
      if (result.ok) {
        const parsed = parseLlmQueries(result.text, opts.question);
        llm = parsed.accepted;
        rejectedQueries.push(...parsed.rejected);
        say(`research-query-planner: accepted ${llm.length}, rejected ${parsed.rejected.length}`);
      } else {
        rejectedQueries.push({ query: "", reason: `planner-unavailable: ${result.error ?? "unknown"}` });
      }
    } catch (e) {
      rejectedQueries.push({ query: "", reason: `planner-threw: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const maxQueries = Math.max(4, Math.min(12, opts.maxQueries ?? 8));
  const queries = dedupeQueries([...deterministic, ...llm]).slice(0, maxQueries);
  say(`prewriting-research: ${queries.length} independent queries; path=${innovation.expansion.path.name}`);
  const ground = await heliosGround(opts.question, {
    queries: queries.map((q) => q.query),
    maxQueries,
    onDebug: say,
  });

  const dossier = [
    "## PREWRITING RESEARCH DOSSIER — immutable evidence handoff",
    "This phase is separate from report writing. It records searches and evidence; it does not claim the proposed idea is validated.",
    innovation.directive,
    "### RESEARCH QUERY REGISTER",
    ...queries.map((q) => `- ${q.id} [${q.kind}] [${q.pathNode}] ${q.query}\n  Rationale: ${q.rationale}`),
    "### RETRIEVED SOURCES",
    ...(ground.sources.length
      ? ground.sources.map((s, i) => `- [R${i + 1}] ${s.title}\n  URL: ${s.url}`)
      : ["- [EVIDENCE_STARVED] No URL-backed source survived retrieval and relevance gates."]),
    "### HANDOFF RULES",
    "- Report writer may use only URL-backed sources listed above.",
    "- Search hypotheses, persona angles and innovation branches are not facts.",
    "- Unsupported concepts remain proposals; missing evidence remains a data gap.",
  ].join("\n");

  const researchEvidenceBlock = ground.sources.length
    ? [
        `PREWRITING RESEARCH EVIDENCE (${ground.provider}, ${ground.sources.length} URL-backed sources).`,
        "R# identifiers are research-phase provenance and MUST NOT be rewritten as S# citations unless admitted by the report citation ledger.",
        "BEGIN PREWRITING RESEARCH CONTENT",
        ...ground.sources.map((s, i) => [`BEGIN RESEARCH SOURCE R${i + 1}`, `[R${i + 1}] ${s.title}`, `URL: ${s.url}`, s.content, `END RESEARCH SOURCE R${i + 1}`].join("\n")),
        "END PREWRITING RESEARCH CONTENT",
      ].join("\n\n")
    : "";

  return {
    version: "prewriting-research/1",
    startedAt,
    endedAt: Date.now(),
    question: opts.question,
    innovation,
    queries,
    rejectedQueries,
    sources: ground.sources,
    provider: ground.provider,
    evidenceBlock: researchEvidenceBlock,
    dossier,
    debug,
    status: ground.ok ? "grounded" : "evidence-starved",
  };
}
