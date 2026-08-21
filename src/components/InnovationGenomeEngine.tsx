/**
 * Innovation Genome Engine v2.0 — Modal UI
 * ============================================================================
 * Deterministic mutation, crossover, safety/capability gates, and domain packs.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  DIMENSIONS,
  classifyPersonaExtended,
  selectPathExtended,
  DOMAIN_PACKS,
  rollV2,
  applyMutation,
  crossoverUniform,
  crossoverBlock,
  CapabilityGate,
  type InnovationGenomeV2,
  type RiskTier,
  type MutationKind,
  type CrossoverKind,
} from "@/lib/innovation-genome-engine-v2";
import { seedToGenome, type Genome } from "@/lib/innovation-genome-engine";
import {
  runInnovationGenomeV3Demo,
  runInnovationGenomeV3Diagnostics,
  type V3Report,
  type DiagnosticCheck,
} from "@/lib/innovation-genome-v3";
import {
  runInnovationGenomeV4Demo,
  runInnovationGenomeV4Diagnostics,
  type V4Report,
  type DiagnosticCheck as V4DiagnosticCheck,
} from "@/lib/innovation-genome-v4";
import {
  runInnovationGenomeV57Diagnostics,
  compatibilityAuditV7,
  type DiagnosticCheck as V57DiagnosticCheck,
} from "@/lib/innovation-genome-v7";
import {
  runInnovationGenomeV8Diagnostics,
  compatibilityAuditV8,
  type DiagnosticCheck as V8DiagnosticCheck,
} from "@/lib/innovation-genome-v8";
import {
  runInnovationGenomeV9Diagnostics,
  compatibilityAuditV9,
  type DiagnosticCheck as V9DiagnosticCheck,
} from "@/lib/innovation-genome-v9";
import { runInnovationGenomeV10Diagnostics } from "@/lib/innovation-genome-v10";

interface Props {
  open: boolean;
  onClose: () => void;
  onUseInV15?: (genome: InnovationGenomeV2) => void;
}

export function InnovationGenomeEngine({ open, onClose, onUseInV15 }: Props) {
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 0xffffffff));
  const [problem, setProblem] = useState<string>("");
  const [domain, setDomain] = useState<string>("general");
  const [risk, setRisk] = useState<RiskTier>("medium");
  const [genome, setGenome] = useState<InnovationGenomeV2 | null>(null);
  const [compiledPrompt, setCompiledPrompt] = useState<string>("");
  const [mutateKind, setMutateKind] = useState<MutationKind>("nudge");
  const [mutateOpIdx, setMutateOpIdx] = useState<number>(0);
  const [crossKind, setCrossKind] = useState<CrossoverKind>("block");
  const [crossSeed, setCrossSeed] = useState<number>(42);

  const [capWeb, setCapWeb] = useState(false);
  const [capVerifier, setCapVerifier] = useState(false);
  const [capFormal, setCapFormal] = useState(false);
  const [capSandbox, setCapSandbox] = useState(false);

  // Innovation Genome Engine V3.0 — verified discovery runtime (see
  // @/lib/innovation-genome-v3.ts). Additive tab alongside the v2 compiler;
  // nothing above this block is touched.
  const [v3Running, setV3Running] = useState(false);
  const [v3Report, setV3Report] = useState<V3Report | null>(null);
  const [v3Error, setV3Error] = useState<string>("");
  const [v3Diagnostics, setV3Diagnostics] = useState<{ ok: boolean; checks: DiagnosticCheck[] } | null>(null);

  // V4 — Evidence-Governed Discovery Plane (additive over V3)
  const [v4Running, setV4Running] = useState(false);
  const [v4Report, setV4Report] = useState<V4Report | null>(null);
  const [v4Error, setV4Error] = useState<string>("");
  const [v4Diagnostics, setV4Diagnostics] = useState<{ ok: boolean; checks: V4DiagnosticCheck[] } | null>(null);

  const runV3 = async () => {
    setV3Running(true);
    setV3Error("");
    try {
      const report = await runInnovationGenomeV3Demo({
        problem: problem || "Explore the problem space",
        domain,
        seed,
      });
      setV3Report(report);
    } catch (err) {
      setV3Error(err instanceof Error ? err.message : String(err));
    } finally {
      setV3Running(false);
    }
  };

  const runV3Diag = async () => {
    setV3Running(true);
    setV3Error("");
    try {
      setV3Diagnostics(await runInnovationGenomeV3Diagnostics());
    } catch (err) {
      setV3Error(err instanceof Error ? err.message : String(err));
    } finally {
      setV3Running(false);
    }
  };

  const runV4 = async () => {
    setV4Running(true);
    setV4Error("");
    try {
      const report = await runInnovationGenomeV4Demo({
        problem: problem || "Produce an evidence-bound artifact.",
        domain,
        seed,
      });
      setV4Report(report);
    } catch (err) {
      setV4Error(err instanceof Error ? err.message : String(err));
    } finally {
      setV4Running(false);
    }
  };

  const runV4Diag = async () => {
    setV4Running(true);
    setV4Error("");
    try {
      setV4Diagnostics(await runInnovationGenomeV4Diagnostics());
    } catch (err) {
      setV4Error(err instanceof Error ? err.message : String(err));
    } finally {
      setV4Running(false);
    }
  };

  // V5 (Production Assurance) + V7 (Production Reliability)
  const [v57Running, setV57Running] = useState(false);
  const [v57Error, setV57Error] = useState<string>("");
  const [v57Diagnostics, setV57Diagnostics] = useState<{ ok: boolean; checks: V57DiagnosticCheck[] } | null>(null);
  const [v7Audit, setV7Audit] = useState<Record<string, unknown> | null>(null);

  const runV57Diag = async () => {
    setV57Running(true);
    setV57Error("");
    try {
      setV57Diagnostics(await runInnovationGenomeV57Diagnostics());
      setV7Audit(compatibilityAuditV7());
    } catch (err) {
      setV57Error(err instanceof Error ? err.message : String(err));
    } finally {
      setV57Running(false);
    }
  };

  // V8 (Alpha RC1 Control Plane)
  const [v8Running, setV8Running] = useState(false);
  const [v8Error, setV8Error] = useState<string>("");
  const [v8Diagnostics, setV8Diagnostics] = useState<{ ok: boolean; checks: V8DiagnosticCheck[] } | null>(null);
  const [v8Audit, setV8Audit] = useState<Record<string, unknown> | null>(null);

  const runV8Diag = async () => {
    setV8Running(true);
    setV8Error("");
    try {
      setV8Diagnostics(await runInnovationGenomeV8Diagnostics());
      setV8Audit(compatibilityAuditV8());
    } catch (err) {
      setV8Error(err instanceof Error ? err.message : String(err));
    } finally {
      setV8Running(false);
    }
  };

  // V9 (Compliance & Quality Plane)
  const [v9Running, setV9Running] = useState(false);
  const [v9Error, setV9Error] = useState("");
  const [v9Diagnostics, setV9Diagnostics] = useState<{ ok: boolean; checks: V9DiagnosticCheck[] } | null>(null);
  const [v9Audit, setV9Audit] = useState<Record<string, unknown> | null>(null);

  const runV9Diag = async () => {
    setV9Running(true);
    setV9Error("");
    try {
      setV9Diagnostics(await runInnovationGenomeV9Diagnostics());
      setV9Audit(compatibilityAuditV9());
    } catch (err) {
      setV9Error(err instanceof Error ? err.message : String(err));
    } finally {
      setV9Running(false);
    }
  };

  const [v10Running, setV10Running] = useState(false);
  const [v10Error, setV10Error] = useState("");
  const [v10Diagnostics, setV10Diagnostics] = useState<{ ok: boolean; checks: Array<{ id: string; passed: boolean; detail: string }> } | null>(null);

  const runV10Diag = async () => {
    setV10Running(true);
    setV10Error("");
    try {
      setV10Diagnostics(runInnovationGenomeV10Diagnostics());
    } catch (err) {
      setV10Error(err instanceof Error ? err.message : String(err));
    } finally {
      setV10Running(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const randomizeSeed = () => setSeed(Math.floor(Math.random() * 0xffffffff));

  const compileV2 = async () => {
    const g = await rollV2({
      seed,
      userProblem: problem || "Explore the problem space",
      domain,
      risk,
      capabilityGate: new CapabilityGate({
        runtimeSupportsParallelAgents: false,
        verifierAvailable: capVerifier,
        webRetrieval: capWeb,
        formalProver: capFormal,
        executionSandbox: capSandbox,
        declaredTools: [],
      }),
    });
    setGenome(g);
    setCompiledPrompt(g.prompt);
    if (typeof window !== "undefined") (window as any)._VERITAS_INNOVATION_GENOME_V2 = g;
  };

  const applyMutate = () => {
    if (!genome) return;
    const mutated = applyMutation(genome.genome, seed, mutateKind, mutateOpIdx);
    const newPersona = classifyPersonaExtended(mutated);
    const newPath = selectPathExtended(mutated);
    setGenome({ ...genome, genome: mutated, persona: newPersona, path: newPath });
  };

  const applyCross = () => {
    if (!genome) return;
    const other = seedToGenome(crossSeed);
    let crossed: Genome;
    if (crossKind === "uniform") crossed = crossoverUniform(genome.genome, other, seed);
    else if (crossKind === "block") crossed = crossoverBlock(genome.genome, other, seed);
    else crossed = other;
    const newPersona = classifyPersonaExtended(crossed);
    const newPath = selectPathExtended(crossed);
    setGenome({ ...genome, genome: crossed, persona: newPersona, path: newPath });
  };

  const copyPrompt = async () => {
    if (compiledPrompt) await navigator.clipboard.writeText(compiledPrompt);
  };

  const copyJSON = async () => {
    if (genome) await navigator.clipboard.writeText(JSON.stringify(genome, null, 2));
  };

  const useInV15 = () => {
    if (genome && onUseInV15) onUseInV15(genome);
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10003] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className="my-4 flex w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex-none border-b border-zinc-200 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-zinc-900"> Innovation Genome Engine v2.0</h2>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                Deterministic mutation, crossover, safety/capability gates, and domain packs. Prompt output is not proof of novelty.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={useInV15} className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-800 hover:bg-indigo-100">
                Use in V15
              </button>
              <button onClick={onClose} className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100">
                Close
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel — Controls */}
          <div className="w-80 flex-none overflow-y-auto border-r border-zinc-200 p-4 space-y-4">
            {/* Seed */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Seed</label>
              <div className="mt-1 flex gap-2">
                <input type="number" value={seed} onChange={(e) => setSeed(parseInt(e.target.value, 10) || 0)} className="w-full rounded border border-zinc-300 px-2 py-1 text-sm font-mono" />
                <button onClick={randomizeSeed} className="rounded bg-zinc-100 px-2 py-1 text-xs font-bold text-zinc-700 hover:bg-zinc-200">🎲</button>
              </div>
            </div>

            {/* Problem */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Problem</label>
              <textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={3} className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm" placeholder="Prove X, design Y, explore Z..." />
            </div>

            {/* Domain & Risk */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Domain</label>
                <select value={domain} onChange={(e) => setDomain(e.target.value)} className="mt-1 w-full rounded border border-zinc-300 px-1 py-1 text-xs">
                  {Object.keys(DOMAIN_PACKS).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Risk</label>
                <select value={risk} onChange={(e) => setRisk(e.target.value as RiskTier)} className="mt-1 w-full rounded border border-zinc-300 px-1 py-1 text-xs">
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </div>
            </div>

            {/* Compile Buttons */}
            <div className="flex gap-2">
              <button onClick={compileV2} className="flex-1 rounded-lg bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow hover:from-fuchsia-700 hover:to-indigo-700">
                Compile v2
              </button>
              <button onClick={randomizeSeed} className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-100">
                Random seed
              </button>
            </div>

            {/* Evolution Operators */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Evolution Operators</div>
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <select value={mutateKind} onChange={(e) => setMutateKind(e.target.value as MutationKind)} className="flex-1 rounded border border-zinc-300 px-1 py-1 text-xs">
                    <option value="nudge">nudge</option>
                    <option value="flip">flip</option>
                    <option value="block_rotate">block_rotate</option>
                    <option value="pole_swap">pole_swap</option>
                    <option value="dimension_mask">dimension_mask</option>
                  </select>
                  <input type="number" value={mutateOpIdx} onChange={(e) => setMutateOpIdx(parseInt(e.target.value, 10) || 0)} className="w-16 rounded border border-zinc-300 px-1 py-1 text-xs" placeholder="opIdx" />
                  <button onClick={applyMutate} className="rounded bg-fuchsia-600 px-2 py-1 text-xs font-bold text-white">Mutate</button>
                </div>
                <div className="flex gap-2">
                  <select value={crossKind} onChange={(e) => setCrossKind(e.target.value as CrossoverKind)} className="flex-1 rounded border border-zinc-300 px-1 py-1 text-xs">
                    <option value="uniform">uniform</option>
                    <option value="block">block</option>
                    <option value="pareto_weighted">pareto_weighted</option>
                  </select>
                  <input type="number" value={crossSeed} onChange={(e) => setCrossSeed(parseInt(e.target.value, 10) || 0)} placeholder="seed" className="w-16 rounded border border-zinc-300 px-1 py-1 text-xs" />
                  <button onClick={applyCross} className="rounded bg-indigo-600 px-2 py-1 text-xs font-bold text-white">Cross</button>
                </div>
              </div>
            </div>

            {/* Capability Reality Gate */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Capability Reality Gate</div>
              <div className="mt-2 space-y-1 text-[11px]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={capWeb} onChange={(e) => setCapWeb(e.target.checked)} /> webRetrieval</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={capVerifier} onChange={(e) => setCapVerifier(e.target.checked)} /> verifierAvailable</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={capFormal} onChange={(e) => setCapFormal(e.target.checked)} /> formalProver</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={capSandbox} onChange={(e) => setCapSandbox(e.target.checked)} /> executionSandbox</label>
              </div>
            </div>

            {/* Innovation Genome Engine V3.0 — verified discovery runtime */}
            <div className="rounded-xl border border-emerald-300 bg-emerald-50/40 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                V3.0 Verified Discovery Runtime
              </div>
              <div className="mt-1 text-[10px] leading-tight text-emerald-700">
                Goal/evaluator versioning · GEPA textual feedback · tamper-evident hash-chained event log ·
                versioned MAP-Elites archive · structural-diversity monitor
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={runV3}
                  disabled={v3Running}
                  className="flex-1 rounded-lg bg-emerald-700 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {v3Running ? "Running…" : "▶ Run V3 Epoch"}
                </button>
                <button
                  onClick={runV3Diag}
                  disabled={v3Running}
                  className="rounded-lg border border-emerald-300 bg-white px-2 py-1.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Diagnostics
                </button>
              </div>

              {v3Error && (
                <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-[10px] text-rose-800">
                  {v3Error}
                </div>
              )}

              {v3Diagnostics && (
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-2">
                  <div className={`text-[11px] font-bold ${v3Diagnostics.ok ? "text-emerald-700" : "text-rose-700"}`}>
                    {v3Diagnostics.ok ? "✓ ALL CHECKS PASS" : "✗ CHECKS FAILED"} ({v3Diagnostics.checks.filter((c) => c.passed).length}/{v3Diagnostics.checks.length})
                  </div>
                  <div className="mt-1 max-h-32 overflow-y-auto text-[9px] leading-tight">
                    {v3Diagnostics.checks.map((c) => (
                      <div key={c.id} className={c.passed ? "text-zinc-600" : "text-rose-700 font-bold"}>
                        {c.passed ? "✓" : "✗"} {c.id}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {v3Report && (
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-2 text-[10px]">
                  <div className="font-bold text-zinc-800">run {v3Report.run_id.slice(0, 12)}…</div>
                  <div className="mt-0.5 text-zinc-600">
                    seal: <span className={v3Report.tamper_evident_seal ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                      {v3Report.tamper_evident_seal ? "VERIFIED" : "CORRUPTED"}
                    </span>
                    {" · "}archive: {v3Report.archive_size}
                  </div>
                  {v3Report.best_candidate && (
                    <div className="mt-1 text-zinc-600">
                      best: {v3Report.best_candidate.id.slice(0, 12)}… · verified: {String(v3Report.best_candidate.verified)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* V4 — Evidence-Governed Discovery Plane */}
            <div className="rounded-xl border border-sky-300 bg-sky-50/40 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-sky-800">
                V4.0 Evidence-Governed Discovery
              </div>
              <div className="mt-1 text-[10px] leading-tight text-sky-700">
                Claim-level evidence closure · strict blinding · dev/val/audit tiers ·
                scoped HMAC grants · executable P/A/E/N/V/T/S stages · dual hash chains ·
                DSSE-shaped attestations
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={runV4}
                  disabled={v4Running}
                  className="flex-1 rounded-lg bg-sky-700 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-sky-800 disabled:opacity-50"
                >
                  {v4Running ? "Running…" : "▶ Run V4 Epoch"}
                </button>
                <button
                  onClick={runV4Diag}
                  disabled={v4Running}
                  className="rounded-lg border border-sky-300 bg-white px-2 py-1.5 text-[11px] font-bold text-sky-800 hover:bg-sky-50 disabled:opacity-50"
                >
                  Diagnostics
                </button>
              </div>

              {v4Error && (
                <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-[10px] text-rose-800">
                  {v4Error}
                </div>
              )}

              {v4Diagnostics && (
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-2">
                  <div className={`text-[11px] font-bold ${v4Diagnostics.ok ? "text-emerald-700" : "text-rose-700"}`}>
                    {v4Diagnostics.ok ? "✓ ALL CHECKS PASS" : "✗ CHECKS FAILED"} ({v4Diagnostics.checks.filter((c) => c.passed).length}/{v4Diagnostics.checks.length})
                  </div>
                  <div className="mt-1 max-h-32 overflow-y-auto text-[9px] leading-tight">
                    {v4Diagnostics.checks.map((c) => (
                      <div key={c.id} className={c.passed ? "text-zinc-600" : "text-rose-700 font-bold"}>
                        {c.passed ? "✓" : "✗"} {c.id}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {v4Report && (
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-2 text-[10px]">
                  <div className="font-bold text-zinc-800">run {v4Report.run_id.slice(0, 12)}…</div>
                  <div className="mt-0.5 text-zinc-600">
                    seal: <span className={v4Report.tamper_evident_seal ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                      {v4Report.tamper_evident_seal ? "VERIFIED" : "CORRUPTED"}
                    </span>
                    {" · "}semantic: <span className={v4Report.semantic_chain_valid ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                      {v4Report.semantic_chain_valid ? "VALID" : "INVALID"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-zinc-600">
                    audit_pass: {String(v4Report.audit.audit_pass)} · outcomes: {v4Report.outcomes.length}
                  </div>
                  {v4Report.outcomes[0] && (
                    <div className="mt-1 text-zinc-600">
                      top: {v4Report.outcomes[0].candidate_id.slice(0, 12)}… · tier: {v4Report.outcomes[0].highest_tier} ·
                      promoted: {String(v4Report.outcomes[0].promoted)} · closed: {String(v4Report.outcomes[0].evidence_closed)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* V5 + V7 — Production Assurance & Reliability Planes */}
            <div className="rounded-xl border border-violet-300 bg-violet-50/40 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-violet-800">
                V5 Assurance + V7 Reliability
              </div>
              <div className="mt-1 text-[10px] leading-tight text-violet-700">
                V5: policy-as-code · spans · canary taint · sealed suites · verifier protocol ·
                replay matrix · tool drift · SLO health · assurance gateway.
                <br />
                V7: checksummed migrations · WAL-reset guard · atomic units of work ·
                durable leased queue (fencing tokens, dead-letters) · redacted telemetry ·
                exact verifier closure · RFC 9162 Merkle proofs · verified backup · doctor.
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={runV57Diag}
                  disabled={v57Running}
                  className="flex-1 rounded-lg bg-violet-700 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-violet-800 disabled:opacity-50"
                >
                  {v57Running ? "Running…" : "▶ Run V5+V7 Diagnostics"}
                </button>
              </div>

              {v57Error && (
                <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-[10px] text-rose-800">
                  {v57Error}
                </div>
              )}

              {v57Diagnostics && (
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-2">
                  <div className={`text-[11px] font-bold ${v57Diagnostics.ok ? "text-emerald-700" : "text-rose-700"}`}>
                    {v57Diagnostics.ok ? "✓ ALL CHECKS PASS" : "✗ CHECKS FAILED"} ({v57Diagnostics.checks.filter((c) => c.passed).length}/{v57Diagnostics.checks.length})
                  </div>
                  <div className="mt-1 max-h-48 overflow-y-auto text-[9px] leading-tight">
                    {v57Diagnostics.checks.map((c) => (
                      <div key={c.id} className={c.passed ? "text-zinc-600" : "text-rose-700 font-bold"}>
                        {c.passed ? "✓" : "✗"} {c.id}
                        {!c.passed && <span className="ml-1 text-rose-500">— {c.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {v7Audit && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] font-bold text-violet-800">
                    V7 compatibility audit
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded border border-zinc-200 bg-white p-2 text-[9px] leading-tight text-zinc-700">
                    {JSON.stringify(v7Audit, null, 2)}
                  </pre>
                </details>
              )}
            </div>

            {/* V8 — Alpha RC1 Control Plane */}
            <div className="rounded-xl border border-rose-300 bg-rose-50/40 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-800">
                V8.0 Alpha RC1 Control Plane
              </div>
              <div className="mt-1 text-[10px] leading-tight text-rose-700">
                Multi-tenant namespaces · RBAC · recursive attenuation · kill switches ·
                untrusted data context isolation · prompt-injection quarantine ·
                transactional outbox / idempotent inbox · progressive releases ·
                Otel GenAI semantic attributes · Alpha RC1 readiness gate.
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={runV8Diag}
                  disabled={v8Running}
                  className="flex-1 rounded-lg bg-rose-700 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-rose-800 disabled:opacity-50"
                >
                  {v8Running ? "Running…" : "▶ Run V8 Diagnostics"}
                </button>
              </div>

              {v8Error && (
                <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-[10px] text-rose-800">
                  {v8Error}
                </div>
              )}

              {v8Diagnostics && (
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-2">
                  <div className={`text-[11px] font-bold ${v8Diagnostics.ok ? "text-emerald-700" : "text-rose-700"}`}>
                    {v8Diagnostics.ok ? "✓ ALL CHECKS PASS" : "✗ CHECKS FAILED"} ({v8Diagnostics.checks.filter((c) => c.passed).length}/{v8Diagnostics.checks.length})
                  </div>
                  <div className="mt-1 max-h-48 overflow-y-auto text-[9px] leading-tight">
                    {v8Diagnostics.checks.map((c) => (
                      <div key={c.id} className={c.passed ? "text-zinc-600" : "text-rose-700 font-bold"}>
                        {c.passed ? "✓" : "✗"} {c.id}
                        {!c.passed && <span className="ml-1 text-rose-500">— {c.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {v8Audit && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] font-bold text-rose-800">
                    V8 compatibility audit
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded border border-zinc-200 bg-white p-2 text-[9px] leading-tight text-zinc-700">
                    {JSON.stringify(v8Audit, null, 2)}
                  </pre>
                </details>
              )}
            </div>

            {/* V9 — Compliance, GenAI Observability & Continuous Quality */}
            <div className="rounded-xl border border-teal-300 bg-teal-50/40 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-teal-800">
                V9.0 Compliance & Quality Plane
              </div>
              <div className="mt-1 text-[10px] leading-tight text-teal-700">
                EU AI Act Art 11/12/26/72/79 · OTel GenAI v1.41 emitter ·
                PII/secret redactor · LLM-as-Judge panel · golden dataset curator ·
                eval-gated CI · CUSUM drift monitor · MCP audit · deterministic replay ·
                evidence-pack exporter
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={runV9Diag}
                  disabled={v9Running}
                  className="flex-1 rounded-lg bg-teal-700 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {v9Running ? "Running…" : "▶ Run V9 Diagnostics"}
                </button>
              </div>
              {v9Error && <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-[10px] text-rose-800">{v9Error}</div>}
              {v9Diagnostics && (
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-2">
                  <div className={`text-[11px] font-bold ${v9Diagnostics.ok ? "text-emerald-700" : "text-rose-700"}`}>
                    {v9Diagnostics.ok ? "✓ ALL CHECKS PASS" : "✗ CHECKS FAILED"} ({v9Diagnostics.checks.filter(c => c.passed).length}/{v9Diagnostics.checks.length})
                  </div>
                  <div className="mt-1 max-h-48 overflow-y-auto text-[9px] leading-tight">
                    {v9Diagnostics.checks.map(c => (
                      <div key={c.id} className={c.passed ? "text-zinc-600" : "text-rose-700 font-bold"}>
                        {c.passed ? "✓" : "✗"} {c.id}{!c.passed && <span className="ml-1 text-rose-500">— {c.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {v9Audit && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] font-bold text-teal-800">V9 compatibility audit</summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded border border-zinc-200 bg-white p-2 text-[9px] leading-tight text-zinc-700">
                    {JSON.stringify(v9Audit, null, 2)}
                  </pre>
                </details>
              )}
            </div>

            {/* V10 — Creative Tree of Life */}
            <div className="rounded-xl border border-lime-300 bg-lime-50/40 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-lime-800">
                V10.0 Creative Tree of Life Plane
              </div>
              <div className="mt-1 text-[10px] leading-tight text-lime-700">
                Offline studio · seed → sprout → branch → bloom → fruit → compost ·
                20 transparent operators · local novelty · cohesion · human confirmation ·
                compost recycling · JSON/tree exports
              </div>
              <button
                onClick={runV10Diag}
                disabled={v10Running}
                className="mt-2 w-full rounded-lg bg-lime-700 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-lime-800 disabled:opacity-50"
              >
                {v10Running ? "Running…" : "▶ Run V10 Diagnostics"}
              </button>
              {v10Error && <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-[10px] text-rose-800">{v10Error}</div>}
              {v10Diagnostics && (
                <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-2">
                  <div className={`text-[11px] font-bold ${v10Diagnostics.ok ? "text-emerald-700" : "text-rose-700"}`}>
                    {v10Diagnostics.ok ? "✓ ALL CHECKS PASS" : "✗ CHECKS FAILED"} ({v10Diagnostics.checks.filter(c => c.passed).length}/{v10Diagnostics.checks.length})
                  </div>
                  <div className="mt-1 max-h-48 overflow-y-auto text-[9px] leading-tight">
                    {v10Diagnostics.checks.map(c => (
                      <div key={c.id} className={c.passed ? "text-zinc-600" : "text-rose-700 font-bold"}>
                        {c.passed ? "✓" : "✗"} {c.id}{!c.passed && <span className="ml-1 text-rose-500">— {c.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Genome Summary */}
            {genome && (
              <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/30 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-700">Genome Summary</div>
                <div className="mt-2 text-[11px]">
                  <div className="font-bold text-fuchsia-900">{genome.persona.name}</div>
                  <div className="text-fuchsia-800">{genome.persona.tagline}</div>
                  <div className="mt-1 font-mono text-[10px]">Path: {genome.path.id} — {genome.path.name}</div>
                  <div className="mt-0.5 font-mono text-[10px]">Domain: {genome.domainPack.name} · Risk: {genome.safetyGate.risk}</div>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel — Compiled Prompt & Dimensions */}
          <div className="flex-1 overflow-y-auto p-5">
            {compiledPrompt ? (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-zinc-900">Compiled v2 Innovation Prompt</h3>
                  <div className="flex gap-2">
                    <button onClick={copyPrompt} className="rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-[10px] font-bold text-zinc-700 hover:bg-zinc-100">📋 Copy Prompt</button>
                    <button onClick={copyJSON} className="rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-[10px] font-bold text-zinc-700 hover:bg-zinc-100">📋 Copy JSON</button>
                  </div>
                </div>
                <pre className="max-h-[60vh] overflow-auto rounded-xl border border-zinc-200 bg-zinc-900 p-4 text-[10px] font-mono text-emerald-400">
                  {compiledPrompt}
                </pre>

                {/* Dimension Values */}
                {genome && (
                  <>
                    <h3 className="mt-6 text-sm font-bold text-zinc-900">Dimension Values</h3>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {DIMENSIONS.map((dim: any) => {
                        const val = genome.genome[dim.id] ?? 0;
                        return (
                          <div key={dim.id} className="rounded-lg border border-zinc-200 bg-white p-2.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-bold text-zinc-800">{dim.name}</span>
                              <span className="font-mono text-fuchsia-700">{val.toFixed(2)}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style={{ width: `${Math.round(val * 100)}%` }} />
                            </div>
                            <div className="mt-1 flex justify-between gap-2 text-[9px] text-zinc-400">
                              <span>{dim.lowPole}</span>
                              <span className="text-right">{dim.highPole}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="grid h-full place-items-center text-center text-sm text-zinc-500">
                <div>
                  <div className="text-4xl">🧬</div>
                  <div className="mt-2 font-bold">Enter a problem and click "Compile v2"</div>
                  <div className="mt-1 text-zinc-400">The engine will roll a deterministic genome from the seed and compile the full innovation prompt.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
