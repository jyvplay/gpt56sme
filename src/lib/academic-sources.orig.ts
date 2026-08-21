export * from "./academic-sources.base";
import { searchAcademicSources as baseSearch, type AcademicResult } from "./academic-sources.base";

async function openAlex(query: string, count: number): Promise<AcademicResult[]> {
  const res = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${count}&select=id,doi,title,publication_year,abstract_inverted_index`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((w: any) => {
    const words: string[] = [];
    if (w.abstract_inverted_index) for (const [word, pos] of Object.entries(w.abstract_inverted_index)) for (const p of pos as number[]) words[p] = word;
    return { title: w.title || "OpenAlex work", url: w.doi || w.id, description: `OpenAlex ${w.publication_year || ""}`, content: `${w.title || ""}. ${words.filter(Boolean).join(" ").slice(0, 800)}` };
  });
}

async function crossref(query: string, count: number): Promise<AcademicResult[]> {
  const res = await fetch(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${count}&select=DOI,title,abstract,published-print`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.message?.items ?? []).map((w: any) => ({ title: w.title?.[0] || "CrossRef work", url: w.DOI ? `https://doi.org/${w.DOI}` : "", description: `DOI ${w.DOI || ""}`, content: `${w.title?.[0] || ""}. ${String(w.abstract || "").replace(/<[^>]+>/g, " ").slice(0, 800)}` })).filter((r: AcademicResult) => r.url);
}

export async function searchAcademicSources(query: string, opts?: { count?: number; onDebug?: (msg: string) => void }): Promise<AcademicResult[]> {
  const count = opts?.count ?? 6;
  const settled = await Promise.allSettled([baseSearch(query, opts), openAlex(query, count), crossref(query, count)]);
  const all = settled.flatMap((r, i) => { if (r.status === "fulfilled") { opts?.onDebug?.(`[Academic+] source ${i + 1}: ${r.value.length}`); return r.value; } opts?.onDebug?.(`[Academic+] source ${i + 1} failed`); return []; });
  const seen = new Set<string>();
  return all.filter(r => r.url && !seen.has(r.url) && seen.add(r.url)).slice(0, count * 2);
}