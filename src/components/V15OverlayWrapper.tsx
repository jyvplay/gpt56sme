/**
 * V15OverlayWrapper — unified left rail (V15 + P + c).
 * ============================================================================
 * Spacing fix: previously V15 lived in its own `fixed top-1/2 -translate-y-1/2`
 * container and P/c lived in a SECOND fixed container with a hard-coded
 * translateY(96px). That made the gap between V15 and P uneven (too large when
 * V15 is collapsed, sometimes overlapping when expanded).
 *
 * Fix: one outer column at the same anchor as the package V15 overlay. The
 * package V15 overlay is still rendered (so Calibrate/Guide/Titanium/SearXNG
 * and V15CalibrationAugment keep working), but we measure its pill height with
 * a ResizeObserver and offset P/c to sit exactly `GAP` px below it. No hard-coded
 * magic number that drifts with expand/collapse.
 *
 * Rigor Guard hide: when the calibration dialog is open (detected via its unique
 * <h2> text), P and c unmount entirely so they cannot show through the
 * translucent backdrop.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { V15Overlay as PackageV15Overlay } from "./V15Overlay.orig";
import { InnovationGenomeEngine } from "@/components/InnovationGenomeEngine";
import { InnovationPersonaGuide } from "@/components/InnovationPersonaGuide";
import { CreativeTreeLifePage } from "@/components/CreativeTreeLifePage";
import {
  subscribeCitationLedger,
  type CitationLedgerSnapshotLive,
} from "@/lib/citation-ledger-store";
import type { InnovationGenomeV2 } from "@/lib/innovation-genome-engine-v2";

const PERSONAS_EVENT = "veritas:open-personas";
const INNOVATION_PERSONAS_EVENT = "veritas:open-innovation-personas";

/** Shared pill chrome — identical to the packaged V15 overlay container. */
const PILL = "rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur";
/** Shared collapsed glyph — identical footprint to the packaged V15 badge. */
const GLYPH = "grid h-5 w-5 place-items-center rounded-md text-[10px] font-bold text-white";
/** Uniform gap between V15, P, and c pills (px). Matches package gap-2 = 8px. */
const RAIL_GAP_PX = 8;

const EMPTY_LEDGER: CitationLedgerSnapshotLive = {
  records: [],
  siteCount: 0,
  lastQuestion: "",
  updatedAt: 0,
};

export function V15OverlayWrapper() {
  const [genomeEngineOpen, setGenomeEngineOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [citationOpen, setCitationOpen] = useState(false);
  const [innovationGuideOpen, setInnovationGuideOpen] = useState(false);
  const [treeOfLifeOpen, setTreeOfLifeOpen] = useState(false);
  const [ledger, setLedger] = useState<CitationLedgerSnapshotLive>(EMPTY_LEDGER);
  const [rigorGuardOpen, setRigorGuardOpen] = useState(false);
  /** Distance from the top of the outer rail to the bottom of the V15 pill. */
  const [v15BottomPx, setV15BottomPx] = useState(40);
  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeCitationLedger(setLedger), []);

  // Detect Rigor Guard Calibration dialog (package-owned, translucent backdrop).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const DIALOG_HEADING = "Rigor Guard Calibration — Live";
    const check = () => {
      const headings = Array.from(document.querySelectorAll("h2"));
      const open = headings.some((h) => (h.textContent || "").trim() === DIALOG_HEADING);
      setRigorGuardOpen((prev) => (prev === open ? prev : open));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(check, 400);
    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  // Measure the package V15 pill so P/c sit exactly RAIL_GAP_PX below it.
  // The package V15Overlay is a sibling fixed element; we locate it by its
  // unique "V15" badge text and the fixed left-2 top-1/2 positioning.
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;

    const findV15Pill = (): HTMLElement | null => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>("div.fixed.left-2"),
      );
      for (const el of candidates) {
        // Skip our own rail
        if (el === railRef.current) continue;
        if (el.textContent?.includes("V15") && el.className.includes("top-1/2")) {
          // The inner pill is the first child with rounded-2xl
          const pill = el.querySelector<HTMLElement>("div.rounded-2xl");
          return pill ?? el;
        }
      }
      return null;
    };

    let ro: ResizeObserver | null = null;
    let observed: HTMLElement | null = null;

    const measure = () => {
      const pill = findV15Pill();
      if (!pill) return;
      const h = pill.getBoundingClientRect().height;
      // When the package container is centered with -translate-y-1/2, the pill
      // extends h/2 above and below the 50% line. Our rail is ALSO centered at
      // 50% with -translate-y-1/2. To place P at (pill bottom + GAP) relative to
      // the rail's top edge (which is at 50% - railHeight/2), we use a simpler
      // approach: position P/c with marginTop = h + GAP, and don't center the
      // P/c group independently. See render below.
      setV15BottomPx((prev) => (Math.abs(prev - h) < 0.5 ? prev : h));

      if (observed !== pill) {
        ro?.disconnect();
        observed = pill;
        ro = new ResizeObserver(measure);
        ro.observe(pill);
      }
    };

    measure();
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    const interval = window.setInterval(measure, 500);

    return () => {
      mo.disconnect();
      ro?.disconnect();
      window.clearInterval(interval);
    };
  }, [personaOpen, citationOpen, rigorGuardOpen]);

  // Listen for Innovation Personas guide open event
  useEffect(() => {
    const onOpen = () => setInnovationGuideOpen(true);
    window.addEventListener(INNOVATION_PERSONAS_EVENT, onOpen);
    return () => window.removeEventListener(INNOVATION_PERSONAS_EVENT, onOpen);
  }, []);

  const handleUseInV15 = (genome: InnovationGenomeV2) => {
    if (typeof window !== "undefined") {
      (window as any)._VERITAS_ACTIVE_INNOVATION_GENOME = genome;
      (window as any)._VERITAS_INNOVATION_GENOME_V2 = genome;
    }
    window.dispatchEvent(new CustomEvent("veritas:genome-updated", { detail: genome }));
  };

  const fire = (name: string) => window.dispatchEvent(new CustomEvent(name));

  // Offset of the P/c stack from the vertical centre of the viewport:
  // package V15 is centered, so its bottom edge is at +v15BottomPx/2 from centre.
  // We want P to start RAIL_GAP_PX below that bottom edge.
  // Our P/c wrapper is NOT translate-centered; it uses top: calc(50% + offset).
  const pcTopOffset = v15BottomPx / 2 + RAIL_GAP_PX;

  return (
    <>
      {/* Packaged overlay — owns V15 pill + Calibrate dialog + Augment modals. */}
      <PackageV15Overlay />

      {/* P + c rail: same left edge, dynamically parked just under V15. */}
      {!rigorGuardOpen && (
        <div
          ref={railRef}
          className="fixed left-2 z-[9997] flex flex-col items-start"
          style={{
            top: `calc(50% + ${pcTopOffset}px)`,
            gap: `${RAIL_GAP_PX}px`,
            pointerEvents: "none",
          }}
        >
          {/* ── P — Personas hub ─────────────────────────────────────────── */}
          <div className={PILL} style={{ pointerEvents: "auto" }}>
            {!personaOpen ? (
              <button
                onClick={() => setPersonaOpen(true)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-violet-700 hover:text-violet-900"
                title="Personas — Williams style, Innovation Genome, and both guides"
              >
                <span className={`${GLYPH} bg-violet-600`}>P</span>
                <span>▲</span>
              </button>
            ) : (
              <div className="w-[300px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`${GLYPH} bg-violet-600`}>P</span>
                    <span className="text-[11px] font-bold text-zinc-700">Personas</span>
                  </div>
                  <button
                    onClick={() => setPersonaOpen(false)}
                    className="rounded-lg border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-500 hover:bg-zinc-100"
                  >
                    ▼
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => fire(PERSONAS_EVENT)}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-800 hover:bg-rose-100"
                  >
                    🎨 Style Guide
                  </button>
                  <button
                    onClick={() => setInnovationGuideOpen(true)}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
                  >
                    💡 Innovation Guide
                  </button>
                  <button
                    onClick={() => setGenomeEngineOpen(true)}
                    className="rounded-lg border border-fuchsia-300 bg-fuchsia-50 px-2 py-1 text-[11px] font-bold text-fuchsia-800 hover:bg-fuchsia-100"
                  >
                    🧬 Genome
                  </button>
                  <button
                    onClick={() => setTreeOfLifeOpen(true)}
                    className="rounded-lg border border-lime-300 bg-lime-50 px-2 py-1 text-[11px] font-bold text-lime-800 hover:bg-lime-100"
                  >
                    🌳 Tree of Life
                  </button>
                </div>

                <button
                  onClick={() => fire(PERSONAS_EVENT)}
                  className="mt-2 w-full rounded-lg bg-gradient-to-r from-violet-700 to-violet-600 px-2.5 py-1.5 text-left text-[11px] font-bold text-white hover:from-violet-800 hover:to-violet-700"
                >
                  ✍️ Williams Persona
                  <div className="mt-0.5 text-[9px] font-normal text-violet-100">
                    Prose style · how the answer is WRITTEN
                  </div>
                </button>

                <button
                  onClick={() => setInnovationGuideOpen(true)}
                  className="mt-1.5 w-full rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 px-2.5 py-1.5 text-left text-[11px] font-bold text-white hover:from-amber-700 hover:to-orange-700"
                >
                  💡 Innovation Personas
                  <div className="mt-0.5 text-[9px] font-normal text-amber-100">
                    Thinking direction · how the problem is SEARCHED &amp; REFRAMED
                  </div>
                </button>

                <div className="mt-1.5 text-[9px] leading-tight text-zinc-400">
                  Dual-persona architecture · both prompts run in parallel
                </div>
              </div>
            )}
          </div>

          {/* ── c — Citation Ledger ──────────────────────────────────────── */}
          <div className={PILL} style={{ pointerEvents: "auto" }}>
            {!citationOpen ? (
              <button
                onClick={() => setCitationOpen(true)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-sky-700 hover:text-sky-900"
                title={`Citation Ledger — ${ledger.records.length} verified-retrieved source(s)`}
              >
                <span className={`${GLYPH} bg-sky-600`}>c</span>
                <span>▲</span>
                {ledger.records.length > 0 && (
                  <span className="rounded bg-sky-100 px-1 font-mono text-[9px] text-sky-800">
                    {ledger.records.length}
                  </span>
                )}
              </button>
            ) : (
              <div className="w-[300px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`${GLYPH} bg-sky-600`}>c</span>
                    <span className="text-[11px] font-bold text-zinc-700">
                      Citation Ledger ({ledger.records.length} source
                      {ledger.records.length === 1 ? "" : "s"})
                    </span>
                  </div>
                  <button
                    onClick={() => setCitationOpen(false)}
                    className="rounded-lg border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-500 hover:bg-zinc-100"
                  >
                    ▼
                  </button>
                </div>

                {ledger.records.length === 0 ? (
                  <div className="mt-2 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-2 text-[10px] leading-tight text-zinc-500">
                    No sources retrieved yet. Every document the grounding fleet
                    actually fetches is recorded here with its site, title and
                    first-use stage.
                  </div>
                ) : (
                  <>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-600">
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-sky-800">
                        {ledger.siteCount} site{ledger.siteCount === 1 ? "" : "s"}
                      </span>
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-emerald-800">
                        {ledger.records.filter((r) => r.snippet.length > 0).length} quotable
                      </span>
                    </div>
                    <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto">
                      {ledger.records.map((record) => (
                        <a
                          key={record.id}
                          href={record.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-lg border border-zinc-100 bg-zinc-50 px-2 py-1.5 hover:bg-zinc-100"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-bold text-zinc-700">
                              [S{record.id}]
                            </span>
                            <span className="rounded bg-white px-1 font-mono text-[9px] text-zinc-500">
                              {record.stage}
                            </span>
                          </div>
                          <div
                            className="truncate text-[10px] font-semibold text-zinc-800"
                            title={record.title}
                          >
                            {record.title}
                          </div>
                          <div className="truncate text-[9px] text-sky-700">{record.site}</div>
                        </a>
                      ))}
                    </div>
                  </>
                )}
                <div className="mt-1.5 text-[9px] leading-tight text-zinc-400">
                  Full table with metrics sits under Style Persona in the Chat page.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <InnovationGenomeEngine
        open={genomeEngineOpen}
        onClose={() => setGenomeEngineOpen(false)}
        onUseInV15={handleUseInV15}
      />

      <InnovationPersonaGuide
        open={innovationGuideOpen}
        onClose={() => setInnovationGuideOpen(false)}
      />

      {treeOfLifeOpen && (
        <CreativeTreeLifePage
          onClose={() => setTreeOfLifeOpen(false)}
        />
      )}
    </>
  );
}
