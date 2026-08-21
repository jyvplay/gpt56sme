import { useMemo, useState } from "react";
import {
  CreativeStudio,
  V10CreativeStore,
  buildV10DiscoveryContext,
  type CreativeBrief,
  type CreativeMode,
  type IdeaCard,
} from "@/lib/innovation-genome-v10";

const MODES: CreativeMode[] = ["idea", "theory", "product", "code", "research", "story"];
const stageColor: Record<string, string> = {
  seed: "bg-amber-700", sprout: "bg-lime-400", branch: "bg-emerald-500",
  bloom: "bg-pink-400", fruit: "bg-amber-400", compost: "bg-stone-500",
};

export function CreativeTreeOfLifePanel() {
  const [expanded, setExpanded] = useState(false);
  const [challenge, setChallenge] = useState("Find a high-value opportunity hidden by current assumptions");
  const [mode, setMode] = useState<CreativeMode>("research");
  const [seed, setSeed] = useState(42);
  const [studio, setStudio] = useState<CreativeStudio | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [directive, setDirective] = useState<ReturnType<typeof buildV10DiscoveryContext> | null>(null);

  const nodes = useMemo(() => studio && workspaceId ? studio.workspaceNodes(workspaceId) : [], [studio, workspaceId, version]);
  const ranking = useMemo(() => studio && workspaceId ? studio.rankIdeas(workspaceId) : [], [studio, workspaceId, version]);
  const health = useMemo(() => studio && workspaceId ? studio.treeHealth(workspaceId) : null, [studio, workspaceId, version]);

  const grow = () => {
    const next = new CreativeStudio(new V10CreativeStore());
    const profile = next.bootstrapLocal("Creator");
    const brief: CreativeBrief = {
      challenge, mode,
      audience: ["person most affected by challenge"],
      desiredOutcomes: ["useful, testable progress"],
      constraints: ["preserve uncertainty; do not invent facts"],
      resources: ["existing knowledge, evidence, relationships, tools"],
      inspirationDomains: ["ecology", "distributed systems", "craft", "scientific instrumentation"],
      avoid: ["generic repetition", "unsupported global novelty claims"],
      axes: { evidence: ["primary sources", "counter-evidence", "implementation evidence"] },
    };
    const ws = next.createWorkspace(profile, challenge.slice(0, 64), brief, seed);
    next.creativeExplosion(ws, 8, 16);
    const context = buildV10DiscoveryContext(challenge, mode, seed);
    setStudio(next); setWorkspaceId(ws); setDirective(context); setSelected([]); setVersion(v => v + 1);
    try {
      localStorage.setItem("veritas.v10.discoveryDirective", context.directive);
      localStorage.setItem("veritas.v10.searchAngles", JSON.stringify(context.searchAngles));
    } catch { /* storage optional */ }
    window.dispatchEvent(new CustomEvent("veritas:v10-discovery", { detail: context }));
  };

  const confirm = (nodeId: string, verdict: "confirm" | "reject") => {
    if (!studio) return;
    studio.confirm(nodeId, "overall", verdict, 5, verdict === "confirm" ? "Human-selected branch" : "Human-rejected branch; preserve as compost");
    setVersion(v => v + 1);
  };

  const cross = () => {
    if (!studio || selected.length !== 2) return;
    studio.crossPollinate(selected[0], selected[1]);
    setSelected([]); setVersion(v => v + 1);
  };

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 2 ? [...s, id] : [s[1], id]);

  return (
    <section className="rounded-2xl border border-lime-200 bg-white shadow-sm">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between px-5 py-3 text-left">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-lime-100 to-emerald-100 text-lg">🌳</div>
          <div>
            <div className="text-sm font-bold text-zinc-900">Creative Tree of Life <span className="text-lime-700">V10</span></div>
            <div className="text-xs text-zinc-500">Offline discovery studio · unverified branches · human-governed selection</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {health && <span className="rounded bg-lime-50 px-2 py-1 font-mono text-[10px] text-lime-800">{health.nodeCount} nodes</span>}
          <span className="text-zinc-400">{expanded ? "−" : "+"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 px-5 py-4">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
            <input value={challenge} onChange={e => setChallenge(e.target.value)} className="rounded-lg border border-zinc-300 px-3 py-2 text-xs" aria-label="Creative challenge" />
            <select value={mode} onChange={e => setMode(e.target.value as CreativeMode)} className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs">
              {MODES.map(m => <option key={m}>{m}</option>)}
            </select>
            <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value) >>> 0)} className="w-28 rounded-lg border border-zinc-300 px-2 py-2 font-mono text-xs" aria-label="Creative seed" />
            <button onClick={grow} className="rounded-lg bg-lime-700 px-4 py-2 text-xs font-bold text-white hover:bg-lime-800">Grow tree</button>
          </div>

          {health && (
            <div className="mt-3 grid grid-cols-3 gap-2 md:grid-cols-6">
              {[["nodes",health.nodeCount],["branches",health.branchCount],["families",health.operatorFamilyCount],["novelty",health.meanLocalNovelty.toFixed(2)],["cohesion",health.meanCohesion.toFixed(2)],["human touch",`${Math.round(health.humanTouchRate*100)}%`]].map(([k,v]) => (
                <div key={String(k)} className="rounded-lg border border-zinc-100 bg-zinc-50 p-2 text-center"><div className="text-[9px] uppercase text-zinc-400">{k}</div><div className="font-mono text-xs font-bold text-zinc-800">{v}</div></div>
              ))}
            </div>
          )}

          {nodes.length > 0 && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_1.2fr]">
              <div className="rounded-xl border border-zinc-200 bg-zinc-950 p-3 text-zinc-100">
                <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-lime-300"><span>Tree paths</span><span>{selected.length}/2 selected</span></div>
                <div className="max-h-[430px] space-y-1 overflow-y-auto">
                  {nodes.map(n => (
                    <button key={n.nodeId} onClick={() => (n.nodeKind === "idea" || n.nodeKind === "synthesis") && toggle(n.nodeId)} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[10px] ${selected.includes(n.nodeId) ? "bg-lime-900 ring-1 ring-lime-400" : "hover:bg-zinc-900"}`} style={{ paddingLeft: `${8 + n.depth * 14}px` }}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${stageColor[n.lifeStage]}`} />
                      <span className="truncate">{n.title}</span><span className="ml-auto text-[8px] text-zinc-500">{n.lifeStage}</span>
                    </button>
                  ))}
                </div>
                <button onClick={cross} disabled={selected.length !== 2} className="mt-3 w-full rounded bg-fuchsia-700 px-2 py-1.5 text-[10px] font-bold text-white disabled:opacity-30">Cross-pollinate selected branches</button>
              </div>

              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {ranking.slice(0, 12).map((item, index) => {
                  const card = item.node.body as IdeaCard;
                  return (
                    <article key={item.node.nodeId} className={`rounded-xl border p-3 ${item.node.status === "rejected" ? "border-stone-300 bg-stone-50 opacity-70" : item.node.status === "favorite" ? "border-lime-400 bg-lime-50" : "border-zinc-200 bg-white"}`}>
                      <div className="flex items-start justify-between gap-2"><div><span className="mr-2 text-[9px] font-bold text-zinc-400">#{index+1}</span><span className="text-xs font-bold text-zinc-900">{card.title}</span></div><span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px]">{item.score.toFixed(2)}</span></div>
                      <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{card.thesis}</p>
                      <div className="mt-2 rounded bg-zinc-50 p-2 text-[9px] text-zinc-600"><b>Mechanism:</b> {card.mechanism}</div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[8px] text-zinc-500"><span>novelty {item.noveltyScore.toFixed(2)}</span><span>· cohesion {item.cohesionScore.toFixed(2)}</span><span>· {card.operatorFamily}</span><span>· {card.epistemicStatus}</span></div>
                      <div className="mt-2 flex gap-1"><button onClick={() => confirm(item.node.nodeId,"confirm")} className="rounded bg-lime-600 px-2 py-1 text-[9px] font-bold text-white">Confirm</button><button onClick={() => confirm(item.node.nodeId,"reject")} className="rounded bg-stone-600 px-2 py-1 text-[9px] font-bold text-white">Compost</button><button onClick={() => toggle(item.node.nodeId)} className="rounded border border-zinc-200 px-2 py-1 text-[9px]">Select</button></div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {directive && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3"><div className="text-[10px] font-bold uppercase text-sky-800">Scraper search angles</div><ol className="mt-2 list-decimal space-y-1 pl-4 text-[10px] text-sky-900">{directive.searchAngles.map((a,i)=><li key={i}>{a}</li>)}</ol></div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="text-[10px] font-bold uppercase text-amber-800">Next logic moves</div><ol className="mt-2 list-decimal space-y-1 pl-4 text-[10px] text-amber-900">{directive.nextMoves.map((a,i)=><li key={i}>{a}</li>)}</ol></div>
              <details className="md:col-span-2"><summary className="cursor-pointer text-xs font-bold text-zinc-600">Pipeline discovery directive</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-950 p-3 text-[9px] text-lime-300">{directive.directive}</pre></details>
              <div className="md:col-span-2 flex gap-2"><button onClick={() => navigator.clipboard.writeText(directive.directive)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-bold">Copy directive</button><button onClick={() => studio && navigator.clipboard.writeText(studio.exportJson(workspaceId))} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-bold">Export JSON</button><button onClick={() => studio && navigator.clipboard.writeText(studio.exportTerminal(workspaceId))} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-bold">Export tree</button></div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}