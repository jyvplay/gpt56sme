/**
 * content-extractor-v2.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Browser-native content extraction with security boundaries.
 * Readability (0.6.0, DOMParser doc) → structural heuristic → dom-text → regex.
 */
import { Readability } from "@mozilla/readability";

export type ExtractionMethod = "readability" | "structural" | "dom-text" | "regex-fallback";

export interface ExtractionLimits {
  maxInputChars: number;
  maxOutputChars: number;
  maxMarkdownChars: number;
  maxElements: number;
  minArticleChars: number;
}

export interface PromptInjectionSignal { id: string; description: string; }

export interface ExtractedContentV2 {
  title: string; text: string; markdown: string; excerpt: string;
  byline: string; siteName: string; lang: string; publishedTime: string;
  sourceUrl: string; canonicalUrl: string; method: ExtractionMethod;
  inputTruncated: boolean; outputTruncated: boolean;
  injectionSignals: PromptInjectionSignal[];
}

export const DEFAULT_EXTRACTION_LIMITS: Readonly<ExtractionLimits> = {
  maxInputChars: 2_000_000, maxOutputChars: 100_000, maxMarkdownChars: 100_000,
  maxElements: 50_000, minArticleChars: 160,
};

const ACTIVE_OR_REMOTE_ELEMENTS = "script,style,noscript,iframe,object,embed,link,form,input,button,select,textarea,video,audio,source,track,canvas,svg";
const STRUCTURAL_NOISE = "nav,header,footer,aside,[role='navigation'],[role='banner'],[role='complementary'],.advertisement,.advert,.ads,.cookie-banner,.cookie-consent,.gdpr,.newsletter,.subscribe,.social-share,.sharing,.related-posts,.related-articles";

const INJECTION_PATTERNS: ReadonlyArray<{ id: string; description: string; pattern: RegExp }> = [
  { id: "ignore-prior-instructions", description: "Content contains language asking a reader to ignore prior instructions.", pattern: /\bignore\s+(?:all\s+)?(?:previous|prior|earlier)\s+instructions?\b/i },
  { id: "role-switch", description: "Content contains an attempted role or authority switch.", pattern: /\b(?:you are now|act as|pretend to be|system message|developer message)\b/i },
  { id: "prompt-disclosure", description: "Content requests disclosure of prompts, hidden instructions, or secrets.", pattern: /\b(?:reveal|show|print|expose)\b.{0,80}\b(?:system prompt|hidden instructions?|secret|api key|credentials?)\b/i },
  { id: "tool-command", description: "Content appears to direct tool or shell execution.", pattern: /\b(?:run|execute|invoke|call)\b.{0,60}\b(?:shell|terminal|command|tool|function|api)\b/i },
  { id: "instruction-boundary-token", description: "Content contains model-style role or instruction boundary tokens.", pattern: /(?:<\|(?:system|assistant|developer|user)\|>|\[(?:SYSTEM|DEVELOPER|ASSISTANT)\])/i },
];

function mergeLimits(limits?: Partial<ExtractionLimits>): ExtractionLimits { return { ...DEFAULT_EXTRACTION_LIMITS, ...limits }; }

function neutralizeBeforeParsing(html: string): string {
  return html
    .replace(/<\s*(script|style|noscript|iframe|object|embed|svg|canvas|video|audio)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*(script|style|noscript|iframe|object|embed|img|svg|canvas|video|audio|source|track)\b[^>]*\/?\s*>/gi, " ");
}

function safeNormalize(value: string): string { try { return value.normalize("NFKC"); } catch { return value; } }

export function normalizeEvidenceText(value: string): string {
  return safeNormalize(value || "")
    .replace(/\r\n?/g, "\n").replace(/[\u202A-\u202E\u2066-\u2069]/g, "").replace(/[\u200B-\u200F\uFEFF]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function detectPromptInjection(value: string): PromptInjectionSignal[] {
  const signals: PromptInjectionSignal[] = [];
  if (/[\u202A-\u202E\u2066-\u2069]/.test(value)) signals.push({ id: "bidi-control", description: "Content contained Unicode bidirectional control characters." });
  if (/[\u200B-\u200F\uFEFF]/.test(value)) signals.push({ id: "invisible-control", description: "Content contained zero-width or invisible formatting characters." });
  for (const candidate of INJECTION_PATTERNS) if (candidate.pattern.test(value)) signals.push({ id: candidate.id, description: candidate.description });
  return signals;
}

export function mergeInjectionSignals(...groups: PromptInjectionSignal[][]): PromptInjectionSignal[] {
  const unique = new Map<string, PromptInjectionSignal>();
  for (const group of groups) for (const s of group) if (!unique.has(s.id)) unique.set(s.id, s);
  return Array.from(unique.values());
}

function safeHttpUrl(raw: string | null | undefined, baseUrl?: string): string {
  if (!raw) return ""; if (raw.startsWith("#")) return raw;
  try {
    const parsed = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.username = ""; parsed.password = ""; parsed.hash = ""; return parsed.toString();
  } catch { return ""; }
}

function canonicalUrlFromDocument(doc: Document, sourceUrl?: string): string {
  const raw = doc.querySelector('link[rel~="canonical"]')?.getAttribute("href");
  return safeHttpUrl(raw, sourceUrl) || safeHttpUrl(sourceUrl || "");
}

function prepareDocument(rawHtml: string, sourceUrl: string | undefined, limits: ExtractionLimits): { doc: Document | null; inputTruncated: boolean; canonicalUrl: string; } {
  const sourceFallback = safeHttpUrl(sourceUrl || "");
  if (typeof DOMParser === "undefined") return { doc: null, inputTruncated: false, canonicalUrl: sourceFallback };
  const inputTruncated = rawHtml.length > limits.maxInputChars;
  const bounded = rawHtml.slice(0, limits.maxInputChars);
  const neutralized = neutralizeBeforeParsing(bounded);
  try {
    const doc = new DOMParser().parseFromString(neutralized, "text/html");
    if (!doc.body) return { doc: null, inputTruncated, canonicalUrl: sourceFallback };
    const canonicalUrl = canonicalUrlFromDocument(doc, sourceUrl);
    doc.querySelectorAll(ACTIVE_OR_REMOTE_ELEMENTS).forEach((n) => n.remove());
    doc.querySelectorAll("meta").forEach((n) => { if ((n.getAttribute("http-equiv") || "").toLowerCase() === "refresh") n.remove(); });
    doc.querySelectorAll("base").forEach((n) => n.remove());
    if (sourceUrl) { const safeBase = safeHttpUrl(sourceUrl); if (safeBase.startsWith("http://") || safeBase.startsWith("https://")) { const base = doc.createElement("base"); base.href = safeBase; doc.head.prepend(base); } }
    return { doc, inputTruncated, canonicalUrl };
  } catch { return { doc: null, inputTruncated, canonicalUrl: sourceFallback }; }
}

function stripUnsafeAttributes(root: Node, baseUrl?: string): void {
  if (!(root instanceof Element)) return;
  root.querySelectorAll(ACTIVE_OR_REMOTE_ELEMENTS).forEach((n) => n.remove());
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcdoc" || name === "nonce" || name === "integrity") element.removeAttribute(attribute.name);
    }
    if (element.tagName === "A") {
      const safe = safeHttpUrl(element.getAttribute("href"), baseUrl);
      if (safe) element.setAttribute("href", safe); else element.removeAttribute("href");
      element.removeAttribute("target"); element.setAttribute("rel", "noreferrer noopener");
    }
  }
}

function markdownEscape(value: string): string { return value.replace(/([\\`*_[\]<>!|])/g, "\\$1"); }

export function evidenceTextToSafeMarkdown(value: string): string {
  return normalizeEvidenceText(value).split("\n").map((line) => {
    const escaped = markdownEscape(line); return escaped.replace(/^(\s*)(#{1,6}|[-+*]|\d+\.)\s/, "$1\\$2 ");
  }).join("\n");
}

function inlineCode(value: string): string {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (m) => m[0].length)) + 1;
  const fence = "`".repeat(longest); return `${fence}${value}${fence}`;
}

interface MarkdownContext { baseUrl?: string; preformatted: boolean; listDepth: number; }

function renderMarkdownNode(node: Node, context: MarkdownContext): string {
  if (node.nodeType === 3) { const value = node.nodeValue || ""; if (context.preformatted) return value; return markdownEscape(value.replace(/\s+/g, " ")); }
  if (!(node instanceof Element)) return "";
  const tag = node.tagName.toLowerCase();
  if ("script,style,iframe,object,embed,form,input,button".split(",").includes(tag)) return "";
  if (tag === "br") return "\n"; if (tag === "hr") return "\n\n---\n\n";
  if (/^h[1-6]$/.test(tag)) { const level = Number(tag.slice(1)); const body = renderChildren(node, context).trim(); return body ? `\n\n${"#".repeat(level)} ${body}\n\n` : ""; }
  if ("p,div,section,article,main".split(",").includes(tag)) { const body = renderChildren(node, context).trim(); return body ? `\n\n${body}\n\n` : ""; }
  if (tag === "strong" || tag === "b") return `**${renderChildren(node, context).trim()}**`;
  if (tag === "em" || tag === "i") return `*${renderChildren(node, context).trim()}*`;
  if (tag === "del" || tag === "s" || tag === "strike") return `~~${renderChildren(node, context).trim()}~~`;
  if (tag === "code" && node.parentElement?.tagName !== "PRE") return inlineCode(node.textContent || "");
  if (tag === "pre") { const body = (node.textContent || "").replace(/\n+$/, ""); return body ? `\n\n\`\`\`\n${body}\n\`\`\`\n\n` : ""; }
  if (tag === "blockquote") { const body = renderChildren(node, context).trim().split("\n").map((l) => `> ${l}`).join("\n"); return body ? `\n\n${body}\n\n` : ""; }
  if (tag === "a") { const label = renderChildren(node, context).trim(); const href = safeHttpUrl(node.getAttribute("href"), context.baseUrl); return (href && label) ? `[${label}](${href})` : label; }
  if (tag === "ul" || tag === "ol") { const body = renderChildren(node, { ...context, listDepth: context.listDepth + 1 }).trimEnd(); return body ? `\n${body}\n` : ""; }
  if (tag === "li") {
    const parentTag = node.parentElement?.tagName.toLowerCase();
    const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((c) => c.tagName === "LI") : [];
    const position = Math.max(1, siblings.indexOf(node) + 1);
    const marker = parentTag === "ol" ? `${position}.` : "-";
    const indent = "  ".repeat(Math.max(0, context.listDepth - 1));
    const body = renderChildren(node, context).trim().replace(/\n{2,}/g, "\n").replace(/\n/g, `\n${indent}  `);
    return body ? `${indent}${marker} ${body}\n` : "";
  }
  return renderChildren(node, context);
}

function renderChildren(node: Node, context: MarkdownContext): string { return Array.from(node.childNodes).map((c) => renderMarkdownNode(c, context)).join(""); }

function nodeToSafeMarkdown(root: Node, baseUrl: string | undefined, maxChars: number): string {
  return renderMarkdownNode(root, { baseUrl, preformatted: false, listDepth: 0 }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
}

function chooseStructuralRoot(doc: Document): Element | null {
  const structural = doc.cloneNode(true) as Document; structural.querySelectorAll(`${ACTIVE_OR_REMOTE_ELEMENTS},${STRUCTURAL_NOISE}`).forEach((n) => n.remove());
  const candidates = Array.from(structural.querySelectorAll("article,main,[role='main'],.article,.article-body,.content,.entry,.entry-content,.post,.post-content,#content,#main,section,div"));
  let best: Element | null = null; let bestScore = -Infinity;
  for (const candidate of candidates) {
    const text = normalizeEvidenceText(candidate.textContent || ""); if (text.length < 80) continue;
    const links = Array.from(candidate.querySelectorAll("a")), linkTextLen = links.reduce((s, l) => s + (l.textContent || "").length, 0);
    const linkDensity = text.length > 0 ? Math.min(1, linkTextLen / text.length) : 1;
    const pCount = candidate.querySelectorAll("p").length;
    const score = text.length * (1 - linkDensity) + pCount * 80; if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return best || structural.body;
}

function regexFallback(html: string, limits: ExtractionLimits): string {
  return normalizeEvidenceText(html.slice(0, limits.maxInputChars).replace(/<(script|style|nav|footer|header|noscript|svg|iframe|object|form)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#x27;|&#39;/gi, "'")).slice(0, limits.maxOutputChars);
}

function buildResult(root: Node, metadata: { title?: string | null; byline?: string | null; siteName?: string | null; lang?: string | null; publishedTime?: string | null; sourceUrl: string; canonicalUrl: string; }, method: ExtractionMethod, inputTruncated: boolean, limits: ExtractionLimits, sourceSignals: PromptInjectionSignal[] = []): ExtractedContentV2 {
  stripUnsafeAttributes(root, metadata.sourceUrl); const rawText = root.textContent || ""; const injectionSignals = mergeInjectionSignals(sourceSignals, detectPromptInjection(rawText)); const normalized = normalizeEvidenceText(rawText); const text = normalized.slice(0, limits.maxOutputChars); const markdown = nodeToSafeMarkdown(root, metadata.sourceUrl, limits.maxMarkdownChars);
  return { title: normalizeEvidenceText(metadata.title || ""), text, markdown, excerpt: text.slice(0, 300), byline: normalizeEvidenceText(metadata.byline || ""), siteName: normalizeEvidenceText(metadata.siteName || ""), lang: normalizeEvidenceText(metadata.lang || ""), publishedTime: normalizeEvidenceText(metadata.publishedTime || ""), sourceUrl: metadata.sourceUrl, canonicalUrl: metadata.canonicalUrl, method, inputTruncated, outputTruncated: normalized.length > limits.maxOutputChars, injectionSignals };
}

export function extractContentFromHtmlV2(rawHtml: string, sourceUrl = "", limitOverrides?: Partial<ExtractionLimits>): ExtractedContentV2 {
  const limits = mergeLimits(limitOverrides), input = typeof rawHtml === "string" ? rawHtml : "";
  const boundedRawInput = input.slice(0, limits.maxInputChars), sourceSignals = detectPromptInjection(boundedRawInput);
  const prepared = prepareDocument(input, sourceUrl, limits);
  if (!prepared.doc) {
    const text = regexFallback(input, limits);
    return { title: "", text, markdown: evidenceTextToSafeMarkdown(text), excerpt: text.slice(0, 300), byline: "", siteName: "", lang: "", publishedTime: "", sourceUrl, canonicalUrl: prepared.canonicalUrl, method: "regex-fallback", inputTruncated: input.length > limits.maxInputChars, outputTruncated: text.length >= limits.maxOutputChars, injectionSignals: sourceSignals };
  }
  const doc = prepared.doc, canonicalUrl = prepared.canonicalUrl, elementCount = doc.getElementsByTagName("*").length;
  if (elementCount <= limits.maxElements) {
    try {
      const clone = doc.cloneNode(true) as Document;
      const article = new Readability<Node>(clone, { maxElemsToParse: limits.maxElements, charThreshold: limits.minArticleChars, disableJSONLD: true, serializer: (node) => node }).parse();
      const root = article?.content || null, articleText = normalizeEvidenceText(article?.textContent || "");
      if (root && articleText.length >= limits.minArticleChars) return buildResult(root, { title: article?.title, byline: article?.byline, siteName: article?.siteName, lang: article?.lang, publishedTime: article?.publishedTime, sourceUrl, canonicalUrl }, "readability", prepared.inputTruncated, limits, sourceSignals);
    } catch {}
  }
  const structuralRoot = chooseStructuralRoot(doc);
  if (structuralRoot) {
    const structuralText = normalizeEvidenceText(structuralRoot.textContent || "");
    if (structuralText.length >= 80) {
      const title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || doc.querySelector("title")?.textContent || doc.querySelector("h1")?.textContent || "";
      return buildResult(structuralRoot, { title, lang: doc.documentElement.lang, sourceUrl, canonicalUrl }, "structural", prepared.inputTruncated, limits, sourceSignals);
    }
  }
  const bodyText = normalizeEvidenceText(doc.body.textContent || "");
  if (bodyText) return buildResult(doc.body, { title: doc.querySelector("title")?.textContent || "", lang: doc.documentElement.lang, sourceUrl, canonicalUrl }, "dom-text", prepared.inputTruncated, limits, sourceSignals);
  const text = regexFallback(input, limits);
  return { title: "", text, markdown: evidenceTextToSafeMarkdown(text), excerpt: text.slice(0, 300), byline: "", siteName: "", lang: "", publishedTime: "", sourceUrl, canonicalUrl, method: "regex-fallback", inputTruncated: prepared.inputTruncated, outputTruncated: text.length >= limits.maxOutputChars, injectionSignals: sourceSignals };
}
