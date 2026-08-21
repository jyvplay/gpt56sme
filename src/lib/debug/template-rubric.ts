/**
 * template-rubric.ts — NET-NEW (Type C). See flatten-guide.md.
 * ===========================================================================
 * WHAT A "10-RATED REPORT" LOOKS LIKE FOR THIS PIPELINE, GROUND-TRUTHED.
 *
 * The diagnosis engine (pipeline-diagnosis.ts) needs a concrete, per-template
 * target — not a generic rubric. This module loads that target from the
 * package's own authoritative sources so the rubric is always in sync with
 * what the pipeline was TOLD to produce:
 *
 *   · OMEGA_TEMPLATES         — section registry per template id
 *   · buildTemplatePrompt      — the exact prompt injected as directive
 *   · ARCHETYPES / getPersonaDirective — Williams style contract
 *   · Innovation Genome v1     — dimensions + selected discovery path
 *   · Innovation Genome v2     — extended persona + domain pack + risk tier
 *   · V10 Creative Tree        — from window._VERITAS_V10_DISCOVERY (captured live)
 *
 * Everything here is a READ. This module never mutates pipeline state.
 * ===========================================================================
 */
import {
  OMEGA_TEMPLATES,
  STYLE_OVERRIDES,
  findTemplate,
  buildTemplatePrompt,
  type OmegaTemplate,
  type OmegaSection,
} from '@/lib/omega-templates';
import { ARCHETYPES } from '@/lib/williams-style';
// Genome v1 (base) — dimensions, personas, discovery paths
import {
  DIMENSIONS as GENOME_V1_DIMENSIONS,
  PERSONAS as GENOME_V1_PERSONAS,
  seedToGenome,
  classifyPersona as classifyPersonaV1,
  selectPath as selectPathV1,
  compileCompactDirective as compileGenomeV1Directive,
  roll as rollGenomeV1,
  type Genome,
  type InnovationGenomeResult,
} from "../innovation-genome-engine.orig";
// Genome v2 (extended) — extended personas, mutations, domain packs, risk tiers
import {
  EXTENDED_PERSONAS as GENOME_V2_PERSONAS,
  DOMAIN_PACKS,
  classifyPersonaExtended,
  selectPathExtended,
  compileCompactDirectiveV2,
  rollV2,
  inferInnovationDomain,
  newInnovationSeed,
  type InnovationGenomeV2,
} from "../innovation-genome-engine-v2.orig";

export interface SectionCriterion {
  id: string;
  title: string;
  purpose: string;
  /** Structural markers the section should contain to score ≥9. */
  requiredMarkers: string[];
  /** Sentinel phrases that, if present, PREVENT a 10 (data gaps, placeholders). */
  antiMarkers: string[];
  /** Deterministic detectors mapped to a 0-10 sub-score. */
  detectors: Array<(sectionText: string) => { score: number; evidence: string }>;
}

export interface TemplateRubric {
  templateId: string;
  templateName: string;
  archetype: string;
  personaVoice: string;
  personaDirective: string;
  styleOverrideCode: string | null;
  styleOverrideLabel: string | null;
  /** The literal prompt the pipeline injects. Kept verbatim, never truncated. */
  buildPrompt: string;
  sections: SectionCriterion[];
  /** What the pipeline MUST produce to earn a 10 on this template. */
  tenPointContract: string[];
}

/** Sub-scorers for section quality — pure, reproducible, no network. */
function detectorCitationDensity(section: string): { score: number; evidence: string } {
  const cites = (section.match(/\[[Ss]?\d{1,3}\]/g) ?? []).length;
  const words = Math.max(1, section.split(/\s+/).length);
  const density = (cites / words) * 100;
  const score =
    density === 0 ? 1 : density < 0.4 ? 3 : density < 1.0 ? 6 : density < 2.5 ? 9 : 10;
  return { score, evidence: `${cites} citation tag(s) across ${words} words (${density.toFixed(2)}/100w)` };
}
function detectorPlaceholders(section: string): { score: number; evidence: string } {
  const gaps =
    (section.match(/\[DATA GAP\]/gi) ?? []).length +
    (section.match(/\[ASSUMPTION\]/gi) ?? []).length +
    (section.match(/\[TBD\]/gi) ?? []).length +
    (section.match(/\bTBD\b/gi) ?? []).length +
    (section.match(/\[PROPOSED\]/gi) ?? []).length;
  const score = gaps === 0 ? 10 : gaps === 1 ? 6 : gaps <= 3 ? 4 : 2;
  return { score, evidence: `${gaps} unresolved placeholder(s)` };
}
function detectorTruncation(section: string): { score: number; evidence: string } {
  const trailing = /[a-z]\s+(and|but|or|which|that|because|however|so|thereby|although|by)\s*[.!]?\s*$/i.test(section.trim());
  const midCut = /\b(is|are|was|were|has|have|will|can|should)\s*$/i.test(section.trim());
  const bad = trailing || midCut;
  return { score: bad ? 1 : 10, evidence: bad ? "trails off on a connector or auxiliary" : "sentence completion clean" };
}
function detectorNumericSpecificity(section: string): { score: number; evidence: string } {
  const nums = (section.match(/\b\d[\d,.]*\s?(%|USD|\$|billion|million|bps|x|years?|months?|Q[1-4])\b/gi) ?? []).length;
  const score = nums === 0 ? 2 : nums < 3 ? 5 : nums < 8 ? 8 : 10;
  return { score, evidence: `${nums} quantified figure(s)` };
}
function detectorActionability(section: string): { score: number; evidence: string } {
  const verbs = (section.match(/\b(recommend|proceed|approve|reject|prioritise|prioritize|deprioritize|invest|divest|hire|contract|deploy|kill|pause|escalate|deadline)\b/gi) ?? []).length;
  const score = verbs === 0 ? 3 : verbs < 2 ? 6 : verbs < 5 ? 8 : 10;
  return { score, evidence: `${verbs} action verb(s)` };
}

/** Section-specific marker library derived from OMEGA_TEMPLATES structure. */
const SECTION_HINTS: Record<string, { markers: string[]; anti: string[]; detectors: Array<(s: string) => { score: number; evidence: string }> }> = {
  BLUF: {
    markers: ["Decision Trigger", "Value at Stake", "Recommendation", "Deadline"],
    anti: ["It depends", "further analysis"],
    detectors: [detectorPlaceholders, detectorTruncation, detectorNumericSpecificity, detectorActionability],
  },
  "Situation (SCQA)": {
    markers: ["Baseline State", "Complication", "Decision Question"],
    anti: [],
    detectors: [detectorTruncation, detectorCitationDensity],
  },
  "Diagnostic (T-Bar)": {
    markers: ["Market Dynamics", "Competitive Position", "Trade-off"],
    anti: [],
    detectors: [detectorCitationDensity, detectorNumericSpecificity],
  },
  Recommendation: {
    markers: ["Next Step", "Owner", "Threshold"],
    anti: ["It depends"],
    detectors: [detectorActionability, detectorPlaceholders],
  },
  References: {
    markers: ["[S", "http", "DOI"],
    anti: ["Untitled", "source-1", "source-2"],
    detectors: [
      (s) => {
        const trusted = (s.match(/https?:\/\/[^\s)]+/g) ?? []).length;
        return { score: trusted === 0 ? 1 : trusted < 3 ? 5 : 10, evidence: `${trusted} resolvable URL(s)` };
      },
    ],
  },
};
const DEFAULT_DETECTORS = [detectorPlaceholders, detectorTruncation, detectorCitationDensity];

function buildSectionCriteria(section: OmegaSection): SectionCriterion {
  const hint = SECTION_HINTS[section.title] ?? SECTION_HINTS[section.id] ?? null;
  return {
    id: section.id,
    title: section.title,
    // Field name in package is `hint`, not `purpose`.
    purpose: (section as any).hint ?? "",
    requiredMarkers: hint?.markers ?? [],
    antiMarkers: hint?.anti ?? [],
    detectors: hint?.detectors ?? DEFAULT_DETECTORS,
  };
}

export function loadTemplateRubric(
  templateId: string,
  styleOverrideCode?: string | null,
  williamsPersona?: string | null
): TemplateRubric | null {
  const tpl = findTemplate(OMEGA_TEMPLATES as OmegaTemplate[], templateId);
  if (!tpl) return null;
  // Package `StyleOverride` uses `token` + `legacy` (not `code` + `label`).
  const override = styleOverrideCode
    ? (STYLE_OVERRIDES as any[]).find((s) => s.token === styleOverrideCode || s.code === styleOverrideCode) ?? null
    : null;
  // `OmegaTemplate` has no `archetype` field — the template id IS the archetype.
  const archetypeName = williamsPersona || (tpl as any).archetype || tpl.id;
  const archetype = (ARCHETYPES as readonly any[]).find((a) => a.name === archetypeName);
  const personaDirective = archetype ? renderPersonaDirective(archetype) : "(no matched archetype)";

  // NO TRUNCATION. This is the exact string the pipeline uses as directive.
  const buildPrompt = buildTemplatePrompt(tpl, override?.token ?? override?.code ?? "");

  return {
    templateId: tpl.id,
    templateName: tpl.name ?? tpl.id,
    archetype: archetypeName ?? "(unset)",
    personaVoice: archetype?.voice ?? archetype?.desc ?? "",
    personaDirective,
    styleOverrideCode: override?.token ?? override?.code ?? null,
    styleOverrideLabel: override?.legacy ?? override?.label ?? null,
    buildPrompt,
    sections: tpl.sections.map(buildSectionCriteria),
    tenPointContract: buildTenPointContract(tpl),
  };
}

function renderPersonaDirective(a: any): string {
  if (typeof a?.directive === "string") return a.directive;
  const parts: string[] = [];
  if (a?.voice) parts.push(`Voice: ${a.voice}`);
  if (Array.isArray(a?.do)) parts.push(`DO: ${a.do.join(" · ")}`);
  if (Array.isArray(a?.avoid)) parts.push(`AVOID: ${a.avoid.join(" · ")}`);
  if (a?.cadence) parts.push(`CADENCE: ${a.cadence}`);
  return parts.join("\n") || String(a?.name ?? "");
}

function buildTenPointContract(tpl: OmegaTemplate): string[] {
  return [
    `Every section named in ${tpl.id} appears with the section title verbatim.`,
    "Every load-bearing claim carries a resolvable citation tag [S#] mapped to a References section with a real URL.",
    "No [DATA GAP], [ASSUMPTION], [TBD], or [PROPOSED] placeholder survives the final pass.",
    "No sentence ends mid-clause on a connector word (and/but/or/which/that/because).",
    "Every numeric claim has a unit and a source; deterministic compute records exist for any calculation.",
    "CoVe-flagged claims are either verified or explicitly downgraded — never silently retained.",
    "Adversarial red-team blocking defects are resolved by a targeted repair pass, not a full rewrite.",
    "Style overlay honors the Williams archetype directive across all sections.",
    "Innovation genome directive is reflected in the discovery framing, not just prepended.",
    "Guard score ≥ 9.0 AND judge score ≥ 9.0 AND both agree within 1.0.",
  ];
}

// ── GENOME LOADERS ────────────────────────────────────────────────────────

export interface GenomeSnapshot {
  v1: InnovationGenomeResult;
  v2: InnovationGenomeV2;
  v10?: unknown;
  domain: string;
  seed: number;
  /** Compact v1 directive — full, untruncated. */
  directiveV1: string;
  /** Compact v2 directive — full, untruncated. */
  directiveV2: string;
}

export function computeGenomeSnapshot(problem: string, sharedSeed?: number): GenomeSnapshot {
  const seed = sharedSeed ?? newInnovationSeed();
  const domain = inferInnovationDomain(problem);
  const v1 = rollGenomeV1(seed, problem, String(domain));
  const v2 = rollV2({ seed, userProblem: problem, domain });
  const v10 = typeof window !== "undefined" ? (window as any)._VERITAS_V10_DISCOVERY : undefined;
  return {
    v1,
    v2,
    v10,
    domain: String(domain),
    seed,
    directiveV1: compileGenomeV1Directive(v1),
    directiveV2: compileCompactDirectiveV2(v2),
  };
}

/** Read whatever the running pipeline stored on window (populated by package v15-pipeline shim). */
export function readLiveGenome(): { v4?: unknown; v7?: unknown; v9?: unknown; v10?: unknown; v10Discovery?: unknown } {
  if (typeof window === "undefined") return {};
  const w = window as any;
  return {
    v4: w._VERITAS_V4_REPORT,
    v7: w._VERITAS_V7_AUDIT,
    v9: w._VERITAS_V9_AUDIT,
    v10: w._VERITAS_V10_DIAGNOSTICS,
    v10Discovery: w._VERITAS_V10_DISCOVERY,
  };
}

// Re-exports so downstream modules do not each drag in package paths.
export {
  OMEGA_TEMPLATES,
  STYLE_OVERRIDES,
  ARCHETYPES,
  GENOME_V1_DIMENSIONS,
  GENOME_V1_PERSONAS,
  GENOME_V2_PERSONAS,
  DOMAIN_PACKS,
  seedToGenome,
  classifyPersonaV1,
  classifyPersonaExtended,
  selectPathV1,
  selectPathExtended,
};
export type { OmegaTemplate, OmegaSection, Genome };

/** Extract sections from a rendered draft by heading. */
export function splitDraftBySections(draft: string, tpl: TemplateRubric): Record<string, string> {
  const out: Record<string, string> = {};
  if (!draft) return out;
  // Find each section title as a heading; capture until the next known title.
  const titles = tpl.sections.map((s) => s.title);
  const escaped = titles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const rx = new RegExp(
    `##\\s*(${escaped.join("|")})[\\s\\S]*?(?=##\\s*(?:${escaped.join("|")})|$)`,
    "gi"
  );
  for (const m of draft.matchAll(rx)) {
    const title = titles.find((t) => t.toLowerCase() === m[1].toLowerCase());
    if (title) out[title] = m[0];
  }
  return out;
}
