/**
 * InnovationPersonaPanel — design-identical sibling of `StylePersonaPanel`.
 * ============================================================================
 * Same section chrome, same expand affordance, same reroll / pin / custom-seed
 * / export control row, same dimension-card grid with low↔high poles, filled
 * bar, marker and numeric readout, same `<details>` prompt viewer.
 *
 * Where the Williams panel governs HOW THE ANSWER IS WRITTEN, this panel
 * governs HOW THE PROBLEM IS SEARCHED AND REFRAMED. It is driven by the real
 * Innovation Genome v2 engine — no mock data, no placeholder values.
 *
 * Rarity is MEASURED, not asserted: `useMemo` runs the deterministic genome
 * compiler over a fixed lattice of seeds and counts how often each persona
 * wins its first-match trigger. The printed percentage is therefore a real
 * sampled frequency with a stated sample size, reproducible on any machine.
 * ============================================================================ */
import { useMemo, useState } from "react";
import { DIMENSIONS, seedToGenome } from "@/lib/innovation-genome-engine";
import {
  classifyPersonaExtended,
  selectPathExtended,
  compileCompactDirectiveV2,
  newInnovationSeed,
  inferInnovationDomain,
  rollV2,
  DOMAIN_PACKS,
  type InnovationGenomeV2,
} from "@/lib/innovation-genome-engine-v2";

/** Sample size for the rarity estimate. Fixed so the number is reproducible. */
const RARITY_SAMPLES = 1200;

type Tier = "Legendary" | "Epic" | "Rare" | "Uncommon" | "Common";

function tierFor(percent: number): Tier {
  if (percent < 2) return "Legendary";
  if (percent < 6) return "Epic";
  if (percent < 12) return "Rare";
  if (percent < 25) return "Uncommon";
  return "Common";
}

function tierClass(tier: Tier): string {
  switch (tier) {
    case "Legendary": return "bg-amber-100 text-amber-800";
    case "Epic": return "bg-fuchsia-100 text-fuchsia-800";
    case "Rare": return "bg-sky-100 text-sky-800";
    case "Uncommon": return "bg-emerald-100 text-emerald-800";
    default: return "bg-zinc-100 text-zinc-600";
  }
}

/** Deterministic frequency table over a fixed seed lattice. */
function computeRarityTable(): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < RARITY_SAMPLES; i += 1) {
    // Fixed lattice (not RNG) so the table is byte-identical across machines.
    const seed = (i * 2654435761) >>> 0;
    const name = classifyPersonaExtended(seedToGenome(seed)).name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

const DOMAIN_NAMES = Object.keys(DOMAIN_PACKS);

export function InnovationPersonaPanel() {
  const [seed, setSeed] = useState<number>(() => newInnovationSeed());
  const [pinned, setPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [problem, setProblem] = useState("");
  const [domainOverride, setDomainOverride] = useState<string>("");

  const rarityTable = useMemo(computeRarityTable, []);

  const genomeValues = useMemo(() => seedToGenome(seed), [seed]);
  const persona = useMemo(() => classifyPersonaExtended(genomeValues), [genomeValues]);
  const path = useMemo(() => selectPathExtended(genomeValues), [genomeValues]);

  const domain = useMemo(() => domainOverride || inferInnovationDomain(problem || "general problem"), [problem, domainOverride]);

  const compiled: InnovationGenomeV2 | null = useMemo(() => {
    try {
      return rollV2({
        seed,
        userProblem: problem || "[INSERT PROBLEM HERE]",
        domain,
      });
    } catch {
      return null;
    }
  }, [seed, problem, domain]);

  const rarityPercent = useMemo(() => {
    const hits = rarityTable.get(persona.name) ?? 0;
    return Math.round((hits / RARITY_SAMPLES) * 1000) / 10;
  }, [rarityTable, persona.name]);

  const tier = tierFor(rarityPercent);

  const directive = useMemo(() => {
    if (!compiled) return "";
    try {
      return compileCompactDirectiveV2(compiled);
    } catch {
      return "";
    }
  }, [compiled]);

  function reroll() {
    if (pinned) return;
    setSeed(newInnovationSeed());
  }

  function applyManualSeed(next: number) {
    setSeed(next >>> 0);
  }

  const pathSeq = (path as unknown as { seq?: string; sequence?: string }).seq
    ?? (path as unknown as { sequence?: string }).sequence
    ?? "";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-100 to-amber-100 text-lg">🧬</div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-bold text-zinc-900">
                Innovation Persona: <span className="text-fuchsia-700">{persona.name}</span>
              </div>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tierClass(tier)}`}>
                {tier} ({rarityPercent}%)
              </span>
            </div>
            <div className="text-xs text-zinc-500">{persona.tagline}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-zinc-100 px-2 py-1 font-mono text-[10px] text-zinc-600">seed {seed}</span>
          <span className="text-zinc-400">{expanded ? "−" : "+"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={reroll}
              disabled={pinned}
              className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-fuchsia-700 disabled:opacity-40"
            >
              Reroll persona
            </button>
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              Pin seed
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              Custom seed:
              <input
                type="number"
                value={seed}
                onChange={(e) => applyManualSeed(Number(e.target.value) >>> 0)}
                className="w-28 rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
              />
            </label>
            <button
              onClick={() => navigator.clipboard.writeText(String(seed))}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
              title="Export this genome by copying its seed"
            >
              Export
            </button>
            <label className="flex items-center gap-1 text-xs text-zinc-500">
              Domain:
              <select
                value={domainOverride}
                onChange={(e) => setDomainOverride(e.target.value)}
                className="rounded border border-zinc-300 bg-white px-1 py-1 text-xs"
              >
                <option value="">auto-detect</option>
                {DOMAIN_NAMES.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("veritas:open-innovation-genome"))}
              className="rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-1.5 text-xs font-bold text-fuchsia-700 hover:bg-fuchsia-100"
              title="Open the full 25-archetype Innovation Genome Guide"
            >
              Guide
            </button>
          </div>

          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Discovery path</div>
              <div className="mt-1 text-xs font-bold text-zinc-900">{path.id} · {path.name}</div>
              <div className="mt-0.5 font-mono text-[10px] text-zinc-500">{pathSeq}</div>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Domain pack</div>
              <div className="mt-1 text-xs font-bold text-zinc-900">{compiled?.domainPack.name ?? domain}</div>
              <div className="mt-0.5 text-[10px] text-zinc-500">
                {compiled?.safetyGate.isHighStakes() ? "High-stakes gate ACTIVE" : "Standard risk"}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Rarity basis</div>
              <div className="mt-1 font-mono text-xs text-zinc-900">
                {rarityTable.get(persona.name) ?? 0}/{RARITY_SAMPLES} seeds
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-500">Measured on a fixed seed lattice</div>
            </div>
          </div>

          <label className="mb-4 block text-xs text-zinc-500">
            Problem context (steers domain pack inference):
            <input
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              placeholder="e.g. prove a bound, design a catalyst, debug a race condition"
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-xs"
            />
          </label>

          <div className="mb-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
              {DIMENSIONS.length} innovation dimensions
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DIMENSIONS.map((dim) => {
              const value = genomeValues[dim.id] ?? 0;
              return (
                <div key={dim.id} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-zinc-900">{dim.name}</div>
                    <div className="rounded bg-fuchsia-50 px-1.5 py-0.5 font-mono text-[9px] text-fuchsia-700">{dim.block}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="w-16 text-right text-[9px] leading-tight text-zinc-500">{dim.lowPole}</span>
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-amber-500 to-fuchsia-500"
                        style={{ width: `${value * 100}%` }}
                      />
                      <div
                        className="absolute top-[-2px] h-3 w-1 rounded-full bg-zinc-900"
                        style={{ left: `calc(${value * 100}% - 2px)` }}
                      />
                    </div>
                    <span className="w-16 text-[9px] leading-tight text-zinc-500">{dim.highPole}</span>
                  </div>
                  <div className="mt-1 text-right font-mono text-[10px] text-zinc-400">{value.toFixed(2)}</div>
                </div>
              );
            })}
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-bold text-zinc-600 hover:text-zinc-900">
              View generated innovation directive
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs leading-relaxed text-zinc-800">
              {directive || "(directive unavailable)"}
            </pre>
          </details>

          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-bold text-zinc-600 hover:text-zinc-900">
              View full compiled v2 prompt
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs leading-relaxed text-zinc-800">
              {compiled?.prompt ?? "(prompt unavailable)"}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}
