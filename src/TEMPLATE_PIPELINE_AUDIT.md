# V15 Calibration + Research Template Audit

Owner: Codex  
Scope: all 8 OMEGA templates, 40 style overrides, calibration defaults, V15 loops, production SLOOP/N-Deep routing  
Evidence basis: source-level audit and successful production builds; no live paid-API quality run was available in this environment.

## Executive Findings

### Confirmed defects fixed in this pass

1. **V15 used a template name, not the template.** The prompt said “follow OMEGA-STRATEGY exactly” but never supplied section names or section contracts. Models could not comply reliably. Fixed with `buildAdaptiveTemplateContract()` injected into V15.
2. **Production SLOOP mapped OMEGA templates to lossy generic archetypes.** Discovery became `market-commercial`; Diligence became `audit-assurance`; Crisis fell through to `decision-strategy`. Fixed by a persistent OMEGA-aware `sloop-runner.ts` that consumes actual `OMEGA_TEMPLATES` sections.
3. **SLOOP dropped later required sections.** `targetSections = sections.slice(0, pages + 2)` meant a 4-page report silently omitted sections near the end (often Risk, Recommendations, Appendix). Fixed: every contracted section is retained; low page counts compress per-section depth instead of deleting sections.
4. **Template requirements encouraged fabrication.** Many hints request NPS, interviews, EBITDA, IRR, sample sizes, audit responses, classifications, results, or official approvals without requiring evidence. Fixed with template-specific non-fabrication/status rules (`[PROPOSED]`, `[DATA GAP]`, `[ASSUMPTION]`).
5. **Style overrides could contradict template semantics.** Default `OMEGA-STRATEGY + --bain-pe` combines a strategy skeleton with a diligence style preset. Fixed: incompatible overrides may modulate voice/layout only; they may not import the other template's sections, metrics, or evidence claims.
6. **N-Deep rewrote entire documents and could produce duplicate unchanged passes.** Fixed with localized section patches, byte-for-byte preservation of untouched sections, strict critical→major→warning priority, acceptance only on issue-vector or score improvement, and early stop when no progress is possible.
7. **V15 default-state mismatch.** UI messaging/default profile expected enabled, while `v15-state` defaulted false and was not intercepted. Fixed: persistent state defaults ON unless explicitly disabled.

## Cross-Cutting Template Weaknesses

### Evidence and epistemic status

- Template hints frequently mix required structure with implied facts. “Customer interview synthesis (n=)” is a valid diligence section contract but an invalid instruction when no interviews exist.
- Required numbers must be computed or sourced, not generated because a template asks for them.
- References sections must list only used, retrieved sources. A template cannot justify synthetic citations.
- “Not applicable” should be rare and specific; a missing input is a `[DATA GAP]`, not automatically “N/A.”

### Page-budget contradictions

- OMEGA templates often describe 12–40+ pages, while calibration defaults to SLOOP 4 pages.
- Previous behavior tried to satisfy both by truncating or dropping late sections.
- Correct behavior is **contract-preserving compression**: retain all main headings, allocate a smaller word budget per section, keep appendix compact.
- Second-order effect: very small per-section budgets can create shallow coverage. The UI should present page count as compression, not as permission to omit sections.

### Template/task-type mismatch

- OMEGA-SCIENCE must classify empirical study vs protocol/proposal vs systematic review vs narrative review before choosing Results/Expected Outcomes/PRISMA structure.
- OMEGA-CRISIS combines restructuring and federal RFP semantics; a query may need one branch, not both.
- OMEGA-COMPLIANCE combines audit, governance, ESG, and financial-services risk. The selected framework must be evidence-backed and jurisdiction-specific.
- Third-order effect: applying all template hints literally creates internally inconsistent reports that look comprehensive but are professionally invalid.

### Style override mismatch

- 40 style overrides map to specific templates, but the UI permits any combination.
- Layout/voice characteristics can transfer; substantive evidence requirements usually cannot.
- Example: `--bain-pe` may contribute concise investment-committee tone to OMEGA-STRATEGY, but must not force NPS, sponsor returns, or diligence interviews.

## Template-by-Template Audit

### OMEGA-STRATEGY

Strengths: decision-first BLUF, options tournament, quantified recommendation, implementation and risk.  
Risks:
- TAM/SAM/SOM, NPV/IRR, value bridge and utility scores invite invented numbers.
- “Top three MECE findings” can force artificial exclusivity.
- RACI/deadlines can imply authority the model does not have.
- Fixed four-option tournament may be inappropriate for binary or constrained decisions.
Fix applied: evidence-gated metrics/formulas; all sections retained under compression; style conflict rules.  
Second-order: a quantitatively empty but polished strategy report can falsely signal rigor.  
Third-order: downstream decisions may treat model-generated assumptions as approved targets unless status labels remain visible.

### OMEGA-DILIGENCE

Strengths: scope/reliance, thesis, commercial/financial diligence, value plan, risk.  
Risks:
- Highest fabrication pressure of all templates: interviews, NPS, retention, EBITDA adjustments, debt, comparables, IRR/MOIC.
- “PROCEED/PASS” can overstate confidence with incomplete diligence.
- QofE language can resemble assurance or agreed-upon procedures.
Fix applied: explicit fact/inference/diligence-request separation and conditional verdict rule.  
Second-order: invented diligence evidence compounds into valuation and return outputs.  
Third-order: a false EBITDA adjustment can propagate through leverage, exit value, MOIC, IRR, and recommendation.

### OMEGA-DISCOVERY

Strengths: methodology, thesis, thematic synthesis, horizon scan, stakeholders.  
Risks:
- Survey-heavy hooks encourage synthetic sample size, field dates, weighting and regional cuts.
- “Striking statistic” encourages false precision.
- 3–7 chapters at 4–8 pages each conflicts sharply with 4-page calibration.
- Prior SLOOP mapping to `market-commercial` omitted methodology and stakeholder logic.
Fix applied: actual Discovery sections; desk-research labeling when no survey exists; compressed all-section contract.  
Second-order: fake survey methodology legitimizes otherwise unsupported findings.  
Third-order: fabricated cross-tabs can misdirect policy or regional strategy.

### OMEGA-COMPLIANCE

Strengths: criterion/evidence/findings, risk inventory, recommendations, response.  
Risks:
- Management response cannot be synthesized “verbatim.”
- GAGAS/COSO/CSRD applicability is jurisdiction and engagement dependent.
- Residual-risk scores, owners and control effectiveness require assessment evidence.
- Transmittal/signature/independence language can imply an official audit engagement.
Fix applied: no invented responses, owners, audit sufficiency or compliance claims; observations separated from criteria/inference.  
Second-order: false “compliant” findings reduce remediation urgency.  
Third-order: official-looking formatting may be mistaken for legal assurance.

### OMEGA-BUILD

Strengths: current/target architecture, opportunity portfolio, waves, business case, operating model and change.  
Risks:
- Current-state inventory and maturity scores require discovery data.
- Vendor/platform recommendations can become biased by style hooks.
- TCO/NPV/payback and architecture claims invite unsupported precision.
- Security frameworks may be cited outside their applicability.
Fix applied: current-state data gaps vs proposed target state; no invented certification/cost/benefit.  
Second-order: fictional current-state assumptions contaminate target architecture.  
Third-order: a fabricated business case can lock in procurement and operating-model decisions.

### OMEGA-SCIENCE

Strengths: rigorous academic structure, methodology, limitations and reproducibility.  
Risks:
- A proposal forced into IMRAD produces fabricated Results.
- PRISMA requires actual searches, counts, protocol and screening—not prose simulation.
- Methods hints encourage invented sample/effect/p-values/CI/ethics approval.
- Front matter encourages invented authors, ORCID, funding and COI.
Fix applied: task-type classification and explicit prohibition on invented results, approvals, registration, numbers, authorship and DOI.  
Second-order: invented Results make the Discussion and Conclusions appear empirically grounded.  
Third-order: fake ethics/registration statements create publication-integrity and compliance exposure.

### NIH-GRANT-SRF

Strengths: aligned Factor 1/Factor 2 structure, aims, approach, human subjects, DMS.  
Risks:
- Exactly three aims is not universal and can create over-scoped projects.
- Preliminary data, IC fit, facilities and investigator capability must not be invented.
- Power/sample/ICC and recruitment assumptions need deterministic calculation and inputs.
- Human-subject and DMS language can imply institutional commitments.
Fix applied: proposal-status tags, non-fabrication rules, adaptable aim count.  
Second-order: fabricated feasibility evidence can mask an unfundable approach.  
Third-order: invented institutional resources or approvals can create submission-integrity problems.

### OMEGA-CRISIS

Strengths: immediate forecast, options, execution, governance and risk.  
Risks:
- Combines restructuring and federal procurement branches that should not coexist by default.
- Privilege and classification markings cannot be assigned by the model.
- Liquidity, creditors, PIID, CPARS, clearances, rates and legal clauses require authoritative inputs.
- Crisis recommendations have high consequence and short decision windows.
Fix applied: explicit draft-only status; no legal privilege/classification or official representations; require counsel/CO review.  
Second-order: invented liquidity or milestone assumptions change the selected option.  
Third-order: false official markings or representations can create legal/security exposure.

## Pipeline Loop Audit

### Best-of-N

- Fixed earlier token waste: hypotheses are compact outlines, winner only is expanded.
- Remaining risk: outline-density scoring is structural, not semantic. It may favor an outline that mentions “assumptions/citations/caveats” over one with a stronger central idea.
- Recommended future test: compare deterministic outline score against independent judge preference over 30 fixed prompts.

### HDIG

- Strength: targeted post-draft queries.
- Weakness: adds retrieved evidence after the initial draft; unsupported initial framing can anchor subsequent queries.
- Improvement applied indirectly: outline-first selection and template contract precede expansion; evidence rules constrain expansion.
- Remaining risk: retrieval query quality and source diversity need empirical evaluation.

### CoVe

- Strength: isolated verification calls reduce cross-contamination.
- Confirmed weakness: consistency is currently substring overlap, not entailment. Paraphrases and negation can be misclassified.
- Recommended next fix: deterministic numeric/date/entity comparison first, then one batched entailment judge for unresolved pairs.

### N-Deep

- Fixed whole-document rewrites: only explicit section/paragraph patches are permitted.
- Fixed duplicate flat passes: stop when no anchorable or improving patch exists.
- Fixed priority: critical → major → warning.
- Fixed citation contradiction and valid source range.
- Remaining risk: defect-to-section localization is delegated to the model; malformed anchors cause early stop rather than repair.

### Adversarial Review

- Fixed cosmetic-only behavior: blocking defects now trigger repair before polish/judge.
- Remaining risk: only one adversarial repair is attempted; new blocking defects introduced by repair are not red-teamed again.

### Polish

- Monotonic score guard prevents degradation.
- Remaining risk: LLM polish can preserve a factual defect because it is explicitly content-conservative; this is correct behavior unless the defect was already surfaced upstream.

### Judging

- Fake 7.5 parse fallback removed; failures are excluded and surfaced.
- Remaining risk: single-judge default has high variance; multiple judges improve reliability but consume RPM/RPD.

## UI/Defaults/Routing Audit

- One effective calibration page is rendered: package `V15Overlay` resolves through Vite to the local overlay, whose calibration import resolves to the generated local enhanced page. The package source remains present on disk but is not a duplicate rendered page.
- Build-time patch script currently applies all expected anchors and fails loudly on a missing anchor.
- Defaults: V15 enabled unless explicitly disabled; one batch question; 4-Stage on; N-Deep 3; Cluster 5; SLOOP 4 pages; OMEGA-STRATEGY; Sentinel; adversarial, grounding, SearXNG and defense pack on.
- Known semantic tension: default `--bain-pe` maps to Diligence, while default template is Strategy. The new contract prevents substantive cross-import but the UI still presents this incompatible default combination for historical compatibility.

## Turn N+8 Additions — Next-Turn Investigation Queue (updated)

1. Build a deterministic template conformance test suite: all required headings once, no bare sections, no prohibited fabricated fields.
2. Replace CoVe substring consistency with structured field comparison + batched entailment fallback.
3. Run a testbed-gate false-positive benchmark on known-good reports; 85–115 hits per answer suggests several regexes are too broad.
4. Re-red-team adversarial repairs once, with a hard two-pass cap, to detect newly introduced blockers.
5. Calibrate outline-density scoring against independent preferences and add task/template coverage features.
6. Evaluate changing the historical default style from `--bain-pe` to `--bain-strategy`; currently compatibility is preserved, not ideal semantic alignment.
7. Harden `script.js` into a declarative patch manifest with expected patch count and post-generation assertions.

## Verification Limit

Production builds pass. Live LLM quality, external search uptime, and visual pixel parity could not be exercised through a browser/API harness in this environment. Claims above distinguish source-proven defects from empirical risks requiring live runs.