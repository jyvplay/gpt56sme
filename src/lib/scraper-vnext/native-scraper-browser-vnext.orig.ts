import { enhancedSearch } from "@/lib/scraper-enhanced";
import { detectPromptInjection, normalizeEvidenceText, type PromptInjectionSignal } from "./content-extractor-v2";
import { fuseSearchResultsV2, type SourceProvenance } from "./fusion-v2";
import { smartReadV2 } from "./smart-read-v2";

export type EnrichmentStatus = "not-attempted" | "ok" | "failed" | "quarantined";
export interface NativeSearchResultVNext {
  title: string; url: string; canonicalUrl: string; snippet: string; engine: string;
  rrfScore: number; normalizedRrfScore: number; provenance: SourceProvenance[];
  articleText?: string; markdown?: string; extractionMethod?: string; transport?: string;
  resolvedSourceUrl?: string; resolvedCanonicalUrl?: string;
  injectionSignals: PromptInjectionSignal[]; quarantined: boolean; enrichmentStatus: EnrichmentStatus;
}
export interface NativeSearchResponseVNext { query: string; results: NativeSearchResultVNext[]; totalCandidates: number; enginesQueried: string[]; }
export interface NativeSearchVNextOptions {
  signal?: AbortSignal; enrichTop?: number; enrichmentConcurrency?: number;
  allowJinaReader?: boolean; allowPublicProxies?: boolean; preferProxy?: string;
  timeoutMs?: number; maxBytes?: number; minEnrichmentChars?: number; maxArticleChars?: number; maxMarkdownChars?: number;
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value===undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
function mergeSignals(...groups: PromptInjectionSignal[][]): PromptInjectionSignal[] {
  const unique=new Map<string,PromptInjectionSignal>();
  for (const group of groups) for (const signal of group) if (!unique.has(signal.id)) unique.set(signal.id, signal);
  return Array.from(unique.values());
}
function signalText(title:string, snippet:string): PromptInjectionSignal[] { return detectPromptInjection(`${title}\n${snippet}`); }
function baseResultFromFused(result: ReturnType<typeof fuseSearchResultsV2>[number]): NativeSearchResultVNext {
  const title=normalizeEvidenceText(result.title||"Untitled");
  const snippet=normalizeEvidenceText(result.snippet||"");
  const injectionSignals=signalText(title,snippet);
  return {
    title, url: result.url, canonicalUrl: result.canonicalUrl, snippet,
    engine: result.source || result.provenance[0]?.source || "web",
    rrfScore: result.rrfScore, normalizedRrfScore: result.normalizedRrfScore,
    provenance: result.provenance, injectionSignals, quarantined: injectionSignals.length>0,
    enrichmentStatus: injectionSignals.length>0 ? "quarantined" : "not-attempted",
  };
}

export async function nativeSearchBrowserVNext(
  query:string, count=10, onDebug?:(m:string)=>void, options?:NativeSearchVNextOptions
):Promise<NativeSearchResponseVNext>{
  const normalizedQuery=normalizeEvidenceText(query||"");
  if (!normalizedQuery) return { query:"", results:[], totalCandidates:0, enginesQueried:[] };
  const requestedCount=clampInteger(count,10,1,20);
  const retrievalLimit=Math.min(50, Math.max(24, requestedCount*4));
  const hits=await enhancedSearch(normalizedQuery,{ maxResults: retrievalLimit, includeAcademic:true, includeIndustry:true, includeForums:true, engines:["google","bing","duckduckgo"], preserveSourceDuplicates:true } as any);
  const enginesQueried=Array.from(new Set(hits.map((h)=>(h.source||"web").trim().toLowerCase()).filter(Boolean))).sort();
  const allFused=fuseSearchResultsV2(hits, retrievalLimit);
  const results=allFused.slice(0,requestedCount).map(baseResultFromFused);
  const enrichTop=Math.min(results.length, clampInteger(options?.enrichTop, Math.min(3,results.length),0,results.length));
  if (enrichTop===0){
    onDebug?.(`native-vnext: ${results.length}/${allFused.length} fused results; enrichment disabled`);
    return { query: normalizedQuery, results, totalCandidates: allFused.length, enginesQueried };
  }
  const concurrency=clampInteger(options?.enrichmentConcurrency, Math.min(2,enrichTop),1,Math.max(1,enrichTop));
  const maxArticleChars=clampInteger(options?.maxArticleChars,4000,1,100000);
  const maxMarkdownChars=clampInteger(options?.maxMarkdownChars,6000,1,100000);
  const minimumChars=clampInteger(options?.minEnrichmentChars,80,0,100000);
  let nextIndex=0;
  const workers=Array.from({length:concurrency}, async ()=>{
    while(true){
      if (options?.signal?.aborted) return;
      const index=nextIndex; nextIndex+=1;
      if (index>=enrichTop) return;
      const original=results[index];
      try{
        const read=await smartReadV2(original.url,{ signal:options?.signal, timeoutMs:options?.timeoutMs, maxBytes:options?.maxBytes, allowJinaReader:options?.allowJinaReader, allowPublicProxies:options?.allowPublicProxies, preferProxy:options?.preferProxy, minChars:minimumChars, onDebug });
        const articleText=normalizeEvidenceText(read.content).slice(0,maxArticleChars);
        const markdown=read.markdown.slice(0,maxMarkdownChars);
        const combinedSignals=mergeSignals(original.injectionSignals, read.injectionSignals, detectPromptInjection(articleText));
        const quarantined=combinedSignals.length>0;
        results[index]={ ...original, title: read.title || original.title, snippet: articleText.slice(0,600) || original.snippet, articleText, markdown, extractionMethod: read.extractionMethod, transport: read.transport, resolvedSourceUrl: read.sourceUrl, resolvedCanonicalUrl: read.canonicalUrl, injectionSignals: combinedSignals, quarantined, enrichmentStatus: quarantined ? "quarantined" : "ok" };
      }catch(error){
        results[index]={ ...original, enrichmentStatus:"failed" };
        onDebug?.(`native-vnext: enrichment ${index+1} failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  });
  await Promise.all(workers);
  const enrichedCount=results.filter((r)=>r.enrichmentStatus==="ok").length;
  const quarantinedCount=results.filter((r)=>r.quarantined).length;
  onDebug?.(`native-vnext: ${results.length}/${allFused.length} fused results; ${enrichedCount} enriched; ${quarantinedCount} quarantined`);
  return { query: normalizedQuery, results, totalCandidates: allFused.length, enginesQueried };
}

export const nativeSearchBrowser = nativeSearchBrowserVNext;
