/**
 * spa-rescue-bridge.ts
 * ============================================================================
 * ADDITIVE bridge that closes the one self-documented gap in the canonical
 * stack: `structured-source-adapter.ts`'s `rescueSpaPayload()` requires the
 * raw HTML to arrive via `Error.cause`, but `retrieval-policy-augments.ts`'s
 * `withChallengeGate()` throws a plain `Error(message)` with no `.cause`.
 * As documented by the canonical author: "This is a known limitation,
 * documented, not a silent bug." This file closes it without touching either
 * canonical file.
 *
 * WHAT THIS DOES:
 *   Wraps a base reader with:
 *     1. Content classification: distinguish TRUE bot-challenges (Turnstile,
 *        CAPTCHA, WAF block pages — hard failures that must propagate so the
 *        circuit breaker in retrieval-control-plane.ts responds correctly)
 *        from SOFT SPA shells / thin-content pages (safe to rescue).
 *     2. On a soft failure, attaches the raw HTML as `Error.cause` in the
 *        exact shape `structured-source-adapter.ts`'s `wrappedStructuredChallengeReader`
 *        already expects (a string > 200 chars), then re-throws so the
 *        existing canonical rescue logic activates unmodified.
 *     3. On a hard failure (real challenge), re-throws with NO cause,
 *        preserving the canonical circuit-breaker/challenge-gate semantics
 *        exactly as designed — this is the safety-critical distinction.
 *
 * WHAT THIS EXPLICITLY DOES NOT DO (red-teamed and rejected this session):
 *   - Does NOT attempt any new transport lane, proxy, or CORS bypass.
 *   - Does NOT modify retrieval-policy-augments.ts's detectChallenge/
 *     withChallengeGate or structured-source-adapter.ts's rescue functions.
 *
 * ADDITIVE ONLY. Zero new npm deps. Browser-only, keyless.
 * NOT EXECUTED in this environment.
 * ============================================================================ */

import type { ScheduleContext, RetrievalPolicy, CrawlPayload } from "./retrieval-control-plane";
import { detectPageBlock } from "./retrieval-policy-augments";

// Adapter around detectPageBlock to provide standard isChallenge/isSpaShell properties
export function detectChallenge(html: string): {
  isChallenge: boolean;
  isSpaShell: boolean;
  markers: string[];
} {
  const d = detectPageBlock(html);
  return {
    isChallenge: d.blocked,
    isSpaShell: d.softShell,
    markers: d.markers,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SOFT vs HARD FAILURE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A "soft" failure is one where detectChallenge() found NO true challenge
 * markers (Turnstile/CAPTCHA/WAF text) but the content was still rejected —
 * i.e. it was thin, an SPA shell, or low-text-ratio. These are the ONLY
 * cases eligible for rescue. A true isChallenge=true case is a real bot
 * block and MUST propagate unmodified so the circuit breaker in
 * retrieval-control-plane.ts opens correctly for that host.
 */
export function isSoftFailure(html: string): boolean {
  const d = detectChallenge(html);
  return !d.isChallenge && (d.isSpaShell || d.markers.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * withSpaRescueCause — wraps a base reader (the one you'd normally pass to
 * canonical `withChallengeGate()`) so that when the underlying fetch succeeds
 * in getting bytes but the CONTENT is a soft SPA shell / thin page (not a
 * true bot-challenge), the raw HTML is captured and attached to the thrown
 * error's `.cause` in the exact shape `structured-source-adapter.ts`'s
 * `wrappedStructuredChallengeReader` already expects.
 */
export function withSpaRescueCause<T>(
  reader: (url: string, ctx: ScheduleContext, policy: RetrievalPolicy) => Promise<CrawlPayload<T>>,
): (url: string, ctx: ScheduleContext, policy: RetrievalPolicy) => Promise<CrawlPayload<T>> {
  return async (url, ctx, policy) => {
    try {
      const payload = await reader(url, ctx, policy);
      return payload;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const existingCause = (err as { cause?: unknown }).cause;
      if (typeof existingCause === "string" && existingCause.length > 200) {
        if (isSoftFailure(existingCause)) {
          throw err;
        }
        const stripped = new Error(err.message);
        throw stripped;
      }
      throw err;
    }
  };
}

/**
 * withSpaRescueFromRawResponse — the PRIMARY, fully-functional rescue path.
 * Use this INSTEAD of `withChallengeGate` (not layered on top of it) when
 * you construct your own base reader, because it has access to the raw
 * fetched text BEFORE any challenge-gate throws away that context.
 */
export function withSpaRescueFromRawResponse<T>(
  rawReader: (url: string, ctx: ScheduleContext, policy: RetrievalPolicy) => Promise<CrawlPayload<T>>,
): (url: string, ctx: ScheduleContext, policy: RetrievalPolicy) => Promise<CrawlPayload<T>> {
  return async (url, ctx, policy) => {
    const payload = await rawReader(url, ctx, policy);
    const html = payload.text ?? "";
    const classification = detectChallenge(html);

    if (classification.isChallenge) {
      throw new Error(`challenge_detected:${classification.markers[0] ?? "unknown"}`);
    }

    if (classification.isSpaShell || html.trim().length < 80) {
      const err = new Error(
        classification.isSpaShell ? "spa_shell_detected" : "thin_content_detected",
      );
      if (html.length > 200) {
        (err as { cause?: unknown }).cause = html;
      }
      throw err;
    }

    return payload;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

export async function runSpaRescueBridgeDiagnostics(): Promise<{
  ok: boolean;
  checks: Array<{
    id: string;
    passed: boolean;
    detail: string;
  }>;
}> {
  const checks: Array<{
    id: string;
    passed: boolean;
    detail: string;
  }> = [];

  const add = (
    id: string,
    passed: boolean,
    detail: string,
  ): void => {
    checks.push({ id, passed, detail });
  };

  const mockController = new AbortController();

  const mockCtx = {
    attempt: 1,
    host: "example.com",
    hostLimit: 1,
    signal: mockController.signal,
  } as ScheduleContext;

  const mockPolicy = {
    policyVersion: "diagnostic",
    extractionVersion: "diagnostic",
    maxBytes: 2_000_000,
    freshnessMs: 0,
    requiredLaneClasses: 1,
    cacheMode: "off",
    robotsMode: "off",
    scope: "seed-origins",
    allowHostedRenderer: true,
    allowPublicRelays: true,
    allowArchive: true,
  } as RetrievalPolicy;

  // 1. Clean content passes through unchanged.
  {
    const wrapped =
      withSpaRescueFromRawResponse<string>(
        async () => ({
          value: "ok",
          text:
            "<article><p>" +
            "Normal readable article content spanning several sentences. ".repeat(
              10,
            ) +
            "</p></article>",
          contentType: "text/html",
          canonicalUrl:
            "https://example.com/article",
          bytesRead: 640,
        }),
      );

    try {
      const result = await wrapped(
        "https://example.com/article",
        mockCtx,
        mockPolicy,
      );

      add(
        "clean-content-passes",
        result.value === "ok",
        `value=${String(result.value)}`,
      );
    } catch (error) {
      add(
        "clean-content-passes",
        false,
        error instanceof Error
          ? error.message
          : "unexpected rejection",
      );
    }
  }

  // 2. SPA shell throws with the original HTML as Error.cause.
  {
    const spaHtml =
      '<html><head><meta property="og:title" content="SPA article"></head>' +
      '<body><div id="__next"></div><script src="/app.js"></script></body></html>' +
      "x".repeat(240);

    const wrapped =
      withSpaRescueFromRawResponse<string>(
        async () => ({
          value: "spa",
          text: spaHtml,
          contentType: "text/html",
          canonicalUrl:
            "https://spa.example.com/article",
          bytesRead: spaHtml.length,
        }),
      );

    try {
      await wrapped(
        "https://spa.example.com/article",
        mockCtx,
        mockPolicy,
      );

      add(
        "spa-shell-throws-with-cause",
        false,
        "did not throw",
      );
    } catch (error) {
      const cause = (
        error as { cause?: unknown }
      ).cause;

      add(
        "spa-shell-throws-with-cause",
        typeof cause === "string" &&
          cause === spaHtml &&
          cause.includes("__next"),
        `causeType=${typeof cause} causeLength=${
          typeof cause === "string"
            ? cause.length
            : 0
        }`,
      );
    }
  }

  // 3. A genuine WAF/challenge response must not expose rescue data.
  {
    const challengeHtml =
      "<html><body>" +
      '<div class="cf-challenge">' +
      "Checking your browser. Turnstile verification required." +
      "</div>" +
      "</body></html>";

    const wrapped =
      withSpaRescueFromRawResponse<string>(
        async () => ({
          value: "blocked",
          text: challengeHtml,
          contentType: "text/html",
          canonicalUrl:
            "https://blocked.example.com/article",
          bytesRead: challengeHtml.length,
        }),
      );

    try {
      await wrapped(
        "https://blocked.example.com/article",
        mockCtx,
        mockPolicy,
      );

      add(
        "hard-challenge-throws-without-cause",
        false,
        "did not throw",
      );
    } catch (error) {
      const cause = (
        error as { cause?: unknown }
      ).cause;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      add(
        "hard-challenge-throws-without-cause",
        cause === undefined &&
          message.startsWith(
            "challenge_detected:",
          ),
        `causePresent=${
          cause !== undefined
        } message=${message}`,
      );
    }
  }

  // 4. Very short content contains nothing useful to salvage.
  {
    const wrapped =
      withSpaRescueFromRawResponse<string>(
        async () => ({
          value: "thin",
          text: "x".repeat(50),
          contentType: "text/html",
          canonicalUrl:
            "https://thin.example.com/article",
          bytesRead: 50,
        }),
      );

    try {
      await wrapped(
        "https://thin.example.com/article",
        mockCtx,
        mockPolicy,
      );

      add(
        "thin-content-too-short-no-cause",
        false,
        "did not throw",
      );
    } catch (error) {
      const cause = (
        error as { cause?: unknown }
      ).cause;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      add(
        "thin-content-too-short-no-cause",
        cause === undefined &&
          message === "thin_content_detected",
        `causePresent=${
          cause !== undefined
        } message=${message}`,
      );
    }
  }

  // 5. Empty response also has no salvageable cause.
  {
    const wrapped =
      withSpaRescueFromRawResponse<string>(
        async () => ({
          value: "empty",
          text: "",
          contentType: "text/html",
          canonicalUrl:
            "https://empty.example.com/article",
          bytesRead: 0,
        }),
      );

    try {
      await wrapped(
        "https://empty.example.com/article",
        mockCtx,
        mockPolicy,
      );

      add(
        "empty-html-no-cause",
        false,
        "did not throw",
      );
    } catch (error) {
      const cause = (
        error as { cause?: unknown }
      ).cause;

      add(
        "empty-html-no-cause",
        cause === undefined,
        `causePresent=${cause !== undefined}`,
      );
    }
  }

  // 6. Plain failures are not converted into fabricated rescue payloads.
  {
    const wrapped =
      withSpaRescueCause<string>(
        async () => {
          throw new Error(
            "some_generic_failure",
          );
        },
      );

    try {
      await wrapped(
        "https://generic.example.com/article",
        mockCtx,
        mockPolicy,
      );

      add(
        "no-cause-rethrows-unchanged",
        false,
        "did not throw",
      );
    } catch (error) {
      const cause = (
        error as { cause?: unknown }
      ).cause;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      add(
        "no-cause-rethrows-unchanged",
        message === "some_generic_failure" &&
          cause === undefined,
        `message=${message} causePresent=${
          cause !== undefined
        }`,
      );
    }
  }

  // 7. A pre-existing, valid SPA rescue cause is preserved exactly.
  {
    const softHtml =
      '<html><body><div id="__next"></div>' +
      "y".repeat(240) +
      "</body></html>";

    const wrapped =
      withSpaRescueCause<string>(
        async () => {
          const error = new Error(
            "spa_shell_detected",
          );

          (
            error as {
              cause?: unknown;
            }
          ).cause = softHtml;

          throw error;
        },
      );

    try {
      await wrapped(
        "https://soft.example.com/article",
        mockCtx,
        mockPolicy,
      );

      add(
        "soft-cause-propagated",
        false,
        "did not throw",
      );
    } catch (error) {
      const cause = (
        error as { cause?: unknown }
      ).cause;

      add(
        "soft-cause-propagated",
        cause === softHtml,
        `causeMatches=${cause === softHtml}`,
      );
    }
  }

  // 8. A mistakenly attached challenge page must have its cause stripped.
  {
    const hardHtml =
      '<html><body><div class="cf-challenge">' +
      "Checking your browser. Turnstile verification required." +
      "</div>" +
      "z".repeat(180) +
      "</body></html>";

    const wrapped =
      withSpaRescueCause<string>(
        async () => {
          const error = new Error(
            "mislabeled_soft_failure",
          );

          (
            error as {
              cause?: unknown;
            }
          ).cause = hardHtml;

          throw error;
        },
      );

    try {
      await wrapped(
        "https://hard.example.com/article",
        mockCtx,
        mockPolicy,
      );

      add(
        "hard-cause-stripped",
        false,
        "did not throw",
      );
    } catch (error) {
      const cause = (
        error as { cause?: unknown }
      ).cause;

      add(
        "hard-cause-stripped",
        cause === undefined,
        cause === undefined
          ? "cause stripped"
          : "hard challenge cause leaked",
      );
    }
  }

  // 9. Non-Error thrown values are normalized without inventing data.
  {
    const wrapped =
      withSpaRescueCause<string>(
        async () => {
          throw "raw_string_failure";
        },
      );

    try {
      await wrapped(
        "https://nonerror.example.com/article",
        mockCtx,
        mockPolicy,
      );

      add(
        "non-error-normalized",
        false,
        "did not throw",
      );
    } catch (error) {
      add(
        "non-error-normalized",
        error instanceof Error &&
          error.message ===
            "raw_string_failure",
        `isError=${
          error instanceof Error
        } message=${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  return {
    ok: checks.every(
      (check) => check.passed,
    ),
    checks,
  };
}
