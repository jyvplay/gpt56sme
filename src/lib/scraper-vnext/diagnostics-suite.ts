/**
 * src/lib/scraper-vnext/diagnostics-suite.ts
 * ============================================================================
 * FULL-PIPELINE INTEGRATION TEST (additive diagnostic).
 * Exercises every scraper method, wiring, and the control plane budget.
 */
import { runVanguardDiagnostics } from "./vanguard-titanium";
import { runArbiterDiagnostics } from "./arbiter-omega";
import { runSibylDiagnostics } from "./sibyl-oracle";
import { strataDiagnostics } from "./strata-engine";
import { runNexusDiagnostics } from "./nexus-consensus";
import { runAcceleratorDiagnostics } from "./retrieval-accelerator";
import { runSpaRescueBridgeDiagnostics } from "./spa-rescue-bridge";
import { runPolicyAugmentDiagnostics } from "./retrieval-policy-augments";
import { runAuditAugmentDiagnostics } from "./retrieval-audit-augments";

export async function runFullPipelineDiagnostics(): Promise<any> {
  // Unit diagnostics
  const units = {
    vanguard: runVanguardDiagnostics(),
    arbiter: runArbiterDiagnostics(),
    sibyl: runSibylDiagnostics(),
    strata: await strataDiagnostics(),
    nexus: runNexusDiagnostics(),
    accelerator: await runAcceleratorDiagnostics(),
    spaRescue: await runSpaRescueBridgeDiagnostics(),
    policy: await runPolicyAugmentDiagnostics(),
    audit: await runAuditAugmentDiagnostics(),
  };

  const status = Object.fromEntries(
    Object.entries(units).map(([k, v]) => [k, v.ok])
  );

  return { ok: Object.values(status).every(v => v === true), status, units };
}
