import { detectPromptInjection, evidenceTextToSafeMarkdown, extractContentFromHtmlV2, normalizeEvidenceText, type PromptInjectionSignal } from "./content-extractor-v2";
import { fetchBrowserTextV2, type BrowserFetchOptions, type BrowserFetchSource } from "./safe-fetch-v2";

export interface SmartReadV2Options extends BrowserFetchOptions { minChars?: number; onDebug?: (message: string) => void; }
export interface SmartReadV2Result {
  title: string; content: string; markdown: string; sourceUrl: string; canonicalUrl: string;
  transport: BrowserFetchSource | "local-html"; proxy?: string;
  extractionMethod: "jina-reader" | "readability" | "structural" | "dom-text" | "regex-fallback";
  injectionSignals: PromptInjectionSignal[]; truncated: boolean;
}

function hostedReaderToPlainText(value: string): string {
  const withoutHtml = value.replace(/<[^>\n]*>/g, " ");
  const withoutImages = withoutHtml.replace(/!\[([^\]]*)\]\((?:\\.|[^)])*\)/g, "$1");
  const withoutLinks = withoutImages.replace(/\[([^\]]+)\]\((?:\\.|[^)])*\)/g, "$1");
  const withoutFormatting = withoutLinks.replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s{0,3}(?:[-+*]|\d+\.)\s+/gm, "").replace(/[`*_~]/g, "");
  return normalizeEvidenceText(withoutFormatting);
}

export function smartReadHtmlV2(html: string, sourceUrl = ""): SmartReadV2Result {
  const extracted = extractContentFromHtmlV2(html, sourceUrl);
  return {
    title: extracted.title, content: extracted.text, markdown: extracted.markdown,
    sourceUrl, canonicalUrl: extracted.canonicalUrl || extracted.sourceUrl || sourceUrl,
    transport: "local-html", extractionMethod: extracted.method, injectionSignals: extracted.injectionSignals,
    truncated: extracted.inputTruncated || extracted.outputTruncated,
  };
}

export async function smartReadV2(url: string, options?: SmartReadV2Options): Promise<SmartReadV2Result> {
  const minimum = options?.minChars ?? 80;
  if (!Number.isFinite(minimum) || minimum<0) throw new TypeError("minChars must be a non-negative finite number.");
  const fetched = await fetchBrowserTextV2(url, options);
  if (fetched.format === "markdown") {
    const rawSignals = detectPromptInjection(fetched.text);
    const content = hostedReaderToPlainText(fetched.text);
    if (content.length < minimum) throw new Error("Hosted reader returned thin content.");
    options?.onDebug?.(`smartReadV2: jina-reader, ${content.length} characters`);
    return {
      title: normalizeEvidenceText(fetched.title), content, markdown: evidenceTextToSafeMarkdown(content),
      sourceUrl: fetched.sourceUrl, canonicalUrl: fetched.sourceUrl, transport: fetched.source, extractionMethod: "jina-reader",
      injectionSignals: rawSignals, truncated: fetched.truncated,
    };
  }
  const extracted = extractContentFromHtmlV2(fetched.text, fetched.sourceUrl);
  if (extracted.text.length < minimum) throw new Error("Extracted page content is too thin.");
  options?.onDebug?.(`smartReadV2: ${extracted.method} via ${fetched.source}${fetched.proxy ? ` (${fetched.proxy})` : ""}, ${extracted.text.length} characters`);
  return {
    title: extracted.title || fetched.title, content: extracted.text, markdown: extracted.markdown,
    sourceUrl: fetched.sourceUrl, canonicalUrl: extracted.canonicalUrl || fetched.sourceUrl,
    transport: fetched.source, proxy: fetched.proxy, extractionMethod: extracted.method,
    injectionSignals: extracted.injectionSignals,
    truncated: fetched.truncated || extracted.inputTruncated || extracted.outputTruncated,
  };
}
