/**
 * citation-lane-tap.ts — defensive provenance tap for retrieval lanes.
 * ============================================================================
 * The packaged `v15-grounding.ts` imports three lanes through the `@` ALIAS:
 *   `@/lib/academic-sources`, `@/lib/scraper-enhanced`, `@/lib/browser-search-scraper`
 * so those seams ARE on the live retrieval path (unlike `@/lib/v15-grounding`,
 * which the pipeline bypasses with a relative import).
 *
 * This tap normalises whatever shape a lane returns into the store's record
 * shape. It is intentionally permissive and total: unknown shapes are skipped,
 * never guessed. It performs no network access and mutates nothing.
 * ============================================================================ */
import { recordCitationSources, type CitationStage } from "@/lib/citation-ledger-store";

interface LooseResult {
  url?: unknown;
  link?: unknown;
  href?: unknown;
  title?: unknown;
  name?: unknown;
  content?: unknown;
  snippet?: unknown;
  text?: unknown;
  abstract?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Extract {title,url,content} triples from an arbitrary lane return value. */
export function normaliseLaneResults(
  value: unknown,
): Array<{ title?: string; url?: string; content?: string }> {
  const rows: unknown[] = Array.isArray(value)
    ? value
    : Array.isArray((value as { results?: unknown[] })?.results)
      ? (value as { results: unknown[] }).results
      : Array.isArray((value as { sources?: unknown[] })?.sources)
        ? (value as { sources: unknown[] }).sources
        : [];

  const out: Array<{ title?: string; url?: string; content?: string }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as LooseResult;
    const url = str(r.url) ?? str(r.link) ?? str(r.href);
    if (!url) continue;
    out.push({
      url,
      title: str(r.title) ?? str(r.name) ?? "Untitled",
      content: str(r.content) ?? str(r.snippet) ?? str(r.text) ?? str(r.abstract) ?? "",
    });
  }
  return out;
}

/** Record a lane's output. Safe to call with any value; never throws. */
export function tapLane(lane: string, value: unknown, stage: CitationStage = "grounding"): void {
  try {
    const rows = normaliseLaneResults(value);
    if (rows.length > 0) recordCitationSources(rows, { stage, lane });
  } catch {
    /* provenance capture must never break retrieval */
  }
}

/** Wrap an async lane function so its results are tapped transparently. */
export function withLaneTap<TArgs extends unknown[], TResult>(
  lane: string,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const result = await fn(...args);
    tapLane(lane, result);
    return result;
  };
}
