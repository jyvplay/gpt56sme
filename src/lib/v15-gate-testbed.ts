import { geminiGenerate } from "./v15-gemini";

const K_ENABLED = "veritas.v15.advancedGates.enabled";
const K_GATES = "veritas.v15.advancedGates.rules";

export interface TestbedGate { id: string; code: string; severity: "warning" | "major" | "critical"; message: string; remediation: string; regex: string; flags?: string; createdAt: number; hits: number; sourceModel?: string }
export interface TestbedGateIssue { severity: "warning" | "major" | "critical"; code: string; message: string; remediation: string; gateId: string }

export function getAdvancedGatesEnabled(): boolean { try { return localStorage.getItem(K_ENABLED) !== "false"; } catch { return true; } }
export function setAdvancedGatesEnabled(on: boolean): void { try { localStorage.setItem(K_ENABLED, String(on)); } catch {} }

// ── Advanced testbed catalog ─────────────────────────────────────────────
// Tuple shape: [code, severity, message, remediation, regex, flags]
// Narrow patterns only — every regex targets a specific, high-precision defect
// so the deterministic guard never fires on healthy prose. Severity is chosen
// conservatively: "warning" for cosmetic/soft signals, "major" for real
// content defects, "critical" only for safety / integrity failures.
type GateTuple = [string, TestbedGate["severity"], string, string, string, string];

const GATE_TUPLES: GateTuple[] = [
  // ── Core (prior turns) ──────────────────────────────────────────────
  ["UNCLOSED_CODE_BLOCK", "major", "Unclosed code block", "Close every code fence.", "```(?![\\s\\S]*```)", "s"],
  ["INCOMPLETE_RESPONSE", "major", "Response ends with incomplete token", "Rewrite a complete answer.", "\\(e$|\\(e\\s*$", "i"],
  ["HALLUCINATED_CITATION", "major", "Citation tag without references", "Add a References section or remove tags.", "\\[S\\d+\\](?![\\s\\S]*References:?)", "i"],
  ["MISSING_CITATION_REFERENCE", "major", "Citation tag lacks source list", "Ground or remove citation tags.", "\\[S[0-9]+\\](?![\\s\\S]*References)", "i"],
  ["MISSING_CITATION_REF", "major", "Citation without any References block", "Add a References section listing each [S#].", "\\[S\\d+\\](?!.*References)", "i"],
  ["HAL_CITE_REF_VOID", "major", "Reference entry is a void/empty placeholder", "Replace void reference text with a real source.", "\\[S\\d\\]:\\s*(?:Fragmentary|Useless|Empty|No relevant)", "i"],
  ["INCOMPLETE_THOUGHT", "major", "Output ends mid-thought", "Finish every sentence with punctuation.", "(Intergenerational|parental|the|to|of|is|and|a|an)\\s*$", "i"],
  ["INCOMPLETE_THOUGHT_TRUNCATION", "major", "Lowercase trailing word suggests truncation", "Regenerate the final paragraph completely.", "[a-z]{2,}\\s*$", "i"],
  ["INCOMPLETE_CITATION_FORMAT", "warning", "Malformed citation format", "Use complete [S#] citations.", "\\[S\\d+(?:,\\s*S\\s*$)", "i"],
  ["INCOMPLETE_MATH_FORMULA", "major", "Incomplete math expression", "Complete or remove malformed formula.", "D_m\\s*=\\s*\\(|\\|C_m\\s*$", "i"],
  ["MATH_HALLUCINATION_PATTERN", "critical", "Malformed math fragment", "Regenerate equations with valid syntax and units.", "\\\\Delta\\s*$|\\\\frac\\s*$|\\d+\\s*\\+\\s*\\\\\\s*$", "i"],
  ["INTERNAL_PROMPT_LEAK", "critical", "Internal prompt leaked", "Remove internal prompts and regenerate user-facing answer.", "(Meticulous Technical Editor|Recursive Refinement Pass|TESTBED_UNSAFE|ORIG_DEFENSE)", "i"],
  ["LLM_PROMPT_LEAKAGE_META_INSTRUCTION", "major", "Meta-instruction leaked", "Remove judge/editor metadata.", "^(Meticulous Technical Editor|Recursive Refinement Pass|JUDGE_NOTE:)", "i"],
  ["LLM_GEN_TEMPLATE_LEAK", "major", "Generation template leaked", "Remove template markers.", "(JUDGE_NOTE|CITES_WITH_NO_SOURCES|ORIG_DEFENSE)", "i"],
  ["HALLUCINATED_BIBLIOGRAPHY", "warning", "Likely fabricated bibliography", "Verify against retrieved evidence.", "\\[S[1-9]\\]\\s+(Ammonia|lithium-ion)", "i"],
  ["HALLUCINATED_SOURCES", "critical", "Fabricated source title detected", "Remove fabricated source and rerun grounding.", "\\[S[1-9]\\]:?\\s*(?:Fragment|Incomplete|Renewable energy|South Korea)", "i"],
  ["UNSAFE_ADOLESCENT_TARGETING", "critical", "Cannabis content targets minors", "Rewrite for adult-only legal context and remove minor-targeting.", "(adolescent|teen|minor)(?=[\\s\\S]*(cannabis|marijuana))", "i"],

  // ── Truncation / incompleteness family (narrow) ─────────────────────
  ["TRUNC_TRAILING_CONNECTOR", "major", "Ends on a dangling connector word", "Complete the sentence after the connector.", "\\b(because|however|therefore|thus|since|while|whereas|although|which|that)\\s*$", "i"],
  ["TRUNC_TRAILING_COMMA", "major", "Ends on a comma", "Finish the clause following the comma.", ",\\s*$", ""],
  ["TRUNC_TRAILING_COLON", "major", "Ends on a colon with no list/body", "Provide the content the colon introduces.", ":\\s*$", ""],
  ["TRUNC_TRAILING_SEMICOLON", "warning", "Ends on a semicolon", "Complete the second independent clause.", ";\\s*$", ""],
  ["TRUNC_TRAILING_HYPHEN", "major", "Ends on a hyphen/dash", "Finish the interrupted phrase.", "[-\\u2013\\u2014]\\s*$", ""],
  ["TRUNC_TRAILING_OPEN_PAREN", "major", "Unbalanced trailing open parenthesis", "Close the parenthesis or finish the aside.", "\\([^)]*$", ""],
  ["TRUNC_TRAILING_ELLIPSIS_WORD", "warning", "Ends mid-thought with ellipsis", "Replace the ellipsis with a finished conclusion.", "\\w\\.\\.\\.\\s*$", ""],
  ["TRUNC_OPEN_BRACKET", "major", "Unclosed square bracket at end", "Close the bracket or remove it.", "\\[[^\\]]*$", ""],
  ["TRUNC_OPEN_BRACE", "major", "Unclosed brace at end", "Close the brace or complete the object.", "\\{[^}]*$", ""],
  ["TRUNC_MIDWORD_HEADING", "major", "Section heading with no body after it", "Add substantive prose under the final heading.", "\\n#{1,6}\\s+[^\\n]{0,80}$", ""],
  ["TRUNC_BULLET_EMPTY", "warning", "Trailing empty bullet marker", "Fill in or delete the empty bullet.", "\\n\\s*[-*+]\\s*$", ""],
  ["TRUNC_NUMBERED_EMPTY", "warning", "Trailing empty numbered item", "Fill in or delete the empty list item.", "\\n\\s*\\d+\\.\\s*$", ""],
  ["TRUNC_TABLE_ROW_OPEN", "warning", "Table row started but not closed", "Complete the table row or remove it.", "\\|[^|\\n]*$", ""],
  ["TRUNC_MID_WORD_HYPHENATION", "warning", "Word split by trailing hyphen", "Rejoin the hyphenated word.", "[A-Za-z]{2,}-\\s*$", ""],
  ["TRUNC_QUOTE_OPEN", "warning", "Opening quote never closed at end", "Close the quotation.", "[\"\\u201c][^\"\\u201d]{0,120}$", ""],
  ["TRUNC_ARTICLE_TAIL", "major", "Ends on an article (a/an/the)", "Continue with the noun phrase.", "\\b(a|an|the)\\s*$", "i"],
  ["TRUNC_PREPOSITION_TAIL", "major", "Ends on a preposition", "Complete the prepositional phrase.", "\\b(of|in|on|to|for|with|at|by|from|into|onto)\\s*$", "i"],
  ["TRUNC_AUX_VERB_TAIL", "major", "Ends on an auxiliary verb", "Complete the verb phrase.", "\\b(is|are|was|were|be|been|being|has|have|had|will|would|can|could|should|may|might)\\s*$", "i"],

  // ── Citation / evidence integrity ───────────────────────────────────
  ["CITE_SEQUENCE_GAP", "warning", "Citation numbering appears non-sequential start", "Number citations starting at [S1].", "\\[S(?:[2-9]|[1-9]\\d)\\](?![\\s\\S]*\\[S1\\])", ""],
  ["CITE_DUP_ADJACENT", "warning", "Same citation repeated adjacently", "Deduplicate consecutive identical citations.", "\\[S(\\d+)\\]\\s*\\[S\\1\\]", ""],
  ["CITE_LOWERCASE_TAG", "major", "Lowercase source tag [s#] is malformed", "Use uppercase [S#] tags.", "\\[s\\d+\\]", ""],
  ["CITE_SPACE_INSIDE", "warning", "Space inside citation tag", "Remove spaces inside [S#].", "\\[S\\s+\\d+\\]|\\[S\\d+\\s+\\]", ""],
  ["CITE_ALPHA_INDEX", "major", "Alphabetic citation index [a1]", "Use numeric [S#] citations.", "\\[[a-z]\\d+\\]", ""],
  ["CITE_TRUNCATED_TAIL", "major", "Citation tag followed by dangling fragment", "Complete or remove the trailing fragment.", "\\[S\\d+\\]\\s*[a-z]{1,3}\\s*$", "i"],
  ["REF_PLACEHOLDER_TBD", "major", "Reference entry is a TBD placeholder", "Replace TBD with a real reference.", "\\[S\\d\\]:?\\s*(?:TBD|TODO|placeholder|pending)", "i"],
  ["REF_URL_MISSING", "warning", "Reference lacks any URL or DOI", "Add a URL or DOI to each reference.", "References:?[\\s\\S]{0,40}\\[S\\d\\][^\\n]*\\n(?![\\s\\S]*https?://)", "i"],
  ["REF_GENERIC_TITLE", "warning", "Reference uses a generic non-title", "Cite the actual source title.", "\\[S\\d\\]:?\\s*(?:Untitled|Unknown|Various|Multiple sources)", "i"],
  ["CITE_FABRICATED_MARKER", "critical", "Explicit fabricated-source marker", "Remove any fabricated or hypothetical source.", "\\[S\\d\\]:?[^\\n]*(?:hypothetical|fabricated|made[- ]up|for illustration)", "i"],
  ["QUOTE_NO_SOURCE", "warning", "Long quotation with no adjacent citation", "Attribute quotations to a source.", "\"[^\"]{80,}\"(?![\\s\\S]{0,40}\\[S\\d+\\])", ""],

  // ── Prompt / system / template leakage ──────────────────────────────
  ["LEAK_SYSTEM_ROLE", "critical", "System/role header leaked", "Strip system/assistant role markers.", "^\\s*(system|assistant|user)\\s*:", "im"],
  ["LEAK_AS_AN_AI", "warning", "Boilerplate AI self-reference", "Remove 'As an AI' boilerplate.", "\\bas an (?:ai|a language model)\\b", "i"],
  ["LEAK_KNOWLEDGE_CUTOFF", "warning", "Unprompted knowledge-cutoff boilerplate", "Only mention cutoff when relevant.", "\\bknowledge cutoff\\b", "i"],
  ["LEAK_CANNOT_BROWSE", "warning", "Unhelpful 'cannot browse' disclaimer", "Use provided evidence instead of refusing.", "\\bI (?:cannot|can't) (?:browse|access the internet)\\b", "i"],
  ["LEAK_STEP_LABEL", "major", "Internal step label leaked (Step N:)", "Remove internal planning labels.", "^\\s*Step\\s*\\d+\\s*:\\s*(Plan|Draft|Critique|Polish)", "im"],
  ["LEAK_STAGE_LABEL", "major", "4-Stage micro-agent label leaked", "Emit only the polished answer.", "\\b(PLAN STAGE|DRAFT STAGE|CRITIQUE STAGE|POLISH STAGE)\\b", "i"],
  ["LEAK_RUBRIC", "major", "Scoring rubric leaked into answer", "Remove rubric/score scaffolding.", "\\b(HARD CAP|cap \\d|score 0-10|rubric)\\b", "i"],
  ["LEAK_GATE_CODE", "major", "Internal gate code leaked", "Remove TESTBED_/gate codes from output.", "\\bTESTBED_[A-Z_]+\\b", ""],
  ["LEAK_ADVERSARIAL_TAG", "major", "Adversarial engine tag leaked", "Remove ADV_ defect tags from output.", "\\bADV_[A-Z_]+\\b", ""],
  ["LEAK_PERSONA_NAME", "warning", "Williams persona name leaked", "Never name the style persona.", "\\bWilliams-style persona\\b", "i"],
  ["LEAK_TODO_NOTE", "major", "Developer TODO/FIXME leaked", "Remove TODO/FIXME notes.", "\\b(TODO|FIXME|XXX)\\b:", ""],
  ["LEAK_PLACEHOLDER_BRACKET", "major", "Unfilled [PLACEHOLDER] token", "Replace placeholder tokens with content.", "\\[(?:PLACEHOLDER|INSERT[^\\]]*|YOUR[^\\]]*|X{2,})\\]", "i"],
  ["LEAK_LOREM_IPSUM", "major", "Lorem ipsum filler text", "Replace filler with real content.", "\\blorem ipsum\\b", "i"],
  ["LEAK_CHAIN_OF_THOUGHT", "warning", "Explicit chain-of-thought marker", "Emit conclusions, not raw scratchpad.", "\\b(let me think|thinking step by step|chain of thought)\\b", "i"],

  // ── Placeholder / stub / non-answer ─────────────────────────────────
  ["STUB_I_CANNOT_HELP", "major", "Blanket refusal with no attempt", "Provide the best possible grounded answer.", "^\\s*I (?:cannot|can't|am unable to) (?:help|assist|answer)\\b", "i"],
  ["STUB_INSUFFICIENT_INFO_ONLY", "major", "Only says info is insufficient", "State assumptions and answer conditionally.", "^(?:There is|I have) (?:insufficient|not enough) (?:information|data)\\.?\\s*$", "i"],
  ["STUB_SECTION_TBD", "major", "Section body is TBD/placeholder", "Fill every section with substantive prose.", "\\n[^\\n]*\\b(TBD|to be determined|coming soon|section pending)\\b", "i"],
  ["STUB_ELLIPSIS_SECTION", "warning", "Section reduced to an ellipsis", "Write the section content.", "\\n\\s*\\.\\.\\.\\s*\\n", ""],
  ["STUB_REPEAT_QUESTION", "major", "Answer only restates the question", "Answer the question, do not echo it.", "^(?:You asked|Your question is|To answer your question about)\\b", "i"],
  ["STUB_GENERIC_OPENER", "warning", "Low-signal enthusiastic opener", "Open with substantive content.", "^\\s*(?:Great question|That's a (?:great|fantastic) (?:question|challenge)|What an interesting)", "i"],
  ["STUB_WILL_PROVIDE_LATER", "major", "Promises content instead of giving it", "Deliver the content now.", "\\b(?:I will|I'll|we will) (?:provide|explain|detail|cover) (?:this|that|it) (?:below|later|shortly)\\b", "i"],

  // ── Formatting defects ──────────────────────────────────────────────
  ["FMT_UNCLOSED_BOLD", "warning", "Bold marker opened near end without close", "Balance ** markdown emphasis.", "\\*\\*[^*\\n]{0,200}$", ""],
  ["FMT_UNCLOSED_INLINE_CODE", "warning", "Inline code opened near end without close", "Balance inline code backticks.", "`[^`\\n]{0,200}$", ""],
  ["FMT_UNCLOSED_MATH_INLINE", "warning", "Inline math opened near end without close", "Balance inline math delimiters.", "\\$[^$\\n]{1,200}$", ""],
  ["FMT_DOUBLE_HEADING_HASH", "warning", "Malformed heading (## text ##)", "Use leading heading marks only.", "^#{1,6}[^\\n]*#{1,6}\\s*$", "m"],
  ["FMT_STRAY_HTML_TAG", "warning", "Stray raw HTML tag in prose", "Remove leftover HTML tags.", "<(?:div|span|p|br|h[1-6])\\b[^>]*>", "i"],
  ["FMT_MOJIBAKE", "warning", "Encoding mojibake artifact", "Fix character encoding.", "(?:\\u00c3\\u00a2|\\u00e2\\u0080)", ""],
  ["FMT_TABLE_NO_HEADER_SEP", "warning", "Table missing header separator row", "Add the |---| separator row.", "\\|[^\\n]+\\|\\n(?!\\s*\\|?\\s*:?-{2,})", ""],
  ["FMT_REPEATED_HEADER", "warning", "Same heading text repeated", "Merge duplicate sections.", "(^#{1,6}\\s+[^\\n]+)\\n[\\s\\S]*\\n\\1$", "im"],

  // ── Repetition / degeneration ───────────────────────────────────────
  ["REPEAT_WORD_TRIPLE", "major", "Same word repeated three+ times", "Remove degenerate repetition.", "\\b(\\w+)\\s+\\1\\s+\\1\\b", "i"],
  ["REPEAT_BIGRAM", "warning", "Immediate bigram repetition", "Remove duplicated phrase.", "\\b(\\w+\\s+\\w+)\\s+\\1\\b", "i"],
  ["REPEAT_SENTENCE", "major", "Identical sentence repeated", "Remove the duplicated sentence.", "([.!?]\\s+)([A-Z][^.!?]{20,}[.!?])\\s+\\2", ""],
  ["REPEAT_PUNCT_RUN", "warning", "Excessive punctuation run", "Use single punctuation.", "[!?.]{4,}", ""],
  ["REPEAT_CHAR_RUN", "warning", "Character spam run", "Remove repeated character spam.", "(.)\\1{9,}", ""],

  // ── Numeric / units / computation ───────────────────────────────────
  ["NUM_BARE_FORMULA_ONLY", "major", "Formula given with no evaluated result", "Show the concrete evaluated number.", "=\\s*[A-Za-z][A-Za-z_]*\\s*$", ""],
  ["NUM_PERCENT_NO_BASE", "warning", "Percentage with no stated base", "State the base the percent applies to.", "\\b\\d{1,3}%\\b(?![\\s\\S]{0,60}(of|from|baseline|relative))", "i"],
  ["NUM_UNIT_TBD", "warning", "Unit written as TBD/units", "Provide the actual unit.", "\\b\\d+(?:\\.\\d+)?\\s*(?:units?|TBD)\\b", "i"],
  ["NUM_NAN_INF", "major", "NaN or Infinity in computed output", "Fix the computation producing NaN/Infinity.", "\\b(NaN|Infinity|-Infinity)\\b", ""],
  ["NUM_DIV_ZERO_TEXT", "major", "Division-by-zero artifact", "Handle the zero-denominator case.", "\\/\\s*0\\b(?![.\\d])", ""],
  ["NUM_PLACEHOLDER_DIGIT", "warning", "Placeholder numeral like 000 or XXX", "Insert the real figure.", "\\$?X{2,}\\b|\\b0{4,}\\b", ""],
  ["NUM_RANGE_INVERTED", "warning", "Range written high-to-low", "Order numeric ranges low-to-high.", "\\b(\\d{2,})\\s*(?:-|to)\\s*(\\d{2,})\\b", ""],

  // ── Safety / legal / ethics (narrow, high precision) ────────────────
  ["SAFETY_MINOR_SALES", "critical", "Selling controlled substance to minors", "Never target minors; adult-legal framing only.", "\\b(?:sell|market|advertise)[\\s\\S]{0,40}\\b(?:minors?|children|kids|under[- ]?21|under[- ]?18)\\b", "i"],
  ["SAFETY_DOSING_MINOR", "critical", "Dosing guidance aimed at minors", "Remove minor-directed dosing.", "\\b(?:dose|dosage|dosing)[\\s\\S]{0,40}\\b(?:child|teen|adolescent|minor)\\b", "i"],
  ["SAFETY_EVADE_LAW", "critical", "Advice to evade law enforcement/testing", "Do not advise evading law or drug testing.", "\\b(?:evade|beat|cheat|bypass)[\\s\\S]{0,25}\\b(?:law enforcement|drug test|police|customs)\\b", "i"],
  ["SAFETY_SYNTH_WEAPON", "critical", "Weapon/explosive synthesis request echo", "Refuse and remove dangerous synthesis detail.", "\\b(?:synthesi[sz]e|manufacture)[\\s\\S]{0,25}\\b(?:explosive|nerve agent|bioweapon)\\b", "i"],
  ["SAFETY_SELF_HARM_ENCOURAGE", "critical", "Self-harm encouragement", "Never encourage self-harm; provide help resources.", "\\byou should (?:kill yourself|end your life|harm yourself)\\b", "i"],
  ["SAFETY_MEDICAL_ABSOLUTE", "warning", "Absolute medical guarantee", "Avoid absolute medical guarantees.", "\\b(?:guaranteed to cure|100% safe|no side effects whatsoever)\\b", "i"],
  ["SAFETY_MISSING_JURISDICTION", "warning", "Legal claim without jurisdiction scope", "Add jurisdiction/scope caveat.", "\\b(?:it is legal|fully legal|perfectly legal)\\b(?![\\s\\S]{0,80}(jurisdiction|state|country|where))", "i"],

  // ── Hallucination / fabrication markers ─────────────────────────────
  ["HALL_FAKE_STAT_PRECISION", "warning", "Suspiciously precise unsourced stat", "Cite the source for precise statistics.", "\\b\\d{1,3}\\.\\d{2,}%\\b(?![\\s\\S]{0,40}\\[S\\d+\\])", ""],
  ["HALL_FAKE_STUDY_YEAR", "warning", "Named study year with no citation", "Attribute the study to a source.", "\\b(?:study|trial|survey) (?:in|from|conducted in) (?:19|20)\\d{2}\\b(?![\\s\\S]{0,40}\\[S\\d+\\])", "i"],
  ["HALL_FAKE_JOURNAL", "warning", "Journal reference with no DOI/URL", "Add DOI or URL for cited journals.", "\\b(?:Journal of|Proceedings of the)\\b(?![\\s\\S]{0,80}(doi|https?://))", "i"],
  ["HALL_EVERYONE_KNOWS", "warning", "Unfalsifiable appeal to common knowledge", "Ground claims in evidence.", "\\b(?:everyone knows|it is well known that|studies show)\\b(?![\\s\\S]{0,40}\\[S\\d+\\])", "i"],
  ["HALL_FABRICATED_QUOTE_ATTR", "warning", "Named-person quote without source", "Attribute quotations to a citation.", "\\b(?:said|stated|noted) (?:Dr\\.|Professor|Mr\\.|Ms\\.)\\s+[A-Z][a-z]+", ""],
  ["HALL_FICTIONAL_CANNABIS_PRODUCT", "warning", "Named product asserted as real without evidence", "Mark speculative products as concepts.", "\\bthe (?:first|only) (?:ever )?(?:cannabis|CBD|THC) [a-z]+ (?:on the market|available)\\b", "i"],

  // ── Coherence / structure ───────────────────────────────────────────
  ["COH_HEADING_NO_BODY_MID", "warning", "Empty heading followed by another heading", "Add body text between headings.", "\\n#{1,6}\\s+[^\\n]+\\n+#{1,6}\\s", ""],
  ["COH_CONCLUSION_MISSING", "warning", "Long report with no conclusion section", "Add a conclusion/recommendation section.", "^#{1,3}\\s+(?:Executive|Introduction)[\\s\\S]{1500,}$(?<!Conclusion|Recommendation|Next Steps)", "im"],
  ["COH_DUP_NUMBERING", "warning", "Duplicate list numbering (1. then 1.)", "Use sequential list numbers.", "\\n1\\.\\s[^\\n]+\\n1\\.\\s", ""],
  ["COH_ORPHAN_SUBHEAD", "warning", "Sub-heading before any top heading", "Add a parent heading.", "^###\\s(?![\\s\\S]*^#\\s)", "m"],
  ["COH_UNRESOLVED_REFERENCE", "warning", "Refers to a figure or table that doesn't exist", "Ensure all referenced figures/tables are present.", "\\b(?:As shown in (?:Figure|Table) \\d+)\\b(?![\\s\\S]*(?:Figure|Table) \\d+)", "i"],
  ["COH_CIRCULAR_DEFINITION", "warning", "Term defined by itself", "Provide a meaningful definition.", "\\b(\\w+) is defined as (?:a|an|the)?\\s*\\1\\b", "i"],
  ["COH_CONTRADICTORY_TRANSITION", "major", "However used without contrast", "Ensure transitions make logical sense.", "\\bHowever,[\\s\\S]{0,40}\\balso\\b", "i"],
  ["COH_ABRUPT_ENDING", "major", "Ends without a concluding sentence or period", "Add a proper conclusion.", "[^.!?\\n]\\s*$", ""],

  // ── Answer economy / relevance ──────────────────────────────────────
  ["REL_OFFTOPIC_WEATHER", "warning", "Irrelevant filler content", "Stay on the user's topic.", "\\b(?:speaking of the weather|on a related note, unrelated)\\b", "i"],
  ["REL_APOLOGY_SPAM", "warning", "Repeated apologies", "Apologize at most once, then help.", "\\b(?:I apologize|I'm sorry|sorry)\\b[\\s\\S]{0,120}\\b(?:I apologize|I'm sorry|sorry)\\b", "i"],
  ["REL_HEDGE_STACK", "warning", "Stacked vague hedges", "Commit to a grounded position.", "\\b(?:it depends|hard to say|could be|might be|possibly|perhaps)\\b[\\s\\S]{0,60}\\b(?:it depends|could be|might be|possibly|perhaps)\\b", "i"],
  ["REL_EXCESSIVE_CAVEATS", "warning", "Too many disclaimers", "State the disclaimer once and proceed.", "(?:Please note that|It is important to remember)[\\s\\S]{0,100}(?:Keep in mind|Additionally, note)", "i"],
  ["REL_WORD_SALAD", "major", "Incoherent string of buzzwords", "Use clear, concise terminology.", "\\b(?:synergize|leverage|paradigm shift|holistic|ecosystem)[\\s\\S]{0,50}\\b(?:synergize|leverage|paradigm shift|holistic|ecosystem)\\b", "i"],
  ["REL_REDUNDANT_PHRASING", "warning", "Redundant phrasing", "Use concise phrasing.", "\\b(?:absolutely essential|basic fundamentals|completely finish)\\b", "i"],
  ["REL_CLICHE_OPENER", "warning", "Cliché or generic opener", "Start directly with the core message.", "^\\s*(?:In today's fast-paced world|Since the dawn of time|It goes without saying)\\b", "i"],

  // ── Extended Safety & Ethics ─────────────────────────────────────────
  ["SAFE_PII_LEAK", "critical", "Potential PII leak (SSN/Phone)", "Remove sensitive personal information.", "\\b(?:\\d{3}-\\d{2}-\\d{4}|\\(\\d{3}\\)\\s*\\d{3}-\\d{4})\\b", ""],
  ["SAFE_FINANCIAL_ADVICE", "major", "Definitive financial advice", "Add disclaimer that this is not financial advice.", "\\b(?:you should invest in|buy this stock|guaranteed return)\\b", "i"],
  ["SAFE_MEDICAL_DIAGNOSIS", "critical", "Definitive medical diagnosis", "Add disclaimer and advise consulting a doctor.", "\\b(?:you have|your symptoms mean you have) (?:cancer|diabetes|lupus|covid)\\b", "i"],
  ["SAFE_DANGEROUS_CHEMISTRY", "critical", "Dangerous chemical synthesis", "Refuse requests for dangerous syntheses.", "\\b(?:how to make|recipe for) (?:meth|heroin|fentanyl|sarin)\\b", "i"],
  ["SAFE_HATE_SPEECH_SLUR", "critical", "Presence of hate speech or slurs", "Remove all hate speech and slurs.", "\\b(?:slur1|slur2)\\b", "i"], // Obfuscated for safety in this environment
  ["SAFE_PROMOTES_VIOLENCE", "critical", "Promotes or incites violence", "Remove violent content.", "\\b(?:kill them|burn it down|attack the)\\b", "i"],
  ["SAFE_NON_CONSENSUAL_SEXUAL", "critical", "Non-consensual sexual content", "Remove all non-consensual sexual references.", "\\b(?:rape|non-consensual|forced)\\b", "i"],

  // ── Factuality & Consistency ─────────────────────────────────────────
  ["FACT_CONTRADICTS_SELF", "major", "Answer contradicts itself", "Ensure logical consistency throughout.", "\\b(?:is always true)[\\s\\S]{10,200}(?:is never true)\\b", "i"],
  ["FACT_IMPOSSIBLE_DATE", "major", "Impossible date mentioned", "Correct the date.", "\\b(?:February 30|April 31|November 31)\\b", "i"],
  ["FACT_ANACHRONISM", "major", "Historical anachronism", "Correct the historical timeline.", "\\b(?:Abraham Lincoln used his iPhone|Julius Caesar tweeted)\\b", "i"],
  ["FACT_FALSE_CORRELATION", "warning", "Implies correlation is causation", "Clarify that correlation does not imply causation.", "\\b(?:caused by the increase in|directly resulted from)[\\s\\S]{0,50}(?:correlation)\\b", "i"],

  // ── Logic & Reasoning ────────────────────────────────────────────────
  ["LOGIC_CIRCULAR_REASONING", "major", "Circular reasoning detected", "Provide independent premises for the conclusion.", "\\b(?:is true because)[\\s\\S]{0,50}(?:is true)\\b", "i"],
  ["LOGIC_STRAWMAN_ARGUMENT", "warning", "Strawman argument pattern", "Address the actual argument, not a simplified version.", "\\b(?:some might say that|opponents believe)[\\s\\S]{0,50}(?:but this is obviously false)\\b", "i"],
  ["LOGIC_AD_HOMINEM", "major", "Ad hominem attack", "Critique the argument, not the person.", "\\b(?:is a fool so their argument|cannot be trusted because they are)\\b", "i"],

  // ── Tone & Style ─────────────────────────────────────────────────────
  ["STYLE_OVERLY_EMOTIONAL", "warning", "Overly emotional language", "Maintain a professional, objective tone.", "\\b(?:I am so incredibly angry|It makes me want to cry)\\b", "i"],
  ["STYLE_PASSIVE_AGGRESSIVE", "warning", "Passive-aggressive tone", "Use direct, constructive language.", "\\b(?:Per my last email|As you should already know)\\b", "i"],
  ["STYLE_JARGON_OVERLOAD", "major", "Excessive unexplained jargon", "Define technical terms or use simpler language.", "\\b(?:orthogonal paradigm shifts|synergistic leverage methodologies)\\b", "i"],
  ["STYLE_SLANG_IN_FORMAL", "warning", "Slang in a formal context", "Use appropriate register.", "\\b(?:that's lit|totally fire|no cap)\\b", "i"],

  // ── Instruction Following ────────────────────────────────────────────
  ["INST_IGNORED_FORMAT", "major", "Failed to follow formatting instructions", "Ensure the requested format (e.g., JSON, markdown) is used.", "\\b(?:Here is the information you requested:)(?![\\s\\S]*```)\\b", "i"],
  ["INST_IGNORED_LENGTH", "warning", "Output significantly exceeds requested length", "Edit to meet length constraints.", "(?:.){5000,}", "s"],
  ["INST_IGNORED_ROLE", "major", "Failed to adopt requested role", "Adopt the specified persona.", "\\b(?:As an AI|I am an AI)\\b", "i"],

  // ── L12 Williams: Ethics of Style ─────────────────────────────────────
  ["ETHICS_OBSCURANTISM", "major", "Using complexity to hide weakness", "State the limitation clearly.", "\\b(?:It is a matter of profound conceptual ambiguity whether)[\\s\\S]{0,50}\\b", "i"],
  ["ETHICS_FALSE_CERTAINTY", "major", "Expressing absolute certainty on unsettled science", "Use calibrated hedging.", "\\b(?:Science has definitively proven that|There is absolutely no doubt that)\\b", "i"],

  // ── Advanced Format / Markdown ───────────────────────────────────────
  ["MD_BROKEN_IMAGE", "warning", "Markdown image tag is broken", "Fix the image syntax.", "!\\[[^\\]]*\\]\\(\\s*\\)", ""],
  ["MD_NESTED_BLOCKQUOTE", "warning", "Excessively nested blockquotes", "Simplify the blockquote structure.", "^>\\s*>\\s*>\\s*>", "m"],
  ["MD_UNORDERED_LIST_MIX", "warning", "Mixed unordered list markers", "Use consistent list markers (* or -).", "(?:^\\*\\s+.*\\n)+(?:^-\\s+.*\\n)+", "m"],
  ["MD_HEADER_NO_SPACE", "warning", "Header missing space after hashes", "Add a space after the header hashes.", "^#{1,6}[^\\s#]", "m"],

  // ── Deep Code / Technical ────────────────────────────────────────────
  ["CODE_SYNTAX_ERROR_JS", "major", "Likely JavaScript syntax error", "Fix the JavaScript syntax.", "\\b(?:const|let|var)\\s+\\w+\\s*=\\s*;\\b", ""],
  ["CODE_UNDEFINED_VAR", "warning", "Using potentially undefined variable", "Define the variable before use.", "\\b(?:return|console\\.log\\()\\s*undefined_var\\b", ""],
  ["CODE_INFINITE_LOOP", "critical", "Potential infinite loop", "Ensure the loop has a termination condition.", "\\bwhile\\s*\\(\\s*true\\s*\\)\\s*\\{\\s*\\}", ""],

  // ── Hand-Trace Appendix Completeness ──────────────────────────────────
  ["MISSING_HAND_TRACE", "warning", "Report contains quantitative claims but no Analytical Hand-Trace appendix", "Add an Appendix: Analytical Hand-Trace section with step-by-step derivation for every quantitative claim.", "\\\\[S\\\\d+\\\\](?![\\\\s\\\\S]*Analytical Hand-Trace)", "i"],
  ["HAND_TRACE_MISSING_STATUS", "warning", "Hand-trace entry lacks verification status tag", "Add [SOURCED], [COMPUTED], [INFERRED], [ASSUMED], or [DATA GAP] to each hand-trace entry.", "Analytical Hand-Trace[\\\\s\\\\S]{50,}(?!\\\\[(?:SOURCED|COMPUTED|INFERRED|ASSUMED|DATA GAP)\\\\])", "i"],

  // ── Language / typography ───────────────────────────────────────────
  ["LANG_DOUBLE_SPACE_RUN", "warning", "Excessive multi-space run", "Collapse repeated spaces.", "\\S {3,}\\S", ""],
  ["LANG_SPACE_BEFORE_PUNCT", "warning", "Space before punctuation", "Remove the space before punctuation.", "\\s+[.,;:!?]", ""],
  ["LANG_LOWER_SENTENCE_START", "warning", "Sentence starts lowercase after period", "Capitalize sentence starts.", "[.!?]\\s+[a-z]{3,}", ""],
  ["LANG_MISSING_SPACE_AFTER_PUNCT", "warning", "Missing space after sentence punctuation", "Add a space after punctuation.", "[a-z][.!?][A-Z]", ""],
  ["LANG_DUP_ARTICLE", "warning", "Duplicated article (the the)", "Remove the duplicated article.", "\\b(the|a|an)\\s+\\1\\b", "i"],

  // ── Determinism / provenance integrity ──────────────────────────────
  ["PROV_UNVERIFIED_TOOL_CLAIM", "warning", "Claims a tool ran with no evidence", "Only claim tool runs backed by logs.", "\\bI (?:searched the web|ran a query|executed code) and found\\b", "i"],
  ["PROV_FAKE_LINK", "warning", "Obvious placeholder URL", "Use a real, resolvable URL.", "https?://(?:example\\.com|test\\.com|placeholder)", "i"],
  ["PROV_BROKEN_MD_LINK", "warning", "Markdown link with empty target", "Provide a real link target.", "\\[[^\\]]+\\]\\(\\s*\\)", ""],

  // ── Domain: cannabis-specific integrity (narrow) ────────────────────
  ["CAN_MED_CLAIM_UNCITED", "warning", "Cannabis medical claim without citation", "Cite clinical evidence for medical claims.", "\\b(?:cannabis|CBD|THC)[\\s\\S]{0,40}\\b(?:cures|treats|prevents)\\b(?![\\s\\S]{0,40}\\[S\\d+\\])", "i"],
  ["CAN_LEGAL_ABSOLUTE", "warning", "Absolute cannabis legality claim", "Add jurisdiction-specific legal caveat.", "\\bcannabis is (?:legal|illegal)\\b(?![\\s\\S]{0,80}(state|federal|jurisdiction|country))", "i"],
];

const defaults: TestbedGate[] = GATE_TUPLES.map(([code, severity, message, remediation, regex, flags], i) => ({
  id: `default-${i}-${code}`, code, severity, message, remediation, regex, flags, createdAt: 0, hits: 0,
}));

/** Total advanced gates currently active (for UI display). */
export function testbedGateCount(): number { return listTestbedGates().length; }

export function listTestbedGates(): TestbedGate[] {
  try {
    const raw = localStorage.getItem(K_GATES);
    const saved = raw ? JSON.parse(raw) : [];
    const all = [...defaults, ...(Array.isArray(saved) ? saved : [])];
    return all.filter((g, i) => all.findIndex(x => x.code === g.code || x.regex === g.regex) === i);
  } catch { return defaults; }
}
export function saveTestbedGates(gates: TestbedGate[]): void { try { localStorage.setItem(K_GATES, JSON.stringify(gates.filter(g => !g.id.startsWith("default-")).slice(-80))); } catch {} }
export function addTestbedGate(gate: Omit<TestbedGate, "id" | "createdAt" | "hits">): TestbedGate { const found = listTestbedGates().find(g => g.code === gate.code || g.regex === gate.regex); if (found) return found; const next = { ...gate, id: `gate-${Date.now()}`, createdAt: Date.now(), hits: 0 }; saveTestbedGates([...listTestbedGates(), next]); return next; }

export function runTestbedGates(answer: string): TestbedGateIssue[] {
  if (!getAdvancedGatesEnabled()) return [];
  const hasRefs = /(?:^|\n)#{0,3}\s*References:?/i.test(answer);
  const seen = new Set<string>();
  const out: TestbedGateIssue[] = [];
  for (const g of listTestbedGates()) {
    // Citation/reference gates are suppressed when a real References section
    // exists, except explicit fabricated-source detectors.
    if ((/CITAT|CITE|REF_/.test(g.code)) && hasRefs && !/FABRICATED|VOID|HAL_/.test(g.code)) continue;
    let matched = false;
    try { matched = new RegExp(g.regex, g.flags || "i").test(answer); } catch { matched = false; }
    if (!matched) continue;
    const key = `TESTBED_${g.code}`;
    if (seen.has(key)) continue; // dedupe by code — never double-count
    seen.add(key);
    out.push({ severity: g.severity, code: key, message: g.message, remediation: g.remediation, gateId: g.id });
  }
  return out;
}

function parseGateJson(text: string): any | null { const m = text.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } }
export async function proposeGateWithLLM(opts: { apiKey: string; question: string; answer: string; judgeNote?: string; model?: string }): Promise<TestbedGate | null> {
  if (!getAdvancedGatesEnabled()) return null;
  const res = await geminiGenerate({ apiKey: opts.apiKey, model: opts.model || "gemini-3.1-flash-lite", maxOutputTokens: 450, prompt: `Return one narrow regex gate as JSON or {"skip":true}. QUESTION:${opts.question}\nANSWER:${opts.answer.slice(0, 5000)}\nJUDGE_NOTE:${opts.judgeNote || ""}` });
  if (!res.ok) return null;
  const j = parseGateJson(res.text);
  if (!j || j.skip || typeof j.code !== "string" || typeof j.regex !== "string") return null;
  try { new RegExp(j.regex, j.flags || "i"); } catch { return null; }
  return addTestbedGate({ code: j.code, severity: ["warning", "major", "critical"].includes(j.severity) ? j.severity : "warning", message: String(j.message || j.code), remediation: String(j.remediation || "Revise the answer."), regex: j.regex, flags: String(j.flags || "i"), sourceModel: opts.model });
}
