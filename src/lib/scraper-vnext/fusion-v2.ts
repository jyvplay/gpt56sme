import type { SearchResult } from "@/lib/scraper-enhanced";
import { simhash128, simhash128Similarity } from "./hydra-reader";

export interface SourceProvenance { source: string; rank: number; }
export interface FusedSearchResult extends SearchResult {
  canonicalUrl: string; rrfScore: number; normalizedRrfScore: number; provenance: SourceProvenance[];
}
const TRACKING_PARAMETERS = new Set(["fbclid","gclid","dclid","msclkid","mc_cid","mc_eid","ref_src","ref_url","igshid"]);
const ENGINE_WEIGHTS: Record<string, number> = { ddg:1, duckduckgo:1, bing:1, google:1, yahoo:0.9, mojeek:0.8 };
function engineWeight(source:string):number{ return ENGINE_WEIGHTS[source.toLowerCase()] ?? 0.7; }
export function canonicalizeResultUrl(rawUrl:string):string{
  try{
    const parsed=new URL(rawUrl);
    if (parsed.protocol!=="http:" && parsed.protocol!=="https:") return "";
    if (parsed.username || parsed.password) return "";
    parsed.hostname=parsed.hostname.toLowerCase(); parsed.hash="";
    for (const key of Array.from(parsed.searchParams.keys())){ const lower=key.toLowerCase(); if (lower.startsWith("utm_") || TRACKING_PARAMETERS.has(lower)) parsed.searchParams.delete(key); }
    parsed.searchParams.sort(); return parsed.toString();
  }catch{ return ""; }
}
interface Aggregate { result:SearchResult; canonicalUrl:string; rrfScore:number; provenance:Map<string,number>; }
function richerResult(left:SearchResult,right:SearchResult):SearchResult{
  const leftInformation=(left.title||"").length + (left.snippet||"").length;
  const rightInformation=(right.title||"").length + (right.snippet||"").length;
  return rightInformation>leftInformation ? right : left;
}
export function fuseSearchResultsV2(hits:SearchResult[], requestedCount:number):FusedSearchResult[]{
  const count=Math.max(1, Math.min(50, Math.floor(requestedCount||1)));
  const bySource=new Map<string,Array<{result:SearchResult;inputIndex:number}>>();
  hits.forEach((result,inputIndex)=>{
    if (!result.url) return;
    const source=(result.source||"web").trim().toLowerCase()||"web";
    const list=bySource.get(source)||[]; list.push({result,inputIndex}); bySource.set(source,list);
  });
  const aggregates=new Map<string,Aggregate>();
  for (const [source,sourceEntries] of bySource){
    const ordered=sourceEntries.slice().sort((l,r)=>{ const relevance=(r.result.relevanceScore||0)-(l.result.relevanceScore||0); return relevance || l.inputIndex - r.inputIndex; });
    const seenInSource=new Set<string>(); let uniqueRank=0;
    for (const {result} of ordered){
      const canonicalUrl=canonicalizeResultUrl(result.url); if (!canonicalUrl || seenInSource.has(canonicalUrl)) continue;
      seenInSource.add(canonicalUrl); uniqueRank++;
      const contribution=engineWeight(source)/(60+uniqueRank); const existing=aggregates.get(canonicalUrl);
      if (existing){ existing.result=richerResult(existing.result,result); existing.rrfScore+=contribution; existing.provenance.set(source,uniqueRank); }
      else aggregates.set(canonicalUrl,{result,canonicalUrl,rrfScore:contribution,provenance:new Map([[source,uniqueRank]])});
    }
  }
  const candidates=Array.from(aggregates.values()); const maxRrf=Math.max(0,...candidates.map((c)=>c.rrfScore));
  const prepared=candidates.map((candidate)=>{
    const normalizedRrfScore=maxRrf>0 ? candidate.rrfScore/maxRrf : 0;
    const fingerprint=simhash128(`${candidate.result.title||""}\n${candidate.result.snippet||""}`);
    return {...candidate, normalizedRrfScore, fingerprint};
  });
  const remaining=prepared.slice(); const selected:typeof prepared=[];
  while(selected.length<count && remaining.length>0){
    let bestIndex=-1; let bestMmr=-Infinity; let bestRelevance=-Infinity; let bestCanonical="";
    for (let i=0;i<remaining.length;i++){
      const candidate=remaining[i]; let maxSim=0;
      for (const prior of selected) maxSim=Math.max(maxSim, simhash128Similarity(candidate.fingerprint, prior.fingerprint));
      const mmr=0.7*candidate.normalizedRrfScore - 0.3*maxSim;
      if (mmr>bestMmr || (mmr===bestMmr && candidate.normalizedRrfScore>bestRelevance) || (mmr===bestMmr && candidate.normalizedRrfScore===bestRelevance && candidate.canonicalUrl<bestCanonical)){ bestIndex=i; bestMmr=mmr; bestRelevance=candidate.normalizedRrfScore; bestCanonical=candidate.canonicalUrl; }
    }
    if (bestIndex<0) break; selected.push(remaining.splice(bestIndex,1)[0]);
  }
  return selected.map((c)=>({ ...c.result, url:c.result.url, canonicalUrl:c.canonicalUrl, rrfScore:c.rrfScore, normalizedRrfScore:c.normalizedRrfScore, provenance: Array.from(c.provenance.entries()).map(([source,rank])=>({source,rank})).sort((l,r)=> l.rank - r.rank || l.source.localeCompare(r.source)) }));
}
