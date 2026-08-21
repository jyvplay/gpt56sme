/**
 * citation-ledger-store.ts — LIVE, workspace-durable citation provenance store
 * ============================================================================
 * WHY THIS EXISTS
 * The package already ships two ledger implementations:
 *   - `citation-ledger.ts`          (stochastic LLM-entailment audit)
 *   - `deterministic-citation-ledger.ts` (set-membership audit; honest)
 * Neither is a *live, observable* store: they are built and discarded inside a
 * single pipeline call, so no UI surface can subscribe to them.
 *
 * This module adds the missing seam ONLY — a tiny synchronous pub/sub registry
 * that records every source the grounding fleet actually fetched, together with
 * the pipeline stage at which it was FIRST admitted into the draft. It performs
 * no network calls, no LLM calls, and invents nothing: every record originates
 * from a real `groundQuestion` return value.
 *
 * Determinism: `[S#]` ids are assigned in first-seen order over the canonical
 * URL, identical to `deterministic-citation-ledger.buildDeterministicLedger`,
 * so tags emitted here resolve to the same sources the pipeline cited.
 * ============================================================================ */

export type CitationStage =
  | "initial"
  | "grounding"
  | "hdig"
  | "cove"
  | "n-deep"
  | "adversarial"
  | "synthesis";

export interface LiveCitationRecord {
  /** Sequential 1-based id — renders as `[S{id}]`. */
  id: number;
  /** Page title as returned by the fetching lane. */
  title: string;
  /** Canonicalised absolute URL. */
  url: string;
  /** Hostname without `www.` — the "scraped site" column. */
  site: string;
  /** Verbatim leading text the model was shown (truncated, never rewritten). */
  snippet: string;
  /** Deterministic FNV-1a fingerprint of url + title + snippet head. */
  fingerprint: string;
  /** Originating scraper lane (provenance). */
  lane: string;
  /** Pipeline stage at which this source was FIRST integrated into the draft. */
  stage: CitationStage;
  /** Epoch ms of first admission. */
  firstSeenAt: number;
}

export interface CitationLedgerSnapshotLive {
  records: LiveCitationRecord[];
  /** Distinct hostnames represented. */
  siteCount: number;
  /** Question that produced the most recent ingest, if supplied. */
  lastQuestion: string;
  /** Epoch ms of the most recent ingest. */
  updatedAt: number;
}

type Listener = (snapshot: CitationLedgerSnapshotLive) => void;

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    return u.toString();
  } catch {
    return (url || "").trim();
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "(local)";
  }
}

const byUrl = new Map<string, LiveCitationRecord>();
const listeners = new Set<Listener>();
let lastQuestion = "";
let updatedAt = 0;

function snapshot(): CitationLedgerSnapshotLive {
  const records = Array.from(byUrl.values()).sort((a, b) => a.id - b.id);
  return {
    records,
    siteCount: new Set(records.map((r) => r.site)).size,
    lastQuestion,
    updatedAt,
  };
}

function emit(): void {
  const snap = snapshot();
  for (const listener of listeners) {
    try {
      listener(snap);
    } catch {
      /* a failing subscriber must never break ingestion */
    }
  }
}

/** Subscribe to ledger changes. Fires immediately with the current snapshot. */
export function subscribeCitationLedger(listener: Listener): () => void {
  listeners.add(listener);
  try {
    listener(snapshot());
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Current snapshot without subscribing. */
export function getCitationLedgerSnapshot(): CitationLedgerSnapshotLive {
  return snapshot();
}

/**
 * Record sources that were ACTUALLY fetched. Idempotent per canonical URL:
 * re-ingesting a known URL never renumbers it and never overwrites the stage
 * at which it first entered the draft (that is the auditable fact).
 */
export function recordCitationSources(
  sources: Array<{ title?: string; url?: string; content?: string; lane?: string }>,
  options: { stage?: CitationStage; lane?: string; question?: string } = {},
): LiveCitationRecord[] {
  const stage = options.stage ?? "grounding";
  const added: LiveCitationRecord[] = [];

  for (const source of sources) {
    const url = canonicalUrl(source.url || "");
    if (!url) continue;

    const existing = byUrl.get(url);
    if (existing) {
      // STAGE REFINEMENT (single, narrow rule).
      // `grounding` means "fetched by a lane, not yet known to be admitted to
      // the draft". Any non-`grounding` stage comes from the pipeline's own
      // CitationLedger, which stamps the stage at FIRST draft admission — a
      // strictly more precise fact. Upgrade once, never downgrade, never
      // renumber. Everything else about the record is left untouched.
      if (existing.stage === "grounding" && stage !== "grounding") {
        existing.stage = stage;
        updatedAt = Date.now();
        emit();
      }
      continue;
    }

    const title = (source.title || "Untitled").trim().slice(0, 250);
    const snippet = (source.content || "").replace(/\s+/g, " ").trim().slice(0, 600);
    const record: LiveCitationRecord = {
      id: byUrl.size + 1,
      title,
      url,
      site: hostnameOf(url),
      snippet,
      fingerprint: fnv1a(`${url}\u0000${title}\u0000${snippet.slice(0, 400)}`),
      lane: source.lane || options.lane || "grounding",
      stage,
      firstSeenAt: Date.now(),
    };
    byUrl.set(url, record);
    added.push(record);
  }

  if (typeof options.question === "string" && options.question.trim()) {
    lastQuestion = options.question.trim().slice(0, 400);
  }
  if (added.length > 0 || options.question) {
    updatedAt = Date.now();
    emit();
  }
  return added;
}

/** Promote a source to a later stage only if that stage is genuinely later. */
const STAGE_ORDER: CitationStage[] = [
  "initial",
  "grounding",
  "hdig",
  "cove",
  "n-deep",
  "adversarial",
  "synthesis",
];

export function markCitationStage(id: number, stage: CitationStage): boolean {
  for (const record of byUrl.values()) {
    if (record.id !== id) continue;
    if (STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(record.stage)) return false;
    record.stage = stage;
    updatedAt = Date.now();
    emit();
    return true;
  }
  return false;
}

/** Clear the ledger (new session / explicit user reset). */
export function clearCitationLedger(): void {
  byUrl.clear();
  lastQuestion = "";
  updatedAt = Date.now();
  emit();
}

export function getCitationStyle(): string {
  try {
    return localStorage.getItem("veritas.v15.citationStyle") || "APA";
  } catch {
    return "APA";
  }
}

export function formatCitationInline(record: LiveCitationRecord, style: string = "APA"): string {
  const s = style.toUpperCase();
  // We don't have author/year parsed, so we use site + title as proxy
  // But we format the tag wrapper according to style
  switch (s) {
    case "APA":
      return `[S${record.id}]`; // final formatted references will be APA; inline we keep S# for audit but instruct model to add (Site, Year) if available
    case "MLA":
      return `[S${record.id}]`;
    case "CHICAGO":
      return `[S${record.id}]`;
    case "IEEE":
      return `[${record.id}]`; // IEEE uses numeric brackets
    case "AMA":
      return `[S${record.id}]`;
    default:
      return `[S${record.id}]`;
  }
}

export function formatReferenceEntry(record: LiveCitationRecord, style: string = "APA"): string {
  const s = style.toUpperCase();
  const title = record.title || "Untitled";
  const site = record.site || "Unknown site";
  const url = record.url;
  const year = new Date(record.firstSeenAt).getFullYear();
  const accessDate = new Date(record.firstSeenAt).toISOString().split("T")[0];

  // Extract potential author from title or snippet if possible (very basic)
  // For now use site as corporate author fallback

  switch (s) {
    case "APA":
      // APA 7: Site. (Year). Title. URL
      return `[S${record.id}] ${site}. (${year}). ${title}. Retrieved ${accessDate}, from ${url}`;
    case "MLA":
      // MLA 9: "Title." Site, Day Month Year, URL. Accessed Day Month Year.
      return `[S${record.id}] "${title}." ${site}, ${year}, ${url}. Accessed ${accessDate}.`;
    case "CHICAGO":
      // Chicago 17 author-date: Site. Year. "Title." Accessed Month Day, Year. URL.
      return `[S${record.id}] ${site}. ${year}. "${title}." Accessed ${accessDate}. ${url}.`;
    case "IEEE":
      // IEEE: [id] "Title," Site, Year. [Online]. Available: URL
      return `[${record.id}] "${title}," ${site}, ${year}. [Online]. Available: ${url}`;
    case "AMA":
      // AMA: Title. Site. Published Year. Accessed Month Day, Year. URL
      return `[S${record.id}] ${title}. ${site}. Published ${year}. Accessed ${accessDate}. ${url}`;
    default:
      return `[S${record.id}] ${title} — ${site} (${url})`;
  }
}

/**
 * The mandatory retrieve-before-generate contract injected into every prompt
 * that has a populated ledger. Forces verbatim quotation and strict paraphrase
 * bound to real fetched text, which is precisely what makes the deterministic
 * citation audit and CoVe pass by construction rather than by luck.
 * 
 * Now enhanced with:
 * - Citation style awareness (APA default, respects Cite dropdown)
 * - Verbatim quote enforcement with source-first ordering
 * - True inline citation requirements
 */
export function buildQuotationContract(records: LiveCitationRecord[]): string {
  if (records.length === 0) return "";
  const style = getCitationStyle();
  const inventory = records
    .map((r) => formatReferenceEntry(r, style))
    .join("\n");
  
  const inlineExample = style.toUpperCase() === "IEEE" 
    ? `Example: "The market grew 23% in 2024" [1] or for strict paraphrase: Market growth was 23% in 2024 [1].`
    : `Example: "The market grew 23% in 2024" [S1] or for strict paraphrase: Market growth was 23% in 2024 [S1].`;

  return [
    `## SOURCE-FIRST QUOTATION CONTRACT (mandatory, non-negotiable) — ${style.toUpperCase()} STYLE`,
    "",
    "You have been given the full text of every source below. These are the ONLY",
    "admissible external facts. Read them BEFORE composing any sentence.",
    "",
    `Active citation style: ${style.toUpperCase()} (from Cite dropdown, default APA).`,
    `Format ALL citations and References section according to ${style.toUpperCase()} rules.`,
    "",
    "Order of operations — do not reorder:",
    "  1. Read EVERY source passage supplied in the evidence block.",
    "  2. For each fact you plan to use, locate the EXACT sentence in source text.",
    "  3. Extract verbatim quotes (character-identical, in double quotes) for load-bearing facts.",
    "  4. Only then compose the answer from those extracted sentences.",
    "",
    "VERBATIM QUOTE REQUIREMENTS (enforced by audit):",
    "  - Every section MUST contain at least 2 verbatim quotes (\"exact text from source\" with [S#])",
    "  - Quotes must be <= 20 words, character-identical to source, in double quotes",
    "  - Quote the most important facts, numbers, dates, names directly from sources",
    "  - Example of valid verbatim: The report states \"cannabis market reached $13.2B in 2023\" [S3]",
    "  - Invalid (paraphrased as quote): \"market is big\" — this is NOT verbatim if source says \"market reached $13.2B\"",
    "",
    "TRUE INLINE CITATION REQUIREMENTS:",
    "  - Every externally-sourced factual sentence MUST carry an inline [S#] tag",
    "    drawn from the inventory below. Tags outside this inventory are invalid.",
    "  - Place citation IMMEDIATELY after the fact, not at end of paragraph:",
    "    GOOD: \"Revenue grew 23% to $4.2M\" [S2].",
    "    BAD: Revenue grew 23% to $4.2M. Market is large. Future looks good [S2]. (which fact does S2 support?)",
    "  - For each claim, the [S#] must point to a passage that EXPLICITLY contains that claim",
    "  - Multiple facts from same source in one sentence: single [S#] at end is OK",
    "  - Facts from different sources: cite each: Claim A [S1] and claim B [S2].",
    "  - " + inlineExample,
    "",
    "BINDING RULES:",
    "  - For each load-bearing fact, either quote verbatim in double quotes",
    "    (<= 20 words, character-identical) OR paraphrase strictly: same entities,",
    "    same numbers, same units, same time reference, same polarity,",
    "    no widened scope, no added causation.",
    "  - Never assert a number, date, name, or statistic that does not appear",
    "    literally in a supplied passage. If absent, write [UNVERIFIED].",
    "  - Never cite a source for a claim it does not state. A [S#] tag asserts",
    "    that the cited passage contains the claim verbatim or as strict paraphrase.",
    "  - If sources do not answer part of question, say so explicitly rather than",
    "    filling gap from prior knowledge.",
    "  - References section at end MUST follow " + style.toUpperCase() + " formatting:",
    ...(style.toUpperCase() === "APA" ? [
      "    APA Format: Author. (Year). Title. Site. URL",
      "    Example: Leafly. (2024). Cannabis Market Report 2023. Leafly. https://leafly.com/report",
    ] : style.toUpperCase() === "MLA" ? [
      "    MLA Format: \"Title.\" Site, Year, URL. Accessed Date.",
    ] : style.toUpperCase() === "IEEE" ? [
      "    IEEE Format: [id] \"Title,\" Site, Year. [Online]. Available: URL",
    ] : [
      `    ${style.toUpperCase()} Format: See inventory below for example format`,
    ]),
    "",
    "SOURCE INVENTORY (valid citation tags — use ONLY these):",
    inventory,
    "",
    `AUDIT WILL FAIL IF: fewer than 2 verbatim quotes per section, or citations not matching ${style.toUpperCase()} References, or [S#] tags not in inventory.`,
  ].join("\n");
}
