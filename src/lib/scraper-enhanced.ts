// SIDECAR SEAM — see flatten-guide.md.
// Alias-reachable retrieval lane: the packaged `v15-grounding.ts` imports this
// module via `@/lib/scraper-enhanced`, so this seam IS on the live path.
// Adds a provenance tap only; retrieval behaviour is byte-for-byte unchanged.
export * from "./scraper-enhanced.orig";

import { enhancedSearch as packageEnhancedSearch } from "./scraper-enhanced.orig";
import { withLaneTap } from "@/lib/citation-lane-tap";

export const enhancedSearch = withLaneTap("enhanced-scraper", packageEnhancedSearch);
