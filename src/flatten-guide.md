# VERITAS V15 — Authoritative Persistence & Flatten Guide (`flatten-guide.md`)

**Author:** Codex (v29.1+ OMEGA-FORGE Adaptive Turn 24+).
**Source of Truth** for every optimal update across the full chat history and additive VNext extensions.

This environment persists ONLY files under `src/`. Everything below documents the persistent `src/` architecture, additive shims, and the exact flattening specification required for any future zero-dependency collapse.

---

## PART 1 — CURRENT PERSISTENT `src/` ARCHITECTURE & SEAMS

### 1. Root & Entry Seams (`src/`)
- `src/App.tsx` → Compositional sidecar wrapper mounting `src/App.tsx`.
- `src/main.tsx` → React 19 root renderer.
- `src/index.css` → `@source "../node_modules/src"` explicitly scanning package Tailwind classes, plus `@import "tailwindcss";` v4 setup.
- `src/PERSIST_CANARY.txt` → Contains canary timestamp string (`PERSIST_20260523T000000Z_Q7X4M2`).

### 2. UI & Overlay Component Seams (`src/components/`)
- `src/components/V15Overlay.tsx` → **Workspace Override:** Renders the floating V15 control pill (`V15Toggle`, `📊 Calibrate`, `📖 Guide`, `🔍 SearXNG`, and the interactive `⚡ Titanium: ON/OFF` toggle button controlling Vanguard-Titanium Virtual Egress routes).
- `src/components/V15CalibrationDialog.tsx` → Shims package dialog (full 1872-line Rigor Guard dialog: title bar, Live Compare / Batch Bank / Web Grounding Guide / Advanced Config / Divergence Log sub-tabs, ProfileBar, Draft Stats, Best-of-N candidates, CoVe, Adversarial Preview, Citation Audit panel, Gate Testbed, 246 Defense).
- `src/components/V15CalibrationAugment.tsx` → **NEW (durable UI restoration):** MutationObserver-based augment mounted by `V15Overlay`. Injects the origin-baseline header controls the package omits — `Cite [APA/MLA/Chicago/IEEE/AMA]` dropdown (persists to `veritas.v15.citationStyle`), `Native` self-test button, `🎭 Personas` button — plus a full 24-archetype **Persona Guide modal** (rarity/tier + voice/do/avoid/cadence). Runs a one-time-per-open **Default Calibration Controller** (drives real React inputs) enforcing: Williams persona = The Strategist, Template OMEGA-STRATEGY, Style --bain-pe, Best-of-N Models 1 / Hypotheses 7 / Pack outlines ON, Gate Testbed ON (via `setAdvancedGatesEnabled`). Injects a **Calculation Trace** card into the row detail pane that re-derives every `a op b = c` and marks `calc verified` / `no verify`.
- `src/components/V15Toggle.tsx`, `ChatApp.tsx`, `GBSDashboard.tsx`, `ControlPlanePage.tsx`, `TemplatesPage.tsx`, `ModulesPage.tsx`, `AdaptersPage.tsx`, `AdversarialPanel.tsx`, `MemoryInspector.tsx`, `ResourceEstimatorPage.tsx` → 10 persistent component re-export seams.

### 3. Core Engine Shims & Extensions (`src/lib/`)
- `src/lib/v15-pipeline.ts` → **Workspace Override:** Wraps `runV15OnQuestion` to pre-ground queries using our upgraded VNext grounding stack (`groundQuestion` from `@/lib/v15-grounding`) whenever web grounding is enabled.
- `src/lib/v15-grounding.ts` → **Workspace Override:** Primary grounding orchestrator. Exports `getTitaniumEgressEnabled` / `setTitaniumEgressEnabled` and overrides `groundQuestion(opts)` to execute:
  1. `groundTerminalSaturated` (`terminal-saturation.ts`, Tier -9; supplementary mode is off by default)
  2. `groundTerminalFinal` (`terminal-final.ts`, Tier -8)
  3. `groundTerminalComplete` (`terminal-complete.ts`, Tier -7)
  4. `groundWithPortfolioConsensus` (`portfolio-consensus-adjudicator.ts`, Tier -6)
  5. `groundWithAuditedPortfolio` (`canonical-portfolio-augments.ts`, Tier -5)
  6. `terminalWireGround` (`terminal-wire.ts`, Tier -4)
  7. `vanguardGround` (`vanguard-titanium.ts`, Tier -3)
  8. Package default `originalGroundQuestion` fallback.
  Also exports `runV15GroundingStackDiagnostics()` running all 7 diagnostic suites.
- `src/lib/omni-nexus.ts` → **NEW:** Canonical Omni-Nexus grounding lane (`omniNexusGround`).

### 4. Scraper VNext Additive Stack (`src/lib/scraper-vnext/`)
- `src/lib/scraper-vnext/canonical-portfolio-orchestrator.ts` → **NEW (gpt-5.6-sol-search-xhigh):** Implements canonical portfolio orchestration (`buildLaneSpecs`, `runLane`, `runHedged`, `runAuditAll`, `chooseBest`, `groundWithCanonicalPortfolio`, `runCanonicalPortfolioDiagnostics`).
- `src/lib/scraper-vnext/portfolio-consensus-adjudicator.ts` → **NEW (claude-opus-4-8-search):** Implements family-aware claim corroboration and strictly-dominant consensus tie-breaking (`ENGINE_FAMILY`, `familyOf`, `groundWithPortfolioConsensus`, `runPortfolioConsensusDiagnostics`).
- `src/lib/scraper-vnext/canonical-portfolio-augments.ts` → **NEW (Research docs):** Implements yield memory, lane-independence audit, persisted origin backoff, marginal evidence gain stop, and `groundWithAuditedPortfolio` (`runCanonicalPortfolioAugmentDiagnostics`).
- `src/lib/scraper-vnext/portfolio-consensus-memory.ts` → **NEW (claude-sonnet-5-search):** Honest CanonicalLaneId-keyed cross-session memory and family-pair corroboration ledger (`groundWithAdaptivePortfolioConsensus`, `runPortfolioConsensusMemoryDiagnostics`).
- `src/lib/scraper-vnext/portfolio-terminal-governor.ts` → **NEW (gpt-5.6-sol-search-xhigh):** Corrective context-scoped memory governor, zero-fulfillment temporary quarantine, aborted-lane censoring, per-run family-pair de-duplication, current-run snapshot (`groundWithTerminalPortfolioGovernor`, `runPortfolioTerminalGovernorDiagnostics`).
- `src/lib/scraper-vnext/terminal-complete.ts` → **NEW (Research synthesis):** Final terminal synthesis combining structured parallel prefetch, adaptive portfolio consensus memory, terminal governor, real-time family independence, marginal gain advisory, and one-stop diagnostics (`groundTerminalComplete`, `runTerminalCompleteDiagnostics`).
- `src/lib/scraper-vnext/terminal-final.ts` → **NEW (claude-opus-4-6-search):** Governor-native final facade. Adds strict RFC 9309 helper (`makeRfc9309RobotsDecision`), structured prefetch, real-time family independence, marginal-gain advisory, and a unified diagnostic hub (`groundTerminalFinal`, `runTerminalFinalDiagnostics`).
- `src/lib/scraper-vnext/terminal-saturation.ts` → **NEW (reviewed research addon):** Optional `off`/`advisory`/`merge` DataCite and Europe PMC metadata supplement with fail-soft public API retrieval, separate local WebCrypto commitment, duplicate suppression, and cooperative yielding. It is off by default (`groundTerminalSaturated`, `runTerminalSaturationDiagnostics`).
- `src/lib/scraper-vnext/sentinel-orchestrator.ts` → **NEW:** Canonical Sentinel Orchestrator lane (`sentinelGround`).
- `src/lib/scraper-vnext/sentinel-omega.ts` → **NEW:** Canonical Sentinel Omega lane (`groundWithSentinelOmega`).
- `src/lib/scraper-vnext/spa-rescue-bridge.ts` → **UPGRADED:** Closes the canonical cause-bridge gap. Exports `detectChallenge`, `isSoftFailure`, `withSpaRescueCause<T>`, `withSpaRescueFromRawResponse<T>`, and `runSpaRescueBridgeDiagnostics()` (all 9 asynchronous test cases).
- `src/lib/scraper-vnext/vanguard-titanium.ts` → **Workspace Override:** Adds Titanium Virtual Egress (`buildGoogleTranslateUrl`, `buildAmpCacheUrl`, `buildRssGatewayUrl`), SPA Shell Salvage (`salvageMetadata`), 0-1 DP Epistemic Knapsack Packing (`packEvidence`), and `vanguardGround(query, opts)`.
- `src/lib/scraper-vnext/terminal-wire.ts` → **NEW:** Adds one-shot terminal grounding (`withChallengeGateCause`, `buildTitaniumTranslateLanes`, `buildTitaniumAmpLanes`, `terminalWireGround`).
- `src/lib/scraper-vnext/retrieval-audit-augments.ts` → **NEW:** Yield-aware queue memory, lane-independence audit, persisted origin backoff, marginal evidence gain stop.
- `src/lib/scraper-vnext/structured-source-adapter.ts` → **Workspace Override:** Re-exports package structured adapter while exporting `buildAmpCacheUrl`, `fetchViaAmpCache`, and `wrappedStructuredChallengeReader`.
- `src/lib/scraper-vnext/*` → Shims for `retrieval-control-plane`, `retrieval-policy-augments`, `epistemic-packer`, `retrieval-accelerator`, `conclave-omega`, `content-extractor-v2`, `diagnostics-suite`, `fusion-v2`, `safe-fetch-v2`, `smart-read-v2`.

---

## PART 2 — SYMBOL PRECEDENCE & RESOLUTION TABLE

When flattening or overriding, **workspace definitions in `src/` take strict precedence** over `node_modules/src/`:

| Symbol | Canonical Winner | Internal Callers to Repoint |
|---|---|---|
| `runV15OnQuestion` | `src/lib/v15-pipeline.ts` | All calibration dialog batch & live handlers, chat synthesis |
| `groundQuestion` | `src/lib/v15-grounding.ts` | `runV15OnQuestion`, `HDIG`, `CoVe`, `N-Deep`, template grounding |
| `groundTerminalSaturated` | `src/lib/scraper-vnext/terminal-saturation.ts` | `groundQuestion` (Tier -9; default mode off) |
| `groundTerminalFinal` | `src/lib/scraper-vnext/terminal-final.ts` | `groundQuestion` (Tier -8) |
| `groundTerminalComplete` | `src/lib/scraper-vnext/terminal-complete.ts` | `groundQuestion` (Tier -7) |
| `groundWithCanonicalPortfolio` | `src/lib/scraper-vnext/canonical-portfolio-orchestrator.ts` | `portfolio-consensus-adjudicator.ts`, `canonical-portfolio-augments.ts` |
| `groundWithPortfolioConsensus` | `src/lib/scraper-vnext/portfolio-consensus-adjudicator.ts` | `groundQuestion` (Tier -6) |
| `groundWithAdaptivePortfolioConsensus` | `src/lib/scraper-vnext/portfolio-consensus-memory.ts` | `terminal-complete.ts`, `portfolio-terminal-governor.ts` |
| `groundWithTerminalPortfolioGovernor` | `src/lib/scraper-vnext/portfolio-terminal-governor.ts` | `terminal-complete.ts` |
| `groundWithAuditedPortfolio` | `src/lib/scraper-vnext/canonical-portfolio-augments.ts` | `groundQuestion` (Tier -5) |
| `vanguardGround` | `src/lib/scraper-vnext/vanguard-titanium.ts` | `groundQuestion` (Tier -3), `terminalWireGround` |
| `terminalWireGround` | `src/lib/scraper-vnext/terminal-wire.ts` | `groundQuestion` (Tier -4) |
| `withSpaRescueCause` | `src/lib/scraper-vnext/spa-rescue-bridge.ts` | Bounded crawl readers in `terminal-wire.ts` and portfolio orchestrator |
| `getTitaniumEgressEnabled` | `src/lib/v15-grounding.ts` | `V15Overlay`, `groundQuestion`, status bar toggles |

---

## PART 3 — LOCALSTORAGE & STATE KEY REGISTRY

All V15 settings persist cleanly to `localStorage`:
- `veritas.v15.enableTitaniumEgress` — `"true"` | `"false"` (controls Titanium Google Translate & AMP virtual egress routes).
- `veritas.settings.v2` — JSON blob containing `"enableTitaniumEgress": true|false`.
- `veritas.v15.enabled` — `"true"` | `"false"`.
- `veritas.v15.defaultsVersion` — Currently versioned at `"20"`.
- `veritas.v15.searxngUrl` — Custom local search endpoint.
- IndexedDB stores (`canonical-portfolio-audits-v1` / `retrieval-audit-augments`):
  - ObjectStore `"yield"` (keyPath: `"key"` / `"domainLane"`) for historical domain+lane success rate & latency.
  - ObjectStore `"backoff"` (keyPath: `"origin"`) for 429/503 origin leases.

---

## PART 3B — CANONICAL WILLIAMS PERSONA GUIDE (screenshot 1:1 restore)

The origin repo's Persona Guide (personas incl. The Skeptic / Synthesist /
Pragmatist / Visionary, and the rich detail layout) is **NOT** shipped by the
`unkbv10` package — its `ARCHETYPES` roster is a different style-only list.
It is therefore reconstructed as durable workspace source and must be preserved:

- `src/lib/williams-persona-guide.ts` → **Canonical data:** `PERSONA_GUIDE`
  (24 entries: `name`, `tier` [Common/Uncommon/Rare/Epic/Legendary],
  `rarityLabel`, `description`, `changes[]`, `suppresses[]`, `cadence`,
  `transformation`, `wordCount`), `SHARED_IDEA` (constant bus sentence),
  `ORACLE_BANNER` (featured Menu-Level Default View), `buildPersonaComparison(a,b)`.
- `src/components/V15CalibrationAugment.tsx` → **Canonical modal:** `PersonaGuideModal`
  renders the screenshot 1:1 — header (`📋 Williams Persona Guide · 24 archetypes ·
  Source: Joseph M. Williams, Style: Toward Clarity and Grace`), the violet Oracle
  banner, the two-column **Archetype Menu** (tier badges + `rarity:` labels +
  italic descriptions), and the right **Persona Guide** detail panel with
  `WHAT IT CHANGES`, `WHAT IT SUPPRESSES` (+ Cadence), `SHARED IDEA`,
  `50-100 WORD TRANSFORMATION` (word count), and the `Side-by-side comparison`
  A/B dropdowns rendering `buildPersonaComparison`. Opened via the injected
  `🎭 Personas` header button (event `veritas:open-personas`).

**Restore procedure if this regresses:** (1) recreate `williams-persona-guide.ts`
with all 24 entries verbatim from the screenshot menu (tier badge, rarity label,
italic description) — the first 6 strategic personas (Oracle, Architect, Skeptic,
Synthesist, Pragmatist, Visionary) have 2-sentence descriptions; the remaining 18
Williams personas use the terse cadence phrase. (2) Keep `SHARED_IDEA` and The
Oracle `transformation` verbatim from the screenshot; ALL 24 transformations
MUST derive from the exact same `SHARED_IDEA` string — never introduce a second
baseline sentence. (3) Ensure `PersonaGuideModal` renders all five detail
sections + Side-by-side. (4) Do not duplicate the button — the injector checks
`document.getElementById("veritas-augment-personas-btn")` before creating a new one.

## PART 3C — FULL-FLEET SCRAPER ACTIVATION (origin package + VNext, no exceptions)

`src/lib/v15-grounding.ts` is the **sole** grounding entry point (`groundQuestion`)
consumed by `runV15OnQuestion` (`v15-pipeline.ts`). It invokes **every** scraper
lane from both the origin package and the VNext additive stack in parallel on
**every single call**, with zero omissions:

- **Origin package lanes:** `packageGroundQuestion` (aliased import of the
  pristine `src/lib/v15-grounding.ts` export — chains native scraper →
  PrismaFetch → OG browser scraper → SearXNG → Jina), `searchAcademicSources`
  (PubMed, NIH Reporter, Europe PMC, Semantic Scholar, OpenAlex, CrossRef,
  arXiv), `enhancedSearch` (HN Algolia, StackExchange×16, Reddit, GitHub, SEC
  EDGAR, PatentsView, Wayback, Google/Bing/DDG/Wikipedia/Scholar/arXiv),
  `browserScraperSearch` (direct OG scraper call).
- **VNext additive lanes:** `hydraGround`, `nexusResearch`, `sibylResearch`,
  `strataCollect`, `arbiterResearch`, `palisadeGround`, `groundTerminalFinal`
  (which itself chains the Governor → Portfolio Consensus → Vanguard-Titanium →
  Terminal-Wire → Sentinel-Orchestrator → Sentinel-Omega → Omni-Nexus →
  Structured-Source-Adapter).
- Every lane emits a line via `src/lib/scraper-debug-bus.ts`
  (`emitScraperDebug(lane, message)`), which **always** echoes to
  `console.log` AND to the live **🛰 Scraper Lane Activity Log** panel
  (`ScraperLaneLogPanel` in `V15CalibrationAugment.tsx`, bottom-right, minimized
  by default, expand to see real-time per-lane activity). This closes the
  "I still don't see them log" gap — every lane's real network activity is
  now visibly provable in both the browser console and the on-screen panel.
- Sources from all lanes are merged and deduplicated by URL into one combined
  evidence block. Zero mocks/simulations — every call is a real `fetch()`.

**Restore procedure if any lane silently drops:** open `v15-grounding.ts` and
confirm the `laneRunners` array in `groundQuestion()` still contains exactly 10
entries (package-groundQuestion, academic-sources, enhanced-scraper, og-scraper,
hydra-reader, nexus-consensus, sibyl-oracle, strata-engine, arbiter-omega,
palisade-adjudicator) plus the `terminal-final` entry (11 total). Each entry
must call `dbg(lane, ...)` before and after its `await`, and `addAll(lane, ...)`
on success so lane counts are provable in the log panel.

## PART 3D — OUTPUT BOX ENHANCER (10x taller, scrollable, expand + copy)

`injectOutputBoxEnhancer()` in `V15CalibrationAugment.tsx` scans every `<pre>`
block in the Rigor Guard dialog (Live Compare / Batch Bank output, revision
text, SLOOP-chunked output, etc.) with more than 300 characters and:
1. Multiplies its existing `max-height` ×10 and forces `overflow-y: auto` so
   long SLOOP-4/OMEGA-STRATEGY/--bain-pe outputs never appear silently
   truncated.
2. Injects a toolbar above it with **⛶ Expand** (dispatches
   `veritas:expand-output`, rendered by `ExpandedOutputOverlay` as a
   full-screen lightbox covering the entire Rigor Guard Calibration overlay)
   and **📋 Copy** (copies that exact block's full text via
   `navigator.clipboard`).
Guarded by `pre.dataset.veritasEnhanced === "1"` so the toolbar is never
duplicated on re-render.

## PART 3J — INNOVATION GENOME ENGINE v2.0 (additive over v1)

`src/lib/innovation-genome-engine-v2.ts` is the persistent TypeScript v2
extension. **Never replace or edit v1 to restore v2**; v2 imports v1 and adds:

- 14 extended personas (25 combined) and 8 cyclic/compound paths (24 combined).
- Deterministic systematic mutations: `nudge`, `flip`, `block_rotate`,
  `pole_swap`, `dimension_mask` (`applyMutation`).
- Deterministic crossover: `uniform`, block-level, Pareto-weighted
  (`applyCrossover`).
- `FitnessVector` (novelty/utility/tractability/robustness), `GenomeEntry`,
  `ParetoArchive` (3D MAP-Elites signature + nondominated front), `Island`,
  `IslandManager`, and `evolveGeneration(parent,evaluator,...)`. Fitness is
  accepted **only** from the caller-supplied evaluator — never fabricated.
- `AnomalyBuffer` and `FailureArchive`, with localStorage load/save helpers.
- 16 domain packs: mathematics, algorithms, software, medicine, legal,
  physics, chemistry, ml, engineering, finance, cybersecurity, biology,
  product, policy, operations, general.
- `SafetyGate` caps `termination_resistance <= 0.5` and `goal_fixity <= 0.3`
  for high-stakes domains; `CapabilityGate` explicitly discloses unavailable
  parallel workers/verifier/formal prover/sandbox rather than fabricating them.
- `rollV2`, `compileCompactDirectiveV2`, JSON Schema, JSON export, and
  `runInnovationGenomeV2Diagnostics`.

**Live integration:** `src/lib/v15-pipeline.ts` rolls v2 for every run, injects
the compact directive into synthesis/N-Deep/HDIG/adversarial, and writes the
exact active result to `window._VERITAS_INNOVATION_GENOME_V2`. The LLM query
strategist consumes the same `compactDirective`, so ideation, retrieval, and
synthesis share one recorded seed/strategy. The Rigor Guard sub-tab row gets
exactly one guarded `🧬 Genome v2` button (`id=veritas-augment-genome-btn`);
its modal shows the active seed/persona/path/domain, all 21 dimension bars,
capability reality, and a Copy compiled prompt action. No run => it honestly
says no genome has compiled; it never generates a fake preview.

The live directive also includes `buildExplorationPopulationV2(..., 6)`: base
plus one branch from each of the five systematic mutation families. This makes
ideation/retrieval/synthesis preserve six mechanism-distinct paths. The prompt
explicitly states that branches have **no inferred fitness**; MAP-Elites/Pareto
admission happens only through `evolveGeneration` with a real caller-supplied
`GenomeEvaluator`.

**Restore checks:** keep `innovation-genome-engine.ts` untouched; ensure v2
imports it, `v15-pipeline.ts` imports v2 (not `roll` from v1), and
`query-strategist.ts` receives `innovationContext`. Build must transform v2 and
the button must remain unique by DOM id.

## PART 3I — INNOVATION GENOME ENGINE (seed-driven discovery-strategy diversity)

`src/lib/innovation-genome-engine.ts` — Conway-inspired seed→genome prompt
compiler, the discovery-side analogue of the Williams persona engine.
- **21 dimensions** across 7 nodes: Problem Choice (P), Anomaly Valuation (A),
  Embodiment (E), Analogy (N), Evaluator Revision (V), Taste (T), Social
  Stabilization (S). Each a 0.0–1.0 axis between two legitimate poles.
- **Determinism:** `seedToGenome(seed)` uses FNV-1a + xorshift over
  `${seed}:${index}` → same seed always yields the same genome (no `crypto`
  dependency, browser-native).
- **11 emergent personas** (`classifyPersona`) — Anomaly Hunter, Axiom Breaker,
  Bridge Builder, Tinkerer, Connoisseur, Adversary, Evaluator Inventor,
  Portfolio Manager, Heretic, Methodical Explorer, Plain Dealer (default).
- **16 dependency-respecting discovery paths** (`selectPath`) — α Full
  Classical, β Analogy-First, γ Anomaly-Driven, δ Tinkerer, ε Theorist,
  ζ Taste-Led, η Evaluator-First, θ Serendipitous Import, ι Builder, κ Dry
  Theorist, λ Community-Initiated, μ Lab Accident, ν Connoisseur, ξ Imported
  Crisis, ο Prototype-First, π Metric-Driven.
- `compileInnovationPrompt()` → full Kerger-class contract (portfolio breadth,
  negative-space count, adversary type, termination mode, evaluator mutability,
  anomaly buffer, taste filter, goal-space mutation, world-contact) all derived
  from genome values.
- `compileCompactDirective()` → ~400-token version actually injected into the
  live pipeline.
- **Wired in `src/lib/v15-pipeline.ts`:** every `runV15OnQuestion` call rolls a
  genome and prepends the compact directive, so N-Deep / HDIG / adversarial
  passes are steered into genuinely different search strategies instead of
  converging on one shape. Toggle key `veritas.v15.innovationGenome`
  (default ON). Exposed at `window._VERITAS_INNOVATION_GENOME`.
- `runInnovationGenomeDiagnostics()` = 12 pure checks.

**Restore procedure:** keep the 21 `DIMENSIONS`, 11 `PERSONAS` (default last),
16 `PATH_TABLE` entries with `FALLBACK_PATH` = α, and the `mix32` determinism
(never swap for `Math.random` per-dimension — that breaks reproducibility).

## PART 3H — DETERMINISTIC CITATION LEDGER (scraper results ARE the verifier)

`src/lib/deterministic-citation-ledger.ts` fixes the "Citation Trust Audit 0/2
valid, coverage 0%, all UNTRUSTED" + "CoVe never verifies" failure. Root cause:
the package re-verified citations **stochastically** via an LLM against a ledger
the answer's `[S#]` tags didn't align with. Fix (your insight): every source a
scraper ACTUALLY fetched is deterministic ground truth, so the fetched set IS a
verified citation ledger with zero stochastic dependence.

- `buildDeterministicLedger(sources)` → assigns stable `S#` ids, an FNV-1a
  content fingerprint (reproducible, canonical-URL dedupe), marks each
  `verified: true` with originating lane provenance, and emits a canonical
  `References` section.
- `auditAnswerCitations(answerText, ledger)` → trusted/untrusted/coverage by
  pure **set membership** (`method: "deterministic-set-membership"`) — never an
  LLM, so it cannot spuriously fail.
- Wired in `v15-grounding.ts` `groundQuestion()`: after all lanes complete, it
  builds the ledger from the real merged sources, emits the evidence block with
  per-source `PROVENANCE: retrieved via <lane> · fingerprint <hex> ·
  deterministically VERIFIED` lines + the References section, and exposes it at
  `window._VERITAS_CITATION_LEDGER` for any UI consumer.
- `runDeterministicLedgerDiagnostics()` = 8 pure checks.

**Restore procedure if it regresses:** ensure `groundQuestion` calls
`buildDeterministicLedger(collected…)` before composing the evidence block and
returns `ledger.sources`; the References section MUST be appended so inline
`[S#]` tags resolve to real URLs.

## PART 3G — LLM QUERY-INTELLIGENCE / TRANSLATION LAYER

`src/lib/scraper-vnext/query-strategist.ts` inserts an LLM translation stage
BEFORE any scraper runs, fixing the "asks the same question verbatim" defect.
`strategizeQuery(question)` returns an optimized PORTFOLIO of search queries:
- **Keywordization** (stopword strip + proper-noun anchoring; engines match
  tokens, not sentences).
- **Decomposition** into atomic sub-queries (ReDI / Plan×RAG / Self-Ask).
- **HyDE** hypothetical-answer keyword anchor.
- **Step-Back** abstraction to governing principles.
- **NEGATIVE-SPACE** queries (original extension, MANDATORY): disconfirming
  evidence, failure modes, retractions, counter-thesis — adversarially balances
  the evidence set.
- **Entity-anchored / temporal / domain-routed** variants.
LLM path uses `generateWithRotation` (full model roster round-robin). Keyless
fallback = deterministic algorithmic keyword transformation (honest, not mock).
`src/lib/v15-grounding.ts` `groundQuestion()` calls `strategizeQuery` first,
then drives the heavy engines with `primaryQuery` and runs `secondaryQueries`
(decomposition/HyDE/step-back/negative-space) as extra sweeps on the fast
keyword lane; all results merge+dedupe. Every step logs to `scraper-debug-bus`.
`runQueryStrategistDiagnostics()` provides 6 pure checks.

**Restore procedure if it regresses:** ensure `groundQuestion` calls
`strategizeQuery` before building `laneRunners`, and that the enhanced-scraper
+ og-scraper lanes consume `primaryQuery` (not the raw question). Never drop the
mandatory negative-space query.

## PART 3F — FULL LLM ROSTER (round-robin rotation, every model, every call)

`src/lib/v15-rate-limiter.ts` is a **workspace override** that mutates the
package's exported `MODEL_LIMITS` object at module load time to register the
FULL user-specified LLM roster with exact per-model RPM/TPM/RPD caps. The
package's `pickLeastLoaded`, `snapshotAllUsage`, and `tryAcquire` all read
`MODEL_LIMITS` by reference, so this single override wires every model into
the round-robin rotation used by both the V15 calibration pipeline and every
scraper/portfolio LLM call — no exceptions.

Roster (durable in `src/lib/v15-rate-limiter.ts` → `FULL_ROSTER`):
- `gemini-2.5-flash`         → RPM 5 / TPM 250K / RPD 20
- `gemini-2.5-flash-lite`    → RPM 10 / TPM 250K / RPD 20
- `gemini-3-flash`           → RPM 5 / TPM 250K / RPD 20
- `gemini-3.1-flash-lite`    → RPM 15 / TPM 250K / RPD 500
- `gemini-3.5-flash`         → RPM 5 / TPM 250K / RPD 20
- `gemini-3.5-flash-lite`    → RPM 15 / TPM 250K / RPD 500
- `gemini-3.6-flash`         → RPM 5 / TPM 250K / RPD 20
- `gemma-4-26b-it`           → RPM 30 / TPM 16K / RPD 14400
- `gemma-4-31b-it`           → RPM 30 / TPM 16K / RPD 14400

Also exported: `VERITAS_FULL_LLM_ROSTER` (readonly array of model IDs) so any
future code can iterate the canonical list directly.

**Restore procedure if the roster ever regresses:** open
`src/lib/v15-rate-limiter.ts` and confirm the `FULL_ROSTER` map contains all 9
entries with correct RPM/TPM/RPD; the mutation loop at module top
(`for (const [model, limit] of Object.entries(FULL_ROSTER)) { MODEL_LIMITS[model] = limit; }`)
must run — do NOT swap for a re-assignment (that would break the shared
reference the package uses internally).

## PART 3K — OUTPUT BOX ENHANCER (10x taller, scrollable, expand + copy + natural)

`injectOutputBoxEnhancer()` in `V15CalibrationAugment.tsx` scans every `<pre>` with >300 chars (answer boxes in Live Compare / Batch Bank, SLOOP-chunked output) and:
- Multiplies max-height ×10 (default 256 → 2560px) + `overflow-y: auto`.
- Adds toolbar with **⛶ Expand** (dispatches `veritas:expand-output`, rendered by `ExpandedOutputOverlay` full-screen overlay with **Close** as back control = exit expanded mode), **📋 Copy** (copies entire original text), **Aa Natural** (toggles markdown stripping while preserving LaTeX `$$...$$` and `$...$` delimiters).
- Guarded by `dataset.veritasEnhanced === "1"` + `dataset.veritasOriginal` so toolbar never duplicates.
- Formula handling: `stripMarkdownKeepLatex()` extracts LaTeX placeholders before stripping `# ** * _ ` etc., then restores — formulas displayed with full LaTeX notations intact, markdown removed, natural reading.

**Restore:** ensure enhancer is called in `tick()` and overlay has Close button.

## PART 3E — BUILD PIPELINE INTEGRITY NOTE

This workspace's `package.json` `"build"` script is exactly `"vite build"` —
there is **no** `copy.cjs`, `postinstall`, or any other file-copy hook that
overwrites `src/` on build. The reported external bug ("`copy.cjs` overwrote
`src/components/V15CalibrationDialog.tsx` on every session because
`node_modules` resets") describes a **different** repository/session, not this
one; verified by `grep_files` for `copyFileSync`/`copy.cjs` across `.js/.cjs/.ts/.json`
returning zero matches, and by reading `package.json` directly. If a future
turn ever adds such a script, it MUST be seed-only (copy only if the
destination file is missing) to avoid this exact regression class described by
the user — never modify `vite.config.ts` or add build hooks without explicit
instruction.

## PART 4 — ZERO-DEPENDENCY FLATTEN INSTRUCTIONS

To collapse the sidecar package into a standalone zero-dependency application:
1. **Module Copy & Merge:** For any package file in `node_modules/src/**` imported by the app, copy verbatim into `src/`, replacing the matching `export *` shim.
2. **Override Winner:** Where a workspace override exists (`src/lib/v15-grounding.ts`, `src/lib/v15-pipeline.ts`, `src/lib/scraper-vnext/*`, `src/components/V15Overlay.tsx`), keep the workspace definition as the sole canonical implementation.
3. **Web Worker URLs:** Keep `graph.worker.ts` and `compute.worker.ts` as separate files instantiated with `new Worker(new URL("...", import.meta.url))` so Vite bundles them as independent worker chunks.
4. **CSS Verification:** Change `@source "../node_modules/src"` in `src/index.css` to scan `.` once all files are flattened into `src/`.
5. **No Regressions:** Verify zero TypeScript errors and ensure 1:1 UI/UX parity.
