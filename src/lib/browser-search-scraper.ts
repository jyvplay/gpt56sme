// SIDECAR SEAM — see flatten-guide.md.
// Alias-reachable retrieval lane: the packaged `v15-grounding.ts` imports this
// module via `@/lib/browser-search-scraper`, so this seam IS on the live path.
// Adds a provenance tap only; retrieval behaviour is byte-for-byte unchanged.
export * from "./browser-search-scraper.orig";

import { browserScraperSearch as packageBrowserScraperSearch } from "./browser-search-scraper.orig";
import { withLaneTap } from "@/lib/citation-lane-tap";

export const browserScraperSearch = withLaneTap("browser-scraper", packageBrowserScraperSearch);
