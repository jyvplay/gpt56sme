/**
 * InnovationPersonaGuide — full-screen guide matching the Williams Persona Guide
 * vibe (grid of archetypes + detail panel + side-by-side comparison), driven by
 * the real Innovation Genome v1+v2 persona tables (25 total).
 *
 * Also exposes a seed roller identical in spirit to StylePersonaPanel: roll a
 * random seed → seedToGenome → classifyPersonaExtended → the resulting persona
 * is selected in the guide and can be pinned.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { seedToGenome } from "@/lib/innovation-genome-engine";
import {
  EXTENDED_PERSONAS,
  classifyPersonaExtended,
  newInnovationSeed,
  selectPathExtended,
} from "@/lib/innovation-genome-engine-v2";
import { PERSONAS as BASE_PERSONAS } from "@/lib/innovation-genome-engine";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface GuidePersona {
  name: string;
  tagline: string;
  source: "v1" | "v2-extended";
}

function buildGuideRoster(): GuidePersona[] {
  const seen = new Set<string>();
  const out: GuidePersona[] = [];

  // Extended (v2) first — these are the distinctive "thinking" archetypes.
  for (const p of EXTENDED_PERSONAS) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push({ name: p.name, tagline: p.tagline, source: "v2-extended" });
  }
  // Then v1 base personas that aren't already covered.
  for (const p of BASE_PERSONAS) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push({ name: p.name, tagline: p.tagline, source: "v1" });
  }
  return out;
}

const SHARED_IDEA =
  "A city should replace diesel buses with electric buses over five years to cut operating costs, reduce street-level pollution, and improve service reliability.";

function transformForPersona(name: string, tagline: string): string {
  // Deterministic, persona-flavoured 50-100 word reframing of SHARED_IDEA.
  // Not an LLM call — a structured template keyed on the persona name so the
  // side-by-side comparison is stable and inspectable.
  const lower = name.toLowerCase();
  if (lower.includes("anomaly")) {
    return `ANOMALY FOCUS: Why do 12% of winter routes experience 40% higher battery degradation than summer routes? RECOMMENDATION: Reframe five-year fleet replacement around battery thermal management on high-idle winter corridors. KEY ANOMALY: Cold-weather battery heating draws unbudgeted peak kilowatts. RISK: Unmonitored degradation cascades into route failures by Year 3.`;
  }
  if (lower.includes("axiom") || lower.includes("diagonal")) {
    return `AXIOM CHALLENGE: We assume the city must BUY buses and CHARGE them at central depots. REFRAMED SOLUTION: Procure "Bus-as-a-Service" with battery swapping at route termini. Eliminates bulk upfront depot charging CAPEX, shifts battery degradation risk to vendor, and reduces 5-year transition timeline to 2.5 years.`;
  }
  if (lower.includes("dormancy") || lower.includes("reduction")) {
    return `IMPORT: Battery-swap networks already operate at scale in heavy industry and mining. Apply the same modular-pack logistics to transit: standardized packs, route-end swap stations, and a circulating inventory. The "new" product is a logistics system, not a vehicle — and most of its components already exist.`;
  }
  if (lower.includes("reality") || lower.includes("failure")) {
    return `WORLD CONTACT: Pilot one high-ridership winter route for 18 months before any fleet commitment. Instrument pack temperature, kWh/km, depot queue draw, and mean-time-between-failure. Only expand if measured TCO beats diesel by ≥12% with 95% service uptime. Dead ends map the live ones.`;
  }
  if (lower.includes("portfolio") || lower.includes("serendipity")) {
    return `EIGHT BETS: (1) depot overnight charge, (2) on-route opportunity charge, (3) battery swap, (4) hydrogen fuel-cell, (5) hybrid diesel-electric bridge, (6) Bus-as-a-Service contract, (7) route redesign reducing fleet size, (8) microtransit substitution on low-density legs. Fund three for 24 months; kill five with pre-registered stop rules.`;
  }
  return `${tagline} Applied to the baseline: treat the five-year diesel-to-electric transition as a discovery problem first. Surface the hidden assumptions (depot capacity, winter range, battery replacement cost), force cheap falsification on the hardest route, and only then commit capital. Protect the heretical options until the data kills them.`;
}

export function InnovationPersonaGuide({ open, onClose }: Props) {
  const roster = useMemo(buildGuideRoster, []);
  const [selected, setSelected] = useState<string>(roster[0]?.name ?? "");
  const [compareA, setCompareA] = useState<string>(roster[0]?.name ?? "");
  const [compareB, setCompareB] = useState<string>(roster[1]?.name ?? roster[0]?.name ?? "");
  const [seed, setSeed] = useState<number>(() => newInnovationSeed());
  const [pinned, setPinned] = useState(false);

  // Seed → persona binding (same mechanism as StylePersonaPanel reroll).
  const rolled = useMemo(() => {
    const genome = seedToGenome(seed);
    const persona = classifyPersonaExtended(genome);
    const path = selectPathExtended(genome);
    return { genome, persona, path };
  }, [seed]);

  // Keep the selected card in sync with the rolled persona when seed changes.
  useEffect(() => {
    if (!open) return;
    setSelected(rolled.persona.name);
  }, [rolled.persona.name, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = roster.find((p) => p.name === selected) ?? roster[0];
  const transform = current ? transformForPersona(current.name, current.tagline) : "";
  const transformA = transformForPersona(
    compareA,
    roster.find((p) => p.name === compareA)?.tagline ?? "",
  );
  const transformB = transformForPersona(
    compareB,
    roster.find((p) => p.name === compareB)?.tagline ?? "",
  );

  const reroll = () => {
    if (pinned) return;
    setSeed(newInnovationSeed());
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="my-4 flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — clones Williams Persona Guide header style */}
        <div className="flex-none border-b border-zinc-200 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-zinc-900">
                💡 Innovation Genome Guide — Thinking Personas
              </h2>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                {roster.length} Emergent Archetypes · Controls Thinking Direction &amp; Strategic
                Reframing · Paired with Williams Writing Style
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
            >
              Close
            </button>
          </div>

          {/* Banner */}
          <div className="mt-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-bold text-amber-900">
                INNOVATION ENGINE V2 · 21-Axis Strategic Reframing &amp; Problem Decomposition
              </div>
              <div className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                {roster.length} active archetypes
              </div>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
              Innovation Personas dictate <b>how the model thinks, searches, and decomposes</b>{" "}
              problems (e.g. anomaly pursuit, axiom inversion, cross-domain transfer), while
              Williams Personas dictate <b>how the output is written</b> (prose cadence, structure,
              and tone). Both run in parallel.
            </p>
          </div>

          {/* Seed roller — same controls as StylePersonaPanel */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Seed roller
            </div>
            <span className="rounded bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 border border-zinc-200">
              seed {seed}
            </span>
            <span className="text-[11px] font-bold text-fuchsia-700">{rolled.persona.name}</span>
            <span className="text-[10px] text-zinc-500">· {rolled.path.id} {rolled.path.name}</span>
            <button
              onClick={reroll}
              disabled={pinned}
              className="rounded-lg bg-fuchsia-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-fuchsia-700 disabled:opacity-40"
            >
              Reroll persona
            </button>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-600">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              Pin seed
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              Custom:
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) >>> 0)}
                className="w-28 rounded border border-zinc-300 px-2 py-0.5 font-mono text-[11px]"
              />
            </label>
            <button
              onClick={() => navigator.clipboard.writeText(String(seed))}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-50"
            >
              Export
            </button>
          </div>
        </div>

        {/* Body — two columns */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: archetype menu */}
          <div className="w-[48%] flex-none overflow-y-auto border-r border-zinc-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                Innovation Archetype Menu
              </div>
              <div className="text-[10px] text-zinc-400">{roster.length} available</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {roster.map((p) => {
                const active = p.name === selected;
                return (
                  <button
                    key={p.name}
                    onClick={() => setSelected(p.name)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? "border-amber-400 bg-amber-50 shadow-sm"
                        : "border-zinc-200 bg-white hover:border-amber-200 hover:bg-amber-50/40"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                        Thinking
                      </span>
                      {p.source === "v2-extended" && (
                        <span className="rounded bg-fuchsia-100 px-1 py-0.5 text-[8px] font-bold text-fuchsia-700">
                          v2
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[12px] font-bold text-zinc-900">{p.name}</div>
                    <div className="mt-0.5 text-[10px] leading-snug text-zinc-500">{p.tagline}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: detail + comparison */}
          <div className="flex-1 overflow-y-auto p-5">
            {current && (
              <>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                  Innovation Persona Guide
                </div>
                <h3 className="mt-1 text-2xl font-bold text-zinc-900">{current.name}</h3>
                <p className="mt-0.5 text-[13px] italic text-zinc-600">"{current.tagline}"</p>

                <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Standard Baseline Problem
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-zinc-800">{SHARED_IDEA}</p>
                </div>

                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                      50–100 Word Strategic Reframing
                    </div>
                    <div className="text-[9px] text-amber-700">persona-specific decomposition</div>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-zinc-800">{transform}</p>
                </div>

                {/* Side-by-side */}
                <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/30 p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-800">
                    Side-by-Side Comparison
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="text-[11px] font-semibold text-zinc-600">
                      A
                      <select
                        value={compareA}
                        onChange={(e) => setCompareA(e.target.value)}
                        className="ml-1 rounded border border-zinc-300 bg-white px-2 py-1 text-[11px]"
                      >
                        {roster.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] font-semibold text-zinc-600">
                      B
                      <select
                        value={compareB}
                        onChange={(e) => setCompareB(e.target.value)}
                        className="ml-1 rounded border border-zinc-300 bg-white px-2 py-1 text-[11px]"
                      >
                        {roster.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-3 text-[11px] text-zinc-600">
                    <b>Baseline Problem:</b> "{SHARED_IDEA}"
                  </div>

                  <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3">
                    <div className="text-[11px] font-bold text-amber-800">## A: {compareA}</div>
                    <div className="mt-0.5 text-[10px] italic text-zinc-500">
                      "{roster.find((p) => p.name === compareA)?.tagline}"
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-800">{transformA}</p>
                  </div>

                  <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-3">
                    <div className="text-[11px] font-bold text-indigo-800">## B: {compareB}</div>
                    <div className="mt-0.5 text-[10px] italic text-zinc-500">
                      "{roster.find((p) => p.name === compareB)?.tagline}"
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-800">{transformB}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
