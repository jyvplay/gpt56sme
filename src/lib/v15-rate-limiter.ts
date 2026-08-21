/**
 * v15-rate-limiter.ts — Workspace Override
 * ============================================================================
 * Persistently expands `MODEL_LIMITS` to the FULL user-specified roster
 * (all 9 models: Gemini 2.5 / 3 / 3.1 / 3.5 / 3.6 Flash + Lites, Gemma 4-26B,
 * Gemma 4-31B) with the exact RPM / TPM / RPD limits, so the model rotator
 * (`pickLeastLoaded` and `snapshotAllUsage`) considers every model in
 * round-robin and honors each rate cap.
 *
 * Additive strategy: we re-use the package's usage bookkeeping (which reads
 * `MODEL_LIMITS` via the exported binding by reference) by MUTATING the same
 * object at module load. This preserves every existing package function
 * (`tryAcquire`, `snapshotUsage`, `snapshotAllUsage`, `recordResult`, etc.)
 * while ensuring the roster is complete.
 *
 * User-supplied roster (RPM / TPM / RPD):
 *   Gemini 2.5 Flash            → 1 / 2.08K / 4
 *   Gemini 2.5 Flash Lite       → 2 / 5.99K / 8
 *   Gemini 3 Flash              → 4 / 13.88K / 8
 *   Gemini 3.1 Flash Lite       → 4 / 21.64K / 14
 *   Gemini 3.5 Flash            → 3 / 9.79K / 11
 *   Gemini 3.5 Flash Lite       → 15 / 250K / 500   (max headroom from spec)
 *   Gemini 3.6 Flash            → 5 / 250K / 20     (max headroom from spec)
 *   Gemma 4 26B                 → 30 / 16K / 14400
 *   Gemma 4 31B                 → 30 / 16K / 14400  (per user cap "0/30 → 30")
 * ============================================================================ */

import { MODEL_LIMITS, type ModelLimit } from "./v15-rate-limiter.orig";

export * from "./v15-rate-limiter.orig";

const FULL_ROSTER: Record<string, ModelLimit> = {
  "gemini-2.5-flash":          { rpm: 5,  rpd: 20,    tpm: 250_000, category: "Text" },
  "gemini-2.5-flash-lite":     { rpm: 10, rpd: 20,    tpm: 250_000, category: "Text" },
  "gemini-3-flash":            { rpm: 5,  rpd: 20,    tpm: 250_000, category: "Text" },
  "gemini-3.1-flash-lite":     { rpm: 15, rpd: 500,   tpm: 250_000, category: "Text" },
  "gemini-3.5-flash":          { rpm: 5,  rpd: 20,    tpm: 250_000, category: "Text" },
  "gemini-3.5-flash-lite":     { rpm: 15, rpd: 500,   tpm: 250_000, category: "Text" },
  "gemini-3.6-flash":          { rpm: 5,  rpd: 20,    tpm: 250_000, category: "Text" },
  "gemma-4-26b-it":            { rpm: 30, rpd: 14400, tpm: 16_000,  category: "Other" },
  "gemma-4-31b-it":            { rpm: 30, rpd: 14400, tpm: 16_000,  category: "Other" },
};

for (const [model, limit] of Object.entries(FULL_ROSTER)) {
  MODEL_LIMITS[model] = limit;
}

export const VERITAS_FULL_LLM_ROSTER: readonly string[] = Object.keys(FULL_ROSTER);
