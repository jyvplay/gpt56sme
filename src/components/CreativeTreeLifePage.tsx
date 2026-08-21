/** V10 Creative Tree of Life — independent animated 3D discovery studio. */
import { useEffect, useMemo, useState } from "react";
import {
  CreativeStudio, V10CreativeStore, buildV10DiscoveryContext,
  type CreativeBrief, type CreativeMode, type LifeStage, type NodeRecord, type IdeaCard,
} from "@/lib/innovation-genome-v10";

interface Props { initialDomain?: string; onClose?: () => void; onDirectiveChange?: (d: string) => void; }
const DOMAINS = ["mathematics","algorithms","software","medicine","legal","physics","chemistry","ml","general"];
const COLORS: Record<LifeStage, string> = { seed:"#a87945", sprout:"#8bd17c", branch:"#4fbd73", bloom:"#f29ac4", fruit:"#ffd166", compost:"#8d6e63" };

function TreeCanvas({ nodes, edges, active, select }: { nodes: NodeRecord[]; edges: Array<{ source_node_id: string; target_node_id: string; relation: string }>; active: string | null; select: (n: NodeRecord) => void }) {
  const positions = useMemo(() => {
    const layers = new Map<number, NodeRecord[]>();
    nodes.forEach(n => layers.set(n.depth, [...(layers.get(n.depth) || []), n]));
    const out = new Map<string, { x: number; y: number; z: number }>();
    for (const [depth, layer] of layers) {
      layer.forEach((n, i) => {
        const spread = Math.max(130, Math.min(680, layer.length * 92));
        const offset = layer.length === 1 ? 0 : i / (layer.length - 1) - 0.5;
        out.set(n.nodeId, { x: 380 + offset * spread, y: 360 - depth * 56 - Math.abs(offset) * 25, z: Math.min(1, depth / 5) });
      });
    }
    return out;
  }, [nodes]);

  return (
    <svg viewBox="0 0 760 430" className="h-full w-full" role="img" aria-label="Animated 3D Creative Tree of Life">
      <defs>
        <radialGradient id="v10-ground"><stop offset="0" stopColor="#1b3a2e" /><stop offset="1" stopColor="#07100e" /></radialGradient>
        <linearGradient id="v10-trunk" x1="0" y1="1" x2="0" y2="0"><stop stopColor="#a8784b" /><stop offset=".5" stopColor="#61412c" /><stop offset="1" stopColor="#2b201b" /></linearGradient>
        <filter id="v10-glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <ellipse cx="380" cy="382" rx="230" ry="28" fill="url(#v10-ground)" />
      <path d="M380 374 C365 320 395 270 380 215" fill="none" stroke="url(#v10-trunk)" strokeWidth="20" strokeLinecap="round" />
      {edges.map((e, i) => {
        const a = positions.get(e.source_node_id), b = positions.get(e.target_node_id);
        if (!a || !b) return null;
        const d = `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 28} ${b.x} ${b.y}`;
        return (
          <g key={`${e.source_node_id}-${e.target_node_id}-${i}`}>
            <path d={d} fill="none" stroke="#315b4b" strokeWidth="7" strokeLinecap="round" opacity=".75" />
            <circle r="4" fill="#f4c86b" filter="url(#v10-glow)">
              <animateMotion dur={`${3 + i % 3}s`} path={d} repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}
      {nodes.map(n => {
        const p = positions.get(n.nodeId) || { x: 380, y: 350, z: 0 };
        const selected = active === n.nodeId;
        const r = n.lifeStage === "seed" ? 18 : n.lifeStage === "fruit" ? 15 : 10 + (1 - p.z) * 3;
        return (
          <g key={n.nodeId} transform={`translate(${p.x} ${p.y})`} onClick={() => select(n)} className="cursor-pointer">
            <ellipse rx={r * 1.6} ry={r * 0.48} cy={r * 0.95} fill="#020504" opacity=".4" />
            <circle r={r + (selected ? 5 : 0)} fill={selected ? "#fff3bc" : COLORS[n.lifeStage]} stroke={selected ? "#fff" : "#10241c"} strokeWidth={selected ? 3 : 2}>
              <animate attributeName="r" values={`${r};${r + 2};${r}`} dur="3s" repeatCount="indefinite" />
            </circle>
            <text y={r + 18} textAnchor="middle" fill="#d7e6df" fontSize="9">{n.title.slice(0, 22)}</text>
            <text y={r + 30} textAnchor="middle" fill="#77968a" fontSize="8">{n.lifeStage}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function CreativeTreeLifePage({ initialDomain = "general", onClose, onDirectiveChange }: Props) {
  const [studio] = useState(() => new CreativeStudio(new V10CreativeStore()));
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [ver, setVer] = useState(0);
  const [domain, setDomain] = useState(initialDomain);
  const [active, setActive] = useState<NodeRecord | null>(null);
  const [directive, setDirective] = useState("");
  const [angles, setAngles] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  const nodes = useMemo(() => workspaceId ? studio.nodes(workspaceId) : [], [workspaceId, ver]);
  const ranking = useMemo(() => workspaceId ? studio.rankIdeas(workspaceId) : [], [workspaceId, ver]);
  const edges = useMemo(() => workspaceId ? studio.edgesFor(workspaceId) : [], [workspaceId, ver]);
  const workspaces = useMemo(() => studio.listWorkspaces(), [ver]);

  const publish = () => {
    if (!workspaceId) return;
    try {
      const w = studio.workspace(workspaceId);
      const c = buildV10DiscoveryContext((w.brief as CreativeBrief).challenge, (w.brief as CreativeBrief).mode, w.seed as number);
      setDirective(c.directive); setAngles(c.searchAngles);
      (window as any)._VERITAS_V10_DISCOVERY_CONTEXT = c;
      window.dispatchEvent(new CustomEvent("veritas:v10-discovery-context", { detail: c }));
      onDirectiveChange?.(c.directive);
    } catch { /* workspace may not exist yet */ }
  };
  useEffect(publish, [workspaceId, ver]);

  const mutate = (fn: () => unknown, msg: string) => { try { fn(); setVer(v => v + 1); setNotice(msg); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); } };

  const create = () => {
    const brief: CreativeBrief = {
      challenge: `Discover feasible, high-impact directions in ${domain}`,
      mode: "research" as CreativeMode,
      audience: ["independent researcher", "product builder"],
      desiredOutcomes: ["evidence-bound next step", "specific search angle"],
      constraints: ["preserve uncertainty", "locally inspectable"],
      resources: ["retrieved evidence", "scraper results", "human judgment"],
      inspirationDomains: [domain, "scientific instrumentation", "ecology"],
      avoid: ["generic repetition", "unsupported novelty claims"],
      axes: { evidence_strategy: ["primary sources", "counter-evidence", "implementation evidence", "failure evidence"] },
    };
    const id = studio.createWorkspaceSimple("Live Discovery Tree", brief, Date.now());
    setWorkspaceId(id);
    studio.sprout(id, 6);
    studio.burst(id, { count: 10, candidateMultiplier: 4, maximumSimilarity: 0.82, minimumOperatorFamilies: 6 });
    setVer(v => v + 1);
    setNotice("Tree seeded: 6 sprouts + 10 branches");
  };

  return (
    <div className="fixed inset-0 z-[10003] overflow-y-auto bg-[#07100e] p-4 text-zinc-100 sm:p-8">
      <div className="mx-auto min-h-full max-w-[1500px] rounded-[28px] border border-emerald-950 bg-[#0a1714] p-5 shadow-2xl sm:p-7" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-emerald-950 pb-5">
          <div>
            <div className="text-[10px] uppercase tracking-[.3em] text-emerald-400">V10 · offline discovery plane</div>
            <h2 className="mt-1 text-2xl font-black">Creative Tree of Life</h2>
            <p className="mt-1 max-w-2xl text-xs text-emerald-100/60">Animated local graph. Generated branches remain unverified proposals; human judgment controls promotion.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={create} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-emerald-950">New tree</button>
            {onClose && <button onClick={onClose} className="rounded-lg border border-emerald-900 px-3 py-2 text-xs font-bold">Close</button>}
          </div>
        </header>

        {/* Controls bar */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-emerald-950 pb-4 text-xs">
          <label className="flex items-center gap-2 text-emerald-100/70">Domain
            <select value={domain} onChange={e => setDomain(e.target.value)} className="rounded-md border border-emerald-800 bg-[#0e211c] px-2 py-1">
              {DOMAINS.map(d => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-emerald-100/70">Workspace
            <select value={workspaceId || ""} onChange={e => { setWorkspaceId(e.target.value); setVer(v => v + 1); }} className="max-w-[250px] rounded-md border border-emerald-800 bg-[#0e211c] px-2 py-1">
              <option value="">choose tree</option>
              {workspaces.map((w: any) => <option key={w.workspace_id} value={w.workspace_id}>{w.title}</option>)}
            </select>
          </label>
          {notice && <span className="text-amber-300">{notice}</span>}
        </div>

        {!workspaceId ? (
          <div className="grid min-h-[500px] place-items-center text-emerald-100/50">Create new tree to begin offline discovery.</div>
        ) : (
          <>
            {/* Main: 3D graph + growth controls */}
            <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_.9fr]">
              <section className="rounded-2xl border border-emerald-950 bg-[#08120f] p-3">
                <div className="mb-2 flex justify-between px-2 text-[10px] uppercase tracking-[.22em] text-emerald-400">
                  <span>3D living graph · animated flow</span><span>{nodes.length} nodes</span>
                </div>
                <div className="aspect-[16/9]">
                  <TreeCanvas nodes={nodes} edges={edges} active={active?.nodeId || null} select={setActive} />
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-2xl border border-emerald-950 bg-[#0d211b] p-4">
                  <div className="text-[10px] uppercase tracking-[.22em] text-emerald-400">Growth controls</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button onClick={() => mutate(() => studio.sprout(workspaceId, 6), "6 sprouts added")} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold">Sprout</button>
                    <button onClick={() => mutate(() => studio.burst(workspaceId, { count: 8, candidateMultiplier: 4, maximumSimilarity: 0.82, minimumOperatorFamilies: 6 }), "8 branches grown")} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold">Burst</button>
                    <button disabled={!active} onClick={() => active && mutate(() => studio.expand(active.nodeId, "resolve bottleneck", 5), "Fractal expansion added")} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold disabled:opacity-30">Expand</button>
                    <button disabled={!active} onClick={() => active && mutate(() => studio.fractalZoom(active.nodeId, 4), "Fractal zoom added")} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold disabled:opacity-30">Zoom</button>
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-950 bg-[#0d211b] p-4">
                  <div className="text-[10px] uppercase tracking-[.22em] text-emerald-400">Logic + search modifier</div>
                  <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-emerald-100/80">{directive || "Create tree to compile directive."}</pre>
                  <div className="mt-3 space-y-1">
                    {angles.slice(0, 4).map((q, i) => (
                      <div key={i} className="rounded-md border border-emerald-900 bg-[#08120f] px-2 py-1 text-[10px] text-amber-200">S{i + 1} · {q}</div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            {/* Bottom: selected branch + ranking */}
            <div className="mt-5 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
              <section className="rounded-2xl border border-emerald-950 bg-[#0d211b] p-4">
                <div className="text-[10px] uppercase tracking-[.22em] text-emerald-400">Selected branch</div>
                {active ? (
                  <>
                    <h3 className="mt-2 text-lg font-bold">{active.title}</h3>
                    <div className="mt-1 text-[10px] text-emerald-100/50">
                      {active.lifeStage} · {active.status} · novelty {active.localNovelty.toFixed(2)} · cohesion {active.cohesion.toFixed(2)}
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-emerald-100/80">
                      {(active.body as IdeaCard).thesis || (active.body as Record<string, unknown>).text as string || "Open tree node."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => mutate(() => studio.confirm(active.nodeId, "overall", "confirm", 5, "human V10 review"), "Confirmed")} className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold">Confirm</button>
                      <button onClick={() => mutate(() => studio.confirm(active.nodeId, "overall", "reject", 5, "human V10 rejection"), "Rejected and preserved")} className="rounded-md bg-rose-700 px-2 py-1 text-[10px] font-bold">Reject</button>
                      <button onClick={() => mutate(() => studio.compost(active.nodeId, "human preserved failure reason"), "Moved to compost")} className="rounded-md bg-stone-600 px-2 py-1 text-[10px] font-bold">Compost</button>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-emerald-100/50">Select glowing node in graph.</p>
                )}
              </section>

              <section className="rounded-2xl border border-emerald-950 bg-[#0d211b] p-4">
                <div className="text-[10px] uppercase tracking-[.22em] text-emerald-400">Advisory ranking + exports</div>
                <div className="mt-3 max-h-52 space-y-1 overflow-auto">
                  {ranking.slice(0, 8).map(r => (
                    <button key={r.node.nodeId} onClick={() => setActive(r.node)} className="flex w-full items-center justify-between rounded-md border border-emerald-950 bg-[#08120f] px-2 py-1.5 text-left text-[10px] hover:border-emerald-500">
                      <span className="truncate">{r.node.title}</span>
                      <span className="ml-2 text-amber-300">{r.score.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(["json", "markdown", "mermaid", "terminal"] as const).map(format => (
                    <button key={format} onClick={() => workspaceId && navigator.clipboard.writeText(studio.exportWorkspace(workspaceId, format))} className="rounded-md border border-emerald-800 px-2 py-1 text-[10px]">Copy {format}</button>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
