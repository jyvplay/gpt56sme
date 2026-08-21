/**
 * ChatAugmentPanels — durable mount for the two new sibling modules.
 * ============================================================================
 * `ChatApp` imports `StylePersonaPanel` with a RELATIVE specifier
 * (`./StylePersonaPanel`), so a workspace `@/components/...` seam cannot
 * intercept it. Editing the package file is forbidden (it resets every turn).
 *
 * The durable solution is a portal anchor: locate the Style Persona <section>
 * in the live DOM, insert one sibling container immediately after it, and
 * render the new panels into that container with `createPortal`. React owns
 * the portal contents; the host app is untouched.
 *
 * A MutationObserver re-anchors the container if the host re-renders and drops
 * it, so the modules survive navigation between Chat and the other pages.
 * ============================================================================ */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { InnovationPersonaPanel } from "@/components/InnovationPersonaPanel";
import { CitationLedgerPanel } from "@/components/CitationLedgerPanel";
import { CreativeTreeOfLifePanel } from "@/components/CreativeTreeOfLifePanel";

const ANCHOR_ID = "veritas-augment-persona-anchor";

/** Locate the Style Persona section rendered by the packaged ChatApp. */
function findStylePersonaSection(): HTMLElement | null {
  const sections = Array.from(document.querySelectorAll("section"));
  for (const section of sections) {
    if (section.textContent?.includes("Style Persona:")) return section as HTMLElement;
  }
  return null;
}

/** Ensure the sibling container exists immediately after the Style panel. */
function ensureAnchor(): HTMLElement | null {
  const host = findStylePersonaSection();
  if (!host || !host.parentElement) return null;

  let anchor = document.getElementById(ANCHOR_ID);
  if (anchor && anchor.previousElementSibling === host) return anchor;

  if (!anchor) {
    anchor = document.createElement("div");
    anchor.id = ANCHOR_ID;
    // Matches the vertical rhythm of the host stack so nothing looks scattered.
    anchor.className = "mt-3 space-y-3";
  }
  host.insertAdjacentElement("afterend", anchor);
  return anchor;
}

export function ChatAugmentPanels() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const sync = () => {
      const next = ensureAnchor();
      setAnchor((prev) => (prev === next ? prev : next));
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(sync, 1000);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      document.getElementById(ANCHOR_ID)?.remove();
    };
  }, []);

  if (!anchor) return null;

  return createPortal(
    <>
      <InnovationPersonaPanel />
      <CreativeTreeOfLifePanel />
      <CitationLedgerPanel />
    </>,
    anchor,
  );
}
