/**
 * Citation Ledger — auditable, per-source evidence provenance.
 *
 * Every retrieved source gets a stable entry with:
 *   - sequential [S#] tag
 *   - title, URL, verbatim snippet (the exact text the LLM saw)
 *   - content hash (SHA-like fingerprint for tamper detection)
 *   - retrieval stage (initial grounding, HDIG, CoVe, N-Deep re-ground)
 *   - timestamp
 *
 * The ledger is threaded through the entire pipeline so every LLM call
 * that uses evidence cites from the SAME stable ID space, and the final
 * `auditCitations()` function verifies whether each [S#] tag in the
 * output has a matching ledger entry and whether the cited passage
 * supports the claim (via substring overlap — no LLM call needed for
 * the basic trust check).
 *
 * The UI receives the full ledger for one-click audit: clicking any
 * [S#] tag reveals the exact snippet, URL, retrieval stage, and hash.
 */

export interface CitationEntry {
  id: number;                // sequential, 1-based — matches [S{id}]
  title: string;
  url: string;
  snippet: string;           // verbatim text the LLM was shown
  hash: string;              // content fingerprint
  stage: "initial" | "hdig" | "cove" | "n-deep" | "adversarial";
  timestamp: number;
}

export interface CitationAuditResult {
  tag: string;               // e.g. "[S3]"
  id: number;
  found: boolean;            // true if ledger has an entry for this ID
  entry?: CitationEntry;     // the ledger entry (if found)
  claimContext: string;      // the ~200 char context around the [S#] in the output
  snippetOverlap: number;    // 0-1 — fraction of claim context words found in source snippet
  trusted: boolean;          // true if found AND snippetOverlap >= 0.15 (at least some words match)
  entailmentScore?: number;  // 0.0-1.0 score from LLM entailment check (if run)
}

export interface CitationLedgerSnapshot {
  entries: CitationEntry[];
  auditResults: CitationAuditResult[];
  totalCitations: number;
  trustedCount: number;
  untrustedCount: number;
  missingCount: number;
}

function quickHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export class CitationLedger {
  private entries: CitationEntry[] = [];

  /** Add a source. Returns the assigned [S#] ID. */
  addSource(source: { title: string; url: string; content: string }, stage: CitationEntry["stage"]): number {
    const id = this.entries.length + 1;
    this.entries.push({
      id,
      title: source.title.slice(0, 200),
      url: source.url,
      snippet: source.content.slice(0, 1200),
      hash: quickHash(source.content),
      stage,
      timestamp: Date.now(),
    });
    return id;
  }

  /** Add multiple sources and return the starting ID. */
  addSources(sources: Array<{ title: string; url: string; content: string }>, stage: CitationEntry["stage"]): number {
    const startId = this.entries.length + 1;
    for (const s of sources) this.addSource(s, stage);
    return startId;
  }

  /** Get the current count. */
  get count(): number { return this.entries.length; }

  /** Get a specific entry by ID. */
  get(id: number): CitationEntry | undefined { return this.entries.find(e => e.id === id); }

  /** Build the evidence block string for LLM injection. */
  buildEvidenceBlock(provider: string): string {
    if (!this.entries.length) return "";
    return `LIVE RETRIEVED EVIDENCE (${provider}, ${this.entries.length} sources; cite only [S1]-[S${this.entries.length}]):\n` +
      this.entries.map(e => `[S${e.id}] ${e.title}\nURL: ${e.url}\n${e.snippet}`).join("\n---\n");
  }

  /** Audit all [S#] citations in the output text against this ledger. */
  auditCitations(outputText: string): CitationLedgerSnapshot {
    const tags = [...new Set((outputText.match(/\[S(\d+)\]/g) ?? []))];
    const auditResults: CitationAuditResult[] = [];

    for (const tag of tags) {
      const idMatch = tag.match(/\d+/);
      if (!idMatch) continue;
      const id = parseInt(idMatch[0], 10);
      const entry = this.get(id);

      // Extract ~200 chars of context around the citation
      const tagPos = outputText.indexOf(tag);
      const contextStart = Math.max(0, tagPos - 100);
      const contextEnd = Math.min(outputText.length, tagPos + tag.length + 100);
      const claimContext = outputText.slice(contextStart, contextEnd);

      let snippetOverlap = 0;
      if (entry) {
        // Compute word overlap between the claim context and the source snippet
        const claimWords = new Set(claimContext.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 3));
        const snippetWords = new Set(entry.snippet.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 3));
        if (claimWords.size > 0) {
          let overlap = 0;
          for (const w of claimWords) { if (snippetWords.has(w)) overlap++; }
          snippetOverlap = overlap / claimWords.size;
        }
      }

      auditResults.push({
        tag,
        id,
        found: !!entry,
        entry,
        claimContext,
        snippetOverlap: Math.round(snippetOverlap * 100) / 100,
        trusted: !!entry && snippetOverlap >= 0.15,
      });
    }

    const trustedCount = auditResults.filter(r => r.trusted).length;
    const missingCount = auditResults.filter(r => !r.found).length;
    const untrustedCount = auditResults.filter(r => r.found && !r.trusted).length;

    return {
      entries: [...this.entries],
      auditResults,
      totalCitations: tags.length,
      trustedCount,
      untrustedCount,
      missingCount,
    };
  }

  /** Run a structured LLM entailment check on untrusted citations. */
  async verifyEntailment(auditSnapshot: CitationLedgerSnapshot, apiKey: string, model: string, onProgress?: (msg: string) => void): Promise<CitationLedgerSnapshot> {
    const untrusted = auditSnapshot.auditResults.filter(r => r.found && !r.trusted);
    if (!untrusted.length) return auditSnapshot;

    onProgress?.(`Citation Ledger: running LLM entailment check on ${untrusted.length} low-overlap citation(s)`);
    
    for (const r of untrusted) {
      if (!r.entry) continue;
      const prompt = `You are a strict citation entailment judge. Verify if the CLAIM is supported by the SOURCE SNIPPET.
Return ONLY JSON: {"score": <0.0 to 1.0>, "reason": "<short>"}
Score 1.0 if fully supported, 0.5 if partially supported/inferred, 0.0 if contradicted or not mentioned.

CLAIM: "${r.claimContext}"
SOURCE SNIPPET: "${r.entry.snippet}"`;

      try {
        // Dynamic import to avoid circular dependency at top level
        const res = await (await import("./model-rotator")).generateWithRotation({
          apiKey, prompt, preferredModel: model, maxOutputTokens: 100
        });
        
        if (res.ok) {
          const m = res.text.match(/\{[\s\S]*\}/);
          const j = JSON.parse(m ? m[0] : res.text);
          r.entailmentScore = Number(j.score) || 0;
          r.trusted = r.entailmentScore >= 0.8;
          onProgress?.(`Citation Ledger: [${r.tag}] entailment score ${r.entailmentScore.toFixed(2)} → ${r.trusted ? "TRUSTED" : "UNTRUSTED"}`);
        }
      } catch {
        onProgress?.(`Citation Ledger: [${r.tag}] entailment check failed`);
      }
    }

    const trustedCount = auditSnapshot.auditResults.filter(r => r.trusted).length;
    const missingCount = auditSnapshot.auditResults.filter(r => !r.found).length;
    const untrustedCount = auditSnapshot.auditResults.filter(r => r.found && !r.trusted).length;

    return {
      entries: [...auditSnapshot.entries],
      auditResults: auditSnapshot.auditResults,
      totalCitations: auditSnapshot.totalCitations,
      trustedCount,
      untrustedCount,
      missingCount,
    };
  }

  /** Get all entries as a serializable snapshot. */
  snapshot(): CitationEntry[] { return [...this.entries]; }
}
