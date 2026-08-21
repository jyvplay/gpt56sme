/**
 * Production pipeline seam: separated prewriting research + unified genome.
 * Alias callers receive this wrapper. Package-internal ChatApp imports its
 * pipeline relatively and remains a documented non-interceptable boundary.
 */
export * from "./pipeline.orig";

import { runMultiPassPipeline as packageRun } from "./pipeline.orig";
import { runPrewritingResearch } from "@/lib/debug/research-phase";
import { generateSynthesizedResponse } from '@/lib/models';

type Args = Parameters<typeof packageRun>[0];
type Result = Awaited<ReturnType<typeof packageRun>>;

export async function runMultiPassPipeline(opts: Args): Promise<Result> {
  const apiKey = String(opts.baseParams?.apiKey ?? "");
  const research = await runPrewritingResearch({
    question: opts.userQuery,
    personaSeed: Number((opts.persona as any)?.seed ?? undefined) || undefined,
    maxQueries: 8,
    generateQueries: apiKey
      ? (prompt) => generateSynthesizedResponse({
          ...opts.baseParams,
          userMessage: prompt,
          retrievedWebData: undefined,
          conversationHistory: [],
        }).then((text) => ({ ok: !!text, text })).catch((e) => ({ ok: false, text: "", error: e instanceof Error ? e.message : String(e) }))
      : undefined,
    onProgress: (message) => opts.onTrace?.({ stage: 0, label: `Prewriting research · ${message}`, ts: Date.now(), ok: true }),
  });
  const urls = new Set((opts.retrievedData ?? []).map((s) => s.url));
  const augmentedSources = [
    ...(opts.retrievedData ?? []),
    ...research.sources.filter((s) => !urls.has(s.url)),
  ];
  return packageRun({
    ...opts,
    userQuery: `${opts.userQuery}\n\n${research.innovation.directive}\n\n${research.dossier}`,
    retrievedData: augmentedSources,
    memory: { ...(opts.memory ?? {}), prewritingResearch: research },
  });
}
