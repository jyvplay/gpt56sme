// SIDECAR SEAM — see flatten-guide.md.
// Alias-reachable retrieval lane: the packaged `v15-grounding.ts` imports this
// module via `@/lib/academic-sources`, so this seam IS on the live path.
// Adds a provenance tap only; retrieval behaviour is byte-for-byte unchanged.
export * from "./academic-sources.orig";

import { searchAcademicSources as packageSearchAcademicSources } from "./academic-sources.orig";
import { withLaneTap } from "@/lib/citation-lane-tap";

export const searchAcademicSources = withLaneTap("academic-sources", packageSearchAcademicSources);
