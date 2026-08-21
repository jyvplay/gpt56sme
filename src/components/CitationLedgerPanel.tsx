/**
 * CitationLedgerPanel — design-identical sibling of `StylePersonaPanel`.
 * ============================================================================
 * Same section chrome, same expand affordance, same control row, same
 * quantitative card grid with filled bars and numeric readouts.
 *
 * Data source: `@/lib/citation-ledger-store`, populated exclusively by sources
 * that the grounding fleet ACTUALLY fetched. If nothing has been retrieved the
 * panel says so explicitly — it never invents rows to look populated.
 *
 * Columns required by the audit contract:
 *   - scraped site (hostname)
 *   - title
 *   - usage: the pipeline stage at which the source was FIRST integrated
 * ============================================================================ */
import { useEffect, useMemo, useState } from "react";
import {
  subscribeCitationLedger,
  clearCitationLedger,
  buildQuotationContract,
  getCitationStyle,
  formatReferenceEntry,
  type CitationLedgerSnapshotLive,
  type CitationStage,
} from "@/lib/citation-ledger-store";

const STAGE_STYLE: Record<CitationStage, string> = {
  initial: "bg-zinc-100 text-zinc-700",
  grounding: "bg-sky-100 text-sky-800",
  hdig: "bg-indigo-100 text-indigo-800",
  cove: "bg-emerald-100 text-emerald-800",
  "n-deep": "bg-violet-100 text-violet-800",
  adversarial: "bg-rose-100 text-rose-800",
  synthesis: "bg-amber-100 text-amber-800",
};

const EMPTY: CitationLedgerSnapshotLive = {
  records: [],
  siteCount: 0,
  lastQuestion: "",
  updatedAt: 0,
};

export function CitationLedgerPanel() {
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<CitationLedgerSnapshotLive>(EMPTY);

  useEffect(() => subscribeCitationLedger(setSnapshot), []);

  const stageCounts = useMemo(() => {
    const counts = new Map<CitationStage, number>();
    for (const record of snapshot.records) {
      counts.set(record.stage, (counts.get(record.stage) ?? 0) + 1);
    }
    return counts;
  }, [snapshot.records]);

  const siteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of snapshot.records) {
      counts.set(record.site, (counts.get(record.site) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [snapshot.records]);

  const withSnippet = snapshot.records.filter((r) => r.snippet.length > 0).length;
  const total = snapshot.records.length;
  const quotableRatio = total > 0 ? withSnippet / total : 0;
  const maxSiteHits = siteCounts.length > 0 ? siteCounts[0][1] : 1;

  const citationStyle = useMemo(() => getCitationStyle(), [snapshot.updatedAt]);
  
  const contract = useMemo(
    () => buildQuotationContract(snapshot.records),
    [snapshot.records, citationStyle],
  );

  const referencesFormatted = useMemo(
    () => snapshot.records.map(r => formatReferenceEntry(r, citationStyle)),
    [snapshot.records, citationStyle]
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-sky-100 to-emerald-100 text-lg">📚</div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-bold text-zinc-900">
                Citation Ledger: <span className="text-sky-700">{total} source{total === 1 ? "" : "s"}</span>
              </div>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  total === 0
                    ? "bg-zinc-100 text-zinc-600"
                    : quotableRatio === 1
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                }`}
              >
                {total === 0 ? "Empty" : `${withSnippet}/${total} quotable`}
              </span>
            </div>
            <div className="text-xs text-zinc-500">
              Verified-retrieved provenance · site, title, and first-use stage per [S#]
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-zinc-100 px-2 py-1 font-mono text-[10px] text-zinc-600">
            {snapshot.siteCount} site{snapshot.siteCount === 1 ? "" : "s"}
          </span>
          <span className="text-zinc-400">{expanded ? "−" : "+"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(
                snapshot.records
                  .map((r) => `[S${r.id}] ${r.title} — ${r.url} (site ${r.site}; first used at ${r.stage}; fingerprint ${r.fingerprint})`)
                  .join("\n"),
              )}
              disabled={total === 0}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-40"
            >
              Copy References
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(contract)}
              disabled={total === 0}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              title="Copy the source-first quotation contract injected into every grounded prompt"
            >
              Copy Contract
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(JSON.stringify(snapshot.records, null, 2))}
              disabled={total === 0}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              Export JSON
            </button>
            <button
              onClick={clearCitationLedger}
              disabled={total === 0}
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          <div className="mb-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Provenance metrics</div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-zinc-900">Quotable coverage</div>
                <div className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[9px] text-sky-700">verbatim</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="w-16 text-right text-[9px] leading-tight text-zinc-500">no text</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-200">
                  <div className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500" style={{ width: `${quotableRatio * 100}%` }} />
                  <div className="absolute top-[-2px] h-3 w-1 rounded-full bg-zinc-900" style={{ left: `calc(${quotableRatio * 100}% - 2px)` }} />
                </div>
                <span className="w-16 text-[9px] leading-tight text-zinc-500">full text</span>
              </div>
              <div className="mt-1 text-right font-mono text-[10px] text-zinc-400">{quotableRatio.toFixed(2)}</div>
            </div>

            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-zinc-900">Source diversity</div>
                <div className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] text-emerald-700">hosts</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="w-16 text-right text-[9px] leading-tight text-zinc-500">single host</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500"
                    style={{ width: `${total > 0 ? (snapshot.siteCount / total) * 100 : 0}%` }}
                  />
                </div>
                <span className="w-16 text-[9px] leading-tight text-zinc-500">all distinct</span>
              </div>
              <div className="mt-1 text-right font-mono text-[10px] text-zinc-400">
                {total > 0 ? (snapshot.siteCount / total).toFixed(2) : "0.00"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-zinc-900">Stage spread</div>
                <div className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[9px] text-violet-700">usage</div>
              </div>
              <div className="mt-2 space-y-1">
                {stageCounts.size === 0 && <div className="text-[10px] text-zinc-400">No stages recorded yet.</div>}
                {Array.from(stageCounts.entries()).map(([stage, count]) => (
                  <div key={stage} className="flex items-center justify-between text-[10px]">
                    <span className={`rounded px-1.5 py-0.5 font-bold ${STAGE_STYLE[stage]}`}>{stage}</span>
                    <span className="font-mono text-zinc-500">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {siteCounts.length > 0 && (
            <>
              <div className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                Per-site retrieval count
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {siteCounts.map(([site, count]) => (
                  <div key={site} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="truncate text-xs font-bold text-zinc-900" title={site}>{site}</div>
                      <div className="font-mono text-[10px] text-zinc-500">{count}</div>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500"
                        style={{ width: `${(count / maxSiteHits) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
            Ledger entries
          </div>
          <div className="mb-2 text-[10px] leading-tight text-zinc-500">
            <b>grounding</b> = fetched by a retrieval lane, not yet confirmed in the draft.
            All other stages come from the pipeline&apos;s own ledger and mark the point at
            which the source was <b>first integrated into the draft</b>.
          </div>

          {total === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-center text-xs text-zinc-500">
              No sources retrieved yet. Run a grounded query — every fetched document is recorded here
              automatically with its site, title, and the stage at which it first entered the draft.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-zinc-50 font-bold text-zinc-600">
                  <tr>
                    <th className="px-3 py-2">Tag</th>
                    <th className="px-3 py-2">Site</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Usage (first draft stage)</th>
                    <th className="px-3 py-2">Lane</th>
                    <th className="px-3 py-2">Fingerprint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {snapshot.records.map((record) => (
                    <tr key={record.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-mono font-bold text-zinc-800">[S{record.id}]</td>
                      <td className="px-3 py-2">
                        <a href={record.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          {record.site}
                        </a>
                      </td>
                      <td className="max-w-[280px] px-3 py-2 text-zinc-800" title={record.title}>{record.title}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STAGE_STYLE[record.stage]}`}>
                          {record.stage}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-zinc-500">{record.lane}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-zinc-400">{record.fingerprint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-bold text-zinc-600 hover:text-zinc-900">
              View References formatted as {citationStyle.toUpperCase()} (from Cite dropdown)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs leading-relaxed text-zinc-800">
              {referencesFormatted.length > 0 ? referencesFormatted.join("\n\n") : "(no sources yet — references appear here once ledger is populated)"}
            </pre>
          </details>

          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-bold text-zinc-600 hover:text-zinc-900">
              View source-first quotation contract (injected into every grounded prompt, {citationStyle.toUpperCase()} style)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs leading-relaxed text-zinc-800">
              {contract || "(no sources yet — contract is injected once the ledger is populated)"}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}
