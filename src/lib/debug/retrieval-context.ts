/**
 * retrieval-context.ts — browser-local run context for scraper lane wrappers.
 *
 * Package template queries are truncated before they reach the lanes. The
 * wrapper owns the full original prompt and full IFL; this registry lets each
 * alias-reachable lane recover that plan at its actual call boundary.
 *
 * Concurrency boundary: browser JS may run concurrent V15 requests. Contexts
 * are retained by run id and selection prefers lexical overlap with the raw
 * lane query, then newest context. Callers MUST clear their run on completion.
 */
import type { IntentLattice, LatticeQuery } from "@/lib/debug/intent-lattice";

interface RetrievalContext {
  runId: string;
  original: string;
  lattice: IntentLattice;
  createdAt: number;
}

const contexts = new Map<string, RetrievalContext>();

function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) =>
    !/^(this|that|with|from|have|will|into|using|find|please|report|analysis)$/.test(w)
  ));
}

function overlap(a: string, b: string): number {
  const aw = words(a), bw = words(b);
  if (!aw.size || !bw.size) return 0;
  let n = 0;
  for (const w of aw) if (bw.has(w)) n++;
  return n / Math.max(aw.size, bw.size);
}

export function registerRetrievalContext(runId: string, original: string, lattice: IntentLattice): void {
  contexts.set(runId, { runId, original, lattice, createdAt: Date.now() });
  // Defensive cap: interrupted runs must not grow memory forever.
  if (contexts.size > 8) {
    const oldest = [...contexts.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) contexts.delete(oldest.runId);
  }
}

export function clearRetrievalContext(runId: string): void {
  contexts.delete(runId);
}

/** Select the best full-prompt context for a package-supplied lane query. */
export function resolveRetrievalQueries(rawQuery: string, section = "general"): {
  contextRunId: string | null;
  original: string;
  queries: LatticeQuery[];
} | null {
  if (contexts.size === 0) return null;
  const ranked = [...contexts.values()].sort((a, b) => {
    const ao = overlap(rawQuery, a.original), bo = overlap(rawQuery, b.original);
    return bo - ao || b.createdAt - a.createdAt;
  });
  const ctx = ranked[0];
  const exact = ctx.lattice.queries.filter((q) => q.section === section);
  if (exact.length) return { contextRunId: ctx.runId, original: ctx.original, queries: exact };

  // Choose lattice queries closest to the package query's section suffix.
  const scored = ctx.lattice.queries
    .map((q) => ({ q, score: overlap(rawQuery, `${q.section} ${q.q}`) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  const selected = scored.filter((x) => x.score === best).slice(0, 3).map((x) => x.q);
  return {
    contextRunId: ctx.runId,
    original: ctx.original,
    queries: selected.length ? selected : ctx.lattice.queries.slice(0, 3),
  };
}
