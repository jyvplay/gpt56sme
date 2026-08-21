/** Persistent template contract shared by calibration and production SLOOP. */
export * from "./omega-templates.base";
import {
  OMEGA_TEMPLATES,
  STYLE_OVERRIDES,
  type OmegaTemplate,
} from "./omega-templates.base";

const NON_FABRICATION_RULES: Record<string, string[]> = {
  "OMEGA-STRATEGY": [
    "Do not invent TAM/SAM/SOM, NPV, IRR, market share, competitor data, RACI owners, or deadlines. Compute only from supplied inputs; otherwise mark the exact data gap and provide a formula or decision rule.",
  ],
  "OMEGA-DILIGENCE": [
    "Do not invent management plans, customer interviews, NPS, retention, EBITDA adjustments, debt, valuation multiples, IRR, or MOIC. Separate sourced facts, analyst inference, and diligence requests.",
    "A verdict may be CONDITIONAL when load-bearing diligence evidence is absent; state the conditions explicitly.",
  ],
  "OMEGA-DISCOVERY": [
    "Do not invent survey respondents, field dates, weighting, cross-tabs, regional findings, quotes, or statistics. If no survey was performed, label the methodology as desk research and omit survey claims.",
  ],
  "OMEGA-COMPLIANCE": [
    "Do not claim an audit standard was satisfied, quote management responses, assign control owners, calculate residual risk, or assert regulatory compliance without evidence. Distinguish observation, criterion, inference, and recommendation.",
  ],
  "OMEGA-BUILD": [
    "Do not invent application inventories, maturity scores, architecture state, vendor capabilities, costs, NPV, security certification, or adoption metrics. Use [PROPOSED] for target-state design and identify discovery inputs needed for current-state claims.",
  ],
  "OMEGA-SCIENCE": [
    "First classify the task as completed empirical study, protocol/proposal, systematic review, or narrative review. Never put hypothetical or projected findings under Results; use Expected Outcomes for proposals/protocols.",
    "Do not invent sample size, effect size, p-values, confidence intervals, ethics approval, registration, PRISMA counts, data availability, authors, ORCIDs, funding, or DOIs.",
  ],
  "NIH-GRANT-SRF": [
    "Treat the document as a proposal: never fabricate preliminary data, IRB approval, recruitment performance, facilities, investigator expertise, award mechanism fit, or NIH Institute interest. Label unverified design choices [PROPOSED].",
    "Do not force exactly three aims when the question or mechanism supports fewer; aims must be independently interpretable and collectively coherent.",
  ],
  "OMEGA-CRISIS": [
    "Do not assert attorney-client privilege, classification, CUI/SECRET markings, FAR/DFARS applicability, liquidity, creditor positions, PIIDs, CPARS, clearances, labor rates, or court facts without authoritative input.",
    "Never generate official markings or representations of legal privilege; provide a clearly labeled draft framework requiring counsel/contracting-officer review.",
  ],
};

export function getOmegaTemplate(id?: string): OmegaTemplate | undefined {
  return OMEGA_TEMPLATES.find(t => t.id === id);
}

/**
 * Build a page-aware, evidence-safe template contract. Every main section is
 * retained; a small page target compresses sections instead of deleting them.
 */
export function buildAdaptiveTemplateContract(opts: {
  templateId?: string;
  styleOverride?: string;
  targetPages?: number;
  evidenceAvailable?: boolean;
}): string {
  const t = getOmegaTemplate(opts.templateId);
  if (!t) return "";
  const pages = Math.max(1, opts.targetPages ?? 4);
  const targetWords = Math.max(700, pages * 550);
  const substantive = t.sections.filter(s => !/^§A/.test(s.id));
  const perSection = Math.max(90, Math.floor(targetWords / Math.max(1, substantive.length)));
  const style = STYLE_OVERRIDES.find(s => s.token === opts.styleOverride);
  const mismatch = style && style.mapsTo !== t.id;
  const sections = t.sections.map((s, i) => {
    const appendix = /^§A/.test(s.id);
    return `${i + 1}. ## ${s.title}\n   Contract: ${s.hint}\n   Budget: ${appendix ? "compact appendix / evidence ledger" : `~${perSection} words; substantive, no bare heading`}`;
  }).join("\n");
  const evidenceRules = NON_FABRICATION_RULES[t.id] ?? [];
  return [
    `AUTHORITATIVE OUTPUT CONTRACT: ${t.id} — ${t.tagline}`,
    `Target: approximately ${pages} page(s) / ${targetWords} words. Preserve ALL main sections below in order; compress depth proportionally rather than deleting later sections.`,
    "Use the exact Markdown headings below. A section may be marked 'Not applicable — <specific reason>' only when genuinely outside the user's task; never leave a bare heading.",
    sections,
    "",
    "EVIDENCE AND STATUS RULES:",
    "- Tag design choices or future actions [PROPOSED], unresolved inputs [DATA GAP], and explicit assumptions [ASSUMPTION]. Do not present any of these as observed fact.",
    "- Cite only retrieved source IDs actually present in the evidence block. If evidence is unavailable, do not manufacture a bibliography or URL.",
    "- Never manufacture interviews, survey samples, financial statements, regulatory determinations, study results, named personnel, official responses, approvals, classifications, or audit evidence.",
    ...evidenceRules.map(r => `- ${r}`),
    opts.evidenceAvailable ? "- Retrieved evidence is available; bind every load-bearing factual claim to it." : "- No retrieved evidence is available; limit factual claims, state uncertainty, and emphasize the verification plan.",
    "",
    `STYLE OVERRIDE: ${opts.styleOverride || "none"}. ${style ? style.hooks : "Apply no legacy-specific hooks."}`,
    mismatch
      ? `STYLE/TEMPLATE CONFLICT RESOLUTION: ${style!.token} normally maps to ${style!.mapsTo}, not ${t.id}. Apply only compatible voice/layout characteristics; DO NOT import the other template's substantive sections, evidence claims, or metrics.`
      : "Style must never override section semantics, evidence rules, safety, or factual status.",
  ].join("\n");
}

/** Backward-compatible production prompt, now evidence-safe. */
export function buildTemplatePrompt(t: OmegaTemplate, styleMode: string): string {
  return buildAdaptiveTemplateContract({ templateId: t.id, styleOverride: styleMode, targetPages: 8, evidenceAvailable: true });
}

// ─── Template-Directed Search Queries ──────────────────────────────────────
// Instead of a single heuristic query, each template generates explicit,
// per-section search queries that target the EXACT evidence each section needs.
// This replaces generic "search for the question" with structured evidence acquisition.

const SECTION_SEARCH_PATTERNS: Record<string, Record<string, string[]>> = {
  "OMEGA-STRATEGY": {
    "BLUF": ["{topic} strategic recommendation decision"],
    "Situation (SCQA)": ["{topic} market overview current state 2024 2025", "{topic} industry challenges complication"],
    "Diagnostic (T-Bar)": ["{topic} market size TAM SAM SOM", "{topic} competitive landscape market share", "{topic} root cause analysis industry issues"],
    "Options Tournament": ["{topic} strategic options alternatives comparison", "{topic} case study successful strategy"],
    "Recommendation & Value Bridge": ["{topic} value creation levers quantified impact", "{topic} NPV IRR business case"],
    "Implementation (Wave Architecture)": ["{topic} implementation roadmap phases timeline", "{topic} KPI metrics dashboard"],
    "Risk Register & Assumption Ledger": ["{topic} key risks mitigation strategy", "{topic} market risk factors sensitivity"],
  },
  "OMEGA-DILIGENCE": {
    "Investment Thesis": ["{topic} investment thesis bull bear case"],
    "Market Attractiveness": ["{topic} market size growth rate addressable market", "{topic} Porter five forces industry analysis"],
    "Competitive Position & Moat": ["{topic} competitive advantage market share moat", "{topic} switching costs barriers to entry"],
    "Commercial Diligence": ["{topic} customer satisfaction NPS retention churn", "{topic} revenue quality customer concentration"],
    "Financial Diligence & QofE": ["{topic} EBITDA quality of earnings adjusted", "{topic} working capital capex analysis"],
    "Value Creation Plan": ["{topic} value creation EBITDA bridge margin improvement", "{topic} IRR MOIC return analysis"],
    "Risk Register": ["{topic} investment risk factors due diligence red flags"],
  },
  "OMEGA-DISCOVERY": {
    "Methodology Note": ["{topic} research methodology survey design"],
    "The Big Idea / Central Thesis": ["{topic} emerging trend disruption paradigm shift 2025 2026"],
    "Thematic Deep Dives (3-7 chapters)": ["{topic} key findings data analysis", "{topic} case study leader vs laggard", "{topic} quantified impact research evidence"],
    "Regional / Sector Cuts": ["{topic} regional analysis Americas EMEA APAC", "{topic} sector comparison financial services healthcare technology"],
    "Horizon Scan": ["{topic} future outlook predictions 2025 2026 2027"],
    "Implications by Stakeholder": ["{topic} implications business leaders policymakers investors"],
  },
  "OMEGA-COMPLIANCE": {
    "Background & Regulatory Context": ["{topic} regulatory framework compliance requirements", "{topic} COSO ERM ISO 31000 GAGAS applicable standards"],
    "Methodology": ["{topic} audit methodology assessment approach"],
    "Findings (numbered)": ["{topic} compliance gaps findings deficiencies", "{topic} risk assessment audit findings"],
    "Risk Inventory & Heat Map": ["{topic} risk register heat map likelihood impact"],
    "Maturity Assessment": ["{topic} maturity model assessment benchmark"],
    "Recommendations": ["{topic} remediation recommendations improvement plan"],
  },
  "OMEGA-BUILD": {
    "Current State Architecture": ["{topic} current IT architecture application landscape", "{topic} technology debt assessment"],
    "Maturity Assessment": ["{topic} digital maturity assessment benchmark"],
    "Opportunity Portfolio": ["{topic} digital transformation opportunities use cases"],
    "Future State Architecture": ["{topic} target architecture cloud strategy AI platform"],
    "AI & Automation Roadmap": ["{topic} AI use cases automation roadmap GenAI"],
    "Business Case": ["{topic} digital transformation business case TCO ROI NPV"],
  },
  "OMEGA-SCIENCE": {
    "Introduction": ["{topic} literature review research gap background"],
    "Methods": ["{topic} research methodology study design sample size"],
    "Results": ["{topic} research findings results data analysis"],
    "Discussion": ["{topic} interpretation comparison prior literature implications"],
  },
  "NIH-GRANT-SRF": {
    "Specific Aims": ["{topic} NIH research aims hypothesis objectives"],
    "Factor 1: Importance of the Research": ["{topic} significance innovation prior research rigor", "{topic} health disparity unmet need public health impact"],
    "Factor 2: Rigor and Feasibility of the Approach": ["{topic} methodology feasibility sample size power analysis", "{topic} statistical approach SABV biological variable"],
  },
  "OMEGA-CRISIS": {
    "Situation Overview": ["{topic} crisis current situation liquidity assessment"],
    "Immediate-Term Forecast": ["{topic} 13-week cash flow forecast liquidity runway"],
    "Operational Assessment": ["{topic} operational performance cost structure assessment"],
    "Strategic Options": ["{topic} restructuring options turnaround alternatives"],
    "Execution Plan": ["{topic} restructuring implementation timeline milestones"],
  },
};

/**
 * Generate explicit, per-section search queries for a given template and user question.
 * Returns an array of { section, queries } objects that the grounding system
 * should execute instead of (or in addition to) a single generic query.
 */
export function buildTemplateSearchQueries(templateId: string, userQuestion: string): Array<{ section: string; queries: string[] }> {
  const patterns = SECTION_SEARCH_PATTERNS[templateId];
  if (!patterns) return [{ section: "general", queries: [userQuestion] }];

  // Extract the core topic from the user question (strip common question prefixes)
  const topic = userQuestion
    .replace(/^(please |can you |could you |find me |help me |write |create |produce |generate |draft )/gi, "")
    .replace(/\b(a report|an analysis|a strategy|a plan|a proposal)\b/gi, "")
    .trim()
    .slice(0, 120) || userQuestion.slice(0, 120);

  const result: Array<{ section: string; queries: string[] }> = [];
  for (const [section, queryPatterns] of Object.entries(patterns)) {
    const queries = queryPatterns.map(p => p.replace("{topic}", topic));
    result.push({ section, queries });
  }
  return result;
}

// ─── Hand-Trace Appendix Builder ───────────────────────────────────────────
// For any math, logic, or analytical claim in the output, this generates
// a step-by-step derivation appendix that a human can audit on paper.

export function buildHandTraceInstruction(templateId?: string): string {
  const lines = [
    "",
    "HAND-TRACE APPENDIX REQUIREMENT:",
    "At the END of the report, add a section titled '## Appendix: Analytical Hand-Trace'.",
    "For EVERY quantitative claim, formula, calculation, logical deduction, or analytical assertion in the report, provide:",
    "  1. CLAIM: The exact claim as stated in the body (quote it).",
    "  2. DERIVATION: Step-by-step breakdown showing how the number/conclusion was reached.",
    "     - If from a source: cite [S#] and quote the exact passage that supports it.",
    "     - If computed: show the formula, each input value with its source, and the arithmetic.",
    "     - If inferred: state the premises, the inference rule, and the conclusion.",
    "     - If assumed: label it [ASSUMPTION] and state what would change if the assumption is wrong.",
    "  3. VERIFICATION STATUS: One of:",
    "     - [SOURCED] — directly stated in a cited source",
    "     - [COMPUTED] — derived from sourced inputs via transparent arithmetic",
    "     - [INFERRED] — logically derived from sourced premises",
    "     - [ASSUMED] — not verifiable from available evidence",
    "     - [DATA GAP] — required input is missing; claim is conditional",
    "",
    "This appendix must be machine-auditable: every claim must trace to either a source citation or a transparent derivation chain. No claim in the body should lack a corresponding hand-trace entry.",
  ];

  // Template-specific trace requirements
  if (templateId === "OMEGA-STRATEGY" || templateId === "OMEGA-DILIGENCE") {
    lines.push("  - For financial claims (NPV, IRR, MOIC, TAM/SAM/SOM): show the full formula, discount rate, cash flow assumptions, and sensitivity range.");
    lines.push("  - For market sizing: show bottom-up and/or top-down methodology with each input cited.");
  }
  if (templateId === "OMEGA-SCIENCE" || templateId === "NIH-GRANT-SRF") {
    lines.push("  - For statistical claims: show the test used, sample size, effect size, p-value, confidence interval, and power calculation inputs.");
    lines.push("  - For study design claims: trace each design choice to its methodological justification.");
  }
  if (templateId === "OMEGA-COMPLIANCE") {
    lines.push("  - For risk scores: show the likelihood and impact ratings with their evidence basis.");
    lines.push("  - For regulatory citations: provide the exact statute/regulation section number.");
  }

  return lines.join("\n");
}